import { fmtDur, badgeClass } from "../utils/format";
import { usePlayer } from "../context/PlayerContext";
import Thumb from "./Thumb";

// Clicking a match docks it in the corner rather than opening a modal over the
// page: you are usually comparing it against the song you already have, and a
// sheet across the middle is the one thing that stops you doing that.
export default function YouTubeResultRow({ video, best = false }) {
  const { dockYoutube } = usePlayer();

  return (
    <button type="button" className={"yt" + (best ? " best" : "")} onClick={() => dockYoutube(video.id, video.title)}>
      <Thumb src={video.thumbnail} loading="lazy" iconSize={18} />
      <div className="body">
        <div className="t">{video.title}</div>
        <div className="c">
          {video.channel}
          {video.duration ? ` · ${fmtDur(video.duration)}` : ""}
        </div>
      </div>
      <span className={"badge" + (best ? "" : badgeClass(video.score))}>{best ? "BEST" : `${video.score}%`}</span>
    </button>
  );
}
