import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import { usePlayer } from "../context/PlayerContext";
import { useAuth } from "../context/AuthContext";
import Avatar from "../components/Avatar";
import Msg from "../components/Msg";
import QueueButton from "../components/QueueButton";
import { PlayIcon, PauseIcon, DownloadIcon, CopyIcon, GlobeIcon, MusicIcon } from "../components/icons";
import { emitPlaylistsChanged } from "../utils/bus";
import { fmtDur, songTitle } from "../utils/format";
import Pager, { PAGE_SIZE } from "../components/Pager";
import "./views.css";
import Thumb from "../components/Thumb";

// Somebody else's playlist, read-only. You can play it and you can copy it;
// there is deliberately no rename, reorder, remove or delete here — editing
// belongs to whoever made it. Copying is what turns it into something you can
// change, and the copy is private until you share it yourself.
export default function SharedPlaylistView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { playQueue, currentSong, playing, togglePlay, activePlaylistId } = usePlayer();
  const { user } = useAuth();

  const [playlist, setPlaylist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [copyErr, setCopyErr] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getSharedPlaylist(id)
      .then((d) => {
        if (cancelled) return;
        setPlaylist(d.playlist);
        setPage(1);
        setSongs(d.songs || []);
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "That playlist isn't shared.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isActivePlaylist = playlist && activePlaylistId === playlist.id;

  function handlePlayAll() {
    if (songs.length === 0) return;
    playQueue(songs, 0, { playlistId: playlist.id, loop: playlist.loop, shared: true });
  }

  function handleRowPlay(song, index) {
    if (currentSong && currentSong.id === song.id && isActivePlaylist) {
      togglePlay();
      return;
    }
    playQueue(songs, index, { playlistId: playlist.id, loop: playlist.loop, shared: true });
  }

  async function handleCopy() {
    setCopying(true);
    setCopyErr("");
    setCopyMsg("");
    try {
      const res = await api.copySharedPlaylist(id);
      emitPlaylistsChanged();
      const had = res.already_had
        ? ` ${res.already_had} ${res.already_had === 1 ? "was" : "were"} already in your library.`
        : "";
      setCopyMsg(
        `Saved as "${res.playlist.name}" — ${res.added} song${res.added === 1 ? "" : "s"} added.${had}`
      );
      // A beat on the message, then the copy itself — which is editable, and is
      // what they actually wanted.
      setTimeout(() => navigate(`/playlists/${res.playlist.id}`), 1200);
    } catch (err) {
      setCopyErr(err.message || "Could not copy that playlist.");
    } finally {
      setCopying(false);
    }
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
        <Msg kind="err">{error || "That playlist isn't shared."}</Msg>
        <p className="sub">
          <Link to="/">Back to Shared</Link>
        </p>
      </div>
    );
  }

  const owner = playlist.owner;
  const pageStart = (Math.min(page, Math.max(1, Math.ceil(songs.length / PAGE_SIZE))) - 1) * PAGE_SIZE;
  const visibleSongs = songs.slice(pageStart, pageStart + PAGE_SIZE);

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
          <div className="detail-title-row">
            <div className="detail-title">{playlist.name}</div>
            <span className="shared-pill">
              <GlobeIcon size={12} />
              Shared
            </span>
          </div>

          <div className="shared-by">
            <Avatar user={owner} size={22} />
            <span>
              {playlist.mine ? "Shared by you" : `Shared by ${owner?.name || "someone"}`}
            </span>
          </div>

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
            {!user ? (
              /* Anyone can play this; keeping a copy needs somewhere to keep it. */
              <Link className="btn secondary" to="/login" state={{ from: `/shared/${id}` }}>
                Sign in to save it
              </Link>
            ) : playlist.mine ? (
              <Link className="btn secondary" to={`/playlists/${playlist.id}`}>
                Manage it
              </Link>
            ) : (
              <button
                type="button"
                className="btn secondary"
                onClick={handleCopy}
                disabled={copying || songs.length === 0}
              >
                {copying ? <span className="spin" /> : <CopyIcon size={16} style={{ marginRight: 6 }} />}
                Save to my library
              </button>
            )}
          </div>
        </div>
      </div>

      {copyErr && <Msg kind="err">{copyErr}</Msg>}
      {copyMsg && <Msg kind="ok">{copyMsg}</Msg>}

      {songs.length === 0 ? (
        <div className="song empty-state">There's nothing in this playlist yet.</div>
      ) : (
        <div className="playlist-song-list">
          {visibleSongs.map((song, i) => {
            const index = pageStart + i;
            const active = currentSong && currentSong.id === song.id && isActivePlaylist;
            return (
              <div key={song.id} className="playlist-song-row shared-row">
                <div className={"song-row" + (active ? " active" : "")}>
                  <button
                    type="button"
                    className="song-row-index"
                    onClick={() => handleRowPlay(song, index)}
                    aria-label={active && playing ? "Pause" : "Play"}
                  >
                    <span className="idx">{index + 1}</span>
                    <span className="ico">
                      {active && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                    </span>
                  </button>
                  {/* Not a link to /songs/{id}: that page is the owner's copy,
                      with its edit controls and its play count. */}
                  <div className="song-row-main as-text">
                    <Thumb className="song-row-thumb" src={song.thumbnail} />
                    <span className="song-row-text">
                      <span className="song-row-title">{songTitle(song)}</span>
                      <span className="song-row-artist">{song.artist || song.uploader || "Unknown"}</span>
                    </span>
                  </div>
                  <span className="song-row-duration">{fmtDur(song.duration)}</span>
                </div>
                <a
                  className="icon-btn"
                  href={api.sharedSongDownloadUrl(song.id)}
                  download
                  aria-label="Download MP3"
                  title="Download MP3"
                >
                  <DownloadIcon size={16} />
                </a>
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
    </div>
  );
}
