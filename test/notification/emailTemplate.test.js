/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { getDirName } from '../../lib/utils.js';

const template = fs.readFileSync(path.resolve(getDirName() + '/notification/emailTemplate/template.hbs'), 'utf8');
const emailTemplate = Handlebars.compile(template);

/**
 * The template smtp.js/resend.js render into the actual email - the two adapters differ only in
 * how they call it, not in what it produces. `extraImages`/`hasImage` are the fields
 * `mapListings()` (duplicated identically in both) derives from a listing's `images` array.
 */
describe('email template - image gallery', () => {
  const render = (listing) => emailTemplate({ serviceName: 'svc', numberOfListings: 1, listings: [listing] });

  it('renders only the hero image for a listing with one photo', () => {
    const html = render({ title: 't', link: 'https://x', image: 'https://cdn.example.com/0.jpg', hasImage: true });

    expect(html).toContain('src="https://cdn.example.com/0.jpg"');
    expect(html).not.toContain('cdn.example.com/1.jpg');
  });

  it('renders a thumbnail row for every extra image', () => {
    const html = render({
      title: 't',
      link: 'https://x',
      image: 'https://cdn.example.com/0.jpg',
      extraImages: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
      hasImage: true,
    });

    expect(html).toContain('src="https://cdn.example.com/0.jpg"');
    expect(html).toContain('src="https://cdn.example.com/1.jpg"');
    expect(html).toContain('src="https://cdn.example.com/2.jpg"');
  });

  it('links every thumbnail back to the listing', () => {
    const html = render({
      title: 't',
      link: 'https://example.com/listing/1',
      image: 'https://cdn.example.com/0.jpg',
      extraImages: ['https://cdn.example.com/1.jpg'],
      hasImage: true,
    });

    const linkCount = html.split('href="https://example.com/listing/1"').length - 1;
    // Once for the hero image, once for the title, once for the thumbnail, once for "View Listing".
    expect(linkCount).toBeGreaterThanOrEqual(3);
  });

  it('renders no image markup at all for a listing with none', () => {
    const html = render({ title: 't', link: 'https://x', image: null, extraImages: [], hasImage: false });

    expect(html).not.toContain('<img');
  });

  it('renders no thumbnail row when there is exactly one image', () => {
    const html = render({
      title: 't',
      link: 'https://x',
      image: 'https://cdn.example.com/0.jpg',
      extraImages: [],
      hasImage: true,
    });

    // Exactly one <img> tag - the hero - no thumbnail row markup at all.
    expect(html.match(/<img/g)).toHaveLength(1);
  });
});
