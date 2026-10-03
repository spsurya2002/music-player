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
  versionsOf,
} from "./LyricsBits";
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

  const explain = useCallback(async () => {
    setError(null);
    try {
      const d = await api.explainLyrics(row.id);
      setRow(d.lyrics);
    } catch (err) {
      setError(err);
    } finally {
      emitLimitsChanged();
    }
  }, [row]);

  const busy = starting || active;
  const state = row?.state;
  const versions = versionsOf(row);
  const shown = version || versions[0];
  // Once there is a reading, the book shows the version it was made from —
  // switching script under it would pair each line with somebody else's words.
  const canSwitch = !row?.meaning;

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

      {(state === "not_found" || state === "failed") && (
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
          <CrawlLog crawled={row.crawled} query={row.query} />
        </>
      )}

      {state === "done" && shown && (
        <>
          <SourceLine shown={shown} versions={versions} onVersion={setVersion} canSwitch={canSwitch} />
          <MeaningHead meaning={row.meaning} />

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

          <LyricsBook
            text={shown.text}
            meaning={row.meaning}
            onExplain={explain}
            explaining={busyMeaning}
            canExplain={!busyMeaning && row.meaning_state !== "limited"}
          />

          {!row.meaning && !busyMeaning && <QuotaNote feature="lyrics" />}
          <Terms terms={row.meaning?.terms} />
          <MeaningCaveat meaning={row.meaning} />
          <CrawlLog crawled={row.crawled} query={row.query} />

          <div className="hint lyrics-open-full">
            <Link to={`/lyrics/${row.id}`} className="ext-link">
              Open this on its own page
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
