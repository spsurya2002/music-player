"""Auto-ingest: a reel URL arrives from somewhere that isn't the paste box,
and turns into a library row without anybody watching.

The share sheet hands us a link and expects an answer immediately, but the work
behind it — yt-dlp, ffmpeg, a Shazam lookup, a YouTube search — runs for tens of
seconds. So POST /api/ingest only writes a row here and returns; a worker task
started at boot drains the queue behind it. That also keeps the request well
under the 100s Cloudflare gives a tunnelled request before it returns a 524.

Unlike extract tokens and identify jobs, this queue lives in Mongo rather than
process memory: a share can arrive at any moment, and losing a queued reel to a
restart would be losing something the person already asked for. Tokens are still
memory, which is why anything left `running` at boot is requeued rather than
resumed — its temp file died with the process.

The worker runs one job at a time on purpose. Extraction is heavy and Instagram
rate-limits a session that asks too fast; a queue of five reels is worth five
minutes, not a ban.

Each reel spends a reel use (backend.services.quota) the same as the paste box
does: held when the job starts, kept once the song is saved, given back if the
job fails or the reel turned out to be in the library already. A job that finds
the limit used up ends as `limited` rather than `failed`, so the Inbox can offer
the way to ask for more instead of reading as something broken.
"""

import asyncio
import logging

from backend import db, errors
from backend.serializers import iso, now
from backend.services import extractor, pipeline, quota

log = logging.getLogger("reel_audio.ingest")

# How long the worker sleeps when it finds nothing to do. Short enough that a
# shared reel starts processing while the person is still looking at the screen.
IDLE_SECONDS = 2

# States a row moves through. `duplicate` is a success — the reel is in the
# library, it just didn't need saving twice. `limited` is a stop, not a fault:
# the reel limit ran out before this one's turn came.
QUEUED, RUNNING, DONE, DUPLICATE, FAILED = "queued", "running", "done", "duplicate", "failed"
LIMITED = "limited"
ACTIVE = (QUEUED, RUNNING)

_worker: asyncio.Task | None = None


def job_to_dict(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "url": doc.get("url"),
        "state": doc.get("state"),
        "origin": doc.get("origin"),
        "song_id": doc.get("song_id"),
        "title": doc.get("title"),
        "error": doc.get("error"),
        "created_at": iso(doc.get("created_at")),
        "finished_at": iso(doc.get("finished_at")),
    }


async def enqueue(url: str, user_id: str, origin: str = "share") -> dict:
    """Validate and queue one reel. Returns the row, already serialised.

    A URL that's already queued for this person comes back as the existing row
    rather than a second one — double-tapping the share sheet is a thing people
    do, and it shouldn't cost two downloads.
    """
    url = (url or "").strip()
    if not url:
        raise errors.AppError(errors.MISSING_URL, 400)
    if not extractor.URL_RE.match(url):
        raise errors.AppError(errors.BAD_URL, 400)
    url = url.split("?")[0]  # drop tracking params, as POST /api/extract does

    # Said now, while the share screen is still open, rather than as a row that
    # fails later with nobody looking. Only a check: the use is held when the
    # worker gets to it, since several shares can queue up behind the last one.
    await quota.check(user_id, quota.REEL)

    pending = await db.ingest_col.find_one(
        {"user_id": user_id, "url": url, "state": {"$in": list(ACTIVE)}}
    )
    if pending:
        return job_to_dict(pending)

    doc = {
        "user_id": user_id,
        "url": url,
        "origin": origin,
        "state": QUEUED,
        "song_id": None,
        "title": None,
        "error": None,
        "created_at": now(),
        "finished_at": None,
    }
    result = await db.ingest_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return job_to_dict(doc)


async def list_jobs(user_id: str, limit: int = 20) -> list[dict]:
    cursor = db.ingest_col.find({"user_id": user_id}).sort("created_at", -1).limit(limit)
    return [job_to_dict(d) async for d in cursor]


async def clear_finished(user_id: str) -> int:
    """Tidy the list without touching anything still in flight."""
    result = await db.ingest_col.delete_many(
        {"user_id": user_id, "state": {"$nin": list(ACTIVE)}}
    )
    return result.deleted_count


async def _finish(job_id, **fields) -> None:
    await db.ingest_col.update_one({"_id": job_id}, {"$set": {"finished_at": now(), **fields}})


async def _claim() -> dict | None:
    """Take the oldest queued row, atomically, so a second worker can't take it too."""
    return await db.ingest_col.find_one_and_update(
        {"state": QUEUED},
        {"$set": {"state": RUNNING, "started_at": now()}},
        sort=[("created_at", 1)],
        return_document=True,
    )


async def _process(job: dict) -> None:
    """Extract, identify, save — the three calls the paste box makes, back to back.

    Identification is awaited before saving rather than skipped for speed: the
    YouTube matches are cached against the token and nowhere else, so saving
    early would drop them permanently.
    """
    user_id = job["user_id"]
    url = job["url"]

    try:
        hold = await quota.reserve(user_id, quota.REEL)
    except errors.AppError as exc:
        if exc.status != 402:
            raise
        await _finish(job["_id"], state=LIMITED, error=exc.message)
        return

    try:
        saved = await _extract_and_save(url, user_id)
    except BaseException:
        await quota.release(hold)
        raise

    # A duplicate delivered nothing new, so it doesn't cost anything either.
    if saved.duplicate:
        await quota.release(hold)
    else:
        await quota.settle(hold)

    await _finish(
        job["_id"],
        state=DUPLICATE if saved.duplicate else DONE,
        song_id=saved.song["id"],
        title=saved.song.get("title"),
    )


async def _extract_and_save(url: str, user_id: str) -> pipeline.Saved:
    payload = await extractor.extract(url, user_id)
    token = payload["token"]

    try:
        # Best-effort, exactly as it is for a person: a reel nobody can name is
        # still an MP3 worth keeping, so a failed lookup must not fail the save.
        try:
            await pipeline.match_token(token, user_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("ingest: identification failed for %s: %s", url, exc)

        saved = await pipeline.save_token(token, user_id)
    finally:
        # save_token retires the token itself once the song is in GridFS, and
        # discarding a spent one is a no-op — so this is here for the two paths
        # that don't get that far: a reel already in the library, and a failure.
        # Nobody is watching an auto-ingest, so a temp file left behind here is
        # one nobody would ever notice filling the disk.
        extractor.discard(token)

    return saved


async def _loop() -> None:
    while True:
        try:
            job = await _claim()
            if not job:
                await asyncio.sleep(IDLE_SECONDS)
                continue
            try:
                await _process(job)
            except errors.AppError as exc:
                await _finish(job["_id"], state=FAILED, error=exc.message)
            except extractor.ExtractError as exc:
                await _finish(job["_id"], state=FAILED, error=exc.message)
            except Exception as exc:  # noqa: BLE001
                log.exception("ingest: job %s failed", job["_id"])
                await _finish(job["_id"], state=FAILED, error=f"Unexpected error: {exc}")
        except asyncio.CancelledError:
            raise
        except Exception:
            # The queue itself misbehaved (Mongo blipped). Never let that kill
            # the worker — nothing would restart it short of a reboot.
            log.exception("ingest: worker loop error")
            await asyncio.sleep(IDLE_SECONDS)


async def requeue_stale() -> int:
    """Anything `running` at boot was interrupted by the restart that got us here.

    Its extract token and temp file are gone with the old process, so the work
    has to start over rather than resume.
    """
    result = await db.ingest_col.update_many(
        {"state": RUNNING}, {"$set": {"state": QUEUED, "error": None}}
    )
    return result.modified_count


def start() -> None:
    global _worker
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_loop(), name="ingest-worker")


async def stop() -> None:
    global _worker
    if _worker is not None:
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
        _worker = None
