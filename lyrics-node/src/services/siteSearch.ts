import * as cheerio from 'cheerio';
import { fetchText } from '../utils/http.js';
import { fuzzyCoverage, tokens } from '../utils/text.js';
import type { SongQuery } from '../types.js';

/**
 * Ask the lyrics sites themselves rather than asking a search engine which
 * lyrics sites exist.
 *
 * A general engine indexes what is popular, and a qawwali sung in 1979 is not.
 * The page can be sitting on a site we already trust, perfectly readable, and
 * still be invisible to us because no engine ever crawled it — asking the site
 * directly removes the engine, its index and its patience from the problem.
 *
 * These searches are forgiving in a way our own matching is not: handed three
 * words they absorb the spelling drift that makes "Sahar Qareeb" and "Saher
 * Karib" look like different songs. So we send a few words, take whatever
 * comes back, and decide for ourselves which of it is the song.
 */

/** How many words to hand a site's search box. */
const QUERY_WORD_COUNTS = [3, 4];

/** Enough of a match that the slug is plausibly this song. */
const SLUG_MATCH_FLOOR = 0.8;

/**
 * Words in a slug that are worth weighing. A slug of one short word matches
 * half the catalogue, so it is never evidence on its own.
 */
const MIN_SLUG_WORDS = 2;

/** Candidate URLs one site offered, best first. */
type SiteSearch = (query: SongQuery) => Promise<string[]>;

/** "/song/saher_karib_hai.htm" -> "saher karib hai", to compare with a title. */
function wordsInUrl(url: string): string {
  const last = url.split('/').pop() ?? '';
  return last.replace(/\.[a-z]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim();
}

/**
 * The phrasings worth sending. Too many words and a literal search matches
 * nothing; too few and the song is buried under every other song sharing a
 * common word.
 */
function phrasings(title: string): string[] {
  const words = tokens(title);
  if (words.length === 0) return [];

  const queries = QUERY_WORD_COUNTS.filter((count) => count < words.length).map((count) =>
    words.slice(0, count).join(' '),
  );
  // A title shorter than the shortest slice is already its own best query.
  queries.push(words.join(' '));

  return [...new Set(queries)];
}

/**
 * Keep the links that look like the song we asked for. The site ranked them by
 * its own lights, which is why a hit is judged on its slug and not its place.
 *
 * A slug is usually the title cut short — "saher_karib_hai" for a song called
 * "Sahar Qareeb Hai Taaron Ka Haal Kiya Hoga" — so the question that decides it
 * is whether the slug is *contained in* the title, not whether it covers all of
 * it. Asking it the other way round rejects exactly the hits we came for.
 *
 * It has to be nearly all of the slug, though. Hindi and Urdu songs share their
 * common words around freely: "apna mujhe tu laga" has two words in common with
 * "Mujhe Ek Dafa Apna Keh Ke Pukaro" and is a different song entirely. A slug
 * earns its crawl by having almost nothing in it that the title does not.
 *
 * This assumes a slug that is the song's title and little else, which is what
 * the sites below publish. A site that slugs in the album and the performer
 * would need its own measure rather than a looser floor here.
 */
function slugMatch(title: string, url: string): number {
  const slug = wordsInUrl(url);
  if (tokens(slug).filter((word) => word.length >= 3).length < MIN_SLUG_WORDS) return 0;
  return fuzzyCoverage(slug, title);
}

function rankBySlug(title: string, urls: string[]): string[] {
  return urls
    .map((url) => ({ url, match: slugMatch(title, url) }))
    .filter(({ match }) => match >= SLUG_MATCH_FLOOR)
    .sort((a, b) => b.match - a.match)
    .map(({ url }) => url);
}

/**
 * hindigeetmala indexes Hindi film and non-film song lyrics going back decades,
 * including the ghazals and qawwalis that no lyrics database carries.
 */
const hindigeetmala: SiteSearch = async (query) => {
  const found: string[] = [];

  for (const phrase of phrasings(query.title)) {
    const html = await fetchText(
      `https://www.hindigeetmala.net/search.php?value=${encodeURIComponent(phrase)}`,
    );
    const $ = cheerio.load(html);
    $('a[href^="/song/"]').each((_, anchor) => {
      const href = $(anchor).attr('href');
      if (href) found.push(new URL(href, 'https://www.hindigeetmala.net').href);
    });
  }

  return rankBySlug(query.title, [...new Set(found)]);
};

const SITE_SEARCHES: Array<{ name: string; run: SiteSearch }> = [
  { name: 'hindigeetmala', run: hindigeetmala },
];

/**
 * Every URL the lyrics sites themselves offered for this song, best first.
 *
 * One site declining to answer is ordinary — it must not cost us the others,
 * and it must never cost us the web search that follows.
 */
export async function searchKnownSites(query: SongQuery): Promise<string[]> {
  if (!query.title.trim()) return [];

  const results = await Promise.all(
    SITE_SEARCHES.map(async ({ name, run }) => {
      try {
        return await run(query);
      } catch (error) {
        console.warn(`[sitesearch] ${name} failed: ${(error as Error).message}`);
        return [];
      }
    }),
  );

  return [...new Set(results.flat())];
}
