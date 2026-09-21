"""Identify jobs: running the file pipeline, and reading what it returned.

The tier pipeline in file_identify.py can run for minutes — Whisper transcribes
the whole track on CPU — which is far past what a request should hold open. So a
job runs on its own thread, collects the pipeline's log lines as it goes, and the
page polls for them. Same idea as the extract tokens: process memory only, gone
on restart.

The thread calls asyncio.run() rather than awaiting: the pipeline is async only
because Shazam is, and driving it off the server's event loop would block every
other request for the length of a transcription.

A job holds the working state for one file until it's saved, so a manual search
replaces its results in place (set_results) exactly as extractor.set_match caches
a reel's match against its token. Saving reads whatever the job holds by then.
"""

import asyncio
import threading
import uuid
from pathlib import Path

from mutagen import File as MutagenFile

from backend.services.file_match import identify

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


def set_results(job_id: str, query: str, results: list[dict]) -> dict | None:
    """Replace a finished job's matches with the ones a manual search found.

    The person typing the name knows better than any tier did, so this overwrites
    rather than appends, and marks the result as searched by hand — saving after
    it stores what they chose, not what the audio guessed.
    """
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        result = dict(job.get("result") or {})
        result.update(
            source="manual",
            source_label="a search you typed",
            confidence=None,
            guess=False,
            query=query,
            results=results,
        )
        job["result"] = result
        return dict(result)


def duration_of(path) -> int | None:
    """Seconds, read off the file itself — an upload has no yt-dlp metadata to
    take it from, and the player needs a number to draw its progress bar."""
    try:
        audio = MutagenFile(str(path))
        return int(audio.info.length) if audio and audio.info else None
    except Exception:
        return None
