/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const emailsSend = vi.fn(async () => ({ error: null }));
vi.mock('resend', () => ({
  Resend: class Resend {
    emails = { send: emailsSend };
  },
}));

const { send } = await import('../../lib/notification/adapter/resend.js');

const baseConfig = { id: 'resend', fields: { apiKey: 'k', receiver: 'a@b.com', from: 'f' } };

/** Same shared template as smtp.js (see emailTemplate.test.js and smtpImages.test.js). */
describe('resend adapter - image gallery', () => {
  beforeEach(() => emailsSend.mockClear());

  it('renders every image as a gallery, not just the first', async () => {
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

    expect(emailsSend).toHaveBeenCalledTimes(1);
    const { html } = emailsSend.mock.calls[0][0];
    expect(html).toContain('cdn.example.com/0.jpg');
    expect(html).toContain('cdn.example.com/1.jpg');
  });
});
