import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, VolumeIcon, MuteIcon, LoopOffIcon, LoopOneIcon, QueueIcon, Back3Icon, Forward3Icon } from "./icons";
import { fmtDur, songTitle } from "../utils/format";
import "./PlayerBar.css";
import Thumb from "./Thumb";

// How far the two nudge buttons move. Three, because that is the length of a
// line you missed — the arrow keys still step 5 (useGlobalShortcuts.js).
const SKIP = 3;

export default function PlayerBar() {
  const {
    currentSong,
    playing,
    currentTime,
    duration,
    volume,
    loopMode,
    queue,
    currentIndex,
    togglePlay,
    next,
    prev,
    seek,
    seekBy,
    setVolume,
    cycleLoop,
    toggleQueue,
    queueOpen,
    playerError,
  } = usePlayer();
  // Only to word the empty state: signed out there is no library to point at.
  const { user } = useAuth();

  const seekRef = useRef(null);
  // Where the pointer is while dragging, in seconds, or null when it isn't.
  // The bar reads this instead of the audio's clock so it follows the gesture
  // — committing on every move makes the element re-buffer and stutter, which
  // is why the seek only happens on release.
  const [scrub, setScrub] = useState(null);

  const timeAt = useCallback(
    (clientX) => {
      const el = seekRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width ? (clientX - rect.left) / rect.width : 0;
      return Math.min(1, Math.max(0, ratio)) * (duration || 0);
    },
    [duration]
  );

  // The listeners go on `window` for the length of the gesture, not on the
  // track: a 4px strip only sees the pointer while it is over it, and the
  // first real movement leaves it. Same reason the YouTube dock does this.
  const dragging = scrub !== null;
  useEffect(() => {
    if (!dragging) return undefined;

    function onMove(e) {
      setScrub(timeAt(e.clientX));
    }
    function onUp(e) {
      setScrub(null);
      seek(timeAt(e.clientX));
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    // Without this the drag selects whatever text it crosses and the bar
    // appears to stick while a selection grows behind it.
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = prev;
    };
  }, [dragging, timeAt, seek]);

  if (!currentSong) {
    // A visitor has no library to pick from, and telling them to use one is the
    // app describing a room they can't see. What they can play is the shared
    // feed, which is the page they are already on.
    return (
      <div className="player-bar player-bar-empty">
        <span>
          {user
            ? "Nothing playing — pick a song from your library."
            : "Nothing playing — press play on anything in the shared playlists."}
        </span>
      </div>
    );
  }

  // While dragging, the bar and the clock both show where the finger is, not
  // where the audio still is.
  const shownTime = scrub ?? currentTime;
  const pct = duration ? (shownTime / duration) * 100 : 0;
  // What is still ahead, not the whole queue: the song playing is not "up
  // next". With the drawer shut this badge is the only sign that adding to the
  // queue from a row menu or a song page did anything.
  const upNext = queue.length - currentIndex - 1;

  function onSeekKey(e) {
    // The track owns the arrows while it has focus (data-arrow-keys below
    // tells the global shortcut to stand aside), so the step can be finer
    // here than the 5s a keypress gets from anywhere else.
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight") seekBy(step);
    else if (e.key === "ArrowLeft") seekBy(-step);
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(duration || 0);
    else return;
    e.preventDefault();
  }

  const LoopIcon = loopMode === "one" ? LoopOneIcon : LoopOffIcon;

  return (
    <div className="player-bar">
      <div className="player-left">
        <Link to={`/songs/${currentSong.id}`} className="player-art-link">
          <Thumb className="player-art" src={currentSong.thumbnail} iconSize={22} />
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
          {/* A nudge, not a skip: the thing you reach for when a line went by
              too fast. SKIP seconds matches nothing else on the bar, so the
              number is written on the button rather than left to the glyph. */}
          <button
            type="button"
            className="icon-btn player-nudge"
            onClick={() => seekBy(-SKIP)}
            aria-label={`Back ${SKIP} seconds`}
            title={`Back ${SKIP} seconds`}
          >
            <Back3Icon size={18} />
            <span>{SKIP}</span>
          </button>
          <button type="button" className="player-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <button
            type="button"
            className="icon-btn player-nudge"
            onClick={() => seekBy(SKIP)}
            aria-label={`Forward ${SKIP} seconds`}
            title={`Forward ${SKIP} seconds`}
          >
            <Forward3Icon size={18} />
            <span>{SKIP}</span>
          </button>
          <button type="button" className="icon-btn" onClick={next} aria-label="Next">
            <NextIcon size={18} />
          </button>
        </div>
        <div className="player-seek-row">
          <span className="player-time">{fmtDur(shownTime)}</span>
          {/* Press and drag are one gesture: a tap is a drag that ended
              straight away, so there is no separate click handler. */}
          <div
            ref={seekRef}
            className={"player-seek" + (dragging ? " dragging" : "")}
            onPointerDown={(e) => {
              setScrub(timeAt(e.clientX));
              e.preventDefault();
            }}
            onKeyDown={onSeekKey}
            data-arrow-keys
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration || 0)}
            aria-valuenow={Math.round(shownTime)}
            aria-valuetext={`${fmtDur(shownTime)} of ${fmtDur(duration)}`}
          >
            <div className="player-seek-fill" style={{ width: `${pct}%` }} />
            <div className="player-seek-thumb" style={{ left: `${pct}%` }} />
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
          className={"icon-btn player-queue-btn" + (queueOpen ? " active" : "")}
          onClick={toggleQueue}
          aria-label={upNext > 0 ? `Queue — ${upNext} up next` : "Queue"}
          title={upNext > 0 ? `Up next (${upNext})` : "Nothing after this one"}
        >
          <QueueIcon size={18} />
          {upNext > 0 && <span className="player-queue-count">{upNext}</span>}
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
