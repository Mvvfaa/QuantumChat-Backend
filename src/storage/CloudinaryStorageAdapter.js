import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';
import { applyCloudinaryUrlFromEnv, cloudinaryEnv } from './cloudinaryEnv.js';

/**
 * Durable blob storage backed by Cloudinary.
 *
 * Every object — plain images (avatars, group photos, wallpapers) and
 * opaque E2E ciphertext alike (message attachments, sealed stories) — is
 * stored as resource_type 'raw' so Cloudinary never tries to decode
 * ciphertext bytes as media.
 */
export class CloudinaryStorageAdapter {
  constructor() {
    this.configured = false;
  }

  ensureConfigured() {
    if (this.configured) return;
    applyCloudinaryUrlFromEnv();
    const cloud_name = cloudinaryEnv('CLOUDINARY_CLOUD_NAME');
    const api_key = cloudinaryEnv('CLOUDINARY_API_KEY');
    const api_secret = cloudinaryEnv('CLOUDINARY_API_SECRET');
    if (!cloud_name || !api_key || !api_secret) {
      throw new Error(
        'Cloudinary storage requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET'
      );
    }
    cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
    this.configured = true;
  }

  async ensureReady() {
    this.ensureConfigured();
  }

  toPublicId(name) {
    const relative = String(name || crypto.randomUUID()).replace(/^[/\\]+/, '');
    return `quantumchat/${relative}`;
  }

  /**
   * @param {Buffer} buffer
   * @param {string} name
   * @param {string} _mimeType
   * @param {string} _userId
   */
  async put(buffer, name, _mimeType, _userId) {
    this.ensureConfigured();
    const publicId = this.toPublicId(name);
    await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id: publicId, resource_type: 'raw', overwrite: true },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buffer);
    });
    return { key: publicId, provider: 'cloudinary' };
  }

  /**
   * Cloudinary uploads always go through the server (see `put`) — bytes are
   * proxied rather than PUT directly from the browser.
   * @returns {Promise<{ mode: 'proxy' }>}
   */
  async createUploadTarget() {
    return { mode: 'proxy' };
  }

  async read(key) {
    this.ensureConfigured();
    const url = cloudinary.url(key, { resource_type: 'raw', secure: true });
    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error('Stored object not found');
      error.code = 'ENOENT';
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key) {
    if (!key) return;
    this.ensureConfigured();
    try {
      await cloudinary.uploader.destroy(key, { resource_type: 'raw' });
    } catch {
      // best-effort (already gone / permission)
    }
  }
}
