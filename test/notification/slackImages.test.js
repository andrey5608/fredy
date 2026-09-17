/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const postMessage = vi.fn(async () => ({ ok: true }));
vi.mock('slack', () => ({ default: { chat: { postMessage } } }));

const { send } = await import('../../lib/notification/adapter/slack.js');

const baseConfig = { id: 'slack', fields: { token: 't', channel: 'c' } };

describe('slack adapter - image gallery', () => {
  beforeEach(() => postMessage.mockClear());

  it('adds an image block for every image, not just the first', async () => {
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

    expect(postMessage).toHaveBeenCalledTimes(1);
    const { blocks } = postMessage.mock.calls[0][0];
    const imageBlocks = blocks.filter((b) => b.type === 'image');
    expect(imageBlocks.map((b) => b.image_url)).toEqual([
      'https://cdn.example.com/0.jpg',
      'https://cdn.example.com/1.jpg',
    ]);
  });

  it('falls back to the single image for a listing outside the multi-image set', async () => {
    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 't', link: 'https://x', image: 'https://cdn.example.com/only.jpg' }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const { blocks } = postMessage.mock.calls[0][0];
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(1);
  });

  it('caps the gallery well under the Block Kit limit', async () => {
    const images = Array.from({ length: 15 }, (_, i) => `https://cdn.example.com/${i}.jpg`);

    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 't', link: 'https://x', image: images[0], images }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const { blocks } = postMessage.mock.calls[0][0];
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(10);
  });
});
