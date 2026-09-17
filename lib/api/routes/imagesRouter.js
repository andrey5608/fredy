/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getImageById, userCanAccessListing } from '../../services/storage/listingsStorage.js';
import { isAdmin as isAdminFn } from '../security.js';
import { readCachedImage, writeCachedImage } from '../../services/images/imageCache.js';
import { compressImageIfNeeded } from '../../services/images/imageProcessor.js';
import logger from '../../services/logger.js';

/**
 * Deliberately identical for "no such image" and "the image belongs to a listing you cannot see",
 * for the same reason listingsRouter.js's NO_ACCESS_MESSAGE is: the response must not be usable to
 * probe which ids exist.
 * @type {string}
 */
const NO_ACCESS_MESSAGE = 'You are trying to access an image that is not associated to your user';

/**
 * How long a browser may cache a served image without asking again.
 *
 * `immutable` is honest here in a way it would not be for the origin CDN url: the bytes behind one
 * `imageId` never change once cached (a portal editing its own listing does not rewrite the row
 * Fredy already stored), so a client that already has a copy never needs to revalidate it.
 * @type {string}
 */
const CACHE_CONTROL = 'public, max-age=604800, immutable';

/**
 * Fetch and cache one listing's image, proxying it rather than the frontend hotlinking the
 * portal's own CDN.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function imagesPlugin(fastify) {
  fastify.get('/:imageId', async (request, reply) => {
    const { imageId } = request.params;
    const userId = request.session.currentUser;

    const image = getImageById(imageId);
    if (image == null || !userCanAccessListing(image.listing_id, userId, isAdminFn(request))) {
      return reply.code(403).send({ message: NO_ACCESS_MESSAGE });
    }

    const cached = await readCachedImage(imageId);
    if (cached != null) {
      reply.header('Cache-Control', CACHE_CONTROL);
      return reply.type(cached.mimeType).send(cached.buffer);
    }

    let response;
    try {
      response = await fetch(image.url, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      logger.warn(`Failed to fetch image '${imageId}' from its origin.`, error?.message || error);
      return reply.code(502).send({ message: 'Failed to fetch the image' });
    }
    if (!response.ok) {
      logger.warn(`Origin refused image '${imageId}' with status ${response.status}.`);
      return reply.code(502).send({ message: 'Failed to fetch the image' });
    }

    const originalMimeType = response.headers.get('content-type') || 'application/octet-stream';
    const original = Buffer.from(await response.arrayBuffer());
    const { buffer, mimeType } = await compressImageIfNeeded(original, { originalMimeType });

    try {
      await writeCachedImage(imageId, buffer, mimeType);
    } catch (error) {
      // Serving from memory still works even if the disk write failed (out of space, permissions);
      // the next request just pays the fetch again rather than getting an error for a cache miss.
      logger.warn(`Failed to write image '${imageId}' to the cache.`, error?.message || error);
    }

    reply.header('Cache-Control', CACHE_CONTROL);
    return reply.type(mimeType).send(buffer);
  });
}
