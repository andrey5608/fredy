/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sgSend = vi.fn(async () => ({}));
vi.mock('@sendgrid/mail', () => ({ default: { setApiKey: vi.fn(), send: sgSend } }));

const { send } = await import('../../lib/notification/adapter/sendGrid.js');

const baseConfig = {
  id: 'sendgrid',
  fields: { apiKey: 'k', receiver: 'a@b.com', from: 'f', templateId: 'tmpl-1' },
};

/**
 * Unlike smtp/resend, SendGrid renders an operator-authored template hosted on SendGrid's own
 * side - there is no markup here to check, only that the `images` data an operator's template
 * could loop over actually reaches dynamic_template_data.
 */
describe('sendGrid adapter - image gallery data', () => {
  beforeEach(() => sgSend.mockClear());

  it('exposes every image, not just the first, to the dynamic template data', async () => {
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

    expect(sgSend).toHaveBeenCalledTimes(1);
    const [listing] = sgSend.mock.calls[0][0].dynamic_template_data.listings;
    expect(listing.image).toBe('https://cdn.example.com/0.jpg');
    expect(listing.images).toEqual(['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg']);
    expect(listing.hasImage).toBe(true);
  });

  it('falls back to the single image_url for a listing outside the multi-image set', async () => {
    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 't', link: 'https://x', image: 'https://cdn.example.com/only.jpg' }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const [listing] = sgSend.mock.calls[0][0].dynamic_template_data.listings;
    expect(listing.images).toEqual(['https://cdn.example.com/only.jpg']);
  });
});
