"""Your limits, and asking for more: GET /api/quota, GET|POST /api/requests,
DELETE /api/requests/{id}, POST /api/requests/{id}/notes,
POST /api/requests/seen, GET /api/requests/summary.

There is no payment anywhere in this app. The two paid features — reel
extraction and file lookup — come with a free allowance (backend/services/quota.py),
and past it you write to the admin, who raises it by hand and says so. This
module is the person's side of that; routers/admin.py is the other.
"""

from pymongo.errors import DuplicateKeyError

from fastapi import APIRouter

from backend import db, errors
from backend.auth import CurrentUser
from backend.models import LimitRequestCreate, RequestNoteCreate
from backend.serializers import limit_request_to_dict, now
from backend.services import quota
from backend.storage import to_object_id

router = APIRouter(tags=["limits"])

PENDING, APPROVED, DECLINED = "pending", "approved", "declined"

# Long enough for "any idea how long?" and an answer, a couple of times over.
# Past that it is not a question any more, and the admin is not a chat window.
MAX_NOTES = 12

# Everything the admin has not answered yet, for the one unread rule the
# badge, the list and the serializer all have to agree on: a decision they
# have not read, or a note on the thread. `last_admin_at` is cleared of
# `seen_at` whenever either happens, and is absent on rows written before
# threads existed — so the state test has to stay beside it.
UNSEEN = {
    "seen_at": None,
    "$or": [{"state": {"$ne": PENDING}}, {"last_admin_at": {"$ne": None}}],
}


async def _user_doc(user_id: str) -> dict:
    doc = await db.users_col.find_one({"_id": to_object_id(user_id)})
    if not doc:
        raise errors.AppError(errors.NOT_SIGNED_IN, 401)
    return doc


@router.get("/quota")
async def my_quota(user: CurrentUser):
    return {"quota": quota.summary(await _user_doc(user.id))}


@router.get("/requests")
async def my_requests(user: CurrentUser):
    cursor = db.requests_col.find({"user_id": user.id}).sort("created_at", -1).limit(50)
    return {"requests": [limit_request_to_dict(d) async for d in cursor]}


@router.post("/requests", status_code=201)
async def ask_for_more(body: LimitRequestCreate, user: CurrentUser):
    message = (body.message or "").strip()
    if not message:
        raise errors.AppError(errors.MISSING_REQUEST_MESSAGE, 400)

    doc = await _user_doc(user.id)
    row = {
        "user_id": user.id,
        "message": message,
        "state": PENDING,
        "reply": "",
        # What they had when they asked, so the admin's answer can be read
        # against it later even after the limits have moved again.
        "limits_before": quota.limits_of(doc),
        "used_before": {f: quota.used_of(doc, f) for f in quota.FEATURES},
        "limits_after": None,
        "created_at": now(),
        "resolved_at": None,
        "resolved_by": None,
        "seen_at": None,
        # The thread, and when the admin last added to it. Both start empty:
        # nothing has been said beyond the request itself.
        "notes": [],
        "last_admin_at": None,
    }
    try:
        result = await db.requests_col.insert_one(row)
    except DuplicateKeyError as exc:  # the one-pending-per-user index
        raise errors.AppError(errors.REQUEST_PENDING, 409) from exc
    row["_id"] = result.inserted_id
    return {"request": limit_request_to_dict(row)}


@router.post("/requests/{request_id}/notes", status_code=201)
async def ask_about(request_id: str, body: RequestNoteCreate, user: CurrentUser):
    """Ask about a request that is still open — "is anyone looking at this?",
    "roughly how long?".

    Only while it is pending. Once it has been answered the thread is history,
    and the next thing to send is a new request — which the Plan page already
    offers, and which the admin will actually see. A note on a closed request
    would sit in a row nobody opens again.
    """
    text = (body.text or "").strip()
    if not text:
        raise errors.AppError(errors.MISSING_NOTE_TEXT, 400)

    oid = to_object_id(request_id)
    # Scoped to the pair, like every library read: somebody else's id is a 404
    # here rather than a 403.
    row = await db.requests_col.find_one({"_id": oid, "user_id": user.id}) if oid else None
    if not row:
        raise errors.AppError(errors.MISSING_REQUEST, 404)
    if row.get("state") != PENDING:
        raise errors.AppError(errors.NOTE_ON_CLOSED_REQUEST, 409)
    if len(row.get("notes") or []) >= MAX_NOTES:
        raise errors.AppError(errors.NOTE_THREAD_FULL, 409)

    note = {"from": "user", "text": text, "at": now()}
    # Push and re-check the length in one write: two tabs asking at once would
    # otherwise both pass the test above and both append.
    updated = await db.requests_col.find_one_and_update(
        {"_id": oid, "user_id": user.id, "state": PENDING, f"notes.{MAX_NOTES - 1}": {"$exists": False}},
        {"$push": {"notes": note}},
        return_document=True,
    )
    if not updated:
        raise errors.AppError(errors.NOTE_THREAD_FULL, 409)
    return {"request": limit_request_to_dict(updated)}


@router.delete("/requests/{request_id}")
async def withdraw(request_id: str, user: CurrentUser):
    """Take back a request that nobody has answered yet.

    One pending request per person is a unique index, so an ill-judged or
    mistyped one used to block the only way of asking until an admin got to it —
    and the only thing the sender could do was add a note saying "ignore this",
    which still left the row in the queue. Deleting rather than marking it
    withdrawn is deliberate: the index is what has to be freed, and a request
    nobody read is not history worth keeping.

    Only while it is pending. Once answered the row is the record of a decision,
    and the sender does not get to remove the admin's half of it.
    """
    oid = to_object_id(request_id)
    # Scoped to the pair and to pending in one go, so a second tab pressing
    # Withdraw after an admin answered deletes nothing and is told why.
    row = await db.requests_col.find_one({"_id": oid, "user_id": user.id}) if oid else None
    if not row:
        raise errors.AppError(errors.MISSING_REQUEST, 404)
    if row.get("state") != PENDING:
        raise errors.AppError(errors.WITHDRAW_CLOSED_REQUEST, 409)

    result = await db.requests_col.delete_one(
        {"_id": oid, "user_id": user.id, "state": PENDING}
    )
    if not result.deleted_count:
        raise errors.AppError(errors.WITHDRAW_CLOSED_REQUEST, 409)
    return {"withdrawn": True}


@router.post("/requests/seen")
async def mark_seen(user: CurrentUser):
    """Opening the Plan page reads every answer on it — a decision, or the
    admin's side of a thread."""
    result = await db.requests_col.update_many(
        {"user_id": user.id, **UNSEEN},
        {"$set": {"seen_at": now()}},
    )
    return {"seen": result.modified_count}


@router.get("/requests/summary")
async def summary(user: CurrentUser):
    """What the sidebar badges: your unread answers, and — for an admin — how
    many requests are waiting on them."""
    unread = await db.requests_col.count_documents({"user_id": user.id, **UNSEEN})
    pending = (
        await db.requests_col.count_documents({"state": PENDING}) if user.is_admin else None
    )
    return {"unread": unread, "pending": pending}
