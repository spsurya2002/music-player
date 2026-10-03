import { Link } from "react-router-dom";
import { fmtDur } from "../utils/format";
import { GlobeIcon } from "./icons";
import Avatar from "./Avatar";
import "./PlaylistCard.css";

// One card, two pages. On your own Playlists grid it links to the playlist and
// marks the ones you've shared; on the Shared page it links to the read-only
// view and says whose it is. The difference is `owner`, not a second component —
// they are the same object and should not drift apart visually.
export default function PlaylistCard({ playlist, owner = null, mine = false }) {
  const shared = Boolean(owner);

  return (
    <Link
      to={shared ? `/shared/${playlist.id}` : `/playlists/${playlist.id}`}
      className="playlist-card"
    >
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

      {shared ? (
        <div className="playlist-card-owner">
          <Avatar user={owner} size={18} />
          {/* Your own name read back at you is a small oddity every time. */}
          <span>{mine ? "Shared by you" : `Shared by ${owner?.given_name || owner?.name}`}</span>
        </div>
      ) : (
        playlist.is_public && (
          <div className="playlist-card-shared">
            <GlobeIcon size={13} />
            <span>Shared</span>
          </div>
        )
      )}
    </Link>
  );
}
