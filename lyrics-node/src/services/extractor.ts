import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { tidyLyrics } from '../utils/text.js';

/** Elements that never contain lyrics but often contain lots of text. */
const JUNK_SELECTOR =
  'script, style, noscript, iframe, svg, form, nav, header, footer, aside, ' +
  'button, .ad, .ads, .advertisement, [id*="ad-"], [class*="adsbygoogle"], ' +
  '.comment, .comments, .share, .social, .related, .recommend, .breadcrumb';

/**
 * Convert an element's HTML to text while keeping line structure: lyrics live
 * in <br>-separated markup, which `.text()` alone would flatten into one blob.
 */
function htmlToText($: CheerioAPI, node: AnyNode): string {
  const fragment = cheerio.load($.html(node), null, false);
  fragment(JUNK_SELECTOR).remove();

  const html = fragment
    .html()
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|blockquote)>/gi, '\n\n');

  return tidyLyrics(cheerio.load(html, null, false).text());
}

function textOf($: CheerioAPI, selector: string): string | null {
  const parts: string[] = [];
  $(selector).each((_, element) => {
    const text = htmlToText($, element);
    if (text) parts.push(text);
  });
  const joined = tidyLyrics(parts.join('\n\n'));
  return joined.length >= 60 ? joined : null;
}

/**
 * Rekhta (and its Sufi sibling Sufinama) are the standing reference for Urdu
 * ghazal and qawwali, and they are the sites a search engine is least likely
 * to hand us. They render nothing server-side: the poem ships as escaped HTML
 * in a hidden input, one <span> per word, so that tapping a word can show its
 * meaning. `.text()` on the page therefore returns the furniture and not a
 * single line of the poem.
 *
 * Inside that payload each `div.w` is one couplet, `div.c` holds it as written
 * and `div.t` the English translation — which is someone's reading of the poem
 * and not the words of it, so it is left behind.
 */
function fromRekhta($: CheerioAPI): string | null {
  const payload = $('#HtmlRawText').attr('data-html');
  if (!payload) return null;

  const $$ = cheerio.load(payload, null, false);
  const couplets: string[] = [];

  $$('div.w').each((_, couplet) => {
    const lines: string[] = [];
    $$(couplet)
      .find('div.c p')
      .each((_, line) => {
        const text = $$(line).text().replace(/\s+/g, ' ').trim();
        if (text) lines.push(text);
      });
    if (lines.length > 0) couplets.push(lines.join('\n'));
  });

  const text = couplets.join('\n\n');
  return text.length >= 60 ? text : null;
}

/** Per-site selectors, tried before the generic heuristic. */
const SITE_RULES: Array<{ match: RegExp; selectors?: string[]; read?: ($: CheerioAPI) => string | null }> = [
  { match: /rekhta\.org$|sufinama\.org$/, read: fromRekhta },
  { match: /genius\.(com|it)$/, selectors: ['div[data-lyrics-container="true"]', '.lyrics', '.Lyrics__Container'] },
  {
    match: /azlyrics\.com$/,
    selectors: ['div.col-xs-12.col-lg-8.text-center > div:not([class]):not([id])', '.ringtone ~ div'],
  },
  { match: /lyricsmania\.com$/, selectors: ['.lyrics-body', '.col-left-lyrics'] },
  { match: /lyrics\.com$/, selectors: ['#lyric-body-text', 'pre.lyric-body'] },
  { match: /elyrics\.net$/, selectors: ['#inlyr', '.lyricst'] },
  { match: /lyricsondemand\.com$/, selectors: ['.lyrics', '#lyrics'] },
  { match: /songlyrics\.com$/, selectors: ['#songLyricsDiv'] },
  { match: /lyricsfreak\.com$/, selectors: ['#content', '[data-lyrics]', '.lyrictxt'] },
  { match: /metrolyrics\.com$/, selectors: ['#lyrics-body-text', '.verse'] },
  { match: /musixmatch\.com$/, selectors: ['[data-testid="lyrics"]', '.mxm-lyrics__content', '.lyrics__content__ok'] },
  { match: /letras\.mus\.br$/, selectors: ['.lyric-original', 'div.cnt-letra'] },
  { match: /lyricsmode\.com$/, selectors: ['#lyrics_text'] },
  { match: /lyricstranslate\.com$/, selectors: ['#song-body', '.ll-text'] },
  { match: /lyricsbogie\.com|lyricsted\.com|hindigeetmala\.net$/, selectors: ['.entry-content', '.lyrics'] },
];

/** schema.org markup: many sites publish the lyrics as JSON-LD. */
function fromJsonLd($: CheerioAPI): string | null {
  const found: string[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    const lyrics = record.lyrics;
    if (typeof lyrics === 'string') found.push(lyrics);
    else if (lyrics && typeof lyrics === 'object') {
      const text = (lyrics as Record<string, unknown>).text;
      if (typeof text === 'string') found.push(text);
    }
    for (const value of Object.values(record)) if (value && typeof value === 'object') walk(value);
  };

  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      walk(JSON.parse($(element).text()));
    } catch {
      /* malformed JSON-LD is common; just skip it */
    }
  });

  const best = found.map(tidyLyrics).sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 60 ? best : null;
}

/** Wording that belongs to a website's furniture, never to a song. */
const NAV_PHRASE =
  /(sign\s?(in|up)|log\s?in|how it works|pricing|our (plans|team)|free trial|terms of (service|use)|privacy policy|cookie|all rights reserved|copyright ©|©\s?\d{4}|subscribe|newsletter|download the app|contact us|about us|follow us|get started|upload|transcript|summary|read more|home\s*$)/i;

/**
 * How much does this block of text look like song lyrics?
 * Lyrics are many short lines, few sentence-ending periods, little HTML chrome.
 */
export function lyricsLikeness(text: string): number {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 4 || text.length < 100) return 0;

  const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  const shortLines = lines.filter((line) => line.length <= 60).length / lines.length;
  const periods = (text.match(/\.\s/g) ?? []).length / lines.length;
  const bracketed = /\[(verse|chorus|intro|outro|bridge|hook|refrain|pre-chorus)/i.test(text) ? 0.15 : 0;

  // Menus and buttons read like lyrics on paper: many short lines, no full
  // stops. What gives them away is their wording, and the run-together words
  // ("How it WorksPro Tools") left behind when inline links are flattened.
  const navLines = lines.filter((line) => NAV_PHRASE.test(line)).length / lines.length;
  const glued = lines.filter((line) => /[a-z][A-Z]/.test(line)).length / lines.length;

  // Link lists ("100 Best Qawwali Tracks Ever", "Sufi Singers & Songs") are
  // short lines with no full stops too — but they are written in Title Case,
  // which lyrics almost never are beyond the first word.
  const titleCase = lines.filter((line) => {
    const words = line.split(/\s+/).filter((word) => /^[A-Za-z]/.test(word));
    if (words.length < 3) return false;
    return words.filter((word) => /^[A-Z]/.test(word)).length / words.length >= 0.6;
  }).length / lines.length;

  const chrome =
    (navLines > 0.1 ? -0.35 : navLines > 0 ? -0.15 : 0) +
    (glued > 0.2 ? -0.35 : 0) +
    (titleCase > 0.5 ? -0.4 : titleCase > 0.3 ? -0.15 : 0);

  let score = 0;
  if (avgLineLength >= 8 && avgLineLength <= 55) score += 0.4;
  else if (avgLineLength <= 80) score += 0.15;
  score += shortLines * 0.3;
  if (periods < 0.25) score += 0.15;
  if (lines.length >= 12) score += 0.1;
  score += bracketed + chrome;

  return Math.max(0, Math.min(1, score));
}

/** Last resort: walk the DOM looking for the block that reads most like lyrics. */
function genericExtract($: CheerioAPI): string | null {
  $(JUNK_SELECTOR).remove();

  let best: { text: string; score: number } | null = null;

  $('div, p, pre, section, article, td').each((_, element) => {
    const node = $(element);
    // Skip containers that are mostly other containers — we want the leaf block.
    const brCount = node.find('br').length;
    const childBlocks = node.children('div, section, article').length;
    if (brCount < 4 && childBlocks > 2) return;

    // A sidebar of links ("100 Best Qawwali Tracks Ever", "Sufi Topics") reads
    // exactly like lyrics once the markup is flattened: short lines, no full
    // stops. What separates them is that every line is a link.
    const totalLength = node.text().replace(/\s+/g, ' ').trim().length;
    const linkedLength = node.find('a').text().replace(/\s+/g, ' ').trim().length;
    if (totalLength > 0 && linkedLength / totalLength > 0.4) return;

    const text = htmlToText($, element);
    if (text.length < 200 || text.length > 20000) return;

    const score = lyricsLikeness(text) + Math.min(brCount / 40, 0.2);
    if (!best || score > best.score) best = { text, score };
  });

  const winner = best as { text: string; score: number } | null;
  return winner && winner.score >= 0.5 ? winner.text : null;
}

/**
 * Block-for-block, verse spacing matters: if *every* line is separated by a
 * blank line, those blanks came from the markup (one <div>/<p> per line), not
 * from the song. Collapse them so verses read the way they do on the page.
 */
function collapseArtifactBlankLines(text: string): string {
  const lines = text.split('\n');
  let adjacentPairs = 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() && lines[i - 1]?.trim()) adjacentPairs += 1;
  }
  const nonEmpty = lines.filter((line) => line.trim()).length;
  const blankRuns = (text.match(/\n\s*\n/g) ?? []).length;
  // A handful of adjacent lines (e.g. a "[Chorus]" header) shouldn't stop us.
  if (blankRuns >= 4 && nonEmpty > 0 && adjacentPairs / nonEmpty < 0.15) {
    return text.replace(/\n\s*\n/g, '\n');
  }
  return text;
}

/** Lines that are page furniture rather than part of the song. */
const CHROME_LINE =
  /^(lyrics|share|print|copy|edit|submit corrections?|add to favou?rites|report|advertisement|\+|•|writer\(s\)[:.]?|written by[:.]?|thanks? to .* for (adding|correcting) the(se)? lyrics.*|.*lyrics powered by.*|.*embed$|\d+ contributors?.*)$/i;

function stripChrome(text: string): string {
  return text
    .split('\n')
    .filter((line) => !CHROME_LINE.test(line.trim()))
    .join('\n');
}

/**
 * Some pages print the lyrics twice (a preview block plus the full text).
 * If the opening lines reappear later, keep only the first copy.
 */
function dropDuplicateCopy(text: string): string {
  const head = text.slice(0, 160).trim();
  if (head.length < 60) return text;
  const second = text.indexOf(head, 160);
  return second > 0 ? text.slice(0, second).trim() : text;
}

/**
 * Drop leading header lines like "Bohemian Rhapsody Lyrics | Queen | Greatest
 * Hits". Real lyrics almost never open with a line containing "lyrics".
 */
function stripTitleHeader(text: string): string {
  const lines = text.split('\n');
  const window = Math.min(6, lines.length);

  // The last "…lyrics…" line inside the opening window is the real boundary:
  // headers often run "Song Lyrics" / "Artist" / "Album" / "Lyrics to Song".
  let cut = -1;
  for (let i = 0; i < window; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (line && line.length < 120 && /\blyrics?\b/i.test(line)) cut = i;
  }

  return cut >= 0 ? lines.slice(cut + 1).join('\n') : text;
}

/** Where a blog post stops being the poem and starts being the blog. */
const POST_FOOTER =
  /^(posted by|email this|share to |labels?:|newer post|older post|no comments|\d+ comments?|subscribe to:|reactions:|tags:)/i;

function stripPostFooter(text: string): string {
  const lines = text.split('\n');
  const cut = lines.findIndex((line) => POST_FOOTER.test(line.trim()));
  // Only trust it once the song is already behind us.
  return cut > 4 ? lines.slice(0, cut).join('\n') : text;
}

const DATE_LINE = /^(mon|tues|wednes|thurs|fri|satur|sun)day,?\s+\w+\s+\d{1,2},?\s+\d{4}$/i;

/**
 * Blogs introduce a poem before printing it — a date, a heading, a paragraph
 * about the poet. Those openers are prose and the song never is, so cut up to
 * the last prose line near the top.
 */
function stripLeadingProse(text: string): string {
  const lines = text.split('\n');
  const window = Math.min(10, Math.floor(lines.length / 2));

  let cut = -1;
  for (let i = 0; i < window; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (line.length > 120 || DATE_LINE.test(line)) cut = i;
  }
  if (cut < 0) return text;

  const rest = lines.slice(cut + 1);
  // Never cut so much that there is no song left.
  return rest.filter((line) => line.trim()).length >= 8 ? rest.join('\n') : text;
}

/** Everything we do to extracted text before it leaves the extractor. */
function postProcess(text: string): string {
  const trimmed = stripLeadingProse(stripPostFooter(stripChrome(stripTitleHeader(text))));
  return tidyLyrics(collapseArtifactBlankLines(dropDuplicateCopy(trimmed)));
}

/** Interstitial pages some sites serve instead of content. */
const CHALLENGE_TITLE = /(request for access|access denied|just a moment|attention required|are you a human|captcha|verify you are|403 forbidden|rate limit)/i;

export function isChallengePage(pageTitle: string, html: string): boolean {
  if (CHALLENGE_TITLE.test(pageTitle)) return true;
  return html.length < 15000 && /(cf-browser-verification|g-recaptcha|hcaptcha|cf_chl_)/i.test(html);
}

export interface ExtractedPage {
  lyrics: string | null;
  pageTitle: string;
  detectedTitle?: string;
  detectedArtist?: string;
  /** Which strategy produced the text. */
  strategy: 'site-rule' | 'json-ld' | 'generic' | 'none';
  /** True when the site served an anti-bot interstitial instead of the song. */
  blocked?: boolean;
}

/** Pull the song/artist the page itself claims to be about. */
function readMetadata($: CheerioAPI): { detectedTitle?: string; detectedArtist?: string } {
  const meta = (selector: string): string | undefined =>
    $(selector).attr('content')?.trim() || undefined;

  const ogTitle = meta('meta[property="og:title"]') ?? $('title').first().text().trim();
  const musician = meta('meta[property="music:musician"]') ?? meta('meta[name="author"]');

  // "Artist – Song Lyrics | Genius Lyrics" style titles.
  const cleaned = ogTitle
    ?.replace(/\s*[|-]\s*(genius|azlyrics|lyrics\.com|songlyrics|musixmatch)[^|]*$/i, '')
    .replace(/\blyrics\b/gi, '')
    .trim();

  const parts = cleaned?.split(/\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean) ?? [];
  if (parts.length >= 2) {
    return { detectedArtist: musician ?? parts[0], detectedTitle: parts.slice(1).join(' - ') };
  }
  return { detectedArtist: musician, detectedTitle: cleaned || undefined };
}

/** Extract lyrics from a downloaded HTML page. */
export function extractLyrics(html: string, url: string): ExtractedPage {
  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().trim();
  const metadata = readMetadata($);

  if (isChallengePage(pageTitle, html)) {
    return { lyrics: null, pageTitle, ...metadata, strategy: 'none', blocked: true };
  }

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  for (const rule of SITE_RULES) {
    if (!rule.match.test(host)) continue;
    const read = rule.read?.($);
    if (read) return { lyrics: postProcess(read), pageTitle, ...metadata, strategy: 'site-rule' };
    for (const selector of rule.selectors ?? []) {
      const text = textOf($, selector);
      if (text) return { lyrics: postProcess(text), pageTitle, ...metadata, strategy: 'site-rule' };
    }
  }

  const jsonLd = fromJsonLd($);
  if (jsonLd) return { lyrics: postProcess(jsonLd), pageTitle, ...metadata, strategy: 'json-ld' };

  const generic = genericExtract($);
  if (generic) return { lyrics: postProcess(generic), pageTitle, ...metadata, strategy: 'generic' };

  return { lyrics: null, pageTitle, ...metadata, strategy: 'none' };
}
