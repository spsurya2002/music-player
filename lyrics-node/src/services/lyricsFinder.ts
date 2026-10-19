import { config } from '../config.js';
import { TtlCache } from '../utils/cache.js';
import { normalize, parseTextQuery } from '../utils/text.js';
import { isYoutubeUrl, resolveYoutube } from './youtube.js';
import { webSearch, siteWeight } from './search.js';
import { searchKnownSites } from './siteSearch.js';
import { crawlCandidates } from './crawler.js';
import { canonicalize, resolveIdentities } from './songResolver.js';
import { fetchFromLyricsApis } from './lyricsApis.js';
import { romanize } from './transliterate.js';
import type { LyricsCandidate, LyricsResult, SongQuery } from '../types.js';

const resultCache = new TtlCache<LyricsResult>(config.cacheTtlMs, config.cacheMaxEntries);

/** Split the user's input into a title and artist, without asking anyone. */
async function buildRawQuery(input: string): Promise<SongQuery> {
  const raw = input.trim();
  return isYoutubeUrl(raw)
    ? resolveYoutube(raw)
    : { raw, ...parseTextQuery(raw), source: 'text' as const };
}

/** Work out what song the user means, from free text or a YouTube link. */
export async function buildQuery(input: string): Promise<SongQuery> {
  // A video title like "Coke Studio Season 8| Tajdar-e-Haram| Atif Aslam" has
  // to become "Atif Aslam – Tajdar-E-Haram" before it is worth searching for.
  return canonicalize(await buildRawQuery(input));
}

/** Search phrasings to try, most specific first. */
function searchQueries(query: SongQuery): string[] {
  const queries: string[] = [];
  if (query.artist) {
    queries.push(`${query.artist} ${query.title} lyrics`);
    queries.push(`"${query.title}" ${query.artist} lyrics genius`);
  }
  queries.push(`${query.title} lyrics`);
  if (query.source === 'youtube' && query.youtube) {
    queries.push(`${query.youtube.videoTitle} lyrics`);
  }
  return [...new Set(queries)];
}

/** A plain web address the user wants us to read, rather than a song name. */
function isPageUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) && !isYoutubeUrl(input);
}

/** "…/moazzam-jah-shahji-shab-e-hijr-woh-dam.html" -> a rough song title. */
function titleFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    return last.replace(/\.[a-z]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * The user found the page themselves and pasted it. Read that page, and only
 * that page — there is nothing to search for and nothing to second-guess.
 */
async function readOnePage(url: string, startedAt: number): Promise<LyricsResult> {
  const query: SongQuery = { raw: url, title: titleFromUrl(url) || url, source: 'text' };
  const { candidates, attempts } = await crawlCandidates(query, [url]);

  const best = candidates[0] ?? null;
  return {
    query,
    best,
    alternatives: [],
    crawled: attempts,
    cached: false,
    elapsedMs: Date.now() - startedAt,
  };
}

/** azlyrics has a fully predictable URL shape — worth a free guess. */
function directGuesses(query: SongQuery): string[] {
  if (!query.artist) return [];
  const slug = (value: string) => normalize(value).replace(/\s+/g, '');
  const artist = slug(query.artist).replace(/^the/, '');
  const title = slug(query.title);
  if (!artist || !title) return [];
  return [`https://www.azlyrics.com/lyrics/${artist}/${title}.html`];
}

export interface FindOptions {
  /** Bypass the result cache. */
  refresh?: boolean;
}

/**
 * When every version we found is in a script the reader may not read, make a
 * Roman one ourselves. It is an approximation — Urdu writes no short vowels —
 * so it is labelled as ours, never passed off as what a source published.
 */
function withRomanVersion(candidates: LyricsCandidate[]): LyricsCandidate[] {
  const source = candidates[0];
  // Only the version we are about to show matters: a romanised copy of some
  // other recording further down the list is no help to someone staring at a
  // page they cannot read.
  if (!source || source.scripts?.includes('latin')) return candidates;
  const roman = romanize(source.lyrics, source.script ?? 'other');
  if (!roman) return candidates;

  // First: the reader asked for this because they cannot read the original.
  return [
    {
      ...source,
      lyrics: roman,
      script: 'latin',
      scripts: ['latin'],
      transliterated: true,
      // Never ahead of the words as they were actually written.
      score: Math.max(0, source.score - 0.01),
      reasons: [...source.reasons, 'romanised automatically from the original script'],
    },
    ...candidates,
  ];
}

/**
 * Other sources worth a click. A version in a different script always earns
 * its place: the words of a qawwali are no use to a reader who cannot read the
 * alphabet they are printed in, so the romanised copy stays on offer even when
 * it scores below the ones that match the performer exactly.
 */
function pickAlternatives(best: LyricsCandidate | null, rest: LyricsCandidate[]): LyricsCandidate[] {
  const scripts = new Set([best?.script ?? 'other']);
  const chosen: LyricsCandidate[] = [];

  for (const candidate of rest) {
    const newScript = candidate.script !== undefined && !scripts.has(candidate.script);
    if (candidate.score >= 0.5 || newScript) {
      chosen.push(candidate);
      if (candidate.script) scripts.add(candidate.script);
    }
  }

  return chosen.slice(0, 4);
}

export async function findLyrics(input: string, options: FindOptions = {}): Promise<LyricsResult> {
  const startedAt = Date.now();
  if (isPageUrl(input.trim())) return readOnePage(input.trim(), startedAt);

  const parsed = await buildRawQuery(input);
  const identities = await resolveIdentities(parsed);
  const query = identities[0] ?? parsed;

  const cacheKey = normalize(`${query.artist ?? ''}|${query.title}`);
  if (!options.refresh) {
    const cached = resultCache.get(cacheKey);
    if (cached) return { ...cached, cached: true, elapsedMs: Date.now() - startedAt };
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  const push = (url: string) => {
    const key = url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (!seen.has(key)) {
      seen.add(key);
      urls.push(url);
    }
  };

  directGuesses(query).forEach(push);

  const attempts: LyricsResult['crawled'] = [];
  const allCandidates: LyricsResult['alternatives'] = [];
  const bestSoFar = () => allCandidates.reduce((max, candidate) => Math.max(max, candidate.score), 0);

  // Open lyrics databases first: they are fast, they answer honestly, and they
  // do not depend on a search engine being willing to talk to us today. The
  // catalogue's top reading of the query is not always the one anybody has
  // lyrics for, so work down the list until a database recognises the song.
  for (const identity of identities.slice(0, 3)) {
    const fromApis = await fetchFromLyricsApis(identity);
    attempts.push(...fromApis.attempts);
    allCandidates.push(...fromApis.candidates);
    if (bestSoFar() >= config.goodEnoughScore) break;
  }

  // A database that recognised the song by name beats anything the crawl is
  // likely to add, and crawling costs ten seconds of blocked search engines.
  const trustDatabaseScore = 0.7;

  // Ask the lyrics sites before asking a search engine which lyrics sites
  // exist. A song no engine ever indexed is still sitting on the page it has
  // always been on, and that page is often one we already know how to read.
  // Their own search boxes are also forgiving about spelling in a way an index
  // lookup is not, which is the whole difficulty with a transliterated title.
  if (bestSoFar() < trustDatabaseScore) {
    (await searchKnownSites(query)).forEach(push);

    const pending = urls.filter((url) => !attempts.some((attempt) => attempt.url === url));
    if (pending.length > 0) {
      const { candidates, attempts: fresh } = await crawlCandidates(query, pending);
      attempts.push(...fresh);
      allCandidates.push(...candidates);
    }
  }

  const blockedEngines = new Set<string>();

  for (const searchQuery of bestSoFar() >= trustDatabaseScore ? [] : searchQueries(query)) {
    const { hits, blocked } = await webSearch(searchQuery);
    blocked.forEach((engine) => blockedEngines.add(engine));
    hits.forEach((hit) => push(hit.url));

    const pending = urls.filter((url) => !attempts.some((attempt) => attempt.url === url));
    if (pending.length === 0) continue;

    const { candidates, attempts: fresh } = await crawlCandidates(query, pending);
    attempts.push(...fresh);
    allCandidates.push(...candidates);

    // Stop as soon as we have something convincing; otherwise try the next phrasing.
    if (bestSoFar() >= config.goodEnoughScore) break;
    if (allCandidates.length >= 3 && bestSoFar() >= 0.6) break;
  }

  // Say it plainly in the crawl log, so "nothing found" is not mistaken for
  // "this song does not exist" when it means "we were not allowed to look".
  for (const engine of blockedEngines) {
    attempts.push({ url: `https://${engine}.com`, ok: false, reason: 'blocked our request — search engines rate-limit crawlers' });
  }

  // Between versions that are just as good a match, show the one written in
  // the alphabet the interface is in — the other scripts stay one click away.
  const ranking = (candidate: LyricsCandidate) =>
    candidate.score + (candidate.scripts?.includes('latin') ? 0.03 : 0);

  allCandidates.sort((a, b) => ranking(b) - ranking(a) || siteWeight(b.url) - siteWeight(a.url));

  // Anything below the floor is a page we could not tie to this song. Showing
  // it as a low-confidence "best guess" just hands the user someone else's
  // text, so those results are dropped and the caller reports nothing found.
  const byUrl = new Set<string>();
  const usable = allCandidates.filter((candidate) => {
    if (candidate.score < config.minScore || byUrl.has(candidate.url)) return false;
    byUrl.add(candidate.url);
    return true;
  });

  const withRoman = withRomanVersion(usable);
  const [best = null, ...rest] = withRoman;
  const result: LyricsResult = {
    query,
    best,
    alternatives: pickAlternatives(best, rest),
    crawled: attempts,
    cached: false,
    elapsedMs: Date.now() - startedAt,
  };

  if (best && best.score >= 0.6) resultCache.set(cacheKey, result);
  return result;
}

export function clearLyricsCache(): void {
  resultCache.clear();
}
