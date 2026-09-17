/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { normalizeImageUrls } from '../../lib/utils.js';

describe('normalizeImageUrls', () => {
  it('normalizes every url in the list', () => {
    expect(
      normalizeImageUrls([
        'https://mms.immowelt.de/a.jpg/format/webp',
        'https://example.com/b.jpg>',
        'https://example.com/c.jpg?x=1',
      ]),
    ).toEqual(['https://mms.immowelt.de/a.jpg', 'https://example.com/b.jpg', 'https://example.com/c.jpg?x=1']);
  });

  it('drops entries that normalizeImageUrl rejects', () => {
    expect(normalizeImageUrls(['https://example.com/a.jpg', 'http://example.com/b.jpg', null, '', 42])).toEqual([
      'https://example.com/a.jpg',
    ]);
  });

  it('removes duplicates that survive normalization', () => {
    expect(normalizeImageUrls(['https://example.com/a.jpg', 'https://example.com/a.jpg>'])).toEqual([
      'https://example.com/a.jpg',
    ]);
  });

  it('returns an empty array for anything that is not an array', () => {
    expect(normalizeImageUrls(null)).toEqual([]);
    expect(normalizeImageUrls(undefined)).toEqual([]);
    expect(normalizeImageUrls('https://example.com/a.jpg')).toEqual([]);
  });

  it('returns an empty array for an empty list', () => {
    expect(normalizeImageUrls([])).toEqual([]);
  });
});
