import { Link } from "react-router-dom";
import { usePlayer } from "../context/PlayerContext";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, VolumeIcon, MuteIcon, LoopOffIcon, LoopOneIcon, QueueIcon } from "./icons";
import { fmtDur, songTitle } from "../utils/format";
import "./PlayerBar.css";

export default function PlayerBar() {
  const {
    currentSong,
    playing,
    currentTime,
    duration,
    volume,
    loopMode,
    queue,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    cycleLoop,
    toggleQueue,
    queueOpen,
    playerError,
  } = usePlayer();

  if (!currentSong) {
    return (
      <div className="player-bar player-bar-empty">
        <span>Nothing playing — pick a song from your library.</span>
      </div>
    );
  }

  const pct = duration ? (currentTime / duration) * 100 : 0;

  function handleSeek(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seek(ratio * (duration || 0));
  }

  const LoopIcon = loopMode === "one" ? LoopOneIcon : LoopOffIcon;

  return (
    <div className="player-bar">
      <div className="player-left">
        <Link to={`/songs/${currentSong.id}`} className="player-art-link">
          <img className="player-art" src={currentSong.thumbnail || undefined} alt="" />
        </Link>
        <div className="player-meta">
          <Link to={`/songs/${currentSong.id}`} className="player-title">
            {songTitle(currentSong)}
          </Link>
          <div className="player-artist" style={playerError ? { color: "var(--err)" } : undefined}>
            {playerError || currentSong.artist || currentSong.uploader}
          </div>
        </div>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button type="button" className="icon-btn" onClick={prev} aria-label="Previous">
            <PrevIcon size={18} />
          </button>
          <button type="button" className="player-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <button type="button" className="icon-btn" onClick={next} aria-label="Next">
            <NextIcon size={18} />
          </button>
        </div>
        <div className="player-seek-row">
          <span className="player-time">{fmtDur(currentTime)}</span>
          <div className="player-seek" onClick={handleSeek}>
            <div className="player-seek-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="player-time">{fmtDur(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        <button
          type="button"
          className={"icon-btn" + (loopMode !== "off" ? " active" : "")}
          onClick={cycleLoop}
          aria-label={`Loop: ${loopMode}`}
          title={`Loop: ${loopMode}`}
        >
          <LoopIcon size={18} />
        </button>
        <button
          type="button"
          className={"icon-btn" + (queueOpen ? " active" : "")}
          onClick={toggleQueue}
          aria-label="Queue"
          title={`Up next (${queue.length})`}
        >
          <QueueIcon size={18} />
        </button>
        <div className="player-volume">
          {volume > 0 ? <VolumeIcon size={17} /> : <MuteIcon size={17} />}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
