/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock external deps BEFORE importing the module under test.
vi.mock('node-fetch', () => ({ default: vi.fn() }));
// The adapter lets one call a second through per chat, which Telegram wants and no case here
// asserts. Left in, it costs this file a second per message sent.
vi.mock('p-throttle', () => ({ default: () => (fn) => fn }));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({
  getJob: (jobKey) => ({ id: jobKey, name: jobKey }),
}));
vi.mock('../../lib/services/markdown.js', () => ({
  readAdapterReadme: () => '',
}));
const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../lib/services/logger.js', () => ({ default: mockLogger }));

// Helpers to build mock fetch responses.
function jsonOk(body = { ok: true }) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function jsonErr(status, body) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  };
}

function imageOk(bytes = new Uint8Array([0xff, 0xd8, 0xff])) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h) => {
        const k = h.toLowerCase();
        if (k === 'content-type') return 'image/jpeg';
        if (k === 'content-length') return String(bytes.byteLength);
        return null;
      },
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// Globals are mocked too so buildPhotoFormData (which uses global fetch) can be
// intercepted by the same single mock.
let mockNodeFetch;
let mockGlobalFetch;
let send;

beforeEach(async () => {
  // Reset modules to get a fresh import with our mocks applied.
  vi.resetModules();
  const nodeFetchMod = await import('node-fetch');
  mockNodeFetch = nodeFetchMod.default;
  mockNodeFetch.mockReset();

  mockGlobalFetch = vi.fn();
  vi.stubGlobal('fetch', mockGlobalFetch);

  mockLogger.debug.mockClear();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();

  ({ send } = await import('../../lib/notification/adapter/telegram.js'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const baseConfig = {
  id: 'telegram',
  fields: { token: 'TKN', chatId: '999' },
};

describe('telegram send() - HTTP URL path (default for .jpg / .png)', () => {
  it('POSTs JSON to sendPhoto for a .jpg image URL', async () => {
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 'Listing',
          link: 'https://example.com/a',
          address: 'Addr',
          price: '500€',
          size: '50m²',
          image: 'https://mms.immowelt.de/x/y/z/w/abc.jpg?ci_seal=hash&w=525&h=394',
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockNodeFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTKN/sendPhoto');
    expect(opts.method).toBe('post');
    expect(opts.headers?.['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('999');
    expect(body.photo).toBe('https://mms.immowelt.de/x/y/z/w/abc.jpg?ci_seal=hash&w=525&h=394');
    expect(body.parse_mode).toBe('HTML');
  });

  it('does NOT pre-fetch the image when using HTTP URL path', async () => {
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'l',
          address: 'a',
          price: '',
          size: '',
          image: 'https://example.com/x.jpg',
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    // global fetch (used by buildPhotoFormData) must not be called
    expect(mockGlobalFetch).not.toHaveBeenCalled();
  });

  it('falls back to sendMessage when sendPhoto fails', async () => {
    mockNodeFetch
      .mockResolvedValueOnce(jsonErr(400, { ok: false, description: 'boom' }))
      .mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'l',
          address: 'a',
          price: '',
          size: '',
          image: 'https://example.com/x.jpg',
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(2);
    expect(mockNodeFetch.mock.calls[0][0]).toBe('https://api.telegram.org/botTKN/sendPhoto');
    expect(mockNodeFetch.mock.calls[1][0]).toBe('https://api.telegram.org/botTKN/sendMessage');
  });
});

describe('telegram send() - multipart path (.webp URLs)', () => {
  it('pre-fetches the image then POSTs FormData to sendPhoto for a .webp URL', async () => {
    // 1st: GET image via global fetch
    mockGlobalFetch.mockResolvedValueOnce(imageOk());
    // 2nd: POST sendPhoto via node-fetch
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 'Listing',
          link: 'https://example.com/a',
          address: 'Addr',
          price: '500€',
          size: '50m²',
          image: 'https://mms.immowelt.de/1/1/6/5/abc.webp?ci_seal=hash&w=525&h=394',
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    // image was fetched
    expect(mockGlobalFetch).toHaveBeenCalledTimes(1);
    expect(mockGlobalFetch.mock.calls[0][0]).toBe('https://mms.immowelt.de/1/1/6/5/abc.webp?ci_seal=hash&w=525&h=394');

    // sendPhoto called via node-fetch with FormData
    expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockNodeFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTKN/sendPhoto');
    expect(opts.method).toBe('post');
    expect(opts.body).toBeInstanceOf(FormData);
    // No explicit Content-Type header - fetch sets multipart boundary itself
    expect(opts.headers).toBeUndefined();
    expect(opts.body.get('chat_id')).toBe('999');
    expect(opts.body.get('parse_mode')).toBe('HTML');
    const photo = opts.body.get('photo');
    expect(photo).toBeTruthy();
    expect(photo.size).toBeGreaterThan(0);
  });

  it('falls back to sendMessage when the image pre-fetch fails for a .webp URL', async () => {
    // image fetch fails (404 from CDN)
    mockGlobalFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    // then sendMessage succeeds via node-fetch
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'l',
          address: 'a',
          price: '',
          size: '',
          image: 'https://example.com/gone.webp',
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    expect(mockNodeFetch.mock.calls[0][0]).toBe('https://api.telegram.org/botTKN/sendMessage');
  });

  it('falls back to sendMessage when multipart sendPhoto returns a Telegram error', async () => {
    mockGlobalFetch.mockResolvedValueOnce(imageOk());
    mockNodeFetch
      .mockResolvedValueOnce(jsonErr(400, { description: 'broke' })) // multipart sendPhoto
      .mockResolvedValueOnce(jsonOk()); // sendMessage fallback

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'l',
          address: 'a',
          price: '',
          size: '',
          image: 'https://example.com/x.webp',
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(2);
    expect(mockNodeFetch.mock.calls[1][0]).toBe('https://api.telegram.org/botTKN/sendMessage');
  });
});

describe('telegram send() - mixed batch (regression-safety)', () => {
  it('handles a batch with both .jpg and .webp - jpg uses URL, webp uses multipart', async () => {
    // .webp image fetch
    mockGlobalFetch.mockResolvedValueOnce(imageOk());
    // both sendPhoto calls succeed
    mockNodeFetch
      .mockResolvedValueOnce(jsonOk()) // could be either listing first
      .mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'jpg-listing',
          title: 'a',
          link: 'l',
          address: 'a',
          price: '',
          size: '',
          image: 'https://example.com/a.jpg',
        },
        {
          id: 'webp-listing',
          title: 'b',
          link: 'l',
          address: 'a',
          price: '',
          size: '',
          image: 'https://example.com/b.webp',
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockGlobalFetch).toHaveBeenCalledTimes(1); // only webp pre-fetches
    expect(mockNodeFetch).toHaveBeenCalledTimes(2);

    // Verify one call had FormData and one had JSON body
    const bodies = mockNodeFetch.mock.calls.map((c) => c[1].body);
    const hasFormData = bodies.some((b) => b instanceof FormData);
    const hasJson = bodies.some((b) => typeof b === 'string' && b.startsWith('{'));
    expect(hasFormData).toBe(true);
    expect(hasJson).toBe(true);
  });

  it('uses sendMessage (not sendPhoto) when image is null', async () => {
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [
        {
          id: 'a',
          title: 't',
          link: 'l',
          address: 'a',
          price: '',
          size: '',
          image: null,
        },
      ],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    expect(mockNodeFetch.mock.calls[0][0]).toBe('https://api.telegram.org/botTKN/sendMessage');
    expect(mockGlobalFetch).not.toHaveBeenCalled();
  });
});

describe('telegram send() - multi-image albums (sendMediaGroup)', () => {
  const images = ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'];
  const listingWith = (imgs) => ({
    id: 'a',
    title: 't',
    link: 'l',
    address: 'a',
    price: '',
    size: '',
    image: imgs[0],
    images: imgs,
  });

  it('sends a sendMediaGroup album when a listing has more than one image', async () => {
    mockGlobalFetch.mockResolvedValue(imageOk());
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [listingWith(images)],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockGlobalFetch).toHaveBeenCalledTimes(3);
    expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockNodeFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTKN/sendMediaGroup');
    expect(opts.body).toBeInstanceOf(FormData);
    const media = JSON.parse(opts.body.get('media'));
    expect(media).toHaveLength(3);
    expect(media.every((item) => item.media.startsWith('attach://'))).toBe(true);
    // Telegram shows one caption per album; only the first item carries it.
    expect(media[0].caption).toBeTruthy();
    expect(media[1].caption).toBeUndefined();
    expect(media[2].caption).toBeUndefined();
  });

  it('truncates a gallery bigger than 10 photos to a single album instead of splitting it', async () => {
    // A second sendMediaGroup call cannot carry its own caption (Telegram allows exactly one per
    // album), so it used to arrive as a bare, uncaptioned photo dump with nothing tying it back to
    // the listing - truncating to one album keeps every message identifiable instead.
    const manyImages = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.jpg`);
    mockGlobalFetch.mockResolvedValue(imageOk());
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [listingWith(manyImages)],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    expect(mockNodeFetch.mock.calls[0][0]).toBe('https://api.telegram.org/botTKN/sendMediaGroup');
    const group = JSON.parse(mockNodeFetch.mock.calls[0][1].body.get('media'));
    expect(group).toHaveLength(10);
    expect(group[0].caption).toBeTruthy();
  });

  it('falls back to sendMessage when every sendMediaGroup attempt fails', async () => {
    mockGlobalFetch.mockResolvedValue(imageOk());
    mockNodeFetch.mockResolvedValueOnce(jsonErr(400, { description: 'group failed' })).mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [listingWith(images)],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(2);
    expect(mockNodeFetch.mock.calls[1][0]).toBe('https://api.telegram.org/botTKN/sendMessage');
  });

  it('falls back to a plain url for one image that fails to fetch, without dropping it or failing the album', async () => {
    mockGlobalFetch
      .mockResolvedValueOnce(imageOk())
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce(imageOk());
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [listingWith(images)],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    const media = JSON.parse(mockNodeFetch.mock.calls[0][1].body.get('media'));
    expect(media).toHaveLength(3);
    expect(media[0].media.startsWith('attach://')).toBe(true);
    expect(media[1].media).toBe(images[1]);
    expect(media[2].media.startsWith('attach://')).toBe(true);
  });
});

describe('telegram send() - 429 rate limiting', () => {
  const singleImageListing = {
    id: 'a',
    title: 't',
    link: 'l',
    address: 'a',
    price: '',
    size: '',
    image: 'https://example.com/1.jpg',
  };

  function rateLimited(retryAfterSeconds) {
    return jsonErr(429, {
      ok: false,
      error_code: 429,
      description: `Too Many Requests: retry after ${retryAfterSeconds}`,
      parameters: { retry_after: retryAfterSeconds },
    });
  }

  it('waits out the retry_after Telegram reports, then retries the same call instead of falling back', async () => {
    mockGlobalFetch.mockResolvedValue(imageOk());
    mockNodeFetch.mockResolvedValueOnce(rateLimited(1)).mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [singleImageListing],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    // Both calls are the original sendPhoto endpoint - no fallback to sendMessage was needed.
    expect(mockNodeFetch).toHaveBeenCalledTimes(2);
    expect(mockNodeFetch.mock.calls[0][0]).toBe('https://api.telegram.org/botTKN/sendPhoto');
    expect(mockNodeFetch.mock.calls[1][0]).toBe('https://api.telegram.org/botTKN/sendPhoto');
  }, 10000);

  it('pauses every queued send for the chat while one is waiting out a 429, not just the one that got rate-limited', async () => {
    mockGlobalFetch.mockResolvedValue(imageOk());
    // First listing's sendPhoto gets rate-limited; the second listing's sendPhoto (queued right
    // behind it by p-throttle) must not fire until the cooldown from the first has elapsed.
    mockNodeFetch.mockResolvedValueOnce(rateLimited(1)).mockResolvedValueOnce(jsonOk()).mockResolvedValueOnce(jsonOk());

    const secondListing = { ...singleImageListing, id: 'b', image: 'https://example.com/2.jpg' };
    const startedAt = Date.now();
    await send({
      serviceName: 'immowelt',
      newListings: [singleImageListing, secondListing],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(3);
    // The retry (2000ms cooldown) must have elapsed before the whole batch could finish.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
  }, 10000);

  it('gives up and falls back to sendMessage when retry_after is not present', async () => {
    mockGlobalFetch.mockResolvedValue(imageOk());
    mockNodeFetch
      .mockResolvedValueOnce(jsonErr(429, { ok: false, error_code: 429, description: 'Too Many Requests' }))
      .mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [singleImageListing],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(2);
    expect(mockNodeFetch.mock.calls[1][0]).toBe('https://api.telegram.org/botTKN/sendMessage');
  });
});

describe('telegram send() - multiple chat IDs', () => {
  const listing = {
    id: '1',
    title: 'Flat',
    link: 'https://ex.com',
    address: 'Berlin',
    price: '800',
    size: '50',
    image: 'https://ex.com/img.jpg',
  };

  it('sends to every chat ID in a comma-separated list', async () => {
    mockNodeFetch.mockResolvedValue(jsonOk());

    await send({
      serviceName: 'immoscout',
      newListings: [listing],
      notificationConfig: [{ id: 'telegram', fields: { token: 'TKN', chatId: '111, 222' } }],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(2);
    const bodies = mockNodeFetch.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.chat_id)).toEqual(expect.arrayContaining(['111', '222']));
  });

  it('trims whitespace around each chat ID', async () => {
    mockNodeFetch.mockResolvedValue(jsonOk());

    await send({
      serviceName: 'immoscout',
      newListings: [listing],
      notificationConfig: [{ id: 'telegram', fields: { token: 'TKN', chatId: '  333 , 444  ' } }],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(2);
    const bodies = mockNodeFetch.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.chat_id)).toEqual(expect.arrayContaining(['333', '444']));
  });

  it('sends each listing to each chat ID (N listings × M chats)', async () => {
    mockNodeFetch.mockResolvedValue(jsonOk());

    await send({
      serviceName: 'immoscout',
      newListings: [listing, { ...listing, id: '2' }],
      notificationConfig: [{ id: 'telegram', fields: { token: 'TKN', chatId: '555, 666' } }],
      jobKey: 'Berlin',
    });

    expect(mockNodeFetch).toHaveBeenCalledTimes(4);
  });
});

describe('telegram send() - message format', () => {
  // No `image`, so send() takes the plain sendMessage path and the whole body is easy to inspect
  // in one place, in `text` rather than split across a `caption` plus a photo/media-group call.
  async function sentText(listingOverrides) {
    mockNodeFetch.mockResolvedValueOnce(jsonOk());
    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 'Nice flat', link: 'https://example.com/a', ...listingOverrides }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });
    return JSON.parse(mockNodeFetch.mock.calls[0][1].body).text;
  }

  it('splits a comma address into District/Street, shows an estimated Warm price next to Cold, and drops the unit from Rooms', async () => {
    const text = await sentText({
      address: 'Britzer Damm 111, 12439 Neukölln, Berlin',
      price: '400 €',
      size: '65 m²',
      rooms: '2.5 rooms',
    });

    expect(text).toContain("<a href='https://example.com/a'><b>Nice flat</b></a>");
    expect(text).toContain('District: 12439 Neukölln, Berlin');
    expect(text).toContain('Street: Britzer Damm 111');
    // 25% Nebenkosten surcharge on the cold rent - see DEFAULT_NEBENKOSTEN_PCT.
    expect(text).toContain('Warm price: ~500 €');
    expect(text).toContain('Cold price: 400 €');
    expect(text).toContain('Sqm: 65 m²');
    expect(text).toContain('Rooms: 2.5');
    expect(text).not.toContain('Rooms: 2.5 rooms');
  });

  it('falls back to District-only when the address has no comma, and shows no Street line', async () => {
    const text = await sentText({ address: 'Berlin-Spandau' });

    expect(text).toContain('District: Berlin-Spandau');
    expect(text).not.toContain('Street:');
  });

  it('omits every field the listing has no value for', async () => {
    const text = await sentText({ address: null, price: null, size: null, rooms: null });

    expect(text).not.toContain('District:');
    expect(text).not.toContain('Street:');
    expect(text).not.toContain('Warm price:');
    expect(text).not.toContain('Cold price:');
    expect(text).not.toContain('Sqm:');
    expect(text).not.toContain('Rooms:');
  });

  it('puts the Fredy link on its own line after a blank line, once baseUrl is known', async () => {
    mockNodeFetch.mockResolvedValueOnce(jsonOk());
    await send({
      serviceName: 'immowelt',
      newListings: [{ id: 'a', title: 'Nice flat', link: 'https://example.com/a' }],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
      baseUrl: 'https://fredy.example.com',
    });
    const text = JSON.parse(mockNodeFetch.mock.calls[0][1].body).text;

    expect(text).toContain("\n\n<a href='https://fredy.example.com/#/listings/listing/a'>Open in Fredy</a>");
  });
});

describe('telegram send() - container log visibility', () => {
  const listing = {
    id: 'a',
    title: 't',
    link: 'l',
    address: 'a',
    price: '',
    size: '',
    image: 'https://example.com/x.jpg',
  };

  it('logs a dispatch summary and a per-send confirmation at "info", not "debug"', async () => {
    // 'debug' is dropped in production (see logger.js), which is exactly the container Fredy ships
    // in - a successful send that only logged at 'debug' would never reach `docker logs`.
    mockNodeFetch.mockResolvedValueOnce(jsonOk());

    await send({
      serviceName: 'immowelt',
      newListings: [listing],
      notificationConfig: [baseConfig],
      jobKey: 'Berlin',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('dispatching 1 new listing(s)'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("sent listing 'a' to chat 999"));
  });
});

describe('telegram send() - config validation', () => {
  it('throws when telegram adapter config is missing', () => {
    expect(() =>
      send({
        serviceName: 's',
        newListings: [],
        notificationConfig: [],
        jobKey: 'k',
      }),
    ).toThrow(/configuration missing/);
  });

  it('throws when token or chatId is missing', () => {
    expect(() =>
      send({
        serviceName: 's',
        newListings: [],
        notificationConfig: [{ id: 'telegram', fields: { token: '' } }],
        jobKey: 'k',
      }),
    ).toThrow(/token.*chatId/);
  });
});

describe('telegram send() - custom API url', () => {
  const listing = {
    id: '1',
    title: 'Flat',
    link: 'https://ex.com',
    address: 'Berlin',
    price: '800',
    size: '50',
    image: null,
  };

  async function sendWith(apiUrl) {
    mockNodeFetch.mockResolvedValue(jsonOk());
    await send({
      serviceName: 'immoscout',
      newListings: [listing],
      notificationConfig: [{ id: 'telegram', fields: { token: 'TKN', chatId: '999', apiUrl } }],
      jobKey: 'Berlin',
    });
    return mockNodeFetch.mock.calls[0][0];
  }

  it('uses a configured relay url', async () => {
    expect(await sendWith('https://relay.example.com')).toBe('https://relay.example.com/botTKN/sendMessage');
  });

  it('strips trailing slashes from the relay url', async () => {
    expect(await sendWith('https://relay.example.com//')).toBe('https://relay.example.com/botTKN/sendMessage');
  });

  it('accepts a relay url with a path prefix', async () => {
    expect(await sendWith('https://relay.example.com/tg')).toBe('https://relay.example.com/tg/botTKN/sendMessage');
  });

  it.each([undefined, null, '', '   ', 'not a url', 'ftp://relay.example.com', 42])(
    'falls back to the official API for %p',
    async (apiUrl) => {
      expect(await sendWith(apiUrl)).toBe('https://api.telegram.org/botTKN/sendMessage');
    },
  );
});
