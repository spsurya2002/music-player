# Component reference

The canonical CSS for every piece of Reelody's UI, plus recipes for extending it.
Copy from here instead of re-deriving values; drift starts with a 12px radius where the
rest of the page uses 10px.

Contents:
- [Shell](#shell) — page, column, heading
- [Surfaces](#surfaces) — card, tinted block, neutral block
- [Controls](#controls) — input, primary button, secondary button, spinner
- [Feedback](#feedback) — status box, empty state
- [Content](#content) — media header, download link, section head, result row, badge
- [Recipes](#recipes) — new component, new section, new variant colour

---

## Shell

```css
body {
  margin: 0; min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: 24px 16px;
  background: radial-gradient(900px 500px at 50% -10%, #241a2e 0%, var(--bg) 60%);
  color: var(--text);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.wrap { width: 100%; max-width: 480px; }
h1 {
  margin: 0 0 6px; font-size: 26px; letter-spacing: -0.4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.sub { margin: 0 0 22px; color: var(--muted); font-size: 14px; }
```

The body is a centring flexbox, so a tall page grows from the middle out. If content
ever needs to start at the top instead, change `align-items` to `flex-start` and add
top padding — don't drop the flex layout.

## Surfaces

**Card** — the only raised surface. One per page.

```css
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
```

**Tinted block** — coloured meaning (success, error, accent). The three-part recipe:
fill at `.10–.15` alpha, border at `.35–.40`, text at full colour.

```css
/* green / ok */   background: rgba(55,178,77,.12);  border: 1px solid rgba(55,178,77,.4);  color: var(--ok);
/* red / error */  background: rgba(255,107,107,.1); border: 1px solid rgba(255,107,107,.35); color: var(--err);
/* pink / accent */background: rgba(214,51,108,.09); border-color: rgba(214,51,108,.35);
/* orange / mid */ background: rgba(247,103,7,.15);  color: var(--accent-2);
```

**Neutral block** — a quiet inner surface with no meaning attached.

```css
background: rgba(255,255,255,.04); border: 1px solid var(--line); border-radius: 9px;
```

Nesting depth stops here: page → card → neutral/tinted block. A block inside a block
inside the card loses the flat, calm look.

## Controls

```css
.row { display: flex; gap: 8px; }

input {
  flex: 1; min-width: 0;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid var(--line); background: #12131a; color: var(--text);
  font-size: 14px; outline: none;
}
input:focus { border-color: var(--accent); }
```

`min-width: 0` on the input is load-bearing: without it a flex input refuses to shrink
and the button falls off narrow screens.

**Primary button** — gradient, one per view.

```css
button {
  padding: 12px 18px; border: 0; border-radius: 10px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
button:disabled { opacity: .55; cursor: not-allowed; }
```

**Secondary button** — same geometry, neutral fill: `background: rgba(255,255,255,.08)`.
That is the whole difference; don't introduce an outline or ghost style as a third tier.

**Spinner** — the only animation in the app.

```css
.spin {
  width: 14px; height: 14px; display: inline-block; vertical-align: -2px;
  border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
  border-radius: 50%; animation: s .7s linear infinite; margin-right: 7px;
}
@keyframes s { to { transform: rotate(360deg); } }
```

Busy-button pattern:

```js
btn.disabled = true;
btn.innerHTML = '<span class="spin"></span>Working';
try { /* … */ } finally { btn.disabled = false; btn.textContent = 'Extract'; }
```

## Feedback

**Status box** — one element, three states, driven by class.

```css
.msg { margin-top: 14px; padding: 11px 13px; border-radius: 10px; font-size: 13.5px; display: none; }
.msg.show { display: block; }
.msg.err  { background: rgba(255,107,107,.1); border: 1px solid rgba(255,107,107,.35); color: var(--err); }
.msg.info { background: rgba(255,255,255,.05); border: 1px solid var(--line); color: var(--muted); }
```

```js
function show(el, kind, text) { el.className = 'msg show ' + kind; el.textContent = text; }
function hide(el) { el.className = 'msg'; }
```

Note `show()` uses `textContent` — server messages go in as text, never as markup.

**Empty state** — a `.song` block in muted text that names the next move:

```html
<div class="song" style="color:var(--muted)">No YouTube results came back — try searching the name above.</div>
```

## Content

**Media header** — artwork plus two lines of text.

```css
.meta  { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.art   { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; background: #22232d; flex: none; }
.title { font-weight: 600; font-size: 15px; word-break: break-word; }
.by    { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
```

`.by` joins facts with ` · ` after dropping falsy ones:
`[artist, duration, size].filter(Boolean).join(' · ')`.

**Download link** — an `<a>` styled as a full-width green affordance.

```css
a.dl {
  display: block; text-align: center; padding: 11px; border-radius: 10px;
  background: rgba(55,178,77,.12); border: 1px solid rgba(55,178,77,.4);
  color: var(--ok); text-decoration: none; font-weight: 600; font-size: 14px;
}
```

**Section head** — how a new block announces itself inside the card.

```css
.matches { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); display: none; }
.matches.show { display: block; }
.mhead { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 10px; }
```

**Result row** — thumbnail, two lines, trailing badge. The hover border is transparent
until hover so rows don't stack into a grid of boxes.

```css
.yt { display: flex; gap: 10px; align-items: center; padding: 8px; border-radius: 10px;
      text-decoration: none; color: inherit; border: 1px solid transparent; }
.yt:hover { background: rgba(255,255,255,.05); border-color: var(--line); }
.yt.best  { background: rgba(214,51,108,.09); border-color: rgba(214,51,108,.35); }
.yt img   { width: 68px; height: 38px; border-radius: 6px; object-fit: cover; flex: none; background: #22232d; }
.yt .t    { font-size: 13px; font-weight: 500; line-height: 1.35; }
.yt .c    { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
```

The middle column needs `style="flex:1;min-width:0"` or long titles push the badge out.

**Badge** — a confidence pill; three tiers, never a fourth.

```css
.badge      { flex: none; font-size: 10.5px; font-weight: 700; padding: 3px 7px; border-radius: 20px;
              background: rgba(55,178,77,.15); color: var(--ok); }
.badge.mid  { background: rgba(247,103,7,.15); color: var(--accent-2); }
.badge.low  { background: rgba(255,255,255,.07); color: var(--muted); }
```

```js
const badgeClass = score => score >= 70 ? '' : score >= 45 ? ' mid' : ' low';
```

Green ≥70, orange ≥45, grey below. Keep those thresholds so a badge means the same
thing everywhere.

---

## Recipes

### A new component

1. Find the closest existing component and start from its CSS. A settings panel is a
   neutral block; a "copied!" confirmation is a tinted green block; a queue item is a
   `.yt` row without the thumbnail.
2. Take the radius from the ladder by depth: 14 outer, 10 control, 9 inner block.
3. Colour by meaning, not by decoration — `--ok` for things that worked, `--err` for
   things that failed, `--accent` for the one thing you want looked at, `--muted` for
   everything the user is not acting on right now.
4. Add the class to the `<style>` block next to its relatives, not at the bottom.
5. Name it the way the others are named: short, lower-case, no hyphens where a word does
   (`.song`, `.yt`, `.mhead`, `.dl`). Variants are a second class (`.badge.mid`).

### A new section in the card

```html
<div class="matches" id="tags">
  <div class="mhead">Tags</div>
  <div id="taglist"></div>
</div>
```

Reuse `.matches` (rename only if the file gains a third section, in which case rename it
to something neutral like `.section` everywhere at once). Toggle with `.show`, never
inline styles. Sections stack in the order the user meets them: input → status → result →
extras.

### A new accent colour

Don't, if an existing token carries the meaning. If a genuinely new meaning appears
(e.g. "queued"), add one token to `:root`, derive the tinted trio from it at the same
alphas as the others, and use it at least twice — a colour used once is noise.

### Adding a settings control

The app's settings are environment variables read at start-up (`PORT`, `AUDIO_QUALITY`,
`INSTA_COOKIES_BROWSER`), not client state. A settings control in the UI needs a matching
route in `app.py` and a decision about where the value lives; raise that with the user
before building the front end, otherwise the control looks real but changes nothing.
