/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const root = (await import('node:path')).resolve('.');
const imageCachePath = root + '/lib/services/images/imageCache.js';
const settingsStoragePath = root + '/lib/services/storage/settingsStorage.js';
const loggerPath = root + '/lib/services/logger.js';

let state;

async function loadCron() {
  vi.resetModules();
  vi.doMock(imageCachePath, () => ({
    listCachedImages: async () => state.cached,
    deleteCachedImage: async (imageId) => {
      state.deleted.push(imageId);
      if (state.throwOnDelete) throw new Error('permission denied');
    },
  }));
  vi.doMock(settingsStoragePath, () => ({
    getSettings: async () => state.settings,
  }));
  vi.doMock(loggerPath, () => ({
    default: {
      debug: (...args) => state.logs.debug.push(args.join(' ')),
      info: (...args) => state.logs.info.push(args.join(' ')),
      warn: (...args) => state.logs.warn.push(args.join(' ')),
      error: () => {},
    },
  }));
  vi.doMock('node-cron', () => ({
    default: { schedule: (expression, handler) => state.scheduled.push({ expression, handler }) },
  }));
  return import(root + '/lib/services/crons/image-cache-cleanup-cron.js');
}

const NOW = Date.parse('2026-06-15T00:00:00Z');
const daysAgo = (days) => NOW - days * 24 * 60 * 60 * 1000;

/**
 * Mirrors test/services/crons/listing-retention-cron.test.js: this is the same shape of cron
 * (irreversible delete, driven by a settings-table retention period, run once on start and daily
 * after), just for cached image files instead of listing rows.
 */
describe('services/crons/image-cache-cleanup-cron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    state = {
      scheduled: [],
      deleted: [],
      throwOnDelete: false,
      cached: [],
      settings: { imageCacheRetentionDays: 60 },
      logs: { debug: [], info: [], warn: [] },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules the cleanup once a day', async () => {
    const { initImageCacheCleanupCron } = await loadCron();

    await initImageCacheCleanupCron();

    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0].expression).toBe('45 3 * * *');
  });

  it('deletes every cached image older than the retention period', async () => {
    state.cached = [
      { imageId: 'old', mtimeMs: daysAgo(90) },
      { imageId: 'fresh', mtimeMs: daysAgo(10) },
    ];
    const { runImageCacheCleanup } = await loadCron();

    expect(await runImageCacheCleanup()).toBe(1);
    expect(state.deleted).toEqual(['old']);
  });

  it('deletes nothing when retention is set to zero', async () => {
    state.settings = { imageCacheRetentionDays: 0 };
    state.cached = [{ imageId: 'ancient', mtimeMs: daysAgo(9999) }];
    const { runImageCacheCleanup } = await loadCron();

    expect(await runImageCacheCleanup()).toBe(0);
    expect(state.deleted).toEqual([]);
  });

  it('falls back to the default when the setting is missing', async () => {
    state.settings = {};
    state.cached = [{ imageId: 'old', mtimeMs: daysAgo(61) }];
    const { runImageCacheCleanup } = await loadCron();

    expect(await runImageCacheCleanup()).toBe(1);
  });

  it('falls back to the default for a value that is not a number', async () => {
    state.settings = { imageCacheRetentionDays: 'forever' };
    state.cached = [{ imageId: 'old', mtimeMs: daysAgo(61) }];
    const { runImageCacheCleanup } = await loadCron();

    expect(await runImageCacheCleanup()).toBe(1);
  });

  it('reads the setting on every run rather than snapshotting it at startup', async () => {
    state.cached = [{ imageId: 'thirty-days-old', mtimeMs: daysAgo(30) }];
    const { initImageCacheCleanupCron } = await loadCron();
    await initImageCacheCleanupCron();
    expect(state.deleted).toEqual([]);

    // Changed in the settings UI after boot; the next run has to use the new value.
    state.settings = { imageCacheRetentionDays: 7 };
    await state.scheduled[0].handler();

    expect(state.deleted).toEqual(['thirty-days-old']);
  });

  it('reports how many images it removed', async () => {
    state.cached = [
      { imageId: 'one', mtimeMs: daysAgo(90) },
      { imageId: 'two', mtimeMs: daysAgo(90) },
    ];
    const { runImageCacheCleanup } = await loadCron();

    expect(await runImageCacheCleanup()).toBe(2);
    expect(state.logs.info.some((line) => line.includes('2'))).toBe(true);
  });

  it('survives a failing sweep rather than taking the scheduler down with it', async () => {
    state.cached = [{ imageId: 'old', mtimeMs: daysAgo(90) }];
    state.throwOnDelete = true;
    const { initImageCacheCleanupCron } = await loadCron();

    await expect(initImageCacheCleanupCron()).resolves.toBeUndefined();
    expect(state.logs.warn.some((line) => line.includes('Image cache cleanup failed'))).toBe(true);
    expect(state.scheduled).toHaveLength(1);
  });
});
