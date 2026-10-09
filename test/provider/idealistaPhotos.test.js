/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, afterEach } from 'vitest';
import { MAX_ADVERT_IMAGES, readAdvertImages } from '../../lib/services/idealista/search.js';
import * as provider from '../../lib/provider/idealista.js';

const photo = (n) => `https://img4.idealista.com/s/v1/photo${n}?Expires=1791648357&Signature=sig${n}&Key-Pair-Id=K1`;
const entry = (n) => ({ url: photo(n), tag: 'livingRoom', multimediaId: n });

describe('#idealista advert photos', () => {
  describe('readAdvertImages()', () => {
    it('reads the urls in the order the portal lists them', () => {
      const detail = { multimedia: { images: [entry(1), entry(2), entry(3)] } };
      expect(readAdvertImages(detail)).toEqual([photo(1), photo(2), photo(3)]);
    });

    it('keeps the first ten and drops the rest', () => {
      const detail = { multimedia: { images: Array.from({ length: 25 }, (_, i) => entry(i)) } };
      const images = readAdvertImages(detail);

      expect(MAX_ADVERT_IMAGES).toBe(10);
      expect(images).toEqual(Array.from({ length: 10 }, (_, i) => photo(i)));
    });

    it('keeps a photo listed twice once, and counts the cap after that', () => {
      const detail = {
        multimedia: { images: [entry(1), entry(1), ...Array.from({ length: 12 }, (_, i) => entry(i + 2))] },
      };
      const images = readAdvertImages(detail);

      expect(images).toHaveLength(10);
      expect(new Set(images).size).toBe(10);
    });

    it('drops entries that are not urls', () => {
      const detail = {
        multimedia: { images: [entry(1), { url: null }, { url: '/relative.jpg' }, {}, null, entry(2)] },
      };
      expect(readAdvertImages(detail)).toEqual([photo(1), photo(2)]);
    });

    it('answers nothing for an advert without photos or without a multimedia section', () => {
      expect(readAdvertImages({ multimedia: { images: [] } })).toEqual([]);
      expect(readAdvertImages({ multimedia: {} })).toEqual([]);
      expect(readAdvertImages({})).toEqual([]);
      expect(readAdvertImages(null)).toEqual([]);
    });
  });

  describe('fetchDetails()', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    /** Answers the token request, and the detail request with `answer` (or a failure). */
    const stubApi = (answer) => {
      globalThis.fetch = async (url) => {
        if (String(url).includes('/api/oauth/token')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'offline', expires_in: 3600 }) };
        }
        if (answer instanceof Error) throw answer;
        return { ok: true, status: 200, json: async () => answer };
      };
    };

    it('attaches the gallery and the date from the one detail answer', async () => {
      stubApi({
        modificationDate: { value: 1788453292000, text: 'x' },
        multimedia: { images: [entry(1), entry(2)] },
      });

      const listing = await provider.config.fetchDetails({
        link: 'https://www.idealista.com/en/inmueble/106998101/',
        image: 'https://img4.idealista.com/thumb',
      });

      expect(listing.images).toEqual([photo(1), photo(2)]);
      expect(listing.publishedAt).toBe(1788453292000);
      // The search card's thumbnail is left alone, as immoscout does.
      expect(listing.image).toBe('https://img4.idealista.com/thumb');
    });

    it('leaves images unset when the advert has none, so the single thumbnail still goes out', async () => {
      stubApi({ multimedia: { images: [] } });

      const listing = await provider.config.fetchDetails({ link: 'https://www.idealista.it/immobile/123456/' });

      expect(listing.images).toBeUndefined();
    });

    it('keeps the listing as it was when the detail cannot be read', async () => {
      stubApi(new Error('socket hang up'));

      const listing = await provider.config.fetchDetails({
        link: 'https://www.idealista.it/immobile/123456/',
        image: 'https://img4.idealista.it/thumb',
      });

      expect(listing.images).toBeUndefined();
      expect(listing.image).toBe('https://img4.idealista.it/thumb');
    });
  });
});
