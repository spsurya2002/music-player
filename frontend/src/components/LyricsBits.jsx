import { Link } from "react-router-dom";
import { badgeClass } from "../utils/format";
import { ExternalLinkIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";
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
  // Your own version is called whatever you called it; unnamed, it falls back
  // to the same script map the finder's versions use, so the two read as the
  // same kind of thing in the switcher rather than as an exception.
  if (v.mine) return v.label || SCRIPT_LABEL[v.script] || SCRIPT_LABEL.other;
  const base = SCRIPT_LABEL[v.script] || SCRIPT_LABEL.other;
  return v.transliterated ? `${base} (auto)` : base;
}

// How the server names one of your versions, and the value `meaning_version`
// carries. Null means the best the finder found.
export function versionKey(v) {
  return v?.mine ? `mine:${v.id}` : null;
}

// Which version this is, for comparing two of them.
//
// Not identity: versionsOf() rebuilds its objects on every render, so the one
// held in state is never the same object as the one in the list, and `===`
// says no to the version you just picked.
export function versionId(v) {
  if (!v) return null;
  if (v.mine) return `mine:${v.id}`;
  return `found:${v.url || ""}|${v.script || ""}`;
}

export function sameVersion(a, b) {
  return versionId(a) !== null && versionId(a) === versionId(b);
}

// Which versions a reading can be made from. The server reads your own words as
// given, and otherwise the best the crawler found — an alternative script is
// not something it can be asked for, so the page must not offer it.
export function canExplainVersion(v, versions) {
  if (!v) return false;
  if (v.mine) return true;
  return sameVersion(v, (versions || []).find((x) => !x.mine));
}

// Every version on a row: the finder's first, best first, then yours.
//
// The top candidate's metadata is in `source` while its words are at the top
// level, so that one is reassembled here. A row the finder failed on has no
// `source` at all and is still a row with versions — your own.
export function versionsOf(row) {
  if (!row) return [];
  const found = row.source
    ? [{ ...row.source, text: row.text }, ...(row.alternatives || [])].filter((v) => v?.text)
    : [];
  const mine = (row.mine || [])
    .filter((v) => v?.text)
    .map((v) => ({ ...v, mine: true }));
  return [...found, ...mine];
}

// Which version the one reading belongs to, so the page can name it when you
// are looking at a different one.
export function meaningOwner(row, versions) {
  if (!row?.meaning) return null;
  const list = versions || versionsOf(row);
  const owner = row.meaning_version || null;
  if (owner) return list.find((v) => versionKey(v) === owner) || null;
  return list.find((v) => !v.mine) || null;
}

// The one reading a row holds, but only beside the words it was made from.
// Shown against any other version it would pair each line with somebody else's,
// which is the mistake the old "a reading freezes the switcher" rule avoided by
// not letting you switch at all.
export function meaningFor(row, shown, versions) {
  if (!row?.meaning || !shown) return null;
  const owner = row.meaning_version || null;
  if (owner) return owner === versionKey(shown) ? row.meaning : null;
  // Null means the best the crawler found — that one version, not every found
  // one. The alternatives are different words in a different script.
  const best = (versions || versionsOf(row)).find((v) => !v.mine);
  return sameVersion(best, shown) ? row.meaning : null;
}

// What the lookup is called. A name someone typed wins: they only typed it
// because the finder got it wrong or never resolved one at all, and a lookup
// that found nothing has no title but the raw URL that was pasted.
export function titleOf(row) {
  if (!row) return "";
  if (row.manual_title && row.manual_artist) return `${row.manual_artist} — ${row.manual_title}`;
  if (row.manual_title) return row.manual_title;
  const r = row.resolved;
  if (r?.title && r?.artist) return `${r.artist} — ${r.title}`;
  if (r?.title) return r.title;
  return row.video?.title || row.query || "Untitled";
}

/** Where the words came from, how sure we are, and which version to read.
 *
 *  Two kinds of version sit in the same switcher: the finder keeps one
 *  candidate per writing system, and you can add your own on top. The line
 *  above them says which kind is on screen — a confidence badge and the page it
 *  came off for a found one, and for yours, that it is yours, with the two
 *  buttons that change it.
 */
export function SourceLine({ shown, versions, onVersion, onAdd, onEdit, onDelete }) {
  if (!shown) return null;
  const found = versions.filter((v) => !v.mine);
  const mine = versions.filter((v) => v.mine);

  const pill = (v, i) => (
    <button
      key={(v.mine ? "m" : "f") + i}
      type="button"
      className={"pill" + (sameVersion(v, shown) ? " active" : "") + (v.mine ? " mine" : "")}
      onClick={() => onVersion?.(v)}
    >
      {labelFor(v)}
    </button>
  );

  return (
    <div className="lyrics-source">
      {shown.mine ? (
        <>
          <span className="badge lyrics-mine-badge">Yours</span>
          {onEdit && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onEdit(shown)}
              aria-label="Edit these words"
              title="Edit these words"
            >
              <PencilIcon size={15} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDelete(shown)}
              aria-label="Delete this version"
              title="Delete this version"
            >
              <TrashIcon size={15} />
            </button>
          )}
        </>
      ) : (
        <>
          <span className={"badge" + badgeClass((shown.score ?? 0) * 100)}>
            {confidenceOf(shown.score)}
          </span>
          {shown.url && (
            <a href={shown.url} target="_blank" rel="noopener" className="ext-link">
              <ExternalLinkIcon size={14} />
              {shown.site}
            </a>
          )}
        </>
      )}

      {(versions.length > 1 || onAdd) && (
        <div className="lyrics-scripts">
          {found.map(pill)}
          {found.length > 0 && mine.length > 0 && (
            <span className="lyrics-scripts-sep" aria-hidden="true" />
          )}
          {mine.map(pill)}
          {onAdd && (
            <button type="button" className="pill lyrics-add-pill" onClick={onAdd}>
              <PlusIcon size={12} />
              Add yours
            </button>
          )}
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
