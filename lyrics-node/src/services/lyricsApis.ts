import { fetchJson, HttpError } from '../utils/http.js';
import { TtlCache } from '../utils/cache.js';
import { config } from '../config.js';
import { detectScripts, distinctiveTokens, tidyLyrics, tokenCoverage } from '../utils/text.js';
import { lyricsLikeness } from './extractor.js';
import type { LyricsCandidate, SongQuery } from '../types.js';

/**
 * Several readings of one query ask these databases the same thing, and they
 * answer a burst with 503. Remember what each endpoint said.
 */
const rowCache = new TtlCache<LrclibTrack[]>(config.cacheTtlMs, config.cacheMaxEntries);

/**
 * Open lyrics databases we can ask directly. They are not a replacement for
 * crawling — coverage outside the mainstream is patchy — but they answer
 * honestly, which scraped search engines no longer reliably do.
 */

interface LrclibTrack {
  id?: number;
  trackName?: string;
  artistName?: string;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

/**
 * Database rows carry release junk in their names ("Shape of You [Shape of
 * You, 2017]"). Drop it, but only when something is left to show.
 */
function tidyName(name: string): string {
  const cleaned = name
    .replace(/\s*[\[(][^\])]*[\])]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || name.trim();
}

interface RowInput {
  url: string;
  site: string;
  trackName: string;
  artistName: string;
  lyrics: string;
  /** Row found by a relaxed query, so the title will not match word for word. */
  loose?: boolean;
}

function candidateFrom(query: SongQuery, row: RowInput): LyricsCandidate | null {
  const text = tidyLyrics(row.lyrics);
  if (text.length < 120) return null;

  const titleMatch = tokenCoverage(query.title, row.trackName);
  const artistMatch = query.artist ? tokenCoverage(query.artist, row.artistName) : 1;
  const likeness = lyricsLikeness(text);
  const scripts = detectScripts(text);
  const reasons = [`matched in the ${row.site} database`];

  let score: number;
  if (row.loose) {
    // A different transliteration of the same song ("Sakhi Ka Se Kahoon" vs
    // "Kahoon Kaise Sakhi"): the words have to be there even if the title
    // spelling is not, so check the track and its lyrics before believing it.
    // Only the title's own words count — `raw` may be a YouTube URL.
    const wanted = distinctiveTokens(query.title, 3);
    const haystack = `${row.trackName} ${text.slice(0, 2000)}`;
    if (wanted.length === 0 || tokenCoverage(wanted.join(' '), haystack) < 0.75) return null;

    reasons.push('the song’s words appear under a different spelling');
    score = Math.min(0.78, 0.4 + 0.25 * likeness + 0.15 * artistMatch);
  } else {
    // The database answered our exact query, so only accept rows that really
    // are the song we asked for.
    if (titleMatch < 0.6) return null;
    reasons.push('title matches the track');
    score = Math.min(1, 0.45 + 0.25 * titleMatch + 0.15 * artistMatch + 0.15 * likeness);

    // Right title, unrelated performer: usually a cover or a same-name track.
    // Still worth showing, but never ahead of a row that matches the artist too.
    if (query.artist && artistMatch < 0.34) score *= 0.6;
  }

  return {
    url: row.url,
    site: row.site,
    pageTitle: `${row.artistName} – ${row.trackName}`,
    lyrics: text,
    detectedTitle: row.trackName,
    detectedArtist: row.artistName,
    script: scripts[0],
    scripts,
    score,
    reasons,
  };
}

/**
 * Ways to ask LRCLIB about one song, narrowest first. Its `q` search matches
 * every word in any order, which is what lets the last, loosest attempt find a
 * song filed under another transliteration of the same title.
 */
function lrclibQueries(query: SongQuery): Array<{ url: string; loose: boolean }> {
  const exact = new URLSearchParams({ track_name: query.title });
  if (query.artist) exact.set('artist_name', query.artist);

  const search = (q: string) => `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
  const loose = distinctiveTokens(query.title, 2).join(' ');

  const queries = [
    { url: `https://lrclib.net/api/search?${exact.toString()}`, loose: false },
    { url: search([query.artist, query.title].filter(Boolean).join(' ')), loose: false },
    { url: search(query.title), loose: false },
  ];
  if (loose && loose !== query.title.toLowerCase()) queries.push({ url: search(loose), loose: true });

  return queries;
}

async function lrclibRows(url: string): Promise<LrclibTrack[]> {
  const cached = rowCache.get(url);
  if (cached) return cached;

  // Throttled, and patient with a 503: this is one small service answering
  // everyone, and a burst of lookups is exactly what makes it say no.
  const rows = await fetchJson<LrclibTrack[]>(url, { retries: 2 });
  const list = Array.isArray(rows) ? rows : [];
  rowCache.set(url, list);
  return list;
}

/** LRCLIB: community lyrics database, no key, good non-English coverage. */
async function fromLrclib(query: SongQuery): Promise<LyricsCandidate[]> {
  // Songs like these exist in the database several times over: the same words
  // in Urdu, in Devanagari and romanised. Keep the best of each script so the
  // reader can pick the one they can actually read.
  const perScript = new Map<string, LyricsCandidate>();
  const hasReadable = () => [...perScript.values()].some((c) => c.scripts?.includes('latin'));

  for (const attempt of lrclibQueries(query)) {
    // The loose query is a last resort, never a way to pad out the scripts.
    if (attempt.loose && perScript.size > 0) break;

    const rows = await lrclibRows(attempt.url);
    const found: LyricsCandidate[] = [];

    for (const row of rows.slice(0, 12)) {
      if (row.instrumental || !row.plainLyrics || !row.trackName || !row.artistName) continue;
      const candidate = candidateFrom(query, {
        url: `https://lrclib.net/api/get/${row.id}`,
        site: 'lrclib.net',
        trackName: tidyName(row.trackName),
        artistName: tidyName(row.artistName),
        lyrics: row.plainLyrics,
        loose: attempt.loose,
      });
      if (candidate) found.push(candidate);
    }

    found.sort((a, b) => b.score - a.score || b.lyrics.length - a.lyrics.length);
    for (const candidate of found) {
      const key = candidate.script ?? 'other';
      if (!perScript.has(key)) perScript.set(key, candidate);
    }

    // One more lookup is worth it only when everything found so far is in a
    // script much of the audience cannot read; otherwise stop here.
    if (perScript.size > 0 && hasReadable()) break;
  }

  return [...perScript.values()];
}

/** lyrics.ovh: exact artist/title lookup, mostly Western catalogue. */
async function fromLyricsOvh(query: SongQuery): Promise<LyricsCandidate[]> {
  if (!query.artist) return [];

  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(query.artist)}/${encodeURIComponent(query.title)}`;

  let data: { lyrics?: string };
  try {
    data = await fetchJson<{ lyrics?: string }>(url, { retries: 1 });
  } catch (error) {
    // "Not found" is this API's normal answer for anything off the beaten path.
    if (error instanceof HttpError && error.status === 404) return [];
    throw error;
  }
  if (!data.lyrics) return [];

  // The API only answers on an exact match, so the row is the song by definition.
  const candidate = candidateFrom(query, {
    url,
    site: 'lyrics.ovh',
    trackName: query.title,
    artistName: query.artist,
    lyrics: data.lyrics,
  });
  return candidate ? [candidate] : [];
}

export interface ProviderResult {
  candidates: LyricsCandidate[];
  attempts: Array<{ url: string; ok: boolean; reason?: string }>;
}

/** Ask every open database in parallel; failures are logged, never fatal. */
export async function fetchFromLyricsApis(query: SongQuery): Promise<ProviderResult> {
  const providers: Array<{ name: string; run: () => Promise<LyricsCandidate[]> }> = [
    { name: 'lrclib.net', run: () => fromLrclib(query) },
    { name: 'api.lyrics.ovh', run: () => fromLyricsOvh(query) },
  ];

  const settled = await Promise.all(
    providers.map(async ({ name, run }) => {
      try {
        return { name, found: await run(), error: undefined as string | undefined };
      } catch (error) {
        return { name, found: [] as LyricsCandidate[], error: (error as Error).message };
      }
    }),
  );

  const candidates: LyricsCandidate[] = [];
  const attempts: ProviderResult['attempts'] = [];

  for (const { name, found, error } of settled) {
    if (found.length > 0) {
      candidates.push(...found);
      found.forEach((candidate) => attempts.push({ url: candidate.url, ok: true }));
    } else {
      attempts.push({
        url: `https://${name}`,
        ok: false,
        reason: error ? `lookup failed (${error})` : 'song not in this database',
      });
    }
  }

  return { candidates, attempts };
}
