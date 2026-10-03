"""Publicly shared playlists — per docs/API.md section 3a.

Everywhere else in this app a row that isn't yours is a 404 (see the note in
routers/songs.py). This module is the one deliberate exception, and it is narrow
on purpose: a playlist its owner has marked `is_public` can be listed, opened
and played by anyone at all — no session required. This is the app's front page,
and a landing page that shows a stranger nothing is not a landing page.

Public here means public: the names, covers and audio of a shared playlist, and
its owner's display name and picture, are served to unauthenticated requests.
The owner's email address is not — see `owner_to_dict`, which exists to keep it
out. Nothing here writes to the owner's library either: no rename, no reorder,
not even a play count, because a stranger listening is not their listening
history. Copying is the one route that still needs a session, because a copy has
to land in a library and an anonymous visitor hasn't got one.

The exception is scoped to *membership of a public playlist*, never to a user
and never to a song id on its own: every request re-asks "is this song in some
public playlist right now?", so un-sharing a playlist takes its audio back out
of reach on the very next request.
"""

from fastapi import APIRouter, Request
from pymongo.errors import DuplicateKeyError

from backend import db, errors
from backend.auth import CurrentUser, MaybeUser
from backend.models import CopyPlaylistRequest
from backend.serializers import now, owner_to_dict, playlist_to_dict, shared_song_to_dict
from backend.storage import to_object_id
from backend.streaming import file_stem, stream_audio

router = APIRouter(tags=["shared"], prefix="/shared")

# The Shared page is a browse page, not an archive. A cap keeps one prolific
# account from making it unusable for everyone else.
LIST_LIMIT = 200


async def _owners_for(playlists: list[dict]) -> dict[str, dict]:
    """One query for every owner on the page, rather than one per playlist."""
    ids = {p.get("user_id") for p in playlists if p.get("user_id")}
    oids = [o for o in (to_object_id(i) for i in ids) if o is not None]
    if not oids:
        return {}
    return {str(doc["_id"]): doc async for doc in db.users_col.find({"_id": {"$in": oids}})}


async def _owner(user_id: str | None) -> dict | None:
    oid = to_object_id(user_id) if user_id else None
    return await db.users_col.find_one({"_id": oid}) if oid else None


async def _songs_for(song_ids: list[str], user_id: str) -> list[dict]:
    """The owner's songs, by id. Scoped to the owner rather than trusting the
    array: a playlist holds ids, and only its owner's songs belong in it."""
    if not song_ids:
        return []
    oids = [o for o in (to_object_id(sid) for sid in song_ids) if o is not None]
    if not oids:
        return []
    return [d async for d in db.songs_col.find({"_id": {"$in": oids}, "user_id": user_id})]


async def _public_playlist_or_404(playlist_id: str) -> dict:
    oid = to_object_id(playlist_id)
    doc = await db.playlists_col.find_one({"_id": oid, "is_public": True}) if oid else None
    if not doc:
        raise errors.AppError(errors.NOT_SHARED, 404)
    return doc


def _shared_playlist_dict(
    doc: dict, songs: list[dict], owner: dict | None, me: str | None
) -> dict:
    out = playlist_to_dict(doc, songs)
    out["owner"] = owner_to_dict(owner)
    # The page says "Shared by you" rather than your own name — reading your own
    # name back off a list you are looking at is a small oddity every time.
    # Never true for a signed-out visitor, who owns nothing here.
    out["mine"] = bool(me) and doc.get("user_id") == me
    return out


@router.get("/playlists")
async def list_shared(user: MaybeUser):
    """Every public playlist, most recently shared first.

    The app's home page, so it answers without a session. A signed-in caller's
    own playlists are included and flagged `mine`, which is how they see what
    they have shared.
    """
    playlists = [
        p
        async for p in db.playlists_col.find({"is_public": True})
        .sort([("shared_at", -1), ("_id", -1)])
        .limit(LIST_LIMIT)
    ]

    # Cover and total duration are derived from the member songs, so the card
    # needs them — projected down to the two fields it actually renders, since
    # this is every public playlist rather than one person's shelf.
    all_ids: set[str] = set()
    for p in playlists:
        all_ids.update(p.get("song_ids") or [])
    oids = [o for o in (to_object_id(i) for i in all_ids) if o is not None]
    songs = (
        [d async for d in db.songs_col.find({"_id": {"$in": oids}}, {"thumbnail": 1, "duration": 1})]
        if oids
        else []
    )

    owners = await _owners_for(playlists)
    return {
        "playlists": [
            _shared_playlist_dict(
                p, songs, owners.get(p.get("user_id")), user.id if user else None
            )
            for p in playlists
        ]
    }


@router.get("/playlists/{playlist_id}")
async def get_shared(playlist_id: str, user: MaybeUser):
    doc = await _public_playlist_or_404(playlist_id)
    owner_id = doc.get("user_id") or ""
    songs = await _songs_for(doc.get("song_ids") or [], owner_id)

    by_id = {str(s["_id"]): s for s in songs}
    ordered = [by_id[sid] for sid in doc.get("song_ids") or [] if sid in by_id]

    return {
        "playlist": _shared_playlist_dict(
            doc, songs, await _owner(owner_id), user.id if user else None
        ),
        "songs": [shared_song_to_dict(s) for s in ordered],
    }


@router.get("/songs/{song_id}/audio")
async def shared_audio(song_id: str, request: Request, user: MaybeUser, dl: str | None = None):
    """Stream a song because it sits in a public playlist, not because the
    caller owns it. Membership is re-checked on every request, so the moment the
    owner un-shares, this stops answering."""
    oid = to_object_id(song_id)
    song = await db.songs_col.find_one({"_id": oid}) if oid else None
    if not song:
        raise errors.AppError(errors.MISSING_SHARED_SONG, 404)

    holder = await db.playlists_col.find_one(
        {"is_public": True, "song_ids": song_id, "user_id": song.get("user_id")},
        {"_id": 1},
    )
    if not holder:
        raise errors.AppError(errors.MISSING_SHARED_SONG, 404)

    total = song.get("size") or 0
    filename = f"{file_stem(song)}.mp3"
    return await stream_audio(
        request, db.storage, song["gridfs_id"], total, filename, download=(dl == "1")
    )


# --- Taking a copy ----------------------------------------------------------


async def _unique_name(name: str, user_id: str) -> str:
    """Playlist names are unique per user, and the copier may well already have
    a "Gym" of their own — so the copy is "Gym (copy)", then "Gym (copy 2)"."""
    if not await db.playlists_col.find_one({"user_id": user_id, "name": name}):
        return name
    base = f"{name} (copy)"
    if not await db.playlists_col.find_one({"user_id": user_id, "name": base}):
        return base
    for n in range(2, 100):
        candidate = f"{name} (copy {n})"
        if not await db.playlists_col.find_one({"user_id": user_id, "name": candidate}):
            return candidate
    # 99 copies of one playlist is not a real case; a name that still collides
    # would 409 out of insert_one, which is a fair answer at that point.
    return f"{name} (copy {now().strftime('%H%M%S')})"


async def _existing_copy(song: dict, user_id: str) -> dict | None:
    """Has this person already got this song? Three ways to be the same song.

    The GridFS file is checked first and matches regardless of provenance — it
    is the same audio by definition, and catches a copy of a copy. The other two
    are the library's own duplicate rules (see routers/songs.py): a reel is its
    URL, an upload is its filename and size.
    """
    if song.get("gridfs_id") is not None:
        hit = await db.songs_col.find_one({"user_id": user_id, "gridfs_id": song["gridfs_id"]})
        if hit:
            return hit
    if song.get("instagram_url"):
        hit = await db.songs_col.find_one(
            {"user_id": user_id, "instagram_url": song["instagram_url"]}
        )
        if hit:
            return hit
    if song.get("source") == "upload" and song.get("source_file"):
        return await db.songs_col.find_one(
            {
                "user_id": user_id,
                "source": "upload",
                "source_file": song["source_file"],
                "size": song.get("size"),
            }
        )
    return None


# Everything a copied song does NOT inherit: identity, ownership, and the
# owner's listening history. Timestamps are reset because the copy entered this
# library today, whatever age the original is.
_NOT_COPIED = {"_id", "user_id", "play_count", "last_played_at", "created_at", "updated_at"}


async def _copy_song(song: dict, user_id: str) -> str:
    """Give `user_id` their own song document for `song`, and return its id.

    The GridFS file is *shared*, not duplicated — the bytes are identical and
    can run to several MB. routers/songs.py only deletes a file once no song
    document refers to it any more, which is what makes that safe.
    """
    existing = await _existing_copy(song, user_id)
    if existing:
        return str(existing["_id"])

    ts = now()
    doc = {k: v for k, v in song.items() if k not in _NOT_COPIED}
    doc.update({"user_id": user_id, "play_count": 0, "created_at": ts, "updated_at": ts})
    # A song saved from an upload carries no instagram_url at all; carrying a
    # null across would put the copy back into the partial unique index (see
    # db.py) and collide with the next upload.
    if not doc.get("instagram_url"):
        doc.pop("instagram_url", None)

    try:
        result = await db.songs_col.insert_one(doc)
    except DuplicateKeyError:
        # Lost a race with another copy of the same reel — the winner's document
        # is exactly what this one would have been.
        hit = await _existing_copy(song, user_id)
        if hit:
            return str(hit["_id"])
        raise
    return str(result.inserted_id)


@router.post("/playlists/{playlist_id}/copy", status_code=201)
async def copy_shared(playlist_id: str, body: CopyPlaylistRequest, user: CurrentUser):
    """Copy a shared playlist into the caller's own library.

    Songs they already have are reused rather than duplicated, so copying a
    playlist that overlaps with yours doesn't leave two of everything — hence
    `added` and `already_had` in the response, which is what the page reports.
    """
    doc = await _public_playlist_or_404(playlist_id)
    owner_id = doc.get("user_id") or ""
    if owner_id == user.id:
        raise errors.AppError("That playlist is already yours.", 400)

    songs = await _songs_for(doc.get("song_ids") or [], owner_id)
    by_id = {str(s["_id"]): s for s in songs}
    ordered = [by_id[sid] for sid in doc.get("song_ids") or [] if sid in by_id]

    added = 0
    already_had = 0
    song_ids: list[str] = []
    for song in ordered:
        if await _existing_copy(song, user.id):
            already_had += 1
        else:
            added += 1
        new_id = await _copy_song(song, user.id)
        if new_id not in song_ids:
            song_ids.append(new_id)

    name = (body.name or "").strip() or doc.get("name") or "Shared playlist"
    ts = now()
    new_doc = {
        "user_id": user.id,
        "name": await _unique_name(name, user.id),
        "description": doc.get("description") or "",
        "loop": doc.get("loop") or "off",
        "song_ids": song_ids,
        # A copy is private until its new owner decides otherwise. Inheriting
        # `is_public` would re-share someone's library on their behalf.
        "is_public": False,
        "created_at": ts,
        "updated_at": ts,
    }
    try:
        result = await db.playlists_col.insert_one(new_doc)
    except DuplicateKeyError:
        raise errors.AppError(errors.duplicate_playlist_name(new_doc["name"]), 409)
    new_doc["_id"] = result.inserted_id

    copied_songs = await _songs_for(song_ids, user.id)
    return {
        "playlist": playlist_to_dict(new_doc, copied_songs),
        "added": added,
        "already_had": already_had,
    }
