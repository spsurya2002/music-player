"""Auto-ingest: the door a shared reel comes through.

POST /api/ingest queues a URL and returns immediately — the work happens in the
worker in services/ingest.py. The Android share target lands on the SPA at
/share, which calls this with the session cookie the installed app already
carries, so there is no API key to issue, store or leak.

Every route takes CurrentUser: a queued reel becomes a row in somebody's
library, so it has an owner from the moment it's queued.
"""

from fastapi import APIRouter

from backend.auth import CurrentUser
from backend.models import IngestRequest
from backend.services import ingest as ingest_service

router = APIRouter(tags=["ingest"])


@router.post("/ingest", status_code=202)
async def queue_reel(body: IngestRequest, user: CurrentUser):
    """202, not 201: nothing has been created yet — it's been accepted."""
    job = await ingest_service.enqueue(body.url, user.id, body.origin or "share")
    return {"job": job}


@router.get("/ingest/jobs")
async def list_jobs(user: CurrentUser, limit: int = 20):
    jobs = await ingest_service.list_jobs(user.id, limit=max(1, min(limit, 100)))
    return {"jobs": jobs}


@router.delete("/ingest/jobs")
async def clear_jobs(user: CurrentUser):
    """Clears finished rows only — a reel still queued or downloading stays."""
    removed = await ingest_service.clear_finished(user.id)
    return {"cleared": removed}
