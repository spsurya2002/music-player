"""Web UI for the song identifier.

    .venv/bin/python ui.py    ->  http://127.0.0.1:5000

Identification runs in a background thread and the page polls for progress,
because the Whisper tier takes minutes and would time out a plain request.
"""

import asyncio
import threading
import uuid
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory

from main import identify

HERE = Path(__file__).parent
UPLOADS = HERE / "uploads"
UPLOADS.mkdir(exist_ok=True)
ALLOWED = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".opus", ".mp4", ".webm"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024

jobs = {}
jobs_lock = threading.Lock()


def local_tracks():
    """Audio sitting next to the script, so you can re-test without uploading."""
    files = [p for p in HERE.iterdir() if p.suffix.lower() in ALLOWED and p.is_file()]
    return sorted((p.name for p in files), key=str.lower)


def run_job(job_id, path):
    """Drive the async pipeline on this thread and append progress as it goes."""

    def log(line):
        with jobs_lock:
            jobs[job_id]["log"].extend(str(line).splitlines())

    try:
        result = asyncio.run(identify(str(path), log=log))
        with jobs_lock:
            jobs[job_id].update(result=result, state="done")
    except Exception as exc:  # surface the traceback text in the UI, not a blank page
        log(f"Error: {exc}")
        with jobs_lock:
            jobs[job_id].update(state="error", error=str(exc))


@app.get("/")
def index():
    return render_template("index.html", tracks=local_tracks())


@app.post("/identify")
def start():
    upload = request.files.get("audio")
    existing = (request.form.get("existing") or "").strip()

    if upload and upload.filename:
        suffix = Path(upload.filename).suffix.lower()
        if suffix not in ALLOWED:
            return jsonify(error=f"{suffix or 'that file type'} is not audio I can read"), 400
        path = UPLOADS / f"{uuid.uuid4().hex}{suffix}"
        upload.save(path)
        label = upload.filename
    elif existing:
        # Resolve inside the project dir so a crafted name can't escape it.
        path = (HERE / existing).resolve()
        if path.parent != HERE.resolve() or not path.is_file():
            return jsonify(error="No such file"), 400
        label = path.name
    else:
        return jsonify(error="Pick a file first"), 400

    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {
            "state": "running", "log": [], "result": None,
            "file": label, "path": str(path),
        }

    threading.Thread(target=run_job, args=(job_id, path), daemon=True).start()
    return jsonify(job=job_id, file=label)


@app.get("/job/<job_id>")
def job_status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify(error="unknown job"), 404
        return jsonify(dict(job))


@app.get("/audio/<job_id>")
def job_audio(job_id):
    """Let the page play back whatever was submitted."""
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return "unknown job", 404

    path = Path(job["path"])
    return send_from_directory(path.parent, path.name)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
