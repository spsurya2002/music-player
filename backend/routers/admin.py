"""The admin's side of limits: GET /api/admin/requests,
POST /api/admin/requests/{id}/resolve, GET /api/admin/users,
PATCH /api/admin/users/{id}/limits — and the reading end of feedback,
GET /api/admin/feedback and DELETE /api/admin/feedback/{id}.

Every route takes AdminUser, which answers anyone else with the same 404 as a
path that doesn't exist. Admins are named in config (ADMIN_EMAILS), not stored,
so there is no route here that makes somebody one.

This is the one place besides routers/shared.py that reads rows belonging to
other people — and it reads accounts, requests and feedback only, never a
library.
"""

import re

from fastapi import APIRouter

from backend import db, errors
from backend.auth import AdminUser
from backend.models import LimitsBody, RequestNoteCreate, ResolveLimitRequest
from backend.routers.limits import APPROVED, DECLINED, MAX_NOTES, PENDING
from backend.serializers import feedback_to_dict, iso, limit_request_to_dict, now
from backend.services import quota
from backend.storage import to_object_id

router = APIRouter(tags=["admin"], prefix="/admin")


def _account(doc: dict | None) -> dict | None:
    """Who someone is and where they stand. Unlike owner_to_dict this carries
    the email address — the admin needs it, and nobody else sees this shape."""
    if not doc:
        return None
    name = doc.get("name") or ""
    return {
        "id": str(doc["_id"]),
        "name": name,
        "given_name": doc.get("given_name") or name.split(" ")[0],
        "email": doc.get("email"),
        "picture": doc.get("picture"),
        "created_at": iso(doc.get("created_at")),
        "last_login_at": iso(doc.get("last_login_at")),
        "quota": quota.summary(doc),
        # Whether an admin has ever set their limits, or they're on the defaults.
        "custom_limits": bool(doc.get("limits")),
    }


async def _accounts_by_id(user_ids) -> dict[str, dict]:
    oids = [oid for oid in (to_object_id(u) for u in set(user_ids)) if oid]
    return {str(d["_id"]): d async for d in db.users_col.find({"_id": {"$in": oids}})}


@router.get("/requests")
async def list_requests(admin: AdminUser, state: str = PENDING, limit: int = 100):
    """Oldest first while they're waiting (first come, first answered); newest
    first once you're looking back through all of them."""
    query = {} if state == "all" else {"state": state}
    order = 1 if state == PENDING else -1
    cursor = db.requests_col.find(query).sort("created_at", order).limit(max(1, min(limit, 500)))
    rows = [d async for d in cursor]
    users = await _accounts_by_id(r["user_id"] for r in rows)
    return {
        "requests": [
            {
                **limit_request_to_dict(r),
                "used_before": r.get("used_before"),
                "user": _account(users.get(r["user_id"])),
            }
            for r in rows
        ]
    }


@router.post("/requests/{request_id}/resolve")
async def resolve(request_id: str, body: ResolveLimitRequest, admin: AdminUser):
    oid = to_object_id(request_id)
    row = await db.requests_col.find_one({"_id": oid}) if oid else None
    if not row:
        raise errors.AppError("That request doesn't exist any more.", 404)

    reply = (body.reply or "").strip()
    changes = body.limits.changes() if body.limits else {}
    if body.decision == "approve" and not changes:
        raise errors.AppError("Set the new limits to approve this.", 400)
    if body.decision == "decline" and not reply:
        raise errors.AppError("Say why — they'll read the reply on their Plan page.", 400)

    # Claim the request before touching the limits, and only if it's still
    # waiting: two admin tabs answering the same one must not both apply.
    approved = body.decision == "approve"
    claimed = await db.requests_col.find_one_and_update(
        {"_id": oid, "state": PENDING},
        {
            "$set": {
                "state": APPROVED if approved else DECLINED,
                "reply": reply,
                "resolved_at": now(),
                "resolved_by": admin.id,
                "last_admin_at": now(),
                "seen_at": None,
            }
        },
        return_document=True,
    )
    if not claimed:
        raise errors.AppError(errors.REQUEST_ANSWERED, 409)

    user_doc = await db.users_col.find_one({"_id": to_object_id(row["user_id"])})
    if approved and user_doc:
        user_doc = await quota.set_limits(row["user_id"], changes)
    limits_after = quota.limits_of(user_doc) if user_doc else None
    await db.requests_col.update_one({"_id": oid}, {"$set": {"limits_after": limits_after}})
    claimed["limits_after"] = limits_after

    return {
        "request": {
            **limit_request_to_dict(claimed),
            "used_before": claimed.get("used_before"),
            "user": _account(user_doc),
        }
    }


@router.post("/requests/{request_id}/notes", status_code=201)
async def answer_question(request_id: str, body: RequestNoteCreate, admin: AdminUser):
    """Say something on an open request without deciding it yet — "looking at
    this tonight" to a sender who asked how long.

    Clearing `seen_at` is what puts it in front of them: the Plan page's unread
    rule is one field, and a note from here counts the same as a decision.
    """
    text = (body.text or "").strip()
    if not text:
        raise errors.AppError(errors.MISSING_NOTE_TEXT, 400)

    oid = to_object_id(request_id)
    row = await db.requests_col.find_one({"_id": oid}) if oid else None
    if not row:
        raise errors.AppError(errors.MISSING_REQUEST, 404)
    if row.get("state") != PENDING:
        raise errors.AppError(errors.NOTE_ON_CLOSED_REQUEST, 409)

    # The length is re-checked inside the update so two tabs cannot both pass
    # the test and both append; it is tested above as well only so a full
    # thread says it is full rather than claiming the row is gone.
    updated = await db.requests_col.find_one_and_update(
        {"_id": oid, "state": PENDING, f"notes.{MAX_NOTES - 1}": {"$exists": False}},
        {
            "$push": {"notes": {"from": "admin", "text": text, "at": now()}},
            "$set": {"last_admin_at": now(), "seen_at": None},
        },
        return_document=True,
    )
    if not updated:
        raise errors.AppError(errors.NOTE_THREAD_FULL, 409)
    user_doc = await db.users_col.find_one({"_id": to_object_id(updated["user_id"])})
    return {
        "request": {
            **limit_request_to_dict(updated),
            "used_before": updated.get("used_before"),
            "user": _account(user_doc),
        }
    }


@router.get("/users")
async def list_users(admin: AdminUser, q: str = "", limit: int = 200):
    query = {}
    q = q.strip()
    if q:
        pattern = {"$regex": re.escape(q), "$options": "i"}
        query = {"$or": [{"email": pattern}, {"name": pattern}]}
    cursor = (
        db.users_col.find(query)
        .sort("last_login_at", -1)
        .limit(max(1, min(limit, 500)))
    )
    docs = [d async for d in cursor]

    # Library sizes in one aggregation rather than a count per row.
    ids = [str(d["_id"]) for d in docs]
    songs = {
        row["_id"]: row["n"]
        async for row in db.songs_col.aggregate(
            [{"$match": {"user_id": {"$in": ids}}}, {"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]
        )
    }
    pending = {
        row["user_id"]
        async for row in db.requests_col.find(
            {"state": PENDING, "user_id": {"$in": ids}}, projection={"user_id": 1}
        )
    }
    return {
        "users": [
            {**_account(d), "songs": songs.get(str(d["_id"]), 0), "pending_request": str(d["_id"]) in pending}
            for d in docs
        ]
    }


@router.patch("/users/{user_id}/limits")
async def set_user_limits(user_id: str, body: LimitsBody, admin: AdminUser):
    """Change someone's limits without a request in the way — a top-up you
    decided on yourself. A key sent as null makes that feature unlimited."""
    changes = body.changes()
    if not changes:
        raise errors.AppError("Send reel, file or both.", 400)
    doc = await quota.set_limits(user_id, changes)
    if not doc:
        raise errors.AppError(errors.MISSING_USER, 404)
    return {"user": _account(doc)}


# --- feedback --------------------------------------------------------------


@router.get("/feedback")
async def list_feedback(admin: AdminUser, limit: int = 200):
    """Everything anyone has said, newest first, with a tally over the lot.

    The summary counts every row in the collection, not the page returned, so
    the average does not shift as you scroll — a rating you cannot compare
    across time is not worth showing.
    """
    cursor = db.feedback_col.find().sort("created_at", -1).limit(max(1, min(limit, 500)))
    rows = [d async for d in cursor]
    users = await _accounts_by_id(r["user_id"] for r in rows)

    spread = {str(n): 0 for n in range(1, 6)}
    total = 0
    count = 0
    async for row in db.feedback_col.aggregate(
        [{"$group": {"_id": "$rating", "n": {"$sum": 1}}}]
    ):
        stars = row["_id"]
        if stars in (1, 2, 3, 4, 5):
            spread[str(stars)] = row["n"]
            total += stars * row["n"]
            count += row["n"]

    return {
        "feedback": [
            {**feedback_to_dict(r), "user": _account(users.get(r["user_id"]))} for r in rows
        ],
        "summary": {
            "count": count,
            "average": round(total / count, 2) if count else None,
            "spread": spread,
        },
    }


@router.delete("/feedback/{feedback_id}")
async def delete_feedback(feedback_id: str, admin: AdminUser):
    """For spam and for things sent by mistake. There is no reply from here:
    feedback is a postbox, and an answer belongs in whatever gets built."""
    oid = to_object_id(feedback_id)
    result = await db.feedback_col.delete_one({"_id": oid}) if oid else None
    if not result or result.deleted_count == 0:
        raise errors.AppError("That feedback is already gone.", 404)
    return {"deleted": True}
