/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import sharp from 'sharp';
import logger from '../logger.js';

/**
 * Default byte budget a compressed image is asked to fit under. Hardcoded for this first
 * iteration rather than an admin setting - see
 * docs/plans/listing-images-gallery-and-notifications.md §6a for the follow-up to make it
 * configurable if the default ever needs tuning.
 * @type {number}
 */
export const DEFAULT_MAX_BYTES = 1_000_000;

/**
 * Default ceiling on the longer side, in pixels, an oversized image is resized to before
 * recompression. Never upscales a smaller image.
 * @type {number}
 */
export const DEFAULT_MAX_DIMENSION = 1600;

/**
 * JPEG quality steps tried in order until the result fits {@link DEFAULT_MAX_BYTES}.
 * @type {number[]}
 */
export const QUALITY_STEPS = [82, 70, 55];

/**
 * @typedef {Object} CompressedImage
 * @property {Buffer} buffer The image bytes to use - the original when nothing needed to change.
 * @property {string} mimeType `image/jpeg` when compressed, otherwise whatever the caller passed in.
 * @property {boolean} compressed Whether the bytes were actually re-encoded.
 */

/**
 * Resize and re-encode an image only when it is larger than the byte budget.
 *
 * Nothing here caches or stores anything - callers that want that (the image proxy's on-disk
 * cache, notably) do it themselves with the result. An image already under `maxBytes` is returned
 * untouched, not just under-budget-so-skip-compressing: re-encoding a JPEG that already fits would
 * only cost quality for no size gained.
 *
 * Degrades rather than fails: if even the lowest quality step is still over budget, the smallest
 * attempt made is returned anyway rather than either the oversized original or an error. A caller
 * whose channel has a hard ceiling (Telegram's multipart limit, an email provider's attachment
 * cap) is expected to make its own call about whether "still too big" is acceptable to send.
 *
 * @param {Buffer} buffer Raw image bytes.
 * @param {Object} [options]
 * @param {number} [options.maxBytes] Byte budget to try to fit under.
 * @param {number} [options.maxDimension] Longer-side ceiling, in pixels, for the resize.
 * @param {string} [options.originalMimeType] Mime type to report back when nothing was recompressed.
 * @returns {Promise<CompressedImage>}
 */
export async function compressImageIfNeeded(
  buffer,
  {
    maxBytes = DEFAULT_MAX_BYTES,
    maxDimension = DEFAULT_MAX_DIMENSION,
    originalMimeType = 'application/octet-stream',
  } = {},
) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length <= maxBytes) {
    return { buffer, mimeType: originalMimeType, compressed: false };
  }

  try {
    // `rotate()` with no argument bakes in the EXIF orientation rather than relying on whatever
    // reads the output next to honour the tag - some notification channels do not.
    const pipeline = sharp(buffer)
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true });

    /** @type {Buffer|null} The smallest candidate seen so far, in case none reaches the budget. */
    let smallest = null;
    for (const quality of QUALITY_STEPS) {
      const candidate = await pipeline.clone().jpeg({ quality }).toBuffer();
      if (smallest == null || candidate.length < smallest.length) {
        smallest = candidate;
      }
      if (candidate.length <= maxBytes) {
        return { buffer: candidate, mimeType: 'image/jpeg', compressed: true };
      }
    }
    return { buffer: smallest, mimeType: 'image/jpeg', compressed: true };
  } catch (error) {
    logger.warn(
      `Failed to compress a ${buffer.length}-byte image; sending the original instead.`,
      error?.message || error,
    );
    return { buffer, mimeType: originalMimeType, compressed: false };
  }
}
