import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { APP_NAME, BrandMark } from "../components/Brand";
import Msg from "../components/Msg";
import { useAuth } from "../context/AuthContext";
import useGoogleSignIn from "../hooks/useGoogleSignIn";
import "./LoginView.css";

// The one route outside the shell — no sidebar, no player bar — because signing
// in is the only thing on it. It is somewhere you choose to go now (from the
// rail, or from a page's own prompt), not a wall the app puts up before it will
// show you anything, so it returns you to whatever you were looking at.
export default function LoginView() {
  const { signIn, notice, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  // Where the prompt that sent them here was. Falls back to the home page for
  // anyone who typed /login themselves.
  const from = location.state?.from || "/";

  // Signing in is what ends this screen, in either direction: the moment there
  // is a user — from the button below, or because they were already signed in
  // and opened /login by hand — they go back to what they were doing.
  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  async function handleCredential(credential) {
    if (!credential) {
      setError("Google didn't return a sign-in — try that once more.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signIn(credential);
      // Nothing to do on success: the user landing in context fires the effect
      // above, which sends them back where they came from.
    } catch (err) {
      setError(err.message || "That sign-in didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  const { buttonRef, ready, configured, error: gisError } = useGoogleSignIn(handleCredential);

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-word">
          <BrandMark size={32} />
          <span>{APP_NAME}</span>
        </div>
        <h1 className="login-title">Your reels, as a music library.</h1>
        <p className="login-sub">
          Paste an Instagram reel, keep the MP3, file it into playlists and play it without
          leaving the page. Sign in and it's all yours — your songs, your playlists, your
          play counts.
        </p>

        <div className="login-action">
          {/* Google draws its own button in here — its branding rules don't
              allow a hand-rolled one. */}
          <div ref={buttonRef} className="login-gbtn" />
          {busy && (
            <div className="login-busy">
              <span className="spin" />
              Signing you in…
            </div>
          )}
          {!ready && configured && !gisError && !busy && (
            <div className="login-busy">
              <span className="spin" />
              Loading Google sign-in…
            </div>
          )}
        </div>

        {notice && !error && <Msg kind="info">{notice}</Msg>}
        {error && <Msg kind="err">{error}</Msg>}
        {gisError && <Msg kind="err">{gisError}</Msg>}

        {!configured && (
          <Msg kind="info">
            This server has no Google client ID yet. Create an OAuth client ID for a web
            application in the Google Cloud console, add this address as an authorised
            JavaScript origin, then start the app with GOOGLE_CLIENT_ID set — the README
            has the four steps.
          </Msg>
        )}

        <p className="login-back">
          <Link to={from}>Back to the app</Link>
        </p>

        <p className="login-fine">
          Google tells us your name, email address and profile picture. That's all that's
          stored about you, and it's only used to label your library.
        </p>
      </div>
    </div>
  );
}
