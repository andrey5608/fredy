/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

/**
 * `listing_images` is a real child table (migration 46), not a JSON column, specifically so that
 * `ON DELETE CASCADE` disposes of a listing's images without any code of its own. That only holds
 * if `PRAGMA foreign_keys = ON` is actually set on the connection - exactly as `SqliteConnection.js`
 * does for the real app - so this suite turns it on explicitly rather than relying on SQLite's
 * off-by-default behaviour.
 */
describe('listing images', () => {
  let db;
  let listingsStorage;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        hash TEXT,
        provider TEXT,
        job_id TEXT,
        price REAL,
        size REAL,
        rooms REAL,
        build_year INTEGER,
        energy_class TEXT,
        title TEXT,
        image_url TEXT,
        description TEXT,
        address TEXT,
        link TEXT,
        created_at INTEGER,
        is_active INTEGER,
        manually_deleted INTEGER DEFAULT 0,
        latitude REAL,
        longitude REAL,
        distances TEXT,
        notes TEXT,
        status TEXT,
        price_per_sqm REAL,
        published_at INTEGER,
        UNIQUE (job_id, hash)
      );
      CREATE TABLE listing_images (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT, deal_type TEXT);
      CREATE TABLE watch_list (id TEXT PRIMARY KEY, listing_id TEXT, user_id TEXT);
      -- Empty, but getListingById() also joins in travel times, so it has to exist.
      CREATE TABLE listing_travel_times (
        listing_id TEXT NOT NULL,
        label TEXT NOT NULL,
        origin_lat REAL,
        origin_lng REAL,
        transit_minutes INTEGER,
        transit_transfers INTEGER,
        car_minutes INTEGER,
        car_distance_meters INTEGER,
        car_geometry TEXT,
        bike_minutes INTEGER,
        walk_minutes INTEGER,
        is_estimate INTEGER NOT NULL DEFAULT 1,
        reference_time INTEGER,
        computed_at INTEGER,
        PRIMARY KEY (listing_id, label)
      );
    `);

    vi.resetModules();
    vi.doMock('../../lib/services/storage/SqliteConnection.js', () => ({
      default: {
        getConnection: () => db,
        query: (sql, params) => db.prepare(sql).all(params),
        execute: (sql, params) => db.prepare(sql).run(params),
        withTransaction: (callback) => db.transaction(() => callback(db))(),
      },
    }));
    vi.doMock('../../lib/services/similarity-check/similarityCache.js', () => ({ removeEntry: vi.fn() }));
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  afterEach(() => {
    db.close();
  });

  const listing = (hash, overrides = {}) => ({
    id: hash,
    price: 1000,
    size: 60,
    rooms: 2,
    title: `Flat ${hash}`,
    image: 'https://cdn.example.com/0.jpg',
    description: 'nice',
    address: 'Hauptstrasse 1',
    link: `https://example.com/${hash}`,
    ...overrides,
  });

  const imagesFor = (listingId) =>
    db
      .prepare('SELECT url FROM listing_images WHERE listing_id = ? ORDER BY position')
      .all(listingId)
      .map((row) => row.url);

  it('stores every image a provider found, in order', () => {
    const images = ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'];
    const listings = [listing('hash-1', { images })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    expect(imagesFor(listings[0].id)).toEqual(images);
  });

  it('caps stored images at the configured maximum', () => {
    const images = Array.from({ length: 5 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    const listings = [listing('hash-1', { images })];
    listingsStorage.storeListings('job-1', 'immowelt', listings, { maxImagesPerListing: 2 });

    expect(imagesFor(listings[0].id)).toEqual(images.slice(0, 2));
  });

  it('defaults the cap when the caller does not pass one', () => {
    const images = Array.from({ length: 25 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    const listings = [listing('hash-1', { images })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    expect(imagesFor(listings[0].id)).toHaveLength(20);
  });

  it('drops duplicate and empty urls', () => {
    const images = ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/0.jpg', '', null];
    const listings = [listing('hash-1', { images })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    expect(imagesFor(listings[0].id)).toEqual(['https://cdn.example.com/0.jpg']);
  });

  it('stores nothing extra for a listing without an images array', () => {
    const listings = [listing('hash-1')];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    expect(imagesFor(listings[0].id)).toEqual([]);
  });

  it('does not duplicate images when a listing already exists (conflict)', () => {
    const images = ['https://cdn.example.com/0.jpg'];
    listingsStorage.storeListings('job-1', 'immowelt', [listing('dup', { images })]);
    const second = [listing('dup', { images: [...images, 'https://cdn.example.com/1.jpg'] })];
    listingsStorage.storeListings('job-1', 'immoscout', second);

    // The row already existed, so the second batch's images are never inserted - matching how the
    // rest of storeListings treats a conflict as "this row is not this batch's to write".
    expect(imagesFor(second[0].id)).toEqual(images);
  });

  it('merges stored images into getListingById, in position order', () => {
    const images = ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg'];
    const listings = [listing('hash-1', { images })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    const row = listingsStorage.getListingById(listings[0].id, null, true);
    expect(row.images).toEqual(images);
  });

  it('falls back to image_url when a listing has no listing_images rows', () => {
    const listings = [listing('hash-1')];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    const row = listingsStorage.getListingById(listings[0].id, null, true);
    expect(row.images).toEqual(['https://cdn.example.com/0.jpg']);
  });

  it('falls back to an empty array when neither images nor image_url exist', () => {
    const listings = [listing('hash-1', { image: null })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    const row = listingsStorage.getListingById(listings[0].id, null, true);
    expect(row.images).toEqual([]);
  });

  it('looks up one stored image by its own id, for the image proxy', () => {
    const images = ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg'];
    const listings = [listing('hash-1', { images })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    const [firstRow] = db
      .prepare('SELECT id, url FROM listing_images WHERE listing_id = ? ORDER BY position')
      .all(listings[0].id);

    expect(listingsStorage.getImageById(firstRow.id)).toEqual({
      id: firstRow.id,
      listing_id: listings[0].id,
      url: firstRow.url,
    });
  });

  it('returns null for an image id that does not exist', () => {
    expect(listingsStorage.getImageById('no-such-image')).toBeNull();
  });

  it('deletes a listing images along with it (cascade)', () => {
    const images = ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg'];
    const listings = [listing('hash-1', { images })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);
    expect(imagesFor(listings[0].id)).toHaveLength(2);

    listingsStorage.deleteListingsById([listings[0].id], true);

    expect(imagesFor(listings[0].id)).toEqual([]);
    expect(db.prepare('SELECT 1 FROM listings WHERE id = ?').get(listings[0].id)).toBeUndefined();
  });
});
