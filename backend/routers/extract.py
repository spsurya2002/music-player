"""Phase 1 (ephemeral): POST /api/extract, POST /api/match/{token},
GET /api/preview/{token}, POST /api/search.

Nothing here touches the library — extraction lands in the process-memory token
registry (backend.services.extractor) and only becomes a Song on POST /api/songs.
The one write is the limit: an extraction that produces an MP3 spends a reel
use (backend.services.quota); one that fails gives it back.
"""

import asyncio

from fastapi import APIRouter
from fastapi.responses import FileResponse

from backend import errors
from backend.auth import CurrentUser
from backend.models import ExtractRequest, SearchRequest
from backend.services import extractor
from backend.services import identify as identify_service
from backend.services import pipeline, quota

router = APIRouter(tags=["extract"])


@router.post("/extract")
async def do_extract(body: ExtractRequest, user: CurrentUser):
    url = (body.url or "").strip()
    if not url:
        raise errors.AppError(errors.MISSING_URL, 400)
    if not extractor.URL_RE.match(url):
        raise errors.AppError(errors.BAD_URL, 400)

    url = url.split("?")[0]  # drop tracking params

    async with quota.use(user.id, quota.REEL):
        try:
            payload = await extractor.extract(url, user.id)
        except extractor.ExtractError as e:
            raise errors.AppError(e.message, e.status) from e

    return payload


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
