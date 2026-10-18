/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { createHash } from 'crypto';

/** Between the listing id and the url hash. Not a character a listing id (a nanoid) can contain. */
const SEPARATOR = '~';

/**
 * The id the image proxy (`imagesRouter.js`) and its disk cache know one picture of a listing by.
 *
 * Derived rather than stored: a listing's pictures live as one deflated list in `listing_media`, so
 * there is no row to hand out an id. The listing id comes first so the proxy can find the gallery
 * without a lookup table, and the hash of the url keeps the id stable when the gallery is
 * reordered or grows - which an index into it would not.
 *
 * @param {string} listingId
 * @param {string} url
 * @returns {string}
 */
export function imageIdFor(listingId, url) {
  return `${listingId}${SEPARATOR}${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
}

/**
 * @param {string} imageId
 * @returns {string|null} the listing the id belongs to, or null for anything not built by {@link imageIdFor}
 */
export function listingIdOf(imageId) {
  const at = typeof imageId === 'string' ? imageId.lastIndexOf(SEPARATOR) : -1;
  return at > 0 ? imageId.slice(0, at) : null;
}
