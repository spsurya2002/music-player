import { useState } from "react";
import { NavLink } from "react-router-dom";
import FeedbackModal from "./FeedbackModal";
import {
  ChevronIcon,
  FeedbackIcon,
  FileAudioIcon,
  HomeIcon,
  InboxIcon,
  LibraryIcon,
  LinkIcon,
  LyricsIcon,
  PlaylistIcon,
} from "./icons";
import "./Sidebar.css";

const OPEN_KEY = "rail-you-open";

/**
 * The rail: where you go, and nothing else.
 *
 * Two tiers. The top one is the four things that are each one place — home, the
 * two ways to put music in, and looking words up. The two Add routes sit here
 * as peers rather than behind one row or one menu, because what is behind them
 * is the thing you came to do, and a label you have to open something to read
 * is a label nobody reads.
 *
 * "You" holds everything that is a collection of your own, collapsible the way
 * YouTube's is. Hidden entirely on phones; MobileTabs takes over there.
 */
export default function Sidebar({ mini }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [youOpen, setYouOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });

  function toggleYou() {
    setYouOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? "0" : "1");
      } catch {
        // A browser that refuses storage still gets a working toggle; it just
        // forgets the choice on reload.
      }
      return !v;
    });
  }

  // Collapsed, the section header is a label with nothing to collapse — the
  // links are already down to icons — so it is dropped and the group runs on.
  const showYouHead = !mini;

  return (
    <nav className={"sidebar" + (mini ? " mini" : "")}>
      <div className="sidebar-nav">
        <RailLink to="/" end icon={<HomeIcon size={22} />} label="Home" mini={mini} />
        <RailLink
          to="/add/reel"
          icon={<LinkIcon size={22} />}
          label="Add a reel"
          miniLabel="Reel"
          mini={mini}
        />
        <RailLink
          to="/add/file"
          icon={<FileAudioIcon size={22} />}
          label="Add a file"
          miniLabel="File"
          mini={mini}
        />
        <RailLink
          to="/lyrics"
          end
          icon={<LyricsIcon size={22} />}
          label="Find lyrics"
          miniLabel="Lyrics"
          mini={mini}
        />
      </div>

      <div className="sidebar-section">
        {showYouHead && (
          <button
            type="button"
            className={"sidebar-heading sidebar-heading-btn" + (youOpen ? " open" : "")}
            onClick={toggleYou}
            aria-expanded={youOpen}
          >
            <span>You</span>
            <ChevronIcon size={14} />
          </button>
        )}
        {(youOpen || mini) && (
          <div className="sidebar-nav">
            <RailLink
              to="/songs"
              icon={<LibraryIcon size={22} />}
              label="All songs"
              miniLabel="Songs"
              mini={mini}
            />
            {/* The one Playlists row. The rail used to list every playlist under
                a PLAYLISTS heading as well, directly below this link — one word
                doing two jobs, three rows apart. Individual playlists are one
                click further in, which is where a list of twenty belongs. */}
            <RailLink
              to="/playlists"
              icon={<PlaylistIcon size={22} />}
              label="Playlists"
              mini={mini}
            />
            {/* The saved half of the same feature. "Find lyrics" above is the
                act; this is what you kept, which is what this tier means. */}
            <RailLink
              to="/lyrics/saved"
              icon={<LyricsIcon size={22} />}
              label="Lyrics"
              mini={mini}
            />
            {/* Was "Inbox", which named a mailbox. It is the queue of reels the
                Android share sheet handed over, and what became of each. */}
            <RailLink
              to="/imports"
              icon={<InboxIcon size={22} />}
              label="Imports"
              mini={mini}
            />
          </div>
        )}
      </div>

      {/* Not a destination, so not a RailLink: it opens where you already are.
          It sits at the foot of the rail, away from the places, because it is
          about the app rather than in it. The account menu carries the same
          thing for phones, where there is no rail at all. */}
      <button
        type="button"
        className="sidebar-link sidebar-feedback"
        onClick={() => setFeedbackOpen(true)}
        title={mini ? "Feedback" : undefined}
      >
        <FeedbackIcon size={22} />
        <span>Feedback</span>
      </button>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </nav>
  );
}

// One row. Collapsed it becomes an icon with the label underneath, which keeps
// the rail navigable without a tooltip you have to hover to read.
function RailLink({ to, end, icon, label, miniLabel, mini }) {
  return (
    <NavLink to={to} end={end} className="sidebar-link" title={mini ? label : undefined}>
      {icon}
      <span>{mini ? miniLabel || label : label}</span>
    </NavLink>
  );
}
