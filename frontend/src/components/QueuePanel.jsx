import { useRef, useState } from "react";
import { usePlayer } from "../context/PlayerContext";
import { CloseIcon, GripIcon, PlayIcon, PauseIcon } from "./icons";
import { fmtDur, songTitle } from "../utils/format";
import "./QueuePanel.css";
import Thumb from "./Thumb";

export default function QueuePanel() {
  const { queue, currentIndex, playing, jumpTo, reorderQueue, toggleQueue, removeFromQueue, room } =
    usePlayer();
  const guest = room?.status === "open" && room.role === "guest";
  const [dragIndex, setDragIndex] = useState(null);
  const overIndex = useRef(null);

  if (queue.length === 0) {
    return (
      <div className="queue-panel">
        <div className="queue-panel-head">
          <span>Up next</span>
          <button type="button" className="icon-btn" onClick={toggleQueue} aria-label="Close queue">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="song">Nothing queued — play a song or a playlist to fill this up.</div>
      </div>
    );
  }

  function handleDrop(index) {
    if (dragIndex === null || dragIndex === index) return;
    reorderQueue(dragIndex, index);
    setDragIndex(null);
  }

  return (
    <div className="queue-panel">
      <div className="queue-panel-head">
        <span>Up next · {queue.length}</span>
        <button type="button" className="icon-btn" onClick={toggleQueue} aria-label="Close queue">
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="queue-list">
        {queue.map((song, i) => (
          <div
            key={`${song.id}-${i}`}
            className={"queue-item" + (i === currentIndex ? " active" : "")}
            draggable={!guest}
            onDragStart={() => {
              if (!guest) setDragIndex(i);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              overIndex.current = i;
            }}
            onDrop={() => handleDrop(i)}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="queue-grip">
              <GripIcon size={15} />
            </span>
            <button
              type="button"
              className="queue-item-main"
              onClick={() => jumpTo(i)}
              disabled={guest}
            >
              <Thumb src={song.thumbnail} iconSize={16} />
              <span className="queue-item-text">
                <span className="queue-item-title">{songTitle(song)}</span>
                <span className="queue-item-artist">{song.artist || song.uploader}</span>
              </span>
              {i === currentIndex && playing ? <PauseIcon size={14} /> : i === currentIndex ? <PlayIcon size={14} /> : null}
            </button>
            <span className="queue-item-duration">{fmtDur(song.duration)}</span>
            {!guest && (
              <button type="button" className="icon-btn" onClick={() => removeFromQueue(i)} aria-label="Remove from queue">
                <CloseIcon size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
