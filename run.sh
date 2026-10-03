#!/usr/bin/env bash
# Start Reel Audio.
#
#   ./run.sh        one server on :8000 serving the built UI — what you normally want
#   ./run.sh dev    Vite on :5173 with hot reload, API on :8000
#
# Either way a second process comes up alongside it: the lyrics sidecar on :4001
# (see lyrics-node/README.md). It is loopback-only and the API is its only
# caller, so nothing but this script needs to know it is there.
#
# First run creates the venv, installs deps and builds the UI, so it takes a minute.
set -e
cd "$(dirname "$0")"
ROOT="$PWD"

PORT="${PORT:-8000}"
LYRICS_PORT="${LYRICS_PORT:-4001}"
# Instagram's music sticker (the one source that names a song outright) needs a
# logged-in session. The app auto-detects the signed-in browser profile and
# degrades quietly if there isn't one — set this to firefox/brave/edge if needed.
export INSTA_COOKIES_BROWSER="${INSTA_COOKIES_BROWSER:-chrome}"

if [ ! -d .venv ]; then
  echo "Setting up the Python environment..."
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
fi
./.venv/bin/pip install -q -r requirements.txt

if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend packages..."
  (cd frontend && npm install --silent)
fi

if [ ! -d lyrics-node/node_modules ]; then
  echo "Installing lyrics packages..."
  (cd lyrics-node && npm install --silent)
fi
[ -d lyrics-node/dist ] || (echo "Building the lyrics sidecar..."; cd lyrics-node && npm run build)

# Sign-in needs an OAuth client ID, from the environment or backend/.env (the
# server reads both). The app still runs without one — the login screen explains
# itself — but nobody can get past it, so say so up front.
if [ -z "${GOOGLE_CLIENT_ID:-}" ] && ! grep -qs '^[[:space:]]*\(export[[:space:]]*\)\?GOOGLE_CLIENT_ID=.' backend/.env; then
  echo "Note: GOOGLE_CLIENT_ID isn't set, so nobody can sign in."
  echo "      Create a web-application OAuth client ID, then put it in backend/.env:"
  echo "      GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com             (see the README)"
fi

# Unlike the client ID, a missing key here costs you only half a feature: lyrics
# are still found and stored, and the song page says why there's no explanation.
if [ -z "${GEMINI_API_KEY:-}" ] && ! grep -qs '^[[:space:]]*\(export[[:space:]]*\)\?GEMINI_API_KEY=.' lyrics-node/.env; then
  echo "Note: GEMINI_API_KEY isn't set, so songs get lyrics but no meaning."
  echo "      Get one from Google AI Studio, then put it in lyrics-node/.env:"
  echo "      GEMINI_API_KEY=your-key                                        (see the README)"
fi

if ! mongosh --quiet --eval 'db.version()' >/dev/null 2>&1; then
  echo "Warning: can't reach MongoDB at 127.0.0.1:27017 — your library won't load."
  echo "         Start it with: sudo systemctl start mongod"
fi

# Started from inside lyrics-node/ on purpose: its config reads .env through
# dotenv, which resolves that path against the working directory, so launching
# it from here would silently leave GEMINI_API_KEY unset. CACHE_DIR is absolute
# for the same reason — the caches belong next to the rest of the app's data,
# not wherever the process happened to start.
(cd lyrics-node && PORT="$LYRICS_PORT" CACHE_DIR="$ROOT/backend/lyrics-cache" exec node dist/index.js) &
LYRICS_PID=$!

if [ "$1" = "dev" ]; then
  ./.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --reload &
  API_PID=$!
  # No `exec` on the Vite line below: exec would replace this shell and take the
  # trap with it, leaving uvicorn and the sidecar running after you quit.
  trap 'kill $API_PID $LYRICS_PID 2>/dev/null' EXIT INT TERM
  (cd frontend && npm run dev)
  exit
fi

[ -d frontend/dist ] || (echo "Building the UI..."; cd frontend && npm run build)

echo
echo "  Reel Audio  ->  http://127.0.0.1:$PORT"
echo "  lyrics      ->  http://127.0.0.1:$LYRICS_PORT  (loopback only)"
echo

trap 'kill $LYRICS_PID 2>/dev/null' EXIT INT TERM
./.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT"
