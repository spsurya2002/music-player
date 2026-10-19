"""Reading and writing the one About document.

A thin layer over `settings/_id: "about"`, here rather than in a router because
three callers need it: the public page, the admin editor, and the contact route
(which has to ask whether the message box is even open before it stores
anything).

Everything the page shows lives in this document. `about_defaults.py` seeds it
once and backs the reset button; after that, nothing in the code decides what
the page says.
"""

from backend import db
from backend.serializers import now
from backend.services.about_defaults import DOC_ID, LINK_KINDS, default_about


async def ensure_seeded() -> None:
    """Write the shipped copy if there is no document yet.

    An upsert with $setOnInsert rather than a find-then-insert: two workers
    starting together would otherwise both see nothing and both write, and the
    second would overwrite edits made between the two.
    """
    seed = default_about()
    seed["updated_at"] = now()
    await db.settings_col.update_one(
        {"_id": DOC_ID}, {"$setOnInsert": seed}, upsert=True
    )


async def load() -> dict:
    """The raw document. Falls back to the defaults in memory if it has somehow
    been deleted out from under us, so a page still renders — but does not
    write them back, because seeding is startup's job and a GET that repaired
    the database would hide the fact that something removed it."""
    doc = await db.settings_col.find_one({"_id": DOC_ID})
    return doc or default_about()


async def save(payload: dict) -> dict:
    """Replace the whole document. Returns what was stored."""
    payload = dict(payload)
    payload["updated_at"] = now()
    await db.settings_col.update_one({"_id": DOC_ID}, {"$set": payload}, upsert=True)
    return await load()


async def reset() -> dict:
    """Put the shipped copy back, losing whatever was there."""
    return await save(default_about())


def normalise_link(kind: str, value: str) -> str:
    """Tidy one link's value, and refuse what can't be one.

    An empty value is always allowed: that is how a link is hidden, and the
    Résumé row sits empty until there is a URL to put in it.

    A bare domain typed into the Admin form ("github.com/me") is given https://
    rather than refused — it is obvious what was meant, and a link stored
    without a scheme resolves against our own origin and 404s on the About page
    instead of going anywhere.
    """
    value = (value or "").strip()
    if not value:
        return ""
    if kind == "email":
        # Not a full RFC 5322 parse — just enough that a typo doesn't become a
        # dead mailto: that nobody notices until a recruiter clicks it.
        if "@" not in value or value.startswith("@") or value.endswith("@") or " " in value:
            raise ValueError(f"{value!r} doesn't look like an email address.")
        return value
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith(("javascript:", "data:", "vbscript:")):
        raise ValueError("A link has to be a web address.")
    return "https://" + value


def validate_kind(kind: str) -> str:
    kind = (kind or "site").strip().lower()
    return kind if kind in LINK_KINDS else "site"
