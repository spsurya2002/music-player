"""Turn Mongo documents into the exact JSON shapes docs/API.md promises."""

from datetime import datetime, timezone


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now() -> datetime:
    return datetime.now(timezone.utc)


def song_to_dict(doc: dict, playlist_ids: list[str] | None = None) -> dict:
    sid = str(doc["_id"])
    return {
        "id": sid,
        "title": doc.get("title"),
        "track": doc.get("track"),
        "artist": doc.get("artist"),
        "uploader": doc.get("uploader"),
        "instagram_url": doc.get("instagram_url"),
        # Songs saved before uploads existed carry no source field and are all
        # reels, so the absent case reads as "instagram" rather than unknown.
        "source": doc.get("source") or "instagram",
        "source_file": doc.get("source_file"),
        "thumbnail": doc.get("thumbnail"),
        # yt-dlp reports float seconds; the contract says int, and a float renders
        # as "0:50.666" in the player.
        "duration": int(doc["duration"]) if doc.get("duration") is not None else None,
        "size": doc.get("size"),
        "identified": bool(doc.get("identified", False)),
        "identify_source": doc.get("identify_source"),
        "confidence": doc.get("confidence"),
        "youtube": doc.get("youtube") or [],
        "audio_url": f"/api/songs/{sid}/audio",
        "storage": "gridfs",
        "play_count": doc.get("play_count", 0),
        "last_played_at": iso(doc.get("last_played_at")),
        "created_at": iso(doc.get("created_at")),
        "updated_at": iso(doc.get("updated_at")),
        "playlist_ids": playlist_ids if playlist_ids is not None else [],
    }


def playlist_to_dict(doc: dict, songs_for_derived: list[dict] | None = None) -> dict:
    song_ids = doc.get("song_ids") or []
    songs_for_derived = songs_for_derived or []
    by_id = {str(s["_id"]): s for s in songs_for_derived}
    ordered = [by_id[sid] for sid in song_ids if sid in by_id]

    duration = int(sum((s.get("duration") or 0) for s in ordered))
    cover = ordered[0].get("thumbnail") if ordered else None

    return {
        "id": str(doc["_id"]),
        "name": doc.get("name"),
        "description": doc.get("description", ""),
        "loop": doc.get("loop", "off"),
        "song_ids": song_ids,
        "song_count": len(song_ids),
        "duration": duration,
        "cover": cover,
        "created_at": iso(doc.get("created_at")),
        "updated_at": iso(doc.get("updated_at")),
    }
