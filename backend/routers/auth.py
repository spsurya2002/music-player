"""Sign in, sign out, and who am I — per docs/API.md section 0.

The heavy lifting (verifying Google's ID token, upserting the user, issuing and
revoking sessions) is in backend/auth.py. This module is only the endpoints.
"""

from fastapi import APIRouter, Request, Response

from backend import auth, db
from backend.auth import user_doc_for_request
from backend.config import GOOGLE_CLIENT_ID
from backend.models import GoogleSignInRequest
from backend.services import quota

router = APIRouter(tags=["auth"], prefix="/auth")


@router.get("/config")
async def auth_config():
    """What the login screen needs to render Google's button. Public by
    definition — a client ID is not a secret, and the page can't sign anyone in
    without it."""
    return {"google_client_id": GOOGLE_CLIENT_ID or None, "configured": bool(GOOGLE_CLIENT_ID)}


@router.post("/google")
async def sign_in_with_google(body: GoogleSignInRequest, request: Request, response: Response):
    claims = await auth.verify_google_credential(body.credential or "")
    user = await auth.upsert_user(claims)
    await auth.start_session(user, request, response)
    return {
        "user": auth.user_to_dict(user),
        "stats": await _stats(str(user["_id"])),
        "quota": quota.summary(user),
    }


@router.get("/me")
async def me(request: Request):
    """The one call the app makes before rendering anything. 200 with a null
    user rather than a 401, because "nobody is signed in yet" is the normal
    first state of the app, not a failure worth logging."""
    doc = await user_doc_for_request(request)
    if not doc:
        return {"user": None}
    return {
        "user": auth.user_to_dict(doc),
        "stats": await _stats(str(doc["_id"])),
        "quota": quota.summary(doc),
    }


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Deletes the session row and the cookie. Safe to call with no session —
    signing out twice is not an error worth a message."""
    await auth.end_session(request, response)
    return {"signed_out": True}


async def _stats(user_id: str) -> dict:
    """The numbers the account card shows: how big this library has got, and
    how much has actually been listened to."""
    songs = await db.songs_col.count_documents({"user_id": user_id})
    playlists = await db.playlists_col.count_documents({"user_id": user_id})
    plays = 0
    pipeline = [
        {"$match": {"user_id": user_id}},
        {"$group": {"_id": None, "plays": {"$sum": "$play_count"}}},
    ]
    async for row in db.songs_col.aggregate(pipeline):
        plays = int(row.get("plays") or 0)
    return {"songs": songs, "playlists": playlists, "plays": plays}
