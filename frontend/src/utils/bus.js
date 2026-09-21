// Tiny pub/sub so independent views (sidebar playlist list, playlists grid,
// a playlist's own detail page) can tell each other "playlists changed"
// without pulling in a state library for one signal.

const EVENT = "reel-audio:playlists-changed";

export function emitPlaylistsChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function onPlaylistsChanged(callback) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
