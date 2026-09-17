/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * `getImageCacheDir()` caches its result for the life of the module, so every test gets its own
 * fresh temp directory via `vi.resetModules()` + a fresh mock of `computeDbPath` rather than
 * sharing one across the file.
 */
describe('image cache', () => {
  let tmpDir;
  let imageCache;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fredy-image-cache-'));
    vi.resetModules();
    vi.doMock('../../../lib/services/storage/SqliteConnection.js', () => ({
      computeDbPath: vi.fn(async () => ({ dir: tmpDir, dbPath: path.join(tmpDir, 'listings.db') })),
    }));
    imageCache = await import('../../../lib/services/images/imageCache.js');
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates the cache directory as a sibling of the database', async () => {
    const dir = await imageCache.getImageCacheDir();
    expect(dir).toBe(path.join(tmpDir, 'image-cache'));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('returns null for an image that was never cached', async () => {
    expect(await imageCache.readCachedImage('missing')).toBeNull();
  });

  it('round-trips bytes and mime type', async () => {
    const buffer = Buffer.from('fake image bytes');
    await imageCache.writeCachedImage('abc', buffer, 'image/jpeg');

    const cached = await imageCache.readCachedImage('abc');
    expect(cached.buffer).toEqual(buffer);
    expect(cached.mimeType).toBe('image/jpeg');
  });

  it('does not confuse one cached image for another', async () => {
    await imageCache.writeCachedImage('one', Buffer.from('AAA'), 'image/png');
    await imageCache.writeCachedImage('two', Buffer.from('BBB'), 'image/webp');

    expect((await imageCache.readCachedImage('one')).mimeType).toBe('image/png');
    expect((await imageCache.readCachedImage('two')).mimeType).toBe('image/webp');
  });

  it('lists every cached image with its last-modified time', async () => {
    await imageCache.writeCachedImage('one', Buffer.from('AAA'), 'image/jpeg');
    await imageCache.writeCachedImage('two', Buffer.from('BBB'), 'image/jpeg');

    const listed = await imageCache.listCachedImages();
    expect(listed.map((entry) => entry.imageId).sort()).toEqual(['one', 'two']);
    expect(listed.every((entry) => typeof entry.mtimeMs === 'number')).toBe(true);
  });

  it('removes both the bytes and the sidecar mime file', async () => {
    await imageCache.writeCachedImage('one', Buffer.from('AAA'), 'image/jpeg');

    await imageCache.deleteCachedImage('one');

    expect(await imageCache.readCachedImage('one')).toBeNull();
    expect(await imageCache.listCachedImages()).toEqual([]);
  });

  it('does not throw when deleting an image that was never cached', async () => {
    await expect(imageCache.deleteCachedImage('never-existed')).resolves.toBeUndefined();
  });
});
