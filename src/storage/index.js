import { CloudinaryStorageAdapter } from './CloudinaryStorageAdapter.js';
import { LocalDiskStorageAdapter } from './LocalDiskStorageAdapter.js';
import { MemoryStorageAdapter } from './MemoryStorageAdapter.js';
import {
  hasCloudinaryCredentials,
  isVercelRuntime,
} from './cloudinaryEnv.js';

/** @type {CloudinaryStorageAdapter | LocalDiskStorageAdapter | MemoryStorageAdapter | null} */
let defaultCached;
const adapters = {
  memory: null,
  local: null,
  cloudinary: null,
};

function memoryAdapter() {
  if (!adapters.memory) adapters.memory = new MemoryStorageAdapter();
  return adapters.memory;
}

function localAdapter() {
  if (!adapters.local) adapters.local = new LocalDiskStorageAdapter();
  return adapters.local;
}

function cloudinaryAdapter() {
  if (!hasCloudinaryCredentials()) {
    throw new Error(
      'Cloudinary storage requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET',
    );
  }
  if (!adapters.cloudinary) adapters.cloudinary = new CloudinaryStorageAdapter();
  return adapters.cloudinary;
}

function isTestMemoryMode() {
  return process.env.STORAGE_PROVIDER === 'memory' || process.env.NODE_ENV === 'test';
}

/** Cloudinary public_ids from CloudinaryStorageAdapter.toPublicId(). */
export function looksLikeCloudinaryKey(key) {
  return String(key || '').replace(/^[/\\]+/, '').startsWith('quantumchat/');
}

/**
 * Durable blob storage used for new uploads.
 * Cloudinary is required on Vercel. STORAGE_PROVIDER=local keeps writes on
 * disk for localhost even when Cloudinary credentials are present.
 */
export function getStorage() {
  if (defaultCached) return defaultCached;

  if (process.env.STORAGE_PROVIDER === 'memory') {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Memory storage is restricted to NODE_ENV=test');
    }
    defaultCached = memoryAdapter();
    return defaultCached;
  }

  if (process.env.STORAGE_PROVIDER === 'local') {
    defaultCached = localAdapter();
    return defaultCached;
  }

  if (hasCloudinaryCredentials()) {
    defaultCached = cloudinaryAdapter();
    return defaultCached;
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
  defaultCached = localAdapter();
  return defaultCached;
}

export function getStorageProviderName() {
  if (process.env.STORAGE_PROVIDER === 'memory') return 'memory';
  if (process.env.STORAGE_PROVIDER === 'local') return 'local';
  if (hasCloudinaryCredentials()) return 'cloudinary';
  return isVercelRuntime() ? 'cloudinary' : 'local';
}

/**
 * Adapter for a stored object's recorded provider.
 * Localhost often has STORAGE_PROVIDER=local while production stories live on Cloudinary.
 */
export function getStorageFor(provider) {
  const name = String(provider || '').toLowerCase();
  if (name === 'memory') return memoryAdapter();
  if (name === 'cloudinary') return cloudinaryAdapter();
  if (name === 'local') return localAdapter();
  return getStorage();
}

function readCandidates(providerHint, key) {
  const names = [];
  const add = (name) => {
    if (name && !names.includes(name)) names.push(name);
  };
  const hint = String(providerHint || '').toLowerCase();
  if (hint === 'cloudinary' || hint === 'local' || hint === 'memory') add(hint);
  if (looksLikeCloudinaryKey(key)) add('cloudinary');
  add(getStorageProviderName());
  if (hasCloudinaryCredentials()) add('cloudinary');
  add('local');
  return names;
}

/**
 * Read bytes from the adapter that actually holds the object, not only the
 * process-wide write target. Falls back across Cloudinary/local so localhost
 * can still open stories posted from production.
 */
export async function readStoredObject(key, providerHint) {
  if (!key) {
    const error = new Error('Stored object not found');
    error.code = 'ENOENT';
    throw error;
  }
  if (isTestMemoryMode()) {
    return getStorage().read(key);
  }

  let lastErr;
  for (const name of readCandidates(providerHint, key)) {
    try {
      return await getStorageFor(name).read(key);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Stored object not found');
}

export async function deleteStoredObject(key, providerHint) {
  if (!key) return;
  if (isTestMemoryMode()) {
    await getStorage().delete(key);
    return;
  }
  const first = readCandidates(providerHint, key)[0] || getStorageProviderName();
  try {
    await getStorageFor(first).delete(key);
  } catch {
    // best-effort (already gone / wrong adapter)
  }
}

export { CloudinaryStorageAdapter } from './CloudinaryStorageAdapter.js';
export { LocalDiskStorageAdapter } from './LocalDiskStorageAdapter.js';
export { MemoryStorageAdapter } from './MemoryStorageAdapter.js';
