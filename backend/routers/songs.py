"""Songs (the library / "All Songs") — full CRUD per docs/API.md section 2.

Two things can become a song: a reel extraction (a token) and an identified
upload (a job). They differ only in where the audio and the metadata came from,
so they converge on one document shape with a `source` field saying which — and
after that the library, the player and playlists treat them identically.
"""

import asyncio
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend import db, errors, search
from backend.models import SaveSongRequest, SongPatchRequest
from backend.serializers import now, song_to_dict
from backend.services import extractor, ident_jobs
from backend.services import identify as identify_service
from backend.storage import to_object_id
from backend.streaming import stream_audio

router = APIRouter(tags=["songs"])


async def _playlist_ids_for(song_id: str) -> list[str]:
    ids = []
    async for p in db.playlists_col.find({"song_ids": song_id}, {"_id": 1}):
        ids.append(str(p["_id"]))
    return ids


async def _playlist_ids_map(song_ids: list[str]) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {sid: [] for sid in song_ids}
    async for p in db.playlists_col.find({"song_ids": {"$in": song_ids}}, {"_id": 1, "song_ids": 1}):
        pid = str(p["_id"])
        for sid in p.get("song_ids") or []:
            if sid in mapping:
                mapping[sid].append(pid)
    return mapping


async def _get_song_or_404(song_id: str) -> dict:
    oid = to_object_id(song_id)
    doc = await db.songs_col.find_one({"_id": oid}) if oid else None
    if not doc:
        raise errors.AppError(errors.MISSING_SONG, 404)
    return doc


async def _attach_to_playlist(song_id: str, playlist_id: str | None) -> list[str]:
    """Best-effort: a playlist that has since been deleted isn't worth failing a
    save over — the song is already in the library and can be filed by hand."""
    if not playlist_id:
        return []
    oid = to_object_id(playlist_id)
    playlist = await db.playlists_col.find_one({"_id": oid}) if oid else None
    if not playlist:
        return []
    if song_id not in (playlist.get("song_ids") or []):
        await db.playlists_col.update_one(
            {"_id": oid}, {"$push": {"song_ids": song_id}, "$set": {"updated_at": now()}}
        )
    return [str(oid)]


@router.post("/songs", status_code=201)
async def create_song(body: SaveSongRequest):
    if body.job:
        return await _save_upload(body.job, body.playlist_id)
    if not body.token:
        raise errors.AppError("Nothing to save — extract a reel or identify a file first.", 400)

    job = extractor.get_token(body.token)
    if not job:
        raise errors.AppError(errors.MISSING_TOKEN, 404)

    existing = await db.songs_col.find_one({"instagram_url": job["url"]})
    if existing:
        playlist_ids = await _playlist_ids_for(str(existing["_id"]))
        return JSONResponse(
            status_code=409,
            content={"error": errors.DUPLICATE_SONG, "song": song_to_dict(existing, playlist_ids)},
        )

    meta = job["meta"]
    match = job.get("match")
    if match and match.get("identified"):
        song_meta = match["song"]
        track = song_meta.get("track")
        artist = song_meta.get("artist")
        identified = True
        identify_source = song_meta.get("source")
        confidence = song_meta.get("confidence")
        youtube = match.get("results") or []
        thumbnail = meta.get("thumbnail") or song_meta.get("cover")
    else:
        track = meta.get("track")
        artist = meta.get("artist")
        identified = False
        identify_source = None
        confidence = None
        youtube = []
        thumbnail = meta.get("thumbnail")

    file_id = await db.storage.put_file(job["path"], meta["filename"])
    ts = now()
    doc = {
        "title": meta["title"],
        "track": track,
        "artist": artist,
        "uploader": meta.get("uploader"),
        "instagram_url": job["url"],
        "source": "instagram",
        "thumbnail": thumbnail,
        "duration": meta.get("duration"),
        "size": meta.get("size"),
        "identified": identified,
        "identify_source": identify_source,
        "confidence": confidence,
        "youtube": youtube,
        "gridfs_id": file_id,
        "play_count": 0,
        "last_played_at": None,
        "created_at": ts,
        "updated_at": ts,
    }

    try:
        result = await db.songs_col.insert_one(doc)
    except Exception:
        await db.storage.delete_file(file_id)
        # A racing duplicate insert (unique index on instagram_url) — treat like the
        # normal dedup path instead of surfacing a raw Mongo error.
        existing = await db.songs_col.find_one({"instagram_url": job["url"]})
        if existing:
            playlist_ids = await _playlist_ids_for(str(existing["_id"]))
            return JSONResponse(
                status_code=409,
                content={
                    "error": errors.DUPLICATE_SONG,
                    "song": song_to_dict(existing, playlist_ids),
                },
            )
        raise
    doc["_id"] = result.inserted_id

    playlist_ids = await _attach_to_playlist(str(doc["_id"]), body.playlist_id)

    # The song is safely in GridFS + Mongo now — the temp file/token can go.
    extractor.discard(body.token)

    return song_to_dict(doc, playlist_ids)


async def _save_upload(job_id: str, playlist_id: str | None):
    """Persist an identified upload. The audio is whatever the user sent; the
    metadata is whatever the tiers managed to work out, which may be nothing —
    an unidentified file is still a song worth keeping, same as a reel that
    didn't match."""
    job = ident_jobs.get(job_id)
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
        {"source": "upload", "source_file": filename, "size": size}
    )
    if existing:
        playlist_ids = await _playlist_ids_for(str(existing["_id"]))
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

    playlist_ids = await _attach_to_playlist(str(doc["_id"]), playlist_id)

    # Safely in GridFS now — the uploaded temp file can go, like a spent token.
    ident_jobs.discard(job_id)

    return song_to_dict(doc, playlist_ids)


@router.get("/songs")
async def list_songs(q: str = "", sort: str = "recent", limit: int = 0, skip: int = 0):
    sort_map = {
        "recent": [("created_at", -1)],
        "title": [("title", 1)],
        "artist": [("artist", 1)],
        "plays": [("play_count", -1)],
    }
    sort_spec = sort_map.get(sort, sort_map["recent"])
    term = q.strip()

    if not term:
        total = await db.songs_col.count_documents({})
        cursor = db.songs_col.find({}).sort(sort_spec)
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        docs = [d async for d in cursor]
    else:
        # Correct spelling is the common case, so try the cheap indexed-ish regex
        # first and only pay for a scan when it finds nothing.
        docs = [d async for d in db.songs_col.find(search.mongo_prefilter(term))]
        if not docs:
            docs = [d async for d in db.songs_col.find({}).limit(search.SCAN_CAP)]

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
    id_map = await _playlist_ids_map([str(d["_id"]) for d in docs])
    songs = [song_to_dict(d, id_map.get(str(d["_id"]), [])) for d in docs]
    return {"songs": songs, "total": total}


@router.get("/songs/{song_id}")
async def get_song(song_id: str):
    doc = await _get_song_or_404(song_id)
    playlist_ids = await _playlist_ids_for(song_id)
    return song_to_dict(doc, playlist_ids)


@router.patch("/songs/{song_id}")
async def patch_song(song_id: str, body: SongPatchRequest):
    doc = await _get_song_or_404(song_id)

    updates = {}
    for field in ("title", "track", "artist"):
        value = getattr(body, field)
        if value is not None:
            updates[field] = value
    if updates:
        updates["updated_at"] = now()
        await db.songs_col.update_one({"_id": doc["_id"]}, {"$set": updates})
        doc.update(updates)

    playlist_ids = await _playlist_ids_for(song_id)
    return song_to_dict(doc, playlist_ids)


@router.delete("/songs/{song_id}")
async def delete_song(song_id: str):
    doc = await _get_song_or_404(song_id)

    if doc.get("gridfs_id"):
        await db.storage.delete_file(doc["gridfs_id"])
    await db.songs_col.delete_one({"_id": doc["_id"]})
    await db.playlists_col.update_many(
        {"song_ids": song_id}, {"$pull": {"song_ids": song_id}, "$set": {"updated_at": now()}}
    )

    return {"deleted": True}


@router.get("/songs/{song_id}/audio")
async def song_audio(song_id: str, request: Request, dl: str | None = None):
    doc = await _get_song_or_404(song_id)
    total = doc.get("size") or 0
    filename = f"{doc.get('title') or 'audio'}.mp3"
    return await stream_audio(
        request, db.storage, doc["gridfs_id"], total, filename, download=(dl == "1")
    )


@router.post("/songs/{song_id}/played")
async def song_played(song_id: str):
    doc = await _get_song_or_404(song_id)
    await db.songs_col.update_one(
        {"_id": doc["_id"]},
        {"$inc": {"play_count": 1}, "$set": {"last_played_at": now()}},
    )
    updated = await db.songs_col.find_one({"_id": doc["_id"]}, {"play_count": 1})
    return {"play_count": updated.get("play_count", 0)}


@router.post("/songs/{song_id}/youtube/refresh")
async def refresh_youtube(song_id: str):
    doc = await _get_song_or_404(song_id)

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
        playlist_ids = await _playlist_ids_for(song_id)
        return song_to_dict(doc, playlist_ids)

    await db.songs_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"youtube": results, "updated_at": now()}}
    )
    doc["youtube"] = results
    playlist_ids = await _playlist_ids_for(song_id)
    return song_to_dict(doc, playlist_ids)
