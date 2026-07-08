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

  app.use(helmet());
  app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
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
