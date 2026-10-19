import { Link } from "react-router-dom";
import { fmtDur } from "../utils/format";
import Thumb from "./Thumb";
import { GlobeIcon, MusicIcon } from "./icons";
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
        {/* A cover URL that exists is not a cover that loads — these point at
            Instagram's CDN, which signs them and lets them expire. Thumb falls
            back to the empty block, making a dead URL look like no URL. */}
        <Thumb
          src={playlist.cover}
          loading="lazy"
          fallback={
            <div className="playlist-card-cover-empty">
              <MusicIcon size={26} />
            </div>
          }
        />
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
