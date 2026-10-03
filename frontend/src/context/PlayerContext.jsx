import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api/client";
import { onSignedOut } from "../utils/bus";

const PlayerContext = createContext(null);

const LOOP_CYCLE = { off: "all", all: "one", one: "off" };

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
  }

  const [queue, setQueue] = useState([]); // array of Song
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [loopMode, setLoopModeState] = useState("off");
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false);
  // The YouTube player is always the corner dock. It used to be a modal, which
  // covered the thing you opened it to compare against or read alongside — the
  // two situations it is actually used in.
  const [ytModal, setYtModal] = useState({ open: false, videoId: null, title: "" });
  // The docked player hands its pause() up here so starting an MP3 can silence
  // it. Nothing else in the app can reach inside an iframe to do that, and two
  // sounds at once is the one thing the player must never allow.
  const ytPauseRef = useRef(null);
  const [playerError, setPlayerError] = useState("");

  const lastPlayedRef = useRef(null); // song id we already fired /played for, this "load"

  const currentSong = currentIndex >= 0 ? queue[currentIndex] : null;

  // Wire the single persistent <audio> element once.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;

    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onLoaded = () => setDuration(audio.duration || 0);
    const onPlay = () => {
      setPlaying(true);
      // The two players must never run at once — audio starting wins. The dock
      // only falls silent and stays put, ready to be resumed when the song
      // finishes, rather than closing out from under you.
      try {
        ytPauseRef.current?.();
      } catch {
        // The iframe went away mid-call; nothing to pause.
      }
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => handleEnded();
    // Don't assert a cause here — a failed load is just as likely to be the
    // server being down or the file being unreadable as the song being gone.
    const onError = () => setPlayerError("That track won't play — the file may be missing or unreadable.");

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Somebody signed out. The audio element lives above the router, so nothing
  // else would stop it — and every URL in the queue belongs to a library the
  // next request won't be allowed to read.
  useEffect(
    () =>
      onSignedOut(() => {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        lastPlayedRef.current = null;
        setQueue([]);
        setCurrentIndex(-1);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setActivePlaylistId(null);
        setQueueOpen(false);
        setYtModal({ open: false, videoId: null, title: "" });
        setPlayerError("");
      }),
    []
  );

  // Load whichever song is "current" whenever the index/queue changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    // A song from somebody's shared playlist streams from the shared route and
    // says so in `audio_url` — the library's own route scopes to the signed-in
    // user and would 404 on it. Every Song the API returns carries the field,
    // so this is the general case, not a special one.
    const src = currentSong.audio_url || api.songAudioUrl(currentSong.id);
    if (audio.src.indexOf(src) === -1) {
      setPlayerError("");
      // Seed the clock from the saved metadata rather than waiting for
      // loadedmetadata. Otherwise the previous track's duration stays on screen
      // until the new one loads — and stays for good if the load fails.
      setDuration(currentSong.duration || 0);
      setCurrentTime(0);
      audio.src = src;
      audio.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, queue]);

  // Fire the "played" beacon once per track start. Not for a shared song: the
  // play count belongs to its owner's library, and a stranger listening is not
  // their listening history — the call would 404 anyway.
  useEffect(() => {
    if (!currentSong) return;
    if (!playing) return;
    if (currentSong.shared) return;
    if (lastPlayedRef.current === currentSong.id) return;
    lastPlayedRef.current = currentSong.id;
    api.markPlayed(currentSong.id).catch(() => {});
  }, [currentSong, playing]);

  function handleEnded() {
    // Read loop mode through the ref, never the state variable: the "ended"
    // listener is bound once with [] deps, so this closure keeps whatever
    // loopMode held on first render ("off") and every loop setting is ignored.
    if (loopModeRef.current === "one") {
      const audio = audioRef.current;
      audio.currentTime = 0;
      lastPlayedRef.current = null; // count each repeat as a play
      audio.play().catch(() => {});
      return;
    }
    setCurrentIndex((idx) => {
      const next = idx + 1;
      if (next < queueRef.current.length) {
        lastPlayedRef.current = null;
        return next;
      }
      if (loopModeRef.current === "all" && queueRef.current.length > 0) {
        lastPlayedRef.current = null;
        return 0;
      }
      return idx; // stop — stay on the last track
    });
  }

  // Ref mirrors of the state handleEnded needs, for the same closure reason.
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const loopModeRef = useRef(loopMode);
  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  const playQueue = useCallback((songs, startIndex = 0, opts = {}) => {
    if (!songs || songs.length === 0) return;
    lastPlayedRef.current = null;
    setQueue(songs);
    setActivePlaylistId(opts.playlistId ?? null);
    // Somebody else's shared playlist: it still sets activePlaylistId, because
    // that is what highlights the playing row on their page — but the loop
    // setting is theirs to keep, so cycleLoop must not try to save into it.
    activePlaylistSharedRef.current = Boolean(opts.shared);
    if (opts.loop) setLoopModeState(opts.loop);
    else if (!opts.playlistId) setLoopModeState("off");
    setCurrentIndex(startIndex);
    setPlayerError("");
  }, []);

  const playSongNow = useCallback(
    (song) => {
      playQueue([song], 0, {});
    },
    [playQueue]
  );

  // Nothing is loaded, so there is nothing for a queue to come after — and
  // nowhere to see it either: the player bar shows "Nothing playing" and hides
  // its queue button until a song is current. So the first one added starts,
  // rather than sitting in a drawer with no handle on it.
  const startedIdle = useCallback(() => {
    if (currentIndexRef.current >= 0) return false;
    lastPlayedRef.current = null;
    setCurrentIndex(0);
    return true;
  }, []);

  const playNext = useCallback((song) => {
    const idle = startedIdle();
    setQueue((q) => {
      if (idle) return [song];
      const copy = q.slice();
      copy.splice(currentIndexRef.current + 1, 0, song);
      return copy;
    });
  }, [startedIdle]);

  // Onto the end, interrupting nothing — that is the whole difference from
  // playSongNow, which throws the queue away. Takes one song or a whole
  // playlist, and keeps the order it was given.
  const addToQueue = useCallback((songs) => {
    const added = (Array.isArray(songs) ? songs : [songs]).filter(Boolean);
    if (added.length === 0) return;
    startedIdle();
    setQueue((q) => q.concat(added));
  }, [startedIdle]);

  const currentIndexRef = useRef(currentIndex);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, [currentSong]);

  const seek = useCallback((t) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = t;
    setCurrentTime(t);
  }, []);

  const seekBy = useCallback(
    (delta) => {
      const audio = audioRef.current;
      if (!audio) return;
      seek(Math.max(0, Math.min((audio.duration || 0), audio.currentTime + delta)));
    },
    [seek]
  );

  const setVolume = useCallback((v) => {
    const audio = audioRef.current;
    setVolumeState(v);
    if (audio) audio.volume = v;
  }, []);

  const next = useCallback(() => {
    setCurrentIndex((idx) => {
      const q = queueRef.current;
      if (idx + 1 < q.length) {
        lastPlayedRef.current = null;
        return idx + 1;
      }
      if (loopMode === "all" && q.length > 0) {
        lastPlayedRef.current = null;
        return 0;
      }
      return idx;
    });
  }, [loopMode]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      seek(0);
      return;
    }
    setCurrentIndex((idx) => {
      if (idx > 0) {
        lastPlayedRef.current = null;
        return idx - 1;
      }
      return idx;
    });
  }, [seek]);

  const jumpTo = useCallback((index) => {
    lastPlayedRef.current = null;
    setCurrentIndex(index);
  }, []);

  const activePlaylistSharedRef = useRef(false);

  const cycleLoop = useCallback(() => {
    setLoopModeState((mode) => {
      const next = LOOP_CYCLE[mode];
      if (activePlaylistIdRef.current && !activePlaylistSharedRef.current) {
        api.updatePlaylist(activePlaylistIdRef.current, { loop: next }).catch(() => {});
      }
      return next;
    });
  }, []);

  const activePlaylistIdRef = useRef(activePlaylistId);
  useEffect(() => {
    activePlaylistIdRef.current = activePlaylistId;
  }, [activePlaylistId]);

  const setLoopMode = useCallback((mode) => {
    setLoopModeState(mode);
  }, []);

  const toggleQueue = useCallback(() => setQueueOpen((v) => !v), []);

  // Never two sounds at once: opening it stops the MP3.
  const dockYoutube = useCallback((videoId, title = "") => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setYtModal({ open: true, videoId, title });
  }, []);

  const closeYoutube = useCallback(() => {
    ytPauseRef.current = null;
    setYtModal({ open: false, videoId: null, title: "" });
  }, []);

  // The YouTube component registers how to pause itself, and withdraws it when
  // it goes.
  const registerYoutubePause = useCallback((fn) => {
    ytPauseRef.current = fn;
  }, []);

  const removeFromQueue = useCallback((index) => {
    setQueue((q) => {
      const copy = q.slice();
      copy.splice(index, 1);
      return copy;
    });
    setCurrentIndex((idx) => {
      if (index < idx) return idx - 1;
      return idx;
    });
  }, []);

  const reorderQueue = useCallback((from, to) => {
    setQueue((q) => {
      const copy = q.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    setCurrentIndex((idx) => {
      if (from === idx) return to;
      if (from < idx && to >= idx) return idx - 1;
      if (from > idx && to <= idx) return idx + 1;
      return idx;
    });
  }, []);

  const value = useMemo(
    () => ({
      queue,
      currentIndex,
      currentSong,
      playing,
      currentTime,
      duration,
      volume,
      loopMode,
      activePlaylistId,
      queueOpen,
      ytModal,
      playerError,
      playQueue,
      playSongNow,
      playNext,
      addToQueue,
      togglePlay,
      seek,
      seekBy,
      setVolume,
      next,
      prev,
      jumpTo,
      cycleLoop,
      setLoopMode,
      toggleQueue,
      dockYoutube,
      closeYoutube,
      registerYoutubePause,
      removeFromQueue,
      reorderQueue,
    }),
    [
      queue,
      currentIndex,
      currentSong,
      playing,
      currentTime,
      duration,
      volume,
      loopMode,
      activePlaylistId,
      queueOpen,
      ytModal,
      playerError,
      playQueue,
      playSongNow,
      playNext,
      addToQueue,
      togglePlay,
      seek,
      seekBy,
      setVolume,
      next,
      prev,
      jumpTo,
      cycleLoop,
      setLoopMode,
      toggleQueue,
      dockYoutube,
      closeYoutube,
      registerYoutubePause,
      removeFromQueue,
      reorderQueue,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
