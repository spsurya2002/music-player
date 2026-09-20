"""Instagram audio extractor.

Paste a reel / post / story URL, get the audio back as an MP3.
Run with:  ./run.sh   (or: .venv/bin/python app.py)
"""

import os
import re
import threading
import unicodedata
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

BASE_DIR = Path(__file__).parent.resolve()
DOWNLOAD_DIR = BASE_DIR / "downloads"
COOKIES_FILE = BASE_DIR / "cookies.txt"

# Optional: set INSTA_COOKIES_BROWSER=firefox (or chrome, brave, edge...) to pull
# your logged-in Instagram session straight from the browser profile.
COOKIES_BROWSER = os.environ.get("INSTA_COOKIES_BROWSER", "").strip()

PORT = int(os.environ.get("PORT", "7788"))
AUDIO_QUALITY = os.environ.get("AUDIO_QUALITY", "192")  # kbps

DOWNLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=None)

# token -> absolute path, so the download endpoint never takes a path from the client
_files: dict[str, Path] = {}
_lock = threading.Lock()

URL_RE = re.compile(
    r"^https?://(www\.)?instagram\.com/(reel|reels|p|tv|share)/[\w\-./]+", re.I
)


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
    elif COOKIES_BROWSER:
        opts["cookiesfrombrowser"] = (COOKIES_BROWSER,)
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


@app.get("/")
def index():
    return send_from_directory(BASE_DIR / "static", "index.html")


@app.post("/api/extract")
def extract():
    url = (request.json or {}).get("url", "").strip()
    if not url:
        return jsonify(error="Paste an Instagram URL first."), 400
    if not URL_RE.match(url):
        return jsonify(error="That doesn't look like an Instagram post/reel URL."), 400

    url = url.split("?")[0]  # drop tracking params
    job = uuid.uuid4().hex
    workdir = DOWNLOAD_DIR / job
    workdir.mkdir(parents=True, exist_ok=True)

    try:
        with YoutubeDL(ydl_opts(str(workdir / "%(id)s.%(ext)s"))) as ydl:
            info = ydl.extract_info(url, download=True)
    except DownloadError as e:
        return jsonify(error=friendly_error(str(e))), 502
    except Exception as e:  # noqa: BLE001 - surface anything else as a clean message
        return jsonify(error=friendly_error(f"{type(e).__name__}: {e}")), 500

    if info.get("_type") == "playlist":  # carousel post -> first entry with audio
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            return jsonify(error="No media found in that post."), 502
        info = entries[0]

    mp3s = sorted(workdir.glob("*.mp3"))
    if not mp3s:
        return jsonify(error="Downloaded the post but found no audio track in it."), 502

    mp3 = mp3s[0]
    label = nice_name(info)
    final = workdir / f"{label}.mp3"
    if final != mp3:
        mp3.rename(final)

    token = uuid.uuid4().hex
    with _lock:
        _files[token] = final

    return jsonify(
        token=token,
        filename=final.name,
        title=label,
        track=info.get("track"),
        artist=info.get("artist") or info.get("creator"),
        uploader=info.get("uploader"),
        duration=info.get("duration"),
        thumbnail=info.get("thumbnail"),
        size=final.stat().st_size,
    )


@app.get("/api/file/<token>")
def get_file(token):
    with _lock:
        path = _files.get(token)
    if not path or not path.exists():
        return jsonify(error="That file has expired — extract it again."), 404
    as_attachment = request.args.get("dl") == "1"
    return send_file(
        path,
        mimetype="audio/mpeg",
        as_attachment=as_attachment,
        download_name=path.name,
        conditional=True,
    )


if __name__ == "__main__":
    print(f"\n  Instagram audio extractor  ->  http://127.0.0.1:{PORT}\n")
    app.run(host="127.0.0.1", port=PORT, debug=False)
