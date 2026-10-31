"""Songs (the library / "All Songs") — full CRUD per docs/API.md section 2.

Two things can become a song: a reel extraction (a token) and an identified
upload (a job). They differ only in where the audio and the metadata came from,
so they converge on one document shape with a `source` field saying which — and
after that the library, the player and playlists treat them identically.

Every route here takes a CurrentUser and scopes to `user.id`: a library is one
person's. That includes the reads that look harmless — a song fetched by id
still has to belong to the caller, or an id from someone else's URL would stream
their audio. A song that isn't theirs reads as one that isn't there.
"""

import asyncio
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend import db, errors, search
from backend.auth import CurrentUser
from backend.models import SaveSongRequest, SongPatchRequest
from backend.serializers import now, song_to_dict
from backend.services import ident_jobs, lyrics_jobs, pipeline
from backend.services import identify as identify_service
from backend.storage import to_object_id
from backend.streaming import file_stem, stream_audio

router = APIRouter(tags=["songs"])


async def _playlist_ids_map(song_ids: list[str], user_id: str) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {sid: [] for sid in song_ids}
    cursor = db.playlists_col.find(
        {"song_ids": {"$in": song_ids}, "user_id": user_id}, {"_id": 1, "song_ids": 1}
    )
    async for p in cursor:
        pid = str(p["_id"])
        for sid in p.get("song_ids") or []:
            if sid in mapping:
                mapping[sid].append(pid)
    return mapping


async def _get_song_or_404(song_id: str, user_id: str) -> dict:
    oid = to_object_id(song_id)
    doc = await db.songs_col.find_one({"_id": oid, "user_id": user_id}) if oid else None
    if not doc:
        raise errors.AppError(errors.MISSING_SONG, 404)
    return doc


@router.post("/songs", status_code=201)
async def create_song(body: SaveSongRequest, user: CurrentUser):
    if body.job:
        return await _save_upload(body.job, body.playlist_id, user)
    if not body.token:
        raise errors.AppError("Nothing to save — extract a reel or identify a file first.", 400)

    # A token belongs to whoever extracted it. Someone else's reads as expired
    # rather than as forbidden — there is nothing to tell them about it.
    saved = await pipeline.save_token(body.token, user.id, body.playlist_id)
    if saved.duplicate:
        duplicate = {
            "youtube": "That YouTube video is already in your library.",
            "spotify": "That Spotify track is already in your library.",
        }.get(saved.song.get("source"), errors.DUPLICATE_SONG)
        return JSONResponse(
            status_code=409, content={"error": duplicate, "song": saved.song}
        )
    return saved.song


async def _save_upload(job_id: str, playlist_id: str | None, user: CurrentUser):
    """Persist an identified upload. The audio is whatever the user sent; the
    metadata is whatever the tiers managed to work out, which may be nothing —
    an unidentified file is still a song worth keeping, same as a reel that
    didn't match."""
    job = ident_jobs.get(job_id, user.id)
    if not job:
        raise errors.AppError(errors.MISSING_JOB, 404)
    if job["state"] == "running":
        raise errors.AppError("Still working out what that song is — give it a moment.", 409)

    path = Path(job["path"])
    if not path.exists():
        raise errors.AppError(errors.MISSING_JOB, 404)

    filename = job["file"]
    size = path.stat().st_size

    # No reel URL to key on, so the closest thing to "the same file again" is
    # the same name at the same size.
    existing = await db.songs_col.find_one(
        {"user_id": user.id, "source": "upload", "source_file": filename, "size": size}
    )
    if existing:
        playlist_ids = await pipeline.playlist_ids_for(str(existing["_id"]), user.id)
        return JSONResponse(
            status_code=409,
            content={
                "error": errors.DUPLICATE_UPLOAD,
                "song": song_to_dict(existing, playlist_ids),
            },
        )

    result = job["result"] or {}
    identified_track = result.get("track") or {}
    track = identified_track.get("title")
    artist = identified_track.get("artist")
    # Already ranked and in YouTubeMatch shape, so the song page renders them the
    # same way it renders a reel's matches.
    youtube = result.get("results") or []
    top_title = youtube[0]["title"] if youtube else None

    if track and artist:
        title = f"{artist} - {track}"
    elif track:
        title = track
    elif youtube and not result.get("guess"):
        # The audio led here, so what YouTube calls it is the best name going.
        # A caption guess doesn't earn that — naming the song after a video the
        # guess turned up would launder the guess into a fact.
        title = top_title
    else:
        title = Path(filename).stem

    thumbnail = identified_track.get("cover") or (youtube[0]["thumbnail"] if youtube else None)
    duration = await asyncio.to_thread(ident_jobs.duration_of, path)

    file_id = await db.storage.put_file(path, filename)
    ts = now()
    doc = {
        "user_id": user.id,
        "title": title,
        "track": track,
        "artist": artist,
        "uploader": None,
        # instagram_url is *omitted*, not null: the unique index is partial on
        # string values, and a null would collide with the next upload.
        "source": "upload",
        "source_file": filename,
        "thumbnail": thumbnail,
        "duration": duration,
        "size": size,
        "identified": bool(result.get("query")),
        "identify_source": result.get("source_label"),
        "identify_query": result.get("query"),
        "confidence": result.get("confidence"),
        "youtube": youtube,
        "gridfs_id": file_id,
        "play_count": 0,
        "last_played_at": None,
        "created_at": ts,
        "updated_at": ts,
    }

    try:
        inserted = await db.songs_col.insert_one(doc)
    except Exception:
        await db.storage.delete_file(file_id)
        raise
    doc["_id"] = inserted.inserted_id

    playlist_ids = await pipeline.attach_to_playlist(str(doc["_id"]), playlist_id, user.id)

    # Safely in GridFS now — the uploaded temp file can go, like a spent token.
    ident_jobs.discard(job_id)

    return song_to_dict(doc, playlist_ids)


@router.get("/songs")
async def list_songs(
    user: CurrentUser, q: str = "", sort: str = "recent", limit: int = 0, skip: int = 0
):
    sort_map = {
        "recent": [("created_at", -1)],
        "title": [("title", 1)],
        "artist": [("artist", 1)],
        "plays": [("play_count", -1)],
    }
    sort_spec = sort_map.get(sort, sort_map["recent"])
    term = q.strip()

    mine = {"user_id": user.id}

    if not term:
        total = await db.songs_col.count_documents(mine)
        cursor = db.songs_col.find(mine).sort(sort_spec)
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        docs = [d async for d in cursor]
    else:
        # Correct spelling is the common case, so try the cheap indexed-ish regex
        # first and only pay for a scan when it finds nothing.
        docs = [d async for d in db.songs_col.find({**mine, **search.mongo_prefilter(term)})]
        if not docs:
            # The fuzzy fallback scans, so it stays inside this user's library —
            # both for the obvious reason and because the cap should be spent on
            # songs that could actually match.
            docs = [d async for d in db.songs_col.find(mine).limit(search.SCAN_CAP)]

        docs = search.rank(docs, term)

        # Relevance wins while searching — unless a specific order was asked for,
        # in which case that's the more explicit instruction.
        if sort in ("title", "artist", "plays"):
            key, direction = sort_spec[0]
            docs.sort(key=lambda d: (d.get(key) is None, d.get(key) or ""), reverse=direction < 0)

        total = len(docs)
        if skip:
            docs = docs[skip:]
        if limit:
            docs = docs[:limit]
    id_map = await _playlist_ids_map([str(d["_id"]) for d in docs], user.id)
    songs = [song_to_dict(d, id_map.get(str(d["_id"]), [])) for d in docs]
    return {"songs": songs, "total": total}


@router.get("/songs/{song_id}")
async def get_song(song_id: str, user: CurrentUser):
    doc = await _get_song_or_404(song_id, user.id)
    playlist_ids = await pipeline.playlist_ids_for(song_id, user.id)
    return song_to_dict(doc, playlist_ids)


@router.patch("/songs/{song_id}")
async def patch_song(song_id: str, body: SongPatchRequest, user: CurrentUser):
    doc = await _get_song_or_404(song_id, user.id)

    updates = {}
    for field in ("title", "track", "artist"):
        value = getattr(body, field)
        if value is not None:
            updates[field] = value
    if updates:
        updates["updated_at"] = now()
        await db.songs_col.update_one({"_id": doc["_id"]}, {"$set": updates})
        doc.update(updates)

    playlist_ids = await pipeline.playlist_ids_for(song_id, user.id)
    return song_to_dict(doc, playlist_ids)


@router.delete("/songs/{song_id}")
async def delete_song(song_id: str, user: CurrentUser):
    doc = await _get_song_or_404(song_id, user.id)

    # Copying a shared playlist gives the copy the same GridFS file rather than
    # a second set of identical bytes, so the audio outlives this document
    # whenever somebody else's song still points at it. Deleting unconditionally
    # here would silently empty their library instead of ours.
    gridfs_id = doc.get("gridfs_id")
    if gridfs_id:
        others = await db.songs_col.count_documents(
            {"gridfs_id": gridfs_id, "_id": {"$ne": doc["_id"]}}, limit=1
        )
        if not others:
            await db.storage.delete_file(gridfs_id)
    await db.songs_col.delete_one({"_id": doc["_id"]})
    await db.playlists_col.update_many(
        {"song_ids": song_id, "user_id": user.id},
        {"$pull": {"song_ids": song_id}, "$set": {"updated_at": now()}},
    )
    # The lyrics describe a song that no longer exists, and there is nowhere
    # left to show them.
    await lyrics_jobs.forget_song(user.id, song_id)

    return {"deleted": True}


@router.get("/songs/{song_id}/audio")
async def song_audio(song_id: str, request: Request, user: CurrentUser, dl: str | None = None):
    doc = await _get_song_or_404(song_id, user.id)
    total = doc.get("size") or 0
    filename = f"{file_stem(doc)}.mp3"
    return await stream_audio(
        request, db.storage, doc["gridfs_id"], total, filename, download=(dl == "1")
    )


@router.post("/songs/{song_id}/played")
async def song_played(song_id: str, user: CurrentUser):
    doc = await _get_song_or_404(song_id, user.id)
    await db.songs_col.update_one(
        {"_id": doc["_id"]},
        {"$inc": {"play_count": 1}, "$set": {"last_played_at": now()}},
    )
    updated = await db.songs_col.find_one({"_id": doc["_id"]}, {"play_count": 1})
    return {"play_count": updated.get("play_count", 0)}


@router.post("/songs/{song_id}/youtube/refresh")
async def refresh_youtube(song_id: str, user: CurrentUser):
    doc = await _get_song_or_404(song_id, user.id)

    track = doc.get("track")
    artist = doc.get("artist") or ""
    query = doc.get("identify_query")
    if track:
        results = await asyncio.to_thread(identify_service.find_on_youtube, track, artist)
    elif query:
        # A lyrics or caption match never produced a track name — the words that
        # found it are all there is, so search those the way the search box does.
        results = await asyncio.to_thread(identify_service.search_query, query)
    else:
        # Nothing to search with. Returning an empty list here would delete the
        # links the song already has, which is worse than leaving them alone.
        playlist_ids = await pipeline.playlist_ids_for(song_id, user.id)
        return song_to_dict(doc, playlist_ids)

    await db.songs_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"youtube": results, "updated_at": now()}}
    )
    doc["youtube"] = results
    playlist_ids = await pipeline.playlist_ids_for(song_id, user.id)
    return song_to_dict(doc, playlist_ids)
