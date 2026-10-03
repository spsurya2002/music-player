import type { Script } from '../../utils/text.js';

/** One line of the song, with the explanation attached. */
export interface MeaningLine {
  /** Index into the unique-line list, which is what the model is given. */
  n: number;
  /** The line as the source wrote it. */
  text: string;
  /** The same line in Roman letters, for a reader who cannot read the script. */
  roman?: string;
  /** Plain Hinglish restatement: "iska matlab ye hai…". */
  matlab: string;
  /** The deeper reading, present only where the line carries one. */
  note?: string;
  /** Line numbers in the full song where this line recurs. */
  repeatsAt?: number[];
}

/** A word the dictionary knew, as background for the model and the reader. */
export interface GlossaryEntry {
  /** The word as it appears in the lyrics. */
  word: string;
  /** Rekhta's own transliteration, e.g. "mai-KHaana". */
  roman?: string;
  hindi?: string;
  urdu?: string;
  /** Arabic, Persian, Sanskrit… — this is what marks the Sufi register. */
  origin?: string;
  partOfSpeech?: string;
  /** Dictionary senses. Literal: the poem may use the word quite differently. */
  senses: string[];
  /** Canonical Rekhta page, so a reader can check us. */
  url?: string;
}

export interface MeaningResult {
  summary: string;
  /** qawwali, ghazal, kafi, nazm… as the model identifies it. */
  tradition?: string;
  poet?: string;
  themes: string[];
  lines: MeaningLine[];
  terms: GlossaryEntry[];
  model: string;
  cached: boolean;
  elapsedMs: number;
}

export interface MeaningRequest {
  title?: string;
  artist?: string;
  /** Lyrics in the script the source published, never our romanisation. */
  lyrics: string;
  script?: Script;
}
