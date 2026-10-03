import { Router } from 'express';
import { config } from '../config.js';
import { explainSong } from '../services/meaning/index.js';

export const meaningRouter = Router();

// Upstream capped this at 30/hour because a browser could call it directly.
// Reelody is the only caller now and charges a `lyrics` use per song before the
// work starts (backend/services/quota.py), so a second limit here would only
// show up as our own worker being refused mid-queue.

const MAX_LYRICS_CHARS = 12000;

/** POST /api/meaning  { title?, artist?, lyrics, script? } */
meaningRouter.post('/meaning', async (req, res) => {
  const body = req.body as { title?: unknown; artist?: unknown; lyrics?: unknown };
  const lyrics = typeof body.lyrics === 'string' ? body.lyrics.trim() : '';

  if (!lyrics) return res.status(400).json({ error: 'Missing "lyrics".' });
  if (lyrics.length > MAX_LYRICS_CHARS) {
    return res.status(413).json({ error: 'Those lyrics are too long to explain in one go.' });
  }
  if (!config.geminiApiKey) {
    return res.status(503).json({
      error: 'Meaning lookup is not configured: add GEMINI_API_KEY to lyrics-node/.env and restart.',
    });
  }

  try {
    const result = await explainSong({
      lyrics,
      title: typeof body.title === 'string' ? body.title : undefined,
      artist: typeof body.artist === 'string' ? body.artist : undefined,
    });
    return res.json(result);
  } catch (error) {
    const message = (error as Error).message || 'Could not explain that song.';
    console.error('[meaning] failed:', message);
    return res.status(502).json({ error: message });
  }
});
