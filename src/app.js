import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import attachmentRoutes from './routes/attachmentRoutes.js';
import { authLimiter } from './middleware/rateLimiter.js';

export function createApp() {
  const app = express();

  // The API is deliberately consumed cross-origin (frontend dev server runs
  // on a different port), so the default same-origin resource policy would
  // block the browser from reading any response, including plain JSON.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // CLIENT_URL may be a single origin or a comma-separated list, so the same
  // deployment can serve both local dev and one or more deployed frontends
  // (e.g. a Vercel preview URL plus the production domain).
  const allowedOrigins = (process.env.CLIENT_URL || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, callback) {
        if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
    })
  );
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/attachments', attachmentRoutes);

  app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  });

  return app;
}
