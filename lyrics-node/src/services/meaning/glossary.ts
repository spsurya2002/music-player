import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { fetchJson } from '../../utils/http.js';
import type { GlossaryEntry } from './types.js';

/**
 * Rekhta's dictionary, which is the accurate half of this feature: it knows
 * what a word means, where it came from, and how it is spelled in all three
 * scripts. The model is never asked to invent vocabulary — it is asked to read
 * these senses in the poem's context, which is a different and easier job.
 *
 * Note that the senses are literal. The dictionary will tell you "vasl" means
 * intercourse; in a qawwali it is union with the divine. That gap is exactly
 * what the model is for, and why these are passed as evidence, not as answers.
 */

const ENDPOINT = 'https://app-rekhta-dictionary.rekhta.org/rd-api/v1/GetGroupWordMeaning?lang=1';

/** The registers worth glossing. Sanskrit-origin words are everyday Hindustani. */
const SUFI_ORIGINS = /arabic|persian|turkish|farsi/i;

interface RekhtaMeaning {
  Meaning?: string;
}

interface RekhtaWord {
  E?: string;
  H?: string;
  U?: string;
  WO?: string;
  WP?: string;
  WM?: RekhtaMeaning[];
  DWU?: string;
}

interface RekhtaResponse {
  S?: number;
  R?: RekhtaWord[];
}

/** word -> entry, or null for "asked, and the dictionary did not know". */
type CacheShape = { userId: string; words: Record<string, GlossaryEntry | null> };

let cache: CacheShape | null = null;
let saveTimer: NodeJS.Timeout | null = null;

const cachePath = () => path.resolve(process.cwd(), config.cacheDir, 'rekhta-dictionary.json');

async function load(): Promise<CacheShape> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(cachePath(), 'utf8')) as CacheShape;
    cache = { userId: parsed.userId || randomUUID(), words: parsed.words ?? {} };
  } catch {
    // Our own client id, generated once and kept, rather than a new identity
    // on every call — politer to a service that is doing us a favour.
    cache = { userId: randomUUID(), words: {} };
  }
  return cache;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!cache) return;
    try {
      await mkdir(path.dirname(cachePath()), { recursive: true });
      await writeFile(cachePath(), JSON.stringify(cache), 'utf8');
    } catch (error) {
      console.warn(`[glossary] could not save cache: ${(error as Error).message}`);
    }
  }, 1500);
  saveTimer.unref?.();
}

function toEntry(word: string, row: RekhtaWord): GlossaryEntry | null {
  const senses = (row.WM ?? [])
    .map((meaning) => meaning.Meaning?.trim())
    .filter((meaning): meaning is string => Boolean(meaning))
    .slice(0, 3);
  if (senses.length === 0) return null;

  return {
    word,
    roman: row.E?.trim() || undefined,
    hindi: row.H?.trim() || undefined,
    urdu: row.U?.trim() || undefined,
    origin: row.WO?.trim() || undefined,
    partOfSpeech: row.WP?.trim() || undefined,
    senses,
    url: row.DWU?.trim() || undefined,
  };
}

async function lookup(word: string): Promise<GlossaryEntry | null> {
  const store = await load();

  const ask = () =>
    fetchJson<RekhtaResponse>(ENDPOINT, {
      form: { Word: word, UserId: store.userId, websiteId: '1', SelectedWord: word },
      // One small service answering everyone: go gently, and never ask twice.
      minDelayMs: 300,
      retries: 1,
      timeoutMs: 12000,
    });

  // A dropped connection is not an answer — give it one more go before
  // deciding the dictionary does not know this word.
  let data: RekhtaResponse;
  try {
    data = await ask();
  } catch {
    data = await ask();
  }

  const row = (data.R ?? [])[0];
  const entry = row ? toEntry(word, row) : null;

  store.words[word] = entry;
  scheduleSave();
  return entry;
}

export interface GlossaryResult {
  entries: GlossaryEntry[];
  /** Words we asked the dictionary about in this request, for the log. */
  lookedUp: number;
  fromCache: number;
}

/**
 * Look words up, cheapest first: anything seen before costs nothing and does
 * not count against the per-request budget, so the cache keeps paying off.
 */
export async function buildGlossary(words: string[], budget = config.meaningMaxLookups): Promise<GlossaryResult> {
  const store = await load();
  const entries: GlossaryEntry[] = [];
  let lookedUp = 0;
  let fromCache = 0;

  const pending: string[] = [];
  for (const word of words) {
    const known = store.words[word];
    if (known === undefined) {
      pending.push(word);
      continue;
    }
    fromCache += 1;
    if (known) entries.push(known);
  }

  // The dictionary is optional context, so one failure is skipped rather than
  // fatal — but a run of them means it is down, and we stop bothering it.
  let consecutiveFailures = 0;
  for (const word of pending.slice(0, budget)) {
    try {
      const entry = await lookup(word);
      lookedUp += 1;
      consecutiveFailures = 0;
      if (entry) entries.push(entry);
    } catch (error) {
      console.warn(`[glossary] ${word}: ${(error as Error).message}`);
      if (++consecutiveFailures >= 3) {
        console.warn('[glossary] dictionary unreachable — carrying on without it');
        break;
      }
    }
  }

  // Keep the Sufi register. "andheraa" is Sanskrit and needs no explaining;
  // "fanaa" is Arabic and is the whole point of the poem. A word the dictionary
  // has no origin for is almost always everyday Hindustani, so it goes too.
  const worthwhile = entries.filter((entry) => entry.origin && SUFI_ORIGINS.test(entry.origin));

  return { entries: worthwhile, lookedUp, fromCache };
}
