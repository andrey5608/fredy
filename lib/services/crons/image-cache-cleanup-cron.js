/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import cron from 'node-cron';
import { listCachedImages, deleteCachedImage } from '../images/imageCache.js';
import { getSettings } from '../storage/settingsStorage.js';
import logger from '../logger.js';

/**
 * Once a day at 03:45 - 15 minutes after the listing retention purge (`listing-retention-cron.js`),
 * so a listing's cascade-deleted `listing_images` rows and its now-orphaned cache files are cleaned
 * up in the same overnight window rather than on two unrelated schedules.
 * @type {string}
 */
const IMAGE_CACHE_CLEANUP_CRON = '45 3 * * *';

/**
 * Default retention used when the setting is missing (fresh install before the migration seeded
 * it, or a value that was deleted by hand).
 * @type {number}
 */
const DEFAULT_RETENTION_DAYS = 60;

/**
 * Delete every cached image older than the configured retention period.
 *
 * Age-based only, by design (docs/plans/listing-images-gallery-and-notifications.md §4.1) - a file
 * does not need its listing to still exist to be purged, and does not need to be purged just
 * because its listing was deleted, either. `0` disables the purge and keeps cached images
 * indefinitely.
 *
 * Reads `imageCacheRetentionDays` on every run rather than once at startup, so a change in the
 * settings UI takes effect on the next run instead of after a restart.
 *
 * Never throws: a failed sweep costs some stale files until tomorrow, which must not take a
 * scheduled task down with it.
 *
 * @returns {Promise<number>} How many cached images were removed.
 */
export async function runImageCacheCleanup() {
  try {
    const settings = await getSettings();
    const configured = Number(settings?.imageCacheRetentionDays ?? DEFAULT_RETENTION_DAYS);
    const retentionDays = Number.isFinite(configured) ? Math.floor(configured) : DEFAULT_RETENTION_DAYS;

    if (retentionDays <= 0) {
      logger.debug('Image cache retention is disabled. Keeping cached images forever.');
      return 0;
    }

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cached = await listCachedImages();
    const expired = cached.filter((entry) => entry.mtimeMs < cutoff);

    for (const entry of expired) {
      await deleteCachedImage(entry.imageId);
    }

    if (expired.length > 0) {
      logger.info(`Purged ${expired.length} cached image(s) older than ${retentionDays} day(s).`);
    } else {
      logger.debug('No cached images past their retention period.');
    }
    return expired.length;
  } catch (err) {
    logger.warn('Image cache cleanup failed', err);
    return 0;
  }
}

/**
 * Schedule the daily image cache cleanup.
 *
 * Runs once on start as well, for the same reason the listing retention purge does: an instance
 * down for a week comes back to cached images whose grace period expired while it was away.
 *
 * @returns {Promise<void>}
 */
export async function initImageCacheCleanupCron() {
  await runImageCacheCleanup();
  cron.schedule(IMAGE_CACHE_CLEANUP_CRON, runImageCacheCleanup);
}
