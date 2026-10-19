"""The About page's content — GET /api/about, docs/API.md section 2e.

Public, and unauthenticated on purpose. This is the page a stranger is sent to
from a résumé or a LinkedIn profile, so it has to render for someone who has
never signed in and never will. It is the second route in the app with no
session behind it; the first is the shared feed, for the same reason.

Writing it is an admin's job and lives in routers/admin.py with the other
cross-cutting writes.
"""

from fastapi import APIRouter

from backend.serializers import about_to_dict
from backend.services import about as about_service

router = APIRouter(tags=["about"])


@router.get("/about")
async def get_about():
    """What the page should say, or just the two flags when it is switched off.

    A page the admin has taken down should not still be shipping its copy to
    anyone who asks — so when `enabled` is false the body stops at the flags,
    which is all the rail needs to know to leave the entry out.
    """
    doc = await about_service.load()
    if not doc.get("enabled"):
        return {"about": {"enabled": False, "in_nav": False}}
    return {"about": about_to_dict(doc)}
