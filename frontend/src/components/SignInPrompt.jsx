import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Msg from "./Msg";
import "./SignInPrompt.css";

// What a signed-out visitor gets where a view's content would be. The shell
// stays up around it — rail, brand, player bar — so the app is something you
// can look at and understand before it asks you for anything. Bouncing straight
// to a full-screen login told visitors nothing about what they'd be signing
// into.
//
// It carries the page's own reason rather than one generic sentence: "sign in
// to see your library" on All songs, "to keep what you extract" on Add music.
// A prompt that says the same thing everywhere reads as a wall, not an answer.
export default function SignInPrompt({ icon, title, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { notice } = useAuth();

  return (
    <div className="signin-prompt">
      {icon && <div className="signin-prompt-icon">{icon}</div>}
      <h2 className="signin-prompt-title">{title}</h2>
      <p className="signin-prompt-line">{children}</p>
      {/* A session that ended on its own has to say so here. Nothing takes you
          to the login screen any more, so this is the only place that answer
          can reach you. */}
      {notice && <Msg kind="info">{notice}</Msg>}
      <button
        type="button"
        className="btn"
        // Where they were is carried along so signing in returns them to it
        // rather than dropping them on the home page.
        // pathname + search, not pathname alone: the Android share target
        // carries the reel in its query string, and dropping it would lose the
        // very thing they came to save.
        onClick={() =>
          navigate("/login", { state: { from: location.pathname + location.search } })
        }
      >
        Sign in
      </button>
    </div>
  );
}
