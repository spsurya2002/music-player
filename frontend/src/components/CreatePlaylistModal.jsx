import { useState } from "react";
import Modal from "./Modal";
import * as api from "../api/client";

export default function CreatePlaylistModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      const playlist = await api.createPlaylist({ name: trimmed, description: description.trim() });
      onCreated(playlist);
    } catch (err) {
      setError(err.message || "Could not create that playlist.");
      setBusy(false);
    }
  }

  return (
    <Modal title="New playlist" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <div className="row">
          <input
            type="text"
            placeholder="Playlist name"
            aria-label="Playlist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="row">
          <input
            type="text"
            placeholder="Description (optional)"
            aria-label="Playlist description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error && <div className="msg err show">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {busy ? (
              <>
                <span className="spin" />
                Working
              </>
            ) : (
              "Create"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
