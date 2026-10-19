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


def owner_to_dict(doc: dict | None) -> dict | None:
    """Who a shared playlist belongs to — the label under its name, nothing more.

    Deliberately not `user_to_dict`: that shape carries the email address, and a
    public page must not hand every signed-in visitor a list of addresses.
    """
    if not doc:
        return None
    name = doc.get("name") or ""
    return {
        "id": str(doc["_id"]),
        "name": name,
        "given_name": doc.get("given_name") or name.split(" ")[0],
        "picture": doc.get("picture"),
    }


def shared_song_to_dict(doc: dict) -> dict:
    """A song seen inside somebody else's shared playlist.

    The same shape the player already knows, with two differences: the audio
    comes from the shared route (the normal one scopes to the caller's own
    library and would 404), and `shared` marks it read-only so nothing tries to
    rename it, file it into a playlist, or count a play against its owner.
    """
    sid = str(doc["_id"])
    out = song_to_dict(doc)
    out["audio_url"] = f"/api/shared/songs/{sid}/audio"
    out["shared"] = True
    # Membership of the viewer's playlists is the one derived field that can't
    # mean anything here — it would be the owner's playlists, not theirs.
    out["playlist_ids"] = []
    return out


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
        # Sharing is public or nothing: true means anyone signed in can find it
        # on the Shared page, play it and copy it. shared_at is when that was
        # last switched on, which is what the Shared page sorts by.
        "is_public": bool(doc.get("is_public", False)),
        "shared_at": iso(doc.get("shared_at")),
        "created_at": iso(doc.get("created_at")),
        "updated_at": iso(doc.get("updated_at")),
    }


def limit_request_to_dict(doc: dict) -> dict:
    """One "I need more" request, as its sender sees it. The admin view adds a
    `user` beside this (routers/admin.py) — the sender already knows who they are."""
    return {
        "id": str(doc["_id"]),
        "message": doc.get("message") or "",
        "state": doc.get("state"),
        "reply": doc.get("reply") or "",
        "limits_before": doc.get("limits_before"),
        "limits_after": doc.get("limits_after"),
        "created_at": iso(doc.get("created_at")),
        "resolved_at": iso(doc.get("resolved_at")),
        # The back-and-forth while it was open: "any idea how long?" and the
        # answer. Oldest first, which is the order it is read in.
        "notes": [
            {
                "from": n.get("from"),
                "text": n.get("text") or "",
                "at": iso(n.get("at")),
            }
            for n in (doc.get("notes") or [])
        ],
        # Something from the admin they haven't opened the Plan page to read:
        # a decision, or an answer on the thread. Both clear `seen_at` when
        # they happen, so this stays one field rather than two timestamps to
        # compare. `last_admin_at` is absent on rows written before threads
        # existed, hence the state test beside it.
        "unread": (doc.get("state") != "pending" or bool(doc.get("last_admin_at")))
        and doc.get("seen_at") is None,
    }


def _my_lyrics_to_dict(entry: dict) -> dict:
    """One version somebody added themselves. `label` may be empty, which means
    "name it after its script" — the page holds that map, next to the one it
    already names the crawler's versions with."""
    return {
        "id": entry.get("id"),
        "label": entry.get("label") or "",
        "text": entry.get("text") or "",
        "script": entry.get("script") or "other",
        "created_at": iso(entry.get("created_at")),
        "updated_at": iso(entry.get("updated_at")),
    }


def lyrics_to_dict(doc: dict) -> dict:
    """One song's lyrics row: the job and its result in the same shape.

    The page polls this while either half is queued or running, then renders
    what came back, so every field below is present from the first poll — null
    until there is something to put in it. `meaning` stays null on a `done` row
    until someone asks for a reading, which is the step that costs.
    """
    return {
        "id": str(doc["_id"]),
        "song_id": doc.get("song_id"),
        "state": doc.get("state"),
        # What we actually asked the finder, which is not always the song's
        # title — worth showing, because a bad result is usually a bad query.
        "query": doc.get("query") or "",
        "text": doc.get("text"),
        "source": doc.get("source"),
        "alternatives": doc.get("alternatives") or [],
        "crawled": doc.get("crawled") or [],
        # The reading is its own half, asked for separately and billed
        # separately: null here means nobody has pressed the button yet.
        "meaning_state": doc.get("meaning_state"),
        "meaning": doc.get("meaning"),
        "meaning_note": doc.get("meaning_note"),
        # Which version the one reading was made from: "mine:<id>", or null for
        # the best the crawler found. Null is also what every row written
        # before versions could be yours carries, and means the same thing.
        "meaning_version": doc.get("meaning_version"),
        # Where the lookup came from, and what the finder decided the query
        # really was — for a pasted link that is the only place the real artist
        # and title exist, so the page shows it instead of the raw URL.
        "origin": doc.get("origin") or "song",
        # Whether this one is in the library yet. A search starts false and the
        # page asks; everything written before the flag existed has no field,
        # and a missing field means kept.
        "kept": doc.get("kept") is not False,
        "resolved": doc.get("resolved"),
        # Words someone typed in themselves, newest last — the answer when the
        # crawler found none or found the wrong ones. Each is a version in the
        # same switcher the crawler's own versions sit in.
        "mine": [_my_lyrics_to_dict(v) for v in (doc.get("mine") or [])],
        # What they called it. A lookup that found nothing has no `resolved`,
        # so without these its only title is the raw URL that was pasted.
        "manual_title": doc.get("manual_title") or "",
        "manual_artist": doc.get("manual_artist") or "",
        "video": doc.get("video"),
        "error": doc.get("error"),
        "created_at": iso(doc.get("created_at")),
        "finished_at": iso(doc.get("finished_at")),
    }


def feedback_to_dict(doc: dict) -> dict:
    """One piece of feedback. No user on it — the admin route attaches that
    through _account(), and nobody else ever reads somebody else's."""
    return {
        "id": str(doc["_id"]),
        "rating": doc.get("rating"),
        "message": doc.get("message") or "",
        "created_at": iso(doc.get("created_at")),
    }


def lyrics_set_to_dict(doc: dict, rows_for_derived: list[dict] | None = None) -> dict:
    """A collection of saved lookups. Shaped like playlist_to_dict, and derived
    the same way: the caller fetches the members, this counts and covers them."""
    ids = doc.get("lyrics_ids") or []
    by_id = {str(r["_id"]): r for r in (rows_for_derived or [])}
    ordered = [by_id[i] for i in ids if i in by_id]
    cover = next(((r.get("video") or {}).get("thumbnail") for r in ordered if (r.get("video") or {}).get("thumbnail")), None)

    return {
        "id": str(doc["_id"]),
        "name": doc.get("name"),
        "description": doc.get("description", ""),
        "lyrics_ids": ids,
        "item_count": len(ids),
        # How many of them have a reading, which is the thing that cost money.
        "read_count": sum(1 for r in ordered if r.get("meaning")),
        "cover": cover,
        "created_at": iso(doc.get("created_at")),
        "updated_at": iso(doc.get("updated_at")),
    }


def about_to_dict(doc: dict | None) -> dict:
    """The About page's content, as /about and the admin editor both read it.

    `_id` is the literal string "about", not an ObjectId — there is exactly one
    of these — so unlike everywhere else in this file there is no id to hand
    out, and it is dropped rather than renamed.

    Everything is defaulted, so a document written by an older version of the
    app (or half-written by hand in mongosh) still renders a page instead of
    throwing on a missing key.
    """
    doc = doc or {}
    return {
        "enabled": bool(doc.get("enabled", False)),
        "in_nav": bool(doc.get("in_nav", False)),
        "nav_label": doc.get("nav_label") or "",
        "nav_mini_label": doc.get("nav_mini_label") or "",
        "title": doc.get("title") or "",
        "subtitle": doc.get("subtitle") or "",
        "sections": [
            {
                "id": s.get("id") or "",
                "heading": s.get("heading") or "",
                "body": s.get("body") or "",
            }
            for s in (doc.get("sections") or [])
        ],
        # A link with nothing behind it is not rendered, and this is the only
        # place that rule lives — the page just draws what it is given.
        "links": [
            {
                "kind": link.get("kind") or "site",
                "label": link.get("label") or "",
                "value": link.get("value") or "",
            }
            for link in (doc.get("links") or [])
            if (link.get("value") or "").strip()
        ],
        "contact_enabled": bool(doc.get("contact_enabled", False)),
        "contact_heading": doc.get("contact_heading") or "",
        "contact_hint": doc.get("contact_hint") or "",
        "contact_sent": doc.get("contact_sent") or "",
        "updated_at": iso(doc.get("updated_at")),
    }


def about_admin_to_dict(doc: dict | None) -> dict:
    """The same document for the editor, which needs the empty links too — they
    are the rows you type a URL into, and dropping them would mean the Résumé
    field disappeared the moment it was cleared."""
    out = about_to_dict(doc)
    out["links"] = [
        {
            "kind": link.get("kind") or "site",
            "label": link.get("label") or "",
            "value": link.get("value") or "",
        }
        for link in ((doc or {}).get("links") or [])
    ]
    return out


def contact_to_dict(doc: dict) -> dict:
    """One message from /about. The sender typed their own name and address —
    they may have no account here at all — so those are carried on the row
    itself rather than looked up like feedback's author is."""
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name") or "",
        "email": doc.get("email") or "",
        "message": doc.get("message") or "",
        "signed_in": bool(doc.get("user_id")),
        "created_at": iso(doc.get("created_at")),
    }
