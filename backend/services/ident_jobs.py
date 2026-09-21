"""Identify jobs: running the file pipeline, and reading what it returned.

The tier pipeline in file_identify.py can run for minutes — Whisper transcribes
the whole track on CPU — which is far past what a request should hold open. So a
job runs on its own thread, collects the pipeline's log lines as it goes, and the
page polls for them. Same idea as the extract tokens: process memory only, gone
on restart.

The thread calls asyncio.run() rather than awaiting: the pipeline is async only
because Shazam is, and driving it off the server's event loop would block every
other request for the length of a transcription.

The shaping half lives here too, rather than in a router, because two routers
read these results: /api/identify polls them and /api/songs saves them.
"""

import asyncio
import re
import threading
import uuid
from pathlib import Path

from mutagen import File as MutagenFile

from backend.services.file_identify import identify

# job id -> {state, log, result, error, file, path}
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _run(job_id: str, path) -> None:
    def log(line):
        with _lock:
            _jobs[job_id]["log"].extend(str(line).splitlines())

    try:
        result = asyncio.run(identify(str(path), log=log))
        with _lock:
            _jobs[job_id].update(result=result, state="done")
    except Exception as exc:  # surface it in the log, not as a blank page
        log(f"Error: {exc}")
        with _lock:
            _jobs[job_id].update(state="error", error=str(exc))


def start(path, label: str) -> str:
    """Kick off identification of one file. Returns the job id to poll."""
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "state": "running",
            "log": [],
            "result": None,
            "error": None,
            "file": label,
            "path": path,
        }

    threading.Thread(target=_run, args=(job_id, path), daemon=True).start()
    return job_id


def get(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def discard(job_id: str) -> None:
    """Drop a job and its uploaded file — called once the song is safely in
    GridFS, the same way extractor.discard() retires a spent token."""
    with _lock:
        job = _jobs.pop(job_id, None)
    if job:
        Path(job["path"]).unlink(missing_ok=True)


# --------------------------------------------------------------------------
# reading a finished result
# --------------------------------------------------------------------------

# Which tier named the song, in words a person can read.
SOURCE_LABELS = {
    "shazam": "audio fingerprint (Shazam)",
    "acoustid": "audio fingerprint (AcoustID)",
    "caption": "the file's own caption tags",
    "lyrics": "the lyrics, transcribed",
}

# A fingerprint identifies the exact recording; heard words and stray tags are a
# good lead, not a certainty. Stored on the song for the same reason the reel
# flow stores it.
SOURCE_CONFIDENCE = {
    "shazam": "high",
    "acoustid": "high",
    "caption": "medium",
    "lyrics": "medium",
}

YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/)|youtu\.be/)([\w-]{11})"
)


def video_id(url: str) -> str | None:
    """The 11-character id, so a hit can open in the embedded player instead of
    sending the user to youtube.com. Shazam's VIDEO section sometimes hands back
    an API url rather than a watch link, and that one stays a plain link."""
    m = YOUTUBE_ID_RE.search(url or "")
    return m.group(1) if m else None


def shape(result: dict | None) -> dict | None:
    """The pipeline's raw dict carries Shazam's entire track document. Keep the
    handful of fields the page shows and drop the rest."""
    if not result:
        return None

    track = result.get("track") or {}
    source = result.get("source")
    out = {
        "source": source,
        "source_label": SOURCE_LABELS.get(source),
        "confidence": SOURCE_CONFIDENCE.get(source),
        "query": result.get("query"),
        "youtube": result.get("youtube"),
        "title": result.get("title"),
        "video_id": video_id(result.get("youtube") or ""),
        "track": None,
    }
    if track:
        out["track"] = {
            "title": track.get("title"),
            "artist": track.get("subtitle"),
            "cover": (track.get("images") or {}).get("coverart"),
            "shazam_url": track.get("url"),
        }
    return out


def duration_of(path) -> int | None:
    """Seconds, read off the file itself — an upload has no yt-dlp metadata to
    take it from, and the player needs a number to draw its progress bar."""
    try:
        audio = MutagenFile(str(path))
        return int(audio.info.length) if audio and audio.info else None
    except Exception:
        return None
