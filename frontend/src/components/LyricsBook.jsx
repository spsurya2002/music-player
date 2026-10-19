import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon, CloseIcon, ExpandIcon, MuteIcon, ShrinkIcon, VolumeIcon } from "./icons";
import useMediaQuery from "../hooks/useMediaQuery";
import { pageSoundOn, playPageLift, playPageTurn, setPageSound } from "../utils/pageSound";
import "./LyricsBook.css";

// Couplets to a spread. Fewer once there are readings beside them, because a
// line and its explanation together are roughly twice as tall.
const PER_SPREAD_READ = 4;
const PER_SPREAD_PLAIN = 8;

// Long enough to read as paper rather than as a card flip, short enough that
// turning four pages to find a verse is not a wait.
const TURN_MS = 620;
// How far a drag has to have got before letting go finishes the turn instead
// of putting the page back.
const COMMIT_AT = 0.32;
// A drag has to beat this many pixels, and beat its own vertical travel,
// before it takes the pointer away from scrolling the page.
const CLAIM_PX = 10;

/**
 * The words on the left page, what they mean on the right, turned a spread at
 * a time — and turned the way a book turns.
 *
 * The pairing is the point. Stacked — all the words, then all the readings —
 * you have to hold a line in your head while you scroll to find its meaning,
 * and by the third verse nobody is doing that. Side by side, the eye crosses
 * the spine once per couplet, which is how a facing-page translation has
 * worked for as long as those have existed.
 *
 * The right page is deliberately blank until a reading is asked for: that is
 * the step that costs, and an empty page beside full words says so better than
 * a banner would.
 *
 * ---- how the turn is built ----
 *
 * Three layers. Underneath, a plain two-column spread showing what you are
 * turning *towards* on the moving side and what you are turning *from* on the
 * still side. Over it, one absolutely positioned leaf with two faces, hinged on
 * the spine and rotated in 3D; `backface-visibility` swaps which face you see
 * as it passes edge-on at the halfway point.
 *
 * Going forward, the leaf is the right-hand page: its front is the right page
 * you were reading, its back is the left page of the next spread, so when it
 * lands flat on the left half the content underneath it has already become the
 * same thing and dropping the leaf changes nothing on screen. Going back, the
 * whole arrangement mirrors. On a phone there is only one column, so the leaf
 * is the entire spread hinged at its left edge: it peels away to reveal the
 * next one, and its back is blank paper, because the back of a page is.
 *
 * Progress is one number, 0 to 1, whether it came from a click (CSS carries it)
 * or from a finger (the finger carries it). Everything else — angle, both
 * shadows, the shadow cast on the page being uncovered — is a function of it.
 *
 * `title` is only read in full view, where the page's own header is behind the
 * book and the spread would otherwise be sitting there unnamed. `version` is
 * the one being shown, and the only thing taken off it is where its words came
 * from — see the mark in the turn bar.
 */
export default function LyricsBook({
  text,
  meaning,
  onExplain,
  explaining,
  canExplain,
  title,
  version,
}) {
  const [spread, setSpread] = useState(0);
  // { dir, from, to, p, dragging, ms } while a leaf is in the air, else null.
  const [turn, setTurn] = useState(null);
  const [sound, setSound] = useState(pageSoundOn);
  const [full, setFull] = useState(false);

  const bookRef = useRef(null);
  const spreadRef = useRef(null);
  const turnRef = useRef(null);
  const timerRef = useRef(null);
  const rafRef = useRef(0);
  const dragRef = useRef(null);
  const queuedRef = useRef(0);
  const goRef = useRef(null);

  const phone = useMediaQuery("(max-width: 760px)");
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");

  // Either the explained lines, or the raw words split into the same shape, so
  // one component renders both halves of the two-step flow.
  const units = useMemo(() => {
    if (meaning?.lines?.length) return meaning.lines;
    return (text || "")
      .split("\n")
      .map((line, i) => ({ n: i + 1, text: line }))
      .filter((u) => u.text.trim());
  }, [text, meaning]);

  const read = Boolean(meaning?.lines?.length);
  const perSpread = read ? PER_SPREAD_READ : PER_SPREAD_PLAIN;
  const spreads = Math.max(1, Math.ceil(units.length / perSpread));
  // Asking for a reading re-chunks the whole thing, so a page number from
  // before it arrived would land somewhere arbitrary.
  const page = Math.min(spread, spreads - 1);

  function slice(i) {
    return units.slice(i * perSpread, i * perSpread + perSpread);
  }

  function put(next) {
    turnRef.current = next;
    setTurn(next);
  }

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  // The leaf has arrived. Drop it, keep whatever is underneath, and serve
  // anyone who pressed the button again while it was still in the air.
  function land(to) {
    clearTimer();
    setSpread(to);
    put(null);
  }

  // How many pixels of drag amount to a whole turn: one page across.
  function span() {
    const el = spreadRef.current;
    const w = el ? el.getBoundingClientRect().width : 640;
    return Math.max(120, phone ? w : w / 2);
  }

  function go(dir) {
    const to = page + dir;
    if (to < 0 || to > spreads - 1) return;
    // Mid-air. Remember the press rather than swallow it — somebody looking for
    // verse nine presses this four times without waiting.
    if (turnRef.current) {
      queuedRef.current = dir;
      return;
    }

    playPageTurn();

    if (still) {
      setSpread(to);
      return;
    }

    put({ dir, from: page, to, p: 0, dragging: false, ms: TURN_MS });
    // Two frames: the first paints the leaf lying flat where the page already
    // was, the second gives it somewhere to go. Set in one frame, the browser
    // coalesces both and there is no transition to see.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const t = turnRef.current;
        if (t && !t.dragging && t.p === 0) put({ ...t, p: 1 });
      });
    });
    timerRef.current = setTimeout(() => land(to), TURN_MS);
  }

  useEffect(() => {
    goRef.current = go;
  });

  // A press that arrived mid-turn, now that the leaf is down.
  useEffect(() => {
    if (turn || !queuedRef.current) return;
    const dir = queuedRef.current;
    queuedRef.current = 0;
    go(dir);
  });

  // A reading arriving re-chunks the whole thing under us. Anything in the air
  // was aimed at a page number that has stopped meaning what it meant, so the
  // timer that would land it goes too.
  useEffect(() => {
    clearTimer();
    queuedRef.current = 0;
    setSpread(0);
    turnRef.current = null;
    setTurn(null);
  }, [perSpread, units.length]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ←/→ turn pages here instead of seeking the player. useGlobalShortcuts
  // stands down for anything inside [data-arrow-keys].
  useEffect(() => {
    const el = bookRef.current;
    if (!el) return undefined;
    function onKey(e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      goRef.current?.(e.key === "ArrowRight" ? 1 : -1);
    }
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  // Full view is a fixed overlay, not the Fullscreen API. A real fullscreen
  // element paints alone, so the YouTube dock — a sibling of the whole router
  // over in Shell.jsx — would blink out at the exact moment somebody settles
  // in to read with the song playing, which is the only reason the dock
  // exists. Sitting above the top bar and under the dock instead keeps both.
  //
  // Escape closes it, like every other layer in the app, and the scroll behind
  // it is locked so a trackpad doesn't move a page nobody can see.
  useEffect(() => {
    if (!full) return undefined;
    function onKey(e) {
      if (e.key === "Escape") setFull(false);
    }
    const had = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // So ← and → turn pages straight away rather than after a click.
    bookRef.current?.focus();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = had;
    };
  }, [full]);

  // ---- dragging ----

  // Both halves of this throw if the pointer has already been taken away —
  // which is exactly what pointercancel means — and a throw here would leave
  // the leaf stuck in the air.
  function capture(el, id, want) {
    try {
      if (want) el.setPointerCapture?.(id);
      else if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
    } catch {
      /* the pointer is gone; the turn below still settles */
    }
  }

  function onPointerDown(e) {
    if (spreads < 2 || still) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Buttons and links keep their own pointer events; nothing is draggable by
    // its "Explain this".
    if (e.target.closest?.("button, a, input, textarea, select")) return;
    if (turnRef.current) return;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now(), p: 0, live: false };
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;

    if (!d.live) {
      // Up and down is the page scrolling, and it gets the benefit of the doubt.
      if (Math.abs(dx) < CLAIM_PX || Math.abs(dx) <= Math.abs(dy)) return;
      const dir = dx < 0 ? 1 : -1;
      const to = page + dir;
      if (to < 0 || to > spreads - 1) {
        dragRef.current = null;
        return;
      }
      d.live = true;
      d.dir = dir;
      d.span = span();
      capture(e.currentTarget, e.pointerId, true);
      playPageLift();
      put({ dir, from: page, to, p: 0, dragging: true, ms: 0 });
    }

    const p = Math.max(0, Math.min(1, (d.dir === 1 ? -dx : dx) / d.span));
    d.p = p;
    // One repaint a frame. A pointermove can fire far more often than that,
    // and the leaf cannot move more than once a frame anyway.
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const t = turnRef.current;
      if (t?.dragging) put({ ...t, p: dragRef.current?.p ?? t.p });
    });
  }

  function endDrag(e) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.live) return;
    capture(e.currentTarget, e.pointerId, false);
    const t = turnRef.current;
    if (!t) return;

    // A short sharp push counts even if it didn't travel far — that is a flick
    // through a book, and waiting for it to cross the middle makes it feel stuck.
    const flick = Date.now() - d.at < 300 && d.p > 0.08;
    if (d.p >= COMMIT_AT || flick) {
      playPageTurn();
      const ms = Math.max(180, Math.round(TURN_MS * (1 - d.p)));
      put({ ...t, p: 1, dragging: false, ms });
      timerRef.current = setTimeout(() => land(t.to), ms);
    } else {
      const ms = Math.max(160, Math.round(TURN_MS * d.p));
      put({ ...t, p: 0, dragging: false, ms });
      timerRef.current = setTimeout(() => {
        clearTimer();
        put(null);
      }, ms);
    }
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    setPageSound(next);
    // Turning it on without a sample is a checkbox; with one it is a decision.
    if (next) playPageTurn();
  }

  // ---- the two kinds of page ----

  function words(i) {
    return (
      <>
        <div className="book-page-body">
          {slice(i).map((u) => (
            <div className="book-verse" key={u.n}>
              <div className="book-line" dir="auto">
              {u.text}
                {u.repeats_at?.length > 0 && (
                  <span className="book-repeat">×{u.repeats_at.length + 1}</span>
                )}
              </div>
              {u.roman && <div className="book-roman">{u.roman}</div>}
            </div>
          ))}
        </div>
        <span className="book-folio">{i * 2 + 1}</span>
      </>
    );
  }

  // `live` is false on a leaf face. The button is still drawn there — leaving
  // it out made it blink away and back on every turn of a book nobody has asked
  // to have explained — but it is taken out of the tab order, because it is the
  // same button as the one underneath and only one of them is the real one.
  function reading(i, live) {
    return (
      <>
        <div className="book-page-body">
          {read ? (
            slice(i).map((u) => (
              <div className="book-verse" key={u.n}>
                {u.matlab && <div className="book-matlab">{u.matlab}</div>}
                {u.note && <div className="book-note">{u.note}</div>}
              </div>
            ))
          ) : (
            <div className="book-blank">
              <p>This page is blank until you ask what the words mean.</p>
              {canExplain && (
                <button
                  type="button"
                  className="btn"
                  onClick={onExplain}
                  disabled={explaining}
                  tabIndex={live ? undefined : -1}
                >
                  {explaining ? <span className="spin" /> : "Explain this"}
                </button>
              )}
            </div>
          )}
        </div>
        <span className="book-folio">{i * 2 + 2}</span>
      </>
    );
  }

  if (!units.length) return null;

  // Whose words these are. The switcher says so too, but it is above the book
  // and you scroll past it — and in full view it isn't on the screen at all.
  // The question it answers is the one that matters while you read: did a
  // crawler find this, or did somebody type it in?
  const mine = Boolean(version?.mine);
  const where = mine
    ? "Added by you"
    : version?.site
      ? `Found at ${version.site}${version.transliterated ? ", romanised here" : ""}`
      : "Found by the lyrics finder";
  const whereWhy = mine
    ? "Words you added yourself. Nothing crawled them, and they stay through a re-crawl."
    : version?.site
      ? `The lyrics finder found these at ${version.site}.`
      : "The lyrics finder found these. Nobody typed them in here.";

  // How far the leaf has swung away from lying face-up, 0 to 1. On a phone a
  // backward turn runs the rotation in reverse — the page flies back in from
  // the left — so progress and flip are not the same number there.
  const flip = turn ? (phone && turn.dir === -1 ? 1 - turn.p : turn.p) : 0;
  const angle = !phone && turn?.dir === -1 ? 180 * flip : -180 * flip;
  const way = turn?.dir === -1 ? "back" : "fwd";

  // Underneath: the side the leaf is leaving shows where it is going, the side
  // it is landing on stays as it was until the leaf covers it.
  const underLeft = turn ? (turn.dir === 1 ? turn.from : turn.to) : page;
  const underRight = turn ? (turn.dir === 1 ? turn.to : turn.from) : page;
  const underPhone = turn ? (turn.dir === 1 ? turn.to : turn.from) : page;
  const leafFace = turn ? (turn.dir === 1 ? turn.from : turn.to) : page;

  const ease = { transitionDuration: `${turn?.ms ?? 0}ms` };
  const cast = turn ? Math.max(0, 1 - turn.p * 1.6) : 0;

  return (
    <div
      className={"book" + (full ? " is-full" : "")}
      data-arrow-keys
      tabIndex={0}
      ref={bookRef}
      aria-label="Lyrics and meaning"
    >
      {/* Only in full view, where the page's own header is behind the book:
          what you are reading, and the way back out for anyone who doesn't
          think to press Escape. */}
      {full && (
        <div className="book-fullhead">
          <span className="book-fullhead-title">{title || "Lyrics"}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFull(false)}
            aria-label="Leave full view"
            title="Leave full view — or press Escape"
          >
            <CloseIcon size={18} />
          </button>
        </div>
      )}

      {/* The page block. Its padding is where the sheets under the one you are
          reading show at the fore-edge, so the spread keeps its own box. */}
      <div className="book-block">
        <div
          className={`book-spread${turn ? " is-turning" : ""}${turn?.dragging ? " is-dragging" : ""}`}
          ref={spreadRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {phone ? (
            <div className="book-leaf-stack">
              <div className="book-page book-page-left" dir="auto">{words(underPhone)}</div>
              <div className="book-page book-page-right">{reading(underPhone, true)}</div>
            </div>
          ) : (
            <>
              <div className="book-page book-page-left" dir="auto">{words(underLeft)}</div>
              <div className="book-page book-page-right">{reading(underRight, true)}</div>
            </>
          )}

          {/* What the leaf throws across the page it is uncovering. */}
          {turn && !phone && (
            <div className={`book-cast ${way}`} style={{ ...ease, opacity: cast }} />
          )}

          {turn && (
            <div
              className={`book-leaf ${way}${turn.dragging ? " is-free" : ""}`}
              style={{ ...ease, transform: `rotateY(${angle}deg)` }}
              aria-hidden="true"
            >
              <div className="book-leaf-face">
                {phone ? (
                  <div className="book-leaf-stack">
                    <div className="book-page book-page-left" dir="auto">{words(leafFace)}</div>
                    <div className="book-page book-page-right">{reading(leafFace, false)}</div>
                  </div>
                ) : turn.dir === 1 ? (
                  <div className="book-page book-page-right">{reading(turn.from, false)}</div>
                ) : (
                  <div className="book-page book-page-left" dir="auto">{words(turn.from)}</div>
                )}
                <div className={`book-shade ${way}`} style={{ ...ease, opacity: flip }} />
              </div>

              <div className="book-leaf-face is-back">
                {phone ? (
                  <div className="book-back" />
                ) : turn.dir === 1 ? (
                  <div className="book-page book-page-left" dir="auto">{words(turn.to)}</div>
                ) : (
                  <div className="book-page book-page-right">{reading(turn.to, false)}</div>
                )}
                <div className={`book-shade ${way}`} style={{ ...ease, opacity: 1 - flip }} />
              </div>
            </div>
          )}

          {spreads > 1 && page < spreads - 1 && !turn && <span className="book-corner" aria-hidden="true" />}
        </div>
      </div>

      {/* The bar is always there now, because full view belongs to a book of
          one spread as much as to a long one — the pager and the page sound
          are what a single spread has no use for, so those are what go. */}
      <div className="book-turn">
        <div className="book-where">
          {version && (
            <span className={"book-mark" + (mine ? " is-mine" : "")} title={whereWhy}>
              {where}
            </span>
          )}
          {spreads > 1 && (
            <span className="book-hint">Drag a page across, or use ← and →.</span>
          )}
        </div>
        <div className="book-turn-controls">
          {spreads > 1 && (
            <>
              <button
                type="button"
                className="icon-btn"
                onClick={() => go(-1)}
                disabled={page === 0}
                aria-label="Previous page"
              >
                <ChevronIcon size={18} className="book-turn-prev" />
              </button>
              <span className="book-count">
                {page + 1} / {spreads}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => go(1)}
                disabled={page === spreads - 1}
                aria-label="Next page"
              >
                <ChevronIcon size={18} />
              </button>
            </>
          )}
        </div>
        <div className="book-turn-end">
          {spreads > 1 && (
            <button
              type="button"
              className="icon-btn book-sound"
              onClick={toggleSound}
              aria-pressed={sound}
              aria-label={sound ? "Turn the page sound off" : "Turn the page sound on"}
              title={sound ? "Page sound on" : "Page sound off"}
            >
              {sound ? <VolumeIcon size={16} /> : <MuteIcon size={16} />}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFull((v) => !v)}
            aria-pressed={full}
            aria-label={full ? "Leave full view" : "Read in full view"}
            title={full ? "Leave full view — or press Escape" : "Read in full view"}
          >
            {full ? <ShrinkIcon size={16} /> : <ExpandIcon size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
