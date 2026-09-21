import { useEffect } from "react";
import { usePlayer } from "../context/PlayerContext";

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

// Space toggles play, arrows seek 5s, Escape closes the queue drawer (modals
// handle their own Escape). Skipped whenever a form field has focus.
export default function useGlobalShortcuts() {
  const { togglePlay, seekBy, queueOpen, toggleQueue } = usePlayer();

  useEffect(() => {
    function onKeyDown(e) {
      if (isTyping(document.activeElement)) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        seekBy(5);
      } else if (e.key === "ArrowLeft") {
        seekBy(-5);
      } else if (e.key === "Escape" && queueOpen) {
        toggleQueue();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, seekBy, queueOpen, toggleQueue]);
}
