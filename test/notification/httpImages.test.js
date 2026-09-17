/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { send } from '../../lib/notification/adapter/http.js';

const baseConfig = { id: 'http', fields: { endpointUrl: 'https://example.com/webhook' } };

describe('http adapter - image gallery', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true })),
    ),
  );

  it('passes every image through as imageUrls, alongside the existing imageUrl', async () => {
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

    const [, options] = global.fetch.mock.calls[0];
    const { listings } = JSON.parse(options.body);
    expect(listings[0].imageUrl).toBe('https://cdn.example.com/0.jpg');
    expect(listings[0].imageUrls).toEqual(['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg']);
  });

  it('falls back to the single image for a listing outside the multi-image set', async () => {
    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 't', link: 'https://x', image: 'https://cdn.example.com/only.jpg' }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const [, options] = global.fetch.mock.calls[0];
    const { listings } = JSON.parse(options.body);
    expect(listings[0].imageUrls).toEqual(['https://cdn.example.com/only.jpg']);
  });
});
