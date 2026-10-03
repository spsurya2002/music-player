import { config } from '../config.js';
import { fetchText, isAllowedByRobots } from '../utils/http.js';
import { extractLyrics, lyricsLikeness } from './extractor.js';
import { siteOf, siteWeight } from './search.js';
import { detectScripts, tokenCoverage } from '../utils/text.js';
import type { LyricsCandidate, SongQuery } from '../types.js';

export interface CrawlAttempt {
  url: string;
  ok: boolean;
  reason?: string;
}

/**
 * Confidence that this page holds the lyrics the user asked for, blending:
 * how trustworthy the site is, whether the page is about the right song, and
 * whether the extracted text actually reads like lyrics.
 */
function scoreCandidate(
  query: SongQuery,
  url: string,
  lyrics: string,
  pageTitle: string,
  detectedArtist?: string,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const site = siteWeight(url);
  if (site > 0) reasons.push(`known lyrics site (${siteOf(url)})`);

  // The URL slug and page title both tell us which song the page is about.
  const haystack = `${pageTitle} ${decodeURIComponent(url).replace(/[/_-]+/g, ' ')}`;
  const titleMatch = tokenCoverage(query.title, haystack);
  const artistMatch = query.artist
    ? Math.max(tokenCoverage(query.artist, haystack), detectedArtist ? tokenCoverage(query.artist, detectedArtist) : 0)
    : 0;

  if (titleMatch >= 0.8) reasons.push('title matches the page');
  else if (titleMatch >= 0.5) reasons.push('title partially matches');
  if (query.artist && artistMatch >= 0.6) reasons.push('artist matches the page');

  const likeness = lyricsLikeness(lyrics);
  if (likeness >= 0.7) reasons.push('text reads like lyrics');

  const lines = lyrics.split('\n').filter((line) => line.trim()).length;
  const lengthOk = lyrics.length >= 250 && lyrics.length <= 12000 && lines >= 8;
  if (!lengthOk) reasons.push('unusual length for a song');

  // A ghazal or qawwali page credits the poet, not the singer we searched for,
  // so a page that names the song exactly and reads like a song is not held to
  // have failed the artist test — it simply never took it.
  const artistUnknowable = titleMatch >= 0.9 && likeness >= 0.7 && artistMatch === 0;
  const artistTerm = query.artist ? (artistUnknowable ? 0.5 : artistMatch) : 0.5;

  let score =
    0.22 * site +
    0.30 * titleMatch +
    0.18 * artistTerm +
    0.25 * likeness +
    (lengthOk ? 0.05 : -0.15);

  // Nothing on the page says it is this song. Text that merely *reads* like
  // lyrics is not evidence — a jobs board or a product page can clear that bar
  // — so refuse to let those ingredients carry a page on their own.
  if (titleMatch < 0.34 && artistMatch < 0.5) {
    reasons.push('page is not about this song');
    score *= 0.35;
  }

  // The mirror image: a download or transcript page for the right song, where
  // the only text we could pull out is the site's own menu.
  if (likeness < 0.4) {
    reasons.push('extracted text does not read like lyrics');
    score *= 0.55;
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

async function crawlOne(query: SongQuery, url: string): Promise<{ candidate?: LyricsCandidate; attempt: CrawlAttempt }> {
  try {
    if (!(await isAllowedByRobots(url))) {
      return { attempt: { url, ok: false, reason: 'blocked by robots.txt' } };
    }

    const html = await fetchText(url);
    const extracted = extractLyrics(html, url);
    if (!extracted.lyrics) {
      const reason = extracted.blocked
        ? 'site served an anti-bot page instead of the lyrics'
        : 'no lyrics found on page';
      return { attempt: { url, ok: false, reason } };
    }

    const { score, reasons } = scoreCandidate(
      query,
      url,
      extracted.lyrics,
      extracted.pageTitle,
      extracted.detectedArtist,
    );
    const scripts = detectScripts(extracted.lyrics);

    return {
      attempt: { url, ok: true },
      candidate: {
        url,
        site: siteOf(url),
        pageTitle: extracted.pageTitle,
        lyrics: extracted.lyrics,
        detectedTitle: extracted.detectedTitle,
        detectedArtist: extracted.detectedArtist,
        script: scripts[0],
        scripts,
        score,
        reasons: [...reasons, `extracted via ${extracted.strategy}`],
      },
    };
  } catch (error) {
    return { attempt: { url, ok: false, reason: (error as Error).message } };
  }
}

/**
 * Fetch candidate pages with a bounded worker pool, stopping early once a
 * result is clearly good enough to show.
 */
export async function crawlCandidates(
  query: SongQuery,
  urls: string[],
): Promise<{ candidates: LyricsCandidate[]; attempts: CrawlAttempt[] }> {
  const queue = urls.slice(0, config.maxPagesPerSearch);
  const candidates: LyricsCandidate[] = [];
  const attempts: CrawlAttempt[] = [];
  let cursor = 0;
  let satisfied = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (satisfied) return;
      const index = cursor++;
      const url = queue[index];
      if (url === undefined) return;

      const { candidate, attempt } = await crawlOne(query, url);
      attempts.push(attempt);
      if (candidate) {
        candidates.push(candidate);
        if (candidate.score >= config.goodEnoughScore) satisfied = true;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(config.crawlConcurrency, queue.length) }, () => worker()),
  );

  candidates.sort((a, b) => b.score - a.score);
  return { candidates, attempts };
}
