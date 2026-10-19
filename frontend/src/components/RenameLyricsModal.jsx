import { useState } from "react";
import * as api from "../api/client";
import Modal from "./Modal";
import Msg from "./Msg";

/**
 * What to call a saved lookup.
 *
 * A lookup is filed under whatever it was started with, and that is often a
 * YouTube URL: a crawl that found nothing resolved no names at all, and one
 * that found the wrong song resolved confident wrong ones. Neither is fixable
 * by looking again, so both are fixed here — from the library list as well as
 * from the lookup's own page, because the list is where you notice.
 *
 * The names are kept through a re-crawl (see services/lyrics_jobs.py): they
 * are not an attempt at anything, they are what somebody typed.
 */
export default function RenameLyricsModal({ row, onSaved, onClose }) {
  const [title, setTitle] = useState(row.manual_title || row.resolved?.title || "");
  const [artist, setArtist] = useState(row.manual_artist || row.resolved?.artist || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api.setLyricsNames(row.id, { title: title.trim(), artist: artist.trim() });
      onSaved?.(d.lyrics);
      onClose();
    } catch (err) {
      setError(err.message || "Could not save that name.");
    } finally {
      setBusy(false);
    }
  }

  // Emptying the box is how you take a name back off and let whatever the
  // crawl resolved show through again — but it is not a way to name something
  // nothing, so a row with no name of its own needs one typed.
  const canSave = Boolean(title.trim()) || Boolean(row.manual_title);

  return (
    <Modal title="Name this lookup" onClose={onClose}>
      <form onSubmit={save}>
        {/* htmlFor/id rather than nesting, the same as the song page: the
            labels are flex siblings of their fields, not wrappers. */}
        <div className="inline-edit-row">
          <label htmlFor="lyrics-name-title">Song</label>
          <input
            id="lyrics-name-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sahar Qareeb Hai"
            autoFocus
          />
        </div>
        <div className="inline-edit-row">
          <label htmlFor="lyrics-name-artist">Artist</label>
          <input
            id="lyrics-name-artist"
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Nusrat Fateh Ali Khan"
          />
        </div>

        {error && <Msg kind="err">{error}</Msg>}

        <p className="hint" style={{ marginTop: 10 }}>
          Yours, and kept if you look this one up again. It&apos;s also what a reading is
          asked about.
        </p>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="btn ghost small" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn small" disabled={busy || !canSave}>
            {busy ? <span className="spin" /> : "Save name"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
