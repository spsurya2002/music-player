import { useEffect, useState } from "react";
import Modal from "./Modal";
import * as api from "../api/client";
import { CheckIcon, PlusIcon } from "./icons";

export default function AddToPlaylistModal({ song, onClose, onChanged }) {
  const [playlists, setPlaylists] = useState(null);
  const [error, setError] = useState("");
  const [memberIds, setMemberIds] = useState(new Set(song.playlist_ids || []));
  const [pending, setPending] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listPlaylists()
      .then((d) => {
        if (!cancelled) setPlaylists(d.playlists || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load your playlists.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(playlist) {
    const isMember = memberIds.has(playlist.id);
    const nextSet = new Set(memberIds);
    if (isMember) nextSet.delete(playlist.id);
    else nextSet.add(playlist.id);
    setMemberIds(nextSet);
    setPending(playlist.id);
    setError("");
    try {
      if (isMember) await api.removeSongFromPlaylist(playlist.id, song.id);
      else await api.addSongToPlaylist(playlist.id, song.id);
      onChanged && onChanged();
    } catch (err) {
      setMemberIds(memberIds); // roll back
      setError(err.message || "That didn't save — try again.");
    } finally {
      setPending(null);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreateBusy(true);
    setError("");
    try {
      const playlist = await api.createPlaylist({ name: trimmed });
      await api.addSongToPlaylist(playlist.id, song.id);
      setPlaylists((ps) => [playlist, ...(ps || [])]);
      setMemberIds((s) => new Set(s).add(playlist.id));
      setNewName("");
      setCreating(false);
      onChanged && onChanged();
    } catch (err) {
      setError(err.message || "Could not create that playlist.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <Modal title="Add to playlist" onClose={onClose} width={420}>
      {error && <div className="msg err show">{error}</div>}
      {playlists === null && !error && <div className="song">Loading your playlists…</div>}
      {playlists && playlists.length === 0 && !creating && (
        <div className="song">No playlists yet — make one below.</div>
      )}
      {playlists && playlists.length > 0 && (
        <div className="modal-list">
          {playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              className={"modal-list-item" + (memberIds.has(p.id) ? " checked" : "")}
              onClick={() => toggle(p)}
              disabled={pending === p.id}
            >
              <span style={{ flex: 1 }}>{p.name}</span>
              <span style={{ color: "var(--muted)", fontSize: "12.5px" }}>{p.song_count} songs</span>
              {memberIds.has(p.id) && <CheckIcon size={16} />}
            </button>
          ))}
        </div>
      )}

      {creating ? (
        <form className="row" style={{ marginTop: 12 }} onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="New playlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn small" disabled={createBusy || !newName.trim()}>
            {createBusy ? <span className="spin" /> : "Add"}
          </button>
        </form>
      ) : (
        <button type="button" className="btn ghost small" style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
          <PlusIcon size={15} style={{ marginRight: 6 }} />
          New playlist
        </button>
      )}
    </Modal>
  );
}
