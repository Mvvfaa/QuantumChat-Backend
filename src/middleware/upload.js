import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'avatars'), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'stories'), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'groups'), { recursive: true });

const encStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.enc`),
});

export const upload = multer({
  storage: encStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

const avatarStorage = multer.diskStorage({
  destination: path.join(UPLOAD_DIR, 'avatars'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Avatar must be an image'));
    }
    cb(null, true);
  },
});

const groupPhotoStorage = multer.diskStorage({
  destination: path.join(UPLOAD_DIR, 'groups'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const groupPhotoUpload = multer({
  storage: groupPhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Group photo must be an image'));
    }
    cb(null, true);
  },
});

const storyStorage = multer.diskStorage({
  destination: path.join(UPLOAD_DIR, 'stories'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const storyUpload = multer({
  storage: storyStorage,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const type = file.mimetype || '';
    if (
      type.startsWith('image/') ||
      type.startsWith('video/') ||
      type.startsWith('audio/') ||
      type === 'application/octet-stream'
    ) {
      return cb(null, true);
    }
    cb(new Error('Story must be an image, video, or audio file'));
  },
});

export function resolveUploadPath(storagePath) {
  const root = path.resolve(UPLOAD_DIR);
  const resolved = path.resolve(UPLOAD_DIR, storagePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid upload path');
  }
  return resolved;
}

export { UPLOAD_DIR };
