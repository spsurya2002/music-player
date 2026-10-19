import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import Msg from "../components/Msg";
import { LyricsIcon, PlusIcon } from "../components/icons";
import "./views.css";
import "./LyricsView.css";
import Thumb from "../components/Thumb";

/**
 * The lyrics library: All, then whatever you've grouped.
 *
 * **All** is built in and first. It is a query rather than a stored list — the
 * same rule that keeps "All songs" out of the playlists collection, because
 * membership somebody has to maintain is membership that drifts. Everything is
 * in it the moment it is saved, and nothing can fall out.
 */
export default function LyricsLibraryView() {
  const [collections, setCollections] = useState(null);
  const [all, setAll] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listLyricsCollections()
      .then((d) => setCollections(d.collections || []))
      .catch((err) => setError(err.message || "Could not load your collections."));
    // Just enough of the list to count it and take a cover off the newest.
    api
      .listLyrics({ limit: 200 })
      .then((d) => setAll(d.lyrics || []))
      .catch(() => setAll([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.createLyricsCollection(name);
      setNewName("");
      setCreating(false);
      setError("");
      load();
    } catch (err) {
      setError(err.message || "Could not make that collection.");
    } finally {
      setBusy(false);
    }
  }

  const allCount = all?.length ?? 0;
  const allRead = all?.filter((r) => r.meaning).length ?? 0;
  const allCover = all?.find((r) => r.video?.thumbnail)?.video?.thumbnail || null;

  return (
    <div className="view">
      <div className="view-head">
        <h1 className="page-title">Lyrics</h1>
        {!creating && (
          <button type="button" className="btn ghost small" onClick={() => setCreating(true)}>
            <PlusIcon size={15} style={{ marginRight: 6 }} />
            New collection
          </button>
        )}
      </div>
      <p className="sub">
        Everything you look up lands in All. Group what you want to find again.
      </p>

      {error && <Msg kind="err">{error}</Msg>}

      {creating && (
        <form className="row" onSubmit={create} style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Qawwali, Faiz, late night…"
            aria-label="Collection name"
            autoFocus
          />
          <button type="submit" className="btn small" disabled={busy || !newName.trim()}>
            {busy ? <span className="spin" /> : "Create"}
          </button>
          <button type="button" className="btn ghost small" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      <div className="lyrics-set-grid">
        {/* Built in, and first. Not deletable and not renameable, because it is
            the library rather than a view of it. */}
        <Link to="/lyrics/all" className="card lyrics-set lyrics-set-all">
          <span className="lyrics-set-cover">
            {/* Keeps its own icon rather than the note: this tile is every
                lyric you've saved, not a song. */}
            <Thumb src={allCover} fallback={<LyricsIcon size={26} />} />
          </span>
          <span className="lyrics-set-name">All lyrics</span>
          <span className="lyrics-set-sub">
            {all === null
              ? "…"
              : `${allCount} ${allCount === 1 ? "lookup" : "lookups"}${
                  allRead > 0 ? ` · ${allRead} read` : ""
                }`}
          </span>
        </Link>

        {(collections || []).map((c) => (
          <Link key={c.id} to={`/lyrics/collections/${c.id}`} className="card lyrics-set">
            <span className="lyrics-set-cover">
              <Thumb src={c.cover} iconSize={22} />
            </span>
            <span className="lyrics-set-name">{c.name}</span>
            <span className="lyrics-set-sub">
              {c.item_count} {c.item_count === 1 ? "lookup" : "lookups"}
              {c.read_count > 0 ? ` · ${c.read_count} read` : ""}
            </span>
          </Link>
        ))}
      </div>

      {collections && collections.length === 0 && !creating && (
        <div className="hint" style={{ marginTop: 14 }}>
          A collection is a shelf: everything stays in All, and this is how you find a
          handful of it again.
        </div>
      )}
    </div>
  );
}
