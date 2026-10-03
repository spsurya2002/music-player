import { useEffect } from "react";
import { usePlayer } from "../context/PlayerContext";

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

// Somewhere that wants the arrow keys for itself — the lyrics book turns pages
// with them. Opting in by attribute rather than by stopping propagation,
// because the global listener is on `document` and the order of those two is
// not something a component should have to reason about.
function ownsArrows(target) {
  return Boolean(target?.closest?.("[data-arrow-keys]"));
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
        if (!ownsArrows(document.activeElement)) seekBy(5);
      } else if (e.key === "ArrowLeft") {
        if (!ownsArrows(document.activeElement)) seekBy(-5);
      } else if (e.key === "Escape" && queueOpen) {
        toggleQueue();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, seekBy, queueOpen, toggleQueue]);
}
