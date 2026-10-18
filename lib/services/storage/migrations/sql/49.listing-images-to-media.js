/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import zlib from 'node:zlib';
import { toListingImages, withoutFirstPicture } from '../../../../utils/listingImages.js';

/**
 * Move the galleries this fork kept in `listing_images` (`46.listing-images.js`) into
 * `listing_media` (`48.listing-media.js`), which is where upstream keeps them, and drop the old table.
 *
 * Both migrations ran on an instance that has had the fork's gallery: 46 wrote one row per picture,
 * 48 created the table the application now reads. Without this step every listing stored before the
 * upgrade would fall back to its single cover picture.
 *
 * The gallery is written the way `storeListingGallery` writes it: `ListingImage[]` without the
 * listing's own cover (`image_url`, whose bytes `preview` keeps), deflated JSON. A listing that
 * already has a gallery in `listing_media` is left alone, so running this twice, or after the
 * application has stored a newer gallery, changes nothing.
 *
 * `maxImagesPerListing` and `imageCacheRetentionDays`, the two settings 46 seeded, stay: the
 * application still reads both.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'listing_images'`).get();
  if (exists == null) return;

  const listings = db
    .prepare(
      `SELECT l.id, l.image_url
       FROM listings l
       WHERE EXISTS (SELECT 1 FROM listing_images i WHERE i.listing_id = l.id)
         AND NOT EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = l.id AND m.gallery IS NOT NULL)`,
    )
    .all();
  const urlsOf = db.prepare(`SELECT url FROM listing_images WHERE listing_id = ? ORDER BY position`);
  const write = db.prepare(
    `INSERT INTO listing_media (listing_id, gallery, created_at)
     VALUES (@listingId, @gallery, @createdAt)
     ON CONFLICT(listing_id) DO UPDATE SET gallery = excluded.gallery`,
  );

  for (const { id, image_url: coverUrl } of listings) {
    const urls = urlsOf.all(id).map((row) => row.url);
    const gallery = withoutFirstPicture(toListingImages(urls), coverUrl);
    if (gallery.length === 0) continue;
    write.run({
      listingId: id,
      gallery: zlib.deflateRawSync(JSON.stringify(gallery), { level: 9 }),
      createdAt: Date.now(),
    });
  }

  db.exec(`DROP TABLE listing_images`);
}
