import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveUploadPath, UPLOAD_DIR } from '../../src/middleware/upload.js';

test('upload path resolution blocks traversal and sibling-prefix escapes', () => {
  assert.throws(() => resolveUploadPath('../outside.enc'), /Invalid upload path/);
  assert.throws(() => resolveUploadPath(`..${path.sep}${path.basename(UPLOAD_DIR)}-evil${path.sep}file.enc`), /Invalid upload path/);
});

test('upload path resolution accepts files inside the configured root', () => {
  const resolved = resolveUploadPath(`avatars${path.sep}safe.jpg`);
  assert.ok(resolved.startsWith(path.resolve(UPLOAD_DIR)));
});
