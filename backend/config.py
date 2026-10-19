"""Env-driven settings for the Reelody backend."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()


def _load_env_file(path: Path) -> None:
    """Read KEY=value lines out of backend/.env into the environment.

    Hand-rolled rather than python-dotenv: it's a dozen lines, and one less
    dependency between a fresh clone and a running server. A real environment
    variable always wins, so `GOOGLE_CLIENT_ID=... ./run.sh` still overrides the
    file. Anything malformed is skipped in silence — this runs at import, and a
    stray line in a config file is not worth refusing to boot over.
    """
    try:
        text = path.read_text()
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        # export KEY=value, so the same file can be sourced by a shell.
        if key.startswith("export "):
            key = key[len("export ") :].strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(Path(__file__).parent / ".env")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
DB_NAME = os.environ.get("DB_NAME", "reel_audio")
PORT = int(os.environ.get("PORT", "8000"))

# Optional: set INSTA_COOKIES_BROWSER=firefox (or chrome, brave, edge...) to pull
# your logged-in Instagram session straight from the browser profile.
INSTA_COOKIES_BROWSER = os.environ.get("INSTA_COOKIES_BROWSER", "").strip()

AUDIO_QUALITY = os.environ.get("AUDIO_QUALITY", "192")  # kbps

COOKIES_FILE = BASE_DIR / "cookies.txt"

# Temp download workdir for the ephemeral extract -> match -> preview -> save flow.
DOWNLOAD_DIR = BASE_DIR / "backend" / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Temp workdir for files uploaded to "Find the song" — like DOWNLOAD_DIR, nothing
# here is library state; it's what the identify job reads and the page plays back.
UPLOAD_DIR = BASE_DIR / "backend" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 64 * 1024 * 1024

# --- Who's signed in -------------------------------------------------------

# The OAuth client ID from Google Cloud Console (Credentials -> OAuth client ID
# -> Web application). The frontend reads it from GET /api/auth/config rather
# than a build-time env var, so one server build works for any client ID.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()

SESSION_COOKIE = "reel_session"
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
# Cookies marked secure are dropped over plain http, which is how this runs on
# localhost — so it stays off unless the app is actually served over https.
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "").lower() in ("1", "true", "yes")

# Optional guest list. Empty means any Google account may sign in; set it to
# keep a personal instance personal, e.g. ALLOWED_EMAILS="me@gmail.com,you@x.com".
ALLOWED_EMAILS = {
    e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()
}

# Songs and playlists saved before logins existed have no owner. They are
# adopted by this account on its first sign-in; unset, the first account to
# sign in adopts them (see backend/auth.py).
LEGACY_OWNER_EMAIL = os.environ.get("LEGACY_OWNER_EMAIL", "").strip().lower()


# --- Limits ----------------------------------------------------------------

# Who runs this instance. An admin has no limits, sees every request for more,
# and can change anyone's. Comma-separated, like ALLOWED_EMAILS; an admin can
# always sign in, guest list or not.
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "spsuryamishra@gmail.com").split(",")
    if e.strip()
}

# What a new account gets of the four paid features before it has to ask for
# more: pulling the audio out of a reel, finding the song behind a file, looking
# up a song's words, and having those words explained. Lifetime totals, not
# monthly — only an admin raises them. Stored per user only once an admin has
# changed them, so editing these moves everyone still on the default (see
# backend/services/quota.py).
FREE_REEL_LIMIT = int(os.environ.get("FREE_REEL_LIMIT", "5"))
FREE_FILE_LIMIT = int(os.environ.get("FREE_FILE_LIMIT", "5"))
FREE_LYRICS_LIMIT = int(os.environ.get("FREE_LYRICS_LIMIT", "5"))

# The reading is its own allowance, and the smallest one, because it is the only
# feature here that spends somebody else's money per use: a crawl is our own
# bandwidth, a Gemini call is a bill. Two is enough to see what the feature is
# for and not enough to run up a tab by holding the button down.
FREE_MEANING_LIMIT = int(os.environ.get("FREE_MEANING_LIMIT", "2"))


# --- Lyrics and meaning ----------------------------------------------------

# The lyrics sidecar (lyrics-node/), started by run.sh. It holds the crawler and
# the Gemini key; backend/services/lyrics.py is the only module that talks to
# it. Loopback by design — it has no auth of its own, so it must never be
# reachable from anywhere this process isn't.
LYRICS_SIDECAR_URL = os.environ.get("LYRICS_SIDECAR_URL", "http://127.0.0.1:4001").rstrip("/")

# A crawl walks up to eight pages at eight seconds each, then Gemini takes its
# own time. Generous because this runs in a background worker, where nothing is
# waiting on the socket — not in a request, which Cloudflare would cut at 100s.
LYRICS_TIMEOUT = int(os.environ.get("LYRICS_TIMEOUT", "240"))

# Words someone typed in themselves, when the crawler found none or found the
# wrong ones. Free — there is no crawl and no model call behind them — so the
# only limits are the ones that keep a row sane: the sidecar refuses to explain
# more than 12,000 characters in one go (lyrics-node/src/routes/meaning.ts), so
# accepting more would only store something that can never be read.
MAX_MY_LYRICS_CHARS = int(os.environ.get("MAX_MY_LYRICS_CHARS", "12000"))
MAX_MY_VERSIONS = int(os.environ.get("MAX_MY_VERSIONS", "10"))
