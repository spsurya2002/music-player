import { Link } from "react-router-dom";
import { badgeClass } from "../utils/format";
import { ExternalLinkIcon } from "./icons";
import "./LyricsBits.css";

// The finder's own thresholds, in words.
const CONFIDENCE = [
  [0.8, "High confidence"],
  [0.6, "Likely this one"],
  [0, "Best guess"],
];

export function confidenceOf(score) {
  const hit = CONFIDENCE.find(([floor]) => (score ?? 0) >= floor);
  return hit ? hit[1] : "Best guess";
}

// The finder keeps the best candidate per writing system so a version can be
// read in the script you know. "(auto)" is load-bearing: that one we romanised
// ourselves, and it guesses vowels the original doesn't write.
const SCRIPT_LABEL = { arabic: "اردو", devanagari: "हिन्दी", latin: "Roman", other: "Other" };

export function labelFor(v) {
  const base = SCRIPT_LABEL[v.script] || SCRIPT_LABEL.other;
  return v.transliterated ? `${base} (auto)` : base;
}

// Every version on a row, best first. The top candidate's metadata is in
// `source` while its words are at the top level, so it is reassembled here.
export function versionsOf(row) {
  if (!row?.source) return [];
  return [{ ...row.source, text: row.text }, ...(row.alternatives || [])].filter((v) => v?.text);
}

// What the finder worked the query out to be, falling back to what was typed —
// for a pasted link the resolved name is the only readable title there is.
export function titleOf(row) {
  if (!row) return "";
  const r = row.resolved;
  if (r?.title && r?.artist) return `${r.artist} — ${r.title}`;
  if (r?.title) return r.title;
  return row.video?.title || row.query || "Untitled";
}

/** Where the words came from, how sure we are, and which script to read. */
export function SourceLine({ shown, versions, onVersion, canSwitch }) {
  if (!shown) return null;
  return (
    <div className="lyrics-source">
      <span className={"badge" + badgeClass((shown.score ?? 0) * 100)}>
        {confidenceOf(shown.score)}
      </span>
      {shown.url && (
        <a href={shown.url} target="_blank" rel="noopener" className="ext-link">
          <ExternalLinkIcon size={14} />
          {shown.site}
        </a>
      )}
      {canSwitch && versions.length > 1 && (
        <div className="lyrics-scripts">
          {versions.map((v, i) => (
            <button
              key={i}
              type="button"
              className={"pill" + (v === shown ? " active" : "")}
              onClick={() => onVersion?.(v)}
            >
              {labelFor(v)}
            </button>
          ))}
        </div>
      )}
      {shown.transliterated && (
        <span className="lyrics-flag">
          Romanised automatically — the original spells fewer vowels than this does
        </span>
      )}
      {shown.reasons?.length > 0 && (
        <details className="lyrics-why">
          <summary>Why this result?</summary>
          <ul>
            {shown.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The glossary. Dictionary-backed entries carry an origin and a link; ones the
 *  model glossed carry only senses. Both read the same way. */
export function Terms({ terms }) {
  if (!terms?.length) return null;
  return (
    <div className="lyrics-terms">
      <div className="mhead">Words</div>
      <dl>
        {terms.map((t, i) => (
          <div className="lyrics-term" key={i}>
            <dt>
              {t.url ? (
                <a href={t.url} target="_blank" rel="noopener" className="ext-link">
                  {t.word}
                </a>
              ) : (
                <span dir="auto">{t.word}</span>
              )}
              {t.roman && <span className="lyrics-term-roman">{t.roman}</span>}
              {t.origin && <span className="lyrics-term-origin">{t.origin}</span>}
            </dt>
            <dd>{(t.senses || []).join("; ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Every page we opened, with why each didn't work out. Kept because "nothing
 *  found" and "we were turned away" look identical without it. */
export function CrawlLog({ crawled, query }) {
  if (!crawled?.length) return null;
  return (
    <details className="lyrics-crawl">
      <summary>
        Pages we looked at ({crawled.length})
        {query ? ` · searched for "${query}"` : ""}
      </summary>
      <ul>
        {crawled.map((c, i) => (
          <li key={i} className={c.ok ? "ok" : ""}>
            <span className="lyrics-crawl-dot" aria-hidden="true" />
            <span className="lyrics-crawl-url">{c.url}</span>
            {c.reason && <span className="lyrics-crawl-reason">{c.reason}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The themes and summary above the spread — the whole-song reading, as
 *  opposed to the line-by-line one inside the book. */
export function MeaningHead({ meaning }) {
  if (!meaning) return null;
  const tags = [meaning.tradition, meaning.poet, ...(meaning.themes || [])].filter(Boolean);
  return (
    <div className="lyrics-meaning-head">
      {tags.length > 0 && (
        <div className="lyrics-tags">
          {tags.map((t, i) => (
            <span className="pill" key={i}>
              {t}
            </span>
          ))}
        </div>
      )}
      {meaning.summary && <p className="lyrics-summary">{meaning.summary}</p>}
    </div>
  );
}

/** Said once, after the reading rather than over it. */
export function MeaningCaveat({ meaning }) {
  if (!meaning) return null;
  return (
    <div className="hint lyrics-caveat">
      Explained by {meaning.model || "a language model"}, so treat the readings as one
      interpretation rather than the last word.
    </div>
  );
}

/** A used-up limit, with the way out. */
export function LimitedNote({ note }) {
  return (
    <div className="msg err">
      {note}{" "}
      <Link to="/plan" className="ext-link quota-link">
        Ask for more
      </Link>
    </div>
  );
}
