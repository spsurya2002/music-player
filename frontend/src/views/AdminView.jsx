import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import Avatar from "../components/Avatar";
import Msg from "../components/Msg";
import { FEATURES, limitsChange } from "../components/Quota";
import ConfirmModal from "../components/ConfirmModal";
import {
  ChevronIcon,
  CoffeeIcon,
  FeedbackIcon,
  MailIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  StarIcon,
  TrashIcon,
} from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { emitAboutChanged, emitLimitsChanged } from "../utils/bus";
import { fmtDate } from "../utils/format";
import "../components/ModeTabs.css";
import "./AdminView.css";

// The other side of the Plan page. Built for the job it is: scan a queue,
// answer one, move on. So both tabs are compact lists inside one card, and a
// row opens into its controls only when you ask — one at a time — instead of
// every waiting request arriving as a full form.
//
// Admins are named in the server's config (ADMIN_EMAILS); the routes behind
// this page 404 for anyone else, so hiding it here is only tidiness.

const STATE_LABEL = { pending: "Waiting", approved: "Approved", declined: "Declined" };
const STATE_TONE = { pending: " mid", approved: "", declined: " low" };

// What a grant can be, per feature. Admins think in "give them 10 more", not
// "set the total to 15" — the server still receives a total, worked out here.
const PRESETS = [5, 10, 25];

// The waiting list is a queue other people are adding to, and senders can now
// ask questions on it — so it refreshes itself rather than waiting for F5.
const POLL_MS = 4000;

export default function AdminView() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState("requests");
  const [pendingCount, setPendingCount] = useState(null);
  const [feedbackCount, setFeedbackCount] = useState(null);
  const [messageCount, setMessageCount] = useState(null);
  const [supportCount, setSupportCount] = useState(null);

  if (!isAdmin) {
    return (
      <div className="view">
        <h1 className="page-title">Not found</h1>
        <p className="sub">That page doesn't exist — try Shared, All songs or Playlists.</p>
      </div>
    );
  }

  return (
    <div className="view">
      <h1 className="page-title">Admin</h1>
      <p className="sub">
        Answer requests for more, change anyone's limits, read what people think of the
        app, read notes from the support page, and write the About page. Limits are
        lifetime totals.
      </p>

      <div className="mode-tabs admin-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "requests"}
          className={"mode-tab" + (tab === "requests" ? " active" : "")}
          onClick={() => setTab("requests")}
        >
          Requests
          {pendingCount > 0 && <span className="admin-count">{pendingCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "users"}
          className={"mode-tab" + (tab === "users" ? " active" : "")}
          onClick={() => setTab("users")}
        >
          Users
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "feedback"}
          className={"mode-tab" + (tab === "feedback" ? " active" : "")}
          onClick={() => setTab("feedback")}
        >
          Feedback
          {feedbackCount > 0 && <span className="admin-count">{feedbackCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "about"}
          className={"mode-tab" + (tab === "about" ? " active" : "")}
          onClick={() => setTab("about")}
        >
          About page
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "messages"}
          className={"mode-tab" + (tab === "messages" ? " active" : "")}
          onClick={() => setTab("messages")}
        >
          Messages
          {messageCount > 0 && <span className="admin-count">{messageCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "support"}
          className={"mode-tab" + (tab === "support" ? " active" : "")}
          onClick={() => setTab("support")}
        >
          Support
          {supportCount > 0 && <span className="admin-count">{supportCount}</span>}
        </button>
      </div>

      {tab === "requests" && <RequestsTab onPendingCount={setPendingCount} />}
      {tab === "users" && <UsersTab />}
      {tab === "feedback" && <FeedbackTab onCount={setFeedbackCount} />}
      {tab === "about" && <AboutTab />}
      {tab === "messages" && <MessagesTab onCount={setMessageCount} />}
      {tab === "support" && <SupportTab onCount={setSupportCount} />}
    </div>
  );
}

// ---- Feedback -----------------------------------------------------------------

// Read-only, apart from throwing one away. There is no reply from here on
// purpose: the answer to feedback is whatever gets built, not a message back.

function FeedbackTab({ onCount }) {
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.adminListFeedback();
      setRows(data.feedback || []);
      setSummary(data.summary || null);
      setError("");
      onCount(data.summary?.count || 0);
    } catch (err) {
      setError(err.message || "Could not read the feedback.");
    }
  }, [onCount]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    const row = deleting;
    setDeleting(null);
    try {
      await api.adminDeleteFeedback(row.id);
      setRows((current) => current.filter((r) => r.id !== row.id));
      // The tally counts the whole collection, not this page, so it has to be
      // re-read rather than decremented.
      load();
    } catch (err) {
      setError(err.message || "Could not delete that.");
    }
  }

  return (
    <>
      {summary && summary.count > 0 && <RatingSummary summary={summary} />}

      <div className="card admin-list">
        <div className="admin-list-head">
          <span className="admin-list-title">
            {rows ? `${rows.length} ${rows.length === 1 ? "note" : "notes"}` : "Feedback"}
          </span>
        </div>

        {error && <Msg kind="err">{error}</Msg>}

        {rows === null && !error && (
          <div className="admin-empty">
            <span className="spin" />
            Reading feedback…
          </div>
        )}

        {rows && rows.length === 0 && (
          <div className="admin-empty">
            <FeedbackIcon size={26} />
            <div>Nobody has said anything yet.</div>
            <div className="admin-empty-sub">
              The Feedback button is in the rail and in everyone's account menu.
            </div>
          </div>
        )}

        {rows &&
          rows.map((f) => (
            <div key={f.id} className="admin-row">
              <div className="admin-row-main">
                <Avatar user={f.user} size={34} />
                <div className="admin-row-body">
                  <div className="admin-row-top">
                    <span className="admin-name">{f.user?.name || "Deleted account"}</span>
                    <Stars rating={f.rating} />
                    <span className="admin-time">{ago(f.created_at)}</span>
                  </div>
                  <div className="admin-email">{f.user?.email}</div>
                  {f.message ? (
                    <div className="admin-row-message full">{f.message}</div>
                  ) : (
                    <div className="admin-row-message feedback-silent">
                      Rating only — no words.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDeleting(f)}
                  aria-label="Delete this feedback"
                  title="Delete this feedback"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          ))}
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete feedback"
          message={`Delete what ${deleting.user?.name || "this person"} said? They won't be told.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// The tally, over every row ever sent rather than the page on screen — an
// average that moves as you scroll is not one you can compare against last
// week's.
function RatingSummary({ summary }) {
  const most = Math.max(1, ...[5, 4, 3, 2, 1].map((n) => summary.spread[n] || 0));
  return (
    <div className="card admin-rating">
      <div className="admin-rating-score">
        <div className="admin-rating-avg">{summary.average?.toFixed(1) ?? "—"}</div>
        <Stars rating={Math.round(summary.average || 0)} size={15} />
        <div className="admin-rating-count">
          {summary.count} {summary.count === 1 ? "rating" : "ratings"}
        </div>
      </div>
      <div className="admin-rating-bars">
        {[5, 4, 3, 2, 1].map((n) => (
          <div key={n} className="admin-rating-bar">
            <span className="admin-rating-n">
              {n}
              <StarIcon size={10} filled />
            </span>
            <span className="admin-rating-track">
              <span
                className="admin-rating-fill"
                style={{ width: `${((summary.spread[n] || 0) / most) * 100}%` }}
              />
            </span>
            <span className="admin-rating-num">{summary.spread[n] || 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stars({ rating, size = 13 }) {
  return (
    <span className="admin-stars" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={size} filled={n <= rating} className={n <= rating ? "on" : ""} />
      ))}
    </span>
  );
}

// ---- Requests -----------------------------------------------------------------

function RequestsTab({ onPendingCount }) {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const data = await api.adminListRequests(filter);
      // History is what's been answered — the waiting ones have their own tab.
      const list = (data.requests || []).filter((r) => filter === "pending" || r.state !== "pending");
      setRows(list);
      setError("");
      if (filter === "pending") onPendingCount(list.length);
    } catch (err) {
      setError(err.message || "Could not read the requests.");
    }
  }, [filter, onPendingCount]);

  useEffect(() => {
    setRows(null);
    setOpenId(null);
    load();
  }, [load]);

  // Only the waiting list: History is settled and does not move. Only while
  // the tab is on screen, for the same reason the Plan page checks.
  useEffect(() => {
    if (filter !== "pending") return undefined;
    let timer = null;
    let stopped = false;

    function tick() {
      if (document.visibilityState === "visible") load();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }

    timer = setTimeout(tick, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [filter, load]);

  function resolved(updated) {
    setOpenId(null);
    setRows((current) =>
      filter === "pending"
        ? current.filter((r) => r.id !== updated.id)
        : current.map((r) => (r.id === updated.id ? updated : r))
    );
    if (filter === "pending") onPendingCount((n) => Math.max(0, (n || 1) - 1));
    emitLimitsChanged();
  }

  // Answering several at once removes several rows, so the list is rebuilt from
  // the ids that went through rather than one filter per row.
  function resolvedMany(ids) {
    setOpenId(null);
    setRows((current) => current.filter((r) => !ids.includes(r.id)));
    onPendingCount((n) => Math.max(0, (n || ids.length) - ids.length));
    setSelecting(false);
    setSelectedIds(new Set());
    emitLimitsChanged();
  }

  const pendingRows = rows || [];
  const selectedRows = pendingRows.filter((r) => selectedIds.has(r.id));
  const allSelected = pendingRows.length > 0 && selectedIds.size === pendingRows.length;

  return (
    <div className="card admin-list">
      <div className="admin-list-head">
        <span className="admin-list-title">
          {filter === "pending"
            ? rows
              ? `${rows.length} waiting`
              : "Waiting"
            : "History"}
        </span>
        <div className="admin-pills">
          <button type="button" className={"pill" + (filter === "pending" ? " active" : "")} onClick={() => setFilter("pending")}>
            Waiting
          </button>
          <button type="button" className={"pill" + (filter === "all" ? " active" : "")} onClick={() => setFilter("all")}>
            History
          </button>
          {/* Only on the waiting list: history is settled, and there is nothing
              to answer in bulk or otherwise. */}
          {filter === "pending" && pendingRows.length > 1 && (
            <button
              type="button"
              className={"pill" + (selecting ? " active" : "")}
              onClick={() => {
                setSelecting((v) => !v);
                setSelectedIds(new Set());
                setOpenId(null);
              }}
            >
              {selecting ? "Done" : "Select"}
            </button>
          )}
        </div>
      </div>

      {selecting && (
        <BulkPanel
          requests={selectedRows}
          allSelected={allSelected}
          onToggleAll={() =>
            setSelectedIds(allSelected ? new Set() : new Set(pendingRows.map((r) => r.id)))
          }
          onResolved={resolvedMany}
        />
      )}

      {error && <Msg kind="err">{error}</Msg>}

      {rows === null && !error && (
        <div className="admin-empty">
          <span className="spin" />
          Reading requests…
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="admin-empty">
          <ShieldIcon size={26} />
          <div>{filter === "pending" ? "Nobody's waiting on you." : "No requests yet."}</div>
          {filter === "pending" && <div className="admin-empty-sub">New requests show up here and on the badge under your profile.</div>}
        </div>
      )}

      {rows &&
        rows.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            open={openId === r.id}
            selecting={selecting}
            selected={selectedIds.has(r.id)}
            onToggleSelect={() =>
              setSelectedIds((current) => {
                const next = new Set(current);
                if (next.has(r.id)) next.delete(r.id);
                else next.add(r.id);
                return next;
              })
            }
            onToggle={() => setOpenId((id) => (id === r.id ? null : r.id))}
            onResolved={resolved}
            onNoted={(next) => setRows((all) => all.map((x) => (x.id === next.id ? next : x)))}
          />
        ))}
    </div>
  );
}

function RequestRow({ request: r, open, onToggle, onResolved, onNoted, selecting = false, selected = false, onToggleSelect }) {
  const pending = r.state === "pending";
  const current = r.user?.quota || {};
  const notes = r.notes || [];
  // A question nobody has answered. Worth a mark on the closed row, because
  // the sender is waiting on a sentence rather than on the decision.
  const asked = notes.length > 0 && notes[notes.length - 1].from === "user";

  return (
    <div className={"admin-row" + (open ? " open" : "") + (selected ? " selected" : "")}>
      <div className="admin-row-main">
        {selecting && pending ? (
          <span className="admin-row-check">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select the request from ${r.user?.name || "this account"}`}
            />
          </span>
        ) : (
          <Avatar user={r.user} size={34} />
        )}
        <div className="admin-row-body">
          <div className="admin-row-top">
            <span className="admin-name">{r.user?.name || "Deleted account"}</span>
            <span className="admin-time">{ago(r.created_at)}</span>
          </div>
          <div className={"admin-row-message" + (open ? " full" : "")}>{r.message}</div>
          <div className="admin-chips">
            {Object.keys(FEATURES).map((f) => (
              <UsageChip key={f} feature={f} q={current[f]} />
            ))}
            {!pending && (
              <span className={`badge${STATE_TONE[r.state] ?? " low"}`}>{STATE_LABEL[r.state] || r.state}</span>
            )}
            {notes.length > 0 && (
              <span className={"badge" + (asked ? " mid" : " low")}>
                {asked ? "Asked a question" : `${notes.length} on thread`}
              </span>
            )}
          </div>
          {!pending && (r.reply || r.state === "approved") && (
            <div className="admin-row-outcome">
              {r.state === "approved" && r.limits_before && r.limits_after && (
                <span>{limitsChange(r.limits_before, r.limits_after)}</span>
              )}
              {r.reply && <span className="admin-row-reply">“{r.reply}”</span>}
            </div>
          )}
        </div>
        {pending && !selecting && (
          <button type="button" className={"btn small " + (open ? "ghost" : "secondary")} onClick={onToggle}>
            {open ? "Close" : "Respond"}
          </button>
        )}
      </div>

      {pending && open && !selecting && (
        <RespondPanel request={r} onResolved={onResolved} onNoted={onNoted} />
      )}
    </div>
  );
}

/**
 * One answer, applied to everything ticked.
 *
 * The grant is held as an intent ("+5 reels"), not as a total, and turned into
 * a total against each request's own account when it is sent — ten people on
 * different allowances all asking for a few more is the case this exists for,
 * and a single number would set them all to the same figure instead.
 *
 * Sequential rather than Promise.all: `resolve` claims each request atomically
 * before it moves any limits, and a queue answered in order is also one that
 * can report which ones went through when the tenth fails.
 */
function BulkPanel({ requests, allSelected, onToggleAll, onResolved }) {
  const [grants, setGrants] = useState(EVERY_SAME);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);

  const granting = Object.keys(FEATURES).some((f) => grants[f]?.kind !== "same");

  async function resolveAll(decision) {
    if (decision === "decline" && !note.trim()) {
      setError("Add a note so they know why.");
      return;
    }
    setBusy(decision);
    setError("");
    setDone(0);
    const went = [];
    try {
      for (const r of requests) {
        const before = limitsOf(r.user?.quota || {});
        const after = applyGrants(before, grants);
        const changes = diff(before, after);
        await api.adminResolveRequest(r.id, {
          decision,
          reply: note.trim(),
          limits: decision === "approve" ? changes : undefined,
        });
        went.push(r.id);
        setDone(went.length);
      }
      onResolved(went);
    } catch (err) {
      // Whatever already went through still did, so those rows go even though
      // the run stopped — leaving them on screen would invite a second answer.
      if (went.length) onResolved(went);
      setError(
        `${err.message || "That didn't go through."}${went.length ? ` ${went.length} of ${requests.length} were answered.` : ""}`
      );
    } finally {
      setBusy("");
      setDone(0);
    }
  }

  return (
    <div className="admin-panel admin-bulk">
      <div className="admin-panel-label admin-bulk-head">
        <button type="button" className="pill" onClick={onToggleAll}>
          {allSelected ? "Clear" : "Select all"}
        </button>
        <span>
          {requests.length} selected — one answer for all of them
        </span>
      </div>

      {Object.keys(FEATURES).map((f) => (
        <GrantControl
          key={f}
          feature={f}
          /* No single current total across a selection, so the row shows the
             choices without a "3/5 used" that would belong to nobody. */
          q={null}
          bulk
          value={grants[f]}
          onChange={(g) => setGrants((all) => ({ ...all, [f]: g }))}
        />
      ))}

      <textarea
        className="admin-note"
        rows={2}
        maxLength={1000}
        placeholder="Note for all of them — optional to approve, needed to decline"
        aria-label="Note for all of them — optional to approve, needed to decline"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (error) setError("");
        }}
      />

      <div className="admin-panel-foot">
        <span className={"admin-preview" + (granting ? " on" : "")}>
          {busy
            ? `${done} of ${requests.length} answered…`
            : granting
              ? `Applied to each account's own total`
              : "Pick what to grant, or decline them."}
        </span>
        <div className="admin-actions">
          <button
            type="button"
            className="btn ghost small"
            onClick={() => resolveAll("decline")}
            disabled={Boolean(busy) || !requests.length}
          >
            {busy === "decline" && <span className="spin" />}
            Decline all
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => resolveAll("approve")}
            disabled={Boolean(busy) || !requests.length || !granting}
          >
            {busy === "approve" && <span className="spin" />}
            Approve all
          </button>
        </div>
      </div>

      {error && <Msg kind="err">{error}</Msg>}
    </div>
  );
}

function RespondPanel({ request: r, onResolved, onNoted }) {
  const current = r.user?.quota || {};
  const [grants, setGrants] = useState(EVERY_SAME);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const noteRef = useRef(null);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const notes = r.notes || [];
  const last = notes[notes.length - 1];
  // Open when they are the ones waiting on a sentence — that is the row you
  // came in to answer. Otherwise folded, so Grant is the first thing in view.
  const [openThread, setOpenThread] = useState(() => last?.from === "user");

  // Answering a question is not deciding the request: it leaves the row
  // pending and open, and only puts a sentence in front of them. Someone
  // asking "how long?" wants that sentence, not a decision made early to get
  // them off the queue.
  async function sendReply(e) {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    setReplying(true);
    setError("");
    try {
      const data = await api.adminAddRequestNote(r.id, text);
      onNoted(data.request);
      setReply("");
    } catch (err) {
      setError(err.message || "That didn't send.");
    } finally {
      setReplying(false);
    }
  }

  const before = limitsOf(current);
  const after = applyGrants(before, grants);
  const changes = diff(before, after);
  const invalid = Object.values(after).some((v) => v !== null && (!Number.isInteger(v) || v < 0));

  async function resolve(decision) {
    if (decision === "decline" && !note.trim()) {
      setError("Add a note so they know why.");
      noteRef.current?.focus();
      return;
    }
    setBusy(decision);
    setError("");
    try {
      const data = await api.adminResolveRequest(r.id, {
        decision,
        reply: note.trim(),
        limits: decision === "approve" ? changes : undefined,
      });
      onResolved(data.request);
    } catch (err) {
      setError(err.message || "That didn't go through.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="admin-panel">
      {/* What has been said while this waited, and the box to answer it. Above
          Grant, because a question is usually what the row was opened for. */}
      {notes.length > 0 && (
        <>
          <button
            type="button"
            className="admin-panel-label admin-thread-toggle"
            onClick={() => setOpenThread((v) => !v)}
            aria-expanded={openThread}
          >
            <ChevronIcon size={12} className={openThread ? "down" : ""} />
            Thread · {notes.length}
            {/* Folded, the last line stands in: on a queue you are scanning,
                the newest thing said is the thing you are answering. */}
            {!openThread && last && (
              <span className="admin-thread-peek">
                {last.from === "admin" ? "you: " : "them: "}
                {last.text}
              </span>
            )}
          </button>
          {openThread && (
            <div className="admin-thread">
              {notes.map((n, i) => (
                <div key={i} className={"admin-note-line " + n.from}>
                  <span className="admin-note-who">
                    {n.from === "admin" ? "You" : r.user?.given_name || "They"}
                  </span>
                  <span className="admin-note-text">{n.text}</span>
                  <span className="admin-note-at">{ago(n.at)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <form className="admin-reply" onSubmit={sendReply}>
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={600}
          placeholder={notes.length ? "Answer them — this doesn't decide it" : "Say something without deciding it yet"}
          aria-label="Reply on the thread"
        />
        <button type="submit" className="btn ghost small" disabled={replying || !reply.trim()}>
          {replying ? <span className="spin" /> : "Reply"}
        </button>
      </form>

      <div className="admin-panel-label">Grant</div>
      {Object.keys(FEATURES).map((f) => (
        <GrantControl
          key={f}
          feature={f}
          q={current[f]}
          value={grants[f]}
          onChange={(g) => setGrants((all) => ({ ...all, [f]: g }))}
        />
      ))}

      <textarea
        ref={noteRef}
        className="admin-note"
        rows={2}
        maxLength={1000}
        placeholder="Note for them — optional to approve, needed to decline"
        aria-label="Note for them — optional to approve, needed to decline"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (error) setError("");
        }}
      />

      <div className="admin-panel-foot">
        <span className={"admin-preview" + (Object.keys(changes).length ? " on" : "")}>
          {Object.keys(changes).length ? limitsChange(before, after) : "Pick what to grant, or decline."}
        </span>
        <div className="admin-actions">
          <button type="button" className="btn ghost small" onClick={() => resolve("decline")} disabled={Boolean(busy)}>
            {busy === "decline" && <span className="spin" />}
            Decline
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => resolve("approve")}
            disabled={Boolean(busy) || invalid || !Object.keys(changes).length}
          >
            {busy === "approve" && <span className="spin" />}
            Approve
          </button>
        </div>
      </div>

      {error && <Msg kind="err">{error}</Msg>}
    </div>
  );
}

// ---- Users --------------------------------------------------------------------

const USER_FILTERS = [
  ["all", "All"],
  ["out", "Out of uses"],
  ["more", "On more"],
];

function UsersTab() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);

  // Debounced: a keystroke per request would be a request per keystroke.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .adminListUsers(q.trim())
        .then((d) => {
          if (!cancelled) {
            setUsers(d.users || []);
            setError("");
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err.message || "Could not read the users.");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const shown = useMemo(() => {
    if (!users) return null;
    if (filter === "out") return users.filter((u) => isOut(u.quota));
    if (filter === "more") return users.filter((u) => u.custom_limits && !u.quota?.is_admin);
    return users;
  }, [users, filter]);

  function saved(updated) {
    setOpenId(null);
    setUsers((list) => list.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
    emitLimitsChanged();
  }

  return (
    <div className="card admin-list">
      <div className="admin-list-head">
        <input
          type="search"
          className="admin-search"
          placeholder="Search name or email"
          aria-label="Search accounts by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <div className="admin-pills">
          {USER_FILTERS.map(([key, label]) => (
            <button key={key} type="button" className={"pill" + (filter === key ? " active" : "")} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <Msg kind="err">{error}</Msg>}

      {shown === null && !error && (
        <div className="admin-empty">
          <span className="spin" />
          Reading accounts…
        </div>
      )}

      {shown && shown.length === 0 && (
        <div className="admin-empty">{q || filter !== "all" ? "No account matches that." : "No accounts yet."}</div>
      )}

      {shown &&
        shown.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            open={openId === u.id}
            onToggle={() => setOpenId((id) => (id === u.id ? null : u.id))}
            onSaved={saved}
          />
        ))}
    </div>
  );
}

function UserRow({ user: u, open, onToggle, onSaved }) {
  const q = u.quota || {};
  const admin = q.is_admin;

  return (
    <div className={"admin-row" + (open ? " open" : "")}>
      <div className="admin-row-main">
        <Avatar user={u} size={34} />
        <div className="admin-row-body">
          <div className="admin-row-top">
            <span className="admin-name">{u.name || u.email}</span>
            {admin ? (
              <span className="badge low">Admin</span>
            ) : u.pending_request ? (
              <span className="badge mid">Asked</span>
            ) : null}
          </div>
          <div className="admin-email">
            {u.email} · {u.songs} {u.songs === 1 ? "song" : "songs"}
            {u.last_login_at ? ` · last in ${ago(u.last_login_at)}` : ""}
          </div>
        </div>
        <div className="admin-meters">
          {Object.keys(FEATURES).map((f) => (
            <MiniMeter key={f} feature={f} q={q[f]} />
          ))}
        </div>
        {!admin && (
          <button
            type="button"
            className={"icon-btn" + (open ? " active" : "")}
            onClick={onToggle}
            aria-label={open ? "Close" : `Change ${u.name || u.email}'s limits`}
            title="Change limits"
          >
            <PencilIcon size={16} />
          </button>
        )}
      </div>

      {open && <EditPanel user={u} onSaved={onSaved} onCancel={onToggle} />}
    </div>
  );
}

function EditPanel({ user: u, onSaved, onCancel }) {
  const q = u.quota || {};
  const defaults = q.defaults || {};
  const [grants, setGrants] = useState(EVERY_SAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Resets are not a number, so they are counted on their own and left out of
  // the before/after totals — a feature going back to the default is not the
  // same statement as one being set to whatever the default happens to be now.
  const resets = Object.keys(FEATURES).filter((f) => grants[f]?.kind === "default");
  const before = limitsOf(q);
  const after = applyGrants(before, grants);
  const changes = diff(before, after);
  const invalid = Object.values(after).some((v) => v !== null && (!Number.isInteger(v) || v < 0));
  const nothing = !Object.keys(changes).length && !resets.length;

  async function save() {
    setBusy(true);
    setError("");
    try {
      let account = null;
      // Resets first, then the numbers: both return the whole account, so the
      // last response is the one that is current.
      for (const f of resets) {
        account = (await api.adminClearLimit(u.id, f)).user;
      }
      if (Object.keys(changes).length) {
        account = (await api.adminSetLimits(u.id, changes)).user;
      }
      onSaved(account);
    } catch (err) {
      setError(err.message || "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  const summary = [
    Object.keys(changes).length ? limitsChange(before, after) : "",
    resets.length
      ? `${resets.map((f) => FEATURES[f].short.toLowerCase()).join(" and ")} back to the default`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="admin-panel">
      {Object.keys(FEATURES).map((f) => (
        <GrantControl
          key={f}
          feature={f}
          q={q[f]}
          value={grants[f]}
          allowDefault
          fallback={defaults[f] ?? null}
          onChange={(g) => setGrants((all) => ({ ...all, [f]: g }))}
        />
      ))}
      <div className="admin-panel-foot">
        <span className={"admin-preview" + (nothing ? "" : " on")}>
          {nothing ? "Nothing changed yet." : summary}
        </span>
        <div className="admin-actions">
          <button type="button" className="btn ghost small" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn small" onClick={save} disabled={busy || invalid || nothing}>
            {busy && <span className="spin" />}
            Save
          </button>
        </div>
      </div>
      {error && <Msg kind="err">{error}</Msg>}
    </div>
  );
}

// ---- Pieces -------------------------------------------------------------------

// A grant is one of: leave it, add n, make it unlimited, set a total by hand,
// or put it back on the free allowance. The last one is not a number, so it
// travels on its own route (DELETE .../limits/{feature}) and stays out of the
// before/after arithmetic below.
const SAME = { kind: "same" };
const DEFAULT = { kind: "default" };

function applyGrant(limit, g) {
  if (g.kind === "add") return (limit ?? 0) + g.n;
  if (g.kind === "unlimited") return null;
  if (g.kind === "custom") return g.n;
  return limit;
}

// Both panels start with every feature untouched, read the current totals the
// same way, and apply the pills the same way — all three keyed off FEATURES, so
// a new paid limit needs no edit here.
const EVERY_SAME = Object.fromEntries(Object.keys(FEATURES).map((f) => [f, SAME]));

// null is unlimited, and a feature the server didn't mention reads as unlimited
// too rather than as zero.
function limitsOf(quota) {
  return Object.fromEntries(Object.keys(FEATURES).map((f) => [f, quota[f]?.limit ?? null]));
}

function applyGrants(before, grants) {
  return Object.fromEntries(
    Object.keys(FEATURES).map((f) => [f, applyGrant(before[f], grants[f] ?? SAME)])
  );
}

function diff(before, after) {
  const out = {};
  for (const f of Object.keys(FEATURES)) if (before[f] !== after[f]) out[f] = after[f];
  return out;
}

// One row per feature: what's used, then the choices as pills.
function GrantControl({ feature, q, value, onChange, allowDefault = false, fallback = null, bulk = false }) {
  const limit = q?.limit ?? null;
  // A selection has no single current total, so there is no "already unlimited"
  // to read off — and reading the missing one as unlimited would hide the +n
  // pills, which are the whole point of answering several at once.
  const unlimited = !bulk && limit === null;
  const is = (kind, n) => value.kind === kind && (n == null || value.n === n);
  // Only worth offering where it would change something: an account already on
  // the free allowance has nothing to put back.
  const overridden = fallback != null && limit !== fallback;

  return (
    <div className="grant">
      <div className="grant-label">
        <span>{FEATURES[feature].title}</span>
        <span className="grant-used">
          {q ? (unlimited ? `${q.used} used · unlimited` : `${q.used}/${limit} used`) : ""}
        </span>
      </div>
      <div className="grant-options">
        <button type="button" className={"pill" + (is("same") ? " active" : "")} onClick={() => onChange(SAME)}>
          No change
        </button>
        {/* Back to whatever everyone else gets — which is not the same as a
            number, and is why this one does not go through the PATCH. Setting
            today's default by hand would pin the account to that figure after
            FREE_*_LIMIT moved. */}
        {allowDefault && overridden && (
          <button
            type="button"
            className={"pill" + (is("default") ? " active" : "")}
            onClick={() => onChange(DEFAULT)}
          >
            Default ({fallback})
          </button>
        )}
        {!unlimited &&
          PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={"pill" + (is("add", n) ? " active" : "")}
              onClick={() => onChange({ kind: "add", n })}
            >
              +{n}
            </button>
          ))}
        {!unlimited && (
          <button type="button" className={"pill" + (is("unlimited") ? " active" : "")} onClick={() => onChange({ kind: "unlimited" })}>
            Unlimited
          </button>
        )}
        <button
          type="button"
          className={"pill" + (is("custom") ? " active" : "")}
          onClick={() => onChange({ kind: "custom", n: limit ?? q?.used ?? 0 })}
        >
          {unlimited ? "Set a limit" : "Custom"}
        </button>
        {value.kind === "custom" && (
          <input
            type="number"
            className="grant-input"
            min={0}
            step={1}
            inputMode="numeric"
            aria-label={`${FEATURES[feature].title} total`}
            value={value.n}
            autoFocus
            onChange={(e) =>
              onChange({ kind: "custom", n: e.target.value === "" ? 0 : Math.max(0, Math.floor(Number(e.target.value))) })
            }
          />
        )}
      </div>
    </div>
  );
}

// "Reels 3/5" as a chip on a request — red when used up.
function UsageChip({ feature, q }) {
  if (!q) return null;
  const short = FEATURES[feature].short;
  const out = q.limit != null && q.left <= 0;
  return (
    <span className={"usage-chip" + (out ? " out" : "")}>
      {short} {q.limit == null ? `${q.used} · ∞` : `${q.used}/${q.limit}`}
    </span>
  );
}

// One column per paid feature in the users list: a label, used/limit, a 3px bar.
function MiniMeter({ feature, q }) {
  if (!q) return null;
  const short = FEATURES[feature].short;
  const unlimited = q.limit == null;
  const out = !unlimited && q.left <= 0;
  const pct = unlimited ? 0 : q.limit === 0 ? 100 : Math.min(100, (q.used / q.limit) * 100);
  return (
    <div className={"mini-meter" + (out ? " out" : "")}>
      <div className="mini-meter-top">
        <span>{short}</span>
        <span className="mini-meter-count">{unlimited ? "∞" : `${q.used}/${q.limit}`}</span>
      </div>
      {!unlimited && (
        <div className="mini-meter-bar">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function isOut(q) {
  if (!q || q.is_admin) return false;
  return Object.keys(FEATURES).some((f) => q[f] && q[f].limit != null && q[f].left <= 0);
}

// "5m ago", "3h ago", "2d ago" for the recent past; a date after a week.
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}

// ---- The About page ----------------------------------------------------------

/**
 * The editor for /about.
 *
 * Everything that page shows is one document, so this is one form with one
 * Save. There is no per-field patch: the admin is one person who is not racing
 * themselves, and a form that saved as you typed would make "reset" mean
 * nothing.
 *
 * `enabled` and `in_nav` are two switches rather than one because they are two
 * different decisions. Taking the rail entry down is tidying; taking the page
 * down breaks a URL that may already be sitting in a résumé, and the app should
 * make you say which one you meant.
 */

const LINK_KINDS = ["email", "github", "linkedin", "resume", "site"];

function AboutTab() {
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.adminGetAbout();
      setDraft(data.about);
      setSaved(JSON.stringify(data.about));
      setError("");
    } catch (err) {
      setError(err.message || "Could not read the About page.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = draft != null && JSON.stringify(draft) !== saved;

  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setSection(index, key, value) {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, i) => (i === index ? { ...s, [key]: value } : s)),
    }));
  }

  function moveSection(index, delta) {
    const to = index + delta;
    setDraft((d) => {
      if (to < 0 || to >= d.sections.length) return d;
      const sections = [...d.sections];
      [sections[index], sections[to]] = [sections[to], sections[index]];
      return { ...d, sections };
    });
  }

  function addSection() {
    setDraft((d) => ({
      ...d,
      // The id is what React keys on and what survives a reorder, so it has to
      // be unique rather than the index it happens to start at.
      sections: [...d.sections, { id: `s${Date.now()}`, heading: "", body: "" }],
    }));
  }

  function removeSection(index) {
    setDraft((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== index) }));
  }

  function setLink(index, key, value) {
    setDraft((d) => ({
      ...d,
      links: d.links.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
    }));
  }

  function addLink() {
    setDraft((d) => ({ ...d, links: [...d.links, { kind: "site", label: "", value: "" }] }));
  }

  function removeLink(index) {
    setDraft((d) => ({ ...d, links: d.links.filter((_, i) => i !== index) }));
  }

  async function save() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const data = await api.adminSaveAbout(draft);
      setDraft(data.about);
      setSaved(JSON.stringify(data.about));
      setNote("Saved. The page is showing this now.");
      // The rail, the phone sheet and the account menu all read the same
      // document — tell them rather than making the editor reload to find out.
      emitAboutChanged();
    } catch (err) {
      setError(err.message || "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setResetting(false);
    setBusy(true);
    setError("");
    try {
      const data = await api.adminResetAbout();
      setDraft(data.about);
      setSaved(JSON.stringify(data.about));
      setNote("Back to the copy it shipped with.");
      emitAboutChanged();
    } catch (err) {
      setError(err.message || "Could not reset that.");
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <div className="card admin-list">
        {error ? (
          <Msg kind="err">{error}</Msg>
        ) : (
          <div className="admin-empty">
            <span className="spin" />
            Reading the page…
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="card about-edit">
        <div className="mhead">Switches</div>
        <Switch
          checked={draft.enabled}
          onChange={(v) => set("enabled", v)}
          label="The page is live"
          sub="Off, /about answers Not found and the message box stops taking anything — including from a link somebody already has."
        />
        <Switch
          checked={draft.in_nav}
          onChange={(v) => set("in_nav", v)}
          label="Show it in the rail"
          sub="Off, the entry disappears from the rail, the phone sheet and the account menu. The page itself keeps working at its URL."
          disabled={!draft.enabled}
        />
      </div>

      <div className="card about-edit">
        <div className="mhead">Wording</div>
        <Field label="Page title" value={draft.title} onChange={(v) => set("title", v)} max={80} />
        <Field
          label="The line under it"
          value={draft.subtitle}
          onChange={(v) => set("subtitle", v)}
          max={300}
        />
        <div className="about-edit-pair">
          <Field
            label="Rail label"
            value={draft.nav_label}
            onChange={(v) => set("nav_label", v)}
            max={30}
          />
          <Field
            label="Collapsed rail"
            value={draft.nav_mini_label}
            onChange={(v) => set("nav_mini_label", v)}
            max={12}
            hint="One short word — it sits under a 22px icon in 72px."
          />
        </div>
      </div>

      <div className="card about-edit">
        <div className="about-edit-head">
          <div className="mhead">Sections</div>
          <button type="button" className="btn ghost small" onClick={addSection}>
            <PlusIcon size={14} />
            Add one
          </button>
        </div>
        <p className="hint about-edit-note">
          A blank line starts a new paragraph. That is all the formatting there is — no
          Markdown, no HTML, so nothing you paste can break the page.
        </p>

        {draft.sections.length === 0 && (
          <div className="admin-empty">
            <div>No sections. The page would be a title and nothing else.</div>
          </div>
        )}

        {draft.sections.map((section, i) => (
          <div className="about-edit-section" key={section.id || i}>
            <div className="about-edit-section-head">
              <input
                type="text"
                value={section.heading}
                onChange={(e) => setSection(i, "heading", e.target.value)}
                placeholder="Heading"
                aria-label={`Heading for section ${i + 1}`}
                maxLength={120}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => moveSection(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                title="Move up"
              >
                <span className="about-edit-arrow up">
                  <ChevronIcon size={15} />
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => moveSection(i, 1)}
                disabled={i === draft.sections.length - 1}
                aria-label="Move down"
                title="Move down"
              >
                <span className="about-edit-arrow down">
                  <ChevronIcon size={15} />
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => removeSection(i)}
                aria-label="Remove this section"
                title="Remove this section"
              >
                <TrashIcon size={15} />
              </button>
            </div>
            <textarea
              value={section.body}
              onChange={(e) => setSection(i, "body", e.target.value)}
              rows={7}
              maxLength={4000}
              placeholder="What this section says."
              aria-label={`Body of section ${i + 1}`}
            />
          </div>
        ))}
      </div>

      <div className="card about-edit">
        <div className="about-edit-head">
          <div className="mhead">Links</div>
          <button type="button" className="btn ghost small" onClick={addLink}>
            <PlusIcon size={14} />
            Add one
          </button>
        </div>
        <p className="hint about-edit-note">
          A link with nothing in it simply isn&apos;t shown — which is how the résumé
          button stays off the page until there&apos;s a URL to put behind it.
        </p>

        {draft.links.map((link, i) => (
          <div className="about-edit-link" key={i}>
            <select
              value={link.kind}
              onChange={(e) => setLink(i, "kind", e.target.value)}
              aria-label={`What link ${i + 1} is`}
            >
              {LINK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="about-edit-link-label"
              value={link.label}
              onChange={(e) => setLink(i, "label", e.target.value)}
              placeholder="Label"
              aria-label={`Label for link ${i + 1}`}
              maxLength={40}
            />
            <input
              type="text"
              value={link.value}
              onChange={(e) => setLink(i, "value", e.target.value)}
              placeholder={link.kind === "email" ? "you@example.com" : "https://…"}
              aria-label={`Address for link ${i + 1}`}
              maxLength={500}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => removeLink(i)}
              aria-label="Remove this link"
              title="Remove this link"
            >
              <TrashIcon size={15} />
            </button>
          </div>
        ))}
      </div>

      <div className="card about-edit">
        <div className="mhead">The message box</div>
        <Switch
          checked={draft.contact_enabled}
          onChange={(v) => set("contact_enabled", v)}
          label="People can write in from the page"
          sub="Off, the form goes and the route behind it stops accepting anything."
        />
        <Field
          label="Heading"
          value={draft.contact_heading}
          onChange={(v) => set("contact_heading", v)}
          max={80}
        />
        <Field
          label="The line under the box"
          value={draft.contact_hint}
          onChange={(v) => set("contact_hint", v)}
          max={300}
        />
        <Field
          label="What it says once sent"
          value={draft.contact_sent}
          onChange={(v) => set("contact_sent", v)}
          max={300}
        />
      </div>

      {error && <Msg kind="err">{error}</Msg>}
      {/* Only while clean: the moment anything changes, "Saved" stops being
          true, and that includes a reorder no setter above runs through. */}
      {note && !dirty && !error && <Msg kind="ok">{note}</Msg>}

      <div className="about-edit-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => setResetting(true)}
          disabled={busy}
        >
          Reset to default
        </button>
        <Link to="/about" className="btn ghost" target="_blank" rel="noopener">
          Preview
        </Link>
        <button type="button" className="btn" onClick={save} disabled={busy || !dirty}>
          {busy ? <span className="spin" /> : null}
          {dirty ? "Save" : "Saved"}
        </button>
      </div>

      {resetting && (
        <ConfirmModal
          title="Reset the About page"
          message="Every word on it goes back to the copy the app shipped with. Whatever is there now is lost."
          confirmLabel="Reset"
          onConfirm={reset}
          onClose={() => setResetting(false)}
        />
      )}
    </>
  );
}

function Field({ label, value, onChange, max, hint }) {
  return (
    <label className="about-edit-field">
      <span className="about-edit-label">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
      />
      {hint && <span className="about-edit-hint">{hint}</span>}
    </label>
  );
}

// A real switch rather than a checkbox: these two turn a public page on and
// off, and the state has to be readable at a glance from across the form.
function Switch({ checked, onChange, label, sub, disabled }) {
  return (
    <div className={"about-switch" + (disabled ? " disabled" : "")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={"about-switch-track" + (checked ? " on" : "")}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="about-switch-knob" />
      </button>
      <div className="about-switch-text">
        <div className="about-switch-label">{label}</div>
        <div className="about-switch-sub">{sub}</div>
      </div>
    </div>
  );
}

// ---- Messages from the About page --------------------------------------------

// Like feedback, but from people who mostly have no account here — so the name
// and the address are what they typed, and the only thing to do with one is
// answer it in a mail client.

function MessagesTab({ onCount }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.adminListContact();
      setRows(data.messages || []);
      setError("");
      onCount((data.messages || []).length);
    } catch (err) {
      setError(err.message || "Could not read the messages.");
    }
  }, [onCount]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    const row = deleting;
    setDeleting(null);
    try {
      await api.adminDeleteContact(row.id);
      setRows((current) => current.filter((r) => r.id !== row.id));
      onCount((rows || []).length - 1);
    } catch (err) {
      setError(err.message || "Could not delete that.");
    }
  }

  return (
    <>
      <div className="card admin-list">
        <div className="admin-list-head">
          <span className="admin-list-title">
            {rows ? `${rows.length} ${rows.length === 1 ? "message" : "messages"}` : "Messages"}
          </span>
        </div>

        {error && <Msg kind="err">{error}</Msg>}

        {rows === null && !error && (
          <div className="admin-empty">
            <span className="spin" />
            Reading messages…
          </div>
        )}

        {rows && rows.length === 0 && (
          <div className="admin-empty">
            <MailIcon size={26} />
            <div>Nobody has written in yet.</div>
            <div className="admin-empty-sub">
              The box is at the foot of the About page, and anyone can use it — no account
              needed.
            </div>
          </div>
        )}

        {rows &&
          rows.map((m) => (
            <div key={m.id} className="admin-row">
              <div className="admin-row-main">
                <div className="admin-row-body">
                  <div className="admin-row-top">
                    <span className="admin-name">{m.name}</span>
                    {m.signed_in && <span className="badge low">has an account</span>}
                    <span className="admin-time">{ago(m.created_at)}</span>
                  </div>
                  <div className="admin-email">{m.email}</div>
                  <div className="admin-row-message full">{m.message}</div>
                </div>
                <a
                  className="icon-btn"
                  href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your note from Reelody")}`}
                  aria-label={`Reply to ${m.name}`}
                  title="Reply"
                >
                  <MailIcon size={16} />
                </a>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDeleting(m)}
                  aria-label="Delete this message"
                  title="Delete this message"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          ))}
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete message"
          message={`Delete what ${deleting.name} wrote? They won't be told, and there's no copy.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// ---- Notes from /support -----------------------------------------------------

// Words only. A payment never arrives here, so the tab doesn't pretend to be
// a ledger — there is nothing to reconcile and nobody to write back to.

function SupportTab({ onCount }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.adminListSupportNotes();
      setRows(data.notes || []);
      setError("");
      onCount((data.notes || []).length);
    } catch (err) {
      setError(err.message || "Could not read the notes.");
    }
  }, [onCount]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    const row = deleting;
    setDeleting(null);
    try {
      await api.adminDeleteSupportNote(row.id);
      setRows((current) => current.filter((r) => r.id !== row.id));
      onCount((rows || []).length - 1);
    } catch (err) {
      setError(err.message || "Could not delete that.");
    }
  }

  return (
    <>
      <div className="card admin-list">
        <div className="admin-list-head">
          <span className="admin-list-title">
            {rows ? `${rows.length} ${rows.length === 1 ? "note" : "notes"}` : "Support"}
          </span>
          <span className="admin-list-sub">Notes only — a payment never shows up here.</span>
        </div>

        {error && <Msg kind="err">{error}</Msg>}

        {rows === null && !error && (
          <div className="admin-empty">
            <span className="spin" />
            Reading notes…
          </div>
        )}

        {rows && rows.length === 0 && (
          <div className="admin-empty">
            <CoffeeIcon size={26} />
            <div>No notes yet.</div>
            <div className="admin-empty-sub">
              The box is on the support page, next to the code. Anyone can leave one.
            </div>
          </div>
        )}

        {rows &&
          rows.map((n) => (
            <div key={n.id} className="admin-row">
              <div className="admin-row-main">
                {n.user ? <Avatar user={n.user} size={34} /> : <span className="admin-anon" />}
                <div className="admin-row-body">
                  <div className="admin-row-top">
                    <span className="admin-name">
                      {n.user?.name || (n.signed_in ? "Deleted account" : "No account")}
                    </span>
                    <span className="admin-time">{ago(n.created_at)}</span>
                  </div>
                  {n.user?.email && <div className="admin-email">{n.user.email}</div>}
                  <div className="admin-row-message full">{n.message}</div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDeleting(n)}
                  aria-label="Delete this note"
                  title="Delete this note"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          ))}
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete note"
          message={`Delete what ${deleting.user?.name || "this person"} wrote? They won't be told, and there's no copy.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
