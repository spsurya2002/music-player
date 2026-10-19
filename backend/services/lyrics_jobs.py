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

Not every version of the words is ours. The crawler refuses to guess, and when
it comes back empty the person asking can usually find the song on their own in
ten seconds — so a row also carries `mine`, the versions they typed or pasted
in themselves. Those are free, they survive a re-crawl, and the reading reads
them the same way it reads a crawled one.

The two halves spend two different allowances, because they cost two different
things. Finding words is a crawl — our own bandwidth — and spends a `lyrics`
use, held when the worker starts and **refunded unless words actually turned
up**, so the crawler declining to guess stays free: putting a price on the
honest empty answer is the one thing this must not do. The reading is a Gemini
call and somebody's bill, so it spends a `meaning` use, which is a smaller
allowance of its own (backend/services/quota.py) and is refunded the same way
when no reading comes back.
"""

import asyncio
import logging
import re
import uuid

from pymongo.errors import DuplicateKeyError

from backend import db, errors
from backend.config import MAX_MY_LYRICS_CHARS, MAX_MY_VERSIONS
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

# Somebody pressed Stop. A finished lookup like `not_found` is, and for the same
# reason: nothing went wrong, the answer is just that there isn't one. Kept
# distinct from `failed` so the page can offer "Try again" without an apology,
# and so a stopped row is never mistaken for a fault worth investigating.
STOPPED = "stopped"

# Nobody crawled: the row exists so somebody's own words have somewhere to
# live. Inert to the worker, which only ever claims `queued`.
MANUAL = "manual"

# `meaning_state` uses the same words, plus None for "nobody has asked". LIMITED
# only ever appears here now: the words are free, so only a reading can run out.
MEANING_STATES = (QUEUED, RUNNING, DONE, FAILED, LIMITED)

# Cleared whenever a row goes back on the queue, so a retry never shows the
# previous attempt's answer next to the new attempt's spinner.
#
# `mine`, `manual_title` and `manual_artist` are deliberately absent: those are
# not an attempt at anything, they are what somebody typed, and a re-crawl must
# not take them. Adding one of them here would quietly delete a person's own
# lyrics every time they pressed "Look again".
_BLANK = {
    "meaning_state": None,
    "meaning_version": None,
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
        # The names somebody typed themselves are searched too, and matter
        # more here than anywhere: a lookup that found nothing has no resolved
        # names at all, so what they called it is the only title it has. The
        # words inside a version are not searched — this list is of songs, and
        # a line of a lyric matching is not somebody looking for that song.
        query["$or"] = [
            {"query": {"$regex": needle, "$options": "i"}},
            {"resolved.title": {"$regex": needle, "$options": "i"}},
            {"resolved.artist": {"$regex": needle, "$options": "i"}},
            {"video.title": {"$regex": needle, "$options": "i"}},
            {"manual_title": {"$regex": needle, "$options": "i"}},
            {"manual_artist": {"$regex": needle, "$options": "i"}},
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


async def cancel(user_id: str, row_id: str) -> dict | None:
    """Stop a lookup that is still going.

    Queued work is genuinely called off: the worker only ever claims rows in
    `queued`, so moving this one out means it never starts.

    Work already running is a different promise, and a smaller one. The crawl is
    out over `asyncio.to_thread` and a thread cannot be cancelled — and killing
    the task that waits on it would be worse than useless, because the worker
    would move straight on to the next row and the sidecar would be crawling
    twice at once. It keeps its politeness state in process memory (when it last
    hit each host, which engines have started refusing it), so two at a time is
    how the whole thing gets blocked. So the crawl is left to finish and its
    answer is thrown away: `_finish` only writes to a row still in `running`.

    What stops immediately is everything the person can see — the page settles,
    the row is theirs again, and nothing is charged for a reading nobody got.

    Both halves are one conditional update, so this and the worker finishing can
    land in either order and exactly one of them takes effect. Pressing Stop on
    a lookup that has just this second landed is therefore not an error: it
    returns the finished row, which is the truth.
    """
    row = await get_by_id(user_id, row_id)
    if not row:
        return None

    ts = now()
    # Words first: a reading cannot be running while the words still are.
    if row.get("state") in ACTIVE:
        stopped = await db.lyrics_col.find_one_and_update(
            {"_id": row["_id"], "user_id": user_id, "state": {"$in": list(ACTIVE)}},
            {"$set": {
                "state": STOPPED,
                "error": errors.LYRICS_STOPPED,
                "finished_at": ts,
                "updated_at": ts,
            }},
            return_document=True,
        )
        if stopped:
            return stopped

    if row.get("meaning_state") in ACTIVE:
        stopped = await db.lyrics_col.find_one_and_update(
            {"_id": row["_id"], "user_id": user_id, "meaning_state": {"$in": list(ACTIVE)}},
            {"$set": {
                "meaning_state": STOPPED,
                "meaning_note": errors.MEANING_STOPPED,
                "updated_at": ts,
            }},
            return_document=True,
        )
        if stopped:
            return stopped

    # It finished between the press and here. Nothing to stop, and the row that
    # comes back says so.
    return await get_by_id(user_id, row_id)


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


async def enqueue_meaning(user_id: str, row_id: str, version: str | None = None) -> dict:
    """Ask for the reading of words this row already has.

    The dearest step, and the only one that spends a `meaning` use, so that is
    the limit checked here — while the page is still open, rather than as a row
    that fails later with nobody watching. The use itself is held when the
    worker picks it up.

    `version` names which words to read: one of the person's own, or None for
    the best the crawler found, which is what every call meant before versions
    could be yours. A row carries one reading, so naming a different version
    replaces the one already there and spends another use doing it — the page
    asks before it comes to that.
    """
    row = await get_by_id(user_id, row_id)
    if not row:
        raise errors.AppError(errors.MISSING_LYRICS, 404)

    if version:
        # Deleted between the page rendering the button and the press.
        if lyrics.mine_of(row, version) is None:
            raise errors.AppError(errors.MISSING_MY_LYRICS, 404)
    elif row.get("state") != DONE or not row.get("text"):
        raise errors.AppError(errors.NO_WORDS_YET, 400)

    if row.get("meaning_state") in ACTIVE:
        return row

    # A reading already in hand is never paid for twice — and the test is the
    # reading itself, not its state, because rows written before the two steps
    # were split carry a meaning with no `meaning_state` beside it. Asking
    # about a *different* version is not that: it is a second question.
    same = row.get("meaning_version") == version
    if row.get("meaning") and same:
        return row

    await quota.check(user_id, quota.MEANING)
    changes = {
        "meaning_state": QUEUED,
        "meaning_version": version,
        "meaning_note": None,
        "updated_at": now(),
    }
    if not same:
        # The old reading explained somebody else's words line by line. Leaving
        # it up while the new one runs would pair every line of the version now
        # on screen with a note written about a different one.
        changes["meaning"] = None
    await db.lyrics_col.update_one({"_id": row["_id"]}, {"$set": changes})
    return await get_by_id(user_id, row_id)


# --- words of your own ------------------------------------------------------
#
# Free, all of it: there is no crawl and no model call behind a paste, and the
# whole point of the feature is that it is the answer when the paid path came
# back empty. The reading is still the step that costs.


def _clean_text(text: str) -> str:
    """Line breaks are the only structure the book reads (LyricsBook splits on
    them), so the three kinds a browser can send are flattened to one."""
    return (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _checked_text(text: str) -> str:
    text = _clean_text(text)
    if not text:
        raise errors.AppError(errors.MISSING_LYRICS_TEXT, 400)
    if len(text) > MAX_MY_LYRICS_CHARS:
        raise errors.AppError(errors.LYRICS_TEXT_TOO_LONG, 413)
    return text


def _mine_entry(row: dict, version_id: str) -> dict:
    for entry in row.get("mine") or []:
        if entry.get("id") == version_id:
            return entry
    raise errors.AppError(errors.MISSING_MY_LYRICS, 404)


async def _row_or_404(user_id: str, row_id: str) -> dict:
    row = await get_by_id(user_id, row_id)
    if not row:
        raise errors.AppError(errors.MISSING_LYRICS, 404)
    return row


async def add_mine(user_id: str, row_id: str, text: str, label: str | None) -> dict:
    """Add words of your own to a lookup.

    Saving words into a row keeps it, the same rule filing one in a collection
    follows (routers/lyrics.py): otherwise your own lyrics would live in a row
    All lyrics never lists, which is the one place you would go to find them.

    The label is left empty when none is given rather than filled in here — the
    switcher names a version after its script, and that map already exists on
    the page, next to the crawler's own versions it has to match.
    """
    row = await _row_or_404(user_id, row_id)
    text = _checked_text(text)
    if len(row.get("mine") or []) >= MAX_MY_VERSIONS:
        raise errors.AppError(errors.TOO_MANY_VERSIONS, 409)

    ts = now()
    entry = {
        "id": uuid.uuid4().hex,
        "label": (label or "").strip(),
        "text": text,
        "script": lyrics.script_of(text),
        "created_at": ts,
        "updated_at": ts,
    }
    await db.lyrics_col.update_one(
        {"_id": row["_id"], "user_id": user_id},
        {"$push": {"mine": entry}, "$set": {"kept": True, "updated_at": ts}},
    )
    return await _row_or_404(user_id, row_id)


async def edit_mine(
    user_id: str, row_id: str, version_id: str, text: str | None, label: str | None
) -> dict:
    """Correct a version already saved. Either field may be left out, which
    means "leave it" rather than "clear it"."""
    row = await _row_or_404(user_id, row_id)
    _mine_entry(row, version_id)

    ts = now()
    changes: dict = {"mine.$[v].updated_at": ts, "updated_at": ts}
    if text is not None:
        clean = _checked_text(text)
        changes["mine.$[v].text"] = clean
        changes["mine.$[v].script"] = lyrics.script_of(clean)
        if row.get("meaning") and row.get("meaning_version") == lyrics.mine_key(version_id):
            # The reading is line by line, against the words as they were. New
            # words make it a commentary on a text that no longer exists, and
            # the page says so before letting this happen.
            changes["meaning"] = None
            changes["meaning_version"] = None
            changes["meaning_state"] = None
            changes["meaning_note"] = None
    if label is not None:
        changes["mine.$[v].label"] = label.strip()

    await db.lyrics_col.update_one(
        {"_id": row["_id"], "user_id": user_id},
        {"$set": changes},
        array_filters=[{"v.id": version_id}],
    )
    return await _row_or_404(user_id, row_id)


async def delete_mine(user_id: str, row_id: str, version_id: str) -> dict:
    row = await _row_or_404(user_id, row_id)
    _mine_entry(row, version_id)

    changes: dict = {"updated_at": now()}
    if row.get("meaning_version") == lyrics.mine_key(version_id):
        changes.update(
            {"meaning": None, "meaning_version": None, "meaning_state": None, "meaning_note": None}
        )
    await db.lyrics_col.update_one(
        {"_id": row["_id"], "user_id": user_id},
        {"$pull": {"mine": {"id": version_id}}, "$set": changes},
    )
    return await _row_or_404(user_id, row_id)


async def set_names(
    user_id: str, row_id: str, title: str | None, artist: str | None
) -> dict:
    """What to call a lookup.

    A crawl that found nothing has no resolved names, so the only title such a
    row has is the raw thing that was pasted — a YouTube URL, usually, which is
    not a song name and does not fit on the page. These are what it shows
    instead, and what the reading is asked about.
    """
    row = await _row_or_404(user_id, row_id)
    changes: dict = {"updated_at": now()}
    if title is not None:
        changes["manual_title"] = title.strip()
    if artist is not None:
        changes["manual_artist"] = artist.strip()
    await db.lyrics_col.update_one({"_id": row["_id"], "user_id": user_id}, {"$set": changes})
    return await _row_or_404(user_id, row_id)


async def ensure_row_for_song(song: dict, user_id: str) -> dict:
    """A row to hang your own words off, for a song nobody has looked up.

    An upsert rather than an insert, and `$setOnInsert` only: pressing "add
    them yourself" on a song whose lookup already ran has to land on that
    lookup's row — not start a second one the unique index would refuse, and
    not reset a finished one to `manual`.
    """
    key = song_key(str(song["_id"]))
    ts = now()
    try:
        await db.lyrics_col.update_one(
            {"user_id": user_id, "key": key},
            {
                "$setOnInsert": {
                    "state": MANUAL,
                    "origin": SONG,
                    "song_id": str(song["_id"]),
                    "query": lyrics.query_for(song),
                    "refresh": False,
                    "created_at": ts,
                    "updated_at": ts,
                    "kept": True,
                    **_BLANK,
                }
            },
            upsert=True,
        )
    except DuplicateKeyError:
        # Two presses at once; the loser just reads the row the winner made.
        pass

    row = await get(user_id, key)
    if not row:
        # Only reachable if the song was deleted mid-press, which takes its
        # lyrics row with it (routers/songs.py).
        raise errors.AppError(errors.MISSING_SONG, 404)
    return row


async def forget_song(user_id: str, song_id: str) -> None:
    """Drop a song's lyrics when the song goes. Called from the delete route so
    a row can't outlive the thing it describes."""
    await db.lyrics_col.delete_one({"user_id": user_id, "key": song_key(song_id)})


async def _finish(row_id, half: str = "words", **fields) -> bool:
    """Write a result, unless the half it belongs to has stopped running.

    The condition is the whole of how Stop works. A crawl reaches the sidecar
    over `asyncio.to_thread`, and a thread cannot be cancelled — so pressing
    Stop can't reach into the request that is already out. What it can do is
    take the row out of `running`, and then this update matches nothing and the
    answer is dropped on the floor when it finally arrives.

    Doing it as one conditional write rather than a flag checked beforehand is
    what makes it race-free: Stop and the worker finishing can land in either
    order and exactly one of them wins.

    Returns whether the write applied, which the caller needs — a reading whose
    result was discarded must give its quota hold back rather than spend it.
    """
    ts = now()
    field = "state" if half == "words" else "meaning_state"
    result = await db.lyrics_col.update_one(
        {"_id": row_id, field: RUNNING},
        {"$set": {"finished_at": ts, "updated_at": ts, **fields}},
    )
    return result.matched_count > 0


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
    """Find the words. A `lyrics` use is held for the length of it and kept only
    if words actually came back — a crawl that found nothing, was stopped, or
    broke costs nothing, which is what keeps the crawler's honest "no" free."""
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

    try:
        hold = await quota.reserve(user_id, quota.LYRICS)
    except errors.AppError as exc:
        if exc.status != 402:
            raise
        # Only reachable as a race: _queue checks the limit while the page is
        # still open, so by the time the worker gets here the answer is
        # normally known. Two rows queued on one remaining use is the case.
        await _finish(row["_id"], "words", state=FAILED, error=exc.message)
        return

    try:
        refresh = bool(row.get("refresh"))
        looked = (
            await lyrics.lookup(song, refresh=refresh)
            if song is not None
            else await lyrics.lookup_query(row.get("query") or "", refresh=refresh)
        )
    except BaseException:
        await quota.release(hold)
        raise

    kept = await _finish(row["_id"], "words", **looked.fields)

    # Words on the page is the only outcome worth charging for — `looked.found`
    # is the lookup's own verdict on that. `kept` is false when Stop got there
    # first and the answer was thrown away, so settling after the write rather
    # than before it is what makes a stopped lookup free.
    if kept and looked.found:
        await quota.settle(hold)
    else:
        await quota.release(hold)


async def _process_meaning(row: dict) -> None:
    """Read the words. A `meaning` use is held for the length of it and kept
    only if a reading actually came back."""
    user_id = row["user_id"]

    try:
        hold = await quota.reserve(user_id, quota.MEANING)
    except errors.AppError as exc:
        if exc.status != 402:
            raise
        await _finish(row["_id"], "meaning", meaning_state=LIMITED, meaning_note=exc.message)
        return

    try:
        meaning, note = await lyrics.explain_stored(row)
    except BaseException:
        await quota.release(hold)
        raise

    kept = await _finish(
        row["_id"],
        "meaning",
        meaning_state=DONE if meaning else FAILED,
        meaning=meaning,
        meaning_note=note,
    )

    # A note instead of a reading means we got nothing worth paying for — no key
    # configured, lyrics too long, the model refusing. Neither is a reading the
    # person stopped before it landed: that one is written nowhere and so is
    # charged for nothing, which is the point of settling after the write
    # rather than before it.
    if meaning and kept:
        await quota.settle(hold)
    else:
        await quota.release(hold)


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
        await _finish(row["_id"], "words", state=FAILED, error=message)
    else:
        await _finish(row["_id"], "meaning", meaning_state=FAILED, meaning_note=message)


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
