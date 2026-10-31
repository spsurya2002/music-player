import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api/client";
import { onSignedOut } from "../utils/bus";
import { songTitle } from "../utils/format";

// A silent clip, played inside the click that joins a room. Browsers only
// allow sound after a gesture, and the host's "play" arrives later, over the
// socket — too late to be that gesture. Starting this here is what lets the
// real song start on its own.
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

const PlayerContext = createContext(null);

const LOOP_CYCLE = { off: "all", all: "one", one: "off" };

// The queue and the playhead. The audio element dies with the page, so this is
// what puts the same song back when you reload. A listening room is left out:
// its audio URL only works while that room is open.
const PLAYER_KEY = "reelody.player";

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
  }

  const storedRef = useRef(undefined);
  if (storedRef.current === undefined) storedRef.current = readStoredPlayer();
  const stored = storedRef.current;

  const [queue, setQueue] = useState(() => stored?.queue ?? []); // array of Song
  const [currentIndex, setCurrentIndex] = useState(() => (stored ? stored.index : -1));
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => stored?.time ?? 0);
  const [duration, setDuration] = useState(() => stored?.queue?.[stored.index]?.duration || 0);
  const [volume, setVolumeState] = useState(() => stored?.volume ?? 1);
  const [loopMode, setLoopModeState] = useState(() => stored?.loop || "off");
  const [activePlaylistId, setActivePlaylistId] = useState(() => stored?.playlistId ?? null);
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

  // Already counted for this track. A reload is the same listen, not a new one.
  const lastPlayedRef = useRef(stored ? stored.queue[stored.index]?.id ?? null : null);
  // Held until the restored file has actually seeked. A later track starts at 0.
  const resumeAtRef = useRef(stored ? stored.time : null);
  const resumePlayRef = useRef(Boolean(stored?.playing));
  const resumeSongIdRef = useRef(stored?.queue?.[stored.index]?.id ?? null);

  // A listening room shares this one element. The host publishes what it does;
  // a guest follows the server clock and does not drive it.
  const roomRoleRef = useRef(null); // "host" | "guest" | null
  const roomPlayingRef = useRef(false);
  const clockRef = useRef(null);
  const wantRef = useRef(null);
  const socketRef = useRef(null);
  const reconnectRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const applyRef = useRef(() => {});
  const sendRef = useRef(() => {});
  const stopRef = useRef(() => {});
  const resumeGuestRef = useRef(() => {});
  const resumeTimerRef = useRef(null);
  const openSocketRef = useRef(() => {});
  const closeSocketRef = useRef(() => {});
  const [room, setRoom] = useState(null);

  const currentSong = currentIndex >= 0 ? queue[currentIndex] : null;

  // Wire the single persistent <audio> element once.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;

    const onTime = () => {
      const pending = resumeAtRef.current;
      const t = audio.currentTime || 0;
      // Assigning src reports 0 before the saved position can be applied, and
      // that flash would wipe the bar back to the start of the song.
      if (pending != null && pending > 0.4 && t + 0.4 < pending) return;
      setCurrentTime(t);
    };
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
    const onPause = () => {
      setPlaying(false);
      // A media key or the phone's notification pauses the element directly.
      // For a guest that pause is not theirs to keep — the host is still playing.
      resumeGuestRef.current("pause");
    };
    const onSeeked = () => resumeGuestRef.current("seek");
    const onEnded = () => handleEnded();
    // Don't assert a cause here — a failed load is just as likely to be the
    // server being down or the file being unreadable as the song being gone.
    const onError = () => setPlayerError("That track won't play — the file may be missing or unreadable.");

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeked", onSeeked);
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
        stopRef.current(false);
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        lastPlayedRef.current = null;
        resumeAtRef.current = null;
        resumePlayRef.current = false;
        clearStoredPlayer();
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
    const loaded = trackLoaded(audio, currentSong);
    // Only the song we reloaded on. The next thing you pick starts clean, at
    // the beginning, instead of inheriting this position.
    const restoring =
      resumeAtRef.current != null &&
      !roomRoleRef.current &&
      currentSong.id === resumeSongIdRef.current;
    if (!restoring && resumeAtRef.current != null && !roomRoleRef.current) {
      resumeAtRef.current = null;
      resumePlayRef.current = false;
    }
    if (!loaded) {
      setPlayerError("");
      // Seed the clock from the saved metadata rather than waiting for
      // loadedmetadata. Otherwise the previous track's duration stays on screen
      // until the new one loads — and stays for good if the load fails.
      const follow = roomRoleRef.current;
      const startAt = follow ? pendingSeekRef.current || 0 : restoring ? resumeAtRef.current : 0;
      pendingSeekRef.current = null;
      setDuration(currentSong.duration || 0);
      setCurrentTime(startAt);
      const shouldPlay = follow ? roomPlayingRef.current : restoring ? resumePlayRef.current : true;
      let started = false;
      const onReady = () => {
        if (started) return;
        started = true;
        // A track change can land before this fires. Seeking then would park
        // the new song at the old one's position.
        if (!trackLoaded(audio, currentSong)) return;
        const begin = () => {
          if (!follow) resumeAtRef.current = null;
          if (shouldPlay) audio.play().catch(() => {});
        };
        if (startAt > 0.3) {
          const onSeeked = () => begin();
          audio.addEventListener("seeked", onSeeked, { once: true });
          try {
            audio.currentTime = startAt;
          } catch {
            // Metadata arrived without a seekable range yet. A room guest is
            // pulled back into line by the drift tick; a reload just starts
            // this one from the beginning if the file won't take a seek.
            audio.removeEventListener("seeked", onSeeked);
            begin();
            return;
          }
          // Already there: seeked will not fire, and waiting would never play.
          if (Math.abs((audio.currentTime || 0) - startAt) <= 0.4) {
            audio.removeEventListener("seeked", onSeeked);
            begin();
          }
          return;
        }
        begin();
      };
      // Listen first. A cached file fires loadedmetadata inside the src
      // assignment, and a listener added afterwards never runs — the reload
      // then starts the song from the beginning.
      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.src = src;
      if (audio.readyState >= 1) onReady();
    } else if (restoring) {
      const at = resumeAtRef.current;
      const begin = () => {
        resumeAtRef.current = null;
        if (resumePlayRef.current && audio.paused) audio.play().catch(() => {});
        else if (!resumePlayRef.current && !audio.paused) audio.pause();
      };
      if (at > 0.3 && Math.abs((audio.currentTime || 0) - at) > 0.4) {
        const onSeeked = () => begin();
        audio.addEventListener("seeked", onSeeked, { once: true });
        try {
          audio.currentTime = at;
        } catch {
          audio.removeEventListener("seeked", onSeeked);
          return;
        }
        if (Math.abs((audio.currentTime || 0) - at) <= 0.4) {
          audio.removeEventListener("seeked", onSeeked);
          begin();
        }
      } else {
        begin();
      }
    } else if (roomRoleRef.current && pendingSeekRef.current != null) {
      const at = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (Math.abs((audio.currentTime || 0) - at) > 0.4) audio.currentTime = at;
      if (roomPlayingRef.current && audio.paused) {
        audio.play().catch(() => {});
      } else if (!roomPlayingRef.current && !audio.paused) {
        audio.pause();
      }
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
    // A guest hearing the host's file is not the host's listening history.
    // The host's own plays still count.
    if (currentSong.room && roomRoleRef.current !== "host") return;
    if (lastPlayedRef.current === currentSong.id) return;
    lastPlayedRef.current = currentSong.id;
    api.markPlayed(currentSong.id).catch(() => {});
  }, [currentSong, playing]);

  function handleEnded() {
    // The silent clip used to unlock autoplay is not a song. Letting it end
    // must not skip whatever the host has queued.
    if ((audioRef.current?.src || "").startsWith("data:")) return;
    // Read loop mode through the ref, never the state variable: the "ended"
    // listener is bound once with [] deps, so this closure keeps whatever
    // loopMode held on first render ("off") and every loop setting is ignored.
    // In a room only the host reports the end, and the server decides what
    // plays next. A guest that reached the end a moment early just waits.
    if (roomRoleRef.current === "guest") return;
    if (roomRoleRef.current === "host") {
      sendRef.current({ type: "ended" });
      return;
    }
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
    if (roomRoleRef.current === "guest") {
      setPlayerError("Only the host picks what plays.");
      return;
    }
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
    if (roomRoleRef.current === "host") {
      roomPlayingRef.current = true;
      const loop = opts.loop || (!opts.playlistId ? "off" : undefined);
      sendRef.current({
        type: "queue",
        song_ids: songs.map((song) => song && song.id).filter(Boolean),
        index: startIndex,
        restart: true,
        ...(loop ? { loop } : {}),
      });
    }
  }, []);

  const playSongNow = useCallback(
    (song) => {
      playQueue([song], 0, {});
    },
    [playQueue]
  );

  const playNext = useCallback((song) => {
    if (roomRoleRef.current === "guest") {
      setPlayerError("Only the host picks what plays.");
      return;
    }
    if (!song) return;
    const idle = currentIndexRef.current < 0;
    const copy = idle ? [song] : queueRef.current.slice();
    if (idle) {
      lastPlayedRef.current = null;
      roomPlayingRef.current = true;
      setCurrentIndex(0);
    } else {
      copy.splice(currentIndexRef.current + 1, 0, song);
    }
    setQueue(copy);
    if (roomRoleRef.current === "host") {
      sendRef.current({
        type: "queue",
        song_ids: copy.map((item) => item && item.id).filter(Boolean),
        index: idle ? 0 : currentIndexRef.current,
        restart: idle,
      });
    }
  }, []);

  // Onto the end, interrupting nothing — that is the whole difference from
  // playSongNow, which throws the queue away. Takes one song or a whole
  // playlist, and keeps the order it was given.
  const addToQueue = useCallback((songs) => {
    if (roomRoleRef.current === "guest") {
      setPlayerError("Only the host picks what plays.");
      return;
    }
    const added = (Array.isArray(songs) ? songs : [songs]).filter(Boolean);
    if (added.length === 0) return;
    const idle = currentIndexRef.current < 0;
    const copy = idle ? added : queueRef.current.concat(added);
    if (idle) {
      lastPlayedRef.current = null;
      roomPlayingRef.current = true;
      setCurrentIndex(0);
    }
    setQueue(copy);
    if (roomRoleRef.current === "host") {
      sendRef.current({
        type: "queue",
        song_ids: copy.map((item) => item && item.id).filter(Boolean),
        index: idle ? 0 : currentIndexRef.current,
        restart: idle,
      });
    }
  }, []);

  const currentIndexRef = useRef(currentIndex);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (roomRoleRef.current === "guest") return;
    if (!audio || !currentSong) return;
    if (audio.paused) {
      audio.play().catch(() => {});
      if (roomRoleRef.current === "host") {
        sendRef.current({ type: "play", position_ms: positionMs(audio) });
      }
    } else {
      audio.pause();
      if (roomRoleRef.current === "host") {
        sendRef.current({ type: "pause", position_ms: positionMs(audio) });
      }
    }
  }, [currentSong]);

  const seek = useCallback((t) => {
    if (roomRoleRef.current === "guest") return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = t;
    setCurrentTime(t);
    if (roomRoleRef.current === "host") {
      sendRef.current({ type: "seek", position_ms: positionMs(t) });
    }
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
    if (roomRoleRef.current === "guest") return;
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    let to = idx;
    if (idx + 1 < q.length) to = idx + 1;
    else if (loopModeRef.current === "all" && q.length > 0) to = 0;
    if (to === idx) return;
    lastPlayedRef.current = null;
    setCurrentIndex(to);
    if (roomRoleRef.current === "host") sendRef.current({ type: "skip", index: to });
  }, []);

  const prev = useCallback(() => {
    if (roomRoleRef.current === "guest") return;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      seek(0);
      return;
    }
    const idx = currentIndexRef.current;
    if (idx <= 0) return;
    lastPlayedRef.current = null;
    setCurrentIndex(idx - 1);
    if (roomRoleRef.current === "host") sendRef.current({ type: "skip", index: idx - 1 });
  }, [seek]);

  const jumpTo = useCallback((index) => {
    if (roomRoleRef.current === "guest") return;
    lastPlayedRef.current = null;
    setCurrentIndex(index);
    if (roomRoleRef.current === "host") sendRef.current({ type: "skip", index });
  }, []);

  const activePlaylistSharedRef = useRef(Boolean(stored?.shared));

  const cycleLoop = useCallback(() => {
    if (roomRoleRef.current === "guest") return;
    setLoopModeState((mode) => {
      const nextMode = LOOP_CYCLE[mode];
      if (activePlaylistIdRef.current && !activePlaylistSharedRef.current) {
        api.updatePlaylist(activePlaylistIdRef.current, { loop: nextMode }).catch(() => {});
      }
      if (roomRoleRef.current === "host") sendRef.current({ type: "loop", loop: nextMode });
      return nextMode;
    });
  }, []);

  const activePlaylistIdRef = useRef(activePlaylistId);
  useEffect(() => {
    activePlaylistIdRef.current = activePlaylistId;
  }, [activePlaylistId]);

  const setLoopMode = useCallback((mode) => {
    setLoopModeState(mode);
  }, []);

  const toggleQueue = useCallback(() => {
    if (roomRoleRef.current === "guest") return;
    setQueueOpen((v) => !v);
  }, []);

  // Never two sounds at once: opening it stops the MP3.
  const dockYoutube = useCallback((videoId, title = "") => {
    if (roomRoleRef.current) {
      setPlayerError("Leave the room before playing a video.");
      return;
    }
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
    if (roomRoleRef.current === "guest") return;
    const copy = queueRef.current.slice();
    if (index < 0 || index >= copy.length) return;
    const removedCurrent = index === currentIndexRef.current;
    copy.splice(index, 1);
    let idx = currentIndexRef.current;
    if (index < idx) idx -= 1;
    if (idx >= copy.length) idx = copy.length - 1;
    setQueue(copy);
    setCurrentIndex(copy.length === 0 ? -1 : idx);
    if (roomRoleRef.current === "host") {
      sendRef.current({
        type: "queue",
        song_ids: copy.map((item) => item && item.id).filter(Boolean),
        index: Math.max(0, idx),
        restart: removedCurrent,
      });
    }
  }, []);

  const reorderQueue = useCallback((from, to) => {
    if (roomRoleRef.current === "guest") return;
    const copy = queueRef.current.slice();
    if (from === to || from < 0 || to < 0 || from >= copy.length || to >= copy.length) return;
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    let idx = currentIndexRef.current;
    if (from === idx) idx = to;
    else if (from < idx && to >= idx) idx -= 1;
    else if (from > idx && to <= idx) idx += 1;
    setQueue(copy);
    setCurrentIndex(idx);
    if (roomRoleRef.current === "host") {
      sendRef.current({
        type: "queue",
        song_ids: copy.map((entry) => entry && entry.id).filter(Boolean),
        index: idx,
        restart: false,
      });
    }
  }, []);

  // The socket and the clock live for the whole session, not for the room
  // page — leaving that page must not stop the song.
  sendRef.current = (msg) => {
    const sock = socketRef.current;
    if (sock?.handle.send(msg)) return;
    const code = wantRef.current;
    if (!code || roomRoleRef.current !== "host") return;
    api
      .roomCommand(code, msg)
      .then((data) => {
        if (data?.room) applyRef.current(data.room);
      })
      .catch((err) => setPlayerError(err.message));
  };

  function noteClock(incoming) {
    const serverNow = Date.parse(incoming.server_now);
    clockRef.current = {
      playing: Boolean(incoming.playing),
      positionMs: incoming.position_ms || 0,
      anchored: Date.parse(incoming.anchored_at || incoming.server_now),
      offset: Number.isFinite(serverNow) ? serverNow - Date.now() : 0,
    };
  }

  function expectedFromClock() {
    const clock = clockRef.current;
    if (!clock) return 0;
    const base = clock.positionMs / 1000;
    if (!clock.playing || !Number.isFinite(clock.anchored)) return Math.max(0, base);
    const serverTime = Date.now() + clock.offset;
    return Math.max(0, base + (serverTime - clock.anchored) / 1000);
  }

  function clearGuestSession() {
    const session = navigator.mediaSession;
    if (!session) return;
    try {
      session.metadata = null;
      session.playbackState = "none";
    } catch {
      // A browser without the session API has nothing to clear.
    }
    for (const name of [
      "play",
      "pause",
      "stop",
      "seekbackward",
      "seekforward",
      "seekto",
      "previoustrack",
      "nexttrack",
    ]) {
      try {
        session.setActionHandler(name, null);
      } catch {
        // This action isn't one the browser offers.
      }
    }
  }

  function syncGuestSession(song, hostPlaying) {
    const session = navigator.mediaSession;
    if (!session) return;
    try {
      session.metadata = new MediaMetadata({
        title: songTitle(song) || "Reelody",
        artist: song?.artist || song?.uploader || "",
      });
      session.playbackState = hostPlaying ? "playing" : "paused";
    } catch {
      // Metadata is cosmetic. The handlers below are the part that matters.
    }
    // Every control on the notification and the keyboard reports here, and
    // each one is answered by going back to where the host is.
    const obeyHost = () => {
      resumeGuestRef.current("seek");
      resumeGuestRef.current("pause");
    };
    for (const name of [
      "play",
      "pause",
      "stop",
      "seekbackward",
      "seekforward",
      "seekto",
      "previoustrack",
      "nexttrack",
    ]) {
      try {
        session.setActionHandler(name, obeyHost);
      } catch {
        // This action isn't one the browser offers.
      }
    }
  }

  // A guest's headphone button, laptop media key, or phone notification all
  // land here. None of them are allowed to move the song off the host's clock.
  resumeGuestRef.current = (why) => {
    if (roomRoleRef.current !== "guest" || !roomPlayingRef.current) return;
    const audio = audioRef.current;
    if (!audio || (audio.src || "").startsWith("data:")) return;
    if (why === "seek") {
      const expected = expectedFromClock();
      if (Math.abs((audio.currentTime || 0) - expected) > 0.4) audio.currentTime = expected;
      return;
    }
    if (!audio.paused) return;
    // play() inside the pause event itself is ignored, including by a media
    // key and the phone notification. It has to run after that event ends.
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      if (roomRoleRef.current !== "guest" || !roomPlayingRef.current) return;
      const el = audioRef.current;
      if (!el || !el.paused || (el.src || "").startsWith("data:")) return;
      el.play().catch(() => {});
    }, 0);
  };

  closeSocketRef.current = () => {
    const existing = socketRef.current;
    socketRef.current = null;
    if (!existing) return;
    if (existing.ping) clearInterval(existing.ping);
    existing.handle.close();
  };

  stopRef.current = (clearAudio) => {
    wantRef.current = null;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    closeSocketRef.current();
    roomRoleRef.current = null;
    roomPlayingRef.current = false;
    clockRef.current = null;
    pendingSeekRef.current = null;
    clearGuestSession();
    setRoom(null);
    if (!clearAudio) return;
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
  };

  applyRef.current = (incoming) => {
    if (!incoming) return;
    if (incoming.code && wantRef.current && incoming.code !== wantRef.current) return;
    if (incoming.status === "ended" || incoming.status === "denied" || incoming.status === "kicked") {
      const message =
        incoming.status === "ended" ? "That room has ended." : "You can't join this room.";
      stopRef.current(true);
      setPlayerError(message);
      return;
    }
    if (incoming.status === "pending" || incoming.status === "joinable") {
      roomRoleRef.current = null;
      roomPlayingRef.current = false;
      setRoom(incoming);
      return;
    }
    if (incoming.status !== "open") return;
    noteClock(incoming);
    const role = incoming.role === "host" ? "host" : "guest";
    roomRoleRef.current = role;
    if (role === "guest") setQueueOpen(false);
    // Set before any play() or pause() below, so a pause we asked for is not
    // treated as the guest's media key and started again.
    roomPlayingRef.current = Boolean(incoming.playing);
    setRoom(incoming);
    if (incoming.loop) setLoopModeState(incoming.loop);

    const songs = incoming.queue || [];
    const idx = songs.length ? Math.max(0, Math.min(incoming.index || 0, songs.length - 1)) : -1;
    const song = idx >= 0 ? songs[idx] : null;
    const audio = audioRef.current;
    if (!song) {
      pendingSeekRef.current = null;
      if (audio && !audio.paused) audio.pause();
      setQueue([]);
      setCurrentIndex(-1);
      return;
    }
    const expected = expectedFromClock();
    const same =
      audio &&
      trackLoaded(audio, song) &&
      currentIndexRef.current === idx &&
      sameIds(queueRef.current, songs);
    if (same) {
      if (Math.abs((audio.currentTime || 0) - expected) > 0.4) {
        audio.currentTime = expected;
        setCurrentTime(expected);
      }
      if (roomPlayingRef.current && audio.paused) {
        audio.play().catch(() => {});
      } else if (!roomPlayingRef.current && !audio.paused) {
        audio.pause();
      }
    } else {
      pendingSeekRef.current = expected;
      setQueue(songs);
      setCurrentIndex(idx);
    }
    if (role === "guest") syncGuestSession(song, Boolean(incoming.playing));
    else clearGuestSession();
  };

  openSocketRef.current = (norm, attempt) => {
    if (wantRef.current !== norm) return;
    const handle = api.openRoomSocket(norm, {
      onMessage(msg) {
        if (wantRef.current !== norm) return;
        if (msg.type === "ping") {
          handle.send({ type: "pong" });
          if (msg.server_now && clockRef.current) {
            const serverNow = Date.parse(msg.server_now);
            if (Number.isFinite(serverNow)) clockRef.current.offset = serverNow - Date.now();
          }
          return;
        }
        if (msg.type === "error" && msg.error) setPlayerError(msg.error);
        if (msg.type === "state" && msg.room) applyRef.current(msg.room);
      },
      onClose() {
        if (socketRef.current?.handle === handle) {
          if (socketRef.current.ping) clearInterval(socketRef.current.ping);
          socketRef.current = null;
        }
        if (wantRef.current !== norm) return;
        const wait = Math.min(8000, 1000 * Math.max(1, attempt + 1));
        reconnectRef.current = setTimeout(() => openSocketRef.current(norm, attempt + 1), wait);
      },
    });
    const ping = setInterval(() => handle.send({ type: "ping" }), 20000);
    socketRef.current = { code: norm, handle, ping };
  };

  const watchRoom = useCallback((code) => {
    const norm = String(code || "")
      .replace(/[^0-9a-z]/gi, "")
      .toUpperCase();
    if (!norm) return;
    wantRef.current = norm;
    if (socketRef.current?.code === norm) return;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    closeSocketRef.current();
    openSocketRef.current(norm, 0);
  }, []);

  // Called from the join click, still inside that gesture, so the song the
  // host starts afterwards is allowed to play with no second tap.
  const primeRoomAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // A song already running is the unlock. Replacing it with silence would
    // cut the host off in the moment someone joins.
    if (audio.src && !audio.src.startsWith("data:") && !audio.paused) return;
    audio.src = SILENCE;
    audio.play().catch(() => {});
  }, []);

  const leaveRoom = useCallback(async () => {
    const code = wantRef.current;
    if (code) await api.leaveRoom(code);
    stopRef.current(true);
  }, []);

  useEffect(() => {
    function onMediaKey(event) {
      if (roomRoleRef.current !== "guest") return;
      const blocked = [
        "MediaPlayPause",
        "MediaStop",
        "MediaTrackNext",
        "MediaTrackPrevious",
        "MediaRewind",
        "MediaFastForward",
      ];
      if (!blocked.includes(event.key)) return;
      event.preventDefault();
      resumeGuestRef.current("pause");
    }
    window.addEventListener("keydown", onMediaKey);
    return () => window.removeEventListener("keydown", onMediaKey);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const audio = audioRef.current;
      const clock = clockRef.current;
      const role = roomRoleRef.current;
      if (!audio || !clock?.playing || (role !== "guest" && role !== "host")) return;
      if (roomRoleRef.current === "guest" && audio.paused) {
        // The first play() can be refused if it lands in the same moment as a
        // pause from a media key. Keep asking while the host is still playing.
        audio.play().catch(() => {});
        return;
      }
      if (audio.paused) return;
      const expected = expectedFromClock();
      if (Math.abs(audio.currentTime - expected) > 0.4) audio.currentTime = expected;
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Written on every change of what is playing, and on a short tick for the
  // playhead — timeupdate is far too chatty for localStorage. A room never
  // writes: its queue would 404 the moment the room closed, and reloading
  // should bring back the song you had before you joined.
  const persistRef = useRef(() => {});
  persistRef.current = () => {
    if (roomRoleRef.current) return;
    const audio = audioRef.current;
    const src = audio?.src || "";
    if (src.startsWith("data:")) return;
    const songs = queueRef.current.map(slimSong).filter(Boolean);
    const index = currentIndexRef.current;
    if (!songs.length || index < 0 || index >= songs.length) {
      clearStoredPlayer();
      return;
    }
    let time = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const pending = resumeAtRef.current;
    if (pending != null && time + 0.4 < pending) time = pending;
    const playingNow = Boolean(src && audio && !audio.paused);
    try {
      localStorage.setItem(
        PLAYER_KEY,
        JSON.stringify({
          queue: songs,
          index,
          time,
          playing: playingNow || Boolean(resumePlayRef.current && pending != null),
          volume: audio ? audio.volume : 1,
          loop: loopModeRef.current,
          playlistId: activePlaylistIdRef.current,
          shared: Boolean(activePlaylistSharedRef.current),
        })
      );
    } catch {
      // Storage full, or a private window. This page still plays.
    }
  };

  useEffect(() => {
    persistRef.current();
  }, [queue, currentIndex, playing, volume, loopMode, activePlaylistId]);

  useEffect(() => {
    const id = setInterval(() => persistRef.current(), 2000);
    const flush = () => persistRef.current();
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
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
      room,
      watchRoom,
      primeRoomAudio,
      leaveRoom,
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
      room,
      watchRoom,
      primeRoomAudio,
      leaveRoom,
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

function slimSong(song) {
  if (!song || typeof song.id !== "string" || !song.id) return null;
  const audio = typeof song.audio_url === "string" ? song.audio_url : "";
  if (audio.includes("/api/rooms/")) return null;
  return {
    id: song.id,
    title: song.title || "",
    track: song.track || "",
    artist: song.artist || "",
    uploader: song.uploader || "",
    thumbnail: song.thumbnail || "",
    duration: Number(song.duration) || 0,
    audio_url: audio,
    shared: Boolean(song.shared),
  };
}

function readStoredPlayer() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_KEY) || "null");
    if (!raw || !Array.isArray(raw.queue)) return null;
    const queue = raw.queue.map(slimSong).filter(Boolean);
    if (!queue.length) return null;
    const index = Math.max(0, Math.min(Number(raw.index) || 0, queue.length - 1));
    const time = Number(raw.time);
    const volume = Number(raw.volume);
    return {
      queue,
      index,
      time: Number.isFinite(time) ? Math.max(0, time) : 0,
      playing: Boolean(raw.playing),
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
      loop: raw.loop === "all" || raw.loop === "one" ? raw.loop : "off",
      playlistId: typeof raw.playlistId === "string" ? raw.playlistId : null,
      shared: Boolean(raw.shared),
    };
  } catch {
    return null;
  }
}

function clearStoredPlayer() {
  try {
    localStorage.removeItem(PLAYER_KEY);
  } catch {
    // A private window has no store to clear.
  }
}

function positionMs(audioOrSeconds) {
  const seconds =
    typeof audioOrSeconds === "number" ? audioOrSeconds : audioOrSeconds?.currentTime || 0;
  return Math.max(0, Math.round(seconds * 1000));
}

function trackLoaded(audio, song) {
  const src = audio.currentSrc || audio.src || "";
  if (!src || !song?.id) return false;
  return src.includes(`/songs/${song.id}/`) || src.includes(`song=${song.id}`);
}

function sameIds(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}
