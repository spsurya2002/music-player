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

import identify

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

# token -> {path, info}, so the download endpoint never takes a path from the client
_jobs: dict[str, dict] = {}
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
        browser, profile, _ = browser_session()
        if browser:
            opts["cookiesfrombrowser"] = (browser, profile, None, None)
    return opts


# Where Chrome-family browsers keep their profile folders
CHROME_ROOTS = {
    "chrome": "~/.config/google-chrome",
    "chromium": "~/.config/chromium",
    "brave": "~/.config/BraveSoftware/Brave-Browser",
    "edge": "~/.config/microsoft-edge",
}

_resolved: dict = {}


class _Quiet:
    """yt-dlp wants a logger; cookie extraction is noisy and none of it is ours."""

    def debug(self, *a, **k): pass
    def info(self, *a, **k): pass
    def warning(self, *a, **k): pass
    def error(self, *a, **k): pass


def _extract(browser: str, profile: str | None):
    from yt_dlp.cookies import extract_cookies_from_browser

    try:
        return extract_cookies_from_browser(browser, profile=profile, logger=_Quiet())
    except Exception:
        return None


def _has_session(jar) -> bool:
    return bool(jar) and any(
        c.name == "sessionid" and c.value and "instagram" in (c.domain or "")
        for c in jar
    )


def _profiles_with_instagram(browser: str) -> list[str]:
    """Profile folders holding instagram.com cookies, newest session first.

    Read without decrypting — this only asks *which* profile to try, and the
    default profile is often not even the one you're logged in on.
    """
    root = Path(CHROME_ROOTS.get(browser, "")).expanduser()
    if not root.is_dir():
        return []

    import shutil
    import sqlite3
    import tempfile

    found = []
    for db in root.glob("*/Cookies"):
        tmp = Path(tempfile.gettempdir()) / f"ck-{os.getpid()}-{db.parent.name}.sqlite"
        try:
            shutil.copy(db, tmp)  # the live DB is locked while the browser runs
            con = sqlite3.connect(tmp)
            n = con.execute(
                "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%instagram%'"
            ).fetchone()[0]
            con.close()
            if n:
                found.append((db.stat().st_mtime, db.parent.name))
        except Exception:
            continue
        finally:
            tmp.unlink(missing_ok=True)

    return [name for _, name in sorted(found, reverse=True)]


def browser_session():
    """(browser, profile, cookiejar) for the browser profile that's logged in.

    Resolved once and cached. Auto-detecting the profile matters because Chrome
    numbers them per account — a plain "chrome" looks at a Default folder that
    may not exist.
    """
    if "session" in _resolved:
        return _resolved["session"]

    browser, _, profile = COOKIES_BROWSER.partition(":")
    browser, profile = browser.strip().lower(), profile.strip() or None
    result = (None, None, None)

    if browser:
        jar = _extract(browser, profile)
        if profile or _has_session(jar):
            result = (browser, profile, jar)
        else:
            for name in _profiles_with_instagram(browser):
                jar = _extract(browser, name)
                if _has_session(jar):
                    print(f"  using {browser} profile: {name}")
                    result = (browser, name, jar)
                    break
            else:
                result = (browser, profile, jar)

    _resolved["session"] = result
    return result


def cookiejar():
    """Whatever session we have, as a plain cookiejar the IG API call can use."""
    import http.cookiejar

    if COOKIES_FILE.exists():
        jar = http.cookiejar.MozillaCookieJar(str(COOKIES_FILE))
        try:
            jar.load(ignore_discard=True, ignore_expires=True)
            return jar
        except Exception:
            return None
    return browser_session()[2]


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
        _jobs[token] = {"path": final, "info": info, "url": url}

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


@app.post("/api/match/<token>")
def match(token):
    """Name the song, then point at it on YouTube."""
    with _lock:
        job = _jobs.get(token)
    if not job:
        return jsonify(error="That extraction has expired — run it again."), 404

    song = identify.identify(
        job["info"], job["path"], url=job.get("url", ""), cookiejar=cookiejar()
    )
    if not song or not song.get("track"):
        hint = (
            "No music sticker on the post, and the audio matched nothing. If someone "
            "is singing or playing the song themselves, fingerprinting can't match it "
            "— it only recognises the original recording. Search for it by name below."
        )
        if not COOKIES_FILE.exists() and not COOKIES_BROWSER:
            hint += (
                " Setting up cookies would also let the app read Instagram's own music "
                "sticker, which names the song outright (see the README)."
            )
        return jsonify(identified=False, reason=hint)

    # A caption guess is free text, not a known song name — search it as such
    if song.get("confidence") == "low":
        results = identify.search_query(song["track"])
    else:
        results = identify.find_on_youtube(song["track"], song.get("artist", ""))
    return jsonify(identified=True, song=song, results=results)


@app.post("/api/search")
def search():
    """Manual lookup, for when the app can't name the song but you can."""
    q = (request.json or {}).get("q", "").strip()
    if not q:
        return jsonify(error="Type something to search for."), 400
    return jsonify(results=identify.search_query(q))


@app.get("/api/file/<token>")
def get_file(token):
    with _lock:
        job = _jobs.get(token)
    path = job["path"] if job else None
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
