"""Lyrics and what they mean — docs/API.md section 2a.

Two routes, both about one song: start a lookup, and read the row. The row is
the job and the result in the same document, so the page polls the same GET it
loaded with and needs no job id of its own (see services/lyrics_jobs.py).

Like every library route these take a CurrentUser and scope to `user.id`. The
song has to be theirs before anything happens, and the row is read by the
(user_id, song_id) pair, so an id out of somebody else's URL finds nothing
either way — a 404, the way their song itself would be.

Nothing here is reachable from routers/shared.py, and that is deliberate rather
than an omission. Lyrics belong to their publishers; we fetch them for the
person who owns the song and link back to where they came from. A public
playlist is readable with no session at all, so putting lyrics on that path
would turn personal use into republishing.
"""

from fastapi import APIRouter

from backend import db, errors
from backend.auth import CurrentUser
from pymongo.errors import DuplicateKeyError

from backend.models import (
    AddLyricsRequest,
    CreateLyricsSetRequest,
    LyricsRequest,
    LyricsSearchRequest,
    LyricsSetPatchRequest,
)
from backend.serializers import lyrics_set_to_dict, lyrics_to_dict, now
from backend.services import lyrics_jobs
from backend.storage import to_object_id

router = APIRouter(tags=["lyrics"])


async def _get_song_or_404(song_id: str, user_id: str) -> dict:
    oid = to_object_id(song_id)
    doc = await db.songs_col.find_one({"_id": oid, "user_id": user_id}) if oid else None
    if not doc:
        raise errors.AppError(errors.MISSING_SONG, 404)
    return doc


@router.get("/songs/{song_id}/lyrics")
async def get_lyrics(song_id: str, user: CurrentUser):
    """The row, or null when nobody has looked yet.

    Null is an ordinary state, not an error — it's what the song page shows a
    button under. This is also the poll target while a lookup runs, which is why
    there is no separate status route.
    """
    await _get_song_or_404(song_id, user.id)
    row = await lyrics_jobs.get(user.id, lyrics_jobs.song_key(song_id))
    return {"lyrics": lyrics_to_dict(row) if row else None}


@router.post("/songs/{song_id}/lyrics", status_code=202)
async def start_lyrics(song_id: str, body: LyricsRequest, user: CurrentUser):
    """Queue a lookup and return the row to start polling.

    202 rather than 201: the work hasn't happened yet, and the body is the
    queued row rather than the lyrics. A crawl plus a model call runs far past
    the 100 seconds Cloudflare gives a tunnelled request, so waiting here isn't
    an option — see services/lyrics_jobs.py.
    """
    song = await _get_song_or_404(song_id, user.id)
    row = await lyrics_jobs.enqueue(song, user.id, refresh=body.refresh)
    return {"lyrics": lyrics_to_dict(row)}


@router.post("/lyrics/search", status_code=202)
async def start_search(body: LyricsSearchRequest, user: CurrentUser):
    """Look up anything — a YouTube link, or a song by name.

    The other half of this feature. `POST /api/songs/{id}/lyrics` answers "what
    does the song I saved say"; this answers "what does this say", for something
    that may not be in the library at all. Same queue, same worker, same row
    shape, same `lyrics` use — the only difference is that the row has no song
    behind it.

    202 and a queued row, for the same reason as the song route: a crawl plus a
    model call runs well past the 100 seconds Cloudflare gives a tunnelled
    request.
    """
    row = await lyrics_jobs.enqueue_search(body.q, user.id, refresh=body.refresh)
    return {"lyrics": lyrics_to_dict(row)}


# --- collections -----------------------------------------------------------
#
# Declared before the /lyrics/{row_id} routes below, or "collections" would be
# read as an id and every one of these would 404.


async def _get_set_or_404(set_id: str, user_id: str) -> dict:
    oid = to_object_id(set_id)
    doc = await db.lyrics_sets_col.find_one({"_id": oid, "user_id": user_id}) if oid else None
    if not doc:
        raise errors.AppError(errors.MISSING_LYRICS_SET, 404)
    return doc


async def _members(doc: dict, user_id: str) -> list[dict]:
    """The rows a collection holds. Mongo's $in does not preserve order, so the
    stored list is the order and the sort happens here — the same rule playlist
    playback follows."""
    ids = [to_object_id(i) for i in (doc.get("lyrics_ids") or [])]
    ids = [i for i in ids if i]
    if not ids:
        return []
    found = {}
    async for r in db.lyrics_col.find({"_id": {"$in": ids}, "user_id": user_id}):
        found[str(r["_id"])] = r
    return [found[i] for i in (doc.get("lyrics_ids") or []) if i in found]


@router.get("/lyrics/collections")
async def list_sets(user: CurrentUser):
    out = []
    async for doc in db.lyrics_sets_col.find({"user_id": user.id}).sort("created_at", -1):
        out.append(lyrics_set_to_dict(doc, await _members(doc, user.id)))
    return {"collections": out}


@router.post("/lyrics/collections", status_code=201)
async def create_set(body: CreateLyricsSetRequest, user: CurrentUser):
    name = (body.name or "").strip()
    if not name:
        raise errors.AppError(errors.MISSING_SET_NAME, 400)
    ts = now()
    doc = {
        "user_id": user.id,
        "name": name,
        "description": (body.description or "").strip(),
        "lyrics_ids": [],
        "created_at": ts,
        "updated_at": ts,
    }
    try:
        result = await db.lyrics_sets_col.insert_one(doc)
    except DuplicateKeyError as exc:
        raise errors.AppError(errors.duplicate_set_name(name), 409) from exc
    doc["_id"] = result.inserted_id
    return {"collection": lyrics_set_to_dict(doc)}


@router.get("/lyrics/collections/{set_id}")
async def get_set(set_id: str, user: CurrentUser):
    doc = await _get_set_or_404(set_id, user.id)
    rows = await _members(doc, user.id)
    return {
        "collection": lyrics_set_to_dict(doc, rows),
        "lyrics": [lyrics_to_dict(r) for r in rows],
    }


@router.patch("/lyrics/collections/{set_id}")
async def patch_set(set_id: str, body: LyricsSetPatchRequest, user: CurrentUser):
    doc = await _get_set_or_404(set_id, user.id)
    changes = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise errors.AppError(errors.MISSING_SET_NAME, 400)
        changes["name"] = name
    if body.description is not None:
        changes["description"] = body.description.strip()
    if changes:
        changes["updated_at"] = now()
        try:
            await db.lyrics_sets_col.update_one({"_id": doc["_id"]}, {"$set": changes})
        except DuplicateKeyError as exc:
            raise errors.AppError(errors.duplicate_set_name(changes["name"]), 409) from exc
        doc = await _get_set_or_404(set_id, user.id)
    return {"collection": lyrics_set_to_dict(doc, await _members(doc, user.id))}


@router.delete("/lyrics/collections/{set_id}")
async def delete_set(set_id: str, user: CurrentUser):
    doc = await _get_set_or_404(set_id, user.id)
    # The lookups themselves stay — a collection is a way of grouping them, not
    # where they live. Deleting a shelf does not burn the books.
    await db.lyrics_sets_col.delete_one({"_id": doc["_id"]})
    return {"deleted": True}


@router.post("/lyrics/collections/{set_id}/items")
async def add_to_set(set_id: str, body: AddLyricsRequest, user: CurrentUser):
    doc = await _get_set_or_404(set_id, user.id)
    wanted = body.lyrics_ids or ([body.lyrics_id] if body.lyrics_id else [])
    # Only rows that are actually theirs, and only ones not already in.
    existing = set(doc.get("lyrics_ids") or [])
    adding = []
    for rid in wanted:
        if rid in existing:
            continue
        if await lyrics_jobs.get_by_id(user.id, rid):
            adding.append(rid)
            existing.add(rid)
    if adding:
        # Putting a lookup in a collection is keeping it, so an unkept row that
        # lands in one joins the library too — otherwise it would show inside
        # the collection and be missing from All lyrics.
        for rid in adding:
            await lyrics_jobs.keep_row(user.id, rid)
        await db.lyrics_sets_col.update_one(
            {"_id": doc["_id"]},
            {"$push": {"lyrics_ids": {"$each": adding}}, "$set": {"updated_at": now()}},
        )
        doc = await _get_set_or_404(set_id, user.id)
    return {"collection": lyrics_set_to_dict(doc, await _members(doc, user.id)), "added": len(adding)}


@router.delete("/lyrics/collections/{set_id}/items/{row_id}")
async def remove_from_set(set_id: str, row_id: str, user: CurrentUser):
    doc = await _get_set_or_404(set_id, user.id)
    await db.lyrics_sets_col.update_one(
        {"_id": doc["_id"]}, {"$pull": {"lyrics_ids": row_id}, "$set": {"updated_at": now()}}
    )
    doc = await _get_set_or_404(set_id, user.id)
    return {"collection": lyrics_set_to_dict(doc, await _members(doc, user.id))}


# --- one lookup ------------------------------------------------------------

@router.post("/lyrics/{row_id}/keep")
async def keep_lyrics(row_id: str, user: CurrentUser):
    """Keep a lookup: it joins the library and the lists start showing it.

    A search is not saved by running it. The row exists from the moment it is
    queued, because the worker writes the result into it, but it stays out of
    `GET /lyrics` until this says otherwise — so a lookup you did not want is
    not something you have to go and tidy up. Saying no is `DELETE`, which is
    the whole of the other answer: the row and its cached words both go.
    """
    if not await lyrics_jobs.keep_row(user.id, row_id):
        raise errors.AppError(errors.MISSING_LYRICS, 404)
    row = await lyrics_jobs.get_by_id(user.id, row_id)
    return {"lyrics": lyrics_to_dict(row)}


@router.post("/lyrics/{row_id}/meaning", status_code=202)
async def start_meaning(row_id: str, user: CurrentUser):
    """Read the words we already found. The paid half.

    Separate from finding them because the two cost different things: a crawl is
    ours to spend, a model call is money. 202 and the row to poll — the call
    runs well past what a tunnelled request is allowed to hold open.
    """
    row = await lyrics_jobs.enqueue_meaning(user.id, row_id)
    return {"lyrics": lyrics_to_dict(row)}


@router.get("/lyrics/{row_id}")
async def get_lyrics_row(row_id: str, user: CurrentUser):
    """One saved lookup by its own id — what the Lyrics page polls."""
    row = await lyrics_jobs.get_by_id(user.id, row_id)
    if not row:
        raise errors.AppError(errors.MISSING_LYRICS, 404)
    return {"lyrics": lyrics_to_dict(row)}


@router.get("/lyrics")
async def list_lyrics(
    user: CurrentUser,
    limit: int = 50,
    origin: str | None = None,
    q: str | None = None,
):
    """Everything looked up so far, newest first — the saved lyrics library.

    `origin=search` is what the Lyrics page found; `origin=song` is the lookups
    started from a song's page. Unfiltered gives both, which is what the library
    and the top bar's search both want.
    """
    rows = await lyrics_jobs.list_rows(
        user.id, limit=min(max(limit, 1), 200), origin=origin, q=q
    )
    return {"lyrics": [lyrics_to_dict(r) for r in rows]}


@router.delete("/lyrics/{row_id}")
async def delete_lyrics(row_id: str, user: CurrentUser):
    if not await lyrics_jobs.delete_row(user.id, row_id):
        raise errors.AppError(errors.MISSING_LYRICS, 404)
    # A collection pointing at a lookup that is gone would render a gap that
    # nothing can remove.
    await db.lyrics_sets_col.update_many(
        {"user_id": user.id, "lyrics_ids": row_id},
        {"$pull": {"lyrics_ids": row_id}, "$set": {"updated_at": now()}},
    )
    return {"deleted": True}
