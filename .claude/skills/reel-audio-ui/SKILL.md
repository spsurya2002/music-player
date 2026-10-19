---
name: reel-audio-ui
description: Architecture and front-end conventions for Reelody, a React + FastAPI + MongoDB media library that turns Instagram reels into a saved MP3 collection. Use this skill for ANY work on this repo — adding or changing a view, component, player behaviour, API endpoint, database field or playlist feature; restyling anything; "make the UI nicer"; or wiring new markup to the backend. Read it BEFORE writing JSX, CSS, or a FastAPI route, so new work inherits the existing tokens, component shapes, data model and voice instead of inventing a second set.
---

# Reelody

Paste an Instagram reel link, get the MP3, keep it in a library with playlists, play it
without leaving the page. One dark, plum-black product: a sidebar, a scrolling content
area, and a player bar that never stops. You sign in with Google, and every song, playlist
and play count belongs to that account.

## Where things live

```
backend/          FastAPI + Motor (async MongoDB). Owns all state.
  main.py         app, exception handlers, serves frontend/dist in production
  auth.py         Google ID token -> user -> session cookie; the CurrentUser dependency
  routers/shared.py  the ONE place a row that isn't yours is readable — public playlists
  db.py           motor client (created in startup, NOT at import — see gotchas)
  storage.py      GridFS put/open/delete
  serializers.py  Mongo doc -> API shape. The only place _id becomes id.
  streaming.py    Range-request handling for audio
  services/       identify.py (song ID + YouTube ranking), extractor.py (yt-dlp), cookies.py
                  pipeline.py (match a token, save a token — the reel flow with no HTTP
                  around it; routers and auto-ingest all go through this one copy)
                  ingest.py (the auto-ingest queue + its single background worker)
                  file_identify.py (tiers for an uploaded file — a verbatim port, do not
                  tune it), file_match.py (how far to trust each tier + ranking),
                  ident_jobs.py (runs those jobs, holds their results)
                  quota.py (the three paid limits: hold a use, settle or refund it)
                  lyrics.py (the one caller of the lyrics sidecar), lyrics_jobs.py
                  (its queue + worker: a row per song that is job and result at once)
  routers/        auth.py, extract.py, identify.py, ingest.py, songs.py, playlists.py,
                  limits.py (your quota, asking for more), admin.py (ADMIN_EMAILS only),
                  feedback.py (what people think of the app; admin.py reads it back)
frontend/         Vite + React 19, plain JSX, hand-written CSS
  public/         manifest.webmanifest (PWA + the Android share_target), sw.js, icons
  src/theme.css   the tokens — the source of truth for colour
  src/context/PlayerContext.jsx   the audio element, queue, loop, YouTube modal state
  src/context/AuthContext.jsx     who is signed in; one /auth/me call decides the app
  src/hooks/useGoogleSignIn.js    loads Google Identity Services, draws their button
  src/App.jsx     AuthProvider > PlayerProvider > router > shell or login screen
  src/Shell.jsx   sidebar + <Routes> + player bar as siblings
  src/api/client.js  every fetch goes through here, nowhere else
  src/views/ShareTargetView.jsx  where Android drops a reel shared from Instagram
  src/views/InboxView.jsx        what the share sheet sent, and what became of it
  src/components/TopBar.jsx      search, the account menu, the rail toggle
  src/components/Sidebar.jsx     the rail (desktop); MobileTabs.jsx is the phone's five
  src/views/SearchView.jsx       Add a reel ("/add/reel"; "/add" redirects here)
  src/views/IdentifyView.jsx     Add a file ("/add/file")
  src/views/LyricsView.jsx       Lyrics ("/lyrics"): paste a link, get words + meaning
  src/views/SharedView.jsx       the HOME page ("/"): greeting, what this is, the feed
  src/components/SignInPrompt.jsx  what a signed-out visitor gets in place of a view
  src/views/SharedPlaylistView.jsx  one of them, read-only: play it or copy it
  src/views/PlanView.jsx         your limits, the Free/More tiers, asking for more
  src/views/AdminView.jsx        requests and everyone's limits — admins only
  src/components/Quota.jsx       QuotaNote, QuotaMeter, ErrorMsg (402 -> "Ask for more")
  src/components/FeedbackModal.jsx  rating + a box; opened from the rail's foot and
                                    from the account menu (the rail is gone on phones)
docs/API.md       the endpoint contract
docs/DESIGN.md    the full design system
legacy: app.py + static/index.html are the original single-file Flask version.
```

**Read [docs/API.md](../../../docs/API.md) before touching an endpoint** and
**[docs/DESIGN.md](../../../docs/DESIGN.md) before touching UI.** They are the contract;
this file is the orientation.

## Non-negotiables

1. **The player bar is mounted outside `<Routes>`**, in `Shell.jsx`, with
   `PlayerProvider` above the router in `App.jsx`. A single `new Audio()` lives in a ref
   in `PlayerContext` and is never recreated. Moving the player inside a route, or
   creating a second `Audio`, breaks playback on navigation — the whole reason this is an
   SPA. Do not restructure that without a very good reason.
2. **Never two sounds at once.** There is one YouTube player
   (`components/YouTubePlayer.jsx`) in two shapes: a **modal**, opened by a
   YouTube match on a song page, and a **dock** in the corner, opened by
   Listen on a lyrics page so the song can play *while* you read. Opening
   either pauses the MP3. The reverse is handled on the audio element's own
   `play` event, so every path into it is covered: a modal closes, a dock falls
   silent and stays put. A dock registers its `pauseVideo` with PlayerContext,
   because nothing outside the iframe can reach in otherwise.
3. **Colour comes from `var(--…)` in `theme.css`.** A literal hex in a component is the
   first crack in the theme; this has already been fixed once. `--field` and
   `--placeholder` exist for inset controls and image backings.
4. **All state lives in MongoDB**, files in GridFS. No local-disk library, no third-party
   storage. `downloads/` holds only pre-save temp extractions.
5. **"All songs" is the `songs` collection**, not a stored playlist document. Do not
   create a default playlist — membership that can drift is the bug this avoids.
6. **Extraction is two-phase.** `POST /api/extract` gives a token and a temp file;
   nothing reaches Mongo until `POST /api/songs`. Tokens are process memory and die on
   restart.
7. **Every response is `{...}` on success, `{"error": "a sentence"}` on failure**, with a
   non-2xx status. `backend/main.py` has handlers that force this shape even for
   `HTTPException` and validation errors. Errors are English, not codes.
8. **`instagram_url` and `youtube[]` are kept forever** on a saved song — opening a song
   must show where it came from and its YouTube matches. That is a product requirement,
   not an implementation detail. A song from an upload has no post, so it carries
   `source_file` instead and **omits `instagram_url` entirely** (see the gotchas).
9. **Every library row is scoped to a user.** `songs` and `playlists` carry `user_id`;
   routers take `CurrentUser` and filter on `user.id` — including the reads that look
   harmless, since an id from someone else's URL would otherwise stream their audio.
   Someone else's row is a **404**, never a 403. Uniqueness is compound on `user_id`
   (two people may save the same reel; each may have a "Gym"). Extract tokens and identify
   jobs record their owner too. A new endpoint that touches the library and doesn't take
   `CurrentUser` is a bug, not a shortcut.
   **`routers/shared.py` is the one exception, and it stays the only one.** A playlist its
   owner marked `is_public` is readable and playable by **anyone at all — no session**,
   because that feed is the app's home page and it has to render for a first-time visitor.
   Copying still needs one. The owner's *email* is never in a shared response; that is what
   `owner_to_dict` is for, and adding the field back would leak every sharer's address to
   the open internet. The
   exception is scoped to *current membership of a public playlist*, never to a user or a
   song id: every request re-asks "is this song in a public playlist right now?", so
   un-sharing takes the audio back immediately. It is read-only in that direction —
   nothing on those routes writes to the owner's library, play counts included. If a new
   feature needs cross-user reads, it goes through that same membership question or it
   doesn't ship.
10. **The session is a row in `sessions`, not a JWT of ours.** The cookie is an opaque
   random id, HttpOnly, and carries no claims — so sign-out genuinely revokes it and the
   TTL index expires the rest. Only Google's ID token is a JWT, and it is verified
   server-side (`google-auth`) and then thrown away.
11. **Auto-ingest never blocks a request.** `POST /api/ingest` writes a row to
   `ingest_jobs` and returns 202; the worker in `services/ingest.py` does the work. That
   is not a style preference — the app is served through a Cloudflare tunnel, which
   returns a 524 and drops any request still open at 100 seconds. It runs **one job at a
   time**: Instagram rate-limits a session that asks too fast. Unlike extract tokens and
   identify jobs, this queue is in Mongo, because a reel someone shared must survive a
   restart; anything left `running` at boot is requeued, never resumed, since its temp
   file died with the process. A path that ends without saving — a duplicate, a failure —
   must still `extractor.discard()` the token, or it leaks an MP3 into `downloads/` that
   nobody is watching for.
12. **One `songs` collection holds both kinds.** A reel (`source: "instagram"`) and an
   uploaded file (`source: "upload"`) differ only in provenance; All songs lists both, the
   player plays both, any playlist takes either. The UI separates them with a tag —
   INSTA / MP3 — not with separate libraries or a default "Uploads" playlist.

## Signed out is a state of the app, not a different app

`App.jsx` renders the shell for everyone. A visitor gets the rail, the route they asked
for and its title; only the *contents* are swapped, by `<Gated>` in `Shell.jsx`, for a
`SignInPrompt` carrying that page's own reason to sign in. `/login` is the one route
outside the shell, it is somewhere you choose to go, and it returns you to
`location.state.from` — **pathname + search**, because the Android share target carries
the reel in its query string.

`/` is the only route with no `<Gated>` at all. Keep it that way: it is what a stranger
sees, and a home page that shows them nothing is not a home page.

A 401 no longer bounces anyone anywhere — `AuthContext` just drops the user and the pages
become prompts. That is why an expired session's notice is rendered *by SignInPrompt*: it
is the only place that explanation can still reach you.

13. **Every paid path goes through `services/quota.py`.** Reel extraction and file lookup
   each have a lifetime limit (`FREE_REEL_LIMIT` / `FREE_FILE_LIMIT`, per-user overrides
   in `users.limits`, null = unlimited). A new way to run either one must `reserve()` a
   use before the work and `settle()` or `release()` it after — never check-then-charge,
   which lets parallel requests spend the same last use. Only successes are kept: an MP3
   produced, a file with a YouTube match, a reel saved as new. A used-up limit is `402`
   with `quota: "reel" | "file"`, and the frontend keys on the status to offer `/plan`.
   Admins (`ADMIN_EMAILS`, config not data) are never refused; admin routes 404 for
   everyone else. No payment exists anywhere — more is asked for and granted by hand.

## Gotchas that have already bitten

- **Motor client at import time crashes uvicorn** (`Future attached to a different loop`).
  Create it in `db.connect()` from the startup event, and reach collections as
  `db.songs_col`, never `from backend.db import songs_col` (which captures `None`).
- **Mongo `$in` does not preserve order.** Playlist playback order is the `song_ids`
  array, so sort in Python after fetching.
- **Audio needs Range support** or seeking silently fails. `GET /api/songs/{id}/audio`
  returns `206` + `Content-Range` + `Accept-Ranges` for a Range header, `200` otherwise.
- **yt-dlp reports float durations**; the contract says int. `serializers.py` casts.
- **A plain unique index counts every missing field as the same null.** `instagram_url` is
  unique, so the second upload collided with the first until the index became partial on
  `{"instagram_url": {"$type": "string"}}`. Uploads therefore *omit* the field — writing
  an explicit null puts the document back in the index and the collision returns.
- **`youtube/refresh` used to wipe** the links of any song with no track name, which is
  every lyrics match. It now searches `identify_query`, and changes nothing when there's
  nothing to search with.
- **A caption is not a song name.** It's the post's free text — one file's caption read
  "First 10 days of a 30 day program" and confidently returned a fitness video, because a
  caption match also *stopped the run* before the lyrics tier. Prose is held back and used
  only as a labelled `guess`. Never let a guess badge itself `BEST`.
- **Never take `ytsearch1:`.** `services/identify.py` ranks candidates (`- Topic`/VEVO up;
  slowed edits, hour-loops and Shorts down). Both the reel and file flows go through it,
  so a result is judged the same way wherever it appears.
- **Saving before identification finishes** loses the YouTube links permanently, because
  match results are cached only against the temp token. The Save button is disabled while
  matching — keep it that way.
- **`GOOGLE_CLIENT_ID` is read by the server, not baked into the build.** The login screen
  fetches it from `GET /api/auth/config`, so one `npm run build` works on any instance and
  a missing id produces an explanation instead of a dead button. Google matches authorised
  origins exactly: a client ID registered for `localhost` refuses `127.0.0.1`.
- **A 401 is not the caller's problem to render.** `api/client.js` turns any 401 into an
  app-wide signal; AuthContext drops the user and the login screen returns. A view that
  printed "Sign in to continue." next to its own form would read as being about that form.
- **Signing out has to silence the player.** The audio element lives above the router, so
  nothing else would stop it, and every queued `/audio` URL now 401s. PlayerContext
  listens for the signed-out signal and empties itself.
- **Pre-login rows have no `user_id`** and no query finds them. They're adopted on first
  sign-in (`LEGACY_OWNER_EMAIL`, else the oldest user document) — which is also why that
  check must not be "the only user": a second person signing in first would otherwise
  lock the old library away for good.
- **A copy of a shared song shares its GridFS file**, it does not duplicate the bytes. So
  `DELETE /api/songs/{id}` must count other documents pointing at that `gridfs_id` before
  deleting the file — an unconditional delete empties somebody else's library instead of
  this one's. Copying also reuses a song the copier already has (GridFS id first, then the
  normal duplicate rules), which is why the copy response reports `added` vs `already_had`.
- **The player reads `audio_url` off the song**, it no longer builds it from the id. A
  shared song's URL points at `/api/shared/...`, and the library's own route would 404 on
  it. Anything that constructs an audio URL by hand will play the wrong thing, or nothing.
- **A lyrics row's words are not all ours.** `mine[]` on the row holds the versions
  somebody typed in themselves — the answer to a crawl that found nothing, and free,
  because charging for it would put a price on our own failure. It sits in the same
  `.pill` switcher as the crawler's per-script candidates. `_BLANK` in
  `services/lyrics_jobs.py` is wiped every time a row is requeued: putting `mine`,
  `manual_title` or `manual_artist` in it would delete a person's own lyrics every
  time they pressed Look again. A row still holds exactly **one** reading, and
  `meaning_version` says which version it is about — shown beside any other it would
  pair every line with somebody else's words.
- **Song identification is best-effort.** A reel where someone sings the song themselves
  will never fingerprint, and often carries no music sticker either. The MP3 is the
  product; identification is a bonus. Degrade, never gate.

## Design system, in one screen

Full detail in [docs/DESIGN.md](../../../docs/DESIGN.md). The short version:

| Token | Value | For |
| --- | --- | --- |
| `--bg` `#0f1015` · `--card` `#191a22` · `--bg-elevated` `#1f2029` | surfaces, in that order of elevation |
| `--line` `#2a2c38` | every border |
| `--text` `#edeef3` · `--muted` `#9296a6` | type |
| `--accent` `#d6336c` · `--accent-2` `#f76707` | the gradient, focus, active nav |
| `--ok` `#37b24d` · `--err` `#ff6b6b` | success, failure |
| `--field` `#12131a` · `--placeholder` `#22232d` | inputs, image backings, avatar backing |

- Gradient `linear-gradient(90deg, var(--accent), var(--accent-2))` is rationed to three
  places: the brand mark (Brand.jsx), primary button, player progress fill.
- Tinted surface = `rgba(x,.10–.15)` fill + `rgba(x,.35–.4)` border + solid colour text.
- Radii `14` cards · `10` controls · `9` inner blocks · `6` video thumbs · `20` pills.
- Type `15px/1.5 system-ui`; `26` page title · `13.5` rows · `12.5` meta · `12` uppercase
  heads · `10.5` badges. No web fonts, no icon library — inline SVG at `currentColor`.
- Dark only. No light theme, no toggle.
- Navigation is three pieces. A **top bar** (rail toggle · brand · search · avatar) holds
  what is not a place. The **rail** holds where you go: Home · Add a reel · Add a file ·
  Lyrics, then a collapsible **You** (All songs · Playlists · Imports); the hamburger
  collapses it to 72px icon-over-label. There is exactly **one** Playlists row — the rail
  used to also list every playlist under a heading of the same name. **MobileTabs**
  replaces the rail under 760px with exactly five tabs (Home · Lyrics · Add · Songs ·
  You) and is a separate list on purpose — folding the rail down into it is what left
  seven worded tabs sharing 360px. A new destination joins the rail; it is not pinned
  beside the account, and it does not get a phone tab without one coming off.
- The login screen is the one view outside the shell: a centred 460px card, no sidebar, no
  player bar. Google's button is theirs — rendered by their script, not restyled.

## Interaction rules

Busy → disabled button + `<span className="spin" />`, restored in `finally`. One `.msg`
box, `.info` while working and `.err` on failure. Empty states are muted `.song` blocks
that say what to do next. Optimistic updates for add-to-playlist, reorder and loop, rolled
back on failure. Destructive actions confirm and name the thing; removing from a playlist
does not. Space toggles play, `←`/`→` seek, Escape closes. External links get
`target="_blank" rel="noopener"` — but YouTube plays in the embedded modal, never a
redirect.

## Voice

Plain, specific, lightly wry. Sentence case except uppercase section heads and `BEST`. No
exclamation marks, no "Oops!", no marketing adjectives, no emoji in the UI. Em dashes and
`·` separators. "That post isn't reachable — it may be private, deleted, or the URL is
off." not "Error: invalid input".

## Before calling it done

- `cd frontend && npm run build` compiles clean.
- Every colour is a token; radii and sizes come from the ladders.
- The player keeps playing across every navigation.
- Works at 360px and 320px: sidebar becomes bottom tabs, no horizontal scroll. Phone
  rules live only inside `@media (max-width: 760px)` — see "Phones" in docs/DESIGN.md.
- Run it and look: `./run.sh`, then <http://127.0.0.1:8000>. `./run.sh dev` for hot reload.
