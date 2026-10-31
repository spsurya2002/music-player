import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import { usePlayer } from "../context/PlayerContext";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import QueueButton from "../components/QueueButton";
import ConfirmModal from "../components/ConfirmModal";
import Msg from "../components/Msg";
import {
  PlayIcon,
  PauseIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
  CloseIcon,
  GripIcon,
  DownloadIcon,
  LockIcon,
  UnlockIcon,
  MusicIcon,
} from "../components/icons";
import { emitPlaylistsChanged } from "../utils/bus";
import { fmtDur, songTitle } from "../utils/format";
import Pager, { PAGE_SIZE } from "../components/Pager";
import "./views.css";
import Thumb from "../components/Thumb";

const LOOPS = ["off", "all", "one"];
const LOOP_LABEL = { off: "No loop", all: "Loop all", one: "Loop one" };

export default function PlaylistDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const player = usePlayer();
  const { playQueue, currentSong, playing, togglePlay, activePlaylistId, loopMode, setLoopMode } = player;

  const [playlist, setPlaylist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const [addToPlaylistSong, setAddToPlaylistSong] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const [dragIndex, setDragIndex] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getPlaylist(id)
      .then((d) => {
        if (cancelled) return;
        setPlaylist(d.playlist);
        setSongs(d.songs || []);
        setPage(1);
        setNameDraft(d.playlist.name);
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "That playlist doesn't exist any more.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pageStart = (Math.min(page, Math.max(1, Math.ceil(songs.length / PAGE_SIZE))) - 1) * PAGE_SIZE;
  const visibleSongs = songs.slice(pageStart, pageStart + PAGE_SIZE);

  const isActivePlaylist = playlist && activePlaylistId === playlist.id;
  const effectiveLoop = isActivePlaylist ? loopMode : playlist?.loop || "off";

  function handlePlayAll() {
    if (songs.length === 0) return;
    playQueue(songs, 0, { playlistId: playlist.id, loop: playlist.loop });
  }

  function handleRowPlay(song, index) {
    if (currentSong && currentSong.id === song.id && isActivePlaylist) {
      togglePlay();
      return;
    }
    playQueue(songs, index, { playlistId: playlist.id, loop: playlist.loop });
  }

  async function handleSetLoop(mode) {
    const prev = playlist.loop;
    setPlaylist((p) => ({ ...p, loop: mode }));
    if (isActivePlaylist) setLoopMode(mode);
    setActionError("");
    try {
      await api.updatePlaylist(id, { loop: mode });
    } catch (err) {
      setPlaylist((p) => ({ ...p, loop: prev }));
      if (isActivePlaylist) setLoopMode(prev);
      setActionError(err.message || "Could not change the loop setting.");
    }
  }

  async function handleShare(next) {
    const prev = playlist.is_public;
    // Optimistic, like the loop toggle: a switch that waits for a round trip
    // before moving reads as a switch that didn't work.
    setPlaylist((p) => ({ ...p, is_public: next }));
    setShareBusy(true);
    setActionError("");
    try {
      const updated = await api.setPlaylistShared(id, next);
      setPlaylist(updated);
      // The Shared page and the playlists grid both show this.
      emitPlaylistsChanged();
    } catch (err) {
      setPlaylist((p) => ({ ...p, is_public: prev }));
      setActionError(err.message || "Could not change sharing for that playlist.");
    } finally {
      setShareBusy(false);
    }
  }

  async function handleRemove(song) {
    const prevSongs = songs;
    setSongs((list) => list.filter((s) => s.id !== song.id));
    setActionError("");
    try {
      const updated = await api.removeSongFromPlaylist(id, song.id);
      setPlaylist(updated);
    } catch (err) {
      setSongs(prevSongs);
      setActionError(err.message || "Could not remove that song.");
    }
  }

  function handleDrop(targetIndex) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const prevSongs = songs;
    const copy = songs.slice();
    const [moved] = copy.splice(dragIndex, 1);
    copy.splice(targetIndex, 0, moved);
    setSongs(copy);
    setDragIndex(null);
    setActionError("");
    api.reorderPlaylist(id, copy.map((s) => s.id)).catch((err) => {
      setSongs(prevSongs);
      setActionError(err.message || "Reorder didn't save — try again.");
    });
  }

  async function handleRename(e) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setRenameBusy(true);
    try {
      const updated = await api.updatePlaylist(id, { name: trimmed });
      setPlaylist(updated);
      setRenaming(false);
      emitPlaylistsChanged();
    } catch (err) {
      setActionError(err.message || "Could not rename that playlist.");
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleDelete() {
    await api.deletePlaylist(id);
    emitPlaylistsChanged();
    navigate("/playlists");
  }

  if (loading) {
    return (
      <div className="view">
        <div className="song">Loading…</div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="view">
        <Msg kind="err">{error || "That playlist doesn't exist any more."}</Msg>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="playlist-detail-head">
        <Thumb
          className="playlist-detail-cover"
          src={playlist.cover}
          fallback={
            <div className="playlist-detail-cover-empty">
              <MusicIcon size={34} />
            </div>
          }
        />
        <div className="detail-meta">
          {!renaming ? (
            <div className="detail-title-row">
              <div className="detail-title">{playlist.name}</div>
              <button type="button" className="icon-btn" onClick={() => setRenaming(true)} aria-label="Rename">
                <PencilIcon size={16} />
              </button>
              <span
                className={"share-state" + (playlist.is_public ? " on" : "")}
                title={
                  playlist.is_public
                    ? "Shared publicly — anyone signed in can find this, play it and take a copy"
                    : "Private — only you can see this playlist"
                }
                aria-label={playlist.is_public ? "Shared publicly" : "Private"}
              >
                {playlist.is_public ? <UnlockIcon size={16} /> : <LockIcon size={16} />}
              </span>
            </div>
          ) : (
            <form className="row" onSubmit={handleRename}>
              <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
              <button type="submit" className="btn small" disabled={renameBusy}>
                {renameBusy ? <span className="spin" /> : "Save"}
              </button>
              <button type="button" className="btn ghost small" onClick={() => setRenaming(false)} disabled={renameBusy}>
                Cancel
              </button>
            </form>
          )}
          <div className="detail-sub">
            {playlist.song_count} song{playlist.song_count === 1 ? "" : "s"}
            {playlist.duration ? ` · ${fmtDur(playlist.duration)}` : ""}
          </div>

          <div className="detail-actions">
            <button type="button" className="btn" onClick={handlePlayAll} disabled={songs.length === 0}>
              <PlayIcon size={16} style={{ marginRight: 6 }} />
              Play all
            </button>
            <QueueButton songs={songs} label="Queue all" className="btn secondary" />
            <div className="loop-toggle">
              {LOOPS.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={effectiveLoop === mode ? "active" : ""}
                  onClick={() => handleSetLoop(mode)}
                  title={LOOP_LABEL[mode]}
                >
                  {mode === "off" ? "Off" : mode === "all" ? "All" : "One"}
                </button>
              ))}
            </div>
            <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon size={15} style={{ marginRight: 6 }} />
              Delete playlist
            </button>
            <button
              type="button"
              className={playlist.is_public ? "btn secondary" : "btn"}
              onClick={() => handleShare(!playlist.is_public)}
              disabled={shareBusy}
              title={
                playlist.is_public
                  ? "Take this playlist off Shared"
                  : "Anyone signed in can find this on Shared, play it and take a copy. Your name and picture are shown next to it."
              }
            >
              {shareBusy && <span className="spin" />}
              {playlist.is_public ? "Stop sharing" : "Share"}
            </button>
          </div>
        </div>
      </div>

      {actionError && <Msg kind="err">{actionError}</Msg>}

      {songs.length === 0 ? (
        <div className="song empty-state">No songs here yet — add some from All songs or a song's page.</div>
      ) : (
        <div className="playlist-song-list">
          {visibleSongs.map((song, i) => {
            const index = pageStart + i;
            const active = currentSong && currentSong.id === song.id && isActivePlaylist;
            return (
              <div
                key={song.id}
                className="playlist-song-row"
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
                onDragEnd={() => setDragIndex(null)}
              >
                <span className="drag-grip">
                  <GripIcon size={15} />
                </span>
                <div className={"song-row" + (active ? " active" : "")}>
                  <button
                    type="button"
                    className="song-row-index"
                    onClick={() => handleRowPlay(song, index)}
                    aria-label={active && playing ? "Pause" : "Play"}
                  >
                    <span className="idx">{index + 1}</span>
                    <span className="ico">{active && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</span>
                  </button>
                  <button type="button" className="song-row-main" onClick={() => navigate(`/songs/${song.id}`)}>
                    <Thumb className="song-row-thumb" src={song.thumbnail} />
                    <span className="song-row-text">
                      <span className="song-row-title">{songTitle(song)}</span>
                      <span className="song-row-artist">{song.artist || song.uploader || "Unknown"}</span>
                    </span>
                  </button>
                  <span className="song-row-duration">{fmtDur(song.duration)}</span>
                </div>
                <button type="button" className="icon-btn" onClick={() => setAddToPlaylistSong(song)} aria-label="Add to another playlist">
                  <PlusIcon size={16} />
                </button>
                <a
                  className="icon-btn"
                  href={api.songDownloadUrl(song.id)}
                  download
                  aria-label="Download MP3"
                  title="Download MP3"
                >
                  <DownloadIcon size={16} />
                </a>
                <button type="button" className="icon-btn" onClick={() => handleRemove(song)} aria-label="Remove from playlist">
                  <CloseIcon size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Pager
        page={Math.min(page, Math.max(1, Math.ceil(songs.length / PAGE_SIZE)))}
        total={songs.length}
        onPage={setPage}
      />

      {addToPlaylistSong && <AddToPlaylistModal song={addToPlaylistSong} onClose={() => setAddToPlaylistSong(null)} />}

      {confirmDelete && (
        <ConfirmModal
          title="Delete playlist"
          message={`Delete "${playlist.name}"? The songs stay in your library.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
