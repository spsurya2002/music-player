"""Instagram -> MP3 extraction, ported from the legacy app.py.

sanitize(), nice_name(), ydl_opts() and friendly_error() are unchanged logic,
just reading settings from backend.config instead of module-level globals.
Adds the async wrappers and the process-memory temp-token registry used by
the two-phase extract -> match -> preview -> save flow in docs/API.md.
"""

import asyncio
import re
import shutil
import threading
import unicodedata
import uuid
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from backend.config import AUDIO_QUALITY, COOKIES_FILE, DOWNLOAD_DIR, INSTA_COOKIES_BROWSER
from backend.services import cookies as cookies_service

URL_RE = re.compile(
    r"^https?://(www\.)?instagram\.com/(reel|reels|p|tv|share)/[\w\-./]+", re.I
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
    if "not available" in low or "404" in low or "unavailable" in low:
        return "That post isn't reachable — it may be private, deleted, or the URL is off."
    if "unsupported url" in low:
        return "That doesn't look like an Instagram post URL."
    # Strip yt-dlp's noisy prefix
    return re.sub(r"^ERROR:\s*", "", msg).strip()[:300]


class ExtractError(Exception):
    """Carries an already-friendly message and an HTTP status."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.message = message
        self.status = status


def _download_sync(url: str, user_id: str) -> dict:
    """Blocking yt-dlp download; run via asyncio.to_thread. Returns the token payload."""
    job = uuid.uuid4().hex
    workdir = DOWNLOAD_DIR / job
    workdir.mkdir(parents=True, exist_ok=True)

    try:
        with YoutubeDL(ydl_opts(str(workdir / "%(id)s.%(ext)s"))) as ydl:
            info = ydl.extract_info(url, download=True)
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
        raise ExtractError("Downloaded the post but found no audio track in it.", 502)

    mp3 = mp3s[0]
    label = nice_name(info)
    final = workdir / f"{label}.mp3"
    if final != mp3:
        mp3.rename(final)

    token = uuid.uuid4().hex
    payload = {
        "token": token,
        "filename": final.name,
        "title": label,
        "track": info.get("track"),
        "artist": info.get("artist") or info.get("creator"),
        "uploader": info.get("uploader"),
        "instagram_url": url,
        "duration": info.get("duration"),
        "size": final.stat().st_size,
        "thumbnail": info.get("thumbnail"),
    }
    with _lock:
        _tokens[token] = {
            "user_id": user_id,
            "path": final,
            "info": info,
            "url": url,
            "workdir": workdir,
            "meta": payload,
            "match": None,  # filled in by POST /api/match/{token}, if it's called
        }

    return payload


async def extract(url: str, user_id: str) -> dict:
    return await asyncio.to_thread(_download_sync, url, user_id)


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
