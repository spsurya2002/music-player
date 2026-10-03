import { fetchJson } from '../utils/http.js';
import { TtlCache } from '../utils/cache.js';
import { config } from '../config.js';
import { fuzzyCoverage, normalize } from '../utils/text.js';
import type { SongQuery } from '../types.js';

/**
 * A YouTube title is a poor search key: it mixes the show, the episode, the
 * label and the performers in an arbitrary order. The iTunes Search API is
 * free, needs no key and does not block scrapers, so we use it purely to turn
 * that soup into a real "artist + track" pair before searching for lyrics.
 */

interface ITunesTrack {
  trackName?: string;
  artistName?: string;
}

interface ITunesResponse {
  resultCount?: number;
  results?: ITunesTrack[];
}

const resolveCache = new TtlCache<Array<{ title: string; artist: string }> | null>(
  config.cacheTtlMs,
  config.cacheMaxEntries,
);

/** "Tajdar-E-Haram (Coke Studio Season 8)" -> "Tajdar-E-Haram" */
function tidyTrackName(name: string): string {
  return name
    .replace(/\s*[\[(][^\])]*[\])]\s*/g, ' ')
    .replace(/\s*-\s*(single|ep|remaster(ed)?.*|live.*|from .*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Everything we know about the song, as one string to match store hits against. */
function searchTerm(query: SongQuery): string {
  const parts = [query.artist, query.title].filter(Boolean).join(' ');
  return parts.replace(/\s+/g, ' ').trim();
}

function firstWords(value: string | undefined, count: number): string {
  return (value ?? '').split(/\s+/).filter(Boolean).slice(0, count).join(' ');
}

/**
 * iTunes matches on all of the words it is given, so a long video-derived
 * string returns nothing. Try progressively shorter keys instead of giving up.
 */
function searchTerms(query: SongQuery): string[] {
  const terms = [
    searchTerm(query),
    query.title,
    `${firstWords(query.title, 4)} ${firstWords(query.artist, 2)}`.trim(),
    firstWords(searchTerm(query), 5),
  ];
  return [...new Set(terms.map((term) => term.replace(/\s+/g, ' ').trim()).filter((term) => term.length >= 3))];
}

type Identity = { title: string; artist: string };

/**
 * Ask iTunes about one key and keep every row that matches what the user
 * actually gave us — a wrong "correction" poisons every later step, and the
 * catalogue's own first answer is not always the recording people mean.
 */
async function lookupOne(term: string, context: string, namedArtist: boolean): Promise<Identity[]> {
  const data = await fetchJson<ITunesResponse>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10`,
    { skipThrottle: true },
  );

  const found: Identity[] = [];
  const seen = new Set<string>();

  for (const track of data.results ?? []) {
    const trackName = track.trackName ? tidyTrackName(track.trackName) : '';
    const artistName = track.artistName?.trim() ?? '';
    if (!trackName || !artistName) continue;

    // The track must already be present in what the user gave us; otherwise
    // this is a different song that merely shares a word. Only the words that
    // identify a song count: "Sokoot E Shab" must not pass as a match for
    // "Shab e Hijr…" on the strength of "e" and "shab".
    if (fuzzyCoverage(trackName, context) < 0.6) continue;

    // When the user named an artist, the row has to agree with it. When they
    // only gave a title, accept the catalogue's own matches instead — as long
    // as the row explains everything they typed.
    const artistAgrees = fuzzyCoverage(artistName, context) >= 0.5;
    const rowExplainsQuery = fuzzyCoverage(context, `${trackName} ${artistName}`) >= 0.6;
    if (!artistAgrees && (namedArtist || !rowExplainsQuery)) continue;

    const key = normalize(`${artistName}|${trackName}`);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ title: trackName, artist: artistName });
    if (found.length >= 3) break;
  }

  return found;
}

async function lookupIdentities(query: SongQuery): Promise<Identity[]> {
  const context = searchTerm(query);
  if (context.length < 3) return [];

  const key = normalize(context);
  const cached = resolveCache.get(key);
  if (cached !== undefined) return cached ?? [];

  try {
    for (const term of searchTerms(query)) {
      const found = await lookupOne(term, context, Boolean(query.artist));
      if (found.length > 0) {
        resolveCache.set(key, found);
        return found;
      }
    }
    resolveCache.set(key, null);
    return [];
  } catch (error) {
    // Not cached: a network blip should not stick for six hours.
    console.warn(`[resolve] itunes lookup failed: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Replace a guessed title/artist with the store's canonical pair when we can
 * confirm it. The original wording is kept in `raw` for fallback searches.
 */
export async function canonicalize(query: SongQuery): Promise<SongQuery> {
  const [best] = await lookupIdentities(query);
  if (!best) return query;
  return { ...query, title: best.title, artist: best.artist, resolvedBy: 'itunes' };
}

/**
 * Every identity worth trying, best first, ending with the user's own wording.
 * A typed "tajadar-e-haram" matches a release nobody has lyrics for, so the
 * next-best reading of the same query has to get a turn too.
 */
export async function resolveIdentities(query: SongQuery): Promise<SongQuery[]> {
  const identities = await lookupIdentities(query);

  const queries = identities.map(
    (identity): SongQuery => ({
      ...query,
      title: identity.title,
      artist: identity.artist,
      resolvedBy: 'itunes',
    }),
  );

  // The catalogue can be wrong, or silent. Keep what the user typed as the
  // last thing we try, unless it is already one of the readings above.
  const seen = new Set(queries.map((candidate) => normalize(`${candidate.artist}|${candidate.title}`)));
  if (!seen.has(normalize(`${query.artist ?? ''}|${query.title}`))) queries.push(query);

  return queries;
}
