/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.fn(async () => ({}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

const { send } = await import('../../lib/notification/adapter/smtp.js');

const baseConfig = {
  id: 'smtp',
  fields: { host: 'h', port: '587', secure: 'false', username: 'u', password: 'p', receiver: 'a@b.com', from: 'f' },
};

/**
 * mapListings() (duplicated identically in resend.js) is what turns a listing's `images` into the
 * hero/thumbnail-row shape the shared template.hbs renders - see emailTemplate.test.js for the
 * template side of this. This only pins that smtp.js actually calls it and passes the html on.
 */
describe('smtp adapter - image gallery', () => {
  beforeEach(() => sendMail.mockClear());

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

    expect(sendMail).toHaveBeenCalledTimes(1);
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('cdn.example.com/0.jpg');
    expect(html).toContain('cdn.example.com/1.jpg');
  });

  it('falls back to the single image_url for a listing outside the multi-image set', async () => {
    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 't', link: 'https://x', image: 'https://cdn.example.com/only.jpg' }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('cdn.example.com/only.jpg');
    expect(html.match(/<img/g)).toHaveLength(1);
  });
});
