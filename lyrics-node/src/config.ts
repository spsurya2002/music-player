import 'dotenv/config';

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  port: num(process.env.PORT, 4000),
  /** Origin allowed to call the API in dev; the Vite client proxies anyway. */
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  /** Per-request network budget. */
  fetchTimeoutMs: num(process.env.FETCH_TIMEOUT_MS, 8000),
  /** How many candidate pages we download at once. */
  crawlConcurrency: num(process.env.CRAWL_CONCURRENCY, 4),
  /** Hard cap on pages fetched for one search. */
  maxPagesPerSearch: num(process.env.MAX_PAGES_PER_SEARCH, 8),
  /** Stop early once a candidate scores at least this well. */
  goodEnoughScore: Number(process.env.GOOD_ENOUGH_SCORE ?? 0.8),
  /**
   * Never show a candidate below this. Search engines increasingly answer
   * scrapers with plausible-looking but unrelated pages; without a floor those
   * pages surface as a low-percentage "best guess", which is worse than
   * admitting we found nothing.
   */
  minScore: Number(process.env.MIN_SCORE ?? 0.45),
  /** Largest HTML body we will parse, in bytes. */
  maxHtmlBytes: num(process.env.MAX_HTML_BYTES, 2_000_000),

  /* ---- meaning layer ---- */
  /** Google AI Studio key. Without it the explain endpoint says so plainly. */
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  meaningModel: process.env.MEANING_MODEL ?? 'gemini-2.5-flash',
  /** Fresh dictionary lookups per request; cached words never count. */
  meaningMaxLookups: num(process.env.MEANING_MAX_LOOKUPS, 25),
  /** Unique lines per model call; longer songs are split at a stanza break. */
  meaningMaxLines: num(process.env.MEANING_MAX_LINES, 120),
  /** Where the dictionary and explanation caches live. */
  cacheDir: process.env.CACHE_DIR ?? '.cache',

  cacheTtlMs: num(process.env.CACHE_TTL_MS, 6 * 60 * 60 * 1000),
  cacheMaxEntries: num(process.env.CACHE_MAX_ENTRIES, 500),

  /** Politeness: minimum gap between two requests to the same host. */
  perHostDelayMs: num(process.env.PER_HOST_DELAY_MS, 700),

  /**
   * Most search engines and lyrics sites serve a challenge page to unknown
   * agents, so we present a normal desktop UA. Politeness is enforced instead
   * by honouring robots.txt, throttling per host and caching aggressively.
   */
  userAgent:
    process.env.USER_AGENT ??
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;
