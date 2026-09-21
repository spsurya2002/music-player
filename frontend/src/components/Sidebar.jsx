import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import * as api from "../api/client";
import { onPlaylistsChanged } from "../utils/bus";
import { SearchIcon, LibraryIcon, PlaylistIcon, FileAudioIcon } from "./icons";
import "./Sidebar.css";

export default function Sidebar() {
  const [playlists, setPlaylists] = useState([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .listPlaylists()
        .then((d) => {
          if (!cancelled) setPlaylists(d.playlists || []);
        })
        .catch(() => {
          if (!cancelled) setPlaylists([]);
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
    <nav className="sidebar">
      <div className="sidebar-word">Reel Audio</div>

      <div className="sidebar-nav">
        <NavLink to="/" end className="sidebar-link">
          <SearchIcon size={18} />
          <span>Search</span>
        </NavLink>
        <NavLink to="/songs" className="sidebar-link">
          <LibraryIcon size={18} />
          <span>All songs</span>
        </NavLink>
        <NavLink to="/playlists" className="sidebar-link">
          <PlaylistIcon size={18} />
          <span>Playlists</span>
        </NavLink>
      </div>

      {playlists.length > 0 && (
        <div className="sidebar-playlists">
          <div className="sidebar-heading">Your playlists</div>
          <div className="sidebar-playlist-list">
            {playlists.map((p) => (
              <NavLink key={p.id} to={`/playlists/${p.id}`} className="sidebar-playlist-link">
                {p.name}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* Pinned to the bottom of the rail — a side tool, not a third library
          section, so it sits apart from the nav above. */}
      <div className="sidebar-foot">
        <NavLink to="/identify" className="sidebar-link">
          <FileAudioIcon size={18} />
          <span>MP3 to link</span>
        </NavLink>
      </div>
    </nav>
  );
}
