import { Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import PlayerBar from "./components/PlayerBar";
import QueuePanel from "./components/QueuePanel";
import YouTubePlayerModal from "./components/YouTubePlayerModal";
import { usePlayer } from "./context/PlayerContext";
import useGlobalShortcuts from "./hooks/useGlobalShortcuts";
import SearchView from "./views/SearchView";
import AllSongsView from "./views/AllSongsView";
import SongDetailView from "./views/SongDetailView";
import PlaylistsView from "./views/PlaylistsView";
import PlaylistDetailView from "./views/PlaylistDetailView";
import IdentifyView from "./views/IdentifyView";
import "./Shell.css";

// Sidebar, PlayerBar, QueuePanel and the YouTube modal all live here, as
// siblings of <Routes> rather than inside it — navigating between views only
// ever swaps the <Routes> subtree, so the audio element (owned by
// PlayerProvider, above this whole component) and the bar that controls it
// never unmount.
export default function Shell() {
  const { queueOpen } = usePlayer();
  useGlobalShortcuts();

  return (
    <div className="shell">
      <Sidebar />
      <main className="shell-content">
        <Routes>
          <Route path="/" element={<SearchView />} />
          <Route path="/songs" element={<AllSongsView />} />
          <Route path="/songs/:id" element={<SongDetailView />} />
          <Route path="/playlists" element={<PlaylistsView />} />
          <Route path="/playlists/:id" element={<PlaylistDetailView />} />
          <Route path="/identify" element={<IdentifyView />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {queueOpen && <QueuePanel />}
      <PlayerBar />
      <YouTubePlayerModal />
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
