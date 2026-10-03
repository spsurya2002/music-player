import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { romanize } from '../transliterate.js';
import { buildGlossary } from './glossary.js';
import { explainWithGemini } from './gemini.js';
import { candidateWords, prepare, type PreparedLine } from './prepare.js';
import type { MeaningLine, MeaningResult, MeaningRequest } from './types.js';

export type { MeaningResult, MeaningRequest } from './types.js';

/**
 * Explaining a song, in four steps: strip the repeats, ask the dictionary what
 * the rare words mean, ask the model to read them in context, and remember the
 * answer forever. A song is explained once, ever — the second person to ask
 * pays nothing and waits nothing.
 */

/** Bump when the prompt or output shape changes, so old answers are not reused. */
const PROMPT_VERSION = 3;

const cacheDir = () => path.resolve(process.cwd(), config.cacheDir, 'meanings');

function cacheKey(request: MeaningRequest): string {
  const material = [PROMPT_VERSION, config.meaningModel, request.lyrics.trim()].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

async function readCache(key: string): Promise<MeaningResult | null> {
  try {
    return JSON.parse(await readFile(path.join(cacheDir(), `${key}.json`), 'utf8')) as MeaningResult;
  } catch {
    return null;
  }
}

async function writeCache(key: string, result: MeaningResult): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(result), 'utf8');
  } catch (error) {
    console.warn(`[meaning] could not cache: ${(error as Error).message}`);
  }
}

/**
 * Very long qawwalis go to the model in stanza-sized pieces rather than being
 * truncated — losing the last third of a song is not an acceptable saving.
 */
function chunk(lines: PreparedLine[], size: number): PreparedLine[][] {
  if (lines.length <= size) return [lines];
  const chunks: PreparedLine[][] = [];
  for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
  return chunks;
}

export async function explainSong(request: MeaningRequest): Promise<MeaningResult> {
  const startedAt = Date.now();

  const key = cacheKey(request);
  const cached = await readCache(key);
  if (cached) return { ...cached, cached: true, elapsedMs: Date.now() - startedAt };

  const prepared = prepare(request.lyrics);
  if (prepared.lines.length === 0) throw new Error('Nothing to explain — the lyrics were empty.');

  // The dictionary first: the model does better when it is told what the words
  // mean than when it is left to remember.
  const glossary = await buildGlossary(candidateWords(prepared.lines));
  console.log(
    `[meaning] ${prepared.totalLines} lines -> ${prepared.lines.length} unique; ` +
      `glossary ${glossary.entries.length} terms (${glossary.lookedUp} looked up, ${glossary.fromCache} cached)`,
  );

  const pieces = chunk(prepared.lines, config.meaningMaxLines);
  const explained = await Promise.all(
    pieces.map((lines) =>
      explainWithGemini({ title: request.title, artist: request.artist, lines, glossary: glossary.entries }),
    ),
  );

  const first = explained[0]!;
  const byLine = new Map<number, { matlab: string; note?: string }>();
  for (const piece of explained) {
    for (const line of piece.lines) byLine.set(line.n, { matlab: line.matlab, note: line.note });
  }

  const script = prepared.script;
  const lines: MeaningLine[] = prepared.lines.map((line) => {
    const said = byLine.get(line.n);
    const roman = script === 'latin' ? undefined : romanize(line.text, script) ?? undefined;
    return {
      n: line.n,
      text: line.text,
      roman,
      matlab: said?.matlab ?? '',
      note: said?.note?.trim() || undefined,
      repeatsAt: line.at.length > 1 ? line.at : undefined,
    };
  });

  // Prefer the dictionary's own wording for a term, and let the model's gloss
  // fill in for anything the dictionary did not have.
  const terms = [...glossary.entries];
  for (const term of first.terms ?? []) {
    if (!terms.some((entry) => entry.word === term.word || entry.roman === term.word)) {
      terms.push({ word: term.word, senses: [term.matlab] });
    }
  }
  // Dictionary-backed words first; a long tail of model glosses helps nobody.
  terms.sort((a, b) => Number(Boolean(b.url)) - Number(Boolean(a.url)));
  terms.splice(24);

  const result: MeaningResult = {
    summary: first.summary,
    tradition: first.tradition?.trim() || undefined,
    poet: first.poet?.trim() || undefined,
    themes: first.themes ?? [],
    lines,
    terms,
    model: config.meaningModel,
    cached: false,
    elapsedMs: Date.now() - startedAt,
  };

  await writeCache(key, result);
  return result;
}
