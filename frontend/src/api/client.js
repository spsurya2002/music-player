// Every network call in the app goes through this file. If wiring to the
// backend breaks, this is the one place to fix it.
//
// Contract: docs/API.md at the repo root. Errors come back as
// `{"error": "a plain sentence"}` and the frontend renders that sentence
// verbatim. A request that never reaches the server (backend down, no
// network) throws a synthetic error with the same shape so callers never
// need to branch on "how" it failed.

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

export function markPlayed(id) {
  return request(`/songs/${id}/played`, { method: "POST" });
}

export function refreshYoutube(id) {
  return request(`/songs/${id}/youtube/refresh`, { method: "POST" });
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

// ---- Health -------------------------------------------------------------------

export function health() {
  return request("/health");
}

export { ApiError, UNREACHABLE };
