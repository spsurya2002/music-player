# Reel Audio — API contract

The single source of truth shared by the backend and the frontend. Both are built
against this document; neither side invents a payload and changes the other later.

Backend: FastAPI on `http://127.0.0.1:8000`.
Frontend: Vite dev server on `5173`, proxying `/api` to `8000`. In production FastAPI
serves the built frontend, so the app is one origin and one command.

## Conventions

- All request and response bodies are JSON, except audio streams and the extract preview.
- IDs are MongoDB ObjectIds serialised as 24-character hex **strings**, always in a field
  called `id` (never `_id`) by the time they reach the client.
- Timestamps are ISO-8601 UTC strings.
- Errors: non-2xx with `{"error": "a plain sentence"}`. The frontend renders `error`
  verbatim, so it must read as English, not as a code. Check `r.ok` before using a body.
- `duration` is seconds (int), `size` is bytes (int).

## Two-phase flow: extract, then save

Extraction is **ephemeral**. Pasting a link produces a temp file plus a `token`; nothing
touches MongoDB until the user presses Save. This keeps junk out of the library and makes
the search screen feel instant.

```
POST /api/extract      ->  token (temp mp3 on disk)
POST /api/match/{tok}  ->  identification + youtube matches
GET  /api/preview/{tok}->  play it before deciding
POST /api/songs        ->  persist to GridFS + Mongo  (the CRUD boundary)
```

Tokens are process-memory only and die with a restart. Saved songs are permanent.

---

## 1. Extraction (ephemeral)

### `POST /api/extract`
Body `{"url": "https://www.instagram.com/reel/..."}`

200:
```json
{
  "token": "hex32",
  "filename": "Artist - Track.mp3",
  "title": "Artist - Track",
  "track": "Track or null",
  "artist": "Artist or null",
  "uploader": "instagram display name",
  "instagram_url": "the cleaned url that was fetched",
  "duration": 47,
  "size": 1217531,
  "thumbnail": "https://... or null"
}
```
4xx/5xx: `{"error": "..."}` — reuse the existing `friendly_error()` sentences.

### `POST /api/match/{token}`
No body. Identifies the song and ranks YouTube candidates.

200 identified:
```json
{
  "identified": true,
  "song": {"track": "...", "artist": "...", "source": "Instagram music sticker",
           "confidence": "high", "shazam_url": "... or null", "cover": "... or null"},
  "results": [ YouTubeMatch, ... ]
}
```
200 not identified: `{"identified": false, "reason": "a sentence explaining why"}`

**YouTubeMatch** (used everywhere YouTube results appear):
```json
{"id": "dQw4w9WgXcQ", "url": "https://www.youtube.com/watch?v=...",
 "title": "...", "channel": "...", "duration": 212,
 "thumbnail": "https://i.ytimg.com/vi/<id>/mqdefault.jpg", "score": 100}
```
`id` is the YouTube video id — the frontend needs it for the embedded player.

### `GET /api/preview/{token}`
The temp MP3, `audio/mpeg`, supports Range. `?dl=1` for attachment download.

### `POST /api/search`
Body `{"q": "free text"}` -> `{"results": [YouTubeMatch, ...]}`

---

## 1b. Identify a file you already have (ephemeral)

Same shape of answer as `/api/match`, from the other direction: instead of an Instagram
post it takes an audio file, so there is no music sticker to read and no post metadata —
only the audio. The tiers (Shazam, then AcoustID, the file's own caption tags, and Whisper
on the lyrics) live in `backend/services/file_identify.py`, ported unchanged from the
standalone tool, and are not tuned there.

`backend/services/file_match.py` decides how far to trust each one:

- **A caption is a guess.** The tags carry the post's caption, which is free text about
  anything — one real file's read "First 10 days of a 30 day program" and confidently
  returned a fitness video. Only Instagram's bracketed credit list is trusted outright;
  free prose over six words is held back, the audio is asked first, and the caption is
  used as a labelled fallback (`"guess": true`, `confidence: "low"`) only if nothing else
  answers.
- **Results are ranked, never taken in order.** The tiers resolved a link with
  `ytsearch1:` — YouTube's first hit, with nothing to stop a slowed edit or an hour-long
  loop winning. Candidates now go through the same `services/identify.py` ranker the reel
  flow uses, so both halves of the app judge a result the same way.

The Whisper tier transcribes the whole track on CPU, so a run can last minutes. This flow
is therefore a **job**, not a request: start it, then poll. Jobs are process memory and
die with a restart, like extract tokens. Uploads land in `backend/uploads/`, never Mongo.

### `POST /api/identify`
`multipart/form-data` with one field, `audio`. Extensions: mp3, m4a, wav, ogg, flac, aac,
opus, mp4, webm. Max 64 MB.

200: `{"job": "hex32", "file": "what you uploaded.mp3", "size": 743773}`

### `GET /api/identify/{job}`
Poll this (~1.5s) until `state` leaves `running`.

```json
{
  "job": "hex32",
  "state": "running | done | error",
  "file": "what you uploaded.mp3",
  "log": ["[shazam] Kali Kali Zulfon Ke Nusrat Fateh Ali Khan", "YouTube: https://..."],
  "error": null,
  "result": {
    "source": "shazam | acoustid | caption | lyrics | manual | null",
    "source_label": "audio fingerprint (Shazam)",
    "confidence": "high | medium | low | null",
    "guess": false,
    "query": "what was searched for on YouTube",
    "track": {"title": "...", "artist": "...", "cover": "...", "shazam_url": "..."},
    "results": [ YouTubeMatch, ... ]
  }
}
```

`result` is null while running. On `done` it always exists, but every field inside it can
be null or empty — nothing matching is an ordinary outcome, not an error. `track` is only
filled in by the Shazam tier. `results` is ranked best-first, same `YouTubeMatch` shape as
everywhere else, so the page can offer alternatives instead of one link. **`guess: true`
means the caption named this, not the audio** — the UI must say so and must not badge the
top result `BEST`. `log` is the pipeline's own progress lines, shown verbatim so a long
run doesn't look hung.

### `POST /api/identify/{job}/search`
Body `{"q": "free text"}`. Runs the same ranked search as `POST /api/search` and
**replaces the job's `results`** with what it finds, setting `source: "manual"`. Saving
afterwards stores what the user picked rather than what the tiers guessed — the same
pattern as `extractor.set_match()` caching a reel's match against its token.

200: `{"result": { …the job's result, updated… }}`

### `GET /api/identify/{job}/audio`
The uploaded file back, for playback. Supports Range.

---

## 2. Songs (the library / "All Songs")

"All Songs" is **not a stored playlist**. It is the `songs` collection itself, so a saved
song cannot go missing from it and there is no membership to keep in sync.

**Song** object:
```json
{
  "id": "hex24",
  "title": "Artist - Track",
  "track": "Track or null",
  "artist": "Artist or null",
  "uploader": "instagram display name",
  "instagram_url": "https://www.instagram.com/reel/... — null for an upload",
  "source": "instagram | upload",
  "source_file": "what you uploaded.mp3 — null for a reel",
  "thumbnail": "https://... or null",
  "duration": 47,
  "size": 1217531,
  "identified": true,
  "identify_source": "Instagram music sticker",
  "confidence": "high",
  "youtube": [ YouTubeMatch, ... ],
  "audio_url": "/api/songs/<id>/audio",
  "storage": "gridfs",
  "play_count": 0,
  "last_played_at": null,
  "created_at": "2026-09-21T10:30:00Z",
  "updated_at": "2026-09-21T10:30:00Z",
  "playlist_ids": ["hex24", ...]
}
```

`instagram_url` and `youtube` are kept permanently — requirement: opening a saved song
must show its YouTube links and the Instagram link it came from.

### Two kinds of song, one collection

A song is either a reel extraction (`source: "instagram"`) or an identified upload
(`source: "upload"`). They sit in the same collection and are otherwise treated
identically — All songs lists both, the player plays both, and either can go in any
playlist. The UI tells them apart with a tag: **INSTA** or **MP3**.

An upload **omits `instagram_url` entirely** rather than storing null. The unique index on
that field is partial (`{"instagram_url": {"$type": "string"}}`), because a plain unique
index counts every missing field as the same null and the second upload would collide with
the first. A document with an explicit null would hit that too, so: omit, don't nullify.
A song saved before uploads existed has no `source` field; the serializer reads that as
`"instagram"`.

Uploads have no reel URL to deduplicate on, so the same **filename at the same byte size**
counts as already saved and returns `409` with `That file is already in your library.`

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/api/songs` | `{"token": "hex32"}` or `{"job": "hex32"}` | `201` Song — moves the temp file into storage and writes the doc. `token` saves a reel extraction, `job` saves an identified upload (409 while that job is still running). Both accept optional `{"playlist_id": "hex24"}` to file it straight into a playlist. |
| `GET` | `/api/songs` | — | `{"songs": [Song...], "total": n}`. Query: `q` (matches title/artist/uploader, case-insensitive), `sort` = `recent`\|`title`\|`artist`\|`plays` (default `recent`), `limit`, `skip`. |
| `GET` | `/api/songs/{id}` | — | Song |
| `PATCH` | `/api/songs/{id}` | any of `{title, track, artist}` | updated Song |
| `DELETE` | `/api/songs/{id}` | — | `{"deleted": true}` — removes the stored file **and** every playlist membership. |
| `GET` | `/api/songs/{id}/audio` | — | MP3 stream, **must support `Range`** (206 + `Content-Range` + `Accept-Ranges: bytes`), or seeking breaks. |
| `POST` | `/api/songs/{id}/played` | — | `{"play_count": n}` — fire-and-forget from the player. |
| `POST` | `/api/songs/{id}/youtube/refresh` | — | updated Song — re-runs the YouTube search: by track + artist when the song has a name, else free-text on the words that identified it (`identify_query`, set by the lyrics and caption tiers). With neither, the stored matches are **left alone** rather than replaced with an empty list. |

Saving the same Instagram URL twice returns the existing song with `409`
`{"error": "...", "song": Song}` rather than duplicating it. The frontend treats 409 as
"already in your library" and offers to open it.

---

## 3. Playlists

**Playlist** object:
```json
{
  "id": "hex24",
  "name": "Late night",
  "description": "" ,
  "loop": "off",
  "song_ids": ["hex24", ...],
  "song_count": 12,
  "duration": 1840,
  "cover": "https://... or null",
  "created_at": "...",
  "updated_at": "..."
}
```
`loop` is one of `off` | `all` | `one`, persisted **per playlist** — requirement: each
playlist carries its own loop setting. `cover` is the thumbnail of the first song, derived
server-side; the client does not set it. Order of `song_ids` **is** the playback order.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/playlists` | — | `{"playlists": [Playlist...]}` |
| `POST` | `/api/playlists` | `{"name", "description"?}` | `201` Playlist. Duplicate name -> `409 {"error"}`. |
| `GET` | `/api/playlists/{id}` | — | `{"playlist": Playlist, "songs": [Song...]}` — songs in playlist order, ready to become a queue. |
| `PATCH` | `/api/playlists/{id}` | any of `{name, description, loop}` | updated Playlist |
| `DELETE` | `/api/playlists/{id}` | — | `{"deleted": true}` — deletes the playlist only, never the songs. |
| `POST` | `/api/playlists/{id}/songs` | `{"song_id"}` or `{"song_ids": [...]}` | updated Playlist. Adding a song already present is a no-op, not an error. |
| `DELETE` | `/api/playlists/{id}/songs/{song_id}` | — | updated Playlist |
| `PATCH` | `/api/playlists/{id}/order` | `{"song_ids": [...]}` | updated Playlist — full reorder; must contain exactly the current members. |

---

## 4. Health / meta

`GET /api/health` -> `{"ok": true, "storage": "gridfs", "songs": n, "playlists": n,
"authenticated": true|false}` — `authenticated` reports whether an Instagram session was
found, so the UI can explain sticker lookups being unavailable.

---

## Error sentences (reuse, don't reinvent)

- Bad URL: `That doesn't look like an Instagram post/reel URL.`
- Login needed: the existing cookies sentence from `friendly_error()`.
- Missing token: `That extraction has expired — paste the link again.`
- Missing identify job: `That identification has expired — upload the file again.`
- No file uploaded: `Choose an audio file first.`
- Missing song/playlist: `That song is no longer in your library.` /
  `That playlist doesn't exist any more.`
- Duplicate playlist name: `You already have a playlist called "X".`
