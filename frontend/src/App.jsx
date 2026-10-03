import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PlayerProvider } from "./context/PlayerContext";
import Shell from "./Shell";
import LoginView from "./views/LoginView";

// PlayerProvider wraps the router so player state (queue, current track,
// playback position) is anchored above any routing concern — even a full
// remount of the router tree wouldn't touch it. Shell then renders the
// PlayerBar as a sibling of <Routes>, which is what actually keeps it on
// screen and playing across navigation.
//
// AuthProvider sits above all of it: the profile it holds labels the rail and
// decides which views can show their contents, and the player must survive a
// sign-in without being rebuilt.
export default function App() {
  return (
    <AuthProvider>
      <PlayerProvider>
        <BrowserRouter>
          <Boot />
        </BrowserRouter>
      </PlayerProvider>
    </AuthProvider>
  );
}

// The shell renders for everyone, signed in or not. Being signed out is a state
// of the app, not a different app: a visitor gets the rail, the page they asked
// for and its title, with a sign-in prompt where that page's contents would be
// (see Shell's <Gated>). Swapping the whole app for a login screen asked people
// to commit before they had seen anything at all.
//
// /login is the one route outside the shell — a single centred card, no rail and
// no player bar, because signing in is the only thing on it.
function Boot() {
  const { loading } = useAuth();

  // One /auth/me call decides whether the rail greets someone or offers to sign
  // them in. It is quick, and rendering the signed-out rail first would flash
  // "Sign in" at somebody who already is.
  if (loading) {
    return (
      <div className="boot">
        <span className="spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginView />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
