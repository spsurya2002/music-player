import { useCallback, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import MobileTabs from "./components/MobileTabs";
import PlayerBar from "./components/PlayerBar";
import QueuePanel from "./components/QueuePanel";
import YouTubePlayer from "./components/YouTubePlayer";
import { usePlayer } from "./context/PlayerContext";
import { useAuth } from "./context/AuthContext";
import SignInPrompt from "./components/SignInPrompt";
import { PlusIcon, LibraryIcon, LyricsIcon, PlaylistIcon, InboxIcon, UserIcon, GaugeIcon, ShieldIcon } from "./components/icons";
import useGlobalShortcuts from "./hooks/useGlobalShortcuts";
import SearchView from "./views/SearchView";
import AllSongsView from "./views/AllSongsView";
import LyricsView from "./views/LyricsView";
import LyricsDetailView from "./views/LyricsDetailView";
import LyricsLibraryView from "./views/LyricsLibraryView";
import LyricsAllView from "./views/LyricsAllView";
import LyricsCollectionView from "./views/LyricsCollectionView";
import SongDetailView from "./views/SongDetailView";
import PlaylistsView from "./views/PlaylistsView";
import PlaylistDetailView from "./views/PlaylistDetailView";
import SharedView from "./views/SharedView";
import SharedPlaylistView from "./views/SharedPlaylistView";
import IdentifyView from "./views/IdentifyView";
import InboxView from "./views/InboxView";
import ShareTargetView from "./views/ShareTargetView";
import AccountView from "./views/AccountView";
import PlanView from "./views/PlanView";
import AdminView from "./views/AdminView";
import "./Shell.css";

// Sidebar, PlayerBar, QueuePanel and the YouTube modal all live here, as
// siblings of <Routes> rather than inside it — navigating between views only
// ever swaps the <Routes> subtree, so the audio element (owned by
// PlayerProvider, above this whole component) and the bar that controls it
// never unmount.
const RAIL_KEY = "rail-mini";

export default function Shell() {
  const { queueOpen } = usePlayer();
  useGlobalShortcuts();

  // Collapsed or not, remembered per browser. Layout state, not app state —
  // nothing on the server cares, and it should survive a reload the way the
  // same toggle does everywhere else that has one.
  const [mini, setMini] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleRail = useCallback(() => {
    setMini((v) => {
      try {
        localStorage.setItem(RAIL_KEY, v ? "0" : "1");
      } catch {
        // A browser refusing storage still gets a working toggle; it just
        // forgets the choice on reload.
      }
      return !v;
    });
  }, []);

  return (
    <div className={"shell" + (mini ? " rail-mini" : "")}>
      <TopBar onToggleRail={toggleRail} />
      <Sidebar mini={mini} />
      <MobileTabs />
      <main className="shell-content">
        <Routes>
          {/* Home is the shared feed, and it is the one part of the app with no
              <Gated> around it: something to look at on arrival, made by people
              rather than by you, whether or not you have an account. A landing
              page that opened on an empty form asked for work before it had
              shown you anything worth doing. */}
          <Route path="/" element={<SharedView />} />
          <Route
            path="/add/reel"
            element={
              <Gated
                icon={<PlusIcon size={34} />}
                title="Turn a reel into a song you keep"
                line="Paste a link and Reelody pulls out the audio, works out what the song is and files it in your library. Sign in and that library is yours."
              >
                <SearchView />
              </Gated>
            }
          />
          <Route
            path="/add/file"
            element={
              <Gated
                icon={<PlusIcon size={34} />}
                title="Find out what a song is"
                line="Upload audio from anywhere and Reelody tells you the track behind it and where it is on YouTube. Sign in to run one and keep the result."
              >
                <IdentifyView />
              </Gated>
            }
          />
          {/* The old paths, kept working: /identify was in the README and the
              sidebar for long enough to be bookmarked, and /shared is what every
              share link in the app still points at. */}
          <Route path="/identify" element={<Navigate to="/add/file" replace />} />
          {/* /add was the reel route before the pair was made symmetric, and it
              is what the home page CTA and the README both pointed at. */}
          <Route path="/add" element={<Navigate to="/add/reel" replace />} />
          <Route path="/inbox" element={<Navigate to="/imports" replace />} />
          <Route path="/shared" element={<Navigate to="/" replace />} />
          <Route
            path="/songs"
            element={
              <Gated
                icon={<LibraryIcon size={34} />}
                title="Your songs live here"
                line="Everything you save lands in All songs — searchable, sortable and yours. Sign in to see it."
              >
                <AllSongsView />
              </Gated>
            }
          />
          <Route path="/songs/:id" element={<Gated {...GATE.song}><SongDetailView /></Gated>} />
          {/* Static before dynamic, or /lyrics/saved would be read as an id. */}
          <Route
            path="/lyrics/saved"
            element={
              <Gated
                icon={<LyricsIcon size={34} />}
                title="Your saved lyrics live here"
                line="Every lookup is kept against your account, so reading one again is free. Sign in to see yours."
              >
                <LyricsLibraryView />
              </Gated>
            }
          />
          <Route
            path="/lyrics/all"
            element={
              <Gated
                icon={<LyricsIcon size={34} />}
                title="Your saved lyrics live here"
                line="Every lookup is kept against your account, so reading one again is free. Sign in to see yours."
              >
                <LyricsAllView />
              </Gated>
            }
          />
          <Route
            path="/lyrics/collections/:id"
            element={<Gated {...GATE.lyrics}><LyricsCollectionView /></Gated>}
          />
          <Route
            path="/lyrics/:id"
            element={<Gated {...GATE.lyrics}><LyricsDetailView /></Gated>}
          />
          <Route
            path="/lyrics"
            element={
              <Gated
                icon={<LyricsIcon size={34} />}
                title="Lyrics live with an account"
                line="A lookup costs a little, so the count is kept against your account — and so is what it finds, which means you only pay for a song once."
              >
                <LyricsView />
              </Gated>
            }
          />
          <Route
            path="/playlists"
            element={
              <Gated
                icon={<PlaylistIcon size={34} />}
                title="Group your songs your way"
                line="Build playlists from anything you've saved, each with its own loop setting. Sign in to make one."
              >
                <PlaylistsView />
              </Gated>
            }
          />
          <Route path="/playlists/:id" element={<Gated {...GATE.playlist}><PlaylistDetailView /></Gated>} />
          {/* One shared playlist. Kept off /playlists so a link to one can never
              be mistaken for a link to your own. */}
          <Route path="/shared/:id" element={<SharedPlaylistView />} />
          <Route
            path="/imports"
            element={
              <Gated
                icon={<InboxIcon size={34} />}
                title="Reels you shared from your phone"
                line="Share a reel to Reelody from Instagram and it turns up in your library on its own. Imports is where you watch that happen."
              >
                <InboxView />
              </Gated>
            }
          />
          {/* Where Android drops a reel shared from Instagram — see
              public/manifest.webmanifest. */}
          <Route path="/share" element={<Gated {...GATE.share}><ShareTargetView /></Gated>} />
          <Route
            path="/account"
            element={
              <Gated
                icon={<UserIcon size={34} />}
                title="No account yet"
                line="Sign in with Google and this page shows who you are, how big your library has got and the way back out."
              >
                <AccountView />
              </Gated>
            }
          />
          <Route
            path="/plan"
            element={
              <Gated
                icon={<GaugeIcon size={34} />}
                title="Your plan and limits"
                line="Every account gets a few reel extractions and file lookups free, and can ask for more. Sign in to see what's left of yours."
              >
                <PlanView />
              </Gated>
            }
          />
          {/* AdminView answers anyone who isn't an admin with Not found, the
              same as the API behind it does. */}
          <Route
            path="/admin"
            element={
              <Gated
                icon={<ShieldIcon size={34} />}
                title="Sign in to continue"
                line="This page needs an account."
              >
                <AdminView />
              </Gated>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {queueOpen && <QueuePanel />}
      <PlayerBar />
      <YouTubePlayer />
    </div>
  );
}

// The copy for the routes you only ever arrive at from somewhere else — a song
// or playlist by id, the Android share target. Nobody lands on these cold, so
// they get the plain reason rather than a pitch.
const GATE = {
  lyrics: {
    icon: <LyricsIcon size={34} />,
    title: "Sign in to open this lookup",
    line: "Lyrics belong to the account that looked them up, so there's nothing here until we know whose this is.",
  },
  song: {
    icon: <LibraryIcon size={34} />,
    title: "Sign in to open this song",
    line: "Songs belong to the library that saved them, so there's nothing here until we know whose you are.",
  },
  playlist: {
    icon: <PlaylistIcon size={34} />,
    title: "Sign in to open this playlist",
    line: "Playlists belong to the library that made them. If someone shared this one publicly, you'll find it under Shared once you're in.",
  },
  share: {
    icon: <PlusIcon size={34} />,
    title: "Sign in to save this reel",
    line: "Your phone sent a reel over. Sign in and it goes straight into your library.",
  },
};

// Every view in this shell needs to know whose library it is, so every one of
// them is wrapped. The page still renders its frame and the rail still works —
// only the contents are replaced, with a line about what signing in would get
// you *here*. See SignInPrompt.
function Gated({ icon, title, line, children }) {
  const { user } = useAuth();
  if (user) return children;
  return (
    <div className="view">
      <SignInPrompt icon={icon} title={title}>
        {line}
      </SignInPrompt>
    </div>
  );
}

function NotFound() {
  return (
    <div className="view">
      <h1 className="page-title">Not found</h1>
      <p className="sub">That page doesn't exist — try Search, All songs or Playlists.</p>
    </div>
  );
}
