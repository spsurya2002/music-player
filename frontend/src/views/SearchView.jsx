import { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import Msg from "../components/Msg";
import YouTubeResultRow from "../components/YouTubeResultRow";
import { ErrorMsg, QuotaNote } from "../components/Quota";
import AddTabs from "../components/AddTabs";
import { emitLimitsChanged } from "../utils/bus";
import { fmtDur, fmtSize } from "../utils/format";
import "./views.css";
import Thumb from "../components/Thumb";

const INITIAL_MATCH = null; // { identified, song, results } | { identified: false, reason }

export default function SearchView() {
  const [url, setUrl] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null); // the ApiError, so a used-up limit can say so
  const [extracted, setExtracted] = useState(null); // extract() response

  const [matching, setMatching] = useState(false);
  const [match, setMatch] = useState(INITIAL_MATCH);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [freeResults, setFreeResults] = useState(null);
  const [freeError, setFreeError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // { kind, text, songId? }

  async function handleExtract(e) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setExtracting(true);
    setExtractError(null);
    setExtracted(null);
    setMatch(INITIAL_MATCH);
    setFreeResults(null);
    setSaveMsg(null);

    try {
      const data = await api.extract(trimmed);
      setExtracted(data);
      runMatch(data.token);
    } catch (err) {
      setExtractError(err);
    } finally {
      setExtracting(false);
      // A success spent a use and a failure gave it back; either way the
      // meter below the form has moved.
      emitLimitsChanged();
    }
  }

  async function runMatch(token) {
    setMatching(true);
    setMatch(INITIAL_MATCH);
    try {
      const data = await api.matchToken(token);
      setMatch(data);
    } catch {
      setMatch({ identified: false, reason: "Song lookup failed — is the server still running?" });
    } finally {
      setMatching(false);
    }
  }

  async function handleFreeSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setFreeError("");
    try {
      const data = await api.searchFreeText(q);
      setFreeResults(data.results || []);
    } catch (err) {
      setFreeError(err.message || "Search failed.");
      setFreeResults(null);
    } finally {
      setSearching(false);
    }
  }

  async function handleSave() {
    if (!extracted) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const song = await api.saveSong({ token: extracted.token });
      setSaveMsg({ kind: "ok", text: "Saved to your library.", songId: song.id });
    } catch (err) {
      if (err.status === 409 && err.body && err.body.song) {
        setSaveMsg({ kind: "info", text: "Already in your library.", songId: err.body.song.id, already: true });
      } else {
        setSaveMsg({ kind: "err", text: err.message || "Could not save that." });
      }
    } finally {
      setSaving(false);
    }
  }

  const identified = match && match.identified;
  const notIdentified = match && match.identified === false;

  return (
    <div className="view">
      <h1 className="page-title">Add a reel</h1>
      <p className="sub">Paste an Instagram reel or post link — get the audio as MP3.</p>

      <AddTabs />

      <div className="card">
        <form className="row" onSubmit={handleExtract}>
          <input
            type="url"
            placeholder="https://www.instagram.com/reel/..."
            aria-label="Instagram reel link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            required
          />
          <button type="submit" className="btn" disabled={extracting}>
            {extracting ? (
              <>
                <span className="spin" />
                Working
              </>
            ) : (
              "Extract"
            )}
          </button>
        </form>
        <div className="hint">Works with reels, posts and IGTV. Private posts need cookies — see the README.</div>
        <QuotaNote feature="reel" />

        {extracting && <Msg kind="info">Fetching the post and pulling the audio out…</Msg>}
        <ErrorMsg error={extractError} />

        {extracted && (
          <div className="search-result">
            <div className="search-result-meta">
              <Thumb className="search-result-art" src={extracted.thumbnail} iconSize={24} />
              <div>
                <div className="search-result-title">{extracted.track || extracted.title || extracted.filename}</div>
                <div className="search-result-by">
                  {[extracted.artist || extracted.uploader, fmtDur(extracted.duration), fmtSize(extracted.size)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>

            <audio controls preload="metadata" src={api.previewUrl(extracted.token)} style={{ width: "100%", marginBottom: 10 }} />

            {/* Saving is held until identification finishes: the YouTube matches and
                the identified/confidence fields only exist on the token while the match
                result is cached, so an early save would store the song without them
                for good. */}
            <button
              type="button"
              className="btn"
              style={{ width: "100%" }}
              onClick={handleSave}
              disabled={saving || matching}
            >
              {saving || matching ? (
                <>
                  <span className="spin" />
                  {saving ? "Working" : "Finding the song"}
                </>
              ) : (
                "Save to library"
              )}
            </button>

            {saveMsg && (
              <div className={`msg show ${saveMsg.kind === "err" ? "err" : saveMsg.kind === "ok" ? "ok" : "info"}`}>
                {saveMsg.text}
                {saveMsg.songId && (
                  <>
                    {" "}
                    <Link to={`/songs/${saveMsg.songId}`} className="ext-link">
                      Open it
                    </Link>
                  </>
                )}
              </div>
            )}

            <div className="matches">
              {matching && <div className="mhead">Finding the full song…</div>}

              {identified && (
                <>
                  <div className="mhead">Song · tap a result to play it here</div>
                  <div className="song">
                    <b>{match.song.track}</b>
                    {match.song.artist ? ` — ${match.song.artist}` : ""}
                    <span className="via">
                      identified via {match.song.source}
                      {match.song.shazam_url && (
                        <>
                          {" · "}
                          <a href={match.song.shazam_url} target="_blank" rel="noopener" className="ext-link">
                            Shazam
                          </a>
                        </>
                      )}
                    </span>
                  </div>
                  {match.results.length === 0 && (
                    <div className="song">No YouTube results came back — try searching the name below.</div>
                  )}
                  {match.results.map((v, i) => (
                    <YouTubeResultRow key={v.id + i} video={v} best={i === 0} />
                  ))}
                </>
              )}

              {notIdentified && (
                <>
                  <div className="mhead">Song</div>
                  <div className="song">{match.reason || "Not identified."}</div>
                </>
              )}

              <form className="row" style={{ marginTop: 12 }} onSubmit={handleFreeSearch}>
                <input
                  type="text"
                  placeholder="Search by song name or a line you caught…"
                  aria-label="Search by song name or a line you caught"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
                <button type="submit" className="btn secondary" disabled={searching}>
                  {searching ? <span className="spin" /> : "Search"}
                </button>
              </form>

              {freeError && <div className="song">{freeError}</div>}
              {freeResults && freeResults.length === 0 && (
                <div className="song">Nothing came back for that.</div>
              )}
              {freeResults &&
                freeResults.map((v, i) => <YouTubeResultRow key={v.id + i} video={v} best={i === 0 && !identified} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
