"""Find the song in a file you already have: POST /api/identify,
GET /api/identify/{job}, GET /api/identify/{job}/audio.

Nothing here touches MongoDB. An upload lands in config.UPLOAD_DIR, a background
job (backend.services.ident_jobs) runs the tier pipeline over it, and the page
polls until a YouTube link comes back. Identification itself lives in
backend.services.file_identify and is not re-implemented or tuned here — this
module only moves bytes and shapes the answer for the client.
"""

import asyncio
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse

from backend import errors
from backend.config import MAX_UPLOAD_BYTES, UPLOAD_DIR
from backend.models import SearchRequest
from backend.services import ident_jobs
from backend.services import identify as identify_service

router = APIRouter(tags=["identify"])

ALLOWED = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".opus", ".mp4", ".webm"}

CHUNK = 1024 * 1024


@router.post("/identify")
async def start_identify(audio: UploadFile = File(default=None)):
    if audio is None or not audio.filename:
        raise errors.AppError(errors.MISSING_UPLOAD, 400)

    suffix = Path(audio.filename).suffix.lower()
    if suffix not in ALLOWED:
        raise errors.AppError(
            f"{suffix or 'That file type'} isn't audio I can read — try MP3, M4A, WAV or FLAC.",
            400,
        )

    # A generated name under UPLOAD_DIR: the uploaded filename is only ever shown
    # back to the user, never used as a path.
    path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    written = 0
    try:
        with path.open("wb") as fh:
            while chunk := await audio.read(CHUNK):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise errors.AppError(
                        "That file is over 64 MB — a single track shouldn't be.", 413
                    )
                fh.write(chunk)
    except errors.AppError:
        path.unlink(missing_ok=True)
        raise

    if written == 0:
        path.unlink(missing_ok=True)
        raise errors.AppError("That file is empty.", 400)

    job_id = ident_jobs.start(path, audio.filename)
    return {"job": job_id, "file": audio.filename, "size": written}


@router.get("/identify/{job_id}")
async def identify_status(job_id: str):
    job = ident_jobs.get(job_id)
    if not job:
        raise errors.AppError(errors.MISSING_JOB, 404)

    return {
        "job": job_id,
        "state": job["state"],
        "file": job["file"],
        "log": job["log"],
        "error": job["error"],
        "result": job["result"],
    }


@router.post("/identify/{job_id}/search")
async def identify_search(job_id: str, body: SearchRequest):
    """Overrule the tiers by hand. Identification is probabilistic — a caption
    can name the wrong thing and a cover can defeat every fingerprint — so the
    page needs a two-second correction that the save then picks up."""
    job = ident_jobs.get(job_id)
    if not job:
        raise errors.AppError(errors.MISSING_JOB, 404)

    q = (body.q or "").strip()
    if not q:
        raise errors.AppError("Type something to search for.", 400)

    results = await asyncio.to_thread(identify_service.search_query, q)
    result = ident_jobs.set_results(job_id, q, results)
    return {"result": result}


@router.get("/identify/{job_id}/audio")
async def identify_audio(job_id: str):
    """Play back whatever was uploaded, so you can check it's the right file."""
    job = ident_jobs.get(job_id)
    path = Path(job["path"]) if job else None
    if not path or not path.exists():
        raise errors.AppError(errors.MISSING_JOB, 404)

    media_type = mimetypes.guess_type(path.name)[0] or "audio/mpeg"
    return FileResponse(path, media_type=media_type)
