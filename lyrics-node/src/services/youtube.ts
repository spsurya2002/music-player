import { fetchJson } from '../utils/http.js';
import { parseVideoTitle } from '../utils/text.js';
import type { SongQuery } from '../types.js';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Pull the 11-character video id out of any common YouTube URL shape. */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();

  // A bare video id typed straight into the search box.
  if (/^[\w-]{11}$/.test(trimmed) && /[-_]/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }

  const fromQuery = url.searchParams.get('v');
  if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;

  // /embed/<id>, /shorts/<id>, /live/<id>
  const match = url.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
  return match?.[1] ?? null;
}

export function isYoutubeUrl(input: string): boolean {
  return extractVideoId(input) !== null;
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/**
 * Resolve a YouTube link to a searchable song query using the public oEmbed
 * endpoint — no API key, no scraping of the watch page.
 */
export async function resolveYoutube(input: string): Promise<SongQuery> {
  const videoId = extractVideoId(input);
  if (!videoId) throw new Error('Not a YouTube URL');

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;

  let data: OEmbedResponse;
  try {
    data = await fetchJson<OEmbedResponse>(oembedUrl, { skipThrottle: true });
  } catch {
    throw new Error('Could not read that YouTube video (it may be private, removed or region-locked).');
  }

  const videoTitle = data.title?.trim() ?? '';
  if (!videoTitle) throw new Error('YouTube returned no title for that video.');

  const channel = data.author_name?.trim();
  const { title, artist } = parseVideoTitle(videoTitle, channel);

  return {
    raw: input,
    title,
    artist,
    source: 'youtube',
    youtube: {
      videoId,
      videoTitle,
      channel,
      thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    },
  };
}
