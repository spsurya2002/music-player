"""Env-driven settings for the Reel Audio backend."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()

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
