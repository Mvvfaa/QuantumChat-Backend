# Security checks before a pull request

Run the same attack suite used by GitHub Actions:

```powershell
npm ci
npm test
```

The suite covers sealed-box/secretbox tampering, entropy and nonce reuse,
JWT algorithm confusion and forgery, IDOR, NoSQL injection, upload traversal,
mass assignment, and QuantumAI impersonation. A failure is a merge blocker.

# QuantumChat — Frontend

React/Vite client for QuantumChat. All encryption happens here — key generation and `nacl.box` sealing/unsealing — the backend never receives a private key or plaintext.

Full architecture and crypto design: see the [root README](../README.md).

## Scripts

```bash
npm install
cp .env.example .env    # set MONGODB_URI and JWT_SECRET at minimum
npm run dev               # nodemon, local dev — persistent server + Socket.IO, http://localhost:5000
npm start                  # plain node, same entry point
npm test                    # security attack suite — see "Testing" below
```

There is no build step — it's plain ESM Node, run directly.

## Project structure

```
server.js                  # local-dev entry point: connects DB, starts HTTP + Socket.IO server
api/index.js                 # Vercel serverless entry point — no Socket.IO, cached DB connection
vercel.json                   # rewrites all paths to api/index for Vercel deployment
src/
  app.js                     # createApp(): express instance, middleware, routes (used by both entry points)
  config/db.js                 # connectDB(): caches the mongoose connection promise (safe to call repeatedly)
  models/
    User.js                   # username/email/password, publicKeys[5] (KEY_SET_SIZE, fixed at registration), lastLoginAt
    Message.js                 # from/to, forRecipient + forSender sealed-box envelopes, optional attachment ref
    Attachment.js               # owner/recipient, storagePath on disk, single sealed-box envelope (recipient only)
  controllers/
    authController.js           # register (creates the 5-key pool once), login (auth only, doesn't touch keys)
    userController.js            # listUsers, getUser, updatePublicKeys (manual device-recovery only)
    messageController.js          # sendMessage (validates both envelopes), getConversation
    attachmentController.js        # uploadAttachment (multer), downloadAttachment (sender/recipient only)
  routes/                          # one file per resource, mounted under /api/<resource> in app.js
  middleware/
    auth.js                        # requireAuth: verifies JWT, attaches req.user
    upload.js                       # multer disk storage config, resolveUploadPath()
    rateLimiter.js                   # authLimiter: 20 req/min on /api/auth/*
  socket/index.js                    # attachSocket(io): JWT-authenticated Socket.IO, per-user rooms (local dev only)
test/security/                       # security attack suite (see Testing below)
test/helpers/                        # test-only server bootstrap + a standalone crypto mirror
```

## Environment variables

| Variable         | Default                                          | Description                                                        |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `PORT`           | 5000                                             | HTTP/Socket.IO port — local dev only, unused on Vercel             |
| `MONGODB_URI`    | —                                                | **Required.** Mongo connection string, including the database name |
| `JWT_SECRET`     | —                                                | **Required.** JWT signing secret — set a long random value         |
| `JWT_EXPIRES_IN` | 7d                                               | Token lifetime                                                     |
| `UPLOAD_DIR`     | `uploads` (or `/tmp/uploads` if `VERCEL` is set) | Where encrypted attachment blobs are stored on disk                |

`.env` is git-ignored — never commit real credentials. On Vercel, set these in the project dashboard (Settings → Environment Variables); a local `.env` file has no effect there.

## API summary

See the [root README](../README.md#api-reference) for the full request/response shapes. Quick reference:

| Method | Path                        | Auth | Notes                                                |
| ------ | --------------------------- | ---- | ---------------------------------------------------- |
| POST   | `/api/auth/register`        | —    | body needs `publicKeys` (5 keys), fixed thereafter   |
| POST   | `/api/auth/login`           | —    | just `{ email, password }` — doesn't touch keys      |
| GET    | `/api/auth/me`              | JWT  |                                                      |
| GET    | `/api/users`                | JWT  |                                                      |
| GET    | `/api/users/:id`            | JWT  |                                                      |
| PATCH  | `/api/users/me/public-keys` | JWT  | manual device-recovery only, replaces the whole pool |
| POST   | `/api/messages`             | JWT  | body needs `forRecipient` + `forSender` envelopes    |
| GET    | `/api/messages/:userId`     | JWT  | full history with that user                          |
| POST   | `/api/attachments`          | JWT  | `multipart/form-data`, pre-sealed file bytes         |
| GET    | `/api/attachments/:id/raw`  | JWT  | sender or recipient only                             |

## Testing

`npm test` runs a security attack suite (Node's built-in test runner, `node --test`) — not feature tests, an active attempt to break the app:

- **`test/security/server-attack-surface.test.js`** — boots the real Express app against a throwaway in-memory MongoDB (`mongodb-memory-server`), sends a real sealed message and attachment between two real accounts, then attacks the raw stored document: wrong accounts' keys, the wrong one of the recipient's own 5 keys, a public key placed in the private-key slot, crossed envelopes, tampered ciphertext/nonce, 500 brute-forced random keys — all of which must fail — plus control checks that the actual correct keys still work. It then attacks the API layer directly on the same data: no auth header, a JWT forged with the wrong secret, a legitimately-issued JWT with a tampered payload, an expired token, a third party pulling up someone else's conversation, and NoSQL injection payloads in place of a MongoDB id.
- **`test/security/randomness-integrity.test.js`** — no server needed; checks that nonces, ephemeral keys, and generated keypairs never repeat across hundreds of samples. A collision here would mean the RNG backing the encryption had silently broken.

A green result means every attack was correctly rejected; a **failure here is a critical security regression, not a flaky test** — do not merge until it's understood. Runs automatically on every push/PR via `.github/workflows/decryption-security.yml`.

`test/helpers/crypto.js` deliberately duplicates the sealed-box algorithm from `frontend/src/crypto/keys.js` rather than importing it — backend and frontend are separate GitHub repos, and this suite must run standalone in the backend repo's own CI with no sibling frontend checkout available. Keep the two in sync if the real algorithm ever changes.

Note: since these helper files live under `test/`, Node's test runner auto-discovers them too and reports them as two trivial passing "tests" (they define no assertions, so they're vacuously green) — cosmetic noise, not a real gap in coverage.

## Deploying to Vercel

Deploy this repo directly (it's its own GitHub repo, not the monorepo root) with **Root Directory left blank**. Required env vars: `MONGODB_URI`, `JWT_SECRET`. See the [root README's deployment section](../README.md#deploying-to-vercel) for the Socket.IO and attachment-storage limitations that apply on serverless hosting.
