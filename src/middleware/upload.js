import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.enc`),
});

// The file bytes are already nacl.box ciphertext by the time they reach the
// server, so a 15MB cap on the *encrypted* payload comfortably covers
// reasonably sized attachments.
export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

export function resolveUploadPath(storagePath) {
  return path.join(process.cwd(), UPLOAD_DIR, path.basename(storagePath));
}

export { UPLOAD_DIR };
