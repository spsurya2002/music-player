"""FastAPI app for Reelody. Run with:

    ./.venv/bin/uvicorn backend.main:app --reload --port 8000

Mounted alongside (not replacing) the legacy Flask app.py / static/index.html.
"""

import asyncio
import mimetypes
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend import db, errors
from backend.auth import MaybeUser
from backend.routers import (
    admin,
    auth,
    extract,
    feedback,
    identify,
    ingest,
    limits,
    lyrics,
    playlists,
    shared,
    songs,
)
from backend.services import cookies as cookies_service
from backend.services import ingest as ingest_service
from backend.services import lyrics_jobs
from backend.services import quota

app = FastAPI(title="Reelody API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(extract.router, prefix="/api")
app.include_router(identify.router, prefix="/api")
app.include_router(songs.router, prefix="/api")
app.include_router(lyrics.router, prefix="/api")
app.include_router(playlists.router, prefix="/api")
app.include_router(shared.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(limits.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(admin.router, prefix="/api")


@app.exception_handler(errors.AppError)
async def app_error_handler(request: Request, exc: errors.AppError):
    return JSONResponse(status_code=exc.status, content={"error": exc.message, **exc.extra})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "Something went wrong."
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else None
    if first:
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = f"{loc}: {first.get('msg')}" if loc else first.get("msg", "Invalid request.")
    else:
        message = "Invalid request."
    return JSONResponse(status_code=422, content={"error": message})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": f"Unexpected error: {exc}"})


# Python's mimetypes doesn't know .webmanifest, and FileResponse would serve
# the PWA manifest as text/plain — which Chrome refuses, taking "Install app"
# and the Instagram share target down with it.
mimetypes.add_type("application/manifest+json", ".webmanifest")


@app.on_event("startup")
async def on_startup():
    db.connect()
    await db.create_indexes()
    # Uses still held from before the restart belong to work that died with the
    # old process — give them back first, or a reel requeued below would be
    # charged twice for one song.
    await quota.refund_orphans()
    # Anything left mid-flight by the restart that got us here goes back in the
    # queue before the worker starts, or it would sit as `running` forever.
    await ingest_service.requeue_stale()
    ingest_service.start()
    await lyrics_jobs.requeue_stale()
    lyrics_jobs.start()


@app.on_event("shutdown")
async def on_shutdown():
    await ingest_service.stop()
    await lyrics_jobs.stop()
    await db.close()


DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@app.get("/api/health")
async def health(user: MaybeUser = None):
    """Public, so a browser with no session can still tell the server is up.
    The counts are the caller's own library, not the database's totals — nobody
    needs to know how much music anyone else keeps here."""
    # `authenticated` is the Instagram cookie session (what lets the app read a
    # post's music sticker), not the person signed in — `signed_in` is that.
    authenticated = await asyncio.to_thread(cookies_service.has_session)
    payload = {
        "ok": True,
        "storage": "gridfs",
        "authenticated": authenticated,
        "signed_in": user is not None,
    }
    if user is not None:
        payload["songs"] = await db.songs_col.count_documents({"user_id": user.id})
        payload["playlists"] = await db.playlists_col.count_documents({"user_id": user.id})
    return payload


# Serve the built frontend when it exists, so the whole app is one origin and one
# command. Registered after the API routers so /api always wins, and unknown /api
# paths still answer as JSON instead of being handed the SPA shell.
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": "No such endpoint."})

        if full_path:
            candidate = (DIST / full_path).resolve()
            # A URL path becomes a filesystem path here, so confirm it stayed
            # inside dist before serving it.
            if candidate.is_file() and candidate.is_relative_to(DIST.resolve()):
                return FileResponse(candidate)

        # A missing file that looks like a static asset is a build or path bug.
        # Returning the shell for it makes the browser reject HTML as JS/CSS and
        # renders a blank page with no clue why, so fail loudly instead.
        if "." in full_path.rsplit("/", 1)[-1]:
            return JSONResponse(status_code=404, content={"error": "No such file."})

        # Any other path is a client-side route: hand back the shell so deep
        # links and refreshes work. Asset filenames are content-hashed, so a
        # cached shell would ask for a hash that no longer exists after a
        # rebuild and render blank — always revalidate this one file.
        return FileResponse(
            DIST / "index.html",
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )
