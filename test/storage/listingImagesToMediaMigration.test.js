/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { up as createListingImages } from '../../lib/services/storage/migrations/sql/46.listing-images.js';
import { up as createListingMedia } from '../../lib/services/storage/migrations/sql/48.listing-media.js';
import { up as moveImagesToMedia } from '../../lib/services/storage/migrations/sql/49.listing-images-to-media.js';
import { decodeGallery } from '../../lib/services/storage/listingMediaStorage.js';

/**
 * The fork stored galleries one row per picture (46); upstream keeps them as one deflated list
 * (48). An instance that already holds the former must not lose a single listing's pictures when
 * the latter takes over.
 */
describe('migration 49 - listing_images into listing_media', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE listings (id TEXT PRIMARY KEY, image_url TEXT)`);
    db.exec(`CREATE TABLE settings (id TEXT PRIMARY KEY, create_date INTEGER, name TEXT, value TEXT, user_id TEXT)`);
    createListingImages(db);
    createListingMedia(db);
  });

  afterEach(() => db.close());

  const addListing = (id, cover) => db.prepare(`INSERT INTO listings (id, image_url) VALUES (?, ?)`).run(id, cover);
  const addImages = (listingId, urls) =>
    urls.forEach((url, position) =>
      db
        .prepare(`INSERT INTO listing_images (id, listing_id, url, position, created_at) VALUES (?, ?, ?, ?, 1)`)
        .run(`${listingId}-${position}`, listingId, url, position),
    );
  const galleryOf = (listingId) =>
    decodeGallery(db.prepare(`SELECT gallery FROM listing_media WHERE listing_id = ?`).get(listingId)?.gallery).map(
      (image) => image.url,
    );

  it('keeps the pictures in their order, without the cover the listing already shows', () => {
    addListing('a', 'https://cdn.example/1.jpg');
    addImages('a', ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg', 'https://cdn.example/3.jpg']);

    moveImagesToMedia(db);

    expect(galleryOf('a')).toEqual(['https://cdn.example/2.jpg', 'https://cdn.example/3.jpg']);
  });

  it('drops the old table', () => {
    moveImagesToMedia(db);

    expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'listing_images'`).get()).toBeUndefined();
  });

  it('leaves a gallery the application has already stored alone', () => {
    addListing('a', 'https://cdn.example/1.jpg');
    addImages('a', ['https://cdn.example/1.jpg', 'https://cdn.example/old.jpg']);
    db.prepare(`INSERT INTO listing_media (listing_id, gallery, created_at) VALUES ('a', ?, 1)`).run(
      Buffer.from('keep-me'),
    );

    moveImagesToMedia(db);

    expect(db.prepare(`SELECT gallery FROM listing_media WHERE listing_id = 'a'`).get().gallery.toString()).toBe(
      'keep-me',
    );
  });

  it('writes nothing for a listing whose only picture is its cover', () => {
    addListing('a', 'https://cdn.example/1.jpg');
    addImages('a', ['https://cdn.example/1.jpg']);

    moveImagesToMedia(db);

    expect(db.prepare(`SELECT COUNT(*) AS n FROM listing_media`).get().n).toBe(0);
  });

  it('keeps the settings the old migration seeded', () => {
    moveImagesToMedia(db);

    const names = db
      .prepare(`SELECT name FROM settings`)
      .all()
      .map((row) => row.name);
    expect(names).toContain('maxImagesPerListing');
    expect(names).toContain('imageCacheRetentionDays');
  });

  it('is a no-op when the old table is already gone', () => {
    moveImagesToMedia(db);

    expect(() => moveImagesToMedia(db)).not.toThrow();
  });
});
