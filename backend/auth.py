"""Who is asking: Google sign-in, sessions, and the dependency every router uses.

The browser does the OAuth dance with Google itself (Google Identity Services,
loaded on the login screen) and hands us one thing: an ID token. This module
verifies that token against Google's public keys, upserts the person behind it
into `users`, and issues a session of our own — a random opaque id in an
HttpOnly cookie, backed by a document in `sessions`.

A session row rather than a signed JWT of our own, because sessions are state
and this app keeps all state in MongoDB: sign-out can then actually revoke one,
and the TTL index in db.py expires the rest without a cron job. The cookie
holds no claims, so nothing in it can be believed without a database lookup.

Everything the library owns (`songs`, `playlists`) carries `user_id`, the
owner's user document id as a string. Routers never read that off the request
themselves — they take a `CurrentUser` and use `user.id`.
"""

import asyncio
import secrets
from dataclasses import dataclass
from datetime import timedelta, timezone
from typing import Annotated

from fastapi import Depends, Request, Response

from backend import db, errors
from backend.config import (
    ADMIN_EMAILS,
    ALLOWED_EMAILS,
    GOOGLE_CLIENT_ID,
    LEGACY_OWNER_EMAIL,
    SESSION_COOKIE,
    SESSION_COOKIE_SECURE,
    SESSION_DAYS,
)
from backend.serializers import iso, now
from backend.storage import to_object_id

# google-auth does the JWKS fetch, caching and signature check. It's a hard
# dependency of signing in, but not of the app: without it the rest of the
# server still runs and the login screen explains itself.
try:
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token
except ImportError:  # pragma: no cover - only when the install is incomplete
    google_requests = None
    google_id_token = None

GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str
    given_name: str
    picture: str | None
    is_admin: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "given_name": self.given_name,
            "picture": self.picture,
            "is_admin": self.is_admin,
        }


def user_to_dict(doc: dict) -> dict:
    """The /api/auth/me shape — the profile, plus when they first showed up."""
    return {
        "id": str(doc["_id"]),
        "email": doc.get("email"),
        "name": doc.get("name"),
        "given_name": doc.get("given_name") or (doc.get("name") or "").split(" ")[0],
        "picture": doc.get("picture"),
        "is_admin": (doc.get("email") or "").lower() in ADMIN_EMAILS,
        "created_at": iso(doc.get("created_at")),
        "last_login_at": iso(doc.get("last_login_at")),
    }


def _user_from_doc(doc: dict) -> User:
    return User(
        id=str(doc["_id"]),
        email=doc.get("email") or "",
        name=doc.get("name") or "",
        given_name=doc.get("given_name") or (doc.get("name") or "").split(" ")[0],
        picture=doc.get("picture"),
        is_admin=(doc.get("email") or "").lower() in ADMIN_EMAILS,
    )


# --- Google ID token -------------------------------------------------------


def _verify_sync(credential: str) -> dict:
    """Blocking signature + audience + issuer check; call via to_thread."""
    claims = google_id_token.verify_oauth2_token(
        credential, google_requests.Request(), GOOGLE_CLIENT_ID
    )
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise ValueError("wrong issuer")
    return claims


async def verify_google_credential(credential: str) -> dict:
    if not GOOGLE_CLIENT_ID:
        raise errors.AppError(errors.NO_CLIENT_ID, 503)
    if google_id_token is None:
        raise errors.AppError(
            "Google sign-in needs the google-auth package — run: pip install -r requirements.txt",
            503,
        )
    if not credential:
        raise errors.AppError(errors.BAD_CREDENTIAL, 400)

    try:
        claims = await asyncio.to_thread(_verify_sync, credential)
    except Exception as exc:  # a bad, expired or mis-issued token all land here
        raise errors.AppError(f"{errors.BAD_CREDENTIAL} ({exc})", 401) from exc

    if not claims.get("email"):
        raise errors.AppError(
            "That Google account didn't share an email address, so there's nothing to "
            "tie a library to.",
            400,
        )
    # An unverified address could belong to someone else entirely.
    if claims.get("email_verified") is False:
        raise errors.AppError("Verify that email address with Google first.", 403)

    email = claims["email"].lower()
    # An admin is always on the guest list — otherwise setting one could lock the
    # person who runs the instance out of it.
    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS and email not in ADMIN_EMAILS:
        raise errors.AppError(errors.NOT_INVITED, 403)

    return claims


async def upsert_user(claims: dict) -> dict:
    """Find or create the person behind a verified token, and refresh their profile.

    Name and picture come from Google every time rather than being stored once —
    if they change their avatar, the sidebar should follow.
    """
    sub = claims["sub"]
    email = claims["email"].lower()
    ts = now()
    profile = {
        "email": email,
        "name": claims.get("name") or email.split("@")[0],
        "given_name": claims.get("given_name") or "",
        "picture": claims.get("picture"),
        "last_login_at": ts,
    }

    doc = await db.users_col.find_one_and_update(
        {"google_sub": sub},
        {
            "$set": profile,
            "$inc": {"login_count": 1},
            "$setOnInsert": {"google_sub": sub, "created_at": ts},
        },
        upsert=True,
        return_document=True,
    )
    await _adopt_unowned(doc)
    return doc


async def _adopt_unowned(user: dict) -> int:
    """Hand the pre-login library to whoever it belongs to.

    Songs and playlists saved before sign-in existed have no `user_id`, which
    means no query finds them any more. Rather than orphan them, the account
    named by LEGACY_OWNER_EMAIL claims them on sign-in; with that unset, the
    first account ever to sign in does. Either way it happens once, because the
    update is what removes them from the "unowned" set.
    """
    email = (user.get("email") or "").lower()
    if LEGACY_OWNER_EMAIL:
        if email != LEGACY_OWNER_EMAIL:
            return 0
    else:
        # The oldest user document, not merely "the only one" — otherwise a
        # second person signing in before the owner came back would lock the
        # pre-login library away from everybody for good.
        first = await db.users_col.find_one(
            {}, sort=[("created_at", 1), ("_id", 1)], projection={"_id": 1}
        )
        if not first or first["_id"] != user["_id"]:
            return 0

    uid = str(user["_id"])
    unowned = {"user_id": {"$exists": False}}
    songs = await db.songs_col.update_many(unowned, {"$set": {"user_id": uid}})
    playlists = await db.playlists_col.update_many(unowned, {"$set": {"user_id": uid}})
    return songs.modified_count + playlists.modified_count


# --- Sessions ---------------------------------------------------------------


async def start_session(user: dict, request: Request, response: Response) -> str:
    token = secrets.token_urlsafe(32)
    ts = now()
    await db.sessions_col.insert_one(
        {
            "_id": token,
            "user_id": str(user["_id"]),
            "created_at": ts,
            "expires_at": ts + timedelta(days=SESSION_DAYS),
            "user_agent": request.headers.get("user-agent", "")[:200],
        }
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        # Lax, not Strict: the cookie must survive following a link back into
        # the app. Nothing here is a cross-site form post.
        samesite="lax",
        secure=SESSION_COOKIE_SECURE,
        path="/",
    )
    return token


async def end_session(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.sessions_col.delete_one({"_id": token})
    response.delete_cookie(SESSION_COOKIE, path="/")


async def user_doc_for_request(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = await db.sessions_col.find_one({"_id": token})
    if not session:
        return None
    # The TTL monitor only sweeps once a minute, so an expired row can still be
    # here. Check the date rather than trust its absence.
    expires = session.get("expires_at")
    if expires is not None:
        # Mongo hands back naive datetimes in UTC; comparing one to an aware
        # now() raises rather than returning False.
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < now():
            await db.sessions_col.delete_one({"_id": token})
            return None

    oid = to_object_id(session["user_id"])
    return await db.users_col.find_one({"_id": oid}) if oid else None


# --- Dependencies -----------------------------------------------------------


async def optional_user(request: Request) -> User | None:
    doc = await user_doc_for_request(request)
    return _user_from_doc(doc) if doc else None


async def require_user(request: Request) -> User:
    """Every library route depends on this. A 401 with a plain sentence is what
    the frontend watches for to bounce back to the login screen."""
    doc = await user_doc_for_request(request)
    if not doc:
        raise errors.AppError(errors.NOT_SIGNED_IN, 401)
    return _user_from_doc(doc)


async def require_admin(request: Request) -> User:
    """The admin routes. Anyone else gets the same 404 an unknown path would —
    the way someone else's song is a 404, not a 403: there's nothing here for
    them, including the fact that it exists."""
    user = await require_user(request)
    if not user.is_admin:
        raise errors.AppError(errors.NOT_FOUND, 404)
    return user


CurrentUser = Annotated[User, Depends(require_user)]
AdminUser = Annotated[User, Depends(require_admin)]
MaybeUser = Annotated[User | None, Depends(optional_user)]
