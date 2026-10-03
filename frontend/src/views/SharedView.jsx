import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api/client";
import PlaylistCard from "../components/PlaylistCard";
import Msg from "../components/Msg";
import { onPlaylistsChanged } from "../utils/bus";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { titleOf } from "../components/LyricsBits";
import { FileAudioIcon, LinkIcon, LyricsIcon, PlayIcon } from "../components/icons";
import { greeting, songTitle } from "../utils/format";
import "./views.css";
import "./SharedView.css";

// The three ways in, as equals. They used to be one button ("Add a reel") and a
// paragraph that described only that one, which stopped being true the day a
// file and a link became the other two doors.
const DOORS = [
  {
    to: "/add/reel",
    icon: <LinkIcon size={20} />,
    title: "Add a reel",
    line: "Paste an Instagram link and keep the audio.",
  },
  {
    to: "/add/file",
    icon: <FileAudioIcon size={20} />,
    title: "Add a file",
    line: "Audio you already have — find out what it is.",
  },
  {
    to: "/lyrics",
    icon: <LyricsIcon size={20} />,
    title: "Find lyrics",
    line: "A link or a name, and what the words mean.",
  },
];

/**
 * The home page, and the only route with no gate on it.
 *
 * It does different work depending on who is here, which is the whole point of
 * signed-out being a state of this app rather than a different one. A visitor
 * needs to be told what this is and given something to look at. Someone signed
 * in already knows, and wants their way back into what they were doing — so the
 * explanation is replaced by their own recent work.
 *
 * The greeting sits on this page and no other. On a task page it was decoration
 * outranking the job; here, on a page you arrive at rather than work in, it is
 * the whole point of the opening line.
 */
export default function SharedView() {
  const [playlists, setPlaylists] = useState(null);
  const [songs, setSongs] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [error, setError] = useState("");
  const { user } = useAuth();
  const { playQueue } = usePlayer();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .listSharedPlaylists()
        .then((d) => {
          if (!cancelled) {
            setPlaylists(d.playlists || []);
            setError("");
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err.message || "Could not load shared playlists.");
            setPlaylists([]);
          }
        });
    }
    load();
    // Sharing one of your own is a playlist change like any other, so the same
    // signal that refreshes the sidebar brings this page up to date.
    const off = onPlaylistsChanged(load);
    return () => {
      cancelled = true;
      off();
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSongs([]);
      setLyrics([]);
      return undefined;
    }
    let cancelled = false;
    // Both are a nicety on top of a page that already works without them, so a
    // failure leaves the section out rather than taking the page down.
    api
      .listSongs({ sort: "recent", limit: 4 })
      .then((d) => !cancelled && setSongs(d.songs || []))
      .catch(() => {});
    api
      .listLyrics({ limit: 3 })
      .then((d) => !cancelled && setLyrics(d.lyrics || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  const mine = (playlists || []).filter((p) => p.mine);
  const name = user?.given_name || user?.name;

  return (
    <div className="view">
      <header className="home-hero">
        <h1 className="page-title home-greeting">
          {name ? `${greeting()}, ${name}` : greeting()}
        </h1>
        {user ? (
          <p className="home-about">
            Three ways in, one library out — the audio, what the song is, and what the
            words are saying.
          </p>
        ) : (
          <>
            <p className="home-about">
              Reelody takes a song you heard somewhere — in a reel, in a file, on YouTube —
              and gives you the MP3, the name of it, and a line-by-line reading of the
              words. Built for the ghazals and qawwalis where a literal translation tells
              you almost nothing.
            </p>
            <div className="home-actions">
              <button type="button" className="btn" onClick={() => navigate("/login")}>
                Sign in
              </button>
              <span className="home-actions-note">
                Listening needs no account — signing in is for keeping what you find.
              </span>
            </div>
          </>
        )}
      </header>

      {user && (
        <div className="home-doors">
          {DOORS.map((d) => (
            <Link key={d.to} to={d.to} className="card home-door">
              <span className="home-door-icon">{d.icon}</span>
              <span className="home-door-title">{d.title}</span>
              <span className="home-door-line">{d.line}</span>
            </Link>
          ))}
        </div>
      )}

      {user && songs.length > 0 && (
        <section className="home-section">
          <div className="home-section-head">
            <h2 className="section-head">Recently saved</h2>
            <Link to="/songs" className="ext-link">
              All songs
            </Link>
          </div>
          <div className="link-list">
            {songs.map((s, i) => (
              <div className="song home-row" key={s.id}>
                <button
                  type="button"
                  className="home-row-art"
                  onClick={() => playQueue(songs, i)}
                  aria-label={`Play ${songTitle(s)}`}
                >
                  {s.thumbnail ? <img src={s.thumbnail} alt="" /> : null}
                  <span className="home-row-play">
                    <PlayIcon size={15} />
                  </span>
                </button>
                <Link to={`/songs/${s.id}`} className="home-row-main">
                  <b>{songTitle(s)}</b>
                  <span className="via">{s.uploader || s.artist || "Untitled"}</span>
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {user && lyrics.length > 0 && (
        <section className="home-section">
          <div className="home-section-head">
            <h2 className="section-head">Recently read</h2>
            <Link to="/lyrics/saved" className="ext-link">
              Lyrics
            </Link>
          </div>
          <div className="link-list">
            {lyrics.map((r) => (
              <Link to={`/lyrics/${r.id}`} className="song home-row" key={r.id}>
                <span className="home-row-art as-thumb">
                  {r.video?.thumbnail ? <img src={r.video.thumbnail} alt="" /> : null}
                </span>
                <span className="home-row-main">
                  <b>{titleOf(r)}</b>
                  <span className="via">
                    {r.meaning ? "words and meaning" : r.state === "done" ? "words only" : r.error || r.state}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="home-section-head">
          <div>
            <h2 className="section-head">Shared by everyone</h2>
            <p className="home-invite">
              Playlists people have chosen to open up to the rest of us. Have a listen —
              press play on anything here, and take a copy if one&apos;s worth keeping.
            </p>
          </div>
          {mine.length > 0 && (
            <span className="shared-count">
              {mine.length} of yours {mine.length === 1 ? "is" : "are"} shared
            </span>
          )}
        </div>

        {error && <Msg kind="err">{error}</Msg>}

        {playlists && playlists.length === 0 && !error && (
          <div className="song empty-state">
            {user
              ? "Nothing here yet — open one of your playlists and turn on Share to be the first to contribute."
              : "Nothing here yet. Sign in, build a playlist and turn on Share to be the first to contribute."}
          </div>
        )}

        {playlists && playlists.length > 0 && (
          <div className="playlist-grid">
            {playlists.map((p) => (
              <PlaylistCard key={p.id} playlist={p} owner={p.owner} mine={p.mine} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
