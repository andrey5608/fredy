import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  getImageById: vi.fn(),
  userCanAccessListing: vi.fn(),
}));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));
vi.mock('../../lib/services/images/imageCache.js', () => ({
  readCachedImage: vi.fn(),
  writeCachedImage: vi.fn(),
}));
vi.mock('../../lib/services/images/imageProcessor.js', () => ({
  compressImageIfNeeded: vi.fn(async (buffer, { originalMimeType } = {}) => ({
    buffer,
    mimeType: originalMimeType ?? 'application/octet-stream',
    compressed: false,
  })),
}));
vi.mock('../../lib/services/listings/listingPictures.js', () => ({ fetchListingPicture: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));

import { getImageById, userCanAccessListing } from '../../lib/services/storage/listingsStorage.js';
import { readCachedImage, writeCachedImage } from '../../lib/services/images/imageCache.js';
import { compressImageIfNeeded } from '../../lib/services/images/imageProcessor.js';
import { fetchListingPicture } from '../../lib/services/listings/listingPictures.js';
import imagesPlugin from '../../lib/api/routes/imagesRouter.js';

describe('imagesRouter', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.decorateRequest('session', null);
    app.addHook('onRequest', (request, _reply, done) => {
      request.session = { currentUser: 'user-1' };
      done();
    });
    await app.register(imagesPlugin);
    await app.ready();
  });

  const get = (imageId) => app.inject({ method: 'GET', url: `/${imageId}` });

  it('refuses an image id that does not exist', async () => {
    getImageById.mockReturnValue(null);

    const res = await get('missing');

    expect(res.statusCode).toBe(403);
    expect(userCanAccessListing).not.toHaveBeenCalled();
  });

  it('refuses an image whose listing the requester cannot see', async () => {
    getImageById.mockReturnValue({ id: 'img-1', listing_id: 'listing-1', url: 'https://cdn.example.com/1.jpg' });
    userCanAccessListing.mockReturnValue(false);

    const res = await get('img-1');

    expect(res.statusCode).toBe(403);
  });

  it('serves a cached image without touching the network', async () => {
    getImageById.mockReturnValue({ id: 'img-1', listing_id: 'listing-1', url: 'https://cdn.example.com/1.jpg' });
    userCanAccessListing.mockReturnValue(true);
    readCachedImage.mockResolvedValue({ buffer: Buffer.from('cached bytes'), mimeType: 'image/jpeg' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await get('img-1');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body).toBe('cached bytes');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fetches, compresses and caches an image on a cache miss', async () => {
    getImageById.mockReturnValue({ id: 'img-1', listing_id: 'listing-1', url: 'https://cdn.example.com/1.jpg' });
    userCanAccessListing.mockReturnValue(true);
    readCachedImage.mockResolvedValue(null);
    fetchListingPicture.mockResolvedValue({
      buffer: Buffer.from('origin bytes'),
      mimeType: 'image/png',
      url: 'https://cdn.example.com/1.jpg',
    });

    const res = await get('img-1');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toBe('origin bytes');
    expect(fetchListingPicture).toHaveBeenCalledWith('https://cdn.example.com/1.jpg');
    expect(compressImageIfNeeded).toHaveBeenCalled();
    expect(writeCachedImage).toHaveBeenCalledWith('img-1', expect.any(Buffer), 'image/png');
  });

  it('never fetches a scraped url with a bare fetch, only through the guarded picture fetcher', async () => {
    getImageById.mockReturnValue({ id: 'img-1', listing_id: 'listing-1', url: 'http://169.254.169.254/latest' });
    userCanAccessListing.mockReturnValue(true);
    readCachedImage.mockResolvedValue(null);
    fetchListingPicture.mockRejectedValue(new Error('Refusing to fetch this image: not a public address'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await get('img-1');

    expect(res.statusCode).toBe(502);
    expect(fetchListingPicture).toHaveBeenCalledWith('http://169.254.169.254/latest');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns 502 when the origin fetch fails', async () => {
    getImageById.mockReturnValue({ id: 'img-1', listing_id: 'listing-1', url: 'https://cdn.example.com/1.jpg' });
    userCanAccessListing.mockReturnValue(true);
    readCachedImage.mockResolvedValue(null);
    fetchListingPicture.mockRejectedValue(new Error('network down'));

    const res = await get('img-1');

    expect(res.statusCode).toBe(502);
    expect(writeCachedImage).not.toHaveBeenCalled();
  });

  it('returns 502 when the origin responds with an error status', async () => {
    getImageById.mockReturnValue({ id: 'img-1', listing_id: 'listing-1', url: 'https://cdn.example.com/1.jpg' });
    userCanAccessListing.mockReturnValue(true);
    readCachedImage.mockResolvedValue(null);
    fetchListingPicture.mockRejectedValue(
      new Error('Image fetch returned HTTP 404. Image URL: https://cdn.example.com/1.jpg'),
    );

    const res = await get('img-1');

    expect(res.statusCode).toBe(502);
  });

  it('still serves the freshly fetched image even when writing it to the cache fails', async () => {
    getImageById.mockReturnValue({ id: 'img-1', listing_id: 'listing-1', url: 'https://cdn.example.com/1.jpg' });
    userCanAccessListing.mockReturnValue(true);
    readCachedImage.mockResolvedValue(null);
    writeCachedImage.mockRejectedValue(new Error('disk full'));
    fetchListingPicture.mockResolvedValue({
      buffer: Buffer.from('origin bytes'),
      mimeType: 'image/jpeg',
      url: 'https://cdn.example.com/1.jpg',
    });

    const res = await get('img-1');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('origin bytes');
  });
});
