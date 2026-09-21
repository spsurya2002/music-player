import { Link } from "react-router-dom";
import { fmtDur } from "../utils/format";
import "./PlaylistCard.css";

export default function PlaylistCard({ playlist }) {
  return (
    <Link to={`/playlists/${playlist.id}`} className="playlist-card">
      <div className="playlist-card-cover">
        {playlist.cover ? (
          <img src={playlist.cover} alt="" loading="lazy" />
        ) : (
          <div className="playlist-card-cover-empty" />
        )}
      </div>
      <div className="playlist-card-name">{playlist.name}</div>
      <div className="playlist-card-meta">
        {playlist.song_count} song{playlist.song_count === 1 ? "" : "s"}
        {playlist.duration ? ` · ${fmtDur(playlist.duration)}` : ""}
      </div>
    </Link>
  );
}
