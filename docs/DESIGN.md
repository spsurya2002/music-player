# Reelody — design system (v2, app shell)

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
appears on: the brand mark, the primary button, and the player's progress fill. Nothing
else. A fourth gradient makes it a landing page.

**The brand** is `components/Brand.jsx`: a gradient tile (135deg, radius 28%) holding a
white music note whose head is a ring — a reel's hub, a record's spindle hole — beside
the name in plain `--text`, 20px/700. The tile carries the gradient so the name doesn't
have to. The name lives in `APP_NAME` there; the manifest, `<title>` and README repeat it
because they can't import it. The logo links home (`/`) client-side, so tapping it never
stops the player. `public/icon-*.png` are the same mark, full-bleed for Android's masks.

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
┌────────────────────────────────────────────────────────┐
│ ☰  Reelody     [ search ]                     ◉        │  top bar, fixed, 56px
├──────────┬─────────────────────────────────────────────┤
│ rail     │  content (scrolls)                          │
│ 220px    │  max-width 920px, centred                   │
│ or 72px  │  padding 24px, 16px on phone                │
├──────────┼─────────────────────────────────────────────┤
│          │ player bar — fixed, 84px                    │
└──────────┴─────────────────────────────────────────────┘
```

Four fixed strips, each sized by one token: `--topbar-h` 56px, `--sidebar` 220px /
`--sidebar-mini` 72px, `--player-h` 84px. Everything else positions off those, so moving
one value moves the layout. Stacking, bottom to top: rail and queue panel 90, player bar
and phone tabs 100, top bar 110, modals 200.

- **Top bar** — rail toggle, brand (links home), search, avatar. It holds the two things
  that are not places, so the rail can be nothing but destinations. Search runs the same
  scored matcher as All songs and lands on `/songs?q=`, so a result is a URL. The avatar
  carries the badge that used to sit on a rail row: a count for an admin's waiting
  requests, a bare dot for an unread reply.
- **Rail** — Home · Add a reel · Add a file · Lyrics, then a collapsible **You**
  (All songs · Playlists · Imports). Two tiers: the four things that are each one place,
  then everything that is a collection of yours. Both Add routes are peers in the top
  tier rather than one row or one menu — what is behind them is the thing you came to do,
  and a label you have to open something to read is a label nobody reads. `/add` needs
  `end` or it stays lit on `/add/file`. **One Playlists row, and only one**: the rail used
  to repeat every playlist under a PLAYLISTS heading three rows below a link of the same
  name. The hamburger collapses the rail to 72px — icon over label, never icon alone,
  because a column of unlabelled glyphs is a quiz. The collapsed state and whether You is
  open both persist in `localStorage`. Desktop only.
- **Phone tabs** — a separate five-tab bar (Home · Lyrics · Add · Songs · You), written
  out rather than folded out of the rail. The rail used to *become* the tab bar by
  dissolving its groups with `display: contents`, which meant every row it gained landed
  on the phone too; at seven tabs each was narrower than the words in it. Five is the
  budget: 70px each at 360px against ~56px needed for a 20px icon and a 10.5px label.

### Phones (≤760px)

Everything phone-specific sits inside `@media (max-width: 760px)` — the desktop layout is
written once and phones override it, never the other way round. Check 360px (a normal
Android) and 320px (the smallest in use); nothing may scroll sideways.

- **Mini player**, `--player-h: 64px`: artwork, title over artist, play, next, loop,
  queue. The seek bar becomes a 3px line along the top edge with a taller invisible hit
  area; the timestamps and volume go. Previous goes too — the queue covers going back.
  An empty player is hidden rather than spending 64px on "nothing playing".
- **Song rows** show ▶ instead of the row number, since there's no hover to reveal it,
  keep the artist line, and drop the duration.
- **Song and playlist pages** stack: centred artwork, a full-width title with its tag
  and pencil under it, and a 2×2 grid of actions.
- **Playlist rows** keep only remove (×); add-to-playlist and download live on the
  song's page.
- **Playlists** are two cards a row.
- **Navigation** is the five-tab bar, not the rail — the rail is `display: none` here.
  The top bar stays, loses the hamburger, and drops the brand entirely under 420px so the
  search field keeps a usable width. Add is one tab here, not two: five is the budget,
  and `/add` shows both inputs as tabs once you arrive.
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
  `--accent`, **MP3** in `--accent-2`, **YOUTUBE** in `--text`, **SPOTIFY** in `--ok`,
  each `rgba(…,.12)` fill + `rgba(…,.35)` border. It states where a song came from, so
  it never uses the score colours — a tag is not a rating. Sits in the song row and
  beside the title on the song page.
- **ModeTabs** — `.mode-tabs`, the `.loop-toggle` pill scaled up to navigation size. Add
  music owned this and was its only caller; both of its inputs are rail rows now, so the
  Requests / Users switch on Admin is the one thing left that needs it. The file kept the
  class names and lost the page in its name.
- **Eyebrow** — `.eyebrow`, a muted 13px kicker above a `.page-title`. For framing a
  heading (the greeting on Add music) without competing with it; the moment it reads as
  the headline it isn't an eyebrow any more.
- **Dropzone** — `.dropzone`, a dashed `--line` border over `--field` with an icon and two
  lines of text; solid accent-tinted once a file is chosen. Picking a file starts the work
  immediately, so the zone itself carries the busy state (`.is-busy`, spinner in place of
  the icon) rather than handing off to a submit button.
- **PlaylistCard** — 4:3 cover from the first song's thumbnail (or a gradient block when
  empty), name, `n songs · total time`. One card serves both grids: on your own Playlists
  page a shared one adds a small accent `globe · Shared` line; on the Shared page it adds
  an 18px avatar and `Shared by <first name>` (or `Shared by you`) instead. Same card,
  because they are the same object and shouldn't drift apart.
- **Share** — on your own playlist page, a button in `.detail-actions` immediately after
  Delete playlist. Private uses the primary button ("Share"); shared uses a secondary
  button ("Stop sharing") — turning something off is never the loud action. The button's
  title says what public means, including that your name and picture are shown, because a
  sharing switch that doesn't say what it exposes isn't consent. The state itself sits
  next to the rename pencil: `.share-state` is a closed lock in `--muted` while private,
  and an open lock in `--accent` once shared. It is a mark, not a second control.
- **Home** — the only ungated route, and it does different work depending on who is here,
  which is what "signed out is a state of the app" means in practice.
  `.home-hero` opens it: greeting as the `h1`, then one paragraph at a 62ch measure. A
  `--card` surface, **not** a gradient panel — the gradient is rationed to the wordmark,
  the primary button and the player fill, and a hero is exactly where an accent gets spent
  without earning it. The gradient in the page title is the accent here and it is enough.
  The greeting lives on this page and nowhere else: on a task page it outranked the task.
  A **visitor** gets the full sentence of what Reelody is — three ways in, and the words
  as well as the audio — plus Sign in. Someone **signed in** already knows, so the
  paragraph shortens to one line and the space goes to their own work instead:
  `.home-doors`, the three ways in as equal cards (auto-fit, so they go two-up then stack
  rather than squeezing to three), then **Recently saved** and **Recently read** as
  `.home-row` lists, then the shared feed. The row artwork *is* the play button — it is
  where the hand goes anyway, and it keeps a second control off a row that is mostly
  title. Both personal sections are a nicety on a page that works without them, so a
  failed fetch drops the section rather than the page.
- **SignInPrompt** — `.signin-prompt`, centred in the content area where a view's contents
  would be: faded icon, 19px title, one muted line, one button. Not a card — a bordered box
  reads as a dialog interrupting the page, and this *is* the page. Each one states that
  page's own reason to sign in; a prompt that says the same thing everywhere is a wall, not
  an answer.
- **SharedPill** — `.shared-pill`, the `.source-tag` recipe in the accent, next to the
  title of a shared playlist. States a fact about the playlist, so it never uses the score
  colours.
- **PlayerBar** — left: art + title + artist; centre: prev / play-pause / next, then the
  seek bar with elapsed and total; right: loop toggle, queue toggle, volume. Progress fill
  uses the gradient; the rail is `--line`.
- **QueuePanel** — right drawer, 320px, lists what's next, drag to reorder, click to jump.
- **Modal** — `--bg-elevated`, radius 14, backdrop `rgba(0,0,0,.6)`, closes on Escape and
  backdrop click. Used for create-playlist, add-to-playlist, confirm-delete and the
  YouTube player.
- **YouTubePlayer** — modal, 16:9 iframe via the YouTube IFrame API. Opening it **pauses
  the MP3 player**; two things must never play at once.
- **Avatar** — `.avatar`, a circle sized by the caller (22px in the rail, 56px on Account).
  When there's no picture, or Google's image host is blocked, it falls back to the initial
  on a gradient block — a broken-image icon in the sidebar reads as a bug.
- **Login screen** — the only view with no sidebar and no player bar: one centred `.card`,
  max-width 460, holding the wordmark, a one-line promise, Google's own button and a fine
  print line about what's stored. Google's button is rendered by their script
  (`theme: filled_black`, `shape: pill`) because their branding rules don't allow a
  hand-rolled one — it is the single control on the page that isn't ours.
- **Account** — profile card (avatar · name · email · "Here since"), a three-up stat grid
  (songs · playlists · plays, numbers at 26px, em dash until they load), the two limit
  meters (compact) with a "Request more" button — not for admins, whose limits don't
  exist — then the sign-out card. Stats come from the server, so a song saved on another device shows up.
- **QuotaNote** — `.quota-note`, one 12.5px line under a form that spends a use: "3 of 5
  reel extractions left. Plan". Muted until it runs out, then `--err` with "Ask for more" —
  the same colour the refusal itself arrives in. Says nothing for an unlimited account.
- **ErrorMsg** — `.msg.err` that takes the ApiError itself; a 402 gets an "Ask for more"
  link to `/plan` after the server's sentence.
- **QuotaMeter** — `.quota-meter`, a `.card` with an uppercase feature name, a 20px
  `used / limit` (or "Unlimited"), a 6px bar on `--placeholder` filled with **solid
  `--accent`** — not the gradient, which stays rationed — turning `--err` when used up.
  Two side by side in `.quota-meters`, stacked under 520px.
- **Plan tiers** — `.plan-tier`, two cards (Free · More). The one you're on takes the
  accent tint (`rgba(214,51,108,.06)` fill, `.35` border) and a green "Yours" badge. There
  are no prices: "More" is "On request — no card, no payment".
- **Reply block** — `.plan-request-reply`, the admin's answer set in under the question:
  `--field` fill, a 2px `--accent` left rule, an uppercase "Admin" label. An unread answer
  gives its row an `--accent-2` border and a "New" badge.
- **Rail badges** — `.sidebar-count`, a solid `--accent` pill with the number of waiting
  requests on the Admin row, `--accent-2` "New" (`.new`) on Request more for an unread
  answer. An `<i>`, so the phone rule that hides the foot links' `<span>` labels can't
  take it too.
- **Admin lists** — `.admin-list`, one `.card` with no padding holding rows divided by
  `--line`, like an inbox: avatar · name · time · the message on one line · usage chips
  (`.usage-chip`, `--err` tint when used up) · one action. A row opens its controls
  underneath (`.admin-panel`, indented to the text column) only when asked, **one row at a
  time**, so a queue of ten stays ten lines. Users rows swap the chips for one
  `.mini-meter` per paid feature (label, used/limit, 3px bar; no bar when unlimited) and a
  pencil. The chips and meters are driven off `FEATURES` in `components/Quota.jsx`, so a
  new limit appears in all of them without an edit here.
- **GrantControl** — `.grant`, one line per feature: its name and usage, then `.pill`
  choices — No change · +5 · +10 · +25 · Unlimited · Custom (a pill-shaped number input,
  `color-scheme: dark`). Admins think "give them 10 more", so that's what the pills say;
  the page works out the total the server wants and previews it in `--ok` ("Reel → MP3
  5 → 15") beside the buttons. A note is optional to approve and asked for, with focus
  moved to it, only when declining.

- **YouTubePlayer** — one player, two shapes. The **modal** is a YouTube match
  you clicked on a song page: you went there to watch it, so it takes the
  screen. The **dock** is a 340px card in the bottom-right, above the player bar
  and clear of the reading column, opened by **Listen** on a lyrics page — the
  song is meant to play while you read, so a modal there would cover the only
  thing you came for. Folding it keeps the sound and drops the video to a title
  bar (a height change, never unmounting the iframe). It steps 320px left when
  the queue drawer is open rather than stacking over it, and on phones it spans
  the width above the tabs. Stacking: 120 — over the top bar, the player bar and the
  book's full view, under a modal.
- **LyricsBook** — the reading view, and the only place in the app with a serif.
  A facing-page spread: the words (plus their romanisation) on the left, the
  line-by-line reading on the right, turned four couplets at a time. The pairing
  is the point — stacked, you have to hold a line in your head while you scroll
  to find its meaning. The book feeling has to come from something other than
  paper, since the app is dark only, so it comes from a real gutter with a
  shadow falling into it, page numbers in the outer corners, a local serif for
  the verse (`Georgia`, no web font), and a page that actually turns. **The
  right page stays blank until a reading is asked for**, which is the step that
  costs — an empty page beside full words says so better than a banner. Phones
  stack the two pages, so a couplet still sits directly above its reading.
  - **The turn** is a real leaf, not a fade: one absolutely positioned page with
    two faces, hinged on the spine and rotated in 3D under a `2200px`
    perspective, with `backface-visibility` swapping the faces as it passes
    edge-on. Going forward the leaf *is* the right page — its back is the next
    spread's left page, so when it lands flat the content underneath has already
    become the same thing and dropping the leaf changes nothing on screen.
    Phones have one column, so there the leaf is the whole spread hinged at its
    left edge and its back is blank, because the back of a page is. Light does
    the rest: a gradient on each face that is darkest at the spine, plus the
    shadow the standing leaf throws on the page it is uncovering. 620ms on
    `cubic-bezier(.37,.09,.23,1)` — slow off the mark, quick through the middle.
  - **Drag it across** (pointer events, so a mouse and a finger are the same
    code), or ◀ ▶, or the arrow keys. A drag claims the pointer only after 10px
    that beat its own vertical travel, so scrolling still wins the toss, and
    `touch-action: pan-y` says the same thing to the browser. Let go past a
    third of the way, or flick it, and it finishes; short of that it falls back.
    A released drag's remaining travel sets its own duration, so a page let go
    at four fifths does not then take the full 620ms. Pressing ▶ again mid-turn
    queues rather than being swallowed — people press it four times.
  - **It makes a sound**, synthesised in `utils/pageSound.js` rather than
    shipped: noise through a sweeping bandpass under a fast envelope, two
    overlapping swishes, randomised a little each turn so forty pages don't
    sound like a machine. Quiet, under half a second, and not a second player —
    the rule about never two sounds at once is about music, and a page rustling
    over the song you are reading along to is the point. A speaker toggle sits
    at the right of the turn bar and the choice is remembered in `localStorage`.
  - **Whose words these are** is marked at the left of the turn bar: a pill reading
    *Added by you* in the accent tint, or *Found at <site>* in `--line`/`--muted`, with
    the long version in its `title`. The switcher above the book says the same thing,
    but it has scrolled off by the second spread and is not on the screen at all in
    full view — and "did a person type this or did a crawler find it" is exactly the
    question that comes up while reading, not before. The drag hint shares the slot and
    is the half that gives way when there is no room.
  - **Full view** takes the book to the whole window — an `.icon-btn` at the right
    of the turn bar, Escape or the same button to come back out, and the title in a
    thin header because the page's own is now behind it. It is a fixed overlay at
    `z-index: 115`, *not* the Fullscreen API: a real fullscreen element paints alone,
    which would take the YouTube dock off the screen at the exact moment somebody
    settles in to read with the song playing. 115 is above the top bar (110) and under
    the dock (120), so the page goes and the dock stays where it was left. The pages
    give the extra width back as margin rather than as longer lines, and `--book-h`
    stops being a clamp of the viewport. This is also why the turn bar renders for a
    one-spread book, with the pager and the sound toggle left out of it.
  - `prefers-reduced-motion: reduce` gets none of it: the leaf is never built,
    dragging is off, and the page simply changes.
- **LyricsSection** — the third `.detail-section` on a song page, and the longest block
  in the app, so it leans on inset depth to stay readable: the words and each explained
  line sit in a `--field` well with a `--line` border at radius 9, matching `.ident-log`.
  Head is the usual `.mhead` + a refresh `.icon-btn`. Then a one-line source row —
  `.badge` on the confidence ladder (High ≥.8 · Likely ≥.6 · Best guess), the site as an
  `.ext-link`, and a `--muted` note when the words were romanised for us — with the
  scoring reasons folded into a `<details>`. The explanation is `.pill` tags (tradition ·
  poet · themes), a 13.5px summary, then one well per line: the line itself at 13.5px,
  its romanisation and restatement under it at 12.5–13px `--muted`, and the deeper note
  (about a third of lines earn one) set off by a `--line` left rule rather than a colour.
  The glossary is a `<dl>`; a word the dictionary knew links out and carries its origin as
  a 10.5px uppercase pill. The "one interpretation, not the last word" caveat is a `.hint`
  at the foot — said once, after the thing it qualifies, never as a banner over it. On
  phones the `<ol>` drops its markers and padding, because the line number is already in
  the text above.

- **NoWordsPanel** — what a lookup that found nothing offers instead of a dead end.
  Shaped on `.lyrics-keep`: the same accent-tinted bar at radius 10, a 13.5px `--accent`
  title over a 12.5px `--muted` line, and the buttons that settle it ranged right —
  **Add the words** primary, Keep it `.secondary`, Discard `.ghost`. The question is the
  point: the crawler refusing to guess is it working, but the song is usually on the open
  web in ten seconds, so the next thing on screen is somewhere to put it. Under it, a
  plain underlined sentence opens a two-field `.inline-edit-row` form for naming the
  lookup — optional, and set as a sentence rather than a fourth button so it never
  competes with the three answers above. It wears the same shape after a Stop, with the
  first line reworded; stopping is a reason to have no words like any other.
  **Every "there are no words" notice is conditional on that still being true.** The
  panel, the stopped block and the failure sentence all go the moment there is
  something to read — a crawl that worked, or words somebody typed in — because a
  question asked over its own answer reads as the page not having noticed. The failure
  sentence goes further and leaves on its own after five seconds (`.lyrics-said`, a
  400ms fade): it explains an empty page, and once it has been read it is only a page
  that still looks broken. Nothing is lost — while it is still true, the panel under it
  says the same thing and offers somewhere to put the words.
- **RenameLyricsModal** — what to call a lookup, from anywhere it is listed. A plain
  `Modal` with the song page's two `.inline-edit-row` fields (Song · Artist), reached by
  a pencil `.icon-btn` in the lookup's header and on every row of All lyrics and a
  collection. A lookup is filed under whatever started it, which is usually a YouTube
  URL — a crawl that found nothing resolved no names, and one that found the wrong song
  resolved confident wrong ones, and neither is fixable by looking again. Emptying the
  Song box takes a name back off and lets whatever the crawl resolved show through, but
  a row with no name of its own cannot be saved nameless. NoWordsPanel keeps its own
  underlined sentence: the same write, offered at the moment it is first needed.
- **AddLyricsModal** — `Modal` at 560, wider than the rest because the thing going into it
  is a whole song. One `textarea` at `min-height: 220px`, `line-height: 1.7` and
  `dir="auto"`, so Urdu pasted into it reads right-to-left as you type it; an optional
  label field under it; and a character count at 12px tabular numerals that turns `--err`
  past the 12,000 the sidecar will read. The same form edits a version, and warns in a
  `.msg.info` when the words being changed are the ones a reading was made from.
- **The version switcher** — `.lyrics-scripts`, the `.pill` row under the source line.
  The finder's per-script candidates come first, then a 1px `--line` hairline, then yours,
  then `+ Add yours` last. Your pills are dashed until selected, and `+ Add yours` stays
  dashed and `--muted` always, because it opens a box rather than changing what is on
  screen. Selecting one of yours swaps the confidence badge for a `Yours` badge in the
  accent tint and two `.icon-btn`s — pencil and bin. A song holds one reading, so a
  version without it gets a `--field` strip saying which version has it and offering to
  read this one instead; the book's own explain button is off while that strip is up, so
  the one action that replaces a paid-for reading is never the easy one to hit by accident.

- **Menu** — `components/Menu.jsx`, the dropdown behind the avatar:
  elevated surface, `--line` border, 10px radius, a shadow deep enough to float over a
  card. Closes on outside click *and* Escape. An item may carry a second `--muted` line
  (what each Add input is for, what's left of your limits). `SongRow` still has its own
  copy of this shape and could adopt it.

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
- Nothing is fetched from a CDN at load. Two exceptions, both loaded on demand and never on
  a page that doesn't need them: the YouTube IFrame API when a video is opened, and Google
  Identity Services on the login screen.
