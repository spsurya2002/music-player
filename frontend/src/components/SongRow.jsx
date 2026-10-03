import { useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { PlayIcon, PauseIcon, MoreIcon, PlusIcon, TrashIcon, ExternalLinkIcon, DownloadIcon, QueueIcon } from "./icons";
import SourceTag from "./SourceTag";
import { fmtDur, songTitle } from "../utils/format";
import "./SongRow.css";

export default function SongRow({ song, index, active, playing, onPlay, onOpen, onAddToQueue, onAddToPlaylist, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  return (
    <div className={"song-row" + (active ? " active" : "")}>
      <button type="button" className="song-row-index" onClick={onPlay} aria-label={active && playing ? "Pause" : "Play"}>
        <span className="idx">{index + 1}</span>
        <span className="ico">{active && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</span>
      </button>

      <button type="button" className="song-row-main" onClick={onOpen}>
        <img className="song-row-thumb" src={song.thumbnail || undefined} alt="" />
        <span className="song-row-text">
          <span className="song-row-title">{songTitle(song)}</span>
          <span className="song-row-artist">{song.artist || song.uploader || "Unknown"}</span>
        </span>
      </button>

      <SourceTag source={song.source} />

      <span className="song-row-duration">{fmtDur(song.duration)}</span>

      <div className="song-row-menu" ref={menuRef}>
        <button type="button" className="icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="More">
          <MoreIcon size={18} />
        </button>
        {menuOpen && (
          <div className="song-row-dropdown">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpen();
              }}
            >
              <ExternalLinkIcon size={15} />
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onAddToQueue();
              }}
            >
              <QueueIcon size={15} />
              Add to queue
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onAddToPlaylist();
              }}
            >
              <PlusIcon size={15} />
              Add to playlist
            </button>
            <a href={api.songDownloadUrl(song.id)} download onClick={() => setMenuOpen(false)}>
              <DownloadIcon size={15} />
              Download MP3
            </a>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              <TrashIcon size={15} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
