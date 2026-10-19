// Tiny pub/sub so independent views (sidebar playlist list, playlists grid,
// a playlist's own detail page) can tell each other "playlists changed"
// without pulling in a state library for one signal.

const EVENT = "reel-audio:playlists-changed";
const UNAUTHORIZED = "reel-audio:unauthorized";
const SIGNED_OUT = "reel-audio:signed-out";
const LIMITS_CHANGED = "reel-audio:limits-changed";
const ABOUT_CHANGED = "reel-audio:about-changed";

export function emitPlaylistsChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function onPlaylistsChanged(callback) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

// A request came back 401: the session is gone. AuthContext listens and drops
// the user, which puts the login screen back up.
export function emitUnauthorized() {
  window.dispatchEvent(new Event(UNAUTHORIZED));
}

export function onUnauthorized(callback) {
  window.addEventListener(UNAUTHORIZED, callback);
  return () => window.removeEventListener(UNAUTHORIZED, callback);
}

// Somebody left. The player listens for this and empties itself — the next
// person to sign in on this browser must not find a stranger's queue loaded,
// and its audio URLs would 404 for them anyway.
export function emitSignedOut() {
  window.dispatchEvent(new Event(SIGNED_OUT));
}

export function onSignedOut(callback) {
  window.addEventListener(SIGNED_OUT, callback);
  return () => window.removeEventListener(SIGNED_OUT, callback);
}

// A use was spent, a request was sent or answered, or someone's limits moved.
// AuthContext re-reads the quota and the sidebar re-reads its badges.
export function emitLimitsChanged() {
  window.dispatchEvent(new Event(LIMITS_CHANGED));
}

export function onLimitsChanged(callback) {
  window.addEventListener(LIMITS_CHANGED, callback);
  return () => window.removeEventListener(LIMITS_CHANGED, callback);
}

// The admin changed the About page. The rail, the phone sheet and the account
// menu all read the same document to decide whether to show an entry and what
// to call it, so they re-read rather than waiting for a reload — an editor
// who has to refresh to see their own change assumes the save didn't work.
export function emitAboutChanged() {
  window.dispatchEvent(new Event(ABOUT_CHANGED));
}

export function onAboutChanged(callback) {
  window.addEventListener(ABOUT_CHANGED, callback);
  return () => window.removeEventListener(ABOUT_CHANGED, callback);
}
