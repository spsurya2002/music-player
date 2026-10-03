import express from 'express';
import { config } from './config.js';
import { lyricsRouter } from './routes/lyrics.js';
import { meaningRouter } from './routes/meaning.js';

const app = express();

app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use('/api', lyricsRouter);
app.use('/api', meaningRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Loopback only, and that is the whole security model of this process: it has no
// auth, no user concept and no database, because nothing off this machine can
// reach it. Reelody's FastAPI app on :8000 is the only caller — it owns the
// session cookie, the ownership check and the quota, and the Cloudflare tunnel
// in front of it never forwards this port. Binding 0.0.0.0 here (express's
// default when the host is omitted) would publish an unauthenticated crawler to
// the whole LAN, and letting a browser reach it would make every ownership and
// quota check bypassable by typing a URL. There is deliberately no CORS
// middleware for the same reason.
app.listen(config.port, '127.0.0.1', () => {
  console.log(`[lyrics-node] listening on http://127.0.0.1:${config.port}`);
});
