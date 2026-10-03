import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import Msg from "../components/Msg";
import { titleOf } from "../components/LyricsBits";
import "./views.css";
import "./LyricsView.css";

const FILTERS = [
  { value: "", label: "Everything" },
  { value: "search", label: "Looked up here" },
  { value: "song", label: "From your songs" },
];

/**
 * All lyrics — the built-in collection every lookup belongs to.
 *
 * It is not a row in `lyrics_sets` and never will be: membership that can drift
 * is the bug the song library avoids by not having a default playlist, and the
 * same reasoning applies here. "All" is a query, not a list somebody maintains.
 */
export default function LyricsAllView() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // The same 300ms the songs list waits before searching, and no wait at all
    // when the box is empty.
    const handle = setTimeout(
      () => {
        api
          .listLyrics({ q: q.trim() || undefined, origin: origin || undefined, limit: 200 })
          .then((d) => {
            if (cancelled) return;
            setRows(d.lyrics);
            setError("");
          })
          .catch((err) => {
            if (!cancelled) setError(err.message || "Could not load your lyrics.");
          });
      },
      q.trim() ? 300 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, origin]);

  return (
    <div className="view">
      <div className="view-head">
        <h1 className="page-title">All lyrics</h1>
        <div className="row">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search saved lyrics"
            aria-label="Search saved lyrics"
          />
          <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Filter">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="sub">
        Everything you&apos;ve looked up, kept so you only pay for a song once.{" "}
        <Link to="/lyrics/saved" className="ext-link">Collections</Link>
      </p>

      {error && <Msg kind="err">{error}</Msg>}

      {rows && rows.length === 0 && (
        <div className="song empty-state">
          {q.trim() ? (
            "Nothing matches that search."
          ) : (
            <>
              Nothing saved yet — <Link to="/lyrics" className="ext-link">find some lyrics</Link>.
            </>
          )}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="link-list">
          {rows.map((r) => (
            <LyricsRow key={r.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// One saved lookup, as a row.
export function LyricsRow({ row }) {
  return (
    <Link to={`/lyrics/${row.id}`} className="song lyrics-row">
      {row.video?.thumbnail ? (
        <img className="lyrics-row-thumb" src={row.video.thumbnail} alt="" />
      ) : (
        <span className="lyrics-row-thumb placeholder" aria-hidden="true" />
      )}
      <span className="lyrics-row-main">
        <b>{titleOf(row)}</b>
        <span className="via">{subOf(row)}</span>
      </span>
    </Link>
  );
}

function subOf(row) {
  if (row.state === "done") {
    return [
      row.resolved?.artist,
      row.meaning ? "read" : "words only",
      row.origin === "song" ? "from a song in your library" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return row.error || row.state;
}
