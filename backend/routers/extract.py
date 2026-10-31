"""Phase 1 (ephemeral): POST /api/extract, GET /api/extract/{job},
POST /api/match/{token}, GET /api/preview/{token}, POST /api/search.

Nothing here touches the library — extraction lands in the process-memory token
registry (backend.services.extractor) and only becomes a Song on POST /api/songs.
The download itself runs on a background thread (backend.services.extract_jobs):
the tunnel in front of the app drops a request that is still open at 100s, and
a YouTube conversion takes longer than that. The page polls until the token exists.

The one write is the limit: an extraction that produces an MP3 spends a reel
use (backend.services.quota); one that fails gives it back.
"""

import asyncio

from fastapi import APIRouter
from fastapi.responses import FileResponse

from backend import errors
from backend.auth import CurrentUser
from backend.models import ExtractRequest, SearchRequest
from backend.services import extract_jobs, extractor
from backend.services import identify as identify_service
from backend.services import pipeline, quota

router = APIRouter(tags=["extract"])


@router.post("/extract", status_code=202)
async def do_extract(body: ExtractRequest, user: CurrentUser):
    url = (body.url or "").strip()
    if not url:
        raise errors.AppError("Paste an Instagram, YouTube, or Spotify link.", 400)
    # Classified before the quota hold: a link that isn't one song must not
    # spend a reel use, and must not start a download.
    try:
        source, url = extractor.prepare(url)
    except extractor.ExtractError as e:
        raise errors.AppError(e.message, e.status) from e

    hold = await quota.reserve(user.id, quota.REEL)
    # The job finishes on its own thread, with its own event loop, and Motor is
    # bound to this one — so the settlement is handed back here to run.
    loop = asyncio.get_running_loop()

    def settle(ok: bool) -> None:
        outcome = quota.settle(hold) if ok else quota.release(hold)
        asyncio.run_coroutine_threadsafe(outcome, loop)

    try:
        job_id = extract_jobs.start(url, user.id, source, on_finish=settle)
    except Exception:
        await quota.release(hold)
        raise
    return {"job": job_id, "state": "running"}


@router.get("/extract/{job_id}")
async def extract_status(job_id: str, user: CurrentUser):
    job = extract_jobs.get(job_id, user.id)
    if not job:
        raise errors.AppError(errors.MISSING_TOKEN, 404)
    return {
        "job": job_id,
        "state": job["state"],
        "error": job["error"],
        "status": job["status"],
        "result": job["result"],
    }


@router.post("/match/{token}")
async def match(token: str, user: CurrentUser):
    return await pipeline.match_token(token, user.id)


@router.get("/preview/{token}")
async def preview(token: str, user: CurrentUser, dl: str | None = None):
    job = extractor.get_token(token, user.id)
    path = job["path"] if job else None
    if not path or not path.exists():
        raise errors.AppError(errors.MISSING_TOKEN, 404)

    return FileResponse(
        path,
        media_type="audio/mpeg",
        filename=path.name if dl == "1" else None,
        content_disposition_type="attachment" if dl == "1" else "inline",
    )


@router.post("/search")
async def search(body: SearchRequest, user: CurrentUser):
    q = (body.q or "").strip()
    if not q:
        raise errors.AppError("Type something to search for.", 400)
    results = await asyncio.to_thread(identify_service.search_query, q)
    return {"results": results}
