/** Shapes shared between the crawler pipeline and the HTTP layer. */

export interface SongQuery {
  /** Raw text the user typed. */
  raw: string;
  /** Best guess at the song title. */
  title: string;
  /** Best guess at the performing artist, when we could work one out. */
  artist?: string;
  /** Where the title/artist came from. */
  source: 'text' | 'youtube';
  /** Set when a music catalogue confirmed the title/artist spelling. */
  resolvedBy?: 'itunes';
  /** Present when the input was a YouTube link. */
  youtube?: {
    videoId: string;
    videoTitle: string;
    channel?: string;
    thumbnail?: string;
  };
}

export interface SearchHit {
  url: string;
  title: string;
  snippet?: string;
  /** Search engine that produced the hit. */
  engine: string;
}

export interface LyricsCandidate {
  url: string;
  /** Registrable-ish hostname, e.g. "genius.com". */
  site: string;
  /** Page <title>, cleaned up. */
  pageTitle: string;
  lyrics: string;
  /** Artist/title as claimed by the page, when the extractor found them. */
  detectedTitle?: string;
  detectedArtist?: string;
  /** Writing system of the lyrics, so the UI can offer a choice of script. */
  script?: 'latin' | 'devanagari' | 'arabic' | 'other';
  /** Every script present, when a version prints a line and its romanisation. */
  scripts?: Array<'latin' | 'devanagari' | 'arabic' | 'other'>;
  /** True when we romanised this ourselves rather than finding it written. */
  transliterated?: boolean;
  /** 0..1 confidence that this is the right song's full lyrics. */
  score: number;
  /** Human-readable reasons that made up the score, for debugging. */
  reasons: string[];
}

export interface LyricsResult {
  query: SongQuery;
  best: LyricsCandidate | null;
  alternatives: LyricsCandidate[];
  /** Pages we looked at, in the order we tried them. */
  crawled: Array<{ url: string; ok: boolean; reason?: string }>;
  cached: boolean;
  elapsedMs: number;
}
