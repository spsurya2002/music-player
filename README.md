# Reelody

Paste an Instagram reel link, get the audio as an MP3, keep it in a library with
playlists, and play it without leaving the page. Saved songs remember the YouTube matches
and the Instagram link they came from.

You sign in with Google, and what you save is yours: your library, your playlists, your
play counts. Two people on the same server never see each other's music.

Everything runs on your machine: yt-dlp + ffmpeg for extraction, MongoDB for the library,
GridFS for the files. Nothing is uploaded anywhere — signing in tells Google nothing about
what you save, and tells this app nothing but your name, email address and profile picture.

## Run it

```bash
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com ./run.sh   # one server on :8000
./run.sh dev                                                   # Vite on :5173, API on :8000
```

Then open <http://127.0.0.1:8000>. Without a `GOOGLE_CLIENT_ID` the app runs but nobody can
sign in, and the login screen says so — see [Signing in](#signing-in) for the four steps
that produce one.

The first run creates `.venv/`, installs the Python and npm packages and builds the UI, so
give it a minute. Requirements: Python 3.12, Node, `ffmpeg` on your PATH, and MongoDB
running on `127.0.0.1:27017` (`sudo systemctl start mongod`).

## What it does

- **Sign in with Google** — one button, no password to keep. You are not asked for it at
  the door: the app opens on the shared feed and you can browse and play it straight away.
  Signing in is what gets you a library of your own, and each page says so in its own words
  when you reach one that needs it. Everything you save is scoped to that account; the
  sidebar shows who you are, and Account shows the totals and the way out.
- **Add music** — the one way in, with two inputs. *From a reel*: paste a reel URL,
  preview the MP3, see ranked YouTube matches, save it. *From a file*: upload audio you
  already have and get the song behind it plus its YouTube link. Both end the same way, so
  they're one page with a mode switch rather than two entries in the sidebar.
- **Share from Instagram** — install the app to your Android home screen and Reelody
  joins the share sheet. Share a reel to it and the MP3 turns up in your library on its
  own; **Inbox** shows what's still in flight. See
  [Sharing reels straight from Instagram](#sharing-reels-straight-from-instagram).
- **All songs** — everything you've saved, searchable and sortable. This is the songs
  collection itself, so nothing can fall out of it.
- **Lyrics and meaning** — open a song and ask for its words. Reelody finds them, says
  where they came from and how sure it is, then reads them back line by line in Hinglish:
  what each line says, and where there's something under it, what it's getting at. Built
  for ghazals and qawwali, where the words are Persian and Arabic and a literal gloss
  tells you almost nothing. See [Lyrics and meaning](#lyrics-and-meaning).
- **Song detail** — the MP3, its YouTube links, and the original Instagram link, kept for
  future reference. Edit the title/artist, delete, re-run the YouTube search.
- **Playlists** — build them from saved songs, drag to reorder, each with its own loop
  setting (off / all / one).
- **Shared** — the home page. Make a playlist public and it appears there with your name
  and picture beside it; other people's appear there too. Opening one plays it straight
  from the owner's library, and "Save to my library" takes a copy — reusing any song you
  already have rather than duplicating it. Your own shared playlists are marked on your
  Playlists grid, and "Stop sharing" takes one back immediately.

  **Shared playlists are public to anyone with the address, signed in or not** — the feed,
  the track names and the MP3s themselves. That is deliberate: it is what a first-time
  visitor sees instead of a login wall. Your email address is never part of it, only your
  display name and picture. Everything else — your library, your playlists, extraction,
  and taking a copy — still needs an account.
- **Player** — a bar that keeps playing as you move around the app, with a queue you can
  jump around in. YouTube links open in an embedded player, never a redirect; opening one
  pauses the MP3 so two things never play at once.
- **Add music → From a file** — the reverse trip, for audio that didn't come from a reel:
  upload a file and get the song behind it plus its YouTube link, then save it to the
  library like anything else. See
  [Identifying a file you already have](#identifying-a-file-you-already-have).

- **Plan** — reel extraction and file lookup each come with 5 free uses, for life. Only
  a success counts: a failed download, a duplicate from the share sheet or a file nothing
  matched costs nothing. Past that you write a request on the Plan page, the admin raises
  your limits by hand and answers there — no payment anywhere. Everything else has no
  limit. See [Limits and the admin](#limits-and-the-admin).

## Architecture

| Piece | Choice | Why |
| --- | --- | --- |
| Backend | FastAPI + Motor (async) | `yt-dlp` and `shazamio` are Python and already working |
| Database | MongoDB | songs, playlists, and the audio itself |
| Files | **GridFS** | Mongo's native chunked store — no 16MB doc limit, streams byte ranges so the player can seek |
| Frontend | Vite + React, plain JSX | hand-written CSS, no UI kit |
| Lyrics | a Node sidecar on `:4001` | [lyrics-node/](lyrics-node/) — vendored whole rather than rewritten, because its scoring thresholds and 14 sets of per-site selectors are calibrated against each other and have no tests. `backend/services/lyrics.py` is the only thing that talks to it |

Extraction is two-phase: pasting a link gives you a temp file and a preview, and nothing
reaches the database until you press Save. Discarded extractions never enter your library.

`run.sh` brings the sidecar up alongside the API. It binds loopback and has no auth of
its own: sign-in, ownership and limits are all decided in Python before a request reaches
it, and nothing outside this machine can.

Contract and design system live in [docs/API.md](docs/API.md) and
[docs/DESIGN.md](docs/DESIGN.md).

## Signing in

The app needs an OAuth **client ID** (not a secret — the browser sends Google a token, and
the server verifies it against Google's public keys):

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create
   a project, then **Create credentials → OAuth client ID → Web application**.
2. Under **Authorised JavaScript origins**, add the addresses you open the app at:
   `http://127.0.0.1:8000` and `http://localhost:8000` — plus `http://localhost:5173` for
   `./run.sh dev`. No redirect URI is needed; there is no redirect.
3. On the consent screen, **External** with yourself as a test user is enough for a
   personal instance. Only the default name/email/picture scopes are used.
4. Start the app with the id:

```bash
GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com ./run.sh
```

Origins are matched exactly, so a client ID registered for `localhost` will refuse
`127.0.0.1` — open the app at the address you registered.

Optional environment variables:

| Variable | Effect |
| --- | --- |
| `ALLOWED_EMAILS` | Comma-separated guest list. Unset, any Google account may sign in and gets its own empty library. |
| `LEGACY_OWNER_EMAIL` | Who inherits songs and playlists saved before logins existed. Unset, the first account ever to sign in adopts them. |
| `SESSION_DAYS` | How long a session lasts (default 30). |
| `SESSION_COOKIE_SECURE` | Set to `1` when serving over https, so the cookie is https-only. |

**Upgrading an existing library:** nothing to do. On startup the two unique indexes become
per-user, and your existing songs and playlists are adopted by the first account that signs
in (or by `LEGACY_OWNER_EMAIL`, if you'd rather name it). Sessions live in a `sessions`
collection and expire on their own.

Signing out stops playback, empties the queue and revokes the session server-side.

## Sharing reels straight from Instagram

The paste box still works and isn't going anywhere. This is the shortcut: on Android,
Reelody can sit in Instagram's own share sheet, so saving a reel is one tap and you
never open the app.

**It needs HTTPS.** Browsers only install a site as an app over a real certificate, so
this works on a domain (a `cloudflared` tunnel is plenty) and not on `http://localhost`.

Install it, once:

1. Open the site in **Chrome on Android**.
2. Menu (⋮) → **Install app** (sometimes *Add to home screen* → *Install*).
3. Open Reelody from the home screen once and sign in, so the app has your session.

After that: in Instagram, **Share** → **Share to…** → **Reelody**. The app flashes
up, queues the reel and gets out of the way. The download, the song lookup and the save
all happen on the server — you can close it immediately.

**Inbox** (in the sidebar) is where shared reels show up:

| State | Means |
| --- | --- |
| Waiting | queued, nothing has started |
| Working | downloading, or working out what the song is |
| Saved | it's in your library — *Open* goes to it |
| Already saved | you'd shared that reel before; the existing song is linked |
| Failed | the reason is on the row, usually a private post or missing cookies |

Reels are processed **one at a time** on purpose — Instagram rate-limits a session that
asks too quickly, and a queue of five is worth a few minutes, not a ban.

Two things worth knowing:

- **The server has to be running when you share.** If it's a tunnel from your laptop and
  the laptop is asleep, the share fails then and there. Nothing retries it.
- **A queued reel survives a restart.** The queue is in MongoDB, not memory, so anything
  waiting is picked up when the server comes back — only the reel that was mid-download
  starts over.

On iPhone this doesn't work: iOS home-screen apps can't register as share targets. An
iOS **Shortcut** posting to `POST /api/ingest` would do the same job — see
[docs/API.md](docs/API.md) — but nothing here sets one up.

## Logged-in access to Instagram (usually needed)

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
| `ADMIN_EMAILS` | `spsuryamishra@gmail.com` | who runs the instance — comma-separated |
| `FREE_REEL_LIMIT` | `5` | reel extractions a new account gets |
| `FREE_FILE_LIMIT` | `5` | file lookups a new account gets |
| `FREE_LYRICS_LIMIT` | `5` | lyric lookups a new account gets |
| `FREE_MEANING_LIMIT` | `2` | explanations of those lyrics a new account gets |
| `GEMINI_API_KEY` | — | in `lyrics-node/.env`: explains the lyrics. Without it they're still found |
| `LYRICS_SIDECAR_URL` | `http://127.0.0.1:4001` | where the lyrics sidecar listens |
| `LYRICS_TIMEOUT` | `240` | seconds to allow one lyrics lookup |

## Limits and the admin

Four features cost real work — pulling audio out of a reel (yt-dlp + ffmpeg + Shazam),
identifying a file (fingerprints, then Whisper on CPU), finding a song's lyrics (a crawl),
and explaining them (a model call) — so each account gets `FREE_REEL_LIMIT`,
`FREE_FILE_LIMIT`, `FREE_LYRICS_LIMIT` and `FREE_MEANING_LIMIT` of them, counted
separately and never reset.

The last one is deliberately the smallest: a crawl spends our own bandwidth, but an
explanation is a Gemini call and a real bill, so two is what an account gets to see what
the feature is before asking for more. Words you type in yourself are free on both
counts, and so is a lookup that came back with nothing.

- **Only successes count.** A use is held when the work starts, so two tabs can't both
  spend the last one, then kept on success or given back. A restart refunds anything that
  was held mid-flight.
- **Asking for more** is the Plan page: a free-text request, one at a time. The admin's
  answer shows up there, with a dot on your avatar until you've read it.
- **The admin** is whoever `ADMIN_EMAILS` names (the default is the author's address —
  set your own on your instance). Admins have no limits, get an Admin link under their
  profile at the foot of the rail with a count of what's waiting, approve with new totals (or unlimited) or decline with a
  reply, and can change anyone's limits from the Users tab without a request. An admin can
  always sign in, even when `ALLOWED_EMAILS` would otherwise keep them out.
- Changing `FREE_*_LIMIT` moves everyone who is still on the defaults; limits an admin
  has set stay as set.

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

**Add music → From a file** runs the same question from the other end:
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

## Lyrics and meaning

A song page has a **Lyrics and meaning** section. Press *Find lyrics* and the lookup runs
on the server; the page polls until it's done, and leaving and coming back picks the same
one up, because the row belongs to the song rather than to the tab.

It searches for the song the way the page names it — "Artist - Track", or the words that
identified it if it never got a name. So if a result looks wrong, correcting the track or
artist above and pressing *Look again* usually fixes it.

**Finding the words.** The open lyrics databases (LRCLIB, lyrics.ovh) answer first and
usually settle it. When they don't, it searches the web and reads the pages that come
back, scoring each on whether the title and artist match and whether the text reads like
lyrics at all. Everything it opened is listed under *Pages we looked at*, with why each
one didn't work out.

**It would rather say nothing than guess.** Below a confidence floor you get "couldn't
find lyrics for this song" instead of a page that merely looks plausible — search engines
answer scrapers with confident near-misses, and a wrong answer presented as the right one
is worse than none. If the engines turned us away instead, it says that, because that one
is worth retrying in a few minutes.

**Reading them.** The explanation is a model call, and two ideas shape it. The dictionary
knows the words and the model reads the poem: rare words are looked up in
[Rekhta](https://www.rekhtadictionary.com/) first and handed over as evidence, never shown
as the meaning, because a dictionary sense is literal and a line in a ghazal usually
isn't. And depth only where it exists: asked for "the Sufi meaning", a model invents one
for every line, so plain restatement and the deeper note are asked for separately and
about a third of lines earn the second.

Everything comes back in Hinglish — Roman letters, the way people actually discuss these
songs — alongside the original script and an automatic romanisation of it.

**What it won't do.** If the only version it can find is its own romanisation, you get the
words and no explanation: romanising guesses the short vowels Urdu doesn't write, and a
guess shouldn't feed an interpretation. Without `GEMINI_API_KEY` you get the words and a
line saying why there's no reading. Either way the lyrics are the point and they still
arrive.

Lyrics belong to their publishers. They're fetched for the person who owns the song, the
page they came from is always credited and linked, and they are deliberately **not**
included anywhere on the public shared-playlist routes.

## Notes

- Reels only carry the slice of the song used in the post, so expect 15–90 second clips.
- `downloads/` holds pre-save temp extractions only; your library lives in MongoDB.
  `backend/uploads/` is the same kind of scratch space for files sent to Add music.
- The server binds to `127.0.0.1` on purpose — it's for you, not the network. The lyrics
  sidecar on `:4001` does too, and that one matters more: it has no sign-in of its own.
- `backend/lyrics-cache/` holds the lyrics sidecar's caches — found lyrics, the
  explanations it has already paid for, and the Rekhta words it has looked up. Deleting it
  costs money and time, not data.
- `app.py` and `static/index.html` are the original single-file Flask version, kept for
  reference. Nothing new depends on them.
- Keep downloads to things you have the rights to save; commercial music on Instagram
  belongs to its rights holders.
