import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import ConfirmModal from "../components/ConfirmModal";
import Msg from "../components/Msg";
import { FEATURES, QuotaMeter, limitsChange } from "../components/Quota";
import { CoffeeIcon } from "../components/icons";
import { ChevronIcon } from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { emitLimitsChanged } from "../utils/bus";
import { fmtDate } from "../utils/format";
import "./PlanView.css";

// Your limits, and the way to ask for more. This is the whole of "pricing":
// there is no payment anywhere in the app. Two features cost the server real
// work — pulling audio out of a reel, finding the song behind a file — so they
// come with a free allowance, and past it you write to whoever runs this
// instance. They raise it by hand and answer here.

// No sockets anywhere in this app, so an open thread is kept current by
// asking again. Three seconds is a conversation's worth of patience without
// being a request a second.
const POLL_MS = 3000;

const STATE_LABEL = { pending: "Waiting", approved: "Approved", declined: "Declined" };
const STATE_TONE = { pending: " mid", approved: "", declined: " low" };

export default function PlanView() {
  const { quota, refreshQuota } = useAuth();
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState(null); // { kind, text }

  const load = useCallback(async () => {
    try {
      const data = await api.listLimitRequests();
      setRequests(data.requests || []);
      setLoadError("");
      return data.requests || [];
    } catch (err) {
      setLoadError(err.message || "Could not read your requests.");
      return [];
    }
  }, []);

  // Reading them is what being on this page means — anything that arrives
  // while you are looking at it is read too, so this runs after every load
  // and not only the first.
  const readThem = useCallback((rows) => {
    if (!rows.some((r) => r.unread)) return;
    api
      .markLimitRequestsSeen()
      .then(() => emitLimitsChanged())
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshQuota();
    load().then(readThem);
  }, [load, refreshQuota, readThem]);

  // A thread is a conversation, and the other side answers on their own
  // schedule. While anything is still open the page asks again — but only
  // while the tab is actually on screen: a backgrounded Plan page polling
  // forever is a request every few seconds for nobody.
  const anyPending = Boolean(requests?.some((r) => r.state === "pending"));
  useEffect(() => {
    if (!anyPending) return undefined;
    let timer = null;
    let stopped = false;

    async function tick() {
      if (document.visibilityState === "visible") {
        const rows = await load();
        if (stopped) return;
        readThem(rows);
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }

    // Coming back to the tab should not cost you most of an interval.
    function onVisible() {
      if (document.visibilityState === "visible") load().then(readThem);
    }

    timer = setTimeout(tick, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [anyPending, load, readThem]);

  async function handleSend(e) {
    e.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setSendMsg(null);
    try {
      await api.createLimitRequest(text);
      setMessage("");
      setSendMsg({ kind: "ok", text: "Sent. The answer will show up below, and on the rail." });
      await load();
      emitLimitsChanged();
    } catch (err) {
      setSendMsg({ kind: "err", text: err.message || "That didn't send." });
    } finally {
      setSending(false);
    }
  }

  const pending = (requests || []).find((r) => r.state === "pending");
  const plan = quota?.plan;
  const defaults = quota?.defaults || {};

  return (
    <div className="view">
      <h1 className="page-title">Plan</h1>
      <p className="sub">
        Four things here cost real work, so they come with a limit — and explaining a song
        costs the most, which is why it has the smallest. Everything else — your library,
        playlists, sharing, searching by name, words you type in yourself — has none.
      </p>

      {/* Driven off FEATURES so a fourth limit shows up here on its own. */}
      <div className="quota-meters">
        {Object.keys(FEATURES).map((f) => (
          <QuotaMeter key={f} feature={f} q={quota?.[f]} />
        ))}
      </div>

      <div className="plan-tiers">
        <div className={"card plan-tier" + (plan === "free" ? " current" : "")}>
          <div className="plan-tier-head">
            <span className="plan-tier-name">Free</span>
            {plan === "free" && <span className="badge">Yours</span>}
          </div>
          <div className="plan-tier-price">Every account</div>
          <ul className="plan-tier-list">
            {Object.entries(FEATURES).map(([f, names]) => (
              <li key={f}>
                {defaults[f] ?? "—"} {names.units}
              </li>
            ))}
            <li>
              Only successes count — a failed download, a file nothing matched, or a song whose
              words we couldn&apos;t find is free
            </li>
          </ul>
        </div>

        <div className={"card plan-tier" + (plan === "extended" || plan === "admin" ? " current" : "")}>
          <div className="plan-tier-head">
            <span className="plan-tier-name">More</span>
            {plan === "extended" && <span className="badge">Yours</span>}
            {plan === "admin" && <span className="badge">Admin · unlimited</span>}
          </div>
          <div className="plan-tier-price">On request — no card, no payment</div>
          <ul className="plan-tier-list">
            <li>Say what you need below</li>
            <li>The admin raises your limits by hand</li>
            <li>Their answer shows up on this page</li>
          </ul>
        </div>
      </div>

      {/* Said here because this is the page about what the app costs to run,
          and said carefully: a coffee buys nothing. Tying it to the limits
          would make this a shop, and then asking for more would feel like
          being upsold rather than being answered. */}
      <Link className="plan-coffee" to="/support">
        <CoffeeIcon size={20} />
        <span>
          <b>Buy me a coffee</b>
          <span className="plan-coffee-sub">
            Entirely optional, and it changes nothing here — asking for more is free and
            always will be. UPI or a card, on the support page.
          </span>
        </span>
      </Link>

      {plan !== "admin" && (
        <div className="card plan-ask">
          <div className="mhead">Ask for more</div>
          {pending ? (
            <div className="song">
              <b>Waiting on the admin.</b> You can send another once this one's answered — it's
              the first under Your requests.
            </div>
          ) : (
            <form onSubmit={handleSend}>
              <textarea
                rows={3}
                maxLength={1000}
                placeholder="What do you need, and roughly how much? e.g. I save reels for my dance class — 30 more extractions would cover a month."
                aria-label="What do you need, and roughly how much?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="plan-ask-foot">
                <span className="hint">Free text — the admin decides the numbers.</span>
                <button type="submit" className="btn" disabled={sending || !message.trim()}>
                  {sending ? (
                    <>
                      <span className="spin" />
                      Sending
                    </>
                  ) : (
                    "Send request"
                  )}
                </button>
              </div>
            </form>
          )}
          {sendMsg && <Msg kind={sendMsg.kind}>{sendMsg.text}</Msg>}
        </div>
      )}

      {loadError && <Msg kind="err">{loadError}</Msg>}

      {requests && requests.length > 0 && (
        <div className="plan-history">
          <div className="mhead">Your requests</div>
          {requests.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              onUpdated={(next) =>
                setRequests((all) => all.map((x) => (x.id === next.id ? next : x)))
              }
              onWithdrawn={(id) => {
                setRequests((all) => all.filter((x) => x.id !== id));
                // The ask form is hidden while anything is pending, so it has
                // to be told the queue is clear again.
                setSendMsg(null);
                emitLimitsChanged();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// How many lines the server will take on one thread (limits.MAX_NOTES).
const MAX_NOTES = 12;

function RequestRow({ request: r, onUpdated, onWithdrawn }) {
  const pending = r.state === "pending";
  const notes = r.notes || [];
  const full = notes.length >= MAX_NOTES;

  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  // null until you have said either way, so the default can depend on whether
  // there is anything new in there without an effect to set it.
  const [openThread, setOpenThread] = useState(null);
  const expanded = openThread ?? Boolean(r.unread);
  const last = notes[notes.length - 1];

  async function ask(e) {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      const data = await api.askAboutRequest(r.id, q);
      onUpdated(data.request);
      setText("");
      setAsking(false);
    } catch (err) {
      setError(err.message || "That didn't send. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={"song plan-request" + (r.unread ? " unread" : "")}>
      <div className="plan-request-head">
        <span className="plan-request-date">{fmtDate(r.created_at)}</span>
        {r.unread && <span className="badge mid">New</span>}
        <span className={`badge${STATE_TONE[r.state] ?? " low"}`}>{STATE_LABEL[r.state] || r.state}</span>
      </div>
      <div className="plan-request-message">{r.message}</div>

      {/* The back-and-forth while it was open, oldest first — which is the
          order it was said in and the order it reads in. Folded away by
          default: a dozen lines under every request turns the list of them
          into a transcript. It opens itself when something is unread. */}
      {notes.length > 0 && (
        <div className="plan-thread-box">
          <button
            type="button"
            className="plan-thread-toggle"
            onClick={() => setOpenThread(!expanded)}
            aria-expanded={expanded}
          >
            <ChevronIcon size={13} className={expanded ? "down" : ""} />
            <span>
              {notes.length} {notes.length === 1 ? "message" : "messages"}
            </span>
            {/* Folded, the newest line stands in for the rest — usually the
                only one you came back for. */}
            {!expanded && last && (
              <span className="plan-thread-peek">
                {last.from === "admin" ? "Admin: " : "You: "}
                {last.text}
              </span>
            )}
          </button>

          {expanded && (
            <div className="plan-thread">
              {notes.map((n, i) => (
                <div key={i} className={"plan-note " + n.from}>
                  <span className="plan-request-from">{n.from === "admin" ? "Admin" : "You"}</span>
                  <span className="plan-note-text">{n.text}</span>
                  <span className="plan-note-at">{fmtDate(n.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {r.reply && (
        <div className="plan-request-reply">
          <span className="plan-request-from">Admin</span>
          {r.reply}
        </div>
      )}
      {r.state === "approved" && r.limits_before && r.limits_after && (
        <span className="via">{limitsChange(r.limits_before, r.limits_after)}</span>
      )}

      {/* Only while it is open. Once it has been answered there is nothing to
          chase, and the next thing to send is a new request. */}
      {pending && !asking && (
        <div className="plan-request-actions">
          {!full && (
            <button type="button" className="plan-ask-link" onClick={() => setAsking(true)}>
              Ask about this
            </button>
          )}
          {/* One open request at a time, so until this existed a mistyped or
              ill-judged one blocked the only way of asking until an admin got
              round to it. */}
          <button
            type="button"
            className="plan-ask-link danger"
            onClick={() => setWithdrawing(true)}
          >
            Withdraw
          </button>
        </div>
      )}

      {withdrawing && (
        <ConfirmModal
          title="Withdraw request"
          message="Take this back before anyone answers it? It won't be kept, and you'll be able to send a new one straight away."
          confirmLabel="Withdraw"
          onConfirm={async () => {
            await api.withdrawLimitRequest(r.id);
            onWithdrawn(r.id);
          }}
          onClose={() => setWithdrawing(false)}
        />
      )}

      {pending && asking && (
        <form className="plan-ask-note" onSubmit={ask}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={600}
            autoFocus
            placeholder="Any idea how long this takes?"
            aria-label="Your question"
          />
          <button type="submit" className="btn small" disabled={busy || !text.trim()}>
            {busy ? <span className="spin" /> : "Send"}
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setAsking(false);
              setError("");
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </form>
      )}

      {error && <Msg kind="err">{error}</Msg>}

      {pending && full && (
        <div className="hint">This thread is full — the admin has everything they need.</div>
      )}
    </div>
  );
}
