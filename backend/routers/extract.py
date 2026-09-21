"""Phase 1 (ephemeral): POST /api/extract, POST /api/match/{token},
GET /api/preview/{token}, POST /api/search.

Nothing here touches MongoDB — extraction lands in the process-memory token
registry (backend.services.extractor) and only becomes a Song on POST /api/songs.
"""

import asyncio

from fastapi import APIRouter
from fastapi.responses import FileResponse

from backend import errors
from backend.config import COOKIES_FILE, INSTA_COOKIES_BROWSER
from backend.models import ExtractRequest, SearchRequest
from backend.services import cookies as cookies_service
from backend.services import extractor
from backend.services import identify as identify_service

router = APIRouter(tags=["extract"])


@router.post("/extract")
async def do_extract(body: ExtractRequest):
    url = (body.url or "").strip()
    if not url:
        raise errors.AppError(errors.MISSING_URL, 400)
    if not extractor.URL_RE.match(url):
        raise errors.AppError(errors.BAD_URL, 400)

    url = url.split("?")[0]  # drop tracking params

    try:
        payload = await extractor.extract(url)
    except extractor.ExtractError as e:
        raise errors.AppError(e.message, e.status) from e

    return payload


@router.post("/match/{token}")
async def match(token: str):
    job = extractor.get_token(token)
    if not job:
        raise errors.AppError(errors.MISSING_TOKEN, 404)

    jar = await asyncio.to_thread(cookies_service.cookiejar)
    song = await asyncio.to_thread(
        identify_service.identify, job["info"], job["path"], job.get("url", ""), jar
    )

    if not song or not song.get("track"):
        hint = (
            "No music sticker on the post, and the audio matched nothing. If someone "
            "is singing or playing the song themselves, fingerprinting can't match it "
            "— it only recognises the original recording. Search for it by name below."
        )
        if not COOKIES_FILE.exists() and not INSTA_COOKIES_BROWSER:
            hint += (
                " Setting up cookies would also let the app read Instagram's own music "
                "sticker, which names the song outright (see the README)."
            )
        result = {"identified": False, "reason": hint}
        extractor.set_match(token, result)
        return result

    if song.get("confidence") == "low":
        results = await asyncio.to_thread(identify_service.search_query, song["track"])
    else:
        results = await asyncio.to_thread(
            identify_service.find_on_youtube, song["track"], song.get("artist", "")
        )

    song_out = {
        "track": song.get("track"),
        "artist": song.get("artist"),
        "source": song.get("source"),
        "confidence": song.get("confidence"),
        "shazam_url": song.get("shazam_url"),
        "cover": song.get("cover"),
    }
    result = {"identified": True, "song": song_out, "results": results}
    extractor.set_match(token, result)
    return result


@router.get("/preview/{token}")
async def preview(token: str, dl: str | None = None):
    job = extractor.get_token(token)
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
async def search(body: SearchRequest):
    q = (body.q or "").strip()
    if not q:
        raise errors.AppError("Type something to search for.", 400)
    results = await asyncio.to_thread(identify_service.search_query, q)
    return {"results": results}
