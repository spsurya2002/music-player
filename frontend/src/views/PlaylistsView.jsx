import { useEffect, useState } from "react";
import * as api from "../api/client";
import PlaylistCard from "../components/PlaylistCard";
import CreatePlaylistModal from "../components/CreatePlaylistModal";
import Msg from "../components/Msg";
import { PlusIcon } from "../components/icons";
import { emitPlaylistsChanged, onPlaylistsChanged } from "../utils/bus";
import { useNavigate } from "react-router-dom";
import "./views.css";

export default function PlaylistsView() {
  const [playlists, setPlaylists] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .listPlaylists()
        .then((d) => {
          if (!cancelled) setPlaylists(d.playlists || []);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err.message || "Could not load your playlists.");
            setPlaylists([]);
          }
        });
    }
    load();
    const off = onPlaylistsChanged(load);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="page-title">Playlists</h1>
          <p className="sub">Group songs your way.</p>
        </div>
        <button type="button" className="btn" onClick={() => setCreating(true)}>
          <PlusIcon size={16} style={{ marginRight: 6 }} />
          New playlist
        </button>
      </div>

      {error && <Msg kind="err">{error}</Msg>}

      {/* Both branches below are guarded on `playlists &&`, and it starts null —
          so without this the page was a heading over blank space until the
          fetch landed. All songs says the same thing in the same situation. */}
      {playlists === null && !error && <div className="song">Loading your playlists…</div>}

      {playlists && playlists.length === 0 && (
        <div className="song empty-state">No playlists yet — make one to start grouping songs.</div>
      )}

      {playlists && playlists.length > 0 && (
        <div className="playlist-grid">
          {playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
        </div>
      )}

      {creating && (
        <CreatePlaylistModal
          onClose={() => setCreating(false)}
          onCreated={(playlist) => {
            setCreating(false);
            emitPlaylistsChanged();
            navigate(`/playlists/${playlist.id}`);
          }}
        />
      )}
    </div>
  );
}
