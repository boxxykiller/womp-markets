import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the repo root (shared with the frontend build and compose),
// not inside server/.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Imported after dotenv so every module below reads a populated process.env
// at import time — several of them capture config into module constants.
const { authMiddleware } = await import('./middleware/auth.js');
const { errorHandler } = await import('./middleware/errorHandler.js');
const { asyncHandler } = await import('./lib/asyncHandler.js');
const authRouter = (await import('./routes/auth/index.js')).default;
const functionsRouter = (await import('./routes/functions.js')).default;
const sdeRouter = (await import('./routes/sde/index.js')).default;
const { ensureConfiguredSource, startMarketPoller } = await import('./lib/marketPoller.js');
const { startReferencePricePoller } = await import('./lib/referencePricePoller.js');
const { startSdeScheduler } = await import('./lib/sdeScheduler.js');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(asyncHandler(authMiddleware));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/functions', functionsRouter);
app.use('/api/sde', sdeRouter);

// Serve the built Vite frontend so the whole app is one process on one port.
const distDir = path.resolve(__dirname, '../../dist');
app.use(express.static(distDir));
app.get('*', (req, res, next) => {
  // Anything under /api that got this far is a genuine 404, not a client
  // route — falling through to index.html would hand the caller HTML with a
  // 200 and hide the mistake.
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use(errorHandler);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`womp-markets listening on :${PORT}`);
});

// Background work starts after listen() so a database hiccup here can't stop
// the HTTP server from coming up — a broken poller should still leave the UI
// reachable to say so.
ensureConfiguredSource()
  .then(() => {
    startMarketPoller();
    startReferencePricePoller();
    startSdeScheduler();
  })
  .catch((err) => console.error('[startup] background services failed to start:', err.message));
