/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import sharp from 'sharp';
import { compressImageIfNeeded } from '../../../lib/services/images/imageProcessor.js';

vi.mock('../../../lib/services/logger.js', () => ({ default: { warn: vi.fn() } }));

/**
 * A real, sizeable JPEG - random noise compresses far worse than a photo, which is exactly what
 * is needed here to reliably land well over any of the small `maxBytes` budgets these tests use
 * without depending on real-world default sizes.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Buffer>}
 */
async function noisyJpeg(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/**
 * A smooth gradient, unlike {@link noisyJpeg}: JPEG compresses it the way it compresses an actual
 * photograph, so a byte budget a resize-plus-quality pass could plausibly reach is reachable here
 * too - noise, whose entropy the codec cannot reduce much at any quality, is only useful for
 * proving the "never fits" degrade path.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Buffer>}
 */
async function gradientJpeg(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = Math.floor((x / width) * 255);
      raw[i + 1] = Math.floor((y / height) * 255);
      raw[i + 2] = Math.floor(((x + y) / (width + height)) * 255);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe('compressImageIfNeeded', () => {
  /** @type {Buffer} */
  let bigImage;
  /** @type {Buffer} */
  let bigGradientImage;

  beforeAll(async () => {
    bigImage = await noisyJpeg(1200, 900);
    expect(bigImage.length).toBeGreaterThan(200_000);

    bigGradientImage = await gradientJpeg(1200, 900);
    expect(bigGradientImage.length).toBeGreaterThan(50_000);
  });

  it('returns a small image untouched rather than re-encoding it for no gain', async () => {
    const small = await noisyJpeg(20, 20);
    const result = await compressImageIfNeeded(small, { maxBytes: small.length + 1000 });

    expect(result).toEqual({ buffer: small, mimeType: 'application/octet-stream', compressed: false });
  });

  it('compresses an oversized image down to fit the budget', async () => {
    const result = await compressImageIfNeeded(bigGradientImage, { maxBytes: 50_000, maxDimension: 800 });

    expect(result.compressed).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer.length).toBeLessThanOrEqual(50_000);
  });

  it('resizes the longer side down to maxDimension', async () => {
    const result = await compressImageIfNeeded(bigGradientImage, { maxBytes: 50_000, maxDimension: 400 });
    const metadata = await sharp(result.buffer).metadata();

    expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(400);
  });

  it('never upscales an image that is already smaller than maxDimension', async () => {
    const small = await noisyJpeg(100, 80);
    // Force compression despite the image being tiny, to exercise the resize step in isolation.
    const result = await compressImageIfNeeded(small, { maxBytes: 1, maxDimension: 2000 });
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(80);
  });

  it('degrades to the smallest attempt rather than throwing when nothing fits the budget', async () => {
    const result = await compressImageIfNeeded(bigImage, { maxBytes: 1, maxDimension: 800 });

    expect(result.compressed).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('falls back to the original bytes when the input cannot be decoded as an image', async () => {
    const garbage = Buffer.alloc(2000, 'not an image');
    const result = await compressImageIfNeeded(garbage, { maxBytes: 100, originalMimeType: 'image/png' });

    expect(result).toEqual({ buffer: garbage, mimeType: 'image/png', compressed: false });
  });

  it('passes non-buffer input through unchanged', async () => {
    expect(await compressImageIfNeeded(null)).toEqual({
      buffer: null,
      mimeType: 'application/octet-stream',
      compressed: false,
    });
    expect(await compressImageIfNeeded(undefined)).toEqual({
      buffer: undefined,
      mimeType: 'application/octet-stream',
      compressed: false,
    });
  });

  it('passes an empty buffer through unchanged', async () => {
    const empty = Buffer.alloc(0);
    expect(await compressImageIfNeeded(empty, { maxBytes: 10 })).toEqual({
      buffer: empty,
      mimeType: 'application/octet-stream',
      compressed: false,
    });
  });
});
