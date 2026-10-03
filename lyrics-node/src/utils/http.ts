import { config } from '../config.js';
import { TtlCache } from './cache.js';

/** Last time we hit each host, so we can space requests out. */
const lastHitAt = new Map<string, number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function throttleHost(host: string, delayMs = config.perHostDelayMs): Promise<void> {
  const previous = lastHitAt.get(host) ?? 0;
  const wait = previous + delayMs - Date.now();
  // Reserve the slot before awaiting so parallel callers queue behind each other.
  lastHitAt.set(host, Math.max(Date.now(), previous + delayMs));
  if (wait > 0) await sleep(wait);
}

/** Query parameters that carry credentials and must never reach a log. */
const SECRET_PARAMS = /^(key|api_?key|access_?token|token|password|secret|auth)$/i;

/** A URL safe to print: the address stays, the credentials do not. */
export function safeUrl(url: URL | string): string {
  try {
    const target = new URL(url);
    for (const name of [...target.searchParams.keys()]) {
      if (SECRET_PARAMS.test(name)) target.searchParams.set(name, 'REDACTED');
    }
    return target.href;
  } catch {
    return String(url);
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Skip the per-host delay (used for API-style endpoints we call once). */
  skipThrottle?: boolean;
  method?: 'GET' | 'POST';
  /** Form-encoded body, for the search endpoints that insist on POST. */
  form?: Record<string, string>;
  /** JSON body, for the APIs that speak it. */
  json?: unknown;
  /** Retries for "come back later" replies (429/503). */
  retries?: number;
  /** Minimum gap since the last request to this host, overriding the default. */
  minDelayMs?: number;
}

/** Statuses that mean "you are going too fast", not "this does not exist". */
const RETRYABLE = new Set([429, 503]);

function retryDelayMs(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 5000);
  return 600 * attempt;
}

/** Fetch a URL and return the body as text, with a timeout and a size cap. */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new HttpError(`Unsupported protocol: ${target.protocol}`);
  }
  if (!options.skipThrottle) await throttleHost(target.host, options.minDelayMs);

  const response = await fetch(target, {
    method: options.method ?? (options.form || options.json !== undefined ? 'POST' : 'GET'),
    body: options.json !== undefined
      ? JSON.stringify(options.json)
      : options.form
        ? new URLSearchParams(options.form).toString()
        : undefined,
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? config.fetchTimeoutMs),
    headers: {
      'user-agent': config.userAgent,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      ...(options.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(options.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    // Open APIs answer a burst of lookups with 503; waiting a moment is the
    // difference between "no lyrics found" and the song we were asked for.
    const attemptsLeft = options.retries ?? 0;
    if (RETRYABLE.has(response.status) && attemptsLeft > 0) {
      await sleep(retryDelayMs(response, (options.retries ?? 1) - attemptsLeft + 1));
      return fetchText(url, { ...options, retries: attemptsLeft - 1 });
    }
    throw new HttpError(`HTTP ${response.status} for ${safeUrl(target)}`, response.status);
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > config.maxHtmlBytes) {
    throw new HttpError(`Body too large (${declaredLength} bytes) for ${safeUrl(target)}`);
  }

  if (!response.body) return '';

  const decoder = new TextDecoder('utf-8');
  const reader = response.body.getReader();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > config.maxHtmlBytes) {
        await reader.cancel();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const body = await fetchText(url, { ...options, headers: { accept: 'application/json', ...options.headers } });
  return JSON.parse(body) as T;
}

/* ------------------------------------------------------------------ *
 * robots.txt
 * A deliberately small parser: it honours Disallow rules for our agent
 * (falling back to "*"), which is enough to stay polite on lyrics sites.
 * ------------------------------------------------------------------ */

const robotsCache = new TtlCache<string[]>(60 * 60 * 1000, 200);

function parseDisallows(robotsTxt: string): string[] {
  const disallows: string[] = [];
  let groupApplies = false;

  for (const rawLine of robotsTxt.split('\n')) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      groupApplies = value === '*' || config.userAgent.toLowerCase().includes(value.toLowerCase());
    } else if (field === 'disallow' && groupApplies && value) {
      disallows.push(value);
    }
  }
  return disallows;
}

/** True when robots.txt does not forbid this path (fail-open on errors). */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }

  let rules = robotsCache.get(target.origin);
  if (!rules) {
    try {
      const body = await fetchText(`${target.origin}/robots.txt`, { timeoutMs: 4000, skipThrottle: true });
      rules = parseDisallows(body);
    } catch {
      rules = []; // No robots.txt, or unreachable — treat as unrestricted.
    }
    robotsCache.set(target.origin, rules);
  }

  const path = target.pathname + target.search;
  return !rules.some((rule) => path.startsWith(rule));
}
