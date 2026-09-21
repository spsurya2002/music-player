#!/usr/bin/env bash
# Start Reel Audio.
#
#   ./run.sh        one server on :8000 serving the built UI — what you normally want
#   ./run.sh dev    Vite on :5173 with hot reload, API on :8000
#
# First run creates the venv, installs deps and builds the UI, so it takes a minute.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
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

if ! mongosh --quiet --eval 'db.version()' >/dev/null 2>&1; then
  echo "Warning: can't reach MongoDB at 127.0.0.1:27017 — your library won't load."
  echo "         Start it with: sudo systemctl start mongod"
fi

if [ "$1" = "dev" ]; then
  ./.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --reload &
  API_PID=$!
  trap 'kill $API_PID 2>/dev/null' EXIT INT TERM
  cd frontend && exec npm run dev
fi

[ -d frontend/dist ] || (echo "Building the UI..."; cd frontend && npm run build)

echo
echo "  Reel Audio  ->  http://127.0.0.1:$PORT"
echo
exec ./.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$PORT"
