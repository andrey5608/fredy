import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../lib/utils.js', () => ({
  updateConfigOnDisk: vi.fn(),
  isValidTimeZone: vi.fn(() => true),
}));
vi.mock('../../lib/services/storage/userStorage.js', () => ({ ensureDemoUserExists: vi.fn() }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(() => ({})),
  getPublicSettings: vi.fn(() => ({})),
  upsertSettings: vi.fn(),
}));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => true) }));
vi.mock('../../lib/api/proxyAuth.js', () => ({
  PROXY_AUTH_SETTINGS: [],
  prepareProxyAuthSettings: vi.fn(() => null),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/connectivity/connectivityService.js', () => ({
  normalizeSourceSwitches: vi.fn((value) => value),
}));
vi.mock('../../lib/services/connectivity/sources.js', () => ({ SOURCE_IDS: [] }));

import generalSettingsPlugin from '../../lib/api/routes/generalSettingsRoute.js';
import { upsertSettings } from '../../lib/services/storage/settingsStorage.js';

/**
 * `maxImagesPerListing`/`imageCacheRetentionDays` are the two settings the multi-image-listings
 * feature added to this route (docs/plans/listing-images-gallery-and-notifications.md). This suite
 * covers only their validation - the route's other settings had no test coverage before this
 * feature and backfilling all of it is a separate concern.
 */
describe('generalSettingsRoute image settings', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(generalSettingsPlugin);
    await app.ready();
  });

  const post = (body) => app.inject({ method: 'POST', url: '/', payload: body });

  it('accepts and stores values inside the allowed range', async () => {
    const res = await post({ maxImagesPerListing: 10, imageCacheRetentionDays: 30 });

    expect(res.statusCode).toBe(200);
    expect(upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({ maxImagesPerListing: 10, imageCacheRetentionDays: 30 }),
    );
  });

  it('accepts zero for both, which means "store none" / "never purge"', async () => {
    const res = await post({ maxImagesPerListing: 0, imageCacheRetentionDays: 0 });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a negative maxImagesPerListing', async () => {
    const res = await post({ maxImagesPerListing: -1 });
    expect(res.statusCode).toBe(400);
    expect(upsertSettings).not.toHaveBeenCalled();
  });

  it('rejects a maxImagesPerListing above the ceiling', async () => {
    const res = await post({ maxImagesPerListing: 51 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-integer imageCacheRetentionDays', async () => {
    const res = await post({ imageCacheRetentionDays: 1.5 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty string rather than coercing it to zero', async () => {
    const res = await post({ maxImagesPerListing: '' });
    expect(res.statusCode).toBe(400);
  });

  it('leaves both settings untouched when neither is present in the request', async () => {
    const res = await post({ port: '9998' });
    expect(res.statusCode).toBe(200);
    const [payload] = upsertSettings.mock.calls[0];
    expect(payload).not.toHaveProperty('maxImagesPerListing');
    expect(payload).not.toHaveProperty('imageCacheRetentionDays');
  });
});
