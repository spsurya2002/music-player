import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import Msg from "../components/Msg";
import { usePlayer } from "../context/PlayerContext";
import { FileAudioIcon, YoutubeIcon, ExternalLinkIcon } from "../components/icons";
import { fmtSize } from "../utils/format";
import "./views.css";

const POLL_MS = 1500;

// Identification can run for minutes, and it runs on the server, not here — so
// the job id outlives this component. Parking it in sessionStorage means going
// to another view and coming back picks the same job up instead of stranding it.
const JOB_KEY = "identify-job";

export default function IdentifyView() {
  const { openYoutube } = usePlayer();

  const [file, setFile] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState(() => sessionStorage.getItem(JOB_KEY) || "");
  const [status, setStatus] = useState(null); // { state, file, log, error, result }

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // { kind, text, songId }
  const [savedSongId, setSavedSongId] = useState("");

  const inputRef = useRef(null);
  const logRef = useRef(null);

  // Before the first poll lands, an open job id is the only evidence there is one.
  const running = status ? status.state === "running" : Boolean(jobId);
  const busy = starting || running;

  const forget = useCallback(() => {
    sessionStorage.removeItem(JOB_KEY);
    setJobId("");
    setStatus(null);
  }, []);

  // Poll while a job is open. The interval is torn down the moment the job
  // finishes or the view unmounts, so navigating away stops the traffic.
  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer = null;

    async function tick() {
      try {
        const data = await api.identifyStatus(jobId);
        if (cancelled) return;
        setStatus(data);
        if (data.state === "running") timer = setTimeout(tick, POLL_MS);
        else sessionStorage.removeItem(JOB_KEY);
      } catch (err) {
        if (cancelled) return;
        // A 404 means the server restarted and took the job with it.
        if (err.status === 404) forget();
        else timer = setTimeout(tick, POLL_MS * 2);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, forget]);

  // Keep the newest line in view without yanking the whole page around.
  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [status]);

  // Choosing a file is the whole interaction — there's nothing to configure in
  // between, so waiting for a second click on a button would only be a step.
  const start = useCallback(async (chosen) => {
    if (!chosen) return;
    setFile(chosen);
    setStarting(true);
    setError("");
    setStatus(null);
    setSaveMsg(null);
    setSavedSongId("");
    try {
      const data = await api.identifyFile(chosen);
      sessionStorage.setItem(JOB_KEY, data.job);
      setJobId(data.job);
    } catch (err) {
      setError(err.message || "Could not read that file.");
    } finally {
      setStarting(false);
    }
  }, []);

  async function handleSave() {
    if (!status || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const song = await api.saveSong({ job: status.job });
      setSavedSongId(song.id);
      setSaveMsg({ kind: "ok", text: "Saved to your library.", songId: song.id });
    } catch (err) {
      if (err.status === 409 && err.body && err.body.song) {
        setSaveMsg({ kind: "info", text: "Already in your library.", songId: err.body.song.id });
      } else {
        setSaveMsg({ kind: "err", text: err.message || "Could not save that." });
      }
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    forget();
    setFile(null);
    setError("");
    setSaveMsg(null);
    setSavedSongId("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const done = status && status.state === "done";
  const result = done ? status.result : null;
  const found = result && result.youtube;

  // Saving retires the job and its temp file, so the preview moves to the copy
  // that's now in the library rather than pointing at something deleted.
  const previewSrc = savedSongId
    ? api.songAudioUrl(savedSongId)
    : status
      ? api.identifyAudioUrl(status.job)
      : "";

  return (
    <div className="view">
      <h1 className="page-title">MP3 to link</h1>
      <p className="sub">
        Upload a track and get the song behind it, plus its YouTube link — for audio that came from
        somewhere other than a reel. Saved files join All songs, tagged MP3.
      </p>

      <div className="card">
        <label className={"dropzone" + (file ? " has-file" : "") + (busy ? " is-busy" : "")}>
          <input
            ref={inputRef}
            type="file"
            accept=".mp3,.m4a,.wav,.ogg,.flac,.aac,.opus,.mp4,.webm,audio/*"
            className="visually-hidden"
            onChange={(e) => start(e.target.files && e.target.files[0])}
            disabled={busy}
          />
          {busy ? <span className="spin" /> : <FileAudioIcon size={22} />}
          <div className="dropzone-body">
            <div className="dropzone-title">{file ? file.name : "Choose an audio file"}</div>
            <div className="dropzone-sub">
              {busy
                ? starting
                  ? "Uploading…"
                  : "Finding the song…"
                : file
                  ? fmtSize(file.size)
                  : "MP3, M4A, WAV, FLAC, OGG or OPUS · up to 64 MB"}
            </div>
          </div>
        </label>

        <div className="hint">
          It starts as soon as you pick a file: fingerprints the audio, then falls back to the
          file's own tags and to what it can hear being sung. A cover can take a few minutes.
        </div>

        {error && (
          <>
            <Msg kind="err">{error}</Msg>
            <button type="button" className="btn ghost small" style={{ marginTop: 10 }} onClick={() => start(file)}>
              Try again
            </button>
          </>
        )}
        {status && status.state === "error" && (
          <Msg kind="err">{status.error || "Identification failed partway through."}</Msg>
        )}
        {running && <Msg kind="info">Working through the file — this page keeps itself updated.</Msg>}

        {status && (
          <div className="matches">
            {status.file && <div className="mhead">{status.file}</div>}

            <audio
              controls
              preload="metadata"
              src={previewSrc}
              style={{ width: "100%", marginBottom: 12 }}
            />

            {status.log.length > 0 && (
              <div className="ident-log" ref={logRef}>
                {status.log.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}

            {result && (
              <>
                <div className="mhead" style={{ marginTop: 16 }}>
                  Song
                </div>
                {result.track ? (
                  <div className="song">
                    <b>{result.track.title}</b>
                    {result.track.artist ? ` — ${result.track.artist}` : ""}
                    <span className="via">
                      identified via {result.source_label || result.source}
                      {result.track.shazam_url && (
                        <>
                          {" · "}
                          <a
                            href={result.track.shazam_url}
                            target="_blank"
                            rel="noopener"
                            className="ext-link"
                          >
                            Shazam
                          </a>
                        </>
                      )}
                    </span>
                  </div>
                ) : result.query ? (
                  // No fingerprint, so there is no song *name* — only the words
                  // that were searched. Saying so is honest; printing a half-heard
                  // lyric in bold would read as a title it isn't.
                  <div className="song">
                    Matched from {result.source_label || result.source}.
                    <span className="via">Searched YouTube for "{result.query}"</span>
                  </div>
                ) : (
                  <div className="song">
                    Nothing matched — fingerprints, tags and lyrics all came up empty. If the
                    recording is someone singing it themselves and the file carries no tags, there
                    is nothing left to go on.
                  </div>
                )}

                {found && (
                  <>
                    <div className="mhead" style={{ marginTop: 16 }}>
                      YouTube
                    </div>
                    {result.video_id ? (
                      <button
                        type="button"
                        className="yt best"
                        onClick={() => openYoutube(result.video_id, result.title || "")}
                      >
                        <img
                          src={`https://i.ytimg.com/vi/${result.video_id}/mqdefault.jpg`}
                          alt=""
                          loading="lazy"
                        />
                        <div className="body">
                          <div className="t">{result.title || result.youtube}</div>
                          <div className="c">Play it here</div>
                        </div>
                        <span className="badge">BEST</span>
                      </button>
                    ) : (
                      <a className="insta-link" href={result.youtube} target="_blank" rel="noopener">
                        <YoutubeIcon size={16} />
                        <span>{result.title || result.youtube}</span>
                        <ExternalLinkIcon size={14} />
                      </a>
                    )}
                  </>
                )}

                {result.query && !found && (
                  <div className="song">
                    Found the name but no YouTube result came back for it. Searching "{result.query}"
                    by hand may still turn it up.
                  </div>
                )}
              </>
            )}

            {done && (
              <div className="row" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={handleSave}
                  disabled={saving || Boolean(savedSongId)}
                >
                  {saving ? (
                    <>
                      <span className="spin" />
                      Working
                    </>
                  ) : savedSongId ? (
                    "Saved"
                  ) : (
                    "Save to library"
                  )}
                </button>
                <button type="button" className="btn ghost" onClick={startOver} disabled={saving}>
                  Start over
                </button>
              </div>
            )}

            {saveMsg && (
              <div className={`msg show ${saveMsg.kind === "err" ? "err" : saveMsg.kind === "ok" ? "ok" : "info"}`}>
                {saveMsg.text}
                {saveMsg.songId && (
                  <>
                    {" "}
                    <Link to={`/songs/${saveMsg.songId}`} className="ext-link">
                      Open it
                    </Link>
                    {" · add it to a playlist from there."}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
