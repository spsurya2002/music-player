import { Router } from 'express';
import { findLyrics, buildQuery } from '../services/lyricsFinder.js';

export const lyricsRouter = Router();

// No rate limiter here any more. Upstream this guarded against one browser
// hammering the pipeline, but the only caller now is Reelody's lyrics worker,
// which runs one job at a time, and a 429 at this layer would just stall that
// worker. The real limit is per-user and lives in backend/services/quota.py.

/** GET /api/lyrics?q=<song name | youtube url>&refresh=1 */
lyricsRouter.get('/lyrics', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: 'Missing "q" — pass a song name or a YouTube URL.' });
  if (q.length > 300) return res.status(400).json({ error: 'Query is too long.' });

  try {
    const result = await findLyrics(q, { refresh: req.query.refresh === '1' });
    if (!result.best) {
      return res.status(404).json({
        error: 'No lyrics found for that song.',
        query: result.query,
        crawled: result.crawled,
      });
    }
    return res.json(result);
  } catch (error) {
    const message = (error as Error).message || 'Lookup failed.';
    console.error('[lyrics] lookup failed:', message);
    return res.status(502).json({ error: message });
  }
});

/** GET /api/resolve?q=... — just the parsed song/artist, for the UI preview. */
lyricsRouter.get('/resolve', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: 'Missing "q".' });

  try {
    return res.json(await buildQuery(q));
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});
