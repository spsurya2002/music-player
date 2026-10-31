"""Link extraction, off the request that started it.

Downloading a video and turning it into an MP3 routinely outlasts the
Cloudflare tunnel in front of this app, which drops any request still open
at 100 seconds. The browser then reports that the server is down, which is
what a dropped connection looks like. So POST /api/extract only starts the
work and returns; the page polls GET /api/extract/{job} until the MP3 exists.

Same lifetime as an extract token: process memory, gone on restart. The
finished job's `result` is the token payload POST /api/extract used to
return directly.
"""

import asyncio
import threading
import uuid

from backend.services import extractor

# job id -> {user_id, state, error, status, result}
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _run(job_id: str, url: str, user_id: str, source: str, on_finish) -> None:
    ok = False
    try:
        payload = asyncio.run(extractor.extract(url, user_id, source))
        with _lock:
            if job_id in _jobs:
                _jobs[job_id].update(state="done", result=payload)
        ok = True
    except extractor.ExtractError as exc:
        with _lock:
            if job_id in _jobs:
                _jobs[job_id].update(state="error", error=exc.message, status=exc.status)
    except Exception as exc:  # noqa: BLE001 - the page has to show something
        with _lock:
            if job_id in _jobs:
                _jobs[job_id].update(
                    state="error",
                    error=extractor.friendly_error(f"{type(exc).__name__}: {exc}"),
                    status=500,
                )
    finally:
        if on_finish is not None:
            on_finish(ok)


def start(url: str, user_id: str, source: str, on_finish=None) -> str:
    """Begin one download. Returns the job id to poll.

    `on_finish(ok)` runs on the job's thread, True when an MP3 was produced.
    The router uses it to keep or refund the reel use, and it has to schedule
    that back onto the server's event loop — Motor is bound to that one.
    """
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "user_id": user_id,
            "state": "running",
            "error": None,
            "status": None,
            "result": None,
        }
    threading.Thread(
        target=_run, args=(job_id, url, user_id, source, on_finish), daemon=True
    ).start()
    return job_id


def get(job_id: str, user_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        job = dict(job) if job else None
    return job if job and job.get("user_id") == user_id else None
