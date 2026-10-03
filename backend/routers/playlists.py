"""Playlists — full CRUD, membership and ordering per docs/API.md section 3.

Playlists are per-user, and so is the name uniqueness rule: two people may each
have a "Gym". A playlist id that isn't the caller's reads as one that no longer
exists, and only the caller's own songs can be filed into it.
"""

from fastapi import APIRouter
from pymongo.errors import DuplicateKeyError

from backend import db, errors
from backend.auth import CurrentUser
from backend.models import AddSongsRequest, CreatePlaylistRequest, OrderRequest, PlaylistPatchRequest
from backend.serializers import now, playlist_to_dict, song_to_dict
from backend.storage import to_object_id

router = APIRouter(tags=["playlists"])


async def _get_playlist_or_404(playlist_id: str, user_id: str) -> dict:
    oid = to_object_id(playlist_id)
    doc = await db.playlists_col.find_one({"_id": oid, "user_id": user_id}) if oid else None
    if not doc:
        raise errors.AppError(errors.MISSING_PLAYLIST, 404)
    return doc


async def _songs_for(song_ids: list[str], user_id: str) -> list[dict]:
    if not song_ids:
        return []
    oids = [to_object_id(sid) for sid in song_ids]
    oids = [o for o in oids if o is not None]
    docs = [d async for d in db.songs_col.find({"_id": {"$in": oids}, "user_id": user_id})]
    return docs


@router.get("/playlists")
async def list_playlists(user: CurrentUser):
    playlists = [p async for p in db.playlists_col.find({"user_id": user.id})]

    all_ids: set[str] = set()
    for p in playlists:
        all_ids.update(p.get("song_ids") or [])
    songs = await _songs_for(list(all_ids), user.id)

    return {"playlists": [playlist_to_dict(p, songs) for p in playlists]}


@router.post("/playlists", status_code=201)
async def create_playlist(body: CreatePlaylistRequest, user: CurrentUser):
    name = (body.name or "").strip()
    if not name:
        raise errors.AppError("Give the playlist a name.", 400)

    existing = await db.playlists_col.find_one({"name": name, "user_id": user.id})
    if existing:
        raise errors.AppError(errors.duplicate_playlist_name(name), 409)

    ts = now()
    doc = {
        "user_id": user.id,
        "name": name,
        "description": body.description or "",
        "loop": "off",
        "song_ids": [],
        "created_at": ts,
        "updated_at": ts,
    }
    try:
        result = await db.playlists_col.insert_one(doc)
    except DuplicateKeyError:
        raise errors.AppError(errors.duplicate_playlist_name(name), 409)
    doc["_id"] = result.inserted_id

    return playlist_to_dict(doc, [])


@router.get("/playlists/{playlist_id}")
async def get_playlist(playlist_id: str, user: CurrentUser):
    doc = await _get_playlist_or_404(playlist_id, user.id)
    songs = await _songs_for(doc.get("song_ids") or [], user.id)
    by_id = {str(s["_id"]): s for s in songs}
    ordered = [by_id[sid] for sid in doc.get("song_ids") or [] if sid in by_id]

    song_dicts = []
    for s in ordered:
        pl_ids = [
            str(p["_id"])
            async for p in db.playlists_col.find(
                {"song_ids": str(s["_id"]), "user_id": user.id}, {"_id": 1}
            )
        ]
        song_dicts.append(song_to_dict(s, pl_ids))

    return {"playlist": playlist_to_dict(doc, songs), "songs": song_dicts}


@router.patch("/playlists/{playlist_id}")
async def patch_playlist(playlist_id: str, body: PlaylistPatchRequest, user: CurrentUser):
    doc = await _get_playlist_or_404(playlist_id, user.id)

    updates = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise errors.AppError("Give the playlist a name.", 400)
        if name != doc.get("name"):
            clash = await db.playlists_col.find_one(
                {"name": name, "user_id": user.id, "_id": {"$ne": doc["_id"]}}
            )
            if clash:
                raise errors.AppError(errors.duplicate_playlist_name(name), 409)
        updates["name"] = name
    if body.description is not None:
        updates["description"] = body.description
    if body.loop is not None:
        updates["loop"] = body.loop
    if body.is_public is not None and body.is_public != bool(doc.get("is_public", False)):
        updates["is_public"] = body.is_public
        # Stamped on the way in, cleared on the way out: "shared 2 days ago"
        # must not survive un-sharing and reappear if it is shared again later.
        updates["shared_at"] = now() if body.is_public else None

    if updates:
        updates["updated_at"] = now()
        await db.playlists_col.update_one({"_id": doc["_id"]}, {"$set": updates})
        doc.update(updates)

    songs = await _songs_for(doc.get("song_ids") or [], user.id)
    return playlist_to_dict(doc, songs)


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str, user: CurrentUser):
    doc = await _get_playlist_or_404(playlist_id, user.id)
    await db.playlists_col.delete_one({"_id": doc["_id"]})
    return {"deleted": True}


@router.post("/playlists/{playlist_id}/songs")
async def add_songs(playlist_id: str, body: AddSongsRequest, user: CurrentUser):
    doc = await _get_playlist_or_404(playlist_id, user.id)

    incoming: list[str] = []
    if body.song_id:
        incoming.append(body.song_id)
    if body.song_ids:
        incoming.extend(body.song_ids)
    if not incoming:
        raise errors.AppError("Nothing to add.", 400)

    # Only real, existing songs of this user's get filed in.
    valid_docs = await _songs_for(incoming, user.id)
    valid_ids = {str(d["_id"]) for d in valid_docs}

    song_ids = list(doc.get("song_ids") or [])
    for sid in incoming:
        if sid in valid_ids and sid not in song_ids:
            song_ids.append(sid)

    await db.playlists_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"song_ids": song_ids, "updated_at": now()}}
    )
    doc["song_ids"] = song_ids

    songs = await _songs_for(song_ids, user.id)
    return playlist_to_dict(doc, songs)


@router.delete("/playlists/{playlist_id}/songs/{song_id}")
async def remove_song(playlist_id: str, song_id: str, user: CurrentUser):
    doc = await _get_playlist_or_404(playlist_id, user.id)

    song_ids = [sid for sid in (doc.get("song_ids") or []) if sid != song_id]
    await db.playlists_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"song_ids": song_ids, "updated_at": now()}}
    )
    doc["song_ids"] = song_ids

    songs = await _songs_for(song_ids, user.id)
    return playlist_to_dict(doc, songs)


@router.patch("/playlists/{playlist_id}/order")
async def reorder(playlist_id: str, body: OrderRequest, user: CurrentUser):
    doc = await _get_playlist_or_404(playlist_id, user.id)

    current = set(doc.get("song_ids") or [])
    incoming = body.song_ids or []
    if set(incoming) != current or len(incoming) != len(current):
        raise errors.AppError(
            "That reorder doesn't match the playlist's current songs.", 400
        )

    await db.playlists_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"song_ids": incoming, "updated_at": now()}}
    )
    doc["song_ids"] = incoming

    songs = await _songs_for(incoming, user.id)
    return playlist_to_dict(doc, songs)
