import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { onLimitsChanged } from "../utils/bus";
import Avatar from "./Avatar";
import Brand from "./Brand";
import FeedbackModal from "./FeedbackModal";
import Menu from "./Menu";
import Thumb from "./Thumb";
import {
  CoffeeIcon,
  FeedbackIcon,
  GaugeIcon,
  MenuIcon,
  RoomIcon,
  SearchIcon,
  ShieldIcon,
  SignOutIcon,
  SleeveIcon,
  UserIcon,
} from "./icons";
import { songTitle } from "../utils/format";
import { titleOf as lyricsTitle } from "./LyricsBits";
import "./Menu.css";
import "./TopBar.css";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The bar across the top: rail toggle, brand, search, and the account.
 *
 * It holds the two things that are not places — searching, and who you are —
 * so the rail can be nothing but destinations. Adding music is not here: both
 * ways in are rail rows, where their labels are readable without opening
 * anything.
 */
export default function TopBar({ onToggleRail, about }) {
  const { user, isAdmin, quota, signOut } = useAuth();
  const badges = useBadges(user);
  // The rail carries the same thing, but the rail is gone under 760px and the
  // account menu is not — so this is where a phone finds it.
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    // Signed out there is no search box (see SearchBox), so the 420px rule that
    // trades the wordmark away for search width has nothing to trade for — it
    // left a phone showing one button and no app name anywhere.
    <header className={"topbar" + (user ? "" : " topbar-anon")}>
      <div className="topbar-left">
        <button
          type="button"
          className="icon-btn topbar-toggle"
          onClick={onToggleRail}
          aria-label="Toggle the sidebar"
          title="Toggle the sidebar"
        >
          <MenuIcon size={20} />
        </button>
        <Link to="/" className="topbar-brand" aria-label="Reelody home">
          <Brand />
        </Link>
      </div>

      <SearchBox />

      <div className="topbar-right">
        {user ? (
          <AccountMenu
            user={user}
            isAdmin={isAdmin}
            quota={quota}
            badges={badges}
            onSignOut={signOut}
            about={about}
            onFeedback={() => setFeedbackOpen(true)}
          />
        ) : (
          <SignInButton />
        )}
      </div>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </header>
  );
}

function AccountMenu({ user, isAdmin, quota, badges, about, onSignOut, onFeedback }) {
  // An admin's waiting requests, or a reply to yours you haven't read. It used
  // to be a count on a rail row; the rail no longer holds the account, so it
  // rides on the avatar — the one thing on screen that is always you.
  const dot = isAdmin ? badges.pending > 0 : badges.unread > 0;
  return (
    <Menu
      label={dot ? "Account — something needs you" : "Account"}
      trigger={
        <span className="topbar-avatar">
          <Avatar user={user} size={30} />
          {dot && (
            <i className="topbar-dot" aria-label={isAdmin ? `${badges.pending} waiting` : "New reply"}>
              {isAdmin ? badges.pending : ""}
            </i>
          )}
        </span>
      }
    >
      {(close) => (
        <>
          <div className="menu-head">
            <div className="menu-head-name">{user.name || user.given_name}</div>
            <div className="menu-head-sub">{user.email}</div>
          </div>
          <Link to="/account" onClick={close} role="menuitem">
            <UserIcon size={16} />
            Account
          </Link>
          {/* Also a rail row, which phones don't have. A room is a place, so
              it stays out of the five tabs and lives here instead. */}
          <Link to="/rooms" onClick={close} role="menuitem">
            <RoomIcon size={16} />
            Rooms
          </Link>
          {/* Also in the rail, which is gone under 760px — and this menu is
              not. Same reason Feedback is listed twice below. */}
          {about?.enabled && about?.in_nav && (
            <Link to="/about" onClick={close} role="menuitem">
              <SleeveIcon size={16} />
              {about.nav_label}
            </Link>
          )}
          {isAdmin ? (
            <Link to="/admin" onClick={close} role="menuitem">
              <ShieldIcon size={16} />
              <span className="menu-item-text">
                Admin
                {badges.pending > 0 && (
                  <span className="menu-item-sub">{badges.pending} waiting</span>
                )}
              </span>
            </Link>
          ) : (
            <Link to="/plan" onClick={close} role="menuitem">
              <GaugeIcon size={16} />
              <span className="menu-item-text">
                Plan{badges.unread > 0 ? " · 1 new reply" : ""}
                <LeftLine quota={quota} />
              </span>
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onFeedback();
            }}
          >
            <FeedbackIcon size={16} />
            Feedback
          </button>
          {/* The rail's foot carries this too, and is gone on phones — which is
              the width where this menu is the only way to either of them. */}
          <Link to="/support" role="menuitem" onClick={close}>
            <CoffeeIcon size={16} />
            Buy me a coffee
          </Link>
          <button
            type="button"
            className="danger"
            role="menuitem"
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            <SignOutIcon size={16} />
            Sign out
          </button>
        </>
      )}
    </Menu>
  );
}

// What's left of each limit, under Plan. Turns --err once any one runs out.
function LeftLine({ quota }) {
  if (!quota) return null;
  const parts = [
    ["reel", "reel", "reels"],
    ["file", "file", "files"],
    ["lyrics", "lyric", "lyrics"],
  ]
    .map(([key, one, many]) => {
      const q = quota[key];
      if (!q) return null;
      if (q.limit == null) return null;
      return `${q.left} ${q.left === 1 ? one : many}`;
    })
    .filter(Boolean);
  if (!parts.length) return <span className="menu-item-sub">No limits</span>;
  const out = ["reel", "file", "lyrics"].some(
    (k) => quota[k] && quota[k].limit != null && quota[k].left <= 0
  );
  return (
    <span className={"menu-item-sub" + (out ? " out" : "")}>{parts.join(" · ")} left</span>
  );
}

// Answers you haven't read, and — for an admin — requests waiting on them.
// Nothing pushes from the server, so look again now and then and whenever the
// tab comes back, which is when someone would glance at it.
function useBadges(user) {
  const [badges, setBadges] = useState({ unread: 0, pending: null });

  useEffect(() => {
    if (!user) {
      setBadges({ unread: 0, pending: null });
      return undefined;
    }
    let cancelled = false;
    function load() {
      api
        .limitRequestSummary()
        .then((d) => {
          if (!cancelled) setBadges({ unread: d.unread || 0, pending: d.pending ?? null });
        })
        .catch(() => {});
    }
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    const off = onLimitsChanged(load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      off();
    };
  }, [user]);

  return badges;
}

// Secondary, not primary. The home hero and every SignInPrompt carry a primary
// Sign in of their own, so a gradient here put two of them on screen at once and
// made the gradient a fourth thing — it is rationed to the brand mark, the one
// primary button, and the player fill. This is the persistent way in; the one in
// the content is the contextual one, and only that one shouts.
function SignInButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="btn small secondary"
      onClick={() => navigate("/login", { state: { from: window.location.pathname } })}
    >
      Sign in
    </button>
  );
}

/**
 * Search your library from anywhere.
 *
 * Runs the same scored search All songs does (`backend/search.py`), because a
 * second, dumber matcher would disagree with it on exactly the transliterated
 * titles this library is full of. Enter opens the full results in All songs;
 * picking a suggestion goes straight to the song.
 */
function SearchBox() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState({ songs: [], lyrics: [] });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    const text = q.trim();
    if (!user || !text) {
      setHits({ songs: [], lyrics: [] });
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      // Two libraries, asked at once. A lookup you did from a pasted link has
      // the song's real name nowhere in your songs, so searching only those
      // would come back empty for something you plainly have.
      Promise.all([
        api.listSongs({ q: text, limit: 5 }).catch(() => ({ songs: [] })),
        api.listLyrics({ q: text, limit: 4 }).catch(() => ({ lyrics: [] })),
      ])
        .then(([songs, lyrics]) => {
          if (cancelled) return;
          setHits({ songs: songs.songs || [], lyrics: lyrics.lyrics || [] });
          setOpen(true);
        })
        .catch(() => {
          if (!cancelled) setHits({ songs: [], lyrics: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, user]);

  const go = useCallback(
    (e) => {
      e.preventDefault();
      const text = q.trim();
      if (!text) return;
      setOpen(false);
      navigate(`/songs?q=${encodeURIComponent(text)}`);
    },
    [q, navigate]
  );

  // Signed out there is no library to search, and the box would only ever
  // return "sign in" — so it isn't offered.
  if (!user) return <div className="topbar-search-spacer" />;

  return (
    <form className="topbar-search" onSubmit={go} ref={ref} role="search">
      <SearchIcon size={16} className="topbar-search-icon" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => (hits.songs.length || hits.lyrics.length) && setOpen(true)}
        placeholder="Search your songs"
        aria-label="Search your songs"
      />
      {open && (hits.songs.length > 0 || hits.lyrics.length > 0) && (
        <div className="topbar-results">
          {hits.songs.length > 0 && <div className="topbar-results-head">Songs</div>}
          {hits.songs.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setOpen(false);
                setQ("");
                navigate(`/songs/${s.id}`);
              }}
            >
              <Thumb className="topbar-result-thumb" src={s.thumbnail} />
              <span className="topbar-result-text">
                <b>{songTitle(s)}</b>
                {s.uploader && <span className="via">{s.uploader}</span>}
              </span>
            </button>
          ))}

          {hits.lyrics.length > 0 && <div className="topbar-results-head">Lyrics</div>}
          {hits.lyrics.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setOpen(false);
                setQ("");
                navigate(`/lyrics/${r.id}`);
              }}
            >
              <Thumb className="topbar-result-thumb" src={r.video?.thumbnail} />
              <span className="topbar-result-text">
                <b>{lyricsTitle(r)}</b>
                <span className="via">{r.meaning ? "words and meaning" : "words only"}</span>
              </span>
            </button>
          ))}

          <button type="button" className="topbar-results-all" onClick={go}>
            See all songs matching &ldquo;{q.trim()}&rdquo;
          </button>
        </div>
      )}
    </form>
  );
}
