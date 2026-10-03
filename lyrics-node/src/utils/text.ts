/** Text helpers used by the query parser, extractors and scorer. */

/** Lowercase, strip accents and punctuation — for fuzzy comparisons only. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(input: string): string[] {
  return normalize(input).split(' ').filter(Boolean);
}

/** Fraction of `needle`'s tokens that appear in `haystack`. */
export function tokenCoverage(needle: string, haystack: string): number {
  const wanted = new Set(tokens(needle));
  if (wanted.size === 0) return 0;
  const have = new Set(tokens(haystack));
  let hits = 0;
  for (const token of wanted) if (have.has(token)) hits += 1;
  return hits / wanted.size;
}

/** Writing systems we can tell apart well enough to offer the user a choice. */
export type Script = 'latin' | 'devanagari' | 'arabic' | 'other';

const SCRIPT_RANGES: Array<{ script: Script; pattern: RegExp }> = [
  { script: 'latin', pattern: /[A-Za-z]/g },
  { script: 'devanagari', pattern: /[ऀ-ॿ]/g },
  // Urdu, Arabic and Persian share this block.
  { script: 'arabic', pattern: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g },
];

/**
 * Every script this text is actually written in, most used first. Lyrics pages
 * for Indian and Pakistani songs often print a line and its romanisation
 * together, and a reader who wants one of the two should be told both are here.
 */
export function detectScripts(text: string): Script[] {
  const sample = text.slice(0, 4000);
  const counts = SCRIPT_RANGES.map(({ script, pattern }) => ({
    script,
    count: (sample.match(pattern) ?? []).length,
  })).sort((a, b) => b.count - a.count);

  const top = counts[0];
  // A handful of stray Latin characters (song titles, "x2") prove nothing.
  if (!top || top.count < 20) return ['other'];

  return counts.filter(({ count }) => count >= Math.max(20, top.count * 0.25)).map(({ script }) => script);
}

/** Which script is this text mostly written in? */
export function detectScript(text: string): Script {
  return detectScripts(text)[0] ?? 'other';
}

/** Words too common to narrow a search down. */
const WEAK_TOKENS = new Set([
  'the', 'and', 'lyrics', 'song', 'feat', 'ft', 'live', 'version', 'official',
  'full', 'video', 'audio', 'remix', 'mix', 'part', 'from', 'with', 'for',
]);

/**
 * The few words most likely to appear in *any* transliteration of a title.
 * Longest first: "kahoon" pins a song down, "ka" does not.
 */
export function distinctiveTokens(input: string, limit = 3): string[] {
  return [...new Set(tokens(input))]
    .filter((token) => token.length >= 4 && !WEAK_TOKENS.has(token))
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
}

/** Levenshtein distance, capped: we only ever care about "one letter out". */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (++edits > 1) return false;
    if (short.length === long.length) i += 1;
    j += 1;
  }
  return edits + (long.length - j) + (short.length - i) <= 1;
}

/**
 * Like `tokenCoverage`, but only the words that identify the song count, and a
 * word spelled one letter differently still counts. Transliterations are never
 * spelled the same way twice — "tajdar" and "tajadar" are the same word — while
 * filler like "e", "the" or "ka" matches everything and must not be evidence.
 */
export function fuzzyCoverage(needle: string, haystack: string): number {
  const wanted = tokens(needle).filter((token) => token.length >= 3 && !WEAK_TOKENS.has(token));
  if (wanted.length === 0) return tokenCoverage(needle, haystack);

  const have = tokens(haystack);
  let hits = 0;

  for (const token of wanted) {
    const matched = have.some(
      (candidate) =>
        candidate === token ||
        (token.length >= 4 && candidate.length >= 4 && withinOneEdit(token, candidate)) ||
        (token.length >= 5 && candidate.length >= 5 && (candidate.startsWith(token) || token.startsWith(candidate))),
    );
    if (matched) hits += 1;
  }

  return hits / wanted.length;
}

const INDIC_OR_ARABIC = '\\u0900-\\u097F\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF';

/**
 * Some sources print a line in its own script and its romanisation side by
 * side; flattened markup glues them into "…लिख दkismat mein meri…". A change
 * of script with no space between is always that seam, never a word.
 */
function splitScriptSeams(text: string): string {
  return text
    .replace(new RegExp(`([${INDIC_OR_ARABIC}])([A-Za-z])`, 'g'), '$1\n$2')
    .replace(new RegExp(`([A-Za-z])([${INDIC_OR_ARABIC}])`, 'g'), '$1\n$2');
}

/** Collapse the whitespace soup that HTML extraction leaves behind. */
export function tidyLyrics(raw: string): string {
  return splitScriptSeams(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const NOISE_PATTERNS: RegExp[] = [
  /\bofficial\s*(music\s*)?(video|audio|lyric[s]?\s*video|visualizer)\b/gi,
  /\blyric[s]?\s*video\b/gi,
  /\b(hd|4k|hq|full\s*song|full\s*video|audio|video song|music video)\b/gi,
  /\bwith\s+lyrics\b/gi,
  /\b(re-?master(ed)?(\s*\d{4})?|remaster\s*\d{4})\b/gi,
  /\b(live|acoustic|radio\s*edit|extended\s*mix|explicit|clean)\s*(version)?\b/gi,
  /\b\d{4}\s*(version|remaster)\b/gi,
  /\bout\s+now\b/gi,
];

/**
 * Segments that describe the show a performance came from, not the song.
 * "Coke Studio Season 8| Tajdar-e-Haram| Atif Aslam" must not be read as
 * artist "Coke Studio Season 8" — that turns the web search into nonsense.
 */
const SHOW_SEGMENT =
  /^(.*\b(season|episode|ep\.?|series|vol\.?|volume)\s*\d+.*|coke studio.*|mtv unplugged.*|unplugged.*|.*\bjukebox\b.*|.*\bfull album\b.*|s\d+\s*e\d+)$/i;

/** Channels named after a show rather than a performer. */
const SHOW_CHANNEL = /coke studio|mtv|vevo|records|music|tv|channel|official|studios?|entertainment|network/i;

function stripChannelSuffix(channel: string): string {
  return channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
}

/** Words that make the tail of an "X by Y" title a phrase, not a performer. */
const NOT_A_NAME = /\b(your|my|our|their|his|her|the|a|an|me|you|us|them|it|this|that|all|no)\b/i;

/**
 * "Shab e Hijr Voh Dam ba Dam Yaad Aaye by Ustad Farid Ayaz" credits its
 * performer in the title. Songs called "Stand by Me" or "Stand by Your Man" do
 * not, so the tail has to read like somebody's name before we believe it.
 */
function splitByCredit(title: string): { title: string; artist?: string } {
  const match = title.match(/^(.*\S)\s+by\s+(\S.*)$/i);
  const performer = match?.[2]?.trim();
  if (!match?.[1] || !performer) return { title };

  const words = performer.split(/\s+/);
  const looksLikeName = words.length >= 2 && !NOT_A_NAME.test(performer) && words.every((word) => /^[A-Z'"“]/.test(word));

  return looksLikeName ? { title: match[1].trim(), artist: performer } : { title };
}

/**
 * Turn a YouTube-style video title into something searchable.
 * "Artist - Song (Official Video) [HD]" -> { artist: "Artist", title: "Song" }
 */
export function parseVideoTitle(videoTitle: string, channel?: string): { title: string; artist?: string } {
  let text = videoTitle;

  // Drop bracketed junk, but keep brackets that carry a "feat." credit.
  text = text.replace(/[\[(]([^\])]*)[\])]/g, (match, inner: string) =>
    /feat\.?|ft\.?|with\s/i.test(inner) ? ` ${inner} ` : ' ',
  );

  for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, ' ');

  // Pipes separate credits in no reliable order ("Show| Song| Artist"), so they
  // get their own pass: drop the show/season parts and keep what is left.
  const piped = text
    .split(/\s*[|｜]\s*/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (piped.length >= 2) {
    const kept = piped.filter((part) => !SHOW_SEGMENT.test(part));
    const segments = kept.length > 0 ? kept : piped;
    const cleanChannel = channel ? stripChannelSuffix(channel) : '';

    // When one segment names the channel, that segment is the performer.
    const artistIndex = cleanChannel
      ? segments.findIndex((part) => tokenCoverage(part, cleanChannel) >= 0.5)
      : -1;

    if (artistIndex >= 0) {
      const rest = segments.filter((_, index) => index !== artistIndex);
      const joined = rest.join(' ').trim() || segments[artistIndex]!;
      // A title that credits its performer ("… by Ustad Farid Ayaz") knows
      // better than the channel name does.
      const credited = splitByCredit(joined);
      return { title: credited.title, artist: credited.artist ?? segments[artistIndex]!.trim() };
    }

    // Otherwise keep every credit in the title: the resolver and the page
    // scorer both cope with an extra name far better than with a wrong one.
    const joined = segments.join(' ').trim() || videoTitle;
    return splitByCredit(joined);
  }

  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[-–—•\s]+|[-–—•\s]+$/g, '').trim();

  // Split on the first dash-like separator surrounded by spaces.
  const parts = text.split(/\s+[-–—:]\s+/).map((part) => part.trim()).filter(Boolean);

  let artist: string | undefined;
  let title = text;

  if (parts.length >= 2) {
    artist = parts[0];
    title = parts.slice(1).join(' - ');
  } else if (splitByCredit(text).artist) {
    const credited = splitByCredit(text);
    title = credited.title;
    artist = credited.artist;
  } else if (channel) {
    // Many artist channels are literally named after the artist — but a label
    // or show channel ("Coke Studio Pakistan", "T-Series") is not a performer.
    const cleanChannel = stripChannelSuffix(channel);
    if (cleanChannel && !SHOW_CHANNEL.test(cleanChannel) && normalize(cleanChannel) !== normalize(text)) {
      artist = cleanChannel;
    }
  }

  title = title.replace(/\s*[-–—,]\s*$/, '').trim();
  return { title: title || videoTitle, artist: artist?.trim() || undefined };
}

/**
 * Split a plain text query like "adele - hello" or "hello by adele".
 * Falls back to treating the whole string as the title.
 */
export function parseTextQuery(raw: string): { title: string; artist?: string } {
  const text = raw.replace(/\blyrics\b/gi, ' ').replace(/\s+/g, ' ').trim();

  // "hello by adele" names a performer; "Stand by Me" and "Stand by Your Man"
  // are just songs, so the tail has to be a plausible name.
  const byMatch = text.match(/^(.*?)\s+by\s+(.+)$/i);
  const performer = byMatch?.[2]?.trim();
  if (byMatch?.[1] && performer && !NOT_A_NAME.test(performer)) {
    return { title: byMatch[1].trim(), artist: performer };
  }

  const dashParts = text.split(/\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length >= 2 && dashParts[0] && dashParts[1]) {
    return { artist: dashParts[0], title: dashParts.slice(1).join(' - ') };
  }

  return { title: text || raw };
}
