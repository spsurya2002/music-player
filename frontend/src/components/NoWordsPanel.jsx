import { useState } from "react";
import { CheckIcon, PlusIcon } from "./icons";
import "./NoWordsPanel.css";

/**
 * What a lookup that found nothing offers instead of a dead end.
 *
 * The finder refuses to guess, which is right — a confident wrong answer is
 * worse than none. But the person asking can usually find the song themselves
 * in ten seconds, so the honest "we found nothing" needs a next sentence, and
 * this is it.
 *
 * Shaped like .lyrics-keep: the same bar of a sentence and the buttons that
 * settle it. `onKeep` and `onDiscard` are left out on a song's page, where the
 * row belongs to the song and there is nothing to decide about keeping it.
 */
export default function NoWordsPanel({ row, onAdd, onKeep, onDiscard, onName }) {
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState(row.manual_title || "");
  const [artist, setArtist] = useState(row.manual_artist || "");
  const [busy, setBusy] = useState(false);

  // A lookup that found nothing resolved no title either, so the only name it
  // has is whatever was pasted — usually a URL, which is not a song name.
  const unnamed = !row.manual_title && !row.resolved?.title;

  // Stopped and found-nothing are both "there are no words here", but only one
  // of them is news — somebody pressed Stop on the other one themselves.
  const stopped = row.state === "stopped";

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onName({ title: title.trim(), artist: artist.trim() });
      setNaming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lyrics-nowords">
      <div className="lyrics-nowords-main">
        <div className="lyrics-nowords-text">
          <div className="lyrics-nowords-title">
            {stopped ? "Add the words yourself instead?" : "No words found — add them yourself?"}
          </div>
          <div className="lyrics-nowords-sub">
            {stopped
              ? "Faster than looking again, if you already know where to find them."
              : "Keep this and paste the words whenever you find them."}{" "}
            Anything you add stays through a re-crawl, and costs nothing.
          </div>
        </div>
        <button type="button" className="btn" onClick={onAdd}>
          <PlusIcon size={14} style={{ marginRight: 6 }} />
          Add the words
        </button>
        {onKeep && (
          <button type="button" className="btn secondary" onClick={onKeep}>
            <CheckIcon size={14} style={{ marginRight: 6 }} />
            Keep it
          </button>
        )}
        {onDiscard && (
          <button type="button" className="btn ghost" onClick={onDiscard}>
            Discard
          </button>
        )}
      </div>

      {onName && !naming && unnamed && (
        <button type="button" className="lyrics-nowords-name" onClick={() => setNaming(true)}>
          Give it a name, so it isn&apos;t filed under the link you pasted
        </button>
      )}

      {onName && naming && (
        <form className="lyrics-nowords-form" onSubmit={save}>
          <div className="inline-edit-row">
            <label htmlFor="nowords-title">Song</label>
            <input
              id="nowords-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sahar Qareeb Hai"
              autoFocus
            />
          </div>
          <div className="inline-edit-row">
            <label htmlFor="nowords-artist">Artist</label>
            <input
              id="nowords-artist"
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Nusrat Fateh Ali Khan"
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost small" onClick={() => setNaming(false)}>
              Cancel
            </button>
            <button type="submit" className="btn small" disabled={busy || !title.trim()}>
              {busy ? <span className="spin" /> : "Save name"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
