/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../../lib/services/extractor/puppeteerExtractor.js', () => ({ default: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import puppeteerExtractor from '../../lib/services/extractor/puppeteerExtractor.js';
import { config as immoscoutConfig } from '../../lib/provider/immoscout.js';
import { config as kleinanzeigenConfig } from '../../lib/provider/kleinanzeigen.js';

/**
 * Regression tests for https://github.com/orangecoding/fredy/issues/380 - rooms and living space
 * showed up as "N/A" although the listing carried both.
 *
 * These read the checked-in fixtures directly instead of going through the offline test mode, so
 * they never touch the network in either test mode.
 */
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../testFixtures');

const readFixture = async (name) => readFile(path.join(FIXTURES_DIR, name), 'utf-8');

const SEARCH_URL = 'https://api.mobile.immobilienscout24.de/search/list?searchType=region';

let immoscoutList;
let immoscoutDetail;

beforeEach(async () => {
  immoscoutList = JSON.parse(await readFixture('immoscout_list.json'));
  immoscoutDetail = JSON.parse(await readFixture('immoscout_detail.json'));

  vi.stubGlobal('fetch', async (url) => {
    const body = String(url).includes('/expose/') ? immoscoutDetail : immoscoutList;
    return { ok: true, status: 200, json: async () => body };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('immoscout rooms and size', () => {
  it('reads the room count the search list carries', async () => {
    const listings = await immoscoutConfig.getListings(SEARCH_URL);
    const normalized = listings.map((listing) => immoscoutConfig.normalize(listing));

    // The mobile API hands the figures over unlabelled; reading them by position dropped the room
    // count entirely, which is what the bug report saw as "N/A" on every single listing.
    expect(normalized.every((listing) => typeof listing.rooms === 'number')).toBe(true);
    expect(normalized[0]).toMatchObject({ price: 2300, size: 131, rooms: 2 });
  });

  it('identifies the figures by their unit, not by their position', async () => {
    // A listing without a room count - a plot, for instance - used to shift `size` into `price`.
    immoscoutList.resultListItems = [
      {
        type: 'EXPOSE_RESULT',
        item: {
          id: '1',
          title: 'Grundstück',
          attributes: [
            { label: '', value: '450.000 €' },
            { label: '', value: '820 m²' },
          ],
        },
      },
    ];

    const [listing] = await immoscoutConfig.getListings(SEARCH_URL);

    expect(immoscoutConfig.normalize(listing)).toMatchObject({ price: 450000, size: 820, rooms: null });
  });

  it('fills a missing room count from the exposé', async () => {
    const enriched = await immoscoutConfig.fetchDetails({
      link: 'https://www.immobilienscout24.de/expose/168963883',
      rooms: null,
      size: null,
    });

    expect(enriched.rooms).toBe(2);
    // The exposé is the more precise source: "131,37 m²" against the list's rounded "131 m²".
    expect(enriched.size).toBe(131.37);
  });

  it('keeps the figures the search list already provided', async () => {
    const enriched = await immoscoutConfig.fetchDetails({
      link: 'https://www.immobilienscout24.de/expose/168963883',
      rooms: 3,
      size: 99,
    });

    expect(enriched).toMatchObject({ rooms: 3, size: 99 });
  });
});

describe('immoscout images', () => {
  it('reads every gallery image off the exposé, not just the search card thumbnail', async () => {
    const enriched = await immoscoutConfig.fetchDetails({
      link: 'https://www.immobilienscout24.de/expose/168963883',
      image: 'https://pictures.immobilienscout24.de/search-card-thumbnail.jpg',
    });

    expect(enriched.images.length).toBeGreaterThan(1);
    expect(enriched.images.every((url) => typeof url === 'string' && url.length > 0)).toBe(true);
    // Left untouched: it is the search card's own titlePicture, set by normalize() before
    // fetchDetails ever runs, not something this step is meant to overwrite.
    expect(enriched.image).toBe('https://pictures.immobilienscout24.de/search-card-thumbnail.jpg');
  });

  it('finds the gallery by section type rather than assuming it is sections[0]', async () => {
    const reordered = structuredClone(immoscoutDetail);
    reordered.sections = [...reordered.sections].reverse();
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => reordered }));

    const enriched = await immoscoutConfig.fetchDetails({ link: 'https://www.immobilienscout24.de/expose/1' });

    expect(enriched.images.length).toBeGreaterThan(1);
  });

  it('reports an empty gallery rather than throwing when the exposé has no MEDIA section', async () => {
    const withoutMedia = structuredClone(immoscoutDetail);
    withoutMedia.sections = withoutMedia.sections.filter((section) => section.type !== 'MEDIA');
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => withoutMedia }));

    const enriched = await immoscoutConfig.fetchDetails({ link: 'https://www.immobilienscout24.de/expose/1' });

    expect(enriched.images).toEqual([]);
  });
});

describe('kleinanzeigen rooms and size', () => {
  const listingWithoutFigures = {
    id: 'abc',
    link: '/s-anzeige/vollmoeblierte-2-zimmer-premium-wohnung/3466126848-203-2462',
    size: null,
    rooms: null,
  };

  beforeEach(async () => {
    puppeteerExtractor.mockResolvedValue(await readFixture('kleinanzeigen_detail.html'));
  });

  it('still reads the figures off the search result tags', () => {
    const normalized = kleinanzeigenConfig.normalize({
      id: '1',
      title: 'Wohnung',
      price: '1.200 €',
      tags: '82,17 m² · 2 Zi.',
    });

    expect(normalized).toMatchObject({ size: 82.17, rooms: 2 });
  });

  it('copes with a tag line whose separator did not survive extraction', () => {
    // `<span>89 m²</span><span>2 Zi.</span>` collapses to this; splitting on the middle dot used to
    // report the living space as the room count.
    const normalized = kleinanzeigenConfig.normalize({
      id: '1',
      title: 'Wohnung',
      price: '1.200 €',
      tags: '89 m²2 Zi.',
    });

    expect(normalized).toMatchObject({ size: 89, rooms: 2 });
  });

  it('reports nothing when the search result has no tags', () => {
    const normalized = kleinanzeigenConfig.normalize({ id: '1', title: 'Wohnung', price: '1.200 €', tags: '' });

    expect(normalized).toMatchObject({ size: null, rooms: null });
  });

  it('falls back to the detail page when the search result had no tags', async () => {
    const enriched = await kleinanzeigenConfig.fetchDetails(listingWithoutFigures, null);

    expect(enriched).toMatchObject({ size: 40, rooms: 2 });
  });

  it('keeps the figures the search result already provided', async () => {
    const enriched = await kleinanzeigenConfig.fetchDetails({ ...listingWithoutFigures, size: 55, rooms: 1 }, null);

    expect(enriched).toMatchObject({ size: 55, rooms: 1 });
  });

  it('extracts the multi-line description with preserved newlines', async () => {
    const enriched = await kleinanzeigenConfig.fetchDetails(listingWithoutFigures, null);

    expect(enriched.description).toContain('\n');
    expect(enriched.description).toMatch(/renovierungsbedarf\.\nAusstattung:/);
  });

  it('leaves the figures alone when the detail page cannot be loaded', async () => {
    puppeteerExtractor.mockResolvedValue(null);

    const enriched = await kleinanzeigenConfig.fetchDetails(listingWithoutFigures, null);

    expect(enriched).toMatchObject({ size: null, rooms: null });
  });
});

describe('kleinanzeigen images', () => {
  beforeEach(async () => {
    puppeteerExtractor.mockResolvedValue(await readFixture('kleinanzeigen_detail.html'));
  });

  it('reads every gallery image off the detail page, not just the search card thumbnail', async () => {
    const enriched = await kleinanzeigenConfig.fetchDetails(
      { id: 'abc', link: '/s-anzeige/x/1', image: 'https://img.kleinanzeigen.de/search-card-thumbnail.jpg' },
      null,
    );

    expect(enriched.images.length).toBeGreaterThan(1);
    expect(enriched.images.every((url) => url.startsWith('https://img.kleinanzeigen.de/'))).toBe(true);
    // Not the lightbox's own thumbnail strip - that one repeats the same photos as a fixed count
    // per gallery image, so the two lists happening to be equal length would be the fixture lying.
    expect(new Set(enriched.images).size).toBe(enriched.images.length);
  });

  it('falls back to the search card thumbnail when the detail page has no gallery markup', async () => {
    puppeteerExtractor.mockResolvedValue('<html><body>no gallery here</body></html>');

    const enriched = await kleinanzeigenConfig.fetchDetails(
      { id: 'abc', link: '/s-anzeige/x/1', image: 'https://img.kleinanzeigen.de/only-thumbnail.jpg' },
      null,
    );

    expect(enriched.images).toEqual(['https://img.kleinanzeigen.de/only-thumbnail.jpg']);
  });

  it('reports an empty gallery when neither the detail page nor the search card has an image', async () => {
    puppeteerExtractor.mockResolvedValue('<html><body>no gallery here</body></html>');

    const enriched = await kleinanzeigenConfig.fetchDetails({ id: 'abc', link: '/s-anzeige/x/1' }, null);

    expect(enriched.images).toEqual([]);
  });

  it('leaves images empty when the detail page cannot be loaded at all', async () => {
    puppeteerExtractor.mockResolvedValue(null);

    const enriched = await kleinanzeigenConfig.fetchDetails({ id: 'abc', link: '/s-anzeige/x/1' }, null);

    expect(enriched.images).toBeUndefined();
  });
});
