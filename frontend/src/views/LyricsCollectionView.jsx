import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import { titleOf } from "../components/LyricsBits";
import ConfirmModal from "../components/ConfirmModal";
import RenameLyricsModal from "../components/RenameLyricsModal";
import Msg from "../components/Msg";
import { CloseIcon, PencilIcon, TrashIcon } from "../components/icons";
import "./views.css";
import "./LyricsView.css";
import Thumb from "../components/Thumb";

/** One collection of saved lookups. */
export default function LyricsCollectionView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [set, setSet] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The member being renamed, or null — the same fix the All list offers,
  // because a lookup filed under a URL looks the same on either shelf.
  const [renaming, setRenaming] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getLyricsCollection(id);
      setSet(d.collection);
      setRows(d.lyrics);
      setName(d.collection.name);
      setError("");
    } catch (err) {
      setError(err.message || "That collection doesn't exist any more.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function rename(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const d = await api.updateLyricsCollection(id, { name: name.trim() });
      setSet(d.collection);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Could not rename that.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(rowId) {
    // Optimistic, like removing from a playlist: no confirm for something the
    // collection only pointed at, and the lookup itself is untouched.
    setRows((list) => list.filter((r) => r.id !== rowId));
    try {
      await api.removeFromLyricsCollection(id, rowId);
    } catch {
      load();
    }
  }

  async function doDelete() {
    setConfirmDelete(false);
    await api.deleteLyricsCollection(id);
    navigate("/lyrics/saved");
  }

  if (error && !set) {
    return (
      <div className="view">
        <Msg kind="err">{error}</Msg>
        <p className="hint" style={{ marginTop: 12 }}>
          <Link to="/lyrics/saved" className="ext-link">All saved lyrics</Link>
        </p>
      </div>
    );
  }
  if (!set) return <div className="view"><div className="song">Loading…</div></div>;

  return (
    <div className="view">
      <div className="view-head">
        {editing ? (
          <form className="row" onSubmit={rename}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button type="submit" className="btn small" disabled={saving || !name.trim()}>
              {saving ? <span className="spin" /> : "Save"}
            </button>
            <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h1 className="page-title">{set.name}</h1>
            <div className="row">
              <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="Rename">
                <PencilIcon size={16} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Delete collection">
                <TrashIcon size={16} />
              </button>
            </div>
          </>
        )}
      </div>
      <p className="sub">
        {set.item_count} {set.item_count === 1 ? "lookup" : "lookups"}
        {set.read_count > 0 ? ` · ${set.read_count} read` : ""}
      </p>

      {error && <Msg kind="err">{error}</Msg>}

      {rows.length === 0 && (
        <div className="song empty-state">
          Nothing in here yet — open a lookup from{" "}
          <Link to="/lyrics/saved" className="ext-link">your lyrics</Link> and add it.
        </div>
      )}

      {rows.length > 0 && (
        <div className="link-list">
          {rows.map((r) => (
            <div className="song lyrics-row" key={r.id}>
              <Thumb className="lyrics-row-thumb" src={r.video?.thumbnail} iconSize={15} />
              <Link to={`/lyrics/${r.id}`} className="lyrics-row-main">
                <b>{titleOf(r)}</b>
                <span className="via">
                  {[
                    r.manual_artist || r.resolved?.artist,
                    r.meaning ? "read" : "words only",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setRenaming(r)}
                aria-label={`Rename ${titleOf(r)}`}
                title="Rename this lookup"
              >
                <PencilIcon size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => remove(r.id)}
                aria-label="Remove from this collection"
                title="Remove from this collection"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <RenameLyricsModal
          row={renaming}
          onSaved={(updated) =>
            setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)))
          }
          onClose={() => setRenaming(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete collection"
          message={`Delete "${set.name}"? The lookups in it stay in your lyrics.`}
          confirmLabel="Delete"
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
