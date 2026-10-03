# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

- **[.claude/skills/reel-audio-ui/SKILL.md](.claude/skills/reel-audio-ui/SKILL.md)** — the
  orientation map: where every module lives, the non-negotiables, and a long list of
  gotchas that have already cost someone a debugging session. Invoke the `reel-audio-ui`
  skill before writing JSX, CSS, or a FastAPI route.
- **[docs/API.md](docs/API.md)** — the endpoint contract. Read before touching a route.
- **[docs/DESIGN.md](docs/DESIGN.md)** — the design system. Read before touching UI.
- **[README.md](README.md)** — product behaviour, every env var, and the OAuth setup.

Those four are the substance; what follows is only what they don't cover.

## Commands

```bash
./run.sh                 # one server on :8000 serving frontend/dist — the normal way
./run.sh dev             # Vite :5173 (hot reload) + uvicorn --reload :8000
```

`run.sh` is the entry point for both modes and also brings up the lyrics sidecar on
`:4001`. First run creates `.venv/`, installs Python + npm packages and builds the UI.

Pieces, when you need one on its own:

```bash
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn backend.main:app --reload --port 8000    # API only; lyrics will 502

cd frontend && npm run build      # must compile clean before calling anything done
cd frontend && npm run lint       # oxlint (rules-of-hooks, only-export-components)
cd frontend && npm run dev

cd lyrics-node && npm run typecheck   # must be clean
cd lyrics-node && npm run build       # -> dist/, which run.sh needs
```

Prerequisites: Python 3.12, Node ≥20, `ffmpeg` on PATH, MongoDB on `127.0.0.1:27017`
(`sudo systemctl start mongod`).

```bash
curl -s 127.0.0.1:8000/api/health    # ok, signed_in, and Instagram cookie state
mongosh reel_audio                   # the library itself
```

**There is no test suite** — no pytest, no vitest, no fixtures anywhere in the repo, and
the vendored lyrics pipeline explicitly has none. So verification is: the three build/lint
commands above, then run it and look (`./run.sh`, <http://127.0.0.1:8000>). Exercise a
changed flow by hand against the real endpoints; `docs/API.md` has the request shapes. When
iterating on lyrics, append `&refresh=1` or the sidecar's 6-hour result cache masks your
change.

Don't add a test framework or linter config unless asked.

## The shape of the system

Three processes, started together by `run.sh`:

1. **FastAPI + Motor** (`backend/`, `:8000`) — owns all state and every decision about
   who may see what. In production it also serves `frontend/dist` from a catch-all route
   registered *after* the API routers, so one origin serves the whole app.
2. **Vite + React 19 SPA** (`frontend/`), plain JSX and hand-written CSS, no UI kit.
3. **A Node/TypeScript lyrics sidecar** (`lyrics-node/`, `:4001`) — vendored near-verbatim
   from a standalone project and meant to stay that way: its scoring weights and thresholds
   are calibrated against each other with no tests to catch a regression. It binds loopback,
   has no auth and no CORS; `backend/services/lyrics.py` is the only module permitted to
   call it, and sign-in, ownership and quota are all settled in Python first.

Everything durable is in MongoDB — audio included, via **GridFS**, which is what lets
`backend/streaming.py` answer Range requests so the player can seek. `downloads/` and
`backend/uploads/` are pre-save scratch only.

### Patterns worth knowing before you add a feature

These recur across the backend; new code is expected to follow them rather than invent an
alternative.

- **Request-time attribute lookup for collections.** The Motor client is created in
  `db.connect()` from the startup event, never at import. Reach collections as
  `db.songs_col`; `from backend.db import songs_col` captures `None` and a client built at
  import time crashes uvicorn with *Future attached to a different loop*.
- **Two-phase writes.** `POST /api/extract` and `POST /api/identify` produce a token/job
  and a temp file; nothing enters Mongo until `POST /api/songs`. Tokens and identify jobs
  live in process memory and die on restart.
- **Long work goes to a queue with a single worker**, not into the request. `ingest_jobs`
  and `lyrics` are each a Mongo collection that is job and result at once, with a worker
  started in `on_startup` and stale rows requeued at boot. Two reasons, both load-bearing:
  the app is served through a Cloudflare tunnel that kills any request open at 100s, and
  Instagram rate-limits a session that asks too fast.
- **Quota is reserve → settle/release**, through `backend/services/quota.py`, never
  check-then-charge. Three lifetime limits (reel / file / lyrics); orphaned holds are
  refunded at startup.
- **Ownership is a filter, not a check.** Routers take `CurrentUser` and scope every query
  — including reads — to `user.id`. Someone else's row is a 404. `backend/routers/shared.py`
  is the single sanctioned cross-user reader and re-asks "is this song in a public playlist
  *right now*?" on every request.
- **One error shape.** `{"error": "a plain English sentence"}` with a non-2xx status.
  `backend/main.py` installs handlers that force it even for `HTTPException` and validation
  failures; `frontend/src/api/client.js` renders that sentence verbatim and is the only
  place the app calls `fetch`.
- **`backend/serializers.py` is the only place `_id` becomes `id`** and the only place
  stored docs are cast to the contract's types.
- **Library search is scored in Python** (`backend/search.py`), not a Mongo regex: it
  matches across every name-ish field including the rendered *artist — track*, ranks the
  hits, and falls back to fuzzy matching, because transliterated titles are never spelled
  the same way twice.

### Frontend structure that isn't obvious from the file tree

`App.jsx` nests `AuthProvider > PlayerProvider > router`, so the single `new Audio()` in
`PlayerContext` outlives navigation — `Shell.jsx` mounts the sidebar, `<Routes>` and the
player bar as siblings. Signed-out is a state of the same app, not a different one: the
shell renders for everyone and `<Gated>` swaps a view's *contents* for a `SignInPrompt`.
`/` (the shared feed) is the one route with no gate, and `/login` the one route outside the
shell. A 401 is turned into an app-wide signal by `api/client.js` rather than handled by
the calling view.

## Code that looks live but isn't

`app.py` + `static/index.html` are the original single-file Flask version, and
`feature-code/` is the standalone file-identification prototype that
`backend/services/file_identify.py` was ported from verbatim. Both are kept as reference
only; nothing in `backend/` or `frontend/` imports them. Don't extend them, and don't read
their patterns as current — but do treat `feature-code/` as the authority on the identify
tiers if the port ever looks wrong, since that port is deliberately not re-tuned.
