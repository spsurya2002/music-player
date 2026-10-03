import { useEffect, useMemo, useState } from "react";
import { ChevronIcon } from "./icons";
import "./LyricsBook.css";

// Couplets to a spread. Fewer once there are readings beside them, because a
// line and its explanation together are roughly twice as tall.
const PER_SPREAD_READ = 4;
const PER_SPREAD_PLAIN = 8;

/**
 * The words on the left page, what they mean on the right, turned a spread at
 * a time.
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
 */
export default function LyricsBook({ text, meaning, onExplain, explaining, canExplain }) {
  const [spread, setSpread] = useState(0);

  // Either the explained lines, or the raw words split into the same shape, so
  // one component renders both halves of the two-step flow.
  const units = useMemo(() => {
    if (meaning?.lines?.length) return meaning.lines;
    return (text || "")
      .split("\n")
      .map((line, i) => ({ n: i + 1, text: line }))
      .filter((u) => u.text.trim());
  }, [text, meaning]);

  const perSpread = meaning?.lines?.length ? PER_SPREAD_READ : PER_SPREAD_PLAIN;
  const spreads = Math.max(1, Math.ceil(units.length / perSpread));
  // Asking for a reading re-chunks the whole thing, so a page number from
  // before it arrived would land somewhere arbitrary.
  const page = Math.min(spread, spreads - 1);
  const shown = units.slice(page * perSpread, page * perSpread + perSpread);

  useEffect(() => {
    setSpread(0);
  }, [perSpread, units.length]);

  // ←/→ turn pages here instead of seeking the player. useGlobalShortcuts
  // stands down for anything inside [data-arrow-keys].
  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowLeft") setSpread((s) => Math.max(0, s - 1));
      if (e.key === "ArrowRight") setSpread((s) => Math.min(spreads - 1, s + 1));
    }
    const el = document.querySelector("[data-arrow-keys]");
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [spreads]);

  if (!units.length) return null;

  return (
    <div className="book" data-arrow-keys tabIndex={0} aria-label="Lyrics and meaning">
      <div className="book-spread">
        <div className="book-page book-page-left" dir="auto">
          {shown.map((u) => (
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
          <span className="book-folio">{page * 2 + 1}</span>
        </div>

        <div className="book-page book-page-right">
          {meaning?.lines?.length ? (
            shown.map((u) => (
              <div className="book-verse" key={u.n}>
                {u.matlab && <div className="book-matlab">{u.matlab}</div>}
                {u.note && <div className="book-note">{u.note}</div>}
              </div>
            ))
          ) : (
            <div className="book-blank">
              <p>This page is blank until you ask what the words mean.</p>
              {canExplain && (
                <button type="button" className="btn" onClick={onExplain} disabled={explaining}>
                  {explaining ? <span className="spin" /> : "Explain this"}
                </button>
              )}
            </div>
          )}
          <span className="book-folio">{page * 2 + 2}</span>
        </div>
      </div>

      {spreads > 1 && (
        <div className="book-turn">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSpread((s) => Math.max(0, s - 1))}
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
            onClick={() => setSpread((s) => Math.min(spreads - 1, s + 1))}
            disabled={page === spreads - 1}
            aria-label="Next page"
          >
            <ChevronIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
