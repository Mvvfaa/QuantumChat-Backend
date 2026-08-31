import { CloudinaryStorageAdapter } from './CloudinaryStorageAdapter.js';
import { LocalDiskStorageAdapter } from './LocalDiskStorageAdapter.js';
import { MemoryStorageAdapter } from './MemoryStorageAdapter.js';
import {
  hasCloudinaryCredentials,
  isVercelRuntime,
} from './cloudinaryEnv.js';

/** @type {CloudinaryStorageAdapter | LocalDiskStorageAdapter | MemoryStorageAdapter | null} */
let cached;

/**
 * Durable blob storage.
 * Cloudinary is required on Vercel. Local disk is used on your machine even
 * if NODE_ENV=production is set in Windows (dotenv will not override it).
 */
export function getStorage() {
  if (cached) return cached;

  if (process.env.STORAGE_PROVIDER === 'memory') {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Memory storage is restricted to NODE_ENV=test');
    }
    cached = new MemoryStorageAdapter();
    return cached;
  }

  if (process.env.STORAGE_PROVIDER === 'local') {
    cached = new LocalDiskStorageAdapter();
    return cached;
  }

  if (hasCloudinaryCredentials()) {
    cached = new CloudinaryStorageAdapter();
    return cached;
  }

  // Only fail hard on Vercel, where disk is ephemeral.
  if (isVercelRuntime()) {
    throw new Error(
      'Cloudinary storage missing CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET. Add them to the Vercel backend project (Production), then Redeploy.',
    );
  }

  console.warn(
    '[storage] Cloudinary credentials missing — using local uploads/ folder. Set CLOUDINARY_* in backend/.env to use Cloudinary.',
  );
  cached = new LocalDiskStorageAdapter();
  return cached;
}

export function getStorageProviderName() {
  if (process.env.STORAGE_PROVIDER === 'memory') return 'memory';
  if (process.env.STORAGE_PROVIDER === 'local') return 'local';
  if (hasCloudinaryCredentials()) return 'cloudinary';
  return isVercelRuntime() ? 'cloudinary' : 'local';
}

export { CloudinaryStorageAdapter } from './CloudinaryStorageAdapter.js';
export { LocalDiskStorageAdapter } from './LocalDiskStorageAdapter.js';
export { MemoryStorageAdapter } from './MemoryStorageAdapter.js';
