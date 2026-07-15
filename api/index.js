import 'dotenv/config';
import { createApp } from '../src/app.js';
import { connectDB } from '../src/config/db.js';

// No socket.io here: Vercel's serverless functions can't hold the persistent
// connections it needs. The app still works over plain REST — sendMessage
// just skips the realtime push (see messageController.js).
const app = createApp();

export default async function handler(req, res) {
  await connectDB();
  return app(req, res);
}
