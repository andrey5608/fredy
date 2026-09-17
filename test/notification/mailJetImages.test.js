/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const request = vi.fn(async () => ({}));
const mockFetch = vi.fn();
vi.mock('node-mailjet', () => ({
  default: { apiConnect: () => ({ post: () => ({ request }) }) },
}));
vi.mock('node-fetch', () => ({ default: (...args) => mockFetch(...args) }));
vi.mock('../../lib/services/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));

const { send } = await import('../../lib/notification/adapter/mailJet.js');

const baseConfig = {
  id: 'mailjet',
  fields: { apiPublicKey: 'pub', apiPrivateKey: 'priv', receiver: 'a@b.com', from: 'f' },
};

/** A tiny valid JPEG, decodable but under the 1 MB compression budget. */
async function smallJpeg() {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
}

/** Same ripple technique as telegramPhotoUploader.test.js - real, decodable, and over 1 MB. */
async function bigDecodableJpeg() {
  const width = 2000;
  const height = 1500;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (Math.sin(x / 7) * 127 + 128 + (x / width) * 50) % 256;
      raw[i + 1] = (Math.cos(y / 9) * 127 + 128 + (y / height) * 50) % 256;
      raw[i + 2] = (x + y) % 256;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe('mailJet adapter - image gallery', () => {
  beforeEach(() => {
    request.mockClear();
    mockFetch.mockReset();
  });

  const imageResponse = (buffer) => ({
    ok: true,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  });

  it('inlines every image as its own CID attachment', async () => {
    const jpeg = await smallJpeg();
    mockFetch.mockResolvedValue(imageResponse(jpeg));

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'https://x',
          image: 'https://cdn.example.com/0.jpg',
          images: ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg'],
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(request).toHaveBeenCalledTimes(1);
    const [message] = request.mock.calls[0][0].Messages;
    expect(message.InlinedAttachments).toHaveLength(2);
    expect(message.InlinedAttachments.map((a) => a.ContentID)).toEqual(['listing-0-0', 'listing-0-1']);
    expect(message.HTMLPart).toContain('cid:listing-0-0');
    expect(message.HTMLPart).toContain('cid:listing-0-1');
  });

  it('caps a gallery at 3 images, fetching no more than that', async () => {
    const jpeg = await smallJpeg();
    mockFetch.mockResolvedValue(imageResponse(jpeg));
    const images = Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/${i}.jpg`);

    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 't', link: 'https://x', image: images[0], images }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [message] = request.mock.calls[0][0].Messages;
    expect(message.InlinedAttachments).toHaveLength(3);
  });

  it('falls back to the single image_url for a listing outside the multi-image set', async () => {
    const jpeg = await smallJpeg();
    mockFetch.mockResolvedValue(imageResponse(jpeg));

    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 't', link: 'https://x', image: 'https://cdn.example.com/only.jpg' }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const [message] = request.mock.calls[0][0].Messages;
    expect(message.InlinedAttachments).toHaveLength(1);
  });

  it('compresses a real oversized image instead of inlining it at full size', async () => {
    const big = await bigDecodableJpeg();
    mockFetch.mockResolvedValue(imageResponse(big));

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'https://x',
          image: 'https://cdn.example.com/big.jpg',
          images: ['https://cdn.example.com/big.jpg'],
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const [message] = request.mock.calls[0][0].Messages;
    const inlined = Buffer.from(message.InlinedAttachments[0].Base64Content, 'base64');
    expect(inlined.length).toBeLessThan(big.length);
  });

  it('skips one image that fails to fetch without failing the others', async () => {
    const jpeg = await smallJpeg();
    mockFetch
      .mockResolvedValueOnce(imageResponse(jpeg))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(imageResponse(jpeg));

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'https://x',
          image: 'https://cdn.example.com/0.jpg',
          images: [
            'https://cdn.example.com/0.jpg',
            'https://cdn.example.com/gone.jpg',
            'https://cdn.example.com/2.jpg',
          ],
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const [message] = request.mock.calls[0][0].Messages;
    expect(message.InlinedAttachments).toHaveLength(2);
    // The middle image (index 1) failed to fetch - the surviving two keep their own array
    // position in the CID rather than being renumbered.
    expect(message.InlinedAttachments.map((a) => a.ContentID)).toEqual(['listing-0-0', 'listing-0-2']);
  });
});
