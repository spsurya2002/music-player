// Every network call in the app goes through this file. If wiring to the
// backend breaks, this is the one place to fix it.
//
// Contract: docs/API.md at the repo root. Errors come back as
// `{"error": "a plain sentence"}` and the frontend renders that sentence
// verbatim. A request that never reaches the server (backend down, no
// network) throws a synthetic error with the same shape so callers never
// need to branch on "how" it failed.

import { emitUnauthorized } from "../utils/bus";

const BASE = "/api";

const UNREACHABLE = "Could not reach the server — is it still running?";

class ApiError extends Error {
  constructor(message, { status = null, body = null, networkError = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.networkError = networkError;
  }
}

async function request(path, { method = "GET", body, headers, signal } = {}) {
  // FormData goes up as-is: the browser has to set its own multipart boundary,
  // so this is the one case where we must not send a Content-Type of our own.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers:
        body !== undefined && !isForm ? { "Content-Type": "application/json", ...headers } : headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(UNREACHABLE, { networkError: true });
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    // The session went away — expired, revoked, or signed out in another tab.
    // Every caller would otherwise render "Sign in to continue." as if it were
    // about the thing they asked for, so tell the app instead and let it show
    // the login screen. /auth/* is exempt: signing in is how you fix this, and
    // a failed sign-in must not look like a session ending.
    if (res.status === 401 && !path.startsWith("/auth/")) {
      emitUnauthorized();
    }
    if (!data && [502, 503, 504].includes(res.status)) {
      // The dev proxy (or a reverse proxy in front of FastAPI) answered, but
      // the backend behind it didn't — same situation as it being down.
      throw new ApiError(UNREACHABLE, { status: res.status, networkError: true });
    }
    const message = (data && data.error) || `Something went wrong (${res.status}).`;
    throw new ApiError(message, { status: res.status, body: data });
  }

  return data;
}

// ---- Who's signed in ---------------------------------------------------------

// The Google client ID lives on the server, so one build of the UI works against
// any instance — nothing here is baked in at build time.
export function authConfig() {
  return request("/auth/config");
}

// `credential` is the ID token Google Identity Services handed the page. The
// server verifies it and answers with a session cookie.
export function signInWithGoogle(credential) {
  return request("/auth/google", { method: "POST", body: { credential } });
}

// 200 with `{user: null}` when nobody is signed in — that's the app's normal
// first state, not an error.
export function me() {
  return request("/auth/me");
}

export function signOut() {
  return request("/auth/logout", { method: "POST" });
}

// ---- Extraction (ephemeral) ------------------------------------------------

export function extract(url) {
  return request("/extract", { method: "POST", body: { url } });
}

export function matchToken(token) {
  return request(`/match/${token}`, { method: "POST" });
}

export function previewUrl(token) {
  return `${BASE}/preview/${token}`;
}

export function searchFreeText(q) {
  return request("/search", { method: "POST", body: { q } });
}

// ---- Identify a file you already have (ephemeral) ---------------------------

export function identifyFile(file) {
  const form = new FormData();
  form.append("audio", file);
  return request("/identify", { method: "POST", body: form });
}

export function identifyStatus(jobId) {
  return request(`/identify/${jobId}`);
}

export function identifyAudioUrl(jobId) {
  return `${BASE}/identify/${jobId}/audio`;
}

// Replaces the job's matches with what this search finds, so a save afterwards
// stores the result you picked rather than the one the tiers guessed.
export function identifySearch(jobId, q) {
  return request(`/identify/${jobId}/search`, { method: "POST", body: { q } });
}

// ---- Auto-ingest (the Android share target) ----------------------------------

// Queues a reel and returns straight away — the server does the work in the
// background, so this never waits for a download. 202, not 201.
export function ingestReel(url, origin = "share") {
  return request("/ingest", { method: "POST", body: { url, origin } });
}

export function listIngestJobs(limit) {
  const qs = limit != null ? `?limit=${limit}` : "";
  return request(`/ingest/jobs${qs}`);
}

// Finished rows only — anything still queued or downloading stays put.
export function clearIngestJobs() {
  return request("/ingest/jobs", { method: "DELETE" });
}

// ---- Songs ------------------------------------------------------------------

// Saves either a reel extraction (token) or an identified upload (job).
export function saveSong({ token, job, playlistId } = {}) {
  const body = token ? { token } : { job };
  if (playlistId) body.playlist_id = playlistId;
  return request("/songs", { method: "POST", body });
}

export function listSongs({ q, sort, limit, skip } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sort) params.set("sort", sort);
  if (limit != null) params.set("limit", limit);
  if (skip != null) params.set("skip", skip);
  const qs = params.toString();
  return request(`/songs${qs ? `?${qs}` : ""}`);
}

export function getSong(id) {
  return request(`/songs/${id}`);
}

export function updateSong(id, patch) {
  return request(`/songs/${id}`, { method: "PATCH", body: patch });
}

export function deleteSong(id) {
  return request(`/songs/${id}`, { method: "DELETE" });
}

export function songAudioUrl(id) {
  return `${BASE}/songs/${id}/audio`;
}

// The same bytes as songAudioUrl, sent as an attachment so the browser saves
// the file instead of playing it. Used as a plain <a href download> — the
// session cookie rides along because it's same-origin, and Chrome's download
// manager (the installed Android app included) takes it from there.
export function songDownloadUrl(id) {
  return `${BASE}/songs/${id}/audio?dl=1`;
}

export function markPlayed(id) {
  return request(`/songs/${id}/played`, { method: "POST" });
}

export function refreshYoutube(id) {
  return request(`/songs/${id}/youtube/refresh`, { method: "POST" });
}

// ---- Lyrics and meaning --------------------------------------------------------

// The row is the job and the result in one, so this is both the first load and
// the poll target while a lookup runs. `lyrics` is null until someone asks.
export function getLyrics(id) {
  return request(`/songs/${id}/lyrics`);
}

// 202 and a queued row — a crawl plus a model call runs for tens of seconds,
// far past what the tunnel in front of the API will hold open. `refresh` re-runs
// a lookup that already finished; retrying one that failed needs no flag.
export function findLyrics(id, refresh = false) {
  return request(`/songs/${id}/lyrics`, { method: "POST", body: { refresh } });
}

// Look up anything — a YouTube link or a typed song name — with no library song
// behind it. 202 and a queued row, polled by id through getLyricsRow.
export function searchLyrics(q, refresh = false) {
  return request("/lyrics/search", { method: "POST", body: { q, refresh } });
}

// One saved lookup by its own id. The Lyrics page's poll target.
export function getLyricsRow(id) {
  return request(`/lyrics/${id}`);
}

// Everything looked up so far, newest first. `origin` is "search" or "song";
// `q` matches the names the finder worked out as well as what was typed.
export function listLyrics({ limit, origin, q } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", limit);
  if (origin) params.set("origin", origin);
  if (q) params.set("q", q);
  const qs = params.toString();
  return request(`/lyrics${qs ? `?${qs}` : ""}`);
}

// The second step, and the one that costs: read the words we already found.
// 202 and a row to poll.
export function explainLyrics(id) {
  return request(`/lyrics/${id}/meaning`, { method: "POST" });
}

// Running a search does not save it. This is the yes; deleteLyrics is the no.
export function keepLyrics(id) {
  return request(`/lyrics/${id}/keep`, { method: "POST" });
}

export function deleteLyrics(id) {
  return request(`/lyrics/${id}`, { method: "DELETE" });
}

// Collections of saved lookups — the lyrics answer to playlists. A collection
// groups them; deleting one never deletes the lookups inside it.
export function listLyricsCollections() {
  return request("/lyrics/collections");
}

export function createLyricsCollection(name, description = "") {
  return request("/lyrics/collections", { method: "POST", body: { name, description } });
}

export function getLyricsCollection(id) {
  return request(`/lyrics/collections/${id}`);
}

export function updateLyricsCollection(id, patch) {
  return request(`/lyrics/collections/${id}`, { method: "PATCH", body: patch });
}

export function deleteLyricsCollection(id) {
  return request(`/lyrics/collections/${id}`, { method: "DELETE" });
}

export function addToLyricsCollection(id, lyricsId) {
  return request(`/lyrics/collections/${id}/items`, {
    method: "POST",
    body: { lyrics_id: lyricsId },
  });
}

export function removeFromLyricsCollection(id, lyricsId) {
  return request(`/lyrics/collections/${id}/items/${lyricsId}`, { method: "DELETE" });
}

// ---- Playlists ---------------------------------------------------------------

export function listPlaylists() {
  return request("/playlists");
}

export function createPlaylist({ name, description }) {
  const body = { name };
  if (description) body.description = description;
  return request("/playlists", { method: "POST", body });
}

export function getPlaylist(id) {
  return request(`/playlists/${id}`);
}

export function updatePlaylist(id, patch) {
  return request(`/playlists/${id}`, { method: "PATCH", body: patch });
}

export function deletePlaylist(id) {
  return request(`/playlists/${id}`, { method: "DELETE" });
}

export function addSongToPlaylist(playlistId, songId) {
  return request(`/playlists/${playlistId}/songs`, { method: "POST", body: { song_id: songId } });
}

export function removeSongFromPlaylist(playlistId, songId) {
  return request(`/playlists/${playlistId}/songs/${songId}`, { method: "DELETE" });
}

export function reorderPlaylist(playlistId, songIds) {
  return request(`/playlists/${playlistId}/order`, { method: "PATCH", body: { song_ids: songIds } });
}

// ---- Sharing ------------------------------------------------------------------

// Sharing is a property of the playlist, so it goes through the same PATCH as
// renaming one. Public means public: anyone signed in can find it, play it and
// take a copy.
export function setPlaylistShared(id, isPublic) {
  return request(`/playlists/${id}`, { method: "PATCH", body: { is_public: isPublic } });
}

// Everyone's public playlists, most recently shared first — the caller's own
// included, flagged `mine`.
export function listSharedPlaylists() {
  return request("/shared/playlists");
}

// Read-only, and its songs carry their own `audio_url` pointing back here — the
// library's own /songs/{id}/audio scopes to the caller and would 404.
export function getSharedPlaylist(id) {
  return request(`/shared/playlists/${id}`);
}

export function sharedSongDownloadUrl(id) {
  return `${BASE}/shared/songs/${id}/audio?dl=1`;
}

// Copies the playlist and any songs the caller hasn't already got, and answers
// with `{playlist, added, already_had}`.
export function copySharedPlaylist(id, name) {
  return request(`/shared/playlists/${id}/copy`, { method: "POST", body: name ? { name } : {} });
}

// ---- Limits and asking for more ------------------------------------------------

// The two paid features — reel extraction and file lookup — each have a
// lifetime allowance. `{quota: {reel: {used, limit, left}, file: {...}, is_admin}}`,
// where a null limit means unlimited. Also arrives with /auth/me.
export function getQuota() {
  return request("/quota");
}

// A used-up limit comes back as a 402 with `quota: "reel" | "file"` beside the
// sentence, so a view can offer the Plan page instead of just printing it.
export function isQuotaError(err) {
  return Boolean(err && err.status === 402);
}

export function listLimitRequests() {
  return request("/requests");
}

export function createLimitRequest(message) {
  return request("/requests", { method: "POST", body: { message } });
}

// Ask about a request that is still waiting — "any idea how long?". Only
// while it's pending; once it's answered the thing to send is a new request.
export function askAboutRequest(id, text) {
  return request(`/requests/${id}/notes`, { method: "POST", body: { text } });
}

// Opening the Plan page reads every answer on it.
export function markLimitRequestsSeen() {
  return request("/requests/seen", { method: "POST" });
}

// `{unread, pending}` — pending is null unless you're an admin.
export function limitRequestSummary() {
  return request("/requests/summary");
}

// ---- Feedback -----------------------------------------------------------------

// What you think of the app. Free, unlimited by design, and signed in — the
// admin reading it needs to know who to go back to.
export function sendFeedback({ rating, message }) {
  return request("/feedback", { method: "POST", body: { rating, message } });
}

// ---- Admin --------------------------------------------------------------------

// 404 for anyone who isn't an admin, the same as a path that doesn't exist.
export function adminListRequests(state = "pending") {
  return request(`/admin/requests?state=${encodeURIComponent(state)}`);
}

// `decision` is "approve" | "decline". `limits` holds new totals for the
// features being changed; a null value there means unlimited.
export function adminResolveRequest(id, { decision, reply, limits }) {
  const body = { decision, reply };
  if (limits) body.limits = limits;
  return request(`/admin/requests/${id}/resolve`, { method: "POST", body });
}

// Say something on an open request without deciding it — the other half of
// askAboutRequest above.
export function adminAddRequestNote(id, text) {
  return request(`/admin/requests/${id}/notes`, { method: "POST", body: { text } });
}

export function adminListUsers(q) {
  return request(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function adminSetLimits(userId, limits) {
  return request(`/admin/users/${userId}/limits`, { method: "PATCH", body: limits });
}

// Everything anyone has said, newest first, plus a tally over the whole
// collection rather than over the page returned.
export function adminListFeedback() {
  return request("/admin/feedback");
}

export function adminDeleteFeedback(id) {
  return request(`/admin/feedback/${id}`, { method: "DELETE" });
}

// ---- Health -------------------------------------------------------------------

export function health() {
  return request("/health");
}

export { ApiError, UNREACHABLE };
