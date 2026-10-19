import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { fetchText } from '../utils/http.js';
import { TtlCache } from '../utils/cache.js';
import { tokens, tokenCoverage } from '../utils/text.js';
import type { SearchHit } from '../types.js';

const searchCache = new TtlCache<SearchHit[]>(config.cacheTtlMs, config.cacheMaxEntries);

/**
 * Lyrics sites we know how to read, roughly in order of how reliable their
 * markup is. Used both to rank search hits and to seed direct guesses.
 */
export const KNOWN_LYRICS_SITES: Record<string, number> = {
  'lrclib.net': 1.0,
  'lyrics.ovh': 0.9,
  'genius.com': 1.0,
  'rekhta.org': 1.0,
  'sufinama.org': 0.95,
  'azlyrics.com': 0.95,
  'lyricsmania.com': 0.85,
  'lyrics.com': 0.85,
  'songlyrics.com': 0.8,
  'lyricsfreak.com': 0.8,
  'metrolyrics.com': 0.75,
  'musixmatch.com': 0.75,
  'letras.mus.br': 0.7,
  'lyricstranslate.com': 0.6,
  'genius.it': 0.6,
  'sing365.com': 0.5,
  'lyricsmode.com': 0.6,
  'lyricsbogie.com': 0.5,
  'hindigeetmala.net': 0.5,
  'lyricsted.com': 0.5,
};

const BLOCKED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'spotify.com',
  'dailymotion.com',
  'apple.com',
  'amazon.',
  'wikipedia.org',
  'duckduckgo.com',
  'bing.com',
  'mojeek.com',
];

/** Strip a leading "www." so lookups against KNOWN_LYRICS_SITES work. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function siteWeight(url: string): number {
  const host = siteOf(url);
  for (const [site, weight] of Object.entries(KNOWN_LYRICS_SITES)) {
    if (host === site || host.endsWith(`.${site}`)) return weight;
  }
  return 0;
}

function isUsable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const host = siteOf(url).toLowerCase();
  if (!host) return false;
  return !BLOCKED_HOSTS.some((blocked) => host === blocked || host.includes(blocked));
}

/**
 * Search engines hide the real destination behind a click-tracking link:
 * DuckDuckGo uses /l/?uddg=<urlencoded>, Bing uses /ck/a?...&u=a1<base64url>.
 */
function unwrapRedirect(href: string, base = 'https://duckduckgo.com'): string {
  try {
    const url = new URL(href, base);

    const ddgTarget = url.searchParams.get('uddg');
    if (ddgTarget) return decodeURIComponent(ddgTarget);

    const bingTarget = url.searchParams.get('u');
    if (bingTarget?.startsWith('a1')) {
      const decoded = Buffer.from(bingTarget.slice(2), 'base64url').toString('utf8');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
    if (bingTarget && /^https?:\/\//i.test(bingTarget)) return decodeURIComponent(bingTarget);

    return url.href;
  } catch {
    return href;
  }
}

/**
 * Words that say nothing about which song we mean, so they must not count
 * towards a hit looking relevant.
 */
const GENERIC_QUERY_WORDS = new Set([
  'lyrics',
  'lyric',
  'song',
  'songs',
  'genius',
  'official',
  'video',
  'audio',
  'full',
  'feat',
  'ft',
  'the',
  'a',
  'an',
  'of',
  'and',
]);

function contentTokens(query: string): string[] {
  return tokens(query).filter((token) => !GENERIC_QUERY_WORDS.has(token) && token.length > 1);
}

/**
 * How much of the song we asked about shows up in a hit's title and URL.
 * Engines that decide we are a bot answer with real-looking results for a
 * completely different query, and this is what catches them.
 */
function hitRelevance(queryTokens: string[], hit: SearchHit): number {
  if (queryTokens.length === 0) return 1;
  const haystack = `${hit.title} ${hit.snippet ?? ''} ${decodeURIComponent(hit.url).replace(/[/_+-]+/g, ' ')}`;
  return tokenCoverage(queryTokens.join(' '), haystack);
}

/** Thrown when an engine answers with a challenge instead of results. */
class BlockedError extends Error {}

/** Search pages served instead of results when an engine blocks the scraper. */
function assertNotBlocked(engine: string, html: string, pageTitle: string): void {
  if (/captcha|are you a robot|verify (you|your browser)|unusual traffic|access denied/i.test(pageTitle)) {
    throw new BlockedError(`${engine} served a challenge page ("${pageTitle.trim()}")`);
  }
  if (/anomaly[-_]modal|If this error persists, please let us know/i.test(html)) {
    throw new BlockedError(`${engine} rejected the request as automated traffic`);
  }
}

/**
 * An engine that has just turned us away will keep doing so, and asking again
 * only digs the hole deeper. Leave it alone for a while.
 */
const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS = 15 * 60 * 1000;

/** Search engines take this badly if you rush them, so space requests out. */
const SEARCH_HOST_DELAY_MS = 3000;

type Engine = { name: string; run: (query: string) => Promise<SearchHit[]> };

const duckduckgo: Engine = {
  name: 'duckduckgo',
  run: async (query) => {
    const html = await fetchText('https://html.duckduckgo.com/html/', {
      form: { q: query, kl: 'us-en' },
      headers: { referer: 'https://duckduckgo.com/' },
      minDelayMs: SEARCH_HOST_DELAY_MS,
    });
    const $ = cheerio.load(html);
    assertNotBlocked('duckduckgo', html, $('title').first().text());
    const hits: SearchHit[] = [];
    $('.result__body, .web-result').each((_, element) => {
      const anchor = $(element).find('a.result__a').first();
      const href = anchor.attr('href');
      if (!href) return;
      hits.push({
        url: unwrapRedirect(href),
        title: anchor.text().trim(),
        snippet: $(element).find('.result__snippet').first().text().trim() || undefined,
        engine: 'duckduckgo',
      });
    });
    return hits;
  },
};

const mojeek: Engine = {
  name: 'mojeek',
  run: async (query) => {
    const html = await fetchText(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`, {
      minDelayMs: SEARCH_HOST_DELAY_MS,
    });
    const $ = cheerio.load(html);
    assertNotBlocked('mojeek', html, $('title').first().text());
    const hits: SearchHit[] = [];
    $('ul.results-standard li, .results li').each((_, element) => {
      const anchor = $(element).find('a.title, h2 a').first();
      const href = anchor.attr('href');
      if (!href) return;
      hits.push({
        url: href,
        title: anchor.text().trim(),
        snippet: $(element).find('p.s').first().text().trim() || undefined,
        engine: 'mojeek',
      });
    });
    return hits;
  },
};

const bing: Engine = {
  name: 'bing',
  run: async (query) => {
    const html = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, {
      minDelayMs: SEARCH_HOST_DELAY_MS,
    });
    const $ = cheerio.load(html);
    assertNotBlocked('bing', html, $('title').first().text());
    const hits: SearchHit[] = [];
    $('li.b_algo').each((_, element) => {
      const anchor = $(element).find('h2 a').first();
      const href = anchor.attr('href');
      if (!href) return;
      const url = unwrapRedirect(href, 'https://www.bing.com');
      // Fall back to the visible cite text when the redirect won't decode.
      const cite = $(element).find('cite').first().text().replace(/\s*›\s*/g, '/').replace(/\s+/g, '');
      hits.push({
        url: url.includes('bing.com/ck/') && /^https?:\/\//i.test(cite) ? cite : url,
        title: anchor.text().trim(),
        snippet: $(element).find('.b_caption p').first().text().trim() || undefined,
        engine: 'bing',
      });
    });
    return hits;
  },
};

/** Bing is first because it answers reliably without an API key. */
const ENGINES: Engine[] = [bing, duckduckgo, mojeek];

export interface SearchOutcome {
  hits: SearchHit[];
  /** Engines that turned us away, so the caller can say so out loud. */
  blocked: string[];
}

/**
 * Run the query against each engine until one gives us usable results, then
 * de-duplicate and sort so known lyrics sites come first.
 */
export async function webSearch(query: string): Promise<SearchOutcome> {
  const cached = searchCache.get(query);
  if (cached) return { hits: cached, blocked: [] };

  const queryTokens = contentTokens(query);
  const collected: SearchHit[] = [];
  const blocked: string[] = [];

  for (const engine of ENGINES) {
    const coolingOff = cooldownUntil.get(engine.name) ?? 0;
    if (coolingOff > Date.now()) {
      blocked.push(engine.name);
      continue;
    }

    try {
      const raw = (await engine.run(query)).filter((hit) => isUsable(hit.url));

      // Keep only hits that are demonstrably about this song. A known lyrics
      // site gets a lower bar; everything else has to earn its place.
      const hits = raw.filter((hit) => {
        const relevance = hitRelevance(queryTokens, hit);
        return relevance >= (siteWeight(hit.url) > 0 ? 0.2 : 0.34);
      });

      if (raw.length >= 3 && hits.length === 0) {
        console.warn(`[search] ${engine.name} returned ${raw.length} results unrelated to "${query}" — ignoring`);
        continue;
      }

      collected.push(...hits);
      // One engine that actually answered is enough; asking the next one is
      // how a working engine gets talked into blocking us too.
      if (collected.length > 0) break;
    } catch (error) {
      console.warn(`[search] ${engine.name} failed: ${(error as Error).message}`);
      if (error instanceof BlockedError) {
        cooldownUntil.set(engine.name, Date.now() + COOLDOWN_MS);
        blocked.push(engine.name);
      }
    }
  }

  const seen = new Set<string>();
  const unique = collected.filter((hit) => {
    const key = hit.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => siteWeight(b.url) - siteWeight(a.url));
  if (unique.length > 0) searchCache.set(query, unique);
  return { hits: unique, blocked };
}
