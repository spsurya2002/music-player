import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api/client";
import Avatar from "../components/Avatar";
import Msg from "../components/Msg";
import { FEATURES, limitsChange } from "../components/Quota";
import ConfirmModal from "../components/ConfirmModal";
import { ChevronIcon, FeedbackIcon, PencilIcon, ShieldIcon, StarIcon, TrashIcon } from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { emitLimitsChanged } from "../utils/bus";
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
        Answer requests for more, change anyone's limits, or read what people think of
        the app. Limits are lifetime totals.
      </p>

      <div className="mode-tabs" role="tablist">
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
      </div>

      {tab === "requests" && <RequestsTab onPendingCount={setPendingCount} />}
      {tab === "users" && <UsersTab />}
      {tab === "feedback" && <FeedbackTab onCount={setFeedbackCount} />}
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
        </div>
      </div>

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
            onToggle={() => setOpenId((id) => (id === r.id ? null : r.id))}
            onResolved={resolved}
            onNoted={(next) => setRows((all) => all.map((x) => (x.id === next.id ? next : x)))}
          />
        ))}
    </div>
  );
}

function RequestRow({ request: r, open, onToggle, onResolved, onNoted }) {
  const pending = r.state === "pending";
  const current = r.user?.quota || {};
  const notes = r.notes || [];
  // A question nobody has answered. Worth a mark on the closed row, because
  // the sender is waiting on a sentence rather than on the decision.
  const asked = notes.length > 0 && notes[notes.length - 1].from === "user";

  return (
    <div className={"admin-row" + (open ? " open" : "")}>
      <div className="admin-row-main">
        <Avatar user={r.user} size={34} />
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
        {pending && (
          <button type="button" className={"btn small " + (open ? "ghost" : "secondary")} onClick={onToggle}>
            {open ? "Close" : "Respond"}
          </button>
        )}
      </div>

      {pending && open && (
        <RespondPanel request={r} onResolved={onResolved} onNoted={onNoted} />
      )}
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
  const [grants, setGrants] = useState(EVERY_SAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const before = limitsOf(q);
  const after = applyGrants(before, grants);
  const changes = diff(before, after);
  const invalid = Object.values(after).some((v) => v !== null && (!Number.isInteger(v) || v < 0));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const data = await api.adminSetLimits(u.id, changes);
      onSaved(data.user);
    } catch (err) {
      setError(err.message || "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel">
      {Object.keys(FEATURES).map((f) => (
        <GrantControl
          key={f}
          feature={f}
          q={q[f]}
          value={grants[f]}
          onChange={(g) => setGrants((all) => ({ ...all, [f]: g }))}
        />
      ))}
      <div className="admin-panel-foot">
        <span className={"admin-preview" + (Object.keys(changes).length ? " on" : "")}>
          {Object.keys(changes).length ? limitsChange(before, after) : "Nothing changed yet."}
        </span>
        <div className="admin-actions">
          <button type="button" className="btn ghost small" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn small" onClick={save} disabled={busy || invalid || !Object.keys(changes).length}>
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

// A grant is one of: leave it, add n, make it unlimited, or set a total by hand.
const SAME = { kind: "same" };

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
function GrantControl({ feature, q, value, onChange }) {
  const limit = q?.limit ?? null;
  const unlimited = limit === null;
  const is = (kind, n) => value.kind === kind && (n == null || value.n === n);

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
