import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "../components/Avatar";
import Msg from "../components/Msg";
import { FEATURES, QuotaMeter } from "../components/Quota";
import { SignOutIcon } from "../components/icons";
import { useAuth } from "../context/AuthContext";
import "./AccountView.css";

// What the app knows about you, and the button that ends the session. The counts
// come from /api/auth/me so they're the server's numbers, not a tally kept in
// the browser — a song saved on a phone shows up here.
export default function AccountView() {
  const { user, stats, quota, isAdmin, signOut, refreshStats } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  async function handleSignOut() {
    setBusy(true);
    setError("");
    try {
      await signOut();
    } catch (err) {
      setError(err.message || "Signing out didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view">
      <h1 className="page-title">Account</h1>
      <p className="sub">The library on this server is yours alone.</p>

      <div className="card account-card">
        <Avatar user={user} size={56} />
        <div className="account-who">
          <div className="account-name">{user?.name || "Signed in"}</div>
          <div className="account-email">{user?.email}</div>
          {user?.created_at && (
            <div className="account-since">
              Here since {new Date(user.created_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      <div className="account-stats">
        <Stat label="Songs" value={stats?.songs} />
        <Stat label="Playlists" value={stats?.playlists} />
        <Stat label="Plays" value={stats?.plays} />
      </div>

      {/* Yours to spend and ask more of. An admin has no limits, so for them
          this would only ever say "Unlimited" twice. */}
      {quota && !isAdmin && (
        <div className="account-plan">
          <div className="account-plan-head">
            <div className="mhead">Limits</div>
            <Link to="/plan" className="btn ghost small">
              Request more
            </Link>
          </div>
          <div className="quota-meters">
            {Object.keys(FEATURES).map((f) => (
              <QuotaMeter key={f} feature={f} q={quota[f]} compact />
            ))}
          </div>
        </div>
      )}

      <div className="card account-out">
        <div>
          <div className="account-out-title">Sign out</div>
          <div className="account-out-sub">
            Ends this session on this browser. Nothing in your library is touched, and
            whatever is playing stops.
          </div>
        </div>
        <button className="btn ghost" onClick={handleSignOut} disabled={busy}>
          {busy ? <span className="spin" /> : <SignOutIcon size={16} />}
          <span className="account-out-label">Sign out</span>
        </button>
      </div>

      {error && <Msg kind="err">{error}</Msg>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card account-stat">
      {/* An em dash while the numbers load — a 0 that turns into 37 reads as the
          library having been empty for a moment. */}
      <div className="account-stat-value">{value == null ? "—" : value}</div>
      <div className="account-stat-label">{label}</div>
    </div>
  );
}
