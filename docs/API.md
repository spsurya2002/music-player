# Reelody — API contract

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
  A few failures carry one extra field beside `error` for the client to act on — so far
  only a used-up limit: `402 {"error": "...", "quota": "reel" | "file" | "lyrics" | "meaning"}`
  (section 3b).
- `duration` is seconds (int), `size` is bytes (int).
- **Every endpoint except `/api/auth/config`, `/api/auth/me` and `/api/health` requires a
  signed-in session** and answers `401 {"error": "Sign in to continue."}` without one. See
  section 0.

## 0. Sign in (Google)

The library is per-person: a song, a playlist, a play count and an extraction in progress
all belong to one account, and nothing is shared or visible between accounts.

The browser does the OAuth dance with Google itself — Google Identity Services, loaded on
the login screen — and hands the backend one **ID token**. The backend verifies it against
Google's public keys (`google-auth`, locally, no secret needed), upserts the person into
`users`, and issues a session of its own.

```
browser -> Google      ->  ID token (JWT, audience = GOOGLE_CLIENT_ID)
POST /api/auth/google  ->  verify, upsert user, Set-Cookie: reel_session
GET  /api/auth/me      ->  who is this, on every page load
POST /api/auth/logout  ->  delete the session row and the cookie
```

The session cookie is opaque (a random id), `HttpOnly`, `SameSite=Lax`, and backed by a row
in `sessions` with an `expires_at` TTL index. It carries **no claims**, so nothing in it is
believed without a database lookup — and signing out genuinely revokes it, which a
self-signed JWT could not. Set `SESSION_COOKIE_SECURE=1` when serving over https.

Config: `GOOGLE_CLIENT_ID` (required to sign anyone in), `SESSION_DAYS` (default 30),
`ALLOWED_EMAILS` (optional comma-separated guest list), `LEGACY_OWNER_EMAIL` (who inherits
the pre-login library), `ADMIN_EMAILS` (who runs the instance — default
`spsuryamishra@gmail.com`; always allowed to sign in, see section 3c).

### `GET /api/auth/config`
Public. `{"google_client_id": "…apps.googleusercontent.com" | null, "configured": true}` —
the frontend reads the client ID from here rather than a build-time env var, so one UI
build works against any instance. A client ID is not a secret.

### `POST /api/auth/google`
Body `{"credential": "<the ID token Google gave the page>"}`

200: `{"user": User, "stats": {"songs": n, "playlists": n, "plays": n}, "quota": Quota}` plus
the session cookie (Quota: section 3b). Failures: `401` bad or expired token, `403` unverified email or an account not on
`ALLOWED_EMAILS`, `503` the server has no `GOOGLE_CLIENT_ID`.

**User** object — display only, and refreshed from Google's claims on every sign-in:
```json
{"id": "hex24", "email": "you@gmail.com", "name": "Your Name", "given_name": "Your",
 "picture": "https://lh3.googleusercontent.com/... or null", "is_admin": false,
 "created_at": "...", "last_login_at": "..."}
```

### `GET /api/auth/me`
`{"user": User, "stats": {...}, "quota": Quota}`, or **`200 {"user": null}`** when nobody is signed in —
not a 401, because "nobody yet" is the app's normal first state. The frontend calls this
once on load to decide between the shell and the login screen.

### `POST /api/auth/logout`
`{"signed_out": true}`, and the cookie is cleared. Safe to call with no session.

### What "yours" means everywhere else

- `songs` and `playlists` documents carry `user_id`; every query in every router filters on
  it. A song or playlist id belonging to someone else reads as **404**, never 403 — there
  is nothing to tell a caller about a row that isn't theirs.
- Uniqueness is per-user: two accounts may each save the same reel, and each may have a
  playlist called "Gym". Both indexes are compound on `user_id`.
- Extract tokens and identify jobs (process memory) record who created them and are only
  redeemable by that person; someone else's reads as expired.
- Pre-login rows have no `user_id`. `LEGACY_OWNER_EMAIL` adopts them on sign-in; unset, the
  first account ever to sign in does.

---

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

**Spends one `reel` use** — only when it returns 200. A failed download gives the use
back. With none left: `402 {"error": "You've used all 5 of your reel extractions — ask for
more on the Plan page.", "quota": "reel"}`, before anything is fetched.

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

## 1a. Auto-ingest (the Android share target)

The same three calls as the two-phase flow — extract, match, save — run back to
back on the server, with nobody watching. Instagram's share sheet hands the
installed PWA a link at `/share`; that view calls `POST /api/ingest` and the
work happens behind it.

Queued rows live in Mongo (`ingest_jobs`), not process memory: a share can
arrive at any moment and losing one to a restart would lose something the person
already asked for. A row left `running` when the server stops is requeued at the
next boot — its extract token died with the process, so the work restarts rather
than resumes. The worker runs **one job at a time**; Instagram rate-limits a
session that asks too fast.

### `POST /api/ingest`
Body `{"url": "https://www.instagram.com/reel/...", "origin": "share"}`.
`origin` is a free label recording how the link arrived, and defaults to
`"share"`. The URL is validated and stripped of tracking params exactly as
`POST /api/extract` does.

**202** — accepted, not created. Nothing exists in the library yet:
```json
{"job": IngestJob}
```
Sharing the same reel twice while the first is still queued or running returns
**the same job**, not a second one — double-tapping the share sheet must not
cost two downloads.

4xx: `{"error": "..."}` — reuses `MISSING_URL` and `BAD_URL`. `402` (with `quota: "reel"`)
when the reel limit is already used up — said here, while the share screen is open,
rather than as a row that fails later. It's only a check: the use is spent by the worker.

**IngestJob**:
```json
{
  "id": "hex24",
  "url": "https://www.instagram.com/reel/...",
  "state": "queued | running | done | duplicate | failed | limited",
  "origin": "share",
  "song_id": "the saved song's id, once there is one, else null",
  "title": "the saved song's title, else null",
  "error": "a sentence, when state is failed or limited, else null",
  "created_at": "ISO-8601 Z",
  "finished_at": "ISO-8601 Z or null"
}
```
`duplicate` is a **success**: the reel is in the library, it just didn't need
saving twice, and `song_id` points at the row that was already there.

Each job spends one `reel` use, kept once the song is saved. A `failed` or `duplicate`
job gives it back. `limited` means the reel limit ran out before this job's turn — not a
fault, so the Inbox offers the Plan page rather than reading it as broken.

### `GET /api/ingest/jobs`
`?limit=` (default 20, capped at 100) -> `{"jobs": [IngestJob, ...]}`, newest
first. This is what the Inbox view polls, every 3s and only while something is
still `queued` or `running`.

### `DELETE /api/ingest/jobs`
Removes this user's finished rows -> `{"cleared": 3}`. Anything still queued or
running is left alone.

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

**Holds one `file` use** while the job runs, and keeps it only if the job ends with at
least one YouTube result. "Nothing matched" and a job that errors are free. With none
left: `402` with `quota: "file"`, before the upload is written.

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
| `GET` | `/api/songs/{id}/audio` | — | MP3 stream, **must support `Range`** (206 + `Content-Range` + `Accept-Ranges: bytes`), or seeking breaks. `?dl=1` sends it as an attachment named `Artist - Track.mp3` when the song is identified (else its title) — what the Download buttons link to. |
| `POST` | `/api/songs/{id}/played` | — | `{"play_count": n}` — fire-and-forget from the player. |
| `POST` | `/api/songs/{id}/youtube/refresh` | — | updated Song — re-runs the YouTube search: by track + artist when the song has a name, else free-text on the words that identified it (`identify_query`, set by the lyrics and caption tiers). With neither, the stored matches are **left alone** rather than replaced with an empty list. |

Saving the same Instagram URL twice returns the existing song with `409`
`{"error": "...", "song": Song}` rather than duplicating it. The frontend treats 409 as
"already in your library" and offers to open it.

---

## 2a. Lyrics and meaning

A song's words, and a line-by-line reading of them.

**Two steps, and they cost differently.** Finding words is a crawl, which is
ours to spend, so it is free. Reading them is a Gemini call and real money, so
that is the half behind a button and the half that spends a `lyrics` use. A row
carries a state for each: `state` for the words, `meaning_state` for the
reading — `null` until somebody asks.

A row is the job *and* the result, so there is no job id and no separate status
route: the page polls the same `GET` it loaded with.

The work happens in a background worker (`backend/services/lyrics_jobs.py`),
one lookup at a time. It has to: finding the words means asking the open lyrics
databases, then scraping search engines and crawling up to eight pages when they
come up empty, and then a model call on top. That runs for tens of seconds, well
past the 100 seconds Cloudflare allows a tunnelled request before a 524 — so
`POST` returns `202` and a queued row, exactly like auto-ingest.

**Lyrics are not on any shared route, and that is deliberate.** Lyrics belong to
their publishers; these are fetched for the person who owns the song, and the
response always carries the page they came from so it can be credited. Section
3a's routes are readable with no session at all, so putting lyrics there would
turn personal use into republishing.

**Lyrics** object:
```json
{
  "id": "66f0a1b2c3d4e5f6a7b8c9d0",
  "song_id": "66e1b2c3d4e5f6a7b8c9d0e1",
  "state": "done",
  "query": "Mehdi Hassan - Ranjish Hi Sahi",
  "text": "رنجش ہی سہی...",
  "source": {
    "url": "https://lrclib.net/api/get/1234567",
    "site": "lrclib.net",
    "page_title": "Ranjish Hi Sahi",
    "detected_title": "Ranjish Hi Sahi",
    "detected_artist": "Mehdi Hassan",
    "score": 0.98,
    "script": "arabic",
    "transliterated": false,
    "reasons": ["matched in the lrclib.net database", "title matches the track"]
  },
  "alternatives": [{ "...": "same shape as source, minus the words" }],
  "crawled": [{ "url": "https://genius.com/...", "ok": false, "reason": "page is not about this song" }],
  "meaning": {
    "summary": "Yeh ghazal ek aashiq ki bechaini...",
    "tradition": "ghazal",
    "poet": "Ahmed Faraz",
    "themes": ["Hijr", "Hasrat"],
    "lines": [
      {
        "n": 1,
        "text": "رنجش ہی سہی دل ہی دکھانے کے لیے آ",
        "roman": "ranjish hi sahi dil hi dukhane ke liye aa",
        "matlab": "Agar naaraazgi hi sahi, toh mera dil dukhane ke liye hi aa.",
        "note": "Yahan aashiq dard ko bhi visaal ka zariya samajhta hai.",
        "repeats_at": [14]
      }
    ],
    "terms": [
      {
        "word": "پندار",
        "roman": "pindaar",
        "hindi": "पिंदार",
        "urdu": "پِنْدار",
        "origin": "Persian",
        "part_of_speech": "Masculine, Noun",
        "senses": ["pride, conceit, arrogance"],
        "url": "https://www.rekhtadictionary.com/meaning-of-pindaar"
      }
    ],
    "model": "gemini-2.5-flash"
  },
  "meaning_state": "done",
  "meaning_note": null,
  "meaning_version": null,
  "mine": [
    {
      "id": "b6a5ee9575514e5aa4f810c33d04f100",
      "label": "",
      "text": "رنجش ہی سہی...",
      "script": "arabic",
      "created_at": "2026-10-04T18:02:00Z",
      "updated_at": "2026-10-04T18:02:00Z"
    }
  ],
  "manual_title": "",
  "manual_artist": "",
  "kept": true,
  "error": null,
  "created_at": "2026-10-03T09:14:00Z",
  "finished_at": "2026-10-03T09:14:38Z"
}
```

`state` is one of:

| state | means |
| --- | --- |
| `queued` | waiting its turn; one lookup runs at a time |
| `running` | being looked up now |
| `done` | the words are in `text` |
| `not_found` | we looked and found nothing we trust. **An answer, not a fault** — see below |
| `stopped` | you called it off; `error` says so. A finished lookup, not a fault |
| `manual` | nobody crawled — the row exists to hold words you added yourself |
| `failed` | something broke; `error` says what |
| `failed` *(meaning)* | the reading broke; `meaning_note` says why |
| `limited` *(meaning only)* | the lyric limit ran out before this row's turn |

`meaning_state` uses the same words plus `null` for "nobody has asked". Only a
reading can be `limited` now, because the words are free.

Every field is present from the first poll, `null` until there is something to
put in it. On anything but `done`, `text`, `source` and `meaning` are `null` and
`error` carries the sentence to show.

**`not_found` is the crawler working, not failing.** It refuses to return a page
it isn't confident about, because a confident wrong answer is worse than none.
Two sentences tell the two cases apart, and the difference is the only thing
that says whether waiting will help:

- `Couldn't find lyrics for this song — the pages we checked weren't it.`
- `The search engines turned us away this time — try again in a few minutes.`

`crawled` is kept in both cases — every page opened, in order, with why it
didn't work out.

**`meaning` can be `null` on a `done` row**, and that is not an error. The words
are the point; an explanation we couldn't get is a note beside them. Then
`meaning_note` says why — no `GEMINI_API_KEY` configured, lyrics too long for
one pass, or the only version we have is our own romanisation, which guesses the
short vowels the original doesn't write and is too shaky to read meaning from.

**The words can be yours.** `mine[]` is every version somebody typed or pasted
in themselves, oldest first. It is the answer to `not_found`: the crawler refuses
to guess, but the song is usually on the open web in ten seconds, so the page
offers somewhere to put it rather than a better apology. Adding one costs
nothing — no crawl, no model call — and keeps the row.

A version carries its own `script` (`latin` / `devanagari` / `arabic` / `other`,
detected from the text) and an optional `label`. An empty `label` means "name it
after its script", which is how it ends up in the same switcher as the crawler's
own per-script candidates rather than beside it.

`mine[]`, `manual_title` and `manual_artist` **survive a re-crawl**. Everything
else on the row is cleared when it goes back on the queue; these are not an
attempt at anything, they are what somebody typed.

**A row holds one reading, and `meaning_version` says which words it is about** —
`"mine:<id>"`, or `null` for the best the crawler found. Shown beside any other
version it would pair every line with somebody else's words, so the page renders
the reading only against its own version and offers to read the other instead.
`null` is also what every row written before this existed carries, and means the
same thing.

`manual_title` / `manual_artist` are what you called the lookup. A crawl that
found nothing resolved no names, so without them its only title is the raw thing
that was pasted — a YouTube URL, usually. They also win over `resolved` when the
reading is asked for.

`terms[]` is two shapes in one list. Words the Rekhta dictionary knew carry
`roman`, `origin`, `part_of_speech` and `url`; words only the model glossed carry
just `word` and `senses`. Both render the same way.

### `GET /api/songs/{song_id}/lyrics`

`{"lyrics": Lyrics}`, or `{"lyrics": null}` when nobody has looked yet. `null` is
an ordinary state — it's what the song page puts a button under — not a 404.
This is also the poll target while a lookup runs.

### `POST /api/lyrics/{row_id}/meaning`

Optional body `{"version": "mine:<id>"}` — which words to read. Omitted (or
`null`) means the best the crawler found, which is what every call meant before
versions could be yours.

`202` with `{"lyrics": Lyrics}` — the row with `meaning_state: "queued"`, ready
to poll. The paid step: one `lyrics` use (section 3b), held when the worker
starts and **kept only if a reading came back**. A missing `GEMINI_API_KEY`,
lyrics too long, or a model that refused all end as `meaning_state: "failed"`
with the reason in `meaning_note`, and refund the hold.

`400` if the row has no words yet: `There are no words on this one yet — find
them, or add your own.` `404` if the named version has since been deleted.

Asking again for **the same version** returns the reading without spending a
second use. Naming a **different** one is a second question: it clears the
reading, queues a new one and costs another use. The page confirms first.

### `POST /api/lyrics/{row_id}/mine`

`201` with `{"lyrics": Lyrics}`. Body `{"text": "...", "label": "..."}` — `label`
optional. Adds a version of your own and **keeps the row**: a lookup you have
bothered to type the words into is one you meant to keep, and otherwise your own
lyrics would live somewhere `GET /api/lyrics` never lists.

Free. `400` on empty text, `413` past 12,000 characters (what the sidecar will
read in one pass), `409` past 10 versions on one row.

### `PATCH /api/lyrics/{row_id}/mine/{version_id}`

`{"lyrics": Lyrics}`. Body `{"text": "...", "label": "..."}`, either field
omitted to leave it. Changing the **text** of the version a reading was made from
drops that reading — it explains the words line by line and would otherwise be a
commentary on a text that no longer exists. A label-only edit keeps it. `404` if
that version is gone.

### `DELETE /api/lyrics/{row_id}/mine/{version_id}`

`{"lyrics": Lyrics}`. Deleting the version a reading belongs to takes the reading
with it.

### `PATCH /api/lyrics/{row_id}`

`{"lyrics": Lyrics}`. Body `{"title": "...", "artist": "..."}`, either omitted to
leave it. What to call a lookup the finder could not name.

### `POST /api/songs/{song_id}/lyrics/mine`

`201` with `{"lyrics": Lyrics}`. Same body as above, for a song in the library.
The row may not exist yet — this is the path for a song nobody has looked up — so
one is created in `state: "manual"` on the way through. A song whose lookup has
already run lands on that row instead; nothing is reset.

### `GET /api/lyrics`

`{"lyrics": [Lyrics]}`, newest first — the saved lyrics library. **Only rows
with `kept: true`**: running a search does not put it here, see
`POST /api/lyrics/{row_id}/keep` below. `origin=search`
is what the Lyrics page found, `origin=song` what a song page started, and
unfiltered gives both. `q` matches the names the finder worked out as well as
what was typed, so a lookup started from a bare YouTube URL is findable by the
song's real name. `limit` defaults to 50, capped at 200.

### `GET` / `DELETE /api/lyrics/{row_id}`

One saved lookup, and removing one. `GET` finds a row whether or not it is
`kept` — the page that asks "keep this?" has to be able to show it. Deleting is
how you stop paying rent on a bad result; looking it up again costs another use
only for the reading.

### `POST /api/lyrics/{row_id}/stop`

`{"lyrics": Lyrics}` — the row, stopped. Stops whichever half is running: the
words if `state` is `queued`/`running`, otherwise the reading if
`meaning_state` is. `404` for a row that isn't yours.

**What "stop" promises, and what it doesn't.** Queued work is genuinely called
off — the worker only ever claims rows in `queued`, so moving one out means it
never starts. Work already out at the sidecar is *not* interrupted: the crawl
goes over `asyncio.to_thread`, a thread cannot be cancelled, and cutting the
worker loose would only have it start a second crawl alongside the first — which
is how the sidecar, whose politeness state is in process memory, gets itself
blocked at the search engines. So that crawl runs to the end and its answer is
thrown away.

Everything the caller can see does stop: the row leaves `running` immediately,
polling settles, and the page is usable again.

The discard is one conditional write — the worker only writes to a row still in
`running` — so Stop and a lookup landing can arrive in either order and exactly
one of them wins. Stopping a lookup that has just finished is therefore not an
error: the row comes back `done`, with its words, which is the truth.

A reading stopped before it landed **costs nothing**: the use is held while the
worker runs it and is only settled once the result is written, so a discarded
result releases the hold instead.

Nothing to stop is a no-op, not an error. The row comes back as it is.

### `POST /api/lyrics/{row_id}/keep`

`{"lyrics": Lyrics}` with `kept: true`. Idempotent, `404` for a row that isn't
yours.

`POST /api/lyrics/search` does **not** save what it finds. The row exists from
the moment it is queued, because the worker needs somewhere to write the
result, but it carries `kept: false` and stays out of `GET /api/lyrics` until
this route says otherwise — so a lookup you didn't want isn't something you
have to go and tidy up. The other answer is `DELETE`, which takes the row and
the words cached in it; after that the same query costs a fresh lookup.

A lookup started from a song's page (`POST /api/songs/{song_id}/lyrics`) is
`kept` from the start. It was asked for against a song already in the library
and it is read on that song's page, so there is nothing to decide.

Adding a row to a collection keeps it too — putting it somewhere is saying yes.
Rows written before this existed have no `kept` field, and a missing field
counts as kept.

### `POST /api/songs/{song_id}/lyrics`

Body `{"refresh": false}`. `202` with `{"lyrics": Lyrics}` — the queued row,
ready to poll.

**Free.** It costs a crawl, not money, and charging for it would put a price on
the crawler's honest "I found nothing".

Pressing it twice doesn't start two lookups, and asking again for a song already
`done` returns the existing row without spending a second use — only `refresh`
re-runs a finished lookup. A row that `failed` or found nothing is retried
without the flag, since that is what the button under it is for.

A song with no name to search by (no `track`, no `artist`, no `identify_query`,
no `title`) is a `400`: `We don't know what this song is yet — identify it
first, then try again.` With the sidecar down it's a `503`: `The lyrics service
isn't running — start the app with ./run.sh and try again.`

---

## 2d. Feedback

What someone thinks of the app. One route from this side; the reading end is in
section 3c with the other cross-user reads.

**Free, and no limit attached.** Putting a price on "this is broken" would only buy
silence about the things most worth hearing. There is a cap of **10 a day per person**,
which is a stuck button rather than an opinion: the 11th is
`429 That's a lot of feedback for one day — we've got it. Try again tomorrow.`

**Feedback**
```json
{"id": "hex24", "rating": 4, "message": "...", "created_at": "2026-10-03T06:03:28Z"}
```

### `POST /api/feedback`

Body `{"rating": 1..5, "message": "..."}`. `201` with `{"feedback": Feedback}`.

**Both halves are required.** `rating` is the only part that can be counted and it is one
tap; `message` is where anything actionable ever is. The message is trimmed, then must be
**at least 10 characters** — `400 Tell us a bit more — 10 characters at least.` — and at
most 2000. The floor is checked after trimming, in the router rather than as a pydantic
`min_length`, because ten spaces is not ten characters.

Signed in, because the admin reading it needs to know who to go back to, and an unsigned
box on the open internet is a spam funnel rather than a feedback form.

---

## 2e. The About page

Who built the app, and how to reach them. **Unauthenticated**, and that is the point:
this is the page a résumé and a LinkedIn profile link to, so almost everybody who opens
it has no account and wants none. It and section 3a are the only routes in the app that
answer with no session at all.

Every word of it is **one document in Mongo** (`settings`, `_id: "about"`), written from
section 3c. Nothing on the page is in the code — `backend/services/about_defaults.py`
seeds the document on first boot and backs the reset button, and is never read again.

**About** object:
```json
{"enabled": true, "in_nav": true,
 "nav_label": "About Developer", "nav_mini_label": "Notes",
 "title": "Liner notes", "subtitle": "...",
 "sections": [{"id": "built", "heading": "...", "body": "para\n\npara"}],
 "links": [{"kind": "email|github|linkedin|resume|site", "label": "Email", "value": "..."}],
 "contact_enabled": true, "contact_heading": "...", "contact_hint": "...",
 "contact_sent": "...", "updated_at": "2026-10-05T09:12:00Z"}
```

A section `body` is **plain text**: a blank line starts a paragraph and that is the whole
of the formatting. No Markdown and no HTML, so nothing an admin pastes can break the
design system.

### `GET /api/about`

`{"about": About}`.

**A link whose `value` is empty is left out of this response entirely** — that is how the
résumé button stays off the page until there is a URL behind it, with no second flag per
link. The admin shape (section 3c) keeps them, because they are the rows you type into.

When `enabled` is false the body stops at the flags:
```json
{"about": {"enabled": false, "in_nav": false}}
```
A page the admin has taken down should not still be shipping its copy to anyone who asks,
and the two flags are all the rail needs to leave the entry out.

---

## 2f. Writing to the developer

### `POST /api/contact`

Body `{"name": "...", "email": "...", "message": "...", "website": ""}`.
`201` with `{"sent": true, "message": ContactMessage}`.

**The one route in the app that stores something for a caller with no session.** Section
2d refuses to for good reason — an unsigned box on the open internet is a spam funnel —
and this one exists anyway because the people it is for will never sign in to a stranger's
music app to say hello. So it carries its own defences in place of one:

- **3 an hour and 10 a day per sender**, counted in process memory and keyed on
  `CF-Connecting-IP`, then `X-Forwarded-For`, then the socket. (The app is served through
  a Cloudflare tunnel, so the socket is the tunnel for everybody and would make the
  per-sender limit a global one.) Over either: `429`.
- **200 a day across everyone**, because an IP-keyed limit is worth what a botnet's
  address pool costs. Over it: `429 The message box has had a busy day — try again
  tomorrow, or email instead.`
- **`website` is a honeypot.** It is off-screen, untabbable and `aria-hidden`, so nobody
  fills it in on purpose. A filled one gets `{"sent": true}` and **is not stored** — a bot
  told which field caught it just stops filling that one in.
- `name` and a plausible `email` are required; `message` is trimmed and must then be
  **at least 10 characters**, at most 2000.

`user_id` is recorded when a session happens to be there — knowing a sender already uses
the app is worth something to whoever reads it — but it is never what lets them send.

**`404 No such endpoint.`** when the About page is switched off, or its `contact_enabled`
is false. Hiding the form while the route kept accepting posts would leave the thing
switched "off" still filling a collection.

**ContactMessage**
```json
{"id": "hex24", "name": "...", "email": "...", "message": "...",
 "signed_in": false, "created_at": "2026-10-05T09:12:00Z"}
```

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
  "is_public": false,
  "shared_at": null,
  "created_at": "...",
  "updated_at": "..."
}
```
`is_public` / `shared_at` are sharing — see section 3a. `loop` is one of `off` | `all` | `one`, persisted **per playlist** — requirement: each
playlist carries its own loop setting. `cover` is the thumbnail of the first song, derived
server-side; the client does not set it. Order of `song_ids` **is** the playback order.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/playlists` | — | `{"playlists": [Playlist...]}` |
| `POST` | `/api/playlists` | `{"name", "description"?}` | `201` Playlist. Duplicate name -> `409 {"error"}`. |
| `GET` | `/api/playlists/{id}` | — | `{"playlist": Playlist, "songs": [Song...]}` — songs in playlist order, ready to become a queue. |
| `PATCH` | `/api/playlists/{id}` | any of `{name, description, loop, is_public}` | updated Playlist |
| `DELETE` | `/api/playlists/{id}` | — | `{"deleted": true}` — deletes the playlist only, never the songs. |
| `POST` | `/api/playlists/{id}/songs` | `{"song_id"}` or `{"song_ids": [...]}` | updated Playlist. Adding a song already present is a no-op, not an error. |
| `DELETE` | `/api/playlists/{id}/songs/{song_id}` | — | updated Playlist |
| `PATCH` | `/api/playlists/{id}/order` | `{"song_ids": [...]}` | updated Playlist — full reorder; must contain exactly the current members. |

---

## 3a. Shared playlists (public)

Everywhere else a row that isn't yours is a `404` (see "What \"yours\" means everywhere
else"). This section is the one deliberate exception, and it is the widest one: a playlist
whose owner has set `is_public` can be listed, opened and played by **anyone at all, with
no session**. `GET /api/shared/playlists` is the app's home page, so it has to answer a
browser that has never signed in.

Public means public. Served to unauthenticated requests: playlist names, descriptions,
covers, song titles and artists, the **MP3 bytes**, and the owner's display name and
picture. **Not** served: the owner's email address — `owner_to_dict` exists to keep it
out, and that is the one field that must never be added back.

Copying is the exception's exception: it still needs a session, because a copy has to land
in a library and an anonymous visitor hasn't got one.

A **Playlist** therefore carries two more fields:

| Field | Meaning |
| --- | --- |
| `is_public` | `true` once the owner shares it. Set through `PATCH /api/playlists/{id}`. |
| `shared_at` | when it was last switched on, `null` when private. The Shared page sorts by it. |

On the shared routes a Playlist gains two more:

| Field | Meaning |
| --- | --- |
| `owner` | `{"id", "name", "given_name", "picture"}` — **never the email address.** |
| `mine` | `true` when the caller owns it, so the page can say "Shared by you". |

Songs returned by these routes carry `"shared": true` and an `audio_url` of
`/api/shared/songs/{id}/audio`; their `playlist_ids` is always `[]`, since the caller's
playlists have nothing to do with the owner's. **The player reads `audio_url` off the
song** rather than building it — that is what makes one queue able to hold both.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `PATCH` | `/api/playlists/{id}` | `{"is_public": true\|false}` | updated Playlist. Sharing is a property of the playlist, not an action of its own. |
| `GET` | `/api/shared/playlists` | — | **no session needed.** `{"playlists": [Playlist + owner + mine...]}` — everyone's public playlists, most recently shared first, capped at 200. |
| `GET` | `/api/shared/playlists/{id}` | — | **no session needed.** `{"playlist": Playlist, "songs": [Song...]}` — read-only; songs in playlist order. |
| `GET` | `/api/shared/songs/{id}/audio` | — | **no session needed.** The MP3, same Range contract as `/api/songs/{id}/audio`. `?dl=1` for a download. |
| `POST` | `/api/shared/playlists/{id}/copy` | `{"name"?}` | **session required.** `201 {"playlist", "added", "already_had"}` |

`mine` is always `false` for a signed-out caller, who owns nothing here.

Membership is re-checked on **every** request: a song streams because it is in a public
playlist right now, so un-sharing takes its audio back out of reach immediately. A
playlist that was never public, has been un-shared, or never existed all answer the same
`404 {"error": "That playlist isn't shared."}` — a playlist somebody keeps private is not
a thing a stranger gets told about.

What sharing does **not** do:

- **No writes reach the owner.** No rename, no reorder, no delete — and no play count
  either: a stranger listening is not the owner's listening history, so the frontend skips
  the `/played` beacon for a shared song and the route would `404` anyway.
- **A copy is private.** `is_public` is never inherited; re-sharing is the copier's call.
- **A copy shares the audio, not the bytes.** The new song document points at the same
  GridFS file. `DELETE /api/songs/{id}` therefore removes the file only once no song
  document refers to it any more.
- **Songs you already have are reused, not duplicated** — matched on the GridFS file
  first, then the library's own duplicate rules (a reel is its URL, an upload is its
  filename and size). `added` and `already_had` report the split.
- **Names don't collide.** Playlist names are unique per user, so a copy of "Gym" lands as
  "Gym (copy)", then "Gym (copy 2)".

---

## 3b. Limits and asking for more

No payment anywhere. Four features cost real work, so each account gets a
**lifetime** allowance of each, counted separately — nothing resets on its own:

| Feature | Spent by | Default |
| --- | --- | --- |
| `reel` | `POST /api/extract` (200), an ingest job that saves a new song | `FREE_REEL_LIMIT` = 5 |
| `file` | `POST /api/identify` whose job ends with a YouTube result | `FREE_FILE_LIMIT` = 5 |
| `lyrics` | a lookup that comes back with words — `POST /api/songs/{id}/lyrics` or `POST /api/lyrics/search` (section 2a) | `FREE_LYRICS_LIMIT` = 5 |
| `meaning` | `POST /api/lyrics/{id}/meaning` that comes back with a reading | `FREE_MEANING_LIMIT` = 2 |

**The two halves of a lookup are two allowances**, because they cost two different
things. Finding the words is a crawl — our own bandwidth — and a crawl that found
nothing is refunded, so the finder declining to guess stays free. Explaining them is a
model call and a real bill, which is why its allowance is the smallest in the app; a
reading that came back empty (no key, lyrics too long, the model refusing) is refunded
too, and the words it was asked about are still yours. Words you type in yourself cost
nothing on either count.

Everything else — the library, playlists, sharing, `/api/search`, a manual
`/identify/{job}/search`, `youtube/refresh` — has no limit. Admins have none at all.

**Only a success is charged**, but success is known only at the end. So a use is *held*
when the work starts — counted against the limit straight away, so two tabs can't both
spend the last one — and then kept or given back. Every hold is also a row in
`quota_holds`; any still there at boot belonged to work the restart killed, and is
refunded before the ingest and lyrics queues are requeued.

On the user document: `limits: {reel: 20, file: null, lyrics: 10, meaning: 4}` (null =
unlimited; a missing key = the default, so changing the default moves everyone still on
it) and `used: {reel: 3, file: 0}` (successes plus holds in flight).

**Quota**:
```json
{"is_admin": false, "plan": "free | extended | admin",
 "defaults": {"reel": 5, "file": 5, "lyrics": 5, "meaning": 2},
 "reel": {"used": 3, "limit": 5, "left": 2},
 "file": {"used": 0, "limit": null, "left": null},
 "lyrics": {"used": 1, "limit": 5, "left": 4},
 "meaning": {"used": 2, "limit": 2, "left": 0}}
```
`limit`/`left` null = unlimited. `plan` is a label only: `extended` once an admin has moved
any limit off the default.

**LimitRequest**:
```json
{"id": "hex24", "message": "free text", "state": "pending | approved | declined",
 "reply": "the admin's answer, or \"\"", "limits_before": {"reel": 5, "file": 5},
 "limits_after": {"reel": 25, "file": 5} | null, "created_at": "...", "resolved_at": "... | null",
 "unread": true}
```
`unread` = answered, and the sender hasn't opened the Plan page since.

### `GET /api/quota`
`{"quota": Quota}`. Also arrives with `/api/auth/me`; this is the cheap re-read after a use.

### `GET /api/requests`
Your own, newest first (50) -> `{"requests": [LimitRequest, ...]}`.

### `POST /api/requests`
Body `{"message": "..."}` (1–1000 chars; free text — what to grant is the admin's call).
201 `{"request": LimitRequest}`. **One open request at a time**, enforced by a partial
unique index: a second while one is pending is `409`.

### `DELETE /api/requests/{id}`
Take back a request nobody has answered yet -> `{"withdrawn": true}`.

**Only while it is `pending`.** One open request at a time is a unique index, so without
this a mistyped or ill-judged one blocked the only way of asking until an admin got to
it. The row is deleted rather than marked withdrawn: the index is the thing that has to
be freed, and a request nobody read is not history. Once answered it is the record of a
decision and the sender does not get to remove the admin's half of it —
`409 That request has already been answered, so there's nothing to take back.`
Somebody else's request is a `404` like any other scoped read.

### `POST /api/requests/{id}/notes`

Body `{"text": "..."}` (600 chars). `201` with `{"request": LimitRequest}`.

Chasing a request that is still waiting — "is anyone looking at this?", "roughly how
long?". The line is appended to the request's `notes`, oldest first:

```json
"notes": [{"from": "user" | "admin", "text": "...", "at": "2026-10-03T09:14:00Z"}]
```

**Only while it is `pending`.** Once it has been answered the thread is history and the
next thing to send is a new request, which this page already offers and which the admin
will actually see — a note on a closed row would sit where nobody looks again.
`409 That request has been answered — send a new one instead.`

At most **12 lines** per thread, re-checked inside the write so two tabs cannot both
append past it: `409 This thread is full — the admin has everything they need.` Empty
text is `400 Type your question first.`, and somebody else's request is a `404` like any
other scoped read. The admin's side is `POST /api/admin/requests/{id}/notes` (section 3c).

### `POST /api/requests/seen`
Marks every answered request as read -> `{"seen": n}`. The Plan page calls it on open.

### `GET /api/requests/summary`
`{"unread": n, "pending": n | null}` — the sidebar's badges. `pending` (requests waiting
across everyone) is null unless you're an admin.

---

## 3c. Admin

Admins are named in config (`ADMIN_EMAILS`), not stored — there is no endpoint that makes
someone one. Every route below answers anyone else with **`404 {"error": "No such
endpoint."}`**, the same as a path that doesn't exist. These are the one other place
(besides section 3a) that reads rows belonging to other people, and they read accounts,
requests, feedback and the About page's postbag only — never a library.

**Account** (admin-only shape — unlike a shared playlist's owner, it carries the email):
```json
{"id": "hex24", "name": "...", "given_name": "...", "email": "...", "picture": "... | null",
 "created_at": "...", "last_login_at": "...", "quota": Quota, "custom_limits": true}
```

### `GET /api/admin/requests`
`?state=pending` (default; oldest first) or `all` (newest first).
`{"requests": [LimitRequest + {"used_before": {...}, "user": Account}, ...]}`

### `POST /api/admin/requests/{id}/resolve`
Body `{"decision": "approve" | "decline", "reply": "...", "limits": {"reel": 25, "file": null}}`.
`limits` is required to approve and holds **new totals**; a key left out is unchanged, a
key sent as null is unlimited. A reply is required to decline. The request is claimed
atomically before the limits move, so two admin tabs can't both apply one: the second
gets `409 That request has already been answered.`

### `POST /api/admin/requests/{id}/notes`
Body `{"text": "..."}`. `201` with the same shape `resolve` returns.

Say something on an open request **without deciding it** — "looking at this tonight" to a
sender who asked how long. The row stays `pending`. It clears the sender's `seen_at`, so
it reaches them through the same unread badge a decision would. Same 12-line cap, and
`409 That request has been answered — send a new one instead.` once it is closed.

### `GET /api/admin/users`
`?q=` matches name or email. -> `{"users": [Account + {"songs": n, "pending_request": bool}]}`,
most recently signed in first.

### `PATCH /api/admin/users/{id}/limits`
Body `{"reel": 10}`, `{"file": null}` or both — same rules as `limits` above, with no
request in the way. -> `{"user": Account}`.

### `DELETE /api/admin/users/{id}/limits/{feature}`
Put one feature back on the free allowance -> `{"user": Account}`. `{feature}` is a key of
`Quota` (`reel`, `file`, `lyrics`, `meaning`); anything else is `400`.

A route of its own because `PATCH` has no way to say it. Null there already means
unlimited, and writing today's default as a number pins the account to that figure, so it
stops following `FREE_*_LIMIT` the moment that moves. This `$unset`s the key, which is the
difference between "unlimited" and "whatever everyone else gets" — and without it the
first edit to anybody's limits was permanent.

### `GET /api/admin/feedback`
Everything anyone has sent (section 2d), newest first.
```json
{"feedback": [Feedback + {"user": Account}, ...],
 "summary": {"count": 12, "average": 4.17, "spread": {"1": 0, "2": 1, "3": 1, "4": 4, "5": 6}}}
```
The summary counts **every row in the collection**, not the page returned, so the average
does not shift as you page through — one that moves as you scroll can't be compared with
last week's. `average` is null when there is nothing yet.

### `DELETE /api/admin/feedback/{id}`
`{"deleted": true}`, or `404 That feedback is already gone.` For spam and for things sent
by mistake. There is no reply from here, on purpose: the answer to feedback is whatever
gets built, not a message back.

---


### `GET /api/admin/about`
`{"about": About}` — the editor's copy. **Unlike `GET /api/about` this keeps links whose
`value` is empty**: those are the rows you type a URL into, and dropping the résumé row
the moment it was cleared would leave no way to put one back.

### `PUT /api/admin/about`
Body is a whole **About** object (no `updated_at`). -> `{"about": About}`, admin shape.

One form, one Save, one PUT — a field-level patch API would be three times the code to
express the same edit. Caps: **12 sections**, heading 120 chars, body 4000, **8 links**,
title 80, `nav_label` 30, `nav_mini_label` 12.

- `title` is required — `400 Give the page a title — it's the first thing anyone reads.`
- `nav_label` is required **when `in_nav` is true** —
  `400 Name the rail entry, or there's nothing to click.`
- every section needs both halves —
  `400 Every section needs a heading and something under it.`
- a link `value` is normalised, not just stored: an empty one is kept (that is how a link
  is hidden), an `email` without an `@` is `400`, a `javascript:`/`data:` URL is
  `400 A link has to be a web address.`, and a bare domain is given `https://` rather than
  refused — stored without a scheme it would resolve against our own origin and 404.
- `nav_mini_label` falls back to `nav_label` when left blank.

**`enabled` and `in_nav` are two switches, not one.** Taking the rail entry down is
tidying; taking the page down breaks a URL that may already be in somebody's résumé, so
the app makes you say which you meant. `enabled` false also closes `POST /api/contact`.

### `POST /api/admin/about/reset`
No body. Writes `backend/services/about_defaults.py` back over the document and returns
`{"about": About}`. Whatever was there is gone.

### `GET /api/admin/contact`
Everything sent from the About page (section 2f), newest first.
`{"messages": [ContactMessage, ...]}`

No rating to summarise and no `Account` attached, unlike feedback: a sender typed their
own name and address and most of them have never signed in. `signed_in` on each row says
whether this one happens to have.

### `DELETE /api/admin/contact/{id}`
`{"deleted": true}`, or `404 That message is already gone.`

## 4. Health / meta

`GET /api/health` -> `{"ok": true, "storage": "gridfs", "authenticated": true|false,
"signed_in": true|false}`, plus `songs` and `playlists` counts **when signed in** — they
are the caller's own totals, not the database's. `authenticated` is the *Instagram* cookie
session (so the UI can explain sticker lookups being unavailable); `signed_in` is the
person. Public, so a browser with no session can still tell the server is up.

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
- Playlist not shared (or never was): `That playlist isn't shared.`
- Shared song gone: `That song isn't in a shared playlist any more.`
- Not signed in: `Sign in to continue.`
- Session gone: `Your session has expired — sign in again.` (the frontend's own wording
  after a 401 — the server just says the sentence above)
- Bad Google token: `Google couldn't verify that sign-in — try again.`
- Not on the guest list: `That account isn't on this app's guest list.`
- Sign-in not set up: `Google sign-in isn't configured on this server — set
  GOOGLE_CLIENT_ID (see the README).`
- Limit used up (402): `You've used all 5 of your reel extractions — ask for more on the
  Plan page.` / `…file lookups…` / `…lyric lookups…`; `You've used your one reel extraction
  — …` at a limit of 1; `Your plan doesn't include file lookup yet — ask for it on the Plan
  page.` at 0.
- No lyrics found: `Couldn't find lyrics for this song — the pages we checked weren't it.`
- Turned away while looking: `The search engines turned us away this time — try again in a
  few minutes.`
- Song with nothing to search by: `We don't know what this song is yet — identify it first,
  then try again.`
- Lyrics sidecar down: `The lyrics service isn't running — start the app with ./run.sh and
  try again.`
- Second open request: `You already have a request waiting — the admin will get to it.`
- Empty request: `Say what you need more of, and roughly how much.`
- Request already answered: `That request has already been answered.`
