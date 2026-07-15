# QuantumChat — Backend

Express/Mongoose/Socket.IO API for QuantumChat. It never sees a private key or plaintext message — every message and attachment arrives already sealed with `nacl.box` (see [`frontend/src/crypto/keys.js`](../frontend/src/crypto/keys.js)), so the server's job is limited to auth, storage, and relaying ciphertext.

Full architecture and crypto design: see the [root README](../README.md).

## Scripts

```bash
npm install
<<<<<<< HEAD
cp .env.example .env    # VITE_API_URL, defaults to http://localhost:5000
npm run dev               # http://localhost:5173
npm run build              # production build to dist/
npm run preview             # serve the production build locally
```

## Project structure

```
src/
  crypto/
    keys.js               # generateKeyPair/generateKeySet, sealMessage/unsealMessage,
                            # sealBytes/unsealBytes (binary variant for attachments), pickRandom,
                            # derivePublicKey (validates an imported private key against the account)
    keyStorage.js           # local keyring (localStorage, append-only), session (token/user) storage
    keyFile.js               # keys.txt format/parse/download — human-readable private key backup
  api/
    client.js                # axios instance, attaches the JWT to every request
    socket.js                 # socket.io-client connection (no-ops gracefully if the backend has none)
  context/
    AuthContext.jsx           # register/login/regenerateKeys/importKeys/logout — owns all key-generation calls
  pages/
    Register.jsx, Login.jsx, Chat.jsx
  components/
    UserList.jsx, MessageBubble.jsx, AttachmentBubble.jsx, ProtectedRoute.jsx
```

## How the crypto module is used (quick orientation)

- **Register** (`AuthContext.jsx`): calls `generateKeySet()` to make 5 fresh keypairs, sends the 5 public keys to the backend once, and adds all 5 to the local keyring via `addKeySetToRing()`. This pool is fixed from then on — **login doesn't generate or send any keys**, it's plain `{ email, password }` auth.
- **Sending a message** (`Chat.jsx`): picks a random key from the recipient's 5 public keys and a random key from your own 5, calls `sealMessage()` twice (once per side) so both parties can read it later, and posts both envelopes to `/messages`.
- **Sending a file**: same idea via `sealBytes()`, but sealed once (to the recipient only) — see the root README for why.
- **Reading a message**: looks up which of your own public keys the relevant envelope was sealed to (`envelope.targetPublicKey`), finds the matching private key in your local keyring (`findSecretKeyForPublicKey`) — a direct lookup, not a "try all 5 until one works" — and calls `unsealMessage()`. If that key isn't in your keyring (different device, wiped storage), decryption fails and the UI shows "unable to decrypt."
- **Backing up keys** (`Register.jsx`): right after signup, `register()` returns the raw 5-keypair `keySet` (the only time it's ever available outside the keyring) so the UI can show it and offer a "Download keys.txt" button (`formatKeyFile` + `downloadKeyFile` in `keyFile.js`).
- **Restoring on a new device** (`Chat.jsx`'s "no local keyring" gate): "Import keys.txt" reads the uploaded file, `parseKeyFile()` pulls out the 5 hex keys, and `importKeys()` in `AuthContext.jsx` validates each one by deriving its public key and checking it against the logged-in account's actual `publicKeys` before adding anything to the keyring — a file that doesn't match is rejected with an error, not silently accepted.
- **Recovering with no backup at all**: `regenerateKeys()` in `AuthContext.jsx` generates a brand-new 5-key pool and publishes it via `PATCH /users/me/public-keys`, replacing the old one — offered as the fallback next to "Import keys.txt" when no local keyring is found. History under the old pool is unrecoverable either way once you take this path.
- **Logout wipes the keyring**: `logout()` calls `clearKeyring(user.id)` before clearing the session, so the "no local keyring" gate always fires on the next login — `keys.txt` (or a fresh pool) is required every time, not just on a genuinely new device.

=======
cp .env.example .env # set MONGODB_URI and JWT_SECRET at minimum
npm run dev # nodemon, local dev — persistent server + Socket.IO, http://localhost:5000
npm start # plain node, same entry point

```

There is no build step — it's plain ESM Node, run directly.

## Project structure

```

server.js # local-dev entry point: connects DB, starts HTTP + Socket.IO server
api/index.js # Vercel serverless entry point — no Socket.IO, cached DB connection
vercel.json # rewrites all paths to api/index for Vercel deployment
src/
app.js # createApp(): express instance, middleware, routes (used by both entry points)
config/db.js # connectDB(): caches the mongoose connection promise (safe to call repeatedly)
models/
User.js # username/email/password, publicKeys[5] (KEY_SET_SIZE, fixed at registration), lastLoginAt
Message.js # from/to, forRecipient + forSender sealed-box envelopes, optional attachment ref
Attachment.js # owner/recipient, storagePath on disk, single sealed-box envelope (recipient only)
controllers/
authController.js # register (creates the 5-key pool once), login (auth only, doesn't touch keys)
userController.js # listUsers, getUser, updatePublicKeys (manual device-recovery only)
messageController.js # sendMessage (validates both envelopes), getConversation
attachmentController.js # uploadAttachment (multer), downloadAttachment (sender/recipient only)
routes/ # one file per resource, mounted under /api/<resource> in app.js
middleware/
auth.js # requireAuth: verifies JWT, attaches req.user
upload.js # multer disk storage config, resolveUploadPath()
rateLimiter.js # authLimiter: 20 req/min on /api/auth/\*
socket/index.js # attachSocket(io): JWT-authenticated Socket.IO, per-user rooms (local dev only)

```

>>>>>>> a4231c8a959b19b6a89af2c0e2aa38664243b8b9
## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
<<<<<<< HEAD
| `VITE_API_URL` | `http://localhost:5000` | Backend base URL (no trailing `/api`) |

## Deploying to Vercel

Static Vite build — Vercel's zero-config detection handles this natively, no `vercel.json` needed. Set `VITE_API_URL` in the project's Environment Variables to your deployed backend's URL. See the [root README](../README.md#deploying-to-vercel) for backend-side deployment notes (Socket.IO and attachments don't work the same way on a serverless backend).
=======
| `PORT` | 5000 | HTTP/Socket.IO port — local dev only, unused on Vercel |
| `MONGODB_URI` | — | **Required.** Mongo connection string, including the database name |
| `JWT_SECRET` | — | **Required.** JWT signing secret — set a long random value |
| `JWT_EXPIRES_IN` | 7d | Token lifetime |
| `UPLOAD_DIR` | `uploads` (or `/tmp/uploads` if `VERCEL` is set) | Where encrypted attachment blobs are stored on disk |

`.env` is git-ignored — never commit real credentials. On Vercel, set these in the project dashboard (Settings → Environment Variables); a local `.env` file has no effect there.

## API summary

See the [root README](../README.md#api-reference) for the full request/response shapes. Quick reference:

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/register` | — | body needs `publicKeys` (5 keys), fixed thereafter |
| POST | `/api/auth/login` | — | just `{ email, password }` — doesn't touch keys |
| GET | `/api/auth/me` | JWT | |
| GET | `/api/users` | JWT | |
| GET | `/api/users/:id` | JWT | |
| PATCH | `/api/users/me/public-keys` | JWT | manual device-recovery only, replaces the whole pool |
| POST | `/api/messages` | JWT | body needs `forRecipient` + `forSender` envelopes |
| GET | `/api/messages/:userId` | JWT | full history with that user |
| POST | `/api/attachments` | JWT | `multipart/form-data`, pre-sealed file bytes |
| GET | `/api/attachments/:id/raw` | JWT | sender or recipient only |

## Deploying to Vercel

Deploy this repo directly (it's its own GitHub repo, not the monorepo root) with **Root Directory left blank**. Required env vars: `MONGODB_URI`, `JWT_SECRET`. See the [root README's deployment section](../README.md#deploying-to-vercel) for the Socket.IO and attachment-storage limitations that apply on serverless hosting.
>>>>>>> a4231c8a959b19b6a89af2c0e2aa38664243b8b9
```
