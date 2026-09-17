import { describe, expect, it } from 'vitest';
import * as provider from '../../lib/provider/engelVoelkers.js';

/**
 * `normalize()`'s image handling, exercised directly against synthetic listings rather than the
 * live-site fixtures the rest of this provider's suite needs a real browser for - none of this
 * needs network access.
 */
describe('#engelVoelkers image gallery', () => {
  it('builds a url for every uploadCareImages entry, not just the first', () => {
    const listing = {
      id: '1',
      uploadCareImages: [{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }],
    };

    const normalized = provider.config.normalize(listing);
    expect(normalized.images).toEqual([
      'https://uploadcare.engelvoelkers.com/aaa/-/format/jpeg/-/resize/1080x/',
      'https://uploadcare.engelvoelkers.com/bbb/-/format/jpeg/-/resize/1080x/',
      'https://uploadcare.engelvoelkers.com/ccc/-/format/jpeg/-/resize/1080x/',
    ]);
    expect(normalized.image).toBe(normalized.images[0]);
  });

  it('falls back to uploadCareImageIds for a listing that only has the older shape', () => {
    const listing = { id: '1', uploadCareImageIds: ['xxx', 'yyy'] };

    const normalized = provider.config.normalize(listing);
    expect(normalized.images).toEqual([
      'https://uploadcare.engelvoelkers.com/xxx/-/format/jpeg/-/resize/1080x/',
      'https://uploadcare.engelvoelkers.com/yyy/-/format/jpeg/-/resize/1080x/',
    ]);
  });

  it('prefers uploadCareImages over uploadCareImageIds when both are present', () => {
    const listing = { id: '1', uploadCareImages: [{ id: 'aaa' }], uploadCareImageIds: ['xxx', 'yyy'] };

    expect(provider.config.normalize(listing).images).toEqual([
      'https://uploadcare.engelvoelkers.com/aaa/-/format/jpeg/-/resize/1080x/',
    ]);
  });

  it('skips a gallery entry with no id rather than building a broken url for it', () => {
    const listing = { id: '1', uploadCareImages: [{ id: 'aaa' }, {}, { id: 'ccc' }] };

    expect(provider.config.normalize(listing).images).toEqual([
      'https://uploadcare.engelvoelkers.com/aaa/-/format/jpeg/-/resize/1080x/',
      'https://uploadcare.engelvoelkers.com/ccc/-/format/jpeg/-/resize/1080x/',
    ]);
  });

  it('reports an empty gallery and no image for a listing with neither field', () => {
    const normalized = provider.config.normalize({ id: '1' });
    expect(normalized.images).toEqual([]);
    expect(normalized.image).toBeNull();
  });
});
