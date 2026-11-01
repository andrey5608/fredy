/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { up as createListingMedia } from '../../lib/services/storage/migrations/sql/48.listing-media.js';
import { imageIdFor } from '../../lib/services/images/imageIds.js';

/**
 * What this fork adds on top of upstream's gallery storage (`listing_media`, migration 48): the
 * operator's `maxImagesPerListing` cap, and the ids the image proxy and its disk cache know a
 * picture by. `ON DELETE CASCADE` disposes of a listing's gallery only if `PRAGMA foreign_keys = ON`
 * is set on the connection - exactly as `SqliteConnection.js` does for the real app - so this suite
 * turns it on explicitly rather than relying on SQLite's off-by-default behaviour.
 */
describe('listing images', () => {
  let db;
  let listingsStorage;
  let media;

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
        charges_included INTEGER,
        charges REAL,
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
        added_manually INTEGER NOT NULL DEFAULT 0,
        UNIQUE (job_id, hash)
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
    createListingMedia(db);

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
    media = await import('../../lib/services/storage/listingMediaStorage.js');
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

  const urls = (count, from = 0) => Array.from({ length: count }, (_, i) => `https://cdn.example.com/${from + i}.jpg`);
  // The gallery as stored: without the cover, which `image_url` keeps.
  const galleryOf = (listingId) =>
    media.getListingGallery(listingId, 'https://cdn.example.com/0.jpg').map((i) => i.url);

  it('stores the pictures after the cover, in order', () => {
    const listings = [listing('hash-1', { images: urls(3) })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    expect(galleryOf(listings[0].id)).toEqual(urls(2, 1));
  });

  it('caps the gallery at the configured maximum', () => {
    const listings = [listing('hash-1', { images: urls(5) })];
    listingsStorage.storeListings('job-1', 'immowelt', listings, { maxImagesPerListing: 3 });

    // Three pictures in all: the cover and the two after it.
    expect(galleryOf(listings[0].id)).toEqual(urls(2, 1));
  });

  it('defaults the cap when the caller does not pass one', () => {
    const listings = [listing('hash-1', { images: urls(25) })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    expect(galleryOf(listings[0].id)).toHaveLength(19);
  });

  it('stores nothing for a listing without an images array', () => {
    const listings = [listing('hash-1')];
    listingsStorage.storeListings('job-1', 'immowelt', listings);

    expect(galleryOf(listings[0].id)).toEqual([]);
  });

  describe('getImageById', () => {
    const stored = () => {
      const listings = [listing('hash-1', { images: urls(3) })];
      listingsStorage.storeListings('job-1', 'immowelt', listings);
      return listings[0].id;
    };

    it('finds the cover and every stored picture by the id the proxy hands out', () => {
      const id = stored();

      for (const url of urls(3)) {
        expect(listingsStorage.getImageById(imageIdFor(id, url))).toEqual({
          id: imageIdFor(id, url),
          listing_id: id,
          url,
        });
      }
    });

    it('does not know a picture the listing never had', () => {
      const id = stored();

      expect(listingsStorage.getImageById(imageIdFor(id, 'https://cdn.example.com/other.jpg'))).toBeNull();
    });

    it('does not know an id that names no listing, or is not an id at all', () => {
      stored();

      expect(listingsStorage.getImageById(imageIdFor('no-such-listing', urls(1)[0]))).toBeNull();
      expect(listingsStorage.getImageById('no-such-image')).toBeNull();
      expect(listingsStorage.getImageById('')).toBeNull();
    });

    it('cannot be pointed at another listing by splicing ids together', () => {
      const first = stored();
      const second = [listing('hash-2', { images: urls(2, 100), image: 'https://cdn.example.com/100.jpg' })];
      listingsStorage.storeListings('job-1', 'immowelt', second);

      expect(listingsStorage.getImageById(imageIdFor(first, 'https://cdn.example.com/101.jpg'))).toBeNull();
    });
  });

  it('deletes a listing gallery along with it (cascade)', () => {
    const listings = [listing('hash-1', { images: urls(3) })];
    listingsStorage.storeListings('job-1', 'immowelt', listings);
    expect(galleryOf(listings[0].id)).toHaveLength(2);

    listingsStorage.deleteListingsById([listings[0].id], true);

    expect(galleryOf(listings[0].id)).toEqual([]);
    expect(db.prepare('SELECT 1 FROM listing_media WHERE listing_id = ?').get(listings[0].id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM listings WHERE id = ?').get(listings[0].id)).toBeUndefined();
  });
});
