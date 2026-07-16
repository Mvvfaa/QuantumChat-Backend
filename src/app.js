import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import attachmentRoutes from './routes/attachmentRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import storyRoutes from './routes/storyRoutes.js';
import { authLimiter } from './middleware/rateLimiter.js';

export function createApp() {
  const app = express();

  // Vercel (and most PaaS hosts) sit behind a reverse proxy and set
  // X-Forwarded-For. Without trust proxy enabled, express-rate-limit
  // refuses to trust that header and throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
  // on every request, which was breaking /api/auth/* entirely.
  app.set('trust proxy', 1);

  // The API is deliberately consumed cross-origin (frontend dev server runs
  // on a different port), so the default same-origin resource policy would
  // block the browser from reading any response, including plain JSON.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Auth is JWT-bearer-token-based, not cookie-based, so there's no CSRF
  // exposure from allowing any origin to call this API — and no need to
  // rely on getting a CLIENT_URL env var exactly right on every deployment.
  // (An earlier version restricted this via CLIENT_URL; that kept silently
  // mismatching on Vercel and blocking real requests, so it's gone.)
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/attachments', attachmentRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/stories', storyRoutes);

  app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: `Unexpected upload field: ${err.field || 'unknown'}`,
      });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large' });
    }
    if (err?.name === 'MulterError') {
      return res.status(400).json({ success: false, error: err.message || 'Upload failed' });
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  });

  return app;
}
