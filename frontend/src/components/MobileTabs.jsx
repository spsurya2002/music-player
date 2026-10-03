import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Avatar from "./Avatar";
import {
  ChevronIcon,
  HomeIcon,
  InboxIcon,
  LibraryIcon,
  LyricsIcon,
  PlaylistIcon,
  PlusIcon,
  UserIcon,
} from "./icons";
import "./MobileTabs.css";

/**
 * The phone's navigation: five tabs, fixed, and that is the whole budget.
 *
 * Written out rather than folded out of the rail. The rail used to become this
 * bar by dissolving its grouping boxes with `display: contents`, which meant
 * every row it gained landed here too — seven worded tabs sharing 360px, each
 * narrower than the word "Add music" is wide. The two navigations want
 * different things in them, so they are now two lists.
 *
 * Add is one tab, not two: five is the whole budget, and the rail's two rows
 * (Add a reel / Add a file) do not both fit. It lands on the reel side, which
 * is the one almost everybody wants; the file side is one tap further, on the
 * switch AddTabs puts at the top of both pages.
 *
 * "You" opens a sheet rather than going to a page, because the rail's You
 * section holds four rows and only one of them (All songs) could have a tab.
 * Playlists, Lyrics and Imports had no route on a phone at all — you could see
 * them on a desktop and not reach them here.
 */
export default function MobileTabs() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const addingMusic = pathname.startsWith("/add");
  const [sheet, setSheet] = useState(false);

  // A tap that navigates has to shut the sheet behind it, or coming back puts
  // you on the page you left with the sheet still over it.
  useEffect(() => setSheet(false), [pathname]);

  return (
    <nav className="mobile-tabs">
      <NavLink to="/" end className="mobile-tab">
        <HomeIcon size={20} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/lyrics" className="mobile-tab">
        <LyricsIcon size={20} />
        <span>Lyrics</span>
      </NavLink>
      <NavLink to="/add/reel" className={"mobile-tab" + (addingMusic ? " active" : "")}>
        <PlusIcon size={20} />
        <span>Add</span>
      </NavLink>
      <NavLink to="/songs" className="mobile-tab">
        <LibraryIcon size={20} />
        <span>Songs</span>
      </NavLink>
      <button
        type="button"
        className={"mobile-tab" + (sheet ? " active" : "")}
        onClick={() => setSheet(true)}
        aria-haspopup="menu"
        aria-expanded={sheet}
      >
        {user ? <Avatar user={user} size={20} /> : <span className="mobile-tab-dot" />}
        <span>You</span>
      </button>

      {sheet && <YouSheet user={user} onClose={() => setSheet(false)} />}
    </nav>
  );
}

/**
 * The rail's "You" section, as a sheet over the tabs. All songs is left out —
 * it has a tab of its own, and listing it twice is the thing the rail already
 * learned not to do.
 */
function YouSheet({ user, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="you-sheet-backdrop" onMouseDown={onClose}>
      <div
        className="you-sheet"
        role="menu"
        aria-label="You"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="you-sheet-grip" />
        {user ? (
          <>
            <Link to="/playlists" className="you-sheet-row" onClick={onClose} role="menuitem">
              <PlaylistIcon size={19} />
              <span>Playlists</span>
              <ChevronIcon size={15} />
            </Link>
            <Link to="/lyrics/saved" className="you-sheet-row" onClick={onClose} role="menuitem">
              <LyricsIcon size={19} />
              <span>Lyrics</span>
              <ChevronIcon size={15} />
            </Link>
            <Link to="/imports" className="you-sheet-row" onClick={onClose} role="menuitem">
              <InboxIcon size={19} />
              <span>Imports</span>
              <ChevronIcon size={15} />
            </Link>
            <Link to="/account" className="you-sheet-row" onClick={onClose} role="menuitem">
              <UserIcon size={19} />
              <span>Account</span>
              <ChevronIcon size={15} />
            </Link>
          </>
        ) : (
          /* Everything above belongs to an account, so there is nothing to
             list — only the one thing that would fill it. */
          <Link to="/login" className="you-sheet-row" onClick={onClose} role="menuitem">
            <UserIcon size={19} />
            <span>Sign in</span>
            <ChevronIcon size={15} />
          </Link>
        )}
      </div>
    </div>
  );
}
