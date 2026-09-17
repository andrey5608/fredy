/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import path from 'path';
import { computeDbPath } from '../storage/SqliteConnection.js';

/**
 * Resolved lazily and cached for the life of the process - `computeDbPath()` reads
 * `conf/config.json` and creates the directory if needed, neither of which changes while Fredy is
 * running.
 * @type {string|null}
 */
let cachedDir = null;

/**
 * The directory cached (downloaded and possibly compressed) listing images are kept in.
 *
 * A sibling of the SQLite database rather than a path of its own: both are instance data that
 * belongs together, and an operator who already knows to back up/relocate `sqlitepath` gets this
 * for free instead of having to learn a second setting.
 *
 * @returns {Promise<string>}
 */
export async function getImageCacheDir() {
  if (cachedDir != null) return cachedDir;
  const { dir } = await computeDbPath();
  const cacheDir = path.join(dir, 'image-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  cachedDir = cacheDir;
  return cachedDir;
}

/**
 * Bytes and sidecar mime-type file for one cached image.
 *
 * Two files rather than one, so the mime type - which varies per image, since an untouched
 * original keeps whatever format the portal served it in - can be read back without either
 * sniffing the bytes again or listing the directory to find which extension this id was saved
 * under.
 *
 * @param {string} dir
 * @param {string} imageId
 * @returns {{bytesPath: string, mimePath: string}}
 */
function pathsFor(dir, imageId) {
  return { bytesPath: path.join(dir, `${imageId}.img`), mimePath: path.join(dir, `${imageId}.mime`) };
}

/**
 * @typedef {Object} CachedImage
 * @property {Buffer} buffer
 * @property {string} mimeType
 */

/**
 * Read a previously cached image, if there is one.
 *
 * @param {string} imageId
 * @returns {Promise<CachedImage|null>}
 */
export async function readCachedImage(imageId) {
  const dir = await getImageCacheDir();
  const { bytesPath, mimePath } = pathsFor(dir, imageId);
  try {
    const [buffer, mimeType] = await Promise.all([
      fs.promises.readFile(bytesPath),
      fs.promises.readFile(mimePath, 'utf8'),
    ]);
    return { buffer, mimeType: mimeType.trim() };
  } catch {
    // Missing (first request for this image) or partially written (a concurrent request lost the
    // race) - either way, the caller re-fetches and re-writes it.
    return null;
  }
}

/**
 * Persist a fetched (and possibly compressed) image to the cache.
 *
 * @param {string} imageId
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<void>}
 */
export async function writeCachedImage(imageId, buffer, mimeType) {
  const dir = await getImageCacheDir();
  const { bytesPath, mimePath } = pathsFor(dir, imageId);
  await Promise.all([fs.promises.writeFile(bytesPath, buffer), fs.promises.writeFile(mimePath, mimeType)]);
}

/**
 * Every cached image's bytes-file id and last-modified time, for the cleanup cron to judge age by.
 *
 * @returns {Promise<{imageId: string, mtimeMs: number}[]>}
 */
export async function listCachedImages() {
  const dir = await getImageCacheDir();
  const entries = await fs.promises.readdir(dir);
  const results = [];
  for (const entry of entries) {
    if (!entry.endsWith('.img')) continue;
    const imageId = entry.slice(0, -'.img'.length);
    try {
      const stat = await fs.promises.stat(path.join(dir, entry));
      results.push({ imageId, mtimeMs: stat.mtimeMs });
    } catch {
      // Removed between the readdir and the stat - nothing to report for it.
    }
  }
  return results;
}

/**
 * Remove one cached image's bytes and sidecar mime file. Never throws: a file already gone (a
 * concurrent cleanup run, a manual `rm`) is the outcome this function exists to reach anyway.
 *
 * @param {string} imageId
 * @returns {Promise<void>}
 */
export async function deleteCachedImage(imageId) {
  const dir = await getImageCacheDir();
  const { bytesPath, mimePath } = pathsFor(dir, imageId);
  await Promise.all([bytesPath, mimePath].map((file) => fs.promises.unlink(file).catch(() => {})));
}
