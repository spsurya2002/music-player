#!/usr/bin/env bash
# Start the extractor. First run creates the venv and installs deps.
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Setting up virtualenv..."
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
fi

exec ./.venv/bin/python app.py
