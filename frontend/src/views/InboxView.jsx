import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import { APP_NAME } from "../components/Brand";
import Msg from "../components/Msg";
import { fmtDate } from "../utils/format";
import "./views.css";

// What the share sheet has sent, and what became of it. The work happens on the
// server whether this page is open or not — this is a window onto the queue, not
// a driver of it.

const POLL_MS = 3000;

const LABEL = {
  queued: "Waiting",
  running: "Working",
  done: "Saved",
  duplicate: "Already saved",
  failed: "Failed",
  limited: "Limit reached",
};

// The .badge ladder: green for a song that landed, amber while it's moving,
// muted for the ones that changed nothing.
// A used-up limit is amber too: nothing broke, but it's waiting on you.
const TONE = { done: "", running: " mid", queued: " low", duplicate: " low", failed: " low", limited: " mid" };

function isActive(job) {
  return job.state === "queued" || job.state === "running";
}

export default function InboxView() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listIngestJobs(30);
      setJobs(data.jobs || []);
      setError("");
      return data.jobs || [];
    } catch (err) {
      setError(err.message || "Could not read the queue.");
      return [];
    }
  }, []);

  // Poll only while something is actually in flight. A settled queue costs one
  // request on mount and nothing after that.
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const current = await load();
      if (cancelled) return;
      if (current.some(isActive)) {
        timer.current = setTimeout(tick, POLL_MS);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function handleClear() {
    setClearing(true);
    try {
      await api.clearIngestJobs();
      await load();
    } catch (err) {
      setError(err.message || "Could not clear those.");
    } finally {
      setClearing(false);
    }
  }

  const finished = (jobs || []).filter((j) => !isActive(j)).length;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="page-title">Imports</h1>
          <p className="sub">
            Reels shared from Instagram land here, then in your library. Nothing to do —
            this page just shows you where they got to.
          </p>
        </div>
        {finished > 0 && (
          <div className="view-head-controls">
            <button type="button" className="btn ghost" onClick={handleClear} disabled={clearing}>
              {clearing ? <span className="spin" /> : "Clear finished"}
            </button>
          </div>
        )}
      </div>

      {error && <Msg kind="err">{error}</Msg>}

      {jobs === null && !error && (
        <div className="song">
          <span className="spin" />
          Reading the queue…
        </div>
      )}

      {jobs !== null && jobs.length === 0 && (
        <div className="song empty-state">
          Nothing shared yet. Install this app to your home screen, then use Instagram's
          share button and pick {APP_NAME} — the reel will show up here on its own.
        </div>
      )}

      {(jobs || []).map((job) => (
        <div className="song ingest-row" key={job.id}>
          <div className="ingest-main">
            <b>{job.title || job.url.replace(/^https?:\/\/(www\.)?/, "")}</b>
            <span className="via">
              {[
                LABEL[job.state] || job.state,
                job.origin === "share" ? "shared" : job.origin,
                fmtDate(job.created_at),
              ]
                .filter(Boolean)
                .join(" · ")}
              {job.error ? ` — ${job.error}` : ""}
            </span>
          </div>

          <div className="ingest-side">
            <span className={`badge${TONE[job.state] ?? " low"}`}>
              {LABEL[job.state] || job.state}
            </span>
            {job.song_id && (
              <Link to={`/songs/${job.song_id}`} className="ext-link">
                Open
              </Link>
            )}
            {job.state === "limited" && (
              <Link to="/plan" className="ext-link">
                Ask for more
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
