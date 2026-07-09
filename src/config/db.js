import mongoose from 'mongoose';

// Serverless platforms (Vercel) reuse warm containers across invocations and
// call this on every request — cache the connection promise so we don't
// reconnect (or race concurrent connects) each time.
let connectionPromise;

export function buildMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

  const { MONGODB_USER, MONGODB_PASSWORD, MONGODB_CLUSTER, MONGODB_DB } = process.env;
  if (!MONGODB_USER || !MONGODB_PASSWORD || !MONGODB_CLUSTER) {
    throw new Error('Set MONGODB_URI, or MONGODB_USER + MONGODB_PASSWORD + MONGODB_CLUSTER');
  }
  const user = encodeURIComponent(MONGODB_USER);
  const password = encodeURIComponent(MONGODB_PASSWORD);
  return `mongodb+srv://${user}:${password}@${MONGODB_CLUSTER}/${MONGODB_DB || ''}?retryWrites=true&w=majority&appName=Cluster0`;
}

export function connectDB() {
  if (!connectionPromise) {
    const uri = buildMongoUri();
    connectionPromise = mongoose
      .connect(uri)
      .then(() => console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`))
      .catch((err) => {
        connectionPromise = undefined; // allow retry on next invocation
        throw err;
      });
  }
  return connectionPromise;
}
