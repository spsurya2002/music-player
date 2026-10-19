import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import { emitLimitsChanged } from "../utils/bus";
import { looksLikeUrl, youtubeIdFrom, youtubeWatchUrl } from "../utils/youtube";
import { usePlayer } from "../context/PlayerContext";
import LyricsBook from "../components/LyricsBook";
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
  titleOf,
  versionKey,
  versionsOf,
} from "../components/LyricsBits";
import ConfirmModal from "../components/ConfirmModal";
import AddToCollectionModal from "../components/AddToCollectionModal";
import AddLyricsModal from "../components/AddLyricsModal";
import NoWordsPanel from "../components/NoWordsPanel";
import RenameLyricsModal from "../components/RenameLyricsModal";
import Msg from "../components/Msg";
import { ErrorMsg, QuotaNote } from "../components/Quota";
import {
  CheckIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  YoutubeIcon,
} from "../components/icons";
import "./views.css";
import "./LyricsView.css";
import Thumb from "../components/Thumb";

const POLL_MS = 2000;
const ACTIVE = ["queued", "running"];
// How long the sentence saying why there are no words stays up, and how long
// it takes to go. Long enough to read; not so long that a page you came back
// to still looks like it is in a fault.
const SAID_MS = 5000;
const FADE_MS = 400;

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
  // null when closed; {} to add, or the version being edited.
  const [editing, setEditing] = useState(null);
  const [dropVersion, setDropVersion] = useState(null);
  const [reExplain, setReExplain] = useState(null);
  const [finding, setFinding] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [naming, setNaming] = useState(false);
  // "in" while the failure sentence is up, "out" while it fades, null the rest
  // of the time — which is most of the time. See the effect below.
  const [said, setSaid] = useState(null);
  // The state the row was in on the last render, so a lookup settling can be
  // told apart from a lookup that settled days ago.
  const wasRef = useRef(null);
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

  // The sentence explaining why a lookup found nothing is news about a lookup
  // you just ran, so it is shown exactly then: when the row settles into
  // not_found or failed while you are watching it. Opening a row that failed
  // some other day gets nothing — it isn't news, the page isn't in a fault,
  // and on a row you have since put your own words into it is plainly wrong.
  // Then it goes on its own, because an explanation of an empty page outlives
  // its usefulness the moment it has been read.
  useEffect(() => {
    const was = wasRef.current;
    wasRef.current = row?.state;
    // Not a transition we watched happen: a first load, or a poll that changed
    // something else on the row.
    if (!ACTIVE.includes(was)) return;
    if (row?.state === "not_found" || row?.state === "failed") setSaid("in");
  }, [row?.state]);

  // The clock is its own effect, and reads `said` rather than the transition,
  // so anything that runs the pair again — StrictMode in dev does, twice on
  // mount — re-arms it. Folded into the effect above, the second run saw a
  // transition it had already handled, returned early, and left the sentence
  // on screen with nothing left to take it off.
  useEffect(() => {
    if (said !== "in") return undefined;
    const out = setTimeout(() => setSaid("out"), SAID_MS);
    const gone = setTimeout(() => setSaid(null), SAID_MS + FADE_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [said]);

  // Which words to read. A row holds one reading, so asking about a different
  // version replaces the one there — which is why the second case confirms.
  const explain = useCallback(
    async (version) => {
      setError(null);
      try {
        const d = await api.explainLyrics(id, version ?? null);
        setRow(d.lyrics);
      } catch (err) {
        setError(err);
      } finally {
        emitLimitsChanged();
      }
    },
    [id]
  );

  // Words of your own. Free, and every one of these hands back the whole row.
  const saveMine = useCallback(
    async ({ text, label }) => {
      const d = editing?.id
        ? await api.editMyLyrics(id, editing.id, { text, label })
        : await api.addMyLyrics(id, text, label);
      setRow(d.lyrics);
      setEditing(null);
      // Whichever version was just written is the one to be looking at.
      const added = (d.lyrics.mine || []).find((v) => v.id === editing?.id) ||
        (d.lyrics.mine || [])[(d.lyrics.mine || []).length - 1];
      setVersion(added ? { ...added, mine: true } : null);
    },
    [id, editing]
  );

  const removeMine = useCallback(async () => {
    const target = dropVersion;
    setDropVersion(null);
    const d = await api.deleteMyLyrics(id, target.id);
    setRow(d.lyrics);
    setVersion(null);
  }, [id, dropVersion]);

  const rename = useCallback(
    async (names) => {
      const d = await api.setLyricsNames(id, names);
      setRow(d.lyrics);
    },
    [id]
  );

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

  // Call it off part-way. Queued work never starts; a crawl already out at the
  // sidecar is left to finish and its answer thrown away, because it is on a
  // thread and threads don't cancel. The row settles either way, which is what
  // stops the page waiting — and a reading stopped before it landed is never
  // charged for.
  const stop = useCallback(async () => {
    setStopping(true);
    setError(null);
    try {
      const d = await api.stopLyrics(id);
      setRow(d.lyrics);
    } catch (err) {
      setError(err);
    } finally {
      setStopping(false);
    }
  }, [id]);

  // Play it in the corner while you read. Three ways to find the video, in
  // order of how sure they are.
  const listen = useCallback(async () => {
    // One the sidecar resolved. Carries a real title with it.
    if (row?.video?.id) {
      setError(null);
      dockYoutube(row.video.id, titleOf(row));
      return;
    }

    // One we can read out of the link ourselves. The sidecar resolves `video`
    // too, but only when the whole lookup lands, and Listen is reachable long
    // before that — so without this, pressing it during a lookup fell through
    // to a text search for the characters of a URL, found nothing, and printed
    // "Couldn't find this one on YouTube" under a YouTube URL.
    const pasted = youtubeIdFrom(row?.query);
    if (pasted) {
      const name = titleOf(row);
      setError(null);
      dockYoutube(pasted, youtubeIdFrom(name) ? "The link you pasted" : name);
      return;
    }

    // Nothing but a name, so ask the same YouTube search the rest of the app
    // uses — and only when pressed, since most readings never need it.
    const query = titleOf(row) || row?.query;
    if (!query || looksLikeUrl(query)) {
      setError({
        message: busyWords
          ? "Still working out what this is — give the lookup a moment."
          : "There's no song name here to search YouTube with.",
      });
      return;
    }

    setFinding(true);
    setError(null);
    try {
      const d = await api.searchFreeText(query);
      const hit = (d.results || [])[0];
      if (hit) dockYoutube(hit.id, hit.title || query);
      else setError({ message: "Couldn't find this one on YouTube." });
    } catch (err) {
      setError(err);
    } finally {
      setFinding(false);
    }
  }, [row, dockYoutube, busyWords]);

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
  // A row holds one reading, and it belongs to the version it was made from.
  // Beside any other it would pair every line with somebody else's words, so
  // the other version shows its words and the offer to read those instead.
  const meaningShown = meaningFor(row, shown, versions);
  const explainedElsewhere = Boolean(row.meaning) && !meaningShown;
  const explainedOne = explainedElsewhere ? meaningOwner(row, versions) : null;
  // The server reads your own words, or the best the crawler found. It has no
  // way to be asked for an alternative script, so that is not offered.
  const explainable = canExplainVersion(shown, versions);
  const noWords = row.state === "not_found" || row.state === "failed";
  const source = sourceLinkOf(row);

  return (
    <div className="view">
      <div className="lyrics-head">
        <Thumb className="lyrics-thumb" src={row.video?.thumbnail} iconSize={28} />
        <div className="lyrics-head-meta">
          <h1 className="lyrics-head-title">{titleOf(row)}</h1>
          {/* Where this came from, as somewhere to go. It used to be the
              artist and the channel, which on a YouTube lookup is the title
              again in smaller type — the channel *is* the artist there, so the
              line said the same thing twice. The link is the one thing under
              the title that isn't already in it. Listen beside it still plays
              the song in the dock; this is the way out to the post itself. */}
          <div className="lyrics-head-sub">
            {source ? (
              <a href={source.url} target="_blank" rel="noopener" className="ext-link">
                {source.youtube ? <YoutubeIcon size={14} /> : <ExternalLinkIcon size={13} />}
                {source.label}
              </a>
            ) : (
              [
                row.manual_artist || row.resolved?.artist,
                row.resolved?.resolved_by === "itunes" && "name confirmed by iTunes",
              ]
                .filter(Boolean)
                .join(" · ") || row.query
            )}
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
        <button
          type="button"
          className="icon-btn"
          onClick={() => setNaming(true)}
          aria-label="Rename"
          title="Name this lookup"
        >
          <PencilIcon size={16} />
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
          <button
            type="button"
            className="btn ghost small lyrics-stop"
            onClick={stop}
            disabled={stopping}
          >
            {stopping ? <span className="spin" /> : "Stop"}
          </button>
        </div>
      )}

      {/* Stopped is a finished lookup, not a fault, so it gets the plain block
          and the way back rather than an error box — and, like every other
          "there are no words" notice here, only while that is still true. The
          header's own Look again is the way back once there are. */}
      {row.state === "stopped" && !shown && (
        <div className="song lyrics-working">
          {row.error}
          <button
            type="button"
            className="btn ghost small lyrics-stop"
            onClick={again}
            disabled={active}
          >
            Look again
          </button>
        </div>
      )}

      {/* Stopping is a reason to have no words like any other, and the answer
          to all of them is the same: put them in yourself. */}
      {row.state === "stopped" && !shown && (
        <NoWordsPanel
          row={row}
          onAdd={() => setEditing({})}
          onKeep={row.kept ? null : keep}
          onDiscard={row.kept ? null : discard}
          onName={rename}
        />
      )}

      {noWords && (
        <>
          {said && (
            <div className={"lyrics-said" + (said === "out" ? " is-out" : "")}>
              <Msg kind="err">{row.error}</Msg>
              {row.state === "not_found" && (
                <div className="hint lyrics-retry-hint">
                  Adding the artist&apos;s name, or a distinctive line, usually does it. A
                  link to the lyrics page itself works too — paste it and we&apos;ll read
                  that page.
                </div>
              )}
            </div>
          )}
          {/* The finder refusing to guess is it working, but it is not the end
              of the road: the song is usually findable in ten seconds, so the
              next thing offered is somewhere to put it.

              Only while there is nothing to read. Once words are on the page —
              yours, or a later crawl's — "No words found" is a question that
              has been answered, and asking it over the answer reads as the
              page not having noticed. Adding your own keeps the row (see
              services/lyrics_jobs.py), so the Keep/Discard offer in here goes
              with it rather than being stranded. */}
          {!shown && (
            <NoWordsPanel
              row={row}
              onAdd={() => setEditing({})}
              onKeep={row.kept ? null : keep}
              onDiscard={row.kept ? null : discard}
              onName={rename}
            />
          )}
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

          {busyMeaning ? (
            <div className="song lyrics-working">
              <span className="spin" />
              Reading it. The dictionary first, then the poem — takes a minute.
              <button
                type="button"
                className="btn ghost small lyrics-stop"
                onClick={stop}
                disabled={stopping}
              >
                {stopping ? <span className="spin" /> : "Stop"}
              </button>
            </div>
          ) : (
            row.meaning_state === "limited" && <LimitedNote note={row.meaning_note} />
          )}

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
            title={titleOf(row)}
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
        </>
      )}

      {naming && (
        <RenameLyricsModal
          row={row}
          onSaved={setRow}
          onClose={() => setNaming(false)}
        />
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

      {editing && (
        <AddLyricsModal
          version={editing.id ? editing : null}
          warnLosesMeaning={
            Boolean(editing.id) && row.meaning_version === `mine:${editing.id}` && Boolean(row.meaning)
          }
          onSave={saveMine}
          onClose={() => setEditing(null)}
        />
      )}

      {dropVersion && (
        <ConfirmModal
          title="Delete these words"
          message={`Delete the "${labelFor(dropVersion)}" version? ${
            row.meaning_version === `mine:${dropVersion.id}` && row.meaning
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

/** The page this lookup came from, and what to call the link.
 *
 *  Three sources, in order of how sure they are: the video the sidecar
 *  resolved, the id in the link that was pasted (which is there long before
 *  the lookup lands), and failing both, any other link somebody pasted — a
 *  lyrics page reads as a source as well as a video does. A lookup started
 *  from a song name has none of these and gets no link.
 *
 *  The href is the canonical watch URL; the label drops the scheme and the
 *  playlist clutter, because a 90-character URL under a title is noise.
 */
function sourceLinkOf(row) {
  const id = row.video?.id || youtubeIdFrom(row.query);
  if (id) return { url: youtubeWatchUrl(id), label: `youtube.com/watch?v=${id}`, youtube: true };

  const q = (row.query || "").trim();
  if (!looksLikeUrl(q)) return null;
  return { url: q, label: q.replace(/^https?:\/\/(www\.)?/i, ""), youtube: false };
}
