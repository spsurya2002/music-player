import { Link } from "react-router-dom";
import * as api from "../api/client";
import { useAuth } from "../context/AuthContext";
import Msg from "./Msg";
import "./Quota.css";

// The three paid features and how they're named everywhere in the UI. The
// server's sentences use the same words ("reel extractions", "file lookups",
// "lyric lookups"), so these must keep matching backend/services/quota.py.
// `short` is for the admin chips and mini-meters, where there is room for one
// word and the full title would wrap.
export const FEATURES = {
  reel: { title: "Reel → MP3", short: "Reels", unit: "reel extraction", units: "reel extractions" },
  file: { title: "File → YouTube", short: "Files", unit: "file lookup", units: "file lookups" },
  lyrics: { title: "Song → Meaning", short: "Lyrics", unit: "lyric lookup", units: "lyric lookups" },
};

// "3 of 5 reel extractions left · Ask for more", under the form that spends
// them. Says nothing for an unlimited account — a meter that never moves is
// just noise on the one page where the form matters.
export function QuotaNote({ feature }) {
  const { quota } = useAuth();
  const q = quota && quota[feature];
  if (!q || q.limit == null) return null;
  const names = FEATURES[feature];
  const out = q.left <= 0;

  return (
    <div className={"quota-note" + (out ? " out" : "")}>
      {out
        ? `All ${q.limit} ${q.limit === 1 ? names.unit : names.units} used.`
        : `${q.left} of ${q.limit} ${q.limit === 1 ? names.unit : names.units} left.`}{" "}
      <Link to="/plan" className="ext-link">
        {out ? "Ask for more" : "Plan"}
      </Link>
    </div>
  );
}

// An error from the API, with the way out when the reason is a used-up limit.
// Takes the ApiError itself (not just its message) so it can tell.
export function ErrorMsg({ error }) {
  if (!error) return null;
  const message = error.message || String(error);
  return (
    <Msg kind="err">
      {message}
      {api.isQuotaError(error) && (
        <>
          {" "}
          <Link to="/plan" className="ext-link quota-link">
            Ask for more
          </Link>
        </>
      )}
    </Msg>
  );
}

// One feature's allowance as a bar: used against the limit, or "Unlimited".
export function QuotaMeter({ feature, q, compact = false }) {
  const names = FEATURES[feature];
  if (!q) return null;
  const unlimited = q.limit == null;
  const pct = unlimited || q.limit === 0 ? (unlimited ? 0 : 100) : Math.min(100, (q.used / q.limit) * 100);
  const out = !unlimited && q.left <= 0;

  return (
    <div className={"card quota-meter" + (compact ? " compact" : "")}>
      <div className="quota-meter-head">
        <span className="quota-meter-title">{names.title}</span>
        <span className={"quota-meter-count" + (out ? " out" : "")}>
          {unlimited ? "Unlimited" : `${q.used} / ${q.limit}`}
        </span>
      </div>
      <div className="quota-bar" aria-hidden="true">
        <div className={"quota-bar-fill" + (out ? " out" : "")} style={{ width: `${pct}%` }} />
      </div>
      <div className="quota-meter-sub">
        {unlimited
          ? `${q.used} used so far`
          : out
            ? "None left"
            : `${q.left} left`}
      </div>
    </div>
  );
}

function fmtLimit(n) {
  return n == null ? "unlimited" : String(n);
}

// "Reel → MP3 5 → 25 · File → YouTube 5 → unlimited". Only what moved is worth a
// line; an approval that changed nothing says so.
export function limitsChange(before, after) {
  const parts = Object.keys(FEATURES)
    .filter((f) => before[f] !== after[f])
    .map((f) => `${FEATURES[f].title} ${fmtLimit(before[f])} → ${fmtLimit(after[f])}`);
  return parts.length ? parts.join(" · ") : "Limits left as they were.";
}
