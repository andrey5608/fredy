/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { normalizeLinkLanguage, withLinkLanguage } from '../../lib/services/idealista/portal.js';
import * as provider from '../../lib/provider/idealista.js';

const ADVERT = 'https://www.idealista.com/inmueble/106998101/';

/** An advert as the api answers with it. */
const apiAdvert = { propertyCode: '106998101', url: ADVERT, price: 1200, address: 'Piso en Calle de Toledo, Madrid' };

describe('#idealista link language', () => {
  describe('withLinkLanguage()', () => {
    it('puts the language in front of the path', () => {
      expect(withLinkLanguage(ADVERT, 'ru')).toBe('https://www.idealista.com/ru/inmueble/106998101/');
    });

    it('replaces a language the link already carries instead of doubling it', () => {
      expect(withLinkLanguage('https://www.idealista.com/en/inmueble/106998101/', 'ru')).toBe(
        'https://www.idealista.com/ru/inmueble/106998101/',
      );
    });

    it('works on the other two sites and keeps the trailing slash as it was', () => {
      expect(withLinkLanguage('https://www.idealista.it/immobile/5/', 'en')).toBe(
        'https://www.idealista.it/en/immobile/5/',
      );
      expect(withLinkLanguage('https://www.idealista.pt/imovel/7', 'en')).toBe('https://www.idealista.pt/en/imovel/7');
    });

    it('leaves the link alone when no language is asked for', () => {
      expect(withLinkLanguage(ADVERT, null)).toBe(ADVERT);
    });

    it('never turns a missing or foreign link into a different one', () => {
      expect(withLinkLanguage(null, 'en')).toBeNull();
      expect(withLinkLanguage(undefined, 'en')).toBeUndefined();
      expect(withLinkLanguage('https://example.com/inmueble/1/', 'en')).toBe('https://example.com/inmueble/1/');
    });
  });

  describe('normalizeLinkLanguage()', () => {
    it('defaults to en for an entry that never stored the setting', () => {
      expect(normalizeLinkLanguage(undefined)).toBe('en');
      expect(normalizeLinkLanguage(null)).toBe('en');
    });

    it('accepts a two-letter code in any case', () => {
      expect(normalizeLinkLanguage('RU')).toBe('ru');
    });

    it('reads anything else, such as the form’s "original", as keep the link untouched', () => {
      expect(normalizeLinkLanguage('original')).toBeNull();
      expect(normalizeLinkLanguage('')).toBeNull();
    });
  });

  describe('createConfig()', () => {
    const linkFor = (sourceConfig) =>
      provider
        .createConfig({ url: 'https://www.idealista.com/alquiler-viviendas/madrid-madrid/', ...sourceConfig }, [])
        .normalize(apiAdvert).link;

    it('writes links in English by default', () => {
      expect(linkFor({})).toBe('https://www.idealista.com/en/inmueble/106998101/');
    });

    it('uses the language the job chose', () => {
      expect(linkFor({ linkLanguage: 'ru' })).toBe('https://www.idealista.com/ru/inmueble/106998101/');
    });

    it('keeps the portal’s own link when the job chose the original', () => {
      expect(linkFor({ linkLanguage: 'original' })).toBe(ADVERT);
    });

    it('does not change the advert id, so switching language never makes a listing look new', () => {
      const idFor = (linkLanguage) => provider.createConfig({ url: ADVERT, linkLanguage }, []).normalize(apiAdvert).id;
      expect(idFor('ru')).toBe(idFor('original'));
    });

    it('leaves the static template untouched, because two jobs can run at once', () => {
      linkFor({ linkLanguage: 'ru' });
      expect(provider.config.normalize(apiAdvert).link).toBe(ADVERT);
    });
  });
});
