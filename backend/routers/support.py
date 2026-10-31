"""A note left on /support — POST /api/support/notes.

The page itself takes no payment. UPI and Buy Me a Coffee both happen
somewhere else, and neither tells us. The only thing this route stores is
the optional note, which an admin reads back from routers/admin.py.

Signed-in or not. The cup is on every page, including the home page a
visitor sees, and making them create an account before saying thanks would
mostly mean they don't. A session is recorded when one is there, because a
name is useful; it is not what lets the note through. The defences are the
same shape as routers/contact.py: a honeypot, a per-sender cap, a cap on
the day.
"""

import time

from fastapi import APIRouter, Request

from backend import db, errors
from backend.auth import MaybeUser
from backend.models import SupportNoteRequest
from backend.routers.contact import sender_ip
from backend.serializers import now, support_note_to_dict

router = APIRouter(tags=["support"])

MIN_MESSAGE = 2
PER_HOUR = 3
PER_DAY = 5
GLOBAL_PER_DAY = 80
HOUR = 3600
DAY = 86400

# ip -> [unix seconds]. Pruned on write. Dies with the process, on purpose:
# a restart hands an abuser their allowance back, and the daily cap in Mongo
# is still there.
_sent: dict[str, list[float]] = {}


def _check_rate(ip: str) -> None:
    cutoff = time.time() - DAY
    recent = [t for t in _sent.get(ip, []) if t > cutoff]
    if recent:
        _sent[ip] = recent
    else:
        _sent.pop(ip, None)

    if len(recent) >= PER_DAY:
        raise errors.AppError(errors.SUPPORT_TOO_MANY, 429)
    if len([t for t in recent if t > time.time() - HOUR]) >= PER_HOUR:
        raise errors.AppError(errors.SUPPORT_TOO_SOON, 429)


@router.post("/support/notes", status_code=201)
async def send_support_note(body: SupportNoteRequest, request: Request, user: MaybeUser = None):
    """Leave a note from /support. The payment, if there was one, is not here."""
    if (body.website or "").strip():
        return {"sent": True}

    message = (body.message or "").strip()
    if len(message) < MIN_MESSAGE:
        raise errors.AppError(errors.SUPPORT_TOO_SHORT, 400)

    ip = sender_ip(request)
    _check_rate(ip)

    since = now().replace(hour=0, minute=0, second=0, microsecond=0)
    if user:
        mine = await db.support_notes_col.count_documents(
            {"user_id": user.id, "created_at": {"$gte": since}}
        )
        if mine >= PER_DAY:
            raise errors.AppError(errors.SUPPORT_TOO_MANY, 429)

    today = await db.support_notes_col.count_documents({"created_at": {"$gte": since}})
    if today >= GLOBAL_PER_DAY:
        raise errors.AppError(errors.SUPPORT_CLOSED_TODAY, 429)

    row = {
        "message": message,
        "created_at": now(),
    }
    if user:
        row["user_id"] = user.id
    result = await db.support_notes_col.insert_one(row)
    row["_id"] = result.inserted_id
    _sent.setdefault(ip, []).append(time.time())
    return {"note": support_note_to_dict(row)}
