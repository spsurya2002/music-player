import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../api/client";
import { usePlayer } from "../context/PlayerContext";
import SongRow from "../components/SongRow";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import ConfirmModal from "../components/ConfirmModal";
import Msg from "../components/Msg";
import { PlayIcon, PlusIcon, QueueIcon, ShuffleIcon, TrashIcon } from "../components/icons";
import { songTitle } from "../utils/format";
import Pager, { PAGE_SIZE, pageCount } from "../components/Pager";
import "./views.css";

const SORTS = [
  { value: "recent", label: "Recently added" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "plays", label: "Most played" },
];

export default function AllSongsView() {
  // The top bar searches from anywhere and lands here with ?q=, so the URL —
  // not this component — is where the query lives. That also makes a search
  // result a link you can send someone or come back to. `sort` lives here for
  // the same reason: as component state it reset every time you opened a song
  // and came back, which is the one moment you had already said how you wanted
  // the list ordered.
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const sort = params.get("sort") || "recent";
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);

  const setParam = (key, value) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value && !(key === "sort" && value === "recent")) next.set(key, value);
        else next.delete(key);
        // A new search or sort starts again at the first page.
        if (key !== "page") next.delete("page");
        return next;
      },
      { replace: true }
    );

  const setPage = (n) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (n <= 1) next.delete("page");
      else next.set("page", String(n));
      return next;
    });

  const [songs, setSongs] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [addToPlaylistSongs, setAddToPlaylistSongs] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Selection is a mode you turn on, not a hover affordance: a checkbox that
  // only appears under a pointer is one a phone can never reach.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { playQueue, addToQueue, currentSong, playing, togglePlay } = usePlayer();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .listSongs({
          q: q.trim() || undefined,
          sort,
          limit: PAGE_SIZE,
          skip: (page - 1) * PAGE_SIZE,
        })
        .then((d) => {
          if (cancelled) return;
          const count = d.total || 0;
          const last = pageCount(count);
          if (page > last) {
            setPage(last);
            return;
          }
          setSongs(d.songs || []);
          setTotal(count);
          setError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message || "Could not load your library.");
          setSongs([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, sort, page]);

  // Derived, not synced: a search can narrow the list under a selection, and
  // intersecting here means an id for a row that is no longer on screen simply
  // stops counting — no effect pruning the Set behind the render, and nothing
  // that can act on a song the user can't see.
  const selected = useMemo(
    () => (songs || []).filter((s) => selectedIds.has(s.id)),
    [songs, selectedIds]
  );

  // The page is 20 songs. Play still walks the whole library (or the whole
  // search), which is what Play all meant before the list was split up.
  async function songsMatching() {
    const data = await api.listSongs({ q: q.trim() || undefined, sort });
    return data.songs || [];
  }

  async function handleRowPlay(song) {
    if (currentSong && currentSong.id === song.id) {
      togglePlay();
      return;
    }
    const all = await songsMatching();
    const at = all.findIndex((s) => s.id === song.id);
    playQueue(all, at < 0 ? 0 : at);
  }

  function toggleSelect(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function endSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  async function shuffle() {
    const order = await songsMatching();
    if (!order.length) return;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    playQueue(order, 0);
  }

  async function handleDelete() {
    await api.deleteSong(deleteTarget.id);
    setSongs((list) => list.filter((s) => s.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  // One at a time, not Promise.all: deleting a song counts the other documents
  // pointing at its GridFS file before removing it, and two of those counts
  // running at once is how a shared file gets deleted out from under a copy.
  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      const done = [];
      for (const song of selected) {
        await api.deleteSong(song.id);
        done.push(song.id);
      }
      setSongs((list) => list.filter((s) => !done.includes(s.id)));
      setDeleteTarget(null);
      endSelecting();
    } finally {
      setBulkDeleting(false);
    }
  }

  const allShown = songs || [];
  const allSelected = allShown.length > 0 && selected.length === allShown.length;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1 className="page-title">All songs</h1>
          <p className="sub">Everything in your library — reels and files you've uploaded.</p>
        </div>
        <div className="view-head-controls">
          <input
            type="search"
            placeholder="Search title, artist, uploader…"
            aria-label="Search your library"
            value={q}
            onChange={(e) => setParam("q", e.target.value)}
          />
          <select
            value={sort}
            aria-label="Sort songs by"
            onChange={(e) => setParam("sort", e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Play all and Shuffle were on both playlist pages and not on the
          library itself, so "play everything I have" was the one thing you
          could not ask for without first picking a song to start from. */}
      {total > 0 && (
        <div className="library-actions">
          <button type="button" className="btn small" onClick={() => songsMatching().then((all) => all.length && playQueue(all, 0))}>
            <PlayIcon size={15} />
            Play all
          </button>
          <button type="button" className="btn small secondary" onClick={shuffle}>
            <ShuffleIcon size={15} />
            Shuffle
          </button>
          {selecting ? (
            <button type="button" className="btn small ghost" onClick={endSelecting}>
              Done
            </button>
          ) : (
            <button type="button" className="btn small ghost" onClick={() => setSelecting(true)}>
              Select
            </button>
          )}
          <span className="library-count">
            {total} {total === 1 ? "song" : "songs"}
          </span>
        </div>
      )}

      {selecting && (
        <div className="select-bar" role="region" aria-label="Selected songs">
          <button
            type="button"
            className="btn small ghost"
            onClick={() =>
              setSelectedIds(allSelected ? new Set() : new Set(allShown.map((s) => s.id)))
            }
          >
            {allSelected ? "Clear" : pageCount(total) > 1 ? "Select page" : "Select all"}
          </button>
          <span className="select-bar-count">
            {selected.length} selected
          </span>
          <div className="select-bar-actions">
            <button
              type="button"
              className="btn small secondary"
              disabled={!selected.length}
              onClick={() => setAddToPlaylistSongs(selected)}
            >
              <PlusIcon size={15} />
              Add to playlist
            </button>
            <button
              type="button"
              className="btn small secondary"
              disabled={!selected.length}
              onClick={() => {
                selected.forEach(addToQueue);
                endSelecting();
              }}
            >
              <QueueIcon size={15} />
              Add to queue
            </button>
            <button
              type="button"
              className="btn small danger"
              disabled={!selected.length || bulkDeleting}
              onClick={() => setDeleteTarget({ bulk: true })}
            >
              {bulkDeleting ? <span className="spin" /> : <TrashIcon size={15} />}
              Delete
            </button>
          </div>
        </div>
      )}

      {error && <Msg kind="err">{error}</Msg>}

      {loading && !songs && <div className="song">Loading your library…</div>}

      {songs && songs.length === 0 && !loading && (
        <div className="song empty-state">
          {q ? "Nothing matches that search." : "Nothing saved yet — paste a reel link to start."}
        </div>
      )}

      {songs && songs.length > 0 && (
        // Dimmed while a new sort or search is in flight. Without it the old
        // rows sit there looking like the answer to the question just asked.
        <div className={"song-list" + (loading ? " is-stale" : "")} aria-busy={loading}>
          {songs.map((song, i) => (
            <SongRow
              key={song.id}
              song={song}
              index={(page - 1) * PAGE_SIZE + i}
              active={currentSong && currentSong.id === song.id}
              playing={playing}
              selecting={selecting}
              selected={selectedIds.has(song.id)}
              onToggleSelect={() => toggleSelect(song.id)}
              onPlay={() => handleRowPlay(song)}
              onOpen={() => navigate(`/songs/${song.id}`)}
              onAddToQueue={() => addToQueue(song)}
              onAddToPlaylist={() => setAddToPlaylistSongs([song])}
              onDelete={() => setDeleteTarget(song)}
            />
          ))}
        </div>
      )}

      <Pager page={page} total={total} onPage={setPage} />

      {addToPlaylistSongs && (
        <AddToPlaylistModal
          song={addToPlaylistSongs.length === 1 ? addToPlaylistSongs[0] : undefined}
          songs={addToPlaylistSongs}
          onClose={() => setAddToPlaylistSongs(null)}
          onChanged={() => {
            if (addToPlaylistSongs.length > 1) endSelecting();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={deleteTarget.bulk ? "Delete songs" : "Delete song"}
          message={
            deleteTarget.bulk
              ? `Delete ${selected.length} ${selected.length === 1 ? "song" : "songs"} from your library? Their MP3s go too.`
              : `Delete "${songTitle(deleteTarget)}" from your library? The MP3 goes too.`
          }
          confirmLabel="Delete"
          onConfirm={deleteTarget.bulk ? handleBulkDelete : handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
