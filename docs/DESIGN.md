# Reel Audio — design system (v2, app shell)

v1 was one centred 480px card. This app is a media library: a sidebar, a scrolling
content area, a persistent player. The **visual language does not change** — same tokens,
same tinted-surface recipe, same voice. Only the layout grows.

Ported verbatim from the v1 skill; treat as non-negotiable.

## Tokens

Defined once on `:root` in `src/theme.css`. Use the variable, never the hex — a literal
`#d6336c` in a component is the first crack in the theme.

| Token | Value | Use for |
| --- | --- | --- |
| `--bg` | `#0f1015` | page base, under the radial glow |
| `--card` | `#191a22` | any raised surface |
| `--line` | `#2a2c38` | every border and divider |
| `--text` | `#edeef3` | primary text |
| `--muted` | `#9296a6` | secondary text, hints, captions, meta |
| `--accent` | `#d6336c` | pink end of gradient, focus rings, active nav, "best" |
| `--accent-2` | `#f76707` | orange end of gradient, mid-confidence |
| `--ok` | `#37b24d` | download, high-confidence badge, save confirmation |
| `--err` | `#ff6b6b` | errors, destructive actions |

New tokens for the shell (derived, not invented):

| Token | Value | Use for |
| --- | --- | --- |
| `--bg-elevated` | `#1f2029` | player bar, modal surface — one step above `--card` |
| `--hover` | `rgba(255,255,255,.05)` | row hover |
| `--sidebar` | `220px` | nav column width |
| `--player-h` | `84px` | player bar height; content reserves this at the bottom |

Page background stays `radial-gradient(900px 500px at 50% -10%, #241a2e 0%, var(--bg) 60%)`
on the app shell, fixed so it doesn't scroll away.

**Dark only.** No light theme, no toggle.

## Accent discipline

The gradient `linear-gradient(90deg, var(--accent), var(--accent-2))` is rationed. It
appears on: the wordmark, the primary button, and the player's progress fill. Nothing
else. A fourth gradient makes it a landing page.

- **Tinted surface** = `rgba(<rgb>, .10–.15)` fill + `rgba(<rgb>, .35–.4)` border + the
  solid colour as text. Keep the trio together.
- **Neutral surface** = `rgba(255,255,255,.04–.08)` over `1px solid var(--line)`.

## Geometry

- **Radii:** `14px` cards/modals · `10px` controls, thumbnails, rows · `9px` inner blocks ·
  `6px` video thumbs · `20px` pills.
- **Type:** `15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
  `26px` page title · `20px` section title · `15px` row title · `14px` controls ·
  `13.5px` body/rows · `12.5px` meta · `12px` uppercase heads (`letter-spacing:.6px`,
  `--muted`) · `10.5px` badges. No web fonts, no icon font.
- **Weights:** `700` badges · `600` buttons/titles · `500` row titles · normal elsewhere.
- **Spacing:** `8 / 10 / 12 / 16 / 18 / 22px`. Card padding `18px`.
- **Icons:** inline SVG only, `currentColor`, 16–20px, stroke 1.5–2. No icon library, no
  emoji in the UI.

## Layout

```
┌──────────┬────────────────────────────────┐
│ sidebar  │  content (scrolls)             │
│ 220px    │  max-width 920px, centred       │
│ fixed    │  padding 24px, 16px on phone    │
├──────────┴────────────────────────────────┤
│ player bar — fixed, full width, 84px      │
└───────────────────────────────────────────┘
```

- Sidebar: wordmark, nav (Search · All songs · Playlists), then the playlist list.
  Collapses to a bottom tab row under 760px; the player bar sits above it.
- Content reserves `--player-h` of bottom padding so the last row is never hidden.
- The player bar is **always mounted** and never unmounts on navigation — that is the
  whole point of the SPA. Audio must not restart when the view changes.

## Components

Carried over from v1, unchanged in look: `.card`, `.row`, `.hint`, `.msg` (`.err`/`.info`),
`.badge` (`.mid`/`.low`), `.spin`, `.song` (muted inner block / empty state), the YouTube
result row (thumb · two lines · badge, first one highlighted with the accent tint).

New, built from the same recipes:

- **SongRow** — index/play button · thumbnail 40px · title + artist · source tag · duration
  · overflow menu. Hover reveals the play button over the index and lifts with `--hover`.
  The row currently playing shows its title in `--accent`.
- **SourceTag** — `.source-tag`, the badge pill in tinted-surface form: **INSTA** in
  `--accent`, **MP3** in `--accent-2`, both `rgba(…,.12)` fill + `rgba(…,.35)` border.
  It states where a song came from, so it never uses the score colours — a tag is not a
  rating. Sits in the song row and beside the title on the song page.
- **Dropzone** — `.dropzone`, a dashed `--line` border over `--field` with an icon and two
  lines of text; solid accent-tinted once a file is chosen. Picking a file starts the work
  immediately, so the zone itself carries the busy state (`.is-busy`, spinner in place of
  the icon) rather than handing off to a submit button.
- **PlaylistCard** — 4:3 cover from the first song's thumbnail (or a gradient block when
  empty), name, `n songs · total time`.
- **PlayerBar** — left: art + title + artist; centre: prev / play-pause / next, then the
  seek bar with elapsed and total; right: loop toggle, queue toggle, volume. Progress fill
  uses the gradient; the rail is `--line`.
- **QueuePanel** — right drawer, 320px, lists what's next, drag to reorder, click to jump.
- **Modal** — `--bg-elevated`, radius 14, backdrop `rgba(0,0,0,.6)`, closes on Escape and
  backdrop click. Used for create-playlist, add-to-playlist, confirm-delete and the
  YouTube player.
- **YouTubePlayer** — modal, 16:9 iframe via the YouTube IFrame API. Opening it **pauses
  the MP3 player**; two things must never play at once.

## Interaction rules

1. **Never block silently.** Buttons disable and swap their label for
   `<span class="spin"/>Working`, restored in a `finally`.
2. **Errors are sentences.** Render the server's `error` string as-is. Only invent a line
   when the request never reached the server.
3. **Empty states say what to do next**, in a muted `.song` block: "Nothing saved yet —
   paste a reel link to start." An empty region with nothing in it reads as a bug.
4. **Degrade, never gate.** The MP3 is the product. A failed identification, a missing
   thumbnail or a dead YouTube search leaves everything else on screen working.
5. **Optimistic where it's safe** (add to playlist, reorder, loop toggle) — update the UI
   immediately, reconcile on the response, roll back with a `.msg.err` on failure.
6. **Destructive actions confirm**, naming the thing: "Delete "Artist — Track" from your
   library? The MP3 goes too." Removing from a playlist does **not** confirm; it's cheap
   and reversible.
7. **Keyboard:** Space toggles play (unless a field is focused), `←`/`→` seek 5s, Escape
   closes modals and the queue, Enter submits any form.
8. **External links** carry `target="_blank" rel="noopener"`. YouTube opens in the embedded
   player, never a redirect — that is an explicit requirement.
9. React escapes by default; never use `dangerouslySetInnerHTML` on remote strings.

## Voice

Plain, specific, lightly wry. Sentence case except uppercase section heads and the `BEST`
badge. No exclamation marks, no "Oops!", no marketing adjectives. Em dashes and `·`
separators are house style. Prefer "That post isn't reachable — it may be private,
deleted, or the URL is off." over "Error: invalid input".

## Done means

- Every colour is a `var(--…)` or an `rgba()` derived from one.
- Radii, sizes and gaps come from the ladders above.
- Busy → disabled + spinner; failure → `.msg.err`; empty → muted `.song`.
- The player survives every navigation without a gap in playback.
- Works at 360px: sidebar becomes tabs, player bar stays usable, no horizontal scroll.
- Nothing is fetched from a CDN at load. The YouTube IFrame API is the sole exception,
  loaded only when the user opens a video.
