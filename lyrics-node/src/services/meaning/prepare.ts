import { detectScript, type Script } from '../../utils/text.js';

/**
 * Getting the song ready for the model, which is where most of the saving is.
 * Qawwalis repeat themselves relentlessly — Tajdar-e-Haram is 110 lines and 61
 * distinct ones — so each line is explained once and the repeats point at it.
 */

export interface PreparedLine {
  n: number;
  text: string;
  /** 1-based positions in the full song where this line appears. */
  at: number[];
}

export interface Prepared {
  lines: PreparedLine[];
  /** Every line of the song in order, as an index into `lines`. */
  order: number[];
  script: Script;
  totalLines: number;
}

/** Trailing "x2", bullets and stray spacing make two identical lines differ. */
function fingerprint(line: string): string {
  return line
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function prepare(lyrics: string): Prepared {
  const raw = lyrics.split('\n').map((line) => line.trim());
  const lines: PreparedLine[] = [];
  const byPrint = new Map<string, PreparedLine>();
  const order: number[] = [];

  let position = 0;
  for (const text of raw) {
    if (!text) continue;
    position += 1;

    const print = fingerprint(text);
    if (!print) continue;

    const seen = byPrint.get(print);
    if (seen) {
      seen.at.push(position);
      order.push(seen.n);
      continue;
    }

    const line: PreparedLine = { n: lines.length + 1, text, at: [position] };
    lines.push(line);
    byPrint.set(print, line);
    order.push(line.n);
  }

  return { lines, order, script: detectScript(lyrics), totalLines: position };
}

/* ------------------------------------------------------------------ *
 * Which words are worth looking up
 * ------------------------------------------------------------------ */

/**
 * Everyday Hindustani that no reader needs glossed. The dictionary's own
 * "origin" field does the real filtering afterwards — this list only keeps us
 * from spending lookups on words we already know the answer for.
 */
const EVERYDAY = new Set([
  'ہے', 'ہیں', 'ہو', 'ہوں', 'تھا', 'تھی', 'تھے', 'نے', 'یہ', 'وہ', 'میں', 'مجھے', 'تم', 'تو',
  'ہم', 'کو', 'کے', 'کا', 'کی', 'سے', 'پر', 'پہ', 'اور', 'نہیں', 'نہ', 'جو', 'جب', 'کیا',
  'کچھ', 'سب', 'اب', 'پھر', 'بھی', 'ہی', 'تک', 'ایک', 'اک', 'کوئی', 'کسی', 'میرا', 'میری',
  'میرے', 'تیرا', 'تیری', 'تیرے', 'اپنے', 'اپنی', 'کر', 'گیا', 'گئی', 'رہا', 'رہی', 'دیا',
  'لیا', 'جا', 'آ', 'لے', 'دے', 'کہ', 'تھ',
  'है', 'हैं', 'हो', 'था', 'थी', 'थे', 'ने', 'ये', 'यह', 'वो', 'वह', 'में', 'मुझे', 'तुम', 'तू',
  'हम', 'को', 'के', 'का', 'की', 'से', 'पर', 'और', 'नहीं', 'ना', 'जो', 'जब', 'क्या', 'कुछ',
  'सब', 'अब', 'फिर', 'भी', 'ही', 'तक', 'एक', 'कोई', 'किसी', 'मेरा', 'मेरी', 'मेरे', 'तेरा',
  'तेरी', 'तेरे', 'अपने', 'अपनी', 'कर', 'गया', 'गई', 'रहा', 'रही', 'दिया', 'लिया', 'जा', 'आ',
  'ले', 'दे', 'कि',
]);

/**
 * Words to ask the dictionary about, rarest-looking first. Length is a crude
 * but honest proxy: "tajdar" and "mai-khana" are long, "ka" and "hai" are not.
 */
export function candidateWords(lines: PreparedLine[]): string[] {
  const counts = new Map<string, number>();

  for (const line of lines) {
    for (const word of line.text.split(/[^\p{L}\p{M}]+/u)) {
      const clean = word.replace(/[ً-ْٰ]/g, '').trim();
      // Latin words are either English or our own romanisation; the dictionary
      // keys off its own transliteration scheme, so looking those up misses.
      if (clean.length < 3 || /[A-Za-z]/.test(clean) || EVERYDAY.has(clean)) continue;
      counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }

  return [...counts.keys()].sort((a, b) => b.length - a.length);
}
