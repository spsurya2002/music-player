"""What people think of the app — docs/API.md section 2d.

One route: anyone signed in says what they think, and that is the whole of it
from this side. Reading it back is an admin's job and lives in routers/admin.py
with the other cross-user reads.

Feedback is deliberately not a paid feature and has no limit attached. Putting
a price on "this is broken" would only buy silence about the things most worth
hearing.
"""

from fastapi import APIRouter

from backend import db, errors
from backend.auth import CurrentUser
from backend.models import FeedbackRequest
from backend.serializers import feedback_to_dict, now

router = APIRouter(tags=["feedback"])

# A spell of sending the same thing over and over is a stuck button or a bored
# afternoon, not twenty opinions. The cap is per person and generous enough
# that nobody with something to say will meet it.
MAX_PER_DAY = 10

# Short enough that nobody with a point to make meets it, long enough that
# "ok" and "nice" do not become rows an admin has to read past.
MIN_MESSAGE = 10


@router.post("/feedback", status_code=201)
async def send_feedback(body: FeedbackRequest, user: CurrentUser):
    """Say what you think. Signed in, because the admin reading it needs to
    know who to go back to — and an unsigned box on the open internet is a spam
    funnel, not a feedback form."""
    message = (body.message or "").strip()
    if len(message) < MIN_MESSAGE:
        raise errors.AppError(
            f"Tell us a bit more — {MIN_MESSAGE} characters at least.", 400
        )

    since = now().replace(hour=0, minute=0, second=0, microsecond=0)
    today = await db.feedback_col.count_documents(
        {"user_id": user.id, "created_at": {"$gte": since}}
    )
    if today >= MAX_PER_DAY:
        raise errors.AppError(
            "That's a lot of feedback for one day — we've got it. Try again tomorrow.", 429
        )

    doc = {
        "user_id": user.id,
        "rating": body.rating,
        "message": message,
        "created_at": now(),
    }
    result = await db.feedback_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"feedback": feedback_to_dict(doc)}
