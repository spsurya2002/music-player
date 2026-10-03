import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../api/client";
import { usePlayer } from "../context/PlayerContext";
import SongRow from "../components/SongRow";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import ConfirmModal from "../components/ConfirmModal";
import Msg from "../components/Msg";
import { songTitle } from "../utils/format";
import "./views.css";

const SORTS = [
  { value: "recent", label: "Recently added" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "plays", label: "Most played" },
];

export default function AllSongsView() {
  // The top bar searches from anywhere and lands here with ?q=, so the URL —
  // not this component — is where the query lives. That also makes a search
  // result a link you can send someone or come back to.
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const setQ = (value) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true }
    );

  const [sort, setSort] = useState("recent");
  const [songs, setSongs] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [addToPlaylistSong, setAddToPlaylistSong] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { playQueue, addToQueue, currentSong, playing, togglePlay } = usePlayer();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .listSongs({ q: q.trim() || undefined, sort })
        .then((d) => {
          if (cancelled) return;
          setSongs(d.songs || []);
          setError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message || "Could not load your library.");
          setSongs([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, sort]);

  function handleRowPlay(song, index) {
    if (currentSong && currentSong.id === song.id) {
      togglePlay();
      return;
    }
    playQueue(songs, index);
  }

  async function handleDelete() {
    await api.deleteSong(deleteTarget.id);
    setSongs((list) => list.filter((s) => s.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="page-title" style={{ fontSize: 26 }}>
            All songs
          </h1>
          <p className="sub" style={{ margin: 0 }}>
            Everything in your library — reels and files you've uploaded.
          </p>
        </div>
        <div className="view-head-controls">
          <input
            type="search"
            placeholder="Search title, artist, uploader…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <Msg kind="err">{error}</Msg>}

      {loading && !songs && <div className="song">Loading your library…</div>}

      {songs && songs.length === 0 && !loading && (
        <div className="song empty-state">
          {q ? "Nothing matches that search." : "Nothing saved yet — paste a reel link to start."}
        </div>
      )}

      {songs && songs.length > 0 && (
        <div className="song-list">
          {songs.map((song, i) => (
            <SongRow
              key={song.id}
              song={song}
              index={i}
              active={currentSong && currentSong.id === song.id}
              playing={playing}
              onPlay={() => handleRowPlay(song, i)}
              onOpen={() => navigate(`/songs/${song.id}`)}
              onAddToQueue={() => addToQueue(song)}
              onAddToPlaylist={() => setAddToPlaylistSong(song)}
              onDelete={() => setDeleteTarget(song)}
            />
          ))}
        </div>
      )}

      {addToPlaylistSong && (
        <AddToPlaylistModal song={addToPlaylistSong} onClose={() => setAddToPlaylistSong(null)} />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete song"
          message={`Delete "${songTitle(deleteTarget)}" from your library? The MP3 goes too.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
