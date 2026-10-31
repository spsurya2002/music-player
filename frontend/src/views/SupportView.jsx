import { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import Msg from "../components/Msg";
import Modal from "../components/Modal";
import { CoffeeIcon, QrIcon } from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { COFFEE_URL, UPI_ID, UPI_NAME } from "../utils/support";
import "./SupportView.css";

const MAX = 500;

/**
 * A place to pay, not a checkout.
 *
 * Paytm and Buy Me a Coffee sit side by side. The QR stays closed until
 * someone asks for it: it is a static Paytm code, the amount is chosen in
 * the UPI app, and this page never hears whether anyone paid.
 *
 * The note is optional and separate. It lands on the admin Support tab,
 * with a name when there is a session and without one when there isn't.
 * Sending it does not require a payment.
 */
export default function SupportView() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const [qrOpen, setQrOpen] = useState(false);

  async function copyId() {
    const mark = (state) => {
      setCopyState(state);
      window.setTimeout(() => setCopyState(""), 2000);
    };
    try {
      await navigator.clipboard.writeText(UPI_ID);
      mark("ok");
      return;
    } catch {
      // A browser can refuse the clipboard. Fall through and copy the old way.
    }
    const code = document.getElementById("support-upi");
    if (code) {
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      if (ok) {
        sel.removeAllRanges();
        mark("ok");
        return;
      }
    }
    mark("err");
  }

  async function send(e) {
    e.preventDefault();
    if (busy || done) return;
    setBusy(true);
    setError("");
    try {
      await api.sendSupportNote({ message, website });
      setDone(true);
      setMessage("");
    } catch (err) {
      setError(err.message || "Couldn't send that. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const words = message.trim();
  const tooShort = words.length > 0 && words.length < 2;

  return (
    <div className="view support-page">
      <header className="support-head">
        <h1 className="page-title">Help keep Reelody free.</h1>
        <p className="sub">
          If Reelody has been useful to you, a small contribution helps cover hosting and
          development. It is optional, and it does not raise a limit.
        </p>
      </header>

      <div className="support-ways">
        <section className="card support-option" aria-labelledby="support-upi-title">
          <h2 id="support-upi-title" className="support-card-title">
            Paytm
          </h2>
          <p className="support-lead">Any UPI app. You choose the amount.</p>
          <div className="support-option-foot">
            <div className="support-upi">
              <div className="support-upi-text">
                <span className="support-upi-label" id="support-upi-label">
                  UPI ID
                </span>
                <code id="support-upi">{UPI_ID}</code>
              </div>
              <button
                type="button"
                className="support-copy"
                onClick={copyId}
                aria-describedby="support-copy-status"
              >
                {copyState === "ok" ? "Copied" : "Copy"}
              </button>
            </div>
            <p id="support-copy-status" className="support-copy-status" role="status">
              {copyState === "ok"
                ? `Copied ${UPI_ID}.`
                : copyState === "err"
                  ? "Couldn't copy. The UPI ID is selected — copy it from there."
                  : ""}
            </p>
            <button
              type="button"
              className="btn secondary support-reveal"
              aria-haspopup="dialog"
              aria-expanded={qrOpen}
              onClick={() => setQrOpen(true)}
            >
              <QrIcon size={16} />
              View QR
            </button>
          </div>
        </section>

        <section className="card support-option" aria-labelledby="support-bmc-title">
          <h2 id="support-bmc-title" className="support-card-title">
            Buy me a coffee
          </h2>
          <p className="support-lead">Card and Apple Pay, on their site.</p>
          <a className="btn secondary support-bmc" href={COFFEE_URL} target="_blank" rel="noopener">
            <CoffeeIcon size={16} />
            Open Buy Me a Coffee
          </a>
        </section>
      </div>

      <p className="support-fine support-ways-note">
        Nothing is unlocked. This page never sees a payment, and it can't confirm one.
      </p>

      {qrOpen && (
        <Modal title="Pay with UPI" onClose={() => setQrOpen(false)} width={400} className="support-qr-backdrop">
          <div className="support-qr-plate" id="support-qr">
            <img
              className="support-qr"
              src="/upi-qr.jpg"
              alt={`UPI QR for ${UPI_NAME}. The UPI ID is ${UPI_ID}.`}
            />
            <p className="support-scan">Scan using any UPI app</p>
          </div>
        </Modal>
      )}

      <form className="card support-note" onSubmit={send} aria-labelledby="support-note-title">
          <h2 id="support-note-title" className="support-card-title">
            Leave feedback
          </h2>
          <p className="support-lead">
            Share your feedback, ideas, or suggestions for what you'd like to see next. Only
            the admin sees it.
          </p>
          {user ? (
            <p className="support-who">Signed in as {user.name}. It will have your name on it.</p>
          ) : (
            <p className="support-who">
              Signed out, so this won't have your name on it.{" "}
              <Link to="/login" state={{ from: "/support" }}>
                Sign in
              </Link>{" "}
              if you'd rather it did.
            </p>
          )}

          {done ? (
            <div className="song" role="status">
              <b>Got it.</b> Thank you — it's with the admin.
            </div>
          ) : (
            <>
              <label className="support-label" htmlFor="support-note">
                Feedback
              </label>
              <textarea
                id="support-note"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={MAX}
                placeholder="What would you like to see next?"
                aria-invalid={tooShort || undefined}
                aria-describedby={tooShort ? "support-note-error" : undefined}
              />
              <input
                type="text"
                className="support-pot"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />
              {(tooShort || words.length > 400) && (
                <div className="support-note-meta">
                  <span id="support-note-error" className="support-invalid" role="status">
                    {tooShort ? "Write a little more — two characters at least." : ""}
                  </span>
                  {words.length > 400 && (
                    <span className="support-count">
                      {words.length}/{MAX}
                    </span>
                  )}
                </div>
              )}
              <button
                className="btn support-send"
                type="submit"
                disabled={busy || words.length < 2}
                aria-busy={busy || undefined}
              >
                {busy && <span className="spin" />}
                {busy ? "Sending" : "Send feedback"}
              </button>
            </>
          )}
          {error && <Msg kind="err">{error}</Msg>}
          <p className="support-fine">No contribution required to send this.</p>
        </form>
    </div>
  );
}
