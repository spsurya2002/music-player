import { useEffect, useState } from "react";
import Modal from "./Modal";
import * as api from "../api/client";
import { CheckIcon, PlusIcon } from "./icons";

/**
 * Two shapes, one modal.
 *
 * For one song it is a membership switch: every playlist shows whether this
 * song is in it, and a row toggles that both ways. For a selection it can't be
 * — "in it" has no single answer across twenty songs, and a tick that meant
 * "some of them" would make the second click ambiguous. So a selection only
 * adds, says so, and closes. Adding a song that is already there is a no-op on
 * the server, which is what makes that safe.
 */
export default function AddToPlaylistModal({ song, songs, onClose, onChanged }) {
  const list = songs?.length ? songs : song ? [song] : [];
  const bulk = list.length > 1;

  const [playlists, setPlaylists] = useState(null);
  const [error, setError] = useState("");
  const [memberIds, setMemberIds] = useState(new Set(bulk ? [] : song?.playlist_ids || []));
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

  async function addAll(playlist) {
    setPending(playlist.id);
    setError("");
    try {
      await api.addSongsToPlaylist(
        playlist.id,
        list.map((s) => s.id)
      );
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message || "That didn't save — try again.");
      setPending(null);
    }
  }

  async function toggle(playlist) {
    if (bulk) return addAll(playlist);
    const isMember = memberIds.has(playlist.id);
    const nextSet = new Set(memberIds);
    if (isMember) nextSet.delete(playlist.id);
    else nextSet.add(playlist.id);
    setMemberIds(nextSet);
    setPending(playlist.id);
    setError("");
    try {
      if (isMember) await api.removeSongFromPlaylist(playlist.id, list[0].id);
      else await api.addSongToPlaylist(playlist.id, list[0].id);
      onChanged?.();
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
      await api.addSongsToPlaylist(
        playlist.id,
        list.map((s) => s.id)
      );
      setPlaylists((ps) => [playlist, ...(ps || [])]);
      setMemberIds((s) => new Set(s).add(playlist.id));
      setNewName("");
      setCreating(false);
      onChanged?.();
      if (bulk) onClose();
    } catch (err) {
      setError(err.message || "Could not create that playlist.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <Modal
      title={bulk ? `Add ${list.length} songs to playlist` : "Add to playlist"}
      onClose={onClose}
      width={420}
    >
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
              className={"modal-list-item" + (!bulk && memberIds.has(p.id) ? " checked" : "")}
              onClick={() => toggle(p)}
              disabled={pending === p.id}
            >
              <span style={{ flex: 1 }}>{p.name}</span>
              <span style={{ color: "var(--muted)", fontSize: "12.5px" }}>{p.song_count} songs</span>
              {pending === p.id ? (
                <span className="spin" />
              ) : (
                !bulk && memberIds.has(p.id) && <CheckIcon size={16} />
              )}
            </button>
          ))}
        </div>
      )}

      {creating ? (
        <form className="row" style={{ marginTop: 12 }} onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="New playlist name"
            aria-label="New playlist name"
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
