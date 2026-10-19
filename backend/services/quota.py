"""Limits on the paid features: how many uses are left, and spending one.

Four features, counted separately and for life — nothing resets on its own:

- `reel`: pulling the audio out of an Instagram reel (the paste box and the
  share sheet both spend it).
- `file`: finding the song behind an uploaded file.
- `lyrics`: finding a song's words. Charged when the words turn up; a lookup
  that found nothing is refunded, because the crawler declining to guess is the
  honest answer and nobody should pay for it.
- `meaning`: having those words explained. Its own allowance, and the smallest,
  because it is the one feature here that spends money per use rather than our
  own bandwidth — a Gemini call. A reading that came back empty (no key
  configured, lyrics too long, the model refusing) is refunded; the words are
  still worth keeping, and that is what the `lyrics` use already paid for.

Only a success is charged — an MP3 actually produced, a file that came back
with at least one YouTube match. But success is only known at the end, and
checking the count at the start then adding one at the end would let someone
with one use left start three reels in parallel and get all three. So a use is
*held* when the work starts, counted against the limit straight away, and then
either kept (`settle`) or given back (`release`).

A hold is a row in `quota_holds` as well as an increment on the user, so a
restart can't strand one: the work it stood for died with the process, and
`refund_orphans()` gives every leftover back at boot.

Per-user state lives on the user document:

    limits: {reel: 20, file: None, lyrics: 10, meaning: 4}  # None = unlimited
    used:   {reel: 3,  file: 0,    lyrics: 2,  meaning: 1}  # successes + holds

`limits` is written only when an admin changes it, so the FREE_*_LIMIT settings
keep applying to everyone who is still on them.
"""

from contextlib import asynccontextmanager
from dataclasses import dataclass

from bson import ObjectId

from backend import db, errors
from backend.config import (
    ADMIN_EMAILS,
    FREE_FILE_LIMIT,
    FREE_LYRICS_LIMIT,
    FREE_MEANING_LIMIT,
    FREE_REEL_LIMIT,
)
from backend.serializers import now
from backend.storage import to_object_id

REEL, FILE, LYRICS, MEANING = "reel", "file", "lyrics", "meaning"
# The order is the order they are shown in: the two that make something you
# keep, then the two halves of a lookup.
FEATURES = (REEL, FILE, LYRICS, MEANING)
DEFAULTS = {
    REEL: FREE_REEL_LIMIT,
    FILE: FREE_FILE_LIMIT,
    LYRICS: FREE_LYRICS_LIMIT,
    MEANING: FREE_MEANING_LIMIT,
}

# How the sentences name each feature — plural for counts, singular for "doesn't
# include".
NAMES = {
    REEL: "reel extractions",
    FILE: "file lookups",
    LYRICS: "lyric lookups",
    MEANING: "lyric readings",
}
NAME = {
    REEL: "reel extraction",
    FILE: "file lookup",
    LYRICS: "lyric lookup",
    MEANING: "lyric reading",
}

# A compare-and-set that loses this many races in a row isn't racing any more.
_ATTEMPTS = 5


@dataclass(frozen=True)
class Hold:
    id: ObjectId
    user_id: str
    feature: str


def is_admin_email(email: str | None) -> bool:
    return (email or "").lower() in ADMIN_EMAILS


def limit_of(doc: dict, feature: str) -> int | None:
    """The effective limit: what an admin set, else the free default. None is
    unlimited — and an admin is always unlimited, whatever their document says."""
    if is_admin_email(doc.get("email")):
        return None
    limits = doc.get("limits") or {}
    if feature in limits:
        return limits[feature]
    return DEFAULTS[feature]


def used_of(doc: dict, feature: str) -> int:
    return max(0, int((doc.get("used") or {}).get(feature) or 0))


def limits_of(doc: dict) -> dict:
    return {f: limit_of(doc, f) for f in FEATURES}


def plan_of(doc: dict) -> str:
    """`admin`, `extended` once an admin has moved any limit off the default,
    else `free`. A label for the Plan page — nothing is decided by it."""
    if is_admin_email(doc.get("email")):
        return "admin"
    limits = doc.get("limits") or {}
    if any(f in limits and limits[f] != DEFAULTS[f] for f in FEATURES):
        return "extended"
    return "free"


def summary(doc: dict) -> dict:
    """The /api/quota shape: per feature, used / limit / left (null = unlimited),
    plus which plan that adds up to and what the free one gives."""
    out = {
        "is_admin": is_admin_email(doc.get("email")),
        "plan": plan_of(doc),
        "defaults": dict(DEFAULTS),
    }
    for f in FEATURES:
        limit = limit_of(doc, f)
        used = used_of(doc, f)
        out[f] = {
            "used": used,
            "limit": limit,
            "left": None if limit is None else max(0, limit - used),
        }
    return out


def limit_error(feature: str, limit: int) -> errors.AppError:
    """402, with the feature named, so the page can offer the way to ask."""
    if limit <= 0:
        message = f"Your plan doesn't include {NAME[feature]} yet — ask for it on the Plan page."
    elif limit == 1:
        message = f"You've used your one {NAME[feature]} — ask for more on the Plan page."
    else:
        message = f"You've used all {limit} of your {NAMES[feature]} — ask for more on the Plan page."
    return errors.AppError(message, 402, extra={"quota": feature})


async def _user_doc(user_id: str) -> dict:
    oid = to_object_id(user_id)
    doc = await db.users_col.find_one(
        {"_id": oid}, projection={"email": 1, "limits": 1, "used": 1}
    ) if oid else None
    if not doc:
        raise errors.AppError(errors.NOT_SIGNED_IN, 401)
    return doc


async def check(user_id: str, feature: str) -> None:
    """Refuse up front, without holding anything — for the share sheet, which
    queues work to run later, and for an upload, which shouldn't be read in
    full only to be turned away."""
    doc = await _user_doc(user_id)
    limit = limit_of(doc, feature)
    if limit is not None and used_of(doc, feature) >= limit:
        raise limit_error(feature, limit)


async def reserve(user_id: str, feature: str) -> Hold:
    """Hold one use, or raise the 402. Admins are held too (so their usage shows
    in the users table) but never refused."""
    for _ in range(_ATTEMPTS):
        doc = await _user_doc(user_id)
        used = used_of(doc, feature)
        limit = limit_of(doc, feature)
        if limit is not None and used >= limit:
            raise limit_error(feature, limit)

        # Only if nobody moved the counter since it was read. A missing field
        # matches null, which is how a brand-new account's first use lands.
        key = f"used.{feature}"
        match = {"_id": doc["_id"], key: used if used else {"$in": [0, None]}}
        result = await db.users_col.update_one(match, {"$inc": {key: 1}})
        if result.modified_count:
            inserted = await db.holds_col.insert_one(
                {"user_id": user_id, "feature": feature, "created_at": now()}
            )
            return Hold(inserted.inserted_id, user_id, feature)

    raise errors.AppError(errors.BUSY_QUOTA, 409)


async def settle(hold: Hold) -> None:
    """It worked — keep the use."""
    await db.holds_col.delete_one({"_id": hold.id})


async def release(hold: Hold) -> None:
    """It didn't — give the use back. Deleting the hold first makes this safe
    to call twice: only the call that actually removed it refunds anything."""
    result = await db.holds_col.delete_one({"_id": hold.id})
    if result.deleted_count:
        oid = to_object_id(hold.user_id)
        await db.users_col.update_one(
            {"_id": oid, f"used.{hold.feature}": {"$gt": 0}},
            {"$inc": {f"used.{hold.feature}": -1}},
        )


@asynccontextmanager
async def use(user_id: str, feature: str):
    """Hold a use for the length of a block: kept if the block finishes,
    refunded if it raises."""
    hold = await reserve(user_id, feature)
    try:
        yield hold
    except BaseException:
        await release(hold)
        raise
    await settle(hold)


async def refund_orphans() -> int:
    """Every hold still here at boot stood for work that died in the restart."""
    count = 0
    async for row in db.holds_col.find({}):
        await release(Hold(row["_id"], row["user_id"], row["feature"]))
        count += 1
    return count


async def set_limits(user_id: str, limits: dict) -> dict | None:
    """Write an admin's decision. `limits` holds only the features being
    changed; a None value there means unlimited. Returns the updated user."""
    oid = to_object_id(user_id)
    if not oid:
        return None
    changes = {f"limits.{f}": v for f, v in limits.items() if f in FEATURES}
    if not changes:
        return await db.users_col.find_one({"_id": oid})
    return await db.users_col.find_one_and_update(
        {"_id": oid}, {"$set": changes}, return_document=True
    )


async def clear_limit(user_id: str, feature: str) -> dict | None:
    """Drop one feature's override so the FREE_*_LIMIT default applies again.

    `set_limits` cannot express this: null there already means unlimited, and
    writing the current default as a number would freeze it — the account would
    keep that figure after the default moved, which is the opposite of
    following it. The only way back is for the key not to be there, so this
    `$unset`s rather than `$set`s. Returns the updated user, or None if the id
    is not one."""
    oid = to_object_id(user_id)
    if not oid or feature not in FEATURES:
        return None
    return await db.users_col.find_one_and_update(
        {"_id": oid}, {"$unset": {f"limits.{feature}": ""}}, return_document=True
    )
