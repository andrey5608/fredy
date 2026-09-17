/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn(async () => ({ ok: true }));
vi.mock('node-fetch', () => ({ default: (...args) => mockFetch(...args) }));

const { send } = await import('../../lib/notification/adapter/slack_with_webhooks.js');

const baseConfig = { id: 'slack_with_webhooks', fields: { webhookUrl: 'https://hooks.example.com/x' } };

/** Shares buildBlocks() with slack.js (see slackImages.test.js) - only the transport differs. */
describe('slack_with_webhooks adapter - image gallery', () => {
  beforeEach(() => mockFetch.mockClear());

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

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const imageBlocks = body.blocks.filter((b) => b.type === 'image');
    expect(imageBlocks.map((b) => b.image_url)).toEqual([
      'https://cdn.example.com/0.jpg',
      'https://cdn.example.com/1.jpg',
    ]);
  });
});
