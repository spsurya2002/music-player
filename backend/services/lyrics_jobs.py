"""The lyrics queue: one row per person per song, which is both job and result.

Finding lyrics takes tens of seconds — the open databases are quick, but a miss
falls through to scraping search engines and crawling up to eight pages, and
then Gemini takes its own time. So POST /api/songs/{id}/lyrics only writes a row
and returns 202, well inside the 100s Cloudflare allows a tunnelled request
before it gives up with a 524. The song page polls the row until it settles.

The row is the job *and* the answer, in one document, because there is only ever
one of each per song: the unique index on (user_id, song_id) means a second
click lands on the row already running instead of starting a rival lookup, and
a finished row is just that row with its fields filled in. Nothing to join, and
nothing to expire — the lyrics outlive the job that found them.

In Mongo rather than process memory (unlike extract tokens and identify jobs)
because the result is worth keeping: it took a crawl and a model call to get,
and re-earning it after every restart would be paying twice. Anything left
`running` at boot is requeued rather than resumed, since the work it stood for
died with the process.

One job at a time, and that is a requirement rather than tidiness. The sidecar
keeps its politeness state in process memory — when it last hit each host, which
search engines have started refusing it, what each robots.txt said — so two
crawls at once would double its request rate at Bing and get the whole thing
blocked. The worker is separate from the ingest one so a slow crawl can't park a
reel somebody shared from their phone.

A row has two halves and two states. `state` is the words: queued, running, then
done or not_found. `meaning_state` is the reading, and starts as None because
nobody has asked — it only moves once someone presses the button.

Finding words is free. It costs a crawl, which is ours to spend, and charging
for it would put a price on the honest answer when the crawler declines to
guess. The reading is a Gemini call and real money, so that is the half that
spends a `lyrics` use — held when the worker starts it, kept only if a reading
came back.
"""

import asyncio
import logging
import re

from pymongo.errors import DuplicateKeyError

from backend import db, errors
from backend.serializers import now
from backend.services import lyrics, quota
from backend.storage import to_object_id

log = logging.getLogger("reel_audio.lyrics_jobs")

# Matches services/ingest.py: short enough that a lookup starts while the person
# is still looking at the song page.
IDLE_SECONDS = 2

# `not_found` is a finished lookup, not a fault — the crawler looked and refused
# to guess. `limited` is a stop rather than a failure: the lyric limit ran out
# before this one's turn, so the page can offer the way to ask for more.
QUEUED, RUNNING, DONE = "queued", "running", "done"
NOT_FOUND, FAILED, LIMITED = "not_found", "failed", "limited"
ACTIVE = (QUEUED, RUNNING)

# `meaning_state` uses the same words, plus None for "nobody has asked". LIMITED
# only ever appears here now: the words are free, so only a reading can run out.
MEANING_STATES = (QUEUED, RUNNING, DONE, FAILED, LIMITED)

# Cleared whenever a row goes back on the queue, so a retry never shows the
# previous attempt's answer next to the new attempt's spinner.
_BLANK = {
    "meaning_state": None,
    "text": None,
    "source": None,
    "alternatives": [],
    "crawled": [],
    "meaning": None,
    "meaning_note": None,
    "resolved": None,
    "video": None,
    "error": None,
    "finished_at": None,
}

# The two kinds of lookup. A song lookup belongs to a row in the library; a
# search is something someone pasted or typed on the Lyrics page and may not
# correspond to anything saved.
SONG, SEARCH = "song", "search"

# A search starts unkept: the row has to exist for the worker to write into,
# but it stays out of the library until the person who ran it says to keep it
# (`keep_row`, or adding it to a collection). A song lookup is kept from the
# start — it was asked for from a song already in the library, and it is shown
# on that song's page rather than listed on its own.
#
# Rows written before this flag existed have no `kept` field at all, so every
# test is "not False" rather than "is True": a missing flag means kept, or one
# deploy would empty everybody's lyrics library.
def _kept_at_birth(origin: str) -> bool:
    return origin != SEARCH

_worker: asyncio.Task | None = None


def song_key(song_id: str) -> str:
    return f"song:{song_id}"


def search_key(query: str) -> str:
    """Searches dedupe on the query, loosely: trailing spaces and capitals
    shouldn't buy a second crawl of the same song. Not normalised any harder
    than that, because the finder treats a YouTube link and a typed name
    differently and they should stay different rows."""
    return "q:" + " ".join((query or "").lower().split())


async def get(user_id: str, key: str) -> dict | None:
    """This person's row under this key, or None. Scoped to the pair, which is
    the unique index — someone else's id finds nothing here."""
    return await db.lyrics_col.find_one({"user_id": user_id, "key": key})


async def get_by_id(user_id: str, row_id: str) -> dict | None:
    oid = to_object_id(row_id)
    return await db.lyrics_col.find_one({"_id": oid, "user_id": user_id}) if oid else None


async def list_rows(
    user_id: str, limit: int = 50, origin: str | None = None, q: str | None = None
) -> list[dict]:
    """The saved lyrics list, newest first.

    `q` matches the names the finder worked out as well as what was typed, so
    searching for a song finds the lookup even when what was pasted was a bare
    YouTube URL with the title nowhere in it. A plain case-insensitive contains
    rather than backend/search.py's scoring: that one ranks across a song
    document's many name-ish fields, and a lyrics row has two.
    """
    # Unkept rows are lookups nobody has said to keep yet. They are reachable
    # by their own URL — that is the page doing the asking — but this is the
    # library, and they are not in it.
    query: dict = {"user_id": user_id, "kept": {"$ne": False}}
    if origin:
        query["origin"] = origin
    if q and q.strip():
        needle = re.escape(q.strip())
        query["$or"] = [
            {"query": {"$regex": needle, "$options": "i"}},
            {"resolved.title": {"$regex": needle, "$options": "i"}},
            {"resolved.artist": {"$regex": needle, "$options": "i"}},
            {"video.title": {"$regex": needle, "$options": "i"}},
        ]
    cursor = db.lyrics_col.find(query).sort("created_at", -1).limit(limit)
    return [d async for d in cursor]


async def keep_row(user_id: str, row_id: str) -> bool:
    """Say yes to a finished lookup: it joins the library.

    Idempotent, and deliberately not fussy about state — a row can only be
    offered once there is something to read, and re-saving one already saved
    should not be an error.
    """
    oid = to_object_id(row_id)
    if not oid:
        return False
    result = await db.lyrics_col.update_one(
        {"_id": oid, "user_id": user_id}, {"$set": {"kept": True, "updated_at": now()}}
    )
    return result.matched_count > 0


async def delete_row(user_id: str, row_id: str) -> bool:
    oid = to_object_id(row_id)
    if not oid:
        return False
    result = await db.lyrics_col.delete_one({"_id": oid, "user_id": user_id})
    return bool(result.deleted_count)


async def enqueue(song: dict, user_id: str, refresh: bool = False) -> dict:
    """Queue a lookup for a song in the library."""
    return await _queue(
        user_id,
        key=song_key(str(song["_id"])),
        origin=SONG,
        query=lyrics.query_for(song),
        song_id=str(song["_id"]),
        refresh=refresh,
    )


async def enqueue_search(query: str, user_id: str, refresh: bool = False) -> dict:
    """Queue a lookup for a pasted link or a typed song name.

    The query goes to the finder exactly as typed: it does its own parsing, and
    a YouTube link resolves through oEmbed and the iTunes catalogue into a real
    artist and title. Splitting it here first would throw that away.
    """
    query = (query or "").strip()
    if not query:
        raise errors.AppError(errors.MISSING_LYRICS_QUERY, 400)
    if len(query) > 300:
        raise errors.AppError(errors.LYRICS_QUERY_TOO_LONG, 400)
    return await _queue(
        user_id,
        key=search_key(query),
        origin=SEARCH,
        query=query,
        song_id=None,
        refresh=refresh,
    )


async def _queue(
    user_id: str, key: str, origin: str, query: str, song_id: str | None, refresh: bool
) -> dict:
    """Put a lookup on the queue, or hand back the row that already answers it.

    Asking twice doesn't start two crawls, and asking again for something we
    already found doesn't spend a second use — only `refresh` re-runs a finished
    lookup. A row that failed or found nothing is retried without one: the
    button under it says "Try again", and meaning it is the whole reason to
    press it.
    """
    existing = await get(user_id, key)
    if existing:
        if existing["state"] in ACTIVE:
            return existing
        if existing["state"] == DONE and not refresh:
            return existing

    # Said now, while the page is still open, rather than as a row that fails
    # later with nobody watching. Only a check — the use is held when the worker
    # reaches this row, since others may be queued ahead of it.
    await quota.check(user_id, quota.LYRICS)

    ts = now()
    try:
        await db.lyrics_col.update_one(
            {"user_id": user_id, "key": key},
            {
                "$set": {
                    "state": QUEUED,
                    "origin": origin,
                    "song_id": song_id,
                    "query": query,
                    "refresh": bool(refresh),
                    "updated_at": ts,
                    **_BLANK,
                },
                "$setOnInsert": {"created_at": ts, "kept": _kept_at_birth(origin)},
            },
            upsert=True,
        )
    except DuplicateKeyError:
        # Two first clicks landed at once: both found no row, both tried to
        # insert one, and the unique index let exactly one through. The winner
        # queued the same lookup this call wanted, so there is nothing to do but
        # hand back its row — which is what a second click gets anyway.
        pass

    row = await get(user_id, key)
    # Only reachable if the song was deleted mid-click, which takes the row with
    # it (see routers/songs.py).
    if not row:
        raise errors.AppError(errors.MISSING_SONG, 404)
    return row


async def enqueue_meaning(user_id: str, row_id: str) -> dict:
    """Ask for the reading of a row whose words are already found.

    The one paid step, so the limit is checked here, while the page is still
    open, rather than as a row that fails later with nobody watching. The use
    itself is held when the worker picks it up.
    """
    row = await get_by_id(user_id, row_id)
    if not row:
        raise errors.AppError(errors.MISSING_LYRICS, 404)
    if row.get("state") != DONE:
        raise errors.AppError(errors.NO_WORDS_YET, 400)
    if row.get("meaning_state") in ACTIVE:
        return row
    # A reading already in hand is never paid for twice — and the test is the
    # reading itself, not its state, because rows written before the two steps
    # were split carry a meaning with no `meaning_state` beside it.
    if row.get("meaning"):
        return row

    await quota.check(user_id, quota.LYRICS)
    await db.lyrics_col.update_one(
        {"_id": row["_id"]},
        {"$set": {"meaning_state": QUEUED, "meaning_note": None, "updated_at": now()}},
    )
    return await get_by_id(user_id, row_id)


async def forget_song(user_id: str, song_id: str) -> None:
    """Drop a song's lyrics when the song goes. Called from the delete route so
    a row can't outlive the thing it describes."""
    await db.lyrics_col.delete_one({"user_id": user_id, "key": song_key(song_id)})


async def _finish(row_id, **fields) -> None:
    ts = now()
    await db.lyrics_col.update_one(
        {"_id": row_id}, {"$set": {"finished_at": ts, "updated_at": ts, **fields}}
    )


async def _claim() -> tuple[dict, str] | None:
    """Take the oldest piece of queued work, atomically, so a second worker
    can't take it too. Words first: they are quick, and a reading cannot start
    before them anyway.

    Returns the row and which half of it was claimed.
    """
    row = await db.lyrics_col.find_one_and_update(
        {"state": QUEUED},
        {"$set": {"state": RUNNING, "started_at": now()}},
        sort=[("created_at", 1)],
        return_document=True,
    )
    if row:
        return row, "words"

    row = await db.lyrics_col.find_one_and_update(
        {"meaning_state": QUEUED},
        {"$set": {"meaning_state": RUNNING}},
        sort=[("created_at", 1)],
        return_document=True,
    )
    return (row, "meaning") if row else None


async def _process_words(row: dict) -> None:
    """Find the words. Free — no hold, nothing to refund."""
    user_id = row["user_id"]
    song_id = row.get("song_id")
    song = None

    if song_id:
        oid = to_object_id(song_id)
        song = await db.songs_col.find_one({"_id": oid, "user_id": user_id}) if oid else None
        if not song:
            # Deleted while it sat in the queue. Nothing to look up, and nowhere
            # to show it; a search row has no song to lose and is never dropped.
            await db.lyrics_col.delete_one({"_id": row["_id"]})
            return

    refresh = bool(row.get("refresh"))
    looked = (
        await lyrics.lookup(song, refresh=refresh)
        if song is not None
        else await lyrics.lookup_query(row.get("query") or "", refresh=refresh)
    )
    await _finish(row["_id"], **looked.fields)


async def _process_meaning(row: dict) -> None:
    """Read the words. The paid half: a use is held for the length of it and
    kept only if a reading actually came back."""
    user_id = row["user_id"]

    try:
        hold = await quota.reserve(user_id, quota.LYRICS)
    except errors.AppError as exc:
        if exc.status != 402:
            raise
        await _finish(row["_id"], meaning_state=LIMITED, meaning_note=exc.message)
        return

    try:
        meaning, note = await lyrics.explain_stored(row)
    except BaseException:
        await quota.release(hold)
        raise

    # A note instead of a reading means we got nothing worth paying for — no
    # key configured, lyrics too long, the model refusing.
    if meaning:
        await quota.settle(hold)
    else:
        await quota.release(hold)

    await _finish(
        row["_id"],
        meaning_state=DONE if meaning else FAILED,
        meaning=meaning,
        meaning_note=note,
    )


async def _loop() -> None:
    while True:
        try:
            claimed = await _claim()
            if not claimed:
                await asyncio.sleep(IDLE_SECONDS)
                continue
            row, half = claimed
            try:
                if half == "words":
                    await _process_words(row)
                else:
                    await _process_meaning(row)
            except errors.AppError as exc:
                await _fail(row, half, exc.message)
            except Exception as exc:  # noqa: BLE001
                log.exception("lyrics: %s for row %s failed", half, row["_id"])
                await _fail(row, half, f"Unexpected error: {exc}")
        except asyncio.CancelledError:
            raise
        except Exception:
            # The queue itself misbehaved (Mongo blipped). Never let that kill
            # the worker — nothing would restart it short of a reboot.
            log.exception("lyrics: worker loop error")
            await asyncio.sleep(IDLE_SECONDS)


async def _fail(row: dict, half: str, message: str) -> None:
    """Mark whichever half broke, leaving the other alone — a reading that fails
    must not take found words down with it."""
    if half == "words":
        await _finish(row["_id"], state=FAILED, error=message)
    else:
        await _finish(row["_id"], meaning_state=FAILED, meaning_note=message)


async def requeue_stale() -> int:
    """Anything `running` at boot was interrupted by the restart that got us
    here. Its hold was already given back by quota.refund_orphans(), so this
    only has to put the work back on the queue."""
    words = await db.lyrics_col.update_many(
        {"state": RUNNING}, {"$set": {"state": QUEUED, "error": None}}
    )
    readings = await db.lyrics_col.update_many(
        {"meaning_state": RUNNING}, {"$set": {"meaning_state": QUEUED, "meaning_note": None}}
    )
    return words.modified_count + readings.modified_count


def start() -> None:
    global _worker
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_loop(), name="lyrics-worker")


async def stop() -> None:
    global _worker
    if _worker is not None:
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
        _worker = None
