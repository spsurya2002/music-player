import { useEffect, useState } from "react";
import Modal from "./Modal";
import * as api from "../api/client";
import { CheckIcon, PlusIcon } from "./icons";

/**
 * Put a saved lookup into a collection, or start one.
 *
 * The same shape as AddToPlaylistModal, because it is the same question asked
 * about a different kind of thing — a checklist you tick, with a way to make a
 * new one without leaving.
 */
export default function AddToCollectionModal({ row, onClose, onChanged }) {
  const [collections, setCollections] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listLyricsCollections()
      .then((d) => {
        if (!cancelled) setCollections(d.collections || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load your collections.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isMember = (c) => (c.lyrics_ids || []).includes(row.id);

  async function toggle(c) {
    setPending(c.id);
    setError("");
    try {
      const d = isMember(c)
        ? await api.removeFromLyricsCollection(c.id, row.id)
        : await api.addToLyricsCollection(c.id, row.id);
      setCollections((list) => list.map((x) => (x.id === c.id ? d.collection : x)));
      onChanged?.();
    } catch (err) {
      setError(err.message || "That didn't work.");
    } finally {
      setPending(null);
    }
  }

  async function create(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreateBusy(true);
    setError("");
    try {
      const { collection } = await api.createLyricsCollection(name);
      // Straight in: making one from here means you wanted this in it.
      const d = await api.addToLyricsCollection(collection.id, row.id);
      setCollections((list) => [d.collection, ...(list || [])]);
      setNewName("");
      setCreating(false);
      onChanged?.();
    } catch (err) {
      setError(err.message || "Could not make that collection.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <Modal title="Add to a collection" onClose={onClose}>
      {error && <div className="msg err">{error}</div>}

      {collections === null && <div className="song">Loading…</div>}

      {collections && collections.length === 0 && !creating && (
        <div className="song empty-state">No collections yet — make the first one.</div>
      )}

      {collections && collections.length > 0 && (
        <div className="link-list">
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              className={"song pick-row" + (isMember(c) ? " on" : "")}
              onClick={() => toggle(c)}
              disabled={pending === c.id}
            >
              <span className="pick-row-main">
                <b>{c.name}</b>
                <span className="via">
                  {c.item_count} {c.item_count === 1 ? "lookup" : "lookups"}
                </span>
              </span>
              {pending === c.id ? <span className="spin" /> : isMember(c) && <CheckIcon size={16} />}
            </button>
          ))}
        </div>
      )}

      {creating ? (
        <form className="row" onSubmit={create} style={{ marginTop: 12 }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Qawwali, Faiz, late night…"
            aria-label="Collection name"
            autoFocus
          />
          <button type="submit" className="btn small" disabled={createBusy || !newName.trim()}>
            {createBusy ? <span className="spin" /> : "Create"}
          </button>
          <button type="button" className="btn ghost small" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn ghost small"
          onClick={() => setCreating(true)}
          style={{ marginTop: 12 }}
        >
          <PlusIcon size={15} style={{ marginRight: 6 }} />
          New collection
        </button>
      )}
    </Modal>
  );
}
