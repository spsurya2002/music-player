"""The reel pipeline, with no HTTP around it: match a token, save a token.

Both steps used to live inside the routers, which was fine while a person
clicking buttons was the only thing that drove them. Auto-ingest drives the
same two steps with nobody watching, so they moved here — one implementation,
three callers (routers/extract.py, routers/songs.py, services/ingest.py).

Nothing here raises HTTP concepts beyond errors.AppError, and nothing returns
a Response: `save_token` reports a duplicate as a flag on its result and lets
the caller decide whether that's a 409 or a queue row marked `duplicate`.
"""

import asyncio
from typing import NamedTuple

from backend import db, errors
from backend.config import COOKIES_FILE, INSTA_COOKIES_BROWSER
from backend.serializers import now, song_to_dict
from backend.services import cookies as cookies_service
from backend.services import extractor
from backend.services import identify as identify_service
from backend.storage import to_object_id

NO_MATCH_HINT = (
    "No music sticker on the post, and the audio matched nothing. If someone "
    "is singing or playing the song themselves, fingerprinting can't match it "
    "— it only recognises the original recording. Search for it by name below."
)

COOKIES_HINT = (
    " Setting up cookies would also let the app read Instagram's own music "
    "sticker, which names the song outright (see the README)."
)


class Saved(NamedTuple):
    """`duplicate` means the song was already there — `song` is the one that
    already existed, not something new that was just written."""

    song: dict
    duplicate: bool


async def match_token(token: str, user_id: str) -> dict:
    """Identify the song behind an extraction and find it on YouTube.

    The result is cached against the token (extractor.set_match) so a later
    save persists it without paying for fingerprinting twice.
    """
    job = extractor.get_token(token, user_id)
    if not job:
        raise errors.AppError(errors.MISSING_TOKEN, 404)

    source = job.get("source") or "instagram"
    meta = job.get("meta") or {}
    if source == "spotify" and meta.get("track"):
        # The link already named the song. Fingerprinting the YouTube recording
        # we saved it from can only disagree, and the page should say Spotify.
        song = {
            "track": meta.get("track"),
            "artist": meta.get("artist") or "",
            "source": "Spotify",
            "confidence": "high",
        }
    elif source == "youtube":
        # The video already has a name. Fingerprinting the whole file here
        # holds another request open long enough for the tunnel to drop it,
        # and the page already has the MP3 either way.
        if meta.get("track"):
            song = {
                "track": meta.get("track"),
                "artist": meta.get("artist") or "",
                "source": "YouTube",
                "confidence": "high",
            }
        elif meta.get("title"):
            song = {
                "track": meta.get("title"),
                "artist": meta.get("uploader") or "",
                "source": "YouTube",
                "confidence": "low",
            }
        else:
            song = await asyncio.to_thread(identify_service.from_fingerprint, job["path"])
    else:
        jar = await asyncio.to_thread(cookies_service.cookiejar)
        song = await asyncio.to_thread(
            identify_service.identify, job["info"], job["path"], job.get("url", ""), jar
        )

    if not song or not song.get("track"):
        if source == "instagram":
            hint = NO_MATCH_HINT
            if not COOKIES_FILE.exists() and not INSTA_COOKIES_BROWSER:
                hint += COOKIES_HINT
        else:
            hint = "The audio didn't match a known recording. Search for it by name below."
        result = {"identified": False, "reason": hint}
        extractor.set_match(token, result)
        return result

    if song.get("confidence") == "low":
        results = await asyncio.to_thread(identify_service.search_query, song["track"])
    else:
        results = await asyncio.to_thread(
            identify_service.find_on_youtube, song["track"], song.get("artist", "")
        )

    result = {
        "identified": True,
        "song": {
            "track": song.get("track"),
            "artist": song.get("artist"),
            "source": song.get("source"),
            "confidence": song.get("confidence"),
            "shazam_url": song.get("shazam_url"),
            "cover": song.get("cover"),
        },
        "results": results,
    }
    extractor.set_match(token, result)
    return result


async def playlist_ids_for(song_id: str, user_id: str) -> list[str]:
    return [
        str(p["_id"])
        async for p in db.playlists_col.find({"song_ids": song_id, "user_id": user_id}, {"_id": 1})
    ]


async def _existing(url: str, user_id: str, field: str = "instagram_url") -> Saved | None:
    doc = await db.songs_col.find_one({field: url, "user_id": user_id})
    if not doc:
        return None
    playlist_ids = await playlist_ids_for(str(doc["_id"]), user_id)
    return Saved(song_to_dict(doc, playlist_ids), duplicate=True)


async def attach_to_playlist(song_id: str, playlist_id: str | None, user_id: str) -> list[str]:
    """Best-effort: a playlist that has since been deleted isn't worth failing a
    save over — the song is already in the library and can be filed by hand."""
    if not playlist_id:
        return []
    oid = to_object_id(playlist_id)
    playlist = await db.playlists_col.find_one({"_id": oid, "user_id": user_id}) if oid else None
    if not playlist:
        return []
    if song_id not in (playlist.get("song_ids") or []):
        await db.playlists_col.update_one(
            {"_id": oid}, {"$push": {"song_ids": song_id}, "$set": {"updated_at": now()}}
        )
    return [str(oid)]


async def save_token(token: str, user_id: str, playlist_id: str | None = None) -> Saved:
    """Turn a spent extraction into a row in someone's library.

    The token carries the audio, the post metadata and (if match_token has run)
    the identification — so this is where all three become one document.
    """
    job = extractor.get_token(token, user_id)
    if not job:
        raise errors.AppError(errors.MISSING_TOKEN, 404)

    source = job.get("source") or (job.get("meta") or {}).get("source") or "instagram"
    url_field = "instagram_url" if source == "instagram" else "source_url"
    found = await _existing(job["url"], user_id, url_field)
    if found:
        return found

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
    if not youtube and job.get("origin_youtube"):
        youtube = [job["origin_youtube"]]

    file_id = await db.storage.put_file(job["path"], meta["filename"])
    ts = now()
    doc = {
        "user_id": user_id,
        "title": meta["title"],
        "track": track,
        "artist": artist,
        "uploader": meta.get("uploader"),
        "source": source,
        url_field: job["url"],
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
        # A racing duplicate insert (unique index on user_id + instagram_url) —
        # treat like the normal dedup path instead of surfacing a raw Mongo error.
        found = await _existing(job["url"], user_id, url_field)
        if found:
            return found
        raise
    doc["_id"] = result.inserted_id

    playlist_ids = await attach_to_playlist(str(doc["_id"]), playlist_id, user_id)

    # The song is safely in GridFS + Mongo now — the temp file/token can go.
    extractor.discard(token)

    return Saved(song_to_dict(doc, playlist_ids), duplicate=False)
