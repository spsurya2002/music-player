import { useState } from "react";
import Modal from "./Modal";
import "./AddLyricsModal.css";

// The sidecar refuses to explain more than this in one go, and the server
// refuses to store more than the sidecar can read.
const MAX_CHARS = 12000;

/**
 * Words of your own, typed or pasted.
 *
 * The whole of the feature's answer to "we found nothing": the song is on
 * Google in ten seconds, so the useful thing is a box to put it in rather than
 * a better apology. Editing an existing version uses the same form — pass
 * `version` and it patches instead of adding.
 *
 * It never saves anything itself. `onSave` is the caller's API call, so the
 * page that owns the row is the one that updates it, exactly as with every
 * other modal here.
 */
export default function AddLyricsModal({ version, warnLosesMeaning, onSave, onClose }) {
  const editing = Boolean(version);
  const [text, setText] = useState(version?.text || "");
  const [label, setLabel] = useState(version?.label || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trimmed = text.trim();
  const over = trimmed.length > MAX_CHARS;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!trimmed || over) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ text: trimmed, label: label.trim() });
    } catch (err) {
      setError(err.message || "Could not save those words.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? "Edit these words" : "Add the words yourself"}
      onClose={onClose}
      width={560}
    >
      <form onSubmit={handleSubmit}>
        <p className="hint" style={{ margin: "0 0 12px" }}>
          Paste them in any script — Urdu, Hindi or Roman. One line per line; a blank
          line between verses reads as a break.
        </p>
        <div className="row">
          <textarea
            className="lyrics-paste"
            rows={12}
            placeholder={"सहर क़रीब है तारों का हाल क्या होगा\nअब इंतज़ार के मारों का हाल क्या होगा"}
            aria-label="The words"
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="auto"
            autoFocus
          />
        </div>
        <div className="row">
          <input
            type="text"
            placeholder="What to call this version (optional)"
            aria-label="What to call this version (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="lyrics-paste-foot">
          <span className="hint">
            Named after its script if you leave that blank.
          </span>
          <span className={"lyrics-paste-count" + (over ? " over" : "")}>
            {trimmed.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </span>
        </div>
        {warnLosesMeaning && text !== version?.text && (
          <div className="msg info show">
            These are the words the reading was made from — changing them removes it,
            and reading them again costs another lyric lookup.
          </div>
        )}
        {over && (
          <div className="msg err show">
            That&apos;s longer than we can read — {MAX_CHARS.toLocaleString()} characters is
            the most.
          </div>
        )}
        {error && <div className="msg err show">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy || !trimmed || over}>
            {busy ? (
              <>
                <span className="spin" />
                Saving
              </>
            ) : editing ? (
              "Save changes"
            ) : (
              "Save the words"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
