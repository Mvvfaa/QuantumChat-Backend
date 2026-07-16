// Boots the real Express app against a throwaway in-memory MongoDB instance
// — no external database, secrets, or network dependency beyond downloading
// the mongod binary, which mongodb-memory-server handles itself. Safe to run
// in CI with zero configuration.
import http from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

export async function startTestServer() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-never-used-in-production';
  process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '.test-uploads';

  const { connectDB } = await import('../../src/config/db.js');
  const { createApp } = await import('../../src/app.js');

  await connectDB();
  const app = createApp();
  const server = http.createServer((req, res) => app(req, res));
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return {
    base: `http://localhost:${port}/api`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      // The Mongoose driver's connection pool keeps its own sockets/timers
      // alive independently of the mongod process itself — killing mongod
      // without explicitly disconnecting the client left the event loop
      // non-empty, which was hanging the whole `node --test` run waiting
      // for this file's process to exit naturally.
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
}

export async function registerUser(base, username) {
  const { generateKeySet } = await import('./crypto.js');
  const keySet = generateKeySet();
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: 'password123',
      publicKeys: keySet.map((k) => k.publicKey),
    }),
  }).then((r) => r.json());
  if (!res.success) throw new Error(`registerUser(${username}) failed: ${res.error}`);
  return { keySet, token: res.data.token, user: res.data.user };
}
