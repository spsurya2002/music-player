import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import { emitLimitsChanged } from "../utils/bus";
import { usePlayer } from "../context/PlayerContext";
import LyricsBook from "../components/LyricsBook";
import {
  CrawlLog,
  LimitedNote,
  MeaningCaveat,
  MeaningHead,
  SourceLine,
  Terms,
  titleOf,
  versionsOf,
} from "../components/LyricsBits";
import ConfirmModal from "../components/ConfirmModal";
import AddToCollectionModal from "../components/AddToCollectionModal";
import Msg from "../components/Msg";
import { ErrorMsg, QuotaNote } from "../components/Quota";
import { CheckIcon, PlayIcon, PlusIcon, RefreshIcon, TrashIcon } from "../components/icons";
import "./views.css";
import "./LyricsView.css";

const POLL_MS = 2000;
const ACTIVE = ["queued", "running"];

/**
 * One lookup, as a page you read.
 *
 * Two steps live here. The words arrive first and fill the left page; the right
 * one stays blank until you ask what they mean, because that is the half that
 * costs money. Both halves are jobs on the server, so this polls until each
 * settles.
 */
export default function LyricsDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const { dockYoutube } = usePlayer();

  const busyWords = Boolean(row && ACTIVE.includes(row.state));
  const busyMeaning = Boolean(row && ACTIVE.includes(row.meaning_state));
  const active = busyWords || busyMeaning;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getLyricsRow(id)
      .then((d) => {
        if (cancelled) return;
        setRow(d.lyrics);
        setVersion(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer = null;
    async function tick() {
      try {
        const d = await api.getLyricsRow(id);
        if (cancelled) return;
        setRow(d.lyrics);
        const stillGoing =
          ACTIVE.includes(d.lyrics.state) || ACTIVE.includes(d.lyrics.meaning_state);
        if (stillGoing) timer = setTimeout(tick, POLL_MS);
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
  }, [active, id]);

  const explain = useCallback(async () => {
    setError(null);
    try {
      const d = await api.explainLyrics(id);
      setRow(d.lyrics);
    } catch (err) {
      setError(err);
    } finally {
      emitLimitsChanged();
    }
  }, [id]);

  const again = useCallback(async () => {
    setError(null);
    try {
      const d = await api.searchLyrics(row.query, true);
      setRow(d.lyrics);
      setVersion(null);
    } catch (err) {
      setError(err);
    }
  }, [row]);

  // Play it in the corner while you read. A lookup that started from a pasted
  // link already knows its video; one that started from a typed name does not,
  // so that case asks the same YouTube search the rest of the app uses — and
  // only when pressed, since most readings never need it.
  const listen = useCallback(async () => {
    if (row?.video?.id) {
      dockYoutube(row.video.id, titleOf(row));
      return;
    }
    setFinding(true);
    setError(null);
    try {
      const d = await api.searchFreeText(titleOf(row) || row.query);
      const hit = (d.results || [])[0];
      if (hit) dockYoutube(hit.id, hit.title || titleOf(row));
      else setError({ message: "Couldn't find this one on YouTube." });
    } catch (err) {
      setError(err);
    } finally {
      setFinding(false);
    }
  }, [row, dockYoutube]);

  async function doDelete() {
    setConfirmDelete(false);
    await api.deleteLyrics(id);
    navigate("/lyrics/saved");
  }

  // Yes. The row was already written — the worker had to have somewhere to put
  // the words — so this only moves it into the library.
  const keep = useCallback(async () => {
    setKeeping(true);
    setError(null);
    try {
      const d = await api.keepLyrics(id);
      setRow(d.lyrics);
    } catch (err) {
      setError(err);
    } finally {
      setKeeping(false);
    }
  }, [id]);

  // No, and no is the whole of it: the row and the words cached in it both go.
  // Not worth a confirm box — this is already the answer to a question, and
  // the sentence above the buttons says what it costs to ask again.
  const discard = useCallback(async () => {
    setKeeping(true);
    setError(null);
    try {
      await api.deleteLyrics(id);
      navigate("/lyrics");
    } catch (err) {
      setError(err);
      setKeeping(false);
    }
  }, [id, navigate]);

  if (loading) return <div className="view"><div className="song">Loading…</div></div>;
  if (!row) {
    return (
      <div className="view">
        <Msg kind="err">{error?.message || "That lyrics lookup is no longer saved."}</Msg>
        <p className="hint" style={{ marginTop: 12 }}>
          <Link to="/lyrics" className="ext-link">Find lyrics</Link>
        </p>
      </div>
    );
  }

  const versions = versionsOf(row);
  const shown = version || versions[0];
  // Once there is a reading, the book shows the version it was made from —
  // switching script under it would pair each line with somebody else's words.
  const canSwitch = !row.meaning && versions.length > 1;

  return (
    <div className="view">
      <div className="lyrics-head">
        {row.video?.thumbnail && <img className="lyrics-thumb" src={row.video.thumbnail} alt="" />}
        <div className="lyrics-head-meta">
          <h1 className="lyrics-head-title">{titleOf(row)}</h1>
          <div className="lyrics-head-sub">
            {[
              row.resolved?.artist,
              row.video?.channel && `via ${row.video.channel}`,
              row.resolved?.resolved_by === "itunes" && "name confirmed by iTunes",
            ]
              .filter(Boolean)
              .join(" · ") || row.query}
          </div>
        </div>
        <button
          type="button"
          className="btn ghost small lyrics-listen"
          onClick={listen}
          disabled={finding}
          title="Play it in the corner while you read"
        >
          {finding ? <span className="spin" /> : <PlayIcon size={14} />}
          Listen
        </button>
        <button type="button" className="icon-btn" onClick={again} disabled={active} aria-label="Look again" title="Look again">
          {busyWords ? <span className="spin" /> : <RefreshIcon size={16} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCollectOpen(true)}
          aria-label="Add to a collection"
          title="Add to a collection"
        >
          <PlusIcon size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Delete" title="Delete">
          <TrashIcon size={16} />
        </button>
      </div>

      <ErrorMsg error={error} />

      {/* A search is not saved by running it. Asked once the words are in, so
          the answer is given with the thing itself on screen rather than
          before there is anything to judge. */}
      {row.state === "done" && !row.kept && (
        <div className="lyrics-keep">
          <div className="lyrics-keep-text">
            <div className="lyrics-keep-title">Keep this in your lyrics?</div>
            <div className="lyrics-keep-sub">
              It isn&apos;t in your library yet. Discarding deletes the words we found,
              so looking this one up again would cost another lookup.
            </div>
          </div>
          <button type="button" className="btn" onClick={keep} disabled={keeping}>
            {keeping ? <span className="spin" /> : <CheckIcon size={15} style={{ marginRight: 6 }} />}
            Save
          </button>
          <button type="button" className="btn ghost" onClick={discard} disabled={keeping}>
            Discard
          </button>
        </div>
      )}

      {busyWords && (
        <div className="song lyrics-working">
          <span className="spin" />
          {row.state === "queued"
            ? "Queued — one lookup runs at a time, so this may wait its turn."
            : "Asking the lyrics databases, then reading the pages that might have it."}
        </div>
      )}

      {(row.state === "not_found" || row.state === "failed") && (
        <>
          <Msg kind="err">{row.error}</Msg>
          {row.state === "not_found" && (
            <div className="hint lyrics-retry-hint">
              Adding the artist&apos;s name, or a distinctive line, usually does it. A link
              to the lyrics page itself works too — paste it and we&apos;ll read that page.
            </div>
          )}
          <CrawlLog crawled={row.crawled} query={row.query} />
        </>
      )}

      {row.state === "done" && shown && (
        <>
          <SourceLine
            shown={shown}
            versions={versions}
            onVersion={setVersion}
            canSwitch={canSwitch}
          />

          <MeaningHead meaning={row.meaning} />

          {busyMeaning ? (
            <div className="song lyrics-working">
              <span className="spin" />
              Reading it. The dictionary first, then the poem — takes a minute.
            </div>
          ) : (
            row.meaning_state === "limited" && <LimitedNote note={row.meaning_note} />
          )}

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
        </>
      )}

      {collectOpen && (
        <AddToCollectionModal
          row={row}
          onClose={() => {
            setCollectOpen(false);
            // Filing it somewhere keeps it, so the bar above may have just
            // stopped applying — re-read rather than leave it asking.
            if (!row.kept) {
              api.getLyricsRow(id).then((d) => setRow(d.lyrics)).catch(() => {});
            }
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete lookup"
          message={`Delete the lyrics saved for "${titleOf(row)}"? Reading it again costs another lyric lookup.`}
          confirmLabel="Delete"
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}




