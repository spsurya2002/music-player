import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import { emitLimitsChanged } from "../utils/bus";
import LyricsBook from "./LyricsBook";
import {
  CrawlLog,
  LimitedNote,
  MeaningCaveat,
  MeaningHead,
  SourceLine,
  Terms,
  canExplainVersion,
  labelFor,
  meaningFor,
  meaningOwner,
  versionKey,
  versionsOf,
} from "./LyricsBits";
import AddLyricsModal from "./AddLyricsModal";
import ConfirmModal from "./ConfirmModal";
import NoWordsPanel from "./NoWordsPanel";
import Msg from "./Msg";
import { ErrorMsg, QuotaNote } from "./Quota";
import { RefreshIcon } from "./icons";
import "./LyricsSection.css";

const POLL_MS = 2000;
const ACTIVE = ["queued", "running"];

/**
 * Lyrics and meaning for one song, on its page.
 *
 * The same two steps and the same book as the Lyrics pages, because a song you
 * saved and a link you pasted are the same question asked from two places. The
 * row is keyed to the song in the database, so leaving and coming back finds
 * the same lookup still running with no job id to keep.
 */
export default function LyricsSection({ song }) {
  const [row, setRow] = useState(null);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  // The ApiError itself, not its message, so a used-up limit can offer the way
  // to ask for more.
  const [error, setError] = useState(null);
  // null when closed; {} to add, or the version being edited.
  const [editing, setEditing] = useState(null);
  const [dropVersion, setDropVersion] = useState(null);
  const [reExplain, setReExplain] = useState(null);

  const songId = song.id;
  const busyWords = Boolean(row && ACTIVE.includes(row.state));
  const busyMeaning = Boolean(row && ACTIVE.includes(row.meaning_state));
  const active = busyWords || busyMeaning;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getLyrics(songId)
      .then((d) => {
        if (cancelled) return;
        setRow(d.lyrics);
        setVersion(null);
      })
      .catch(() => {
        // The section simply offers its button; a failure that matters comes
        // back from the POST with a sentence.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer = null;
    async function tick() {
      try {
        const d = await api.getLyrics(songId);
        if (cancelled) return;
        setRow(d.lyrics);
        const going =
          d.lyrics && (ACTIVE.includes(d.lyrics.state) || ACTIVE.includes(d.lyrics.meaning_state));
        if (going) timer = setTimeout(tick, POLL_MS);
        else emitLimitsChanged();
      } catch {
        if (cancelled) return;
        timer = setTimeout(tick, POLL_MS * 2);
      }
    }
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, songId]);

  const findWords = useCallback(
    async (refresh) => {
      setStarting(true);
      setError(null);
      try {
        const d = await api.findLyrics(songId, refresh);
        setRow(d.lyrics);
        setVersion(null);
      } catch (err) {
        setError(err);
      } finally {
        setStarting(false);
      }
    },
    [songId]
  );

  const explain = useCallback(
    async (version) => {
      setError(null);
      try {
        const d = await api.explainLyrics(row.id, version ?? null);
        setRow(d.lyrics);
      } catch (err) {
        setError(err);
      } finally {
        emitLimitsChanged();
      }
    },
    [row]
  );

  // Words of your own. On this page the row may not exist yet — a song nobody
  // has looked up has nowhere to put them — so the first add goes through the
  // song, which makes the row on the way.
  const saveMine = useCallback(
    async ({ text, label }) => {
      let d;
      if (editing?.id) d = await api.editMyLyrics(row.id, editing.id, { text, label });
      else if (row) d = await api.addMyLyrics(row.id, text, label);
      else d = await api.addMyLyricsForSong(songId, text, label);
      setRow(d.lyrics);
      setEditing(null);
      const list = d.lyrics.mine || [];
      const added = list.find((v) => v.id === editing?.id) || list[list.length - 1];
      setVersion(added ? { ...added, mine: true } : null);
    },
    [row, songId, editing]
  );

  const removeMine = useCallback(async () => {
    const target = dropVersion;
    setDropVersion(null);
    const d = await api.deleteMyLyrics(row.id, target.id);
    setRow(d.lyrics);
    setVersion(null);
  }, [row, dropVersion]);

  const busy = starting || active;
  const state = row?.state;
  const versions = versionsOf(row);
  const shown = version || versions[0];
  // A row holds one reading, and it belongs to the version it was made from.
  const meaningShown = meaningFor(row, shown, versions);
  const explainedElsewhere = Boolean(row?.meaning) && !meaningShown;
  const explainedOne = explainedElsewhere ? meaningOwner(row, versions) : null;
  // The server reads your own words, or the best the crawler found. It has no
  // way to be asked for an alternative script, so that is not offered.
  const explainable = canExplainVersion(shown, versions);

  return (
    <div className="detail-section">
      <div className="view-head" style={{ marginBottom: 10 }}>
        <div className="mhead" style={{ margin: 0 }}>
          Lyrics and meaning
        </div>
        {row && !active && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => findWords(true)}
            disabled={busy}
            aria-label="Look again"
            title="Look again"
          >
            {starting ? <span className="spin" /> : <RefreshIcon size={16} />}
          </button>
        )}
      </div>

      <ErrorMsg error={error} />

      {loading && !row && <div className="song empty-state">Loading…</div>}

      {!loading && !row && (
        <>
          <div className="song empty-state">
            No lyrics yet — finding the words is free; reading them is the step that costs.
          </div>
          <div className="row lyrics-start">
            <button type="button" className="btn" onClick={() => findWords(false)} disabled={busy}>
              {starting ? <span className="spin" /> : "Find lyrics"}
            </button>
            {/* For a song whose words you already have. There is no row yet,
                so this one goes through the song and makes it on the way. */}
            <button
              type="button"
              className="btn ghost"
              onClick={() => setEditing({})}
              disabled={busy}
            >
              Add them yourself
            </button>
          </div>
        </>
      )}

      {busyWords && (
        <div className="song lyrics-working">
          <span className="spin" />
          {state === "queued"
            ? "Queued — one lookup runs at a time, so this may wait its turn."
            : "Reading through the pages that might have it. Takes a minute."}
        </div>
      )}

      {/* A stop leaves the section with nothing to show otherwise. */}
      {state === "stopped" && !shown && (
        <NoWordsPanel row={row} onAdd={() => setEditing({})} />
      )}

      {/* Only while there is nothing to read. A row that found nothing and then
          had words typed into it is not a row in a failed state any more, and
          the notice, the Try again and the offer of somewhere to put them all
          stop applying the moment there is something on the page. */}
      {(state === "not_found" || state === "failed") && !shown && (
        <>
          <Msg kind="err">{row.error}</Msg>
          {state === "not_found" && (
            <div className="lyrics-retry-hint hint">
              Correcting the track or artist above often fixes this — we search for what
              the song page says it is.
            </div>
          )}
          <div className="row lyrics-start">
            <button type="button" className="btn ghost" onClick={() => findWords(true)} disabled={busy}>
              {starting ? <span className="spin" /> : "Try again"}
            </button>
          </div>
          {/* Keeping is not a question here: the row belongs to the song, and
              goes when the song does. */}
          <NoWordsPanel row={row} onAdd={() => setEditing({})} />
        </>
      )}

      {shown && (
        <>
          <SourceLine
            shown={shown}
            versions={versions}
            onVersion={setVersion}
            onAdd={() => setEditing({})}
            onEdit={shown.mine ? setEditing : null}
            onDelete={shown.mine ? setDropVersion : null}
          />
          <MeaningHead meaning={meaningShown} />

          {busyMeaning && (
            <div className="song lyrics-working">
              <span className="spin" />
              Reading it. The dictionary first, then the poem — takes a minute.
            </div>
          )}
          {row.meaning_state === "limited" && <LimitedNote note={row.meaning_note} />}
          {!row.meaning && row.meaning_note && row.meaning_state !== "limited" && (
            <div className="song lyrics-nomeaning">{row.meaning_note}</div>
          )}

          {!busyMeaning && (explainedElsewhere || !explainable) && (
            <div className="lyrics-other-reading">
              <span className="hint">
                {explainedElsewhere ? (
                  <>
                    The reading on this one was made from{" "}
                    <b>{explainedOne ? labelFor(explainedOne) : "another version"}</b>. A
                    song holds one, so{" "}
                    {explainable
                      ? "reading these words replaces it."
                      : "switch back to read it, or add words of your own."}
                  </>
                ) : (
                  "Readings are made from the main version, or from words you add yourself."
                )}
              </span>
              {explainedElsewhere && explainable && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setReExplain(shown)}
                >
                  Explain this one instead
                </button>
              )}
            </div>
          )}

          <LyricsBook
            version={shown}
            text={shown.text}
            meaning={meaningShown}
            onExplain={() => explain(versionKey(shown))}
            explaining={busyMeaning}
            canExplain={
              !busyMeaning &&
              row.meaning_state !== "limited" &&
              !explainedElsewhere &&
              explainable
            }
          />

          {!meaningShown && !busyMeaning && !explainedElsewhere && (
            <QuotaNote feature="meaning" />
          )}
          <Terms terms={meaningShown?.terms} />
          <MeaningCaveat meaning={meaningShown} />
          <CrawlLog crawled={row.crawled} query={row.query} />

          <div className="hint lyrics-open-full">
            <Link to={`/lyrics/${row.id}`} className="ext-link">
              Open this on its own page
            </Link>
          </div>
        </>
      )}

      {editing && (
        <AddLyricsModal
          version={editing.id ? editing : null}
          warnLosesMeaning={
            Boolean(editing.id) &&
            row?.meaning_version === `mine:${editing.id}` &&
            Boolean(row?.meaning)
          }
          onSave={saveMine}
          onClose={() => setEditing(null)}
        />
      )}

      {dropVersion && (
        <ConfirmModal
          title="Delete these words"
          message={`Delete the "${labelFor(dropVersion)}" version? ${
            row?.meaning_version === `mine:${dropVersion.id}` && row?.meaning
              ? "Its reading goes with it."
              : "The rest of this lookup stays."
          }`}
          confirmLabel="Delete"
          onConfirm={removeMine}
          onClose={() => setDropVersion(null)}
        />
      )}

      {reExplain && (
        <ConfirmModal
          title="Read this version instead"
          message={`A song holds one reading. Reading the "${labelFor(
            reExplain
          )}" version replaces the one you have, and costs another lyric lookup.`}
          confirmLabel="Read it"
          danger={false}
          onConfirm={async () => {
            setReExplain(null);
            await explain(versionKey(reExplain));
          }}
          onClose={() => setReExplain(null)}
        />
      )}
    </div>
  );
}
