# lyrics-node

The lyrics pipeline, vendored from the standalone `lyrics-finder` project. It finds a
song's lyrics by asking the open databases, then scraping search engines and lyrics
sites when they come up empty, and explains them line by line with Gemini.

**This is a near-verbatim copy and should stay one.** The scoring weights in
`services/crawler.ts`, the thresholds in `config.ts` (`MIN_SCORE`, `GOOD_ENOUGH_SCORE`)
and the `lyricsLikeness` penalties in `services/extractor.ts` are calibrated against
each other, and there are no tests. Read `services/lyricsFinder.ts` first — it is the
orchestrator and everything else is a stage.

Four things differ from upstream, all for the same reason — this process is now a
private sidecar rather than a public API:

1. `src/index.ts` binds `127.0.0.1` instead of every interface.
2. There is no CORS middleware. No browser may call this.
3. Both routes lost their `express-rate-limit` guards. The only caller is Reelody's
   lyrics worker, which runs one job at a time; the real per-user limit is
   `backend/services/quota.py`.
4. `package.json` dropped `undici` (declared upstream, never imported).

## How Reelody uses it

`run.sh` starts it on `:4001` with `CACHE_DIR` pointed at `backend/lyrics-cache/`.
`backend/services/lyrics.py` is the only module in the Python app that knows it exists;
it calls `GET /api/lyrics?q=…` and `POST /api/meaning`. Everything a user can see —
sign-in, ownership, quota, the job row, the error sentences — is decided on the Python
side before a request ever gets here.

## Configuration

`GEMINI_API_KEY` goes in `lyrics-node/.env` (see `.env.example`). Without it lyrics are
still found and stored; only the explanation is skipped, and the song page says so.
`src/config.ts` lists every other knob with its default.

## Working on it

    npm run typecheck     # must be clean
    npm run build         # -> dist/
    npm run dev           # tsx watch, for iterating

Add `&refresh=1` when testing the pipeline by hand, or the 6-hour in-memory result
cache will mask your change. Delete `backend/lyrics-cache/meanings/` or bump
`PROMPT_VERSION` in `src/services/meaning/index.ts` to re-test an explanation — that
cache is content-hashed and has no TTL.
