import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayer } from "../context/PlayerContext";
import { ChevronIcon, CloseIcon, GripIcon, OpacityIcon } from "./icons";
import "./YouTubePlayer.css";

const PLACE_KEY = "yt-dock-place";
const OPACITY_KEY = "yt-dock-opacity";
// Low enough to read a page straight through the player, and not zero: the
// point is to see past it, not to lose it.
const MIN_OPACITY = 2;
// Small enough to tuck into a corner and forget, which is the point of a
// corner player; 160px of 16:9 is a 90px picture, still big enough to see what
// is on.
const MIN_W = 160;
const MAX_W = 720;
const HEAD_H = 38;
// The video's 16:9 locks height to width, so a resize only ever has one real
// number in it; everything below converts a corner's pull into that number.
const RATIO = 9 / 16;
// Which edges each corner moves. The opposite corner is the anchor: pull the
// north-west one and the south-east stays exactly where it was put.
const CORNERS = {
  nw: { west: true, north: true, label: "Resize from the top left" },
  ne: { west: false, north: true, label: "Resize from the top right" },
  sw: { west: true, north: false, label: "Resize from the bottom left" },
  se: { west: false, north: false, label: "Resize from the bottom right" },
};
// How much of the card must stay on screen. Enough to get hold of it again —
// that is the whole rule.
const KEEP_VISIBLE = 90;

/**
 * Keep the card reachable, and otherwise leave it alone.
 *
 * It sits above every fixed strip in the app (z-index 120, under modals only),
 * so it can be parked over the rail, the top bar or the player bar and still
 * takes the clicks — there is nothing to protect it from. The single rule left
 * is that it must not be dragged off the viewport: the header is the only drag
 * handle, and a handle past the edge is a player you can never move back.
 */
function clamp(place) {
  const w = Math.min(MAX_W, Math.max(MIN_W, place.width));
  return {
    width: w,
    // Horizontally it may hang off either edge, as long as a grabbable strip
    // of the header is still showing.
    left: Math.min(
      Math.max(KEEP_VISIBLE - w, place.left),
      window.innerWidth - KEEP_VISIBLE
    ),
    // Vertically the header itself has to stay in view — above the top edge
    // there is nothing left to take hold of.
    top: Math.min(Math.max(0, place.top), Math.max(0, window.innerHeight - HEAD_H)),
  };
}

function loadPlace() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
    return raw && typeof raw.left === "number" ? clamp(raw) : null;
  } catch {
    return null;
  }
}

function loadOpacity() {
  try {
    const raw = parseInt(localStorage.getItem(OPACITY_KEY) || "", 10);
    return Number.isFinite(raw) ? Math.min(100, Math.max(MIN_OPACITY, raw)) : 100;
  } catch {
    return 100;
  }
}

let apiPromise = null;

function loadYouTubeIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === "function") prevReady();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/**
 * The YouTube player: one card, in the corner, draggable and resizable.
 *
 * It used to be a modal. Both the things it gets opened for — comparing a match
 * against the song you already have, and hearing a song while you read its
 * words — are exactly the cases a sheet across the middle of the screen ruins.
 * So it floats instead, and you put it wherever it is not in the way.
 *
 * It lives in Shell beside the audio element, so it survives navigation, and
 * there is only ever one of it: a second player would be a second sound.
 */
export default function YouTubePlayer() {
  const { ytModal, closeYoutube, registerYoutubePause, queueOpen } = usePlayer();
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const cancelledRef = useRef(false);
  const [folded, setFolded] = useState(false);
  // Percent, not a fraction: it is what the slider and the readout both speak,
  // and the one conversion happens where it is handed to CSS.
  const [opacity, setOpacity] = useState(loadOpacity);
  const [tuning, setTuning] = useState(false);
  // null until it has been moved: the corner is the default and costs no
  // stored state, so a fresh browser gets a sensible place rather than a
  // remembered one it never chose.
  const [place, setPlace] = useState(loadPlace);

  const { open, videoId, title } = ytModal;

  useEffect(() => {
    if (!open || !videoId) return undefined;
    cancelledRef.current = false;

    loadYouTubeIframeApi().then((YT) => {
      if (cancelledRef.current || !mountRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        videoId,
        playerVars: { autoplay: 1, rel: 0 },
      });
      // Hand the pause up, so starting an MP3 can silence this without anything
      // else having to reach inside the iframe.
      registerYoutubePause(() => playerRef.current?.pauseVideo?.());
    });

    return () => {
      cancelledRef.current = true;
      registerYoutubePause(null);
      if (playerRef.current && playerRef.current.destroy) {
        try {
          playerRef.current.destroy();
        } catch {
          // player already gone
        }
      }
      playerRef.current = null;
    };
  }, [open, videoId, registerYoutubePause]);

  // A window that shrinks can leave the card off the edge, or under a strip
  // that just got taller. Re-clamping on resize is what stops it stranding.
  useEffect(() => {
    function onResize() {
      setPlace((p) => (p ? clamp(p) : p));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OPACITY_KEY, String(opacity));
    } catch {
      // A browser refusing storage still fades; it just forgets on reload.
    }
  }, [opacity]);

  // Folding is a CSS change only — destroying the iframe would stop the sound,
  // which is the opposite of what folding it away is for.
  useEffect(() => {
    if (!open) {
      setFolded(false);
      setTuning(false);
    }
  }, [open]);

  // Dragging by the head, resizing from any of the four corners.
  //
  // The listeners go on `window` for the length of the gesture rather than on
  // the handle. A handle only sees the pointer while it is over the handle, and
  // the head is a 32px strip: the first real movement leaves it and every event
  // after that goes somewhere else. (setPointerCapture is the other fix, but it
  // throws on a detached node and leaves the drag half-armed.)
  const [drag, setDrag] = useState(null);

  useEffect(() => {
    if (!drag) return undefined;

    function onMove(e) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (drag.kind === "move") {
        setPlace(clamp({ width: drag.width, left: drag.left + dx, top: drag.top + dy }));
        return;
      }
      const corner = CORNERS[drag.kind];
      // Growth in the card's own terms, so the four corners share one sum:
      // pulling the west edge left is the same intention as pulling the east
      // edge right.
      const growW = corner.west ? -dx : dx;
      const growH = corner.north ? -dy : dy;
      // A locked ratio cannot honour both axes, so the one pulled further
      // wins and the other follows it. Taking only the horizontal would make
      // a corner dragged straight down sit still.
      const pull = Math.abs(growH) > Math.abs(growW) * RATIO ? growH / RATIO : growW;
      // Clamp the width first: deriving the edges from a width that is then
      // clamped is what slides the anchored corner at the limits.
      const width = Math.min(MAX_W, Math.max(MIN_W, drag.width + pull));
      const grew = width - drag.width;
      setPlace(
        clamp({
          width,
          left: corner.west ? drag.left - grew : drag.left,
          top: corner.north ? drag.top - grew * RATIO : drag.top,
        })
      );
    }

    function onUp() {
      setDrag(null);
      setPlace((p) => {
        try {
          if (p) localStorage.setItem(PLACE_KEY, JSON.stringify(p));
        } catch {
          // A browser refusing storage still drags; it just forgets on reload.
        }
        return p;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    // Without this a drag selects the text it passes over, and the card appears
    // to stick while the selection grows behind it.
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = prev;
    };
  }, [drag]);

  const startDrag = useCallback((e, kind) => {
    if (e.target.closest("button")) return; // the head's own controls
    const el = e.currentTarget.closest(".yt-dock");
    if (!el) return;
    const box = el.getBoundingClientRect();
    setDrag({
      kind,
      startX: e.clientX,
      startY: e.clientY,
      left: box.left,
      top: box.top,
      width: box.width,
    });
    e.preventDefault();
  }, []);

  const resetPlace = useCallback(() => {
    setPlace(null);
    try {
      localStorage.removeItem(PLACE_KEY);
    } catch {
      // nothing to forget
    }
  }, []);

  if (!open) return null;

  return (
      <div
        className={
          "yt-dock" +
          (drag ? " dragging" : "") +
          (folded ? " folded" : "") +
          (tuning ? " tuning" : "") +
          (queueOpen && !place ? " beside-queue" : "") +
          (place ? " placed" : "")
        }
        style={{
          "--yt-dock-opacity": opacity / 100,
          ...(place ? { left: place.left, top: place.top, width: place.width } : null),
        }}
      >
        <div
          className="yt-dock-head"
          onPointerDown={(e) => startDrag(e, "move")}
          onDoubleClick={resetPlace}
          title="Drag to move · double-click to send it back to the corner"
        >
          <GripIcon size={14} className="yt-dock-grip" />
          <span className="yt-dock-title" title={title}>
            {title || "Playing on YouTube"}
          </span>
          <button
            type="button"
            className={"icon-btn" + (tuning ? " active" : "")}
            onClick={() => setTuning((v) => !v)}
            aria-label="See through the player"
            aria-expanded={tuning}
            title={opacity < 100 ? `See-through — ${opacity}% solid` : "See through the player"}
          >
            <OpacityIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFolded((v) => !v)}
            aria-label={folded ? "Show the video" : "Hide the video, keep playing"}
            title={folded ? "Show the video" : "Hide the video, keep playing"}
          >
            <ChevronIcon size={16} className={folded ? "yt-dock-up" : "yt-dock-down"} />
          </button>
          <button type="button" className="icon-btn" onClick={closeYoutube} aria-label="Stop">
            <CloseIcon size={16} />
          </button>
        </div>
        {tuning && (
          <div className="yt-dock-fade">
            <OpacityIcon size={13} className="yt-dock-fade-ico" />
            <input
              type="range"
              min={MIN_OPACITY}
              max="100"
              step="1"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-label="How solid the player is"
            />
            <span className="yt-dock-fade-val">{opacity}%</span>
            <button
              type="button"
              className="yt-dock-fade-reset"
              onClick={() => setOpacity(100)}
              disabled={opacity === 100}
            >
              Reset
            </button>
          </div>
        )}
        <div className="yt-dock-frame">
          <div ref={mountRef} />
        </div>
        {!folded &&
          Object.entries(CORNERS).map(([corner, { label }]) => (
            <div
              key={corner}
              className={"yt-dock-resize " + corner}
              onPointerDown={(e) => startDrag(e, corner)}
              role="separator"
              aria-label={label}
            />
          ))}
      </div>
  );
}
