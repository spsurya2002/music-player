import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import { usePlayer } from "../context/PlayerContext";
import YouTubeResultRow from "../components/YouTubeResultRow";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import QueueButton from "../components/QueueButton";
import ConfirmModal from "../components/ConfirmModal";
import LyricsSection from "../components/LyricsSection";
import Msg from "../components/Msg";
import SourceTag from "../components/SourceTag";
import { PlayIcon, PauseIcon, PencilIcon, PlusIcon, TrashIcon, ExternalLinkIcon, RefreshIcon, FileAudioIcon, DownloadIcon } from "../components/icons";
import { fmtDur, fmtSize, fmtDate, songTitle } from "../utils/format";
import "./views.css";
import Thumb from "../components/Thumb";

export default function SongDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { playSongNow, currentSong, playing, togglePlay } = usePlayer();

  const [song, setSong] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: "", track: "", artist: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getSong(id)
      .then((s) => {
        if (cancelled) return;
        setSong(s);
        setForm({ title: s.title || "", track: s.track || "", artist: s.artist || "" });
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "That song is no longer in your library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isActive = song && currentSong && currentSong.id === song.id;

  function handlePlay() {
    if (isActive) {
      togglePlay();
    } else {
      playSongNow(song);
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const updated = await api.updateSong(id, {
        title: form.title.trim(),
        track: form.track.trim() || null,
        artist: form.artist.trim() || null,
      });
      setSong(updated);
      setEditing(false);
    } catch (err) {
      setSaveError(err.message || "Could not save those changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const updated = await api.refreshYoutube(id);
      setSong(updated);
    } catch (err) {
      setRefreshError(err.message || "Could not refresh YouTube matches.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    await api.deleteSong(id);
    navigate("/songs");
  }

  if (loading) {
    return (
      <div className="view">
        <div className="song">Loading…</div>
      </div>
    );
  }

  if (error || !song) {
    return (
      <div className="view">
        <Msg kind="err">{error || "That song is no longer in your library."}</Msg>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="detail-head">
        <Thumb className="detail-art" src={song.thumbnail} iconSize={40} />
        <div className="detail-meta">
          {!editing ? (
            <>
              <div className="detail-title-row">
                <div className="detail-title">{songTitle(song)}</div>
                <SourceTag source={song.source} />
                <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit">
                  <PencilIcon size={16} />
                </button>
              </div>
              <div className="detail-sub">
                {[
                  song.uploader,
                  song.identify_source ? `via ${song.identify_source}` : null,
                  fmtDur(song.duration),
                  fmtSize(song.size),
                  fmtDate(song.created_at),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </>
          ) : (
            <form onSubmit={handleSaveEdit}>
              {/* htmlFor/id rather than nesting: .inline-edit-row lays the
                  label and the field out as flex siblings, and these three
                  read as labels without being ones — clicking them did
                  nothing and no screen reader tied them to a field. */}
              <div className="inline-edit-row">
                <label htmlFor="song-edit-title">Title</label>
                <input id="song-edit-title" type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="inline-edit-row">
                <label htmlFor="song-edit-track">Track</label>
                <input id="song-edit-track" type="text" value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} />
              </div>
              <div className="inline-edit-row">
                <label htmlFor="song-edit-artist">Artist</label>
                <input id="song-edit-artist" type="text" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} />
              </div>
              {saveError && <Msg kind="err">{saveError}</Msg>}
              <div className="row" style={{ marginTop: 8 }}>
                <button type="submit" className="btn small" disabled={saving}>
                  {saving ? <span className="spin" /> : "Save"}
                </button>
                <button type="button" className="btn ghost small" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {!editing && (
            <div className="detail-actions">
              <button type="button" className="btn" onClick={handlePlay}>
                {isActive && playing ? <PauseIcon size={16} style={{ marginRight: 6 }} /> : <PlayIcon size={16} style={{ marginRight: 6 }} />}
                {isActive && playing ? "Pause" : "Play"}
              </button>
              <QueueButton songs={song} />
              <button type="button" className="btn ghost" onClick={() => setAddToPlaylistOpen(true)}>
                <PlusIcon size={15} style={{ marginRight: 6 }} />
                Add to playlist
              </button>
              {/* A link, not a fetch: the browser saves the file itself, named by
                  the server's Content-Disposition. */}
              <a className="btn ghost" href={api.songDownloadUrl(song.id)} download>
                <DownloadIcon size={15} style={{ marginRight: 6 }} />
                Download MP3
              </a>
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
                <TrashIcon size={15} style={{ marginRight: 6 }} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* An upload has no post behind it — the file it came from is the
          equivalent provenance, so show that instead of an empty link. */}
      <div className="detail-section">
        {song.instagram_url || song.source_url ? (
          <a
            href={song.instagram_url || song.source_url}
            target="_blank"
            rel="noopener"
            className="insta-link"
          >
            <ExternalLinkIcon size={15} />
            {song.instagram_url || song.source_url}
          </a>
        ) : (
          <div className="insta-link">
            <FileAudioIcon size={15} />
            {song.source_file ? `Uploaded from ${song.source_file}` : "Uploaded file"}
          </div>
        )}
      </div>

      <div className="detail-section">
        <div className="view-head" style={{ marginBottom: 10 }}>
          <div className="mhead" style={{ margin: 0 }}>
            YouTube matches
          </div>
          <button type="button" className="icon-btn" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh matches" title="Refresh matches">
            {refreshing ? <span className="spin" /> : <RefreshIcon size={16} />}
          </button>
        </div>
        {refreshError && <Msg kind="err">{refreshError}</Msg>}
        {(!song.youtube || song.youtube.length === 0) && (
          <div className="song empty-state">No YouTube matches yet — try refresh.</div>
        )}
        {song.youtube && song.youtube.length > 0 && (
          <div className="link-list">
            {song.youtube.map((v, i) => (
              <YouTubeResultRow key={v.id + i} video={v} best={i === 0} />
            ))}
          </div>
        )}
      </div>

      <LyricsSection song={song} />

      {addToPlaylistOpen && <AddToPlaylistModal song={song} onClose={() => setAddToPlaylistOpen(false)} />}

      {confirmDelete && (
        <ConfirmModal
          title="Delete song"
          message={`Delete "${songTitle(song)}" from your library? The MP3 goes too.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
