import { nanoid } from 'nanoid';

/**
 * Default ceiling on how many images are stored per listing.
 * @type {number}
 */
export const DEFAULT_MAX_IMAGES_PER_LISTING = 20;

/**
 * Default age, in days, at which a cached (downloaded + compressed) image is purged.
 * @type {number}
 */
export const DEFAULT_IMAGE_CACHE_RETENTION_DAYS = 60;

/**
 * Every image a provider found for a listing, not just the one on `listings.image_url`.
 *
 * A table rather than a JSON column, by the same reasoning as `listing_price_history` (migration
 * 28) and `listing_travel_times` (migration 31): `ON DELETE CASCADE` (with `PRAGMA foreign_keys =
 * ON`, already set in `SqliteConnection.js`) disposes of a listing's images the moment the listing
 * itself is deleted - including through the retention purge - with no code of its own. `image_url`
 * on `listings` is untouched and keeps being the first entry, so every existing reader (the MCP
 * photo tool, notification adapters, the grid/table thumbnail) keeps working unchanged.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_images (
      id         TEXT    PRIMARY KEY,
      listing_id TEXT    NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      url        TEXT    NOT NULL,
      position   INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images (listing_id, position)`);

  seedSetting(db, 'maxImagesPerListing', DEFAULT_MAX_IMAGES_PER_LISTING);
  seedSetting(db, 'imageCacheRetentionDays', DEFAULT_IMAGE_CACHE_RETENTION_DAYS);
}

/**
 * Insert a global setting, but only when the operator has no value for it yet.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} name
 * @param {any} value
 * @returns {void}
 */
function seedSetting(db, name, value) {
  const exists = db.prepare(`SELECT 1 FROM settings WHERE name = @name AND user_id IS NULL LIMIT 1`).get({ name });
  if (exists) return;
  db.prepare(
    `INSERT INTO settings (id, create_date, name, value, user_id)
     VALUES (@id, @create_date, @name, @value, NULL)`,
  ).run({ id: nanoid(), create_date: Date.now(), name, value: JSON.stringify(value) });
}
