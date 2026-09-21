---
name: reel-audio-ui
description: Architecture and front-end conventions for Reel Audio, a React + FastAPI + MongoDB media library that turns Instagram reels into a saved MP3 collection. Use this skill for ANY work on this repo — adding or changing a view, component, player behaviour, API endpoint, database field or playlist feature; restyling anything; "make the UI nicer"; or wiring new markup to the backend. Read it BEFORE writing JSX, CSS, or a FastAPI route, so new work inherits the existing tokens, component shapes, data model and voice instead of inventing a second set.
---

# Reel Audio

Paste an Instagram reel link, get the MP3, keep it in a library with playlists, play it
without leaving the page. One dark, plum-black product: a sidebar, a scrolling content
area, and a player bar that never stops.

## Where things live

```
backend/          FastAPI + Motor (async MongoDB). Owns all state.
  main.py         app, exception handlers, serves frontend/dist in production
  db.py           motor client (created in startup, NOT at import — see gotchas)
  storage.py      GridFS put/open/delete
  serializers.py  Mongo doc -> API shape. The only place _id becomes id.
  streaming.py    Range-request handling for audio
  services/       identify.py (song ID + YouTube ranking), extractor.py (yt-dlp), cookies.py
                  file_identify.py (tiers for an uploaded file — a verbatim port, do not
                  tune it), file_match.py (how far to trust each tier + ranking),
                  ident_jobs.py (runs those jobs, holds their results)
  routers/        extract.py, identify.py, songs.py, playlists.py
frontend/         Vite + React 19, plain JSX, hand-written CSS
  src/theme.css   the tokens — the source of truth for colour
  src/context/PlayerContext.jsx   the audio element, queue, loop, YouTube modal state
  src/Shell.jsx   sidebar + <Routes> + player bar as siblings
  src/api/client.js  every fetch goes through here, nowhere else
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
2. **Never two sounds at once.** Opening the YouTube modal pauses the MP3 player.
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
9. **One `songs` collection holds both kinds.** A reel (`source: "instagram"`) and an
   uploaded file (`source: "upload"`) differ only in provenance; All songs lists both, the
   player plays both, any playlist takes either. The UI separates them with a tag —
   INSTA / MP3 — not with separate libraries or a default "Uploads" playlist.

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
| `--field` `#12131a` · `--placeholder` `#22232d` | inputs, image backings |

- Gradient `linear-gradient(90deg, var(--accent), var(--accent-2))` is rationed to three
  places: wordmark, primary button, player progress fill.
- Tinted surface = `rgba(x,.10–.15)` fill + `rgba(x,.35–.4)` border + solid colour text.
- Radii `14` cards · `10` controls · `9` inner blocks · `6` video thumbs · `20` pills.
- Type `15px/1.5 system-ui`; `26` page title · `13.5` rows · `12.5` meta · `12` uppercase
  heads · `10.5` badges. No web fonts, no icon library — inline SVG at `currentColor`.
- Dark only. No light theme, no toggle.

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
- Works at 360px: sidebar becomes bottom tabs, no horizontal scroll.
- Run it and look: `./run.sh`, then <http://127.0.0.1:8000>. `./run.sh dev` for hot reload.
