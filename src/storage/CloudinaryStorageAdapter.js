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
        'Cloudinary storage requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET',
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
    // Avoid double-prefix if a caller already passed a quantumchat/ key.
    if (relative.startsWith('quantumchat/')) return relative;
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
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'raw',
          type: 'upload',
          overwrite: true,
          invalidate: true,
        },
        (err, uploadResult) => (err ? reject(err) : resolve(uploadResult)),
      );
      stream.end(buffer);
    });

    // Prefer the public_id Cloudinary actually stored (includes extension for raw).
    const key = result?.public_id || publicId;
    return { key, provider: 'cloudinary' };
  }

  /**
   * Cloudinary uploads always go through the server (see `put`) — bytes are
   * proxied rather than PUT directly from the browser.
   * @returns {Promise<{ mode: 'proxy' }>}
   */
  async createUploadTarget() {
    return { mode: 'proxy' };
  }

  async fetchUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error(`Cloudinary fetch failed (${response.status})`);
      error.code = response.status === 404 ? 'ENOENT' : 'EIO';
      error.status = response.status;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Build candidate delivery URLs for a public_id. Unsigned CDN URLs can 404
   * when the account restricts raw delivery; signed + Admin API URLs recover.
   */
  candidateUrls(publicId) {
    const urls = [];
    const add = (url) => {
      if (url && !urls.includes(url)) urls.push(url);
    };

    for (const resource_type of ['raw', 'image', 'video', 'auto']) {
      add(
        cloudinary.url(publicId, {
          resource_type,
          type: 'upload',
          secure: true,
        }),
      );
      add(
        cloudinary.url(publicId, {
          resource_type,
          type: 'upload',
          secure: true,
          sign_url: true,
        }),
      );
    }

    return urls;
  }

  async readViaAdminApi(publicId) {
    const resourceTypes = ['raw', 'image', 'video'];
    for (const resource_type of resourceTypes) {
      try {
        const info = await cloudinary.api.resource(publicId, {
          resource_type,
          // Prefer bytes when Cloudinary returns them; otherwise use secure_url.
        });
        if (info?.secure_url) {
          return await this.fetchUrl(info.secure_url);
        }
      } catch {
        // try next resource type
      }
    }
    return null;
  }

  async read(key) {
    this.ensureConfigured();
    const publicId = String(key || '').replace(/^[/\\]+/, '');
    if (!publicId) {
      const error = new Error('Stored object not found');
      error.code = 'ENOENT';
      throw error;
    }

    // 1) Admin API is authoritative (works even when CDN URL shape is wrong).
    try {
      const viaAdmin = await this.readViaAdminApi(publicId);
      if (viaAdmin) return viaAdmin;
    } catch {
      // fall through to URL candidates
    }

    // 2) Try unsigned + signed delivery URLs across resource types.
    let lastErr;
    for (const url of this.candidateUrls(publicId)) {
      try {
        return await this.fetchUrl(url);
      } catch (err) {
        lastErr = err;
      }
    }

    const error = lastErr || new Error('Stored object not found');
    error.code = error.code || 'ENOENT';
    throw error;
  }

  async delete(key) {
    if (!key) return;
    this.ensureConfigured();
    const publicId = String(key).replace(/^[/\\]+/, '');
    for (const resource_type of ['raw', 'image', 'video']) {
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type });
      } catch {
        // best-effort (already gone / wrong type)
      }
    }
  }
}
