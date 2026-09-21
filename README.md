# Reel Audio

Paste an Instagram reel link, get the audio as an MP3, keep it in a library with
playlists, and play it without leaving the page. Saved songs remember the YouTube matches
and the Instagram link they came from.

Everything runs on your machine: yt-dlp + ffmpeg for extraction, MongoDB for the library,
GridFS for the files. Nothing is uploaded anywhere.

## Run it

```bash
./run.sh              # one server on :8000, serving the built UI
./run.sh dev          # Vite on :5173 with hot reload, API on :8000
```

Then open <http://127.0.0.1:8000>.

The first run creates `.venv/`, installs the Python and npm packages and builds the UI, so
give it a minute. Requirements: Python 3.12, Node, `ffmpeg` on your PATH, and MongoDB
running on `127.0.0.1:27017` (`sudo systemctl start mongod`).

## What it does

- **Search** — paste a reel URL, preview the MP3, see ranked YouTube matches, save it.
- **All songs** — everything you've saved, searchable and sortable. This is the songs
  collection itself, so nothing can fall out of it.
- **Song detail** — the MP3, its YouTube links, and the original Instagram link, kept for
  future reference. Edit the title/artist, delete, re-run the YouTube search.
- **Playlists** — build them from saved songs, drag to reorder, each with its own loop
  setting (off / all / one).
- **Player** — a bar that keeps playing as you move around the app, with a queue you can
  jump around in. YouTube links open in an embedded player, never a redirect; opening one
  pauses the MP3 so two things never play at once.
- **MP3 to link** — the reverse trip, for audio that didn't come from a reel: upload a
  file and get the song behind it plus its YouTube link, then save it to the library like
  anything else. See [Identifying a file you already have](#identifying-a-file-you-already-have).

## Architecture

| Piece | Choice | Why |
| --- | --- | --- |
| Backend | FastAPI + Motor (async) | `yt-dlp` and `shazamio` are Python and already working |
| Database | MongoDB | songs, playlists, and the audio itself |
| Files | **GridFS** | Mongo's native chunked store — no 16MB doc limit, streams byte ranges so the player can seek |
| Frontend | Vite + React, plain JSX | hand-written CSS, no UI kit |

Extraction is two-phase: pasting a link gives you a temp file and a preview, and nothing
reaches the database until you press Save. Discarded extractions never enter your library.

Contract and design system live in [docs/API.md](docs/API.md) and
[docs/DESIGN.md](docs/DESIGN.md).

## Logged-in access (usually needed)

Instagram serves very little to anonymous requests — public reels often work, but most
things return a "login required" or rate-limit error. Two ways to fix that:

**Option A — cookies from your browser (easiest):**

```bash
INSTA_COOKIES_BROWSER=chrome ./run.sh      # or firefox, chromium, brave, edge
```

The app picks the browser profile that's actually signed in to Instagram, so you normally
don't need to name one. To force a specific profile:

```bash
INSTA_COOKIES_BROWSER="chrome:Profile 4" ./run.sh
```

Two things that silently produce "no cookies found" on Linux:

- **Chrome needs `secretstorage`** (in [requirements.txt](requirements.txt)) to read its
  encryption key from the GNOME keyring. Without it every cookie fails to decrypt and you
  get an empty jar rather than an error.
- **Chrome profiles aren't named `Default`** once you add accounts — they're `Profile 4`,
  `Profile 9`, and so on. Firefox installed as a **snap** keeps its profile under
  `~/snap/firefox/common/.mozilla/firefox/` instead of `~/.mozilla/`, where tools don't
  look by default; point at it with `firefox:/full/path/to/profile`.

**Option B — a cookies.txt file:** export your `instagram.com` cookies with a "Get
cookies.txt" extension and save it next to `run.sh`. It's picked up automatically and
survives across sessions.

`GET /api/health` reports `authenticated: true|false` so you can tell which state you're in.

## Settings

| Env var | Default | What it does |
| --- | --- | --- |
| `PORT` | `8000` | port the server listens on |
| `MONGO_URL` | `mongodb://127.0.0.1:27017` | database connection |
| `DB_NAME` | `reel_audio` | database name |
| `AUDIO_QUALITY` | `192` | MP3 bitrate in kbps (`128`, `256`, `320`) |
| `INSTA_COOKIES_BROWSER` | `chrome` | browser to read the Instagram session from |

## Finding the full song

After the MP3 is ready the app works out *which* song it is, then searches YouTube for the
complete track. Four sources, best first:

1. **Instagram's music sticker**, read from Instagram's own API — exact, but the endpoint
   needs a logged-in session.
2. **yt-dlp's track/artist metadata**, when the post exposes it.
3. **Audio fingerprinting** (Shazam, via `shazamio`) — recognises a commercial recording
   playing in the post.
4. **The caption**, with hashtags, mentions and emoji stripped. Flagged as a guess.

Candidates are then scored rather than taken in YouTube's own order: the track name
carries most of the weight, `- Topic` and VEVO channels get a bump as the label-verified
uploads, and slowed/reverb edits, covers, remixes and hour-long loops get pushed down. The
top result is marked **BEST**.

### When none of them work

Plenty of reels carry no music sticker at all — when a creator sings or plays something
themselves, Instagram files it as their own "Original audio" and stores no song name, so
even an authenticated lookup has nothing to return.

Fingerprinting only matches the **exact original recording**. If the reel is someone
singing, covering, or playing the song live, it will never match however recognisable the
song is — a different performance is a different waveform.

For that case there's a **search box** under the results: type the title, or a line you
could make out, and you get the same ranked YouTube list. Free-text search keeps YouTube's
own relevance order and only re-ranks for upload quality.

Either way you keep the MP3 — identification is a bonus on top, never a gate.

## Identifying a file you already have

**MP3 to link**, at the bottom of the sidebar, runs the same question from the other end:
upload a track from anywhere and it tells you what the song is and where it is on YouTube.
There's no post to read a music sticker off, so it works down its own tiers instead —
Shazam, then AcoustID, then the file's own caption tags, then the lyrics.

That last tier is what makes it worth having next to the reel flow: transcribing what's
being sung survives a cover, which no fingerprint can. It's also slow — a few minutes on
CPU — so the job runs in the background and the page streams its progress while it works.

The lyrics tier needs `faster-whisper`, which is in [requirements.txt](requirements.txt)
and pulls ~1 GB of model the first time it runs. The AcoustID tier additionally needs a
key: `export ACOUSTID_API_KEY=...`, free from [acoustid.org](https://acoustid.org/new-application).

Every tier is import-guarded, which is a trap worth knowing about: with a dependency
missing the tier is skipped **in silence**, and a song that should have matched comes back
as "no match found" rather than as an error. If a file identifies in one environment and
not another, compare what's installed before suspecting the pipeline.

The tiers detect; how far each one is trusted is decided separately, in
`services/file_match.py`. Two rules earn their keep:

- **A caption is a guess.** The file's tags carry the post's caption, which is free text
  about anything at all — one file's read "First 10 days of a 30 day program" (an event
  announcement) and returned a workout video with total confidence, because a caption
  match also stopped the run before the lyrics tier. Only Instagram's bracketed credit
  list is trusted outright now; prose is held back, the audio is asked first, and a
  caption is used as a fallback that says on its face that it's a guess.
- **Results are ranked, not taken in order.** Candidates go through the same scorer the
  reel side uses, so an official upload beats a slowed edit or an hour-long loop that
  happens to share the words. You get five, best first, and can play any of them.

When it still gets it wrong — and it will, identification is probabilistic — there's a
search box under the results. Type the name and what you pick is what gets saved.

Identification starts the moment you pick a file — there's nothing to configure in
between. When it finishes, **Save to library** files the song away exactly like a reel:
same player, same All songs list, taggable into any playlist. The two kinds are told apart
by a tag on the row — **MP3** for a file you uploaded, **INSTA** for a reel — so nothing
has to be kept in separate libraries to stay distinguishable. Uploads keep the name of the
file they came from, and saving the same file twice is refused rather than duplicated.

## Notes

- Reels only carry the slice of the song used in the post, so expect 15–90 second clips.
- `downloads/` holds pre-save temp extractions only; your library lives in MongoDB.
  `backend/uploads/` is the same kind of scratch space for files sent to MP3 to link.
- The server binds to `127.0.0.1` on purpose — it's for you, not the network.
- `app.py` and `static/index.html` are the original single-file Flask version, kept for
  reference. Nothing new depends on them.
- Keep downloads to things you have the rights to save; commercial music on Instagram
  belongs to its rights holders.
