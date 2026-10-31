"""Writing to the developer from the About page — POST /api/contact,
docs/API.md section 2f.

This is the only route in the app that stores something for a caller with no
session. routers/feedback.py refuses to: "an unsigned box on the open internet
is a spam funnel, not a feedback form." That is still true, and the reason this
one exists anyway is that the people it is for — a recruiter, someone passing
the link on — will never sign in to a stranger's music app to say so.

So it carries its own defences in place of a session: a per-sender rate limit,
a cap on the whole day, a honeypot, and a floor on what counts as a message.
The limits live in process memory, like extract tokens and identify jobs, and
die with a restart. That is survivable here — the worst a restart buys an
abuser is their allowance back, and the daily cap below is still in the way.
"""

import time

from fastapi import APIRouter, Request

from backend import db, errors
from backend.auth import MaybeUser
from backend.models import ContactRequest
from backend.serializers import contact_to_dict, now
from backend.services import about as about_service

router = APIRouter(tags=["contact"])

MIN_MESSAGE = 10

# Per sender. Generous for anyone with something to say and tight enough that a
# script gets bored: nobody writes to a side project four times in an hour.
PER_HOUR = 3
PER_DAY = 10

# And a ceiling over everyone, because the per-sender limit is keyed on an IP
# address and a botnet has as many of those as it likes. Hitting this means
# something is wrong rather than popular, and the box closing for the rest of
# the day is the right failure.
GLOBAL_PER_DAY = 200

HOUR = 3600
DAY = 86400

# ip -> [unix seconds], newest last. Pruned on every write, so it cannot grow
# past the addresses that have written in the last day.
_sent: dict[str, list[float]] = {}


def sender_ip(request: Request) -> str:
    """Who to count this against.

    The app is served through a Cloudflare tunnel, so request.client.host is
    the tunnel — 127.0.0.1 for every visitor on earth, which would make the
    per-sender limit a global one. CF-Connecting-IP is what Cloudflare sets and
    is the value to trust here; X-Forwarded-For is the fallback for a plain
    reverse proxy. Both are forgeable by anyone reaching uvicorn directly, which
    is what GLOBAL_PER_DAY is the backstop for.
    """
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate(ip: str) -> None:
    cutoff = time.time() - DAY
    recent = [t for t in _sent.get(ip, []) if t > cutoff]
    if recent:
        _sent[ip] = recent
    else:
        _sent.pop(ip, None)

    if len(recent) >= PER_DAY:
        raise errors.AppError(errors.CONTACT_TOO_MANY, 429)
    if len([t for t in recent if t > time.time() - HOUR]) >= PER_HOUR:
        raise errors.AppError(errors.CONTACT_TOO_SOON, 429)


def _remember(ip: str) -> None:
    _sent.setdefault(ip, []).append(time.time())


@router.post("/contact", status_code=201)
async def send_contact(body: ContactRequest, request: Request, user: MaybeUser = None):
    """Send a note from the About page.

    `user` is read but never required: it is recorded when a session happens to
    be there, because knowing a sender already uses the app is worth something
    to whoever reads this. It is not what lets them send.
    """
    doc = await about_service.load()
    # Closing the box has to actually close it. Hiding the form while the route
    # kept accepting posts would leave the thing switched "off" still filling a
    # collection, and 404 is what the rest of the app says about a thing that
    # isn't there to be used.
    if not doc.get("enabled") or not doc.get("contact_enabled"):
        raise errors.AppError(errors.NOT_FOUND, 404)

    # Checked before anything is validated, and answered as if it worked: a bot
    # told which field gave it away just stops filling that one in.
    if (body.website or "").strip():
        return {"sent": True}

    name = (body.name or "").strip()
    email = (body.email or "").strip()
    message = (body.message or "").strip()

    if not name:
        raise errors.AppError(errors.CONTACT_MISSING_NAME, 400)
    if "@" not in email or email.startswith("@") or email.endswith("@") or " " in email:
        raise errors.AppError(errors.CONTACT_MISSING_EMAIL, 400)
    if len(message) < MIN_MESSAGE:
        raise errors.AppError(errors.contact_too_short(MIN_MESSAGE), 400)

    ip = sender_ip(request)
    _check_rate(ip)

    since = now().replace(hour=0, minute=0, second=0, microsecond=0)
    today = await db.contact_col.count_documents({"created_at": {"$gte": since}})
    if today >= GLOBAL_PER_DAY:
        raise errors.AppError(errors.CONTACT_CLOSED_TODAY, 429)

    row = {
        "name": name,
        "email": email,
        "message": message,
        "user_id": user.id if user else None,
        "ip": ip,
        "user_agent": (request.headers.get("user-agent") or "")[:300],
        "created_at": now(),
    }
    result = await db.contact_col.insert_one(row)
    row["_id"] = result.inserted_id
    _remember(ip)
    return {"sent": True, "message": contact_to_dict(row)}
