import { fmtDur, badgeClass } from "../utils/format";
import { usePlayer } from "../context/PlayerContext";

export default function YouTubeResultRow({ video, best = false }) {
  const { openYoutube } = usePlayer();

  return (
    <button type="button" className={"yt" + (best ? " best" : "")} onClick={() => openYoutube(video.id, video.title)}>
      <img src={video.thumbnail} alt="" loading="lazy" />
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
