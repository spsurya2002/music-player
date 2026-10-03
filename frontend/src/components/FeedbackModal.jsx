import { useState } from "react";
import * as api from "../api/client";
import Modal from "./Modal";
import Msg from "./Msg";
import { CheckIcon, StarIcon } from "./icons";
import "./FeedbackModal.css";

// What each rating means, said out loud. A row of stars with nothing under it
// makes everyone guess where the middle is.
const SAYS = {
  1: "Not working for me",
  2: "More wrong than right",
  3: "Does the job",
  4: "Good, with gaps",
  5: "No complaints",
};

const MIN_MESSAGE = 10;
const MAX_MESSAGE = 2000;

/**
 * Say what you think of the app.
 *
 * The words come first and the rating sits under them, because the words are
 * what you came to write — the stars are the summary you give once you have
 * said it. Both are required: a rating with no words is a number nobody can
 * act on, and words with no rating are nothing the dashboard can count.
 *
 * Send is never disabled for being incomplete, only for being in flight. A
 * button that silently does nothing is indistinguishable from a broken one,
 * so pressing it always answers — with the thing that is missing.
 */
export default function FeedbackModal({ onClose }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const words = message.trim();

  async function submit(e) {
    e.preventDefault();
    if (words.length < MIN_MESSAGE) {
      setError(`Tell us a bit more — ${MIN_MESSAGE} characters at least.`);
      return;
    }
    if (!rating) {
      setError("Pick a rating too — it's the part that can be counted.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.sendFeedback({ rating, message: words });
      setSent(true);
    } catch (err) {
      setError(err.message || "That didn't send. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Modal title="Thanks" onClose={onClose}>
        <div className="feedback-done">
          <CheckIcon size={20} />
          <p>
            Read by a person, not a form. If it was something broken, it goes on the
            list; if it was something missing, it goes on the longer one.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  // Hovering previews the rating the click would set, so the row reads as one
  // control rather than five buttons.
  const lit = hover || rating;
  const short = words.length > 0 && words.length < MIN_MESSAGE;

  return (
    <Modal title="Tell us what you think" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="feedback-label" htmlFor="feedback-message">
          What would make it better? What got in your way?
        </label>
        <textarea
          id="feedback-message"
          className="feedback-text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MAX_MESSAGE}
          rows={5}
          autoFocus
          placeholder="Anything — a feature you keep reaching for, something that broke, a page that reads wrong."
        />
        <div className={"feedback-count" + (short ? " short" : "")}>
          {short
            ? `${MIN_MESSAGE - words.length} more to go`
            : `${words.length}/${MAX_MESSAGE}`}
        </div>

        <div className="feedback-rate" onMouseLeave={() => setHover(0)}>
          <div className="feedback-stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} — ${SAYS[n]}`}
                className={"feedback-star" + (n <= lit ? " on" : "")}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
              >
                <StarIcon size={28} filled={n <= lit} />
              </button>
            ))}
          </div>
          <div className="feedback-says">{lit ? SAYS[lit] : "Pick a rating"}</div>
        </div>

        {error && <Msg kind="err">{error}</Msg>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? <span className="spin" /> : null}
            Send
          </button>
        </div>
      </form>
    </Modal>
  );
}
