"""Instagram -> MP3 extraction, ported from the legacy app.py.

sanitize(), nice_name(), ydl_opts() and friendly_error() are unchanged logic,
just reading settings from backend.config instead of module-level globals.
Adds the async wrappers and the process-memory temp-token registry used by
the two-phase extract -> match -> preview -> save flow in docs/API.md.
"""

import asyncio
import json
import re
import shutil
import threading
import unicodedata
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from backend.config import AUDIO_QUALITY, COOKIES_FILE, DOWNLOAD_DIR, INSTA_COOKIES_BROWSER
from backend.errors import NOT_A_SONG_LINK, NOT_ONE_SONG
from backend.services import cookies as cookies_service
from backend.services import identify as identify_service

URL_RE = re.compile(
    r"^https?://(www\.)?instagram\.com/(reel|reels|p|tv|share)/[\w\-./]+", re.I
)

# One video. Playlists, channels and live streams are rejected before this
# matches — a library row is one song, the same shape as a reel.
_YT_ID = r"[\w-]{11}"
_YT_WATCH = re.compile(
    rf"^https?://(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:.*&)?v=({_YT_ID})(?:&.*)?$",
    re.I,
)
_YT_SHORT = re.compile(
    rf"^https?://(?:www\.|m\.)?youtube\.com/(?:shorts|embed|v)/({_YT_ID})(?:[?&#/].*)?$",
    re.I,
)
_YT_BE = re.compile(rf"^https?://youtu\.be/({_YT_ID})(?:[?&#/].*)?$", re.I)
_YT_LIVE = re.compile(r"^https?://(?:www\.|m\.|music\.)?youtube\.com/live/", re.I)
_YT_PLAYLIST = re.compile(r"^https?://(?:www\.|m\.|music\.)?youtube\.com/playlist", re.I)
_SPOTIFY_TRACK = re.compile(
    r"^(?:https?://open\.spotify\.com/(?:intl-[a-z-]+/)?track/([A-Za-z0-9]+)|spotify:track:([A-Za-z0-9]+))(?:[?#].*)?$",
    re.I,
)
_SPOTIFY_OTHER = re.compile(
    r"^https?://open\.spotify\.com/(?:intl-[a-z-]+/)?(album|playlist|artist|episode|show)/",
    re.I,
)
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

# token -> {path, info, url, workdir, user_id}; process-memory only, dies with a
# restart. The user_id is who extracted it: a token is a claim on a temp file
# that will become a row in someone's library, so it is only redeemable by them.
_tokens: dict[str, dict] = {}
_lock = threading.Lock()


def sanitize(name: str, fallback: str = "instagram-audio") -> str:
    """Make a string safe to use as a filename, keeping it readable."""
    name = unicodedata.normalize("NFKC", name or "").strip()
    name = name.split("\n")[0]
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:80] or fallback


def nice_name(info: dict) -> str:
    """Prefer the music credit Instagram attaches, fall back to caption/uploader."""
    track = (info.get("track") or "").strip()
    artist = (info.get("artist") or info.get("creator") or "").strip()
    if track and artist:
        return sanitize(f"{artist} - {track}")
    if track:
        return sanitize(track)

    title = (info.get("title") or "").strip()
    uploader = (info.get("uploader") or info.get("channel") or "").strip()
    if title and uploader:
        return sanitize(f"{uploader} - {title}")
    return sanitize(title or uploader)


def ydl_opts(outtmpl: str) -> dict:
    opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 3,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": AUDIO_QUALITY,
            },
            {"key": "FFmpegMetadata", "add_metadata": True},
        ],
    }
    # YouTube's audio formats are hidden behind a JavaScript challenge. The
    # yt-dlp command line turns Node on by itself; YoutubeDL() does not, so a
    # download from this process sees no audio and reports the format as
    # missing. Same option a working YouTube-to-MP3 call uses.
    runtimes = {
        name: {}
        for name in ("node", "deno")
        if shutil.which(name)
    }
    if runtimes:
        opts["js_runtimes"] = runtimes
    if COOKIES_FILE.exists():
        opts["cookiefile"] = str(COOKIES_FILE)
    elif INSTA_COOKIES_BROWSER:
        browser, profile, _ = cookies_service.browser_session()
        if browser:
            opts["cookiesfrombrowser"] = (browser, profile, None, None)
    return opts


def friendly_error(msg: str) -> str:
    low = msg.lower()
    if "login" in low or "rate-limit" in low or "empty media response" in low:
        return (
            "Instagram wants a logged-in session for this one. Export your "
            "instagram.com cookies to cookies.txt next to app.py, or start the app "
            "with INSTA_COOKIES_BROWSER=firefox (see the README)."
        )
    if "page needs to be reloaded" in low or "confirm you're not a bot" in low or "sign in to confirm" in low:
        return "YouTube refused this one. A public video does not need cookies — try it again."
    if "requested format is not available" in low or "no js runtime" in low or "javascript runtime" in low:
        return "YouTube didn't hand over an audio format. This machine needs Node.js so the downloader can read it."
    if "not available" in low or "404" in low or "unavailable" in low or "private" in low:
        return "That link isn't reachable — it may be private, deleted, or the URL is off."
    if "unsupported url" in low:
        return NOT_A_SONG_LINK
    # Strip yt-dlp's noisy prefix
    return re.sub(r"^ERROR:\s*", "", msg).strip()[:300]


def prepare(url: str) -> tuple[str, str]:
    """Decide what a pasted link is, and the canonical form to store.

    Returns `(source, canonical_url)`. Instagram drops its query string, a
    YouTube link becomes `watch?v=`, and a Spotify link becomes
    `open.spotify.com/track/`. Anything that isn't one song is a 400.
    """
    url = (url or "").strip().split("#", 1)[0]
    bare = url.split("?")[0]
    if URL_RE.match(bare):
        return "instagram", bare

    if _SPOTIFY_OTHER.match(bare) or _YT_LIVE.match(bare) or _YT_PLAYLIST.match(bare):
        raise ExtractError(NOT_ONE_SONG, 400)

    spotify = _SPOTIFY_TRACK.match(url)
    if spotify:
        track_id = spotify.group(1) or spotify.group(2)
        return "spotify", f"https://open.spotify.com/track/{track_id}"

    video_id = None
    for pattern in (_YT_WATCH, _YT_SHORT, _YT_BE):
        match = pattern.match(url)
        if match:
            video_id = match.group(1)
            break
    if video_id:
        return "youtube", f"https://www.youtube.com/watch?v={video_id}"

    raise ExtractError(NOT_A_SONG_LINK, 400)


def _as_youtube_match(info: dict, score: int = 100) -> dict | None:
    """The video the audio actually came from, in the shape the song page renders."""
    vid = info.get("id")
    if not vid:
        return None
    duration = info.get("duration")
    return {
        "id": vid,
        "url": info.get("webpage_url") or f"https://www.youtube.com/watch?v={vid}",
        "title": info.get("title") or "",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration": int(duration) if isinstance(duration, (int, float)) else None,
        "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
        "score": score,
    }


class ExtractError(Exception):
    """Carries an already-friendly message and an HTTP status."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.message = message
        self.status = status


def _download_sync(
    download_url: str,
    user_id: str,
    source: str,
    stored_url: str,
    overrides: dict | None = None,
) -> dict:
    """Blocking yt-dlp download; run via asyncio.to_thread. Returns the token payload.

    `download_url` is what yt-dlp fetches. `stored_url` is what the library
    remembers — the same thing for a reel or a YouTube video, the Spotify
    track when the bytes came from the YouTube recording of it.
    """
    job = uuid.uuid4().hex
    workdir = DOWNLOAD_DIR / job
    workdir.mkdir(parents=True, exist_ok=True)
    overrides = overrides or {}

    try:
        with YoutubeDL(ydl_opts(str(workdir / "%(id)s.%(ext)s"))) as ydl:
            info = ydl.extract_info(download_url, download=True)
    except DownloadError as e:
        shutil.rmtree(workdir, ignore_errors=True)
        raise ExtractError(friendly_error(str(e)), 502) from e
    except Exception as e:  # noqa: BLE001 - surface anything else as a clean message
        shutil.rmtree(workdir, ignore_errors=True)
        raise ExtractError(friendly_error(f"{type(e).__name__}: {e}"), 500) from e

    if info.get("_type") == "playlist":  # carousel post -> first entry with audio
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            shutil.rmtree(workdir, ignore_errors=True)
            raise ExtractError("No media found in that post.", 502)
        info = entries[0]

    mp3s = sorted(workdir.glob("*.mp3"))
    if not mp3s:
        shutil.rmtree(workdir, ignore_errors=True)
        raise ExtractError("Downloaded that link but found no audio track in it.", 502)

    mp3 = mp3s[0]
    label = overrides.get("title") or nice_name(info)
    label = sanitize(label, fallback="audio")
    final = workdir / f"{label}.mp3"
    if final != mp3:
        mp3.rename(final)

    token = uuid.uuid4().hex
    payload = {
        "token": token,
        "filename": final.name,
        "title": label,
        "track": overrides.get("track") if "track" in overrides else info.get("track"),
        "artist": overrides.get("artist") if "artist" in overrides else (info.get("artist") or info.get("creator")),
        "uploader": overrides.get("uploader") if "uploader" in overrides else info.get("uploader"),
        "source": source,
        "duration": info.get("duration"),
        "size": final.stat().st_size,
        "thumbnail": overrides.get("thumbnail") or info.get("thumbnail"),
    }
    # instagram_url stays the reel field. A YouTube or Spotify song omits it,
    # the same way an upload does, and carries source_url instead.
    if source == "instagram":
        payload["instagram_url"] = stored_url
    else:
        payload["source_url"] = stored_url

    with _lock:
        _tokens[token] = {
            "user_id": user_id,
            "path": final,
            "info": info,
            "url": stored_url,
            "source": source,
            "workdir": workdir,
            "meta": payload,
            "origin_youtube": None if source == "instagram" else _as_youtube_match(info),
            "match": None,  # filled in by POST /api/match/{token}, if it's called
        }

    return payload


def _spotify_meta(url: str) -> dict:
    """Title, artist and art from Spotify's public embed page.

    oEmbed used to carry the artist and no longer does. The embed page's
    `__NEXT_DATA__` still names the track. It does not include the audio —
    that stream is locked, so the bytes come from YouTube afterwards.
    """
    track_id = url.rstrip("/").rsplit("/", 1)[-1]
    req = urllib.request.Request(
        f"https://open.spotify.com/embed/track/{track_id}",
        headers={"User-Agent": _UA, "Accept": "text/html"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise ExtractError(
            "That Spotify link isn't reachable — it may be private, or the URL is off.",
            502,
        ) from e
    except Exception as e:  # noqa: BLE001
        raise ExtractError("Couldn't reach Spotify to read that link.", 502) from e

    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html
    )
    entity = {}
    if match:
        try:
            payload = json.loads(match.group(1))
            entity = (
                ((payload.get("props") or {}).get("pageProps") or {}).get("state") or {}
            ).get("data", {}).get("entity") or {}
        except (json.JSONDecodeError, AttributeError):
            entity = {}

    track = (entity.get("title") or entity.get("name") or "").strip()
    artists = [
        (a.get("name") or "").strip()
        for a in (entity.get("artists") or [])
        if (a.get("name") or "").strip()
    ]
    artist = ", ".join(artists)
    images = ((entity.get("visualIdentity") or {}).get("image") or [])
    thumbnail = images[-1].get("url") if images else None
    if not track:
        raise ExtractError("Spotify didn't name that track.", 502)
    return {"track": track, "artist": artist, "thumbnail": thumbnail}


def _spotify_sync(url: str, user_id: str) -> dict:
    meta = _spotify_meta(url)
    results = identify_service.find_on_youtube(meta["track"], meta["artist"])
    if not results:
        results = identify_service.search_query(f"{meta['artist']} {meta['track']}".strip())
    if not results or not results[0].get("url"):
        raise ExtractError("Couldn't find a recording of that Spotify track to save.", 502)

    title = f"{meta['artist']} - {meta['track']}" if meta["artist"] else meta["track"]
    return _download_sync(
        results[0]["url"],
        user_id,
        "spotify",
        url,
        overrides={
            "title": title,
            "track": meta["track"],
            "artist": meta["artist"] or None,
            "uploader": meta["artist"] or None,
            "thumbnail": meta["thumbnail"],
        },
    )


def _run_sync(url: str, user_id: str, source: str) -> dict:
    if source == "spotify":
        return _spotify_sync(url, user_id)
    return _download_sync(url, user_id, source, url)


async def extract(url: str, user_id: str, source: str | None = None) -> dict:
    """Download one link to a temp MP3.

    `source` is set when the caller already ran `prepare` (the extract route
    does, so a bad link never spends a reel use). Auto-ingest passes a reel
    URL and lets this classify it.
    """
    if source is None:
        source, url = prepare(url)
    return await asyncio.to_thread(_run_sync, url, user_id, source)


def get_token(token: str, user_id: str) -> dict | None:
    """Someone else's token is not found, rather than forbidden — there's nothing
    to tell a caller about an extraction that isn't theirs."""
    with _lock:
        job = _tokens.get(token)
    return job if job and job.get("user_id") == user_id else None


def set_match(token: str, match: dict) -> None:
    """Cache the /api/match/{token} result so POST /api/songs can persist it
    without re-running identification (fingerprinting is expensive, and the
    user has already seen and implicitly accepted this result)."""
    with _lock:
        job = _tokens.get(token)
        if job is not None:
            job["match"] = match


def pop_token(token: str) -> dict | None:
    with _lock:
        return _tokens.pop(token, None)


def discard(token: str) -> None:
    """Drop a token and its temp workdir without saving it."""
    job = pop_token(token)
    if job:
        shutil.rmtree(job["workdir"], ignore_errors=True)
