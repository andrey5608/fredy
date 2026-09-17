/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { compressImageIfNeeded } from '../../services/images/imageProcessor.js';

/**
 * Helpers for sending photos to Telegram via `multipart/form-data` instead of
 * the HTTP-URL path. Used when the URL is one that Telegram's URL-fetcher will
 * reject - notably `.webp` images from Cloudimage (mms.immowelt.de), which
 * Telegram refuses with "Bad Request: failed to get HTTP URL content" - and
 * for every image in a `sendMediaGroup` call, so each one gets a chance at
 * compression rather than only the single-photo path.
 *
 * The HTTP-URL path is faster and is still the default for a single photo in
 * telegram.js; this module is the fallback for URLs whose extension makes
 * Telegram fail, and the only path for multi-image albums.
 */

/** Telegram's sendPhoto/sendMediaGroup limit when uploading bytes via multipart/form-data. */
const TELEGRAM_MULTIPART_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Sanity ceiling on what is even worth downloading before trying to compress it. Well above
 * {@link TELEGRAM_MULTIPART_MAX_BYTES} - a real photo that big still has a real chance of
 * compressing down to fit - this only exists to stop an absurd advertised size (a
 * misconfigured CDN, a non-image response) from being pulled into memory at all.
 */
const MAX_FETCH_BYTES = 20 * 1024 * 1024;

/** Accept header used when re-fetching the image ourselves.
 *  Deliberately excludes `image/webp` so CDNs that content-negotiate
 *  (like Cloudimage on mms.immowelt.de) transcode WEBP to JPEG. */
const NON_WEBP_ACCEPT = 'image/jpeg,image/png,image/*;q=0.8';

/**
 * Returns true if the URL's path ends in a `.webp` extension. Such URLs need
 * multipart upload because Telegram identifies media types from the URL path
 * and rejects `.webp` in sendPhoto via HTTP URL.
 *
 * Conservative: returns false for null/empty/non-string input, malformed URLs,
 * and non-https schemes.
 *
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function shouldUseMultipart(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return /\.webp$/i.test(parsed.pathname);
}

/**
 * Fetch one image and compress it down to fit Telegram's multipart limit if needed.
 *
 * Rejects only on an advertised size absurd enough that downloading it is not worth attempting
 * ({@link MAX_FETCH_BYTES}) - anything up to Telegram's own 10 MB ceiling and beyond is downloaded
 * and handed to {@link compressImageIfNeeded}, which usually gets a real photo well under it.
 *
 * Still throws if, after compression, the result is over Telegram's limit - `compressImageIfNeeded`
 * degrades to its smallest attempt rather than failing, but bytes it could not decode at all (a
 * non-image response, a corrupt file) come back unchanged, and an unchanged multi-megabyte blob is
 * exactly the case this exists to catch before it reaches the API.
 *
 * @param {string} imageUrl
 * @returns {Promise<Buffer>} JPEG bytes, ready to attach.
 */
async function fetchAndCompressPhoto(imageUrl) {
  const res = await fetch(imageUrl, {
    method: 'GET',
    headers: { Accept: NON_WEBP_ACCEPT },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch image for multipart upload (${res.status}): ${imageUrl}`);
  }

  const advertised = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_FETCH_BYTES) {
    throw new Error(`Image is too large to even attempt (advertised ${advertised} bytes): ${imageUrl}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // Telegram identifies the media type from the filename extension, and every caller here always
  // uploads as .jpg - the Accept header above forces JPEG bytes from CDNs that honor it, and
  // compressImageIfNeeded re-encodes to JPEG whenever it actually compresses, so `originalMimeType`
  // is only what a below-budget image keeps.
  const { buffer } = await compressImageIfNeeded(buf, { originalMimeType: 'image/jpeg' });

  if (buffer.byteLength > TELEGRAM_MULTIPART_MAX_BYTES) {
    throw new Error(
      `Image exceeds Telegram's multipart size limit even after compression (${buffer.byteLength} bytes, max ${TELEGRAM_MULTIPART_MAX_BYTES}): ${imageUrl}`,
    );
  }
  return buffer;
}

/**
 * Fetch an image from `imageUrl`, compress it if needed, and build a `FormData` body suitable for
 * POSTing to `https://api.telegram.org/bot<token>/sendPhoto`.
 *
 * Throws if the image fetch fails, the result is still oversized after compression, or the URL is
 * unreachable. The caller is responsible for catching and falling back.
 *
 * @param {Object} args
 * @param {string|number} args.chatId
 * @param {string} args.imageUrl
 * @param {string} args.caption
 * @param {string} [args.parseMode]      - Telegram parse_mode, e.g. 'HTML'.
 * @param {number} [args.messageThreadId] - Telegram supergroup topic id.
 * @returns {Promise<FormData>}
 */
export async function buildPhotoFormData({ chatId, imageUrl, caption, parseMode, messageThreadId }) {
  const buffer = await fetchAndCompressPhoto(imageUrl);
  const blob = new Blob([buffer], { type: 'image/jpeg' });

  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('caption', caption);
  if (parseMode) fd.append('parse_mode', parseMode);
  if (messageThreadId != null) fd.append('message_thread_id', String(messageThreadId));
  fd.append('photo', blob, 'photo.jpg');
  return fd;
}

/**
 * Build a `FormData` body for `sendMediaGroup`, one photo per `imageUrls` entry (Telegram accepts
 * 2-10; chunking a longer gallery into several requests is the caller's job, matching how
 * `sendMediaGroup` itself has no notion of "more than 10").
 *
 * Every image is fetched and compressed here rather than only the ones that need it - unlike the
 * single-photo path, which only falls back to multipart for a URL Telegram's own fetcher would
 * reject, sending an album is the one channel this feature's compression work exists for, so it is
 * applied uniformly.
 *
 * A confirmed-safe fallback for one image that could not be fetched or compressed: since Telegram
 * accepts a `sendMediaGroup` mixing `attach://` and plain-URL media items in the same request, that
 * one entry is sent as its own URL instead of dropping it from the album, rather than failing the
 * whole group over a single bad photo.
 *
 * @param {Object} args
 * @param {string|number} args.chatId
 * @param {string[]} args.imageUrls
 * @param {string} [args.caption] Applied to the first item only - Telegram renders one caption per
 *   album regardless of which item it is attached to.
 * @param {string} [args.parseMode]
 * @param {number} [args.messageThreadId]
 * @returns {Promise<FormData>}
 */
export async function buildMediaGroupFormData({ chatId, imageUrls, caption, parseMode, messageThreadId }) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (messageThreadId != null) fd.append('message_thread_id', String(messageThreadId));

  const media = [];
  for (let index = 0; index < imageUrls.length; index++) {
    const imageUrl = imageUrls[index];
    const item = { type: 'photo' };
    try {
      const buffer = await fetchAndCompressPhoto(imageUrl);
      const fieldName = `photo${index}`;
      fd.append(fieldName, new Blob([buffer], { type: 'image/jpeg' }), `${fieldName}.jpg`);
      item.media = `attach://${fieldName}`;
    } catch {
      // Confirmed safe against the real Bot API: a plain-URL item alongside attach:// ones in the
      // same request still delivers. Uncompressed, but still in the album, rather than missing.
      item.media = imageUrl;
    }
    if (index === 0) {
      if (caption) item.caption = caption;
      if (parseMode) item.parse_mode = parseMode;
    }
    media.push(item);
  }

  fd.append('media', JSON.stringify(media));
  return fd;
}
