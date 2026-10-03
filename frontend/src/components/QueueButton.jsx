import { useEffect, useState } from "react";
import { usePlayer } from "../context/PlayerContext";
import { CheckIcon, QueueIcon } from "./icons";

/**
 * Add to queue, carrying its own receipt.
 *
 * The queue drawer is shut most of the time, so adding to it moves nothing on
 * screen that you are necessarily looking at. The button says what happened
 * where the click was, then goes back to being itself.
 *
 * Takes one song or a list of them, so the same control queues a row and a
 * whole playlist.
 */
export default function QueueButton({
  songs,
  label = "Add to queue",
  className = "btn ghost",
  disabled = false,
}) {
  const { addToQueue } = usePlayer();
  // A count rather than a flag: clicking again has to restart the timer, and
  // setting a flag that is already true changes nothing for the effect to see.
  const [receipt, setReceipt] = useState(0);

  useEffect(() => {
    if (!receipt) return undefined;
    const t = setTimeout(() => setReceipt(0), 1800);
    return () => clearTimeout(t);
  }, [receipt]);

  const list = (Array.isArray(songs) ? songs : [songs]).filter(Boolean);

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || list.length === 0}
      onClick={() => {
        addToQueue(list);
        setReceipt((n) => n + 1);
      }}
    >
      {receipt ? <CheckIcon size={15} style={{ marginRight: 6 }} /> : <QueueIcon size={15} style={{ marginRight: 6 }} />}
      {receipt ? "Queued" : label}
    </button>
  );
}
