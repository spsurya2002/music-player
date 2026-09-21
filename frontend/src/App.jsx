import { BrowserRouter } from "react-router-dom";
import { PlayerProvider } from "./context/PlayerContext";
import Shell from "./Shell";

// PlayerProvider wraps the router so player state (queue, current track,
// playback position) is anchored above any routing concern — even a full
// remount of the router tree wouldn't touch it. Shell then renders the
// PlayerBar as a sibling of <Routes>, which is what actually keeps it on
// screen and playing across navigation.
export default function App() {
  return (
    <PlayerProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </PlayerProvider>
  );
}
