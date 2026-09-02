function stripQuotes(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

export function cloudinaryEnv(name) {
  return stripQuotes(process.env[name]);
}

/** Accept Cloudinary's single CLOUDINARY_URL=cloudinary://key:secret@cloud_name */
export function applyCloudinaryUrlFromEnv() {
  const raw = cloudinaryEnv('CLOUDINARY_URL');
  if (!raw) return;
  try {
    const parsed = new URL(raw);
    if (!cloudinaryEnv('CLOUDINARY_CLOUD_NAME') && parsed.hostname) {
      process.env.CLOUDINARY_CLOUD_NAME = parsed.hostname;
    }
    if (!cloudinaryEnv('CLOUDINARY_API_KEY') && parsed.username) {
      process.env.CLOUDINARY_API_KEY = decodeURIComponent(parsed.username);
    }
    if (!cloudinaryEnv('CLOUDINARY_API_SECRET') && parsed.password) {
      process.env.CLOUDINARY_API_SECRET = decodeURIComponent(parsed.password);
    }
  } catch {
    // ignore malformed CLOUDINARY_URL
  }
}

export function hasCloudinaryCredentials() {
  applyCloudinaryUrlFromEnv();
  return Boolean(
    cloudinaryEnv('CLOUDINARY_CLOUD_NAME') &&
      cloudinaryEnv('CLOUDINARY_API_KEY') &&
      cloudinaryEnv('CLOUDINARY_API_SECRET'),
  );
}

/** Safe booleans for /api/health — never exposes secret values. */
export function getCloudinaryDiagnostics() {
  applyCloudinaryUrlFromEnv();
  return {
    cloudNameSet: Boolean(cloudinaryEnv('CLOUDINARY_CLOUD_NAME')),
    apiKeySet: Boolean(cloudinaryEnv('CLOUDINARY_API_KEY')),
    apiSecretSet: Boolean(cloudinaryEnv('CLOUDINARY_API_SECRET')),
    cloudinaryUrlSet: Boolean(cloudinaryEnv('CLOUDINARY_URL')),
    storageProvider: cloudinaryEnv('STORAGE_PROVIDER') || null,
    isVercel: isVercelRuntime(),
  };
}

export function isVercelRuntime() {
  return process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}
