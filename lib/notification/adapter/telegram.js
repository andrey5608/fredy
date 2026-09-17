/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { readAdapterReadme } from '../../services/markdown.js';
import { getJob } from '../../services/storage/jobStorage.js';
import fetch from 'node-fetch';
import pThrottle from 'p-throttle';
import { normalizeImageUrls } from '../../utils.js';
import logger from '../../services/logger.js';
import { shouldUseMultipart, buildPhotoFormData, buildMediaGroupFormData } from './telegramPhotoUploader.js';
import { toPriceChangeListing } from '../priceChangeMessage.js';
import { DEFAULT_NEBENKOSTEN_PCT } from '../../services/finance/constants.js';

/**
 * Telegram's own ceiling on how many items one sendMediaGroup call may carry. A gallery beyond this
 * is truncated rather than split into a second album: a second sendMediaGroup call cannot carry a
 * caption of its own (Telegram allows exactly one per album), so it used to arrive as a bare photo
 * dump with nothing tying it back to the listing it came from.
 * @type {number}
 */
const MAX_MEDIA_GROUP_SIZE = 10;

const DEFAULT_API_URL = 'https://api.telegram.org';
const RATE_LIMIT_INTERVAL = 1000;
const THROTTLE_MAX_IDLE_MS = RATE_LIMIT_INTERVAL + 2000;
const chatThrottleMap = new Map();

/**
 * How many times a single call retries after a 429 before giving up and letting the caller's own
 * fallback (sendMessage) take over.
 * @type {number}
 */
const MAX_RATE_LIMIT_RETRIES = 5;

/**
 * Telegram's `retry_after` is trusted as-is (it already reflects however far over the limit this
 * bot is), but clamped so one bad/unexpected value can never stall a batch for an absurd amount of
 * time.
 * @type {number}
 */
const MAX_RETRY_AFTER_SECONDS = 120;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanupOldThrottles() {
  const now = Date.now();
  for (const [chatId, chatThrottle] of chatThrottleMap.entries()) {
    if (now - chatThrottle.lastUsedAt > THROTTLE_MAX_IDLE_MS) chatThrottleMap.delete(chatId);
  }
}

/**
 * Runs one throttled call, retrying it in place when Telegram answers 429 with a `retry_after`.
 *
 * The whole batch for this chat pauses, not just the call that got rate-limited: `entry.blockedUntil`
 * is checked by every call before it fires, including ones already queued behind this one by
 * p-throttle (which only paces how often a call *starts*, not how long one takes to resolve) - a
 * burst of listings for the same chat used to keep hitting 429 back-to-back because each queued
 * call fired on schedule and immediately failed again, rather than waiting out the cooldown Telegram
 * actually asked for.
 *
 * @param {{blockedUntil: number}} entry - Per-chat throttle bookkeeping (see getThrottled).
 * @param {Function} call - Raw Telegram API caller.
 * @param {string} endpoint
 * @param {object|FormData} body
 * @returns {Promise<Response>}
 */
async function callWithRateLimitRetry(entry, call, endpoint, body) {
  for (let attempt = 0; ; attempt++) {
    const wait = entry.blockedUntil - Date.now();
    if (wait > 0) await sleep(wait);

    try {
      return await call(endpoint, body);
    } catch (e) {
      if (e.retryAfterSeconds == null || attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw e;
      }
      const retryAfterMs = (Math.min(e.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) + 1) * 1000;
      entry.blockedUntil = Date.now() + retryAfterMs;
      logger.warn(
        `Telegram rate limit hit on '${endpoint}', waiting ${Math.round(retryAfterMs / 1000)}s before retrying ` +
          `(attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`,
      );
    }
  }
}

/**
 * Return a throttled wrapper for a chatId to limit Telegram API calls.
 * Uses p-throttle with 1 request per RATE_LIMIT_INTERVAL per chat.
 * `lastUsedAt` is refreshed on every actual API call so that the idle window
 * starts from the last fired call, not from when send() was invoked.
 *
 * @param {string|number} chatId
 * @param {Function} call - async function (endpoint: string, body: any) => Promise<Response>
 * @returns {Function}
 */
function getThrottled(chatId, call) {
  cleanupOldThrottles();
  const existing = chatThrottleMap.get(chatId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing.throttled;
  }
  const entry = { lastUsedAt: Date.now(), blockedUntil: 0, throttled: null };
  chatThrottleMap.set(chatId, entry);
  entry.throttled = pThrottle({ limit: 1, interval: RATE_LIMIT_INTERVAL })(async (endpoint, body) => {
    const e = chatThrottleMap.get(chatId);
    if (e) e.lastUsedAt = Date.now();
    return callWithRateLimitRetry(entry, call, endpoint, body);
  });
  return entry.throttled;
}

/**
 * Shorten a string to a maximum length with an ellipsis suffix.
 * @param {string} str
 * @param {number} [len=90]
 * @returns {string}
 */
function shorten(str, len = 90) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len).trim() + '...' : str;
}

/**
 * Escape basic HTML entities for Telegram HTML parse mode.
 * @param {string} [s='']
 * @returns {string}
 */
function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Splits a combined address string into a street and a district.
 *
 * Every provider hands over the address as one already-formatted string, in its own layout (e.g.
 * "Britzer Damm 111, 12439 Neukölln, Berlin"). The part before the first comma counts as a street
 * only when it ends in a number: house numbers do, district/city names don't. A listing whose
 * provider never exposes an exact street (redacted search-result addresses are common) or whose
 * address has no comma at all falls back to putting everything under district rather than
 * guessing a street that isn't there.
 *
 * @param {string|null|undefined} address
 * @returns {{street: string|null, district: string|null}}
 */
function splitAddress(address) {
  const parts = (address || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { street: null, district: null };
  if (parts.length > 1 && /\d[a-zA-Z]?$/.test(parts[0])) {
    return { street: parts[0], district: parts.slice(1).join(', ') };
  }
  return { street: null, district: parts.join(', ') };
}

/**
 * `rooms` already carries a localized unit ("2.5 rooms", "2 Zimmer") from formatListing() - this
 * field's own "Rooms:" label makes repeating that unit redundant, so only the leading number
 * survives.
 *
 * @param {string|null|undefined} roomsFormatted
 * @returns {string|null}
 */
function roomsNumberOnly(roomsFormatted) {
  return roomsFormatted?.match(/^[\d.,]+/)?.[0] ?? null;
}

/**
 * Estimated warm rent (cold rent + Nebenkosten), since no provider's `price` field is ever
 * anything but the cold rent (see DEFAULT_NEBENKOSTEN_PCT) and Fredy has no separate warm-rent
 * figure to show instead. `price` already carries its unit ("449 €") by the time an adapter sees
 * it; parseFloat reads the leading number back out and ignores the rest.
 *
 * @param {string|null|undefined} priceFormatted
 * @returns {string|null}
 */
function estimateWarmPrice(priceFormatted) {
  const cold = priceFormatted != null ? parseFloat(priceFormatted) : NaN;
  if (Number.isNaN(cold)) return null;
  return `~${Math.round(cold * (1 + DEFAULT_NEBENKOSTEN_PCT / 100))} €`;
}

/**
 * The labelled fields every Telegram notification shows, in order - shared between the HTML and
 * plain-text builders so the two layouts can never drift apart.
 *
 * @param {Object} o - Listing object (already run through formatListing()).
 * @returns {[string, string][]} [label, value] pairs, omitting any field with no value.
 */
function listingFieldLines(o) {
  const { street, district } = splitAddress(o.address);
  return [
    ['District', district],
    ['Street', street],
    ['Warm price', estimateWarmPrice(o.price)],
    ['Cold price', o.price],
    ['Sqm', o.size],
    ['Rooms', roomsNumberOnly(o.rooms)],
  ].filter(([, value]) => value != null && value !== '');
}

/**
 * Build a Telegram HTML-formatted message body.
 * Suitable for both sendMessage (uncapped) and sendPhoto captions (caller must slice to 1024).
 *
 * @param {Object} o - Listing object
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildHtmlBody(o, baseUrl) {
  const title = shorten((o.title || '').replace(/\*/g, ''), 90);
  const lines = listingFieldLines(o).map(([label, value]) => `${escapeHtml(label)}: ${escapeHtml(value)}`);
  const fredyLink =
    baseUrl && o.id ? `\n\n<a href='${escapeHtml(`${baseUrl}/#/listings/listing/${o.id}`)}'>Open in Fredy</a>` : '';
  return `<a href='${escapeHtml(o.link || '')}'><b>${escapeHtml(title)}</b></a>\n${lines.join('\n')}${fredyLink}`;
}

/**
 * Build a plain-text Telegram photo caption (Telegram caps captions at 1024 characters).
 *
 * @param {Object} o - Listing object
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildPlainCaption(o, baseUrl) {
  const title = shorten((o.title || '').replace(/\*/g, ''), 90);
  const lines = listingFieldLines(o).map(([label, value]) => `${label}: ${value}`);
  const fredyLine = baseUrl && o.id ? `\n\nOpen in Fredy: ${baseUrl}/#/listings/listing/${o.id}` : '';
  return `${title}\n${o.link || ''}\n${lines.join('\n')}${fredyLine}`.slice(0, 1024);
}

/**
 * Build a plain-text Telegram message body.
 * Link appears early so it is tappable without scrolling.
 *
 * @param {Object} o - Listing object
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildPlainText(o, baseUrl) {
  const title = shorten((o.title || '').replace(/\*/g, ''), 90);
  const lines = listingFieldLines(o).map(([label, value]) => `${label}: ${value}`);
  const fredyLine = baseUrl && o.id ? `\n\nOpen in Fredy: ${baseUrl}/#/listings/listing/${o.id}` : '';
  return `${title}\n${o.link || ''}\n${lines.join('\n')}${fredyLine}`;
}

/**
 * Reads `parameters.retry_after` out of a Telegram 429 error body, if present.
 *
 * @param {string} errorBody
 * @returns {number|null}
 */
function parseRetryAfterSeconds(errorBody) {
  try {
    const seconds = JSON.parse(errorBody)?.parameters?.retry_after;
    return typeof seconds === 'number' && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the Telegram API base url.
 * Anything missing, unparsable or not http(s) falls back to the official endpoint with a warning,
 * so a broken relay url can never take notifications down.
 *
 * @param {string} [apiUrl] - Optional user configured base url (e.g. a Telegram API relay).
 * @returns {string} Base url without trailing slashes.
 */
function resolveApiUrl(apiUrl) {
  const raw = typeof apiUrl === 'string' ? apiUrl.trim() : '';
  if (raw === '') return DEFAULT_API_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  if (parsed == null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    logger.warn(`Telegram adapter: 'apiUrl' is invalid ('${apiUrl}'). Falling back to ${DEFAULT_API_URL}.`);
    return DEFAULT_API_URL;
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Create the raw Telegram API caller for a given bot token.
 * Handles JSON and multipart (FormData) bodies.
 *
 * @param {string} token - Telegram bot token.
 * @param {string} jobName - Used in error messages.
 * @param {string} apiUrl - Telegram API base url, already resolved.
 * @returns {(endpoint: string, body: object|FormData) => Promise<Response>}
 */
function makeTelegramCaller(token, jobName, apiUrl) {
  return async function (endpoint, body) {
    const isFormData = body instanceof FormData;
    const opts = isFormData
      ? { method: 'post', body }
      : { method: 'post', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
    const res = await fetch(`${apiUrl}/bot${token}/${endpoint}`, opts);
    if (!res.ok) {
      const errorBody = await res.text();
      const error = new Error(`API error for '${jobName}'. '${endpoint}' returned ${errorBody}`);
      // Read by callWithRateLimitRetry to decide whether (and how long) to wait before retrying.
      error.retryAfterSeconds = parseRetryAfterSeconds(errorBody);
      throw error;
    }
    return res;
  };
}

/**
 * Logs a successful delivery at 'info' rather than 'debug': this is the only place a Telegram send
 * ever produced output before, all of it on failure, so a container running with NODE_ENV=production
 * (which drops 'debug') showed nothing at all while everything was working.
 *
 * @param {string} method - Telegram API endpoint used ('sendMessage', 'sendPhoto', 'sendMediaGroup').
 * @param {Object} listing
 * @param {string|number} chatId
 */
function logSent(method, listing, chatId) {
  logger.info(`Telegram: sent listing '${listing.id}' to chat ${chatId} via ${method}`);
}

/**
 * Send a single listing to a single Telegram chat, with photo-then-text fallback.
 *
 * @param {Function} throttledCall - Throttled Telegram API caller for this chat.
 * @param {Object} listing - Listing object.
 * @param {string|number} chatId
 * @param {Object} opts
 * @param {string} opts.baseUrl
 * @param {boolean} opts.plainText
 * @param {number|undefined} opts.message_thread_id
 * @returns {Promise<void>}
 */
async function sendListingToChat(throttledCall, listing, chatId, { baseUrl, plainText, message_thread_id }) {
  // Every image the listing has, not just the one image_url still carries for compatibility -
  // falls back to that single field for every provider outside the multi-image set, so a listing
  // with only one photo goes on taking the exact path it always has. Capped at Telegram's own
  // sendMediaGroup limit rather than split across several albums - see MAX_MEDIA_GROUP_SIZE.
  const images = normalizeImageUrls(listing.images?.length > 0 ? listing.images : [listing.image]).slice(
    0,
    MAX_MEDIA_GROUP_SIZE,
  );

  const textPayload = {
    chat_id: chatId,
    text: plainText ? buildPlainText(listing, baseUrl) : buildHtmlBody(listing, baseUrl),
    ...(plainText ? {} : { parse_mode: 'HTML' }),
    disable_web_page_preview: true,
    ...(message_thread_id ? { message_thread_id } : {}),
  };

  if (images.length === 0) {
    return throttledCall('sendMessage', textPayload)
      .then((res) => {
        logSent('sendMessage', listing, chatId);
        return res;
      })
      .catch((e) => {
        logger.error(`Error sending message to Telegram: ${e.message}`);
      });
  }

  const caption = plainText ? buildPlainCaption(listing, baseUrl) : buildHtmlBody(listing, baseUrl).slice(0, 1024);
  const parseMode = plainText ? undefined : 'HTML';

  if (images.length === 1) {
    const img = images[0];
    // .webp URLs (Immowelt/Cloudimage) fail Telegram's URL-based sendPhoto with
    // "failed to get HTTP URL content". Upload the bytes via multipart instead.
    const photoCall = shouldUseMultipart(img)
      ? buildPhotoFormData({ chatId, imageUrl: img, caption, parseMode, messageThreadId: message_thread_id }).then(
          (fd) => throttledCall('sendPhoto', fd),
        )
      : throttledCall('sendPhoto', {
          chat_id: chatId,
          photo: img,
          caption,
          ...(parseMode ? { parse_mode: parseMode } : {}),
          ...(message_thread_id ? { message_thread_id } : {}),
        });

    return photoCall
      .then((res) => {
        logSent('sendPhoto', listing, chatId);
        return res;
      })
      .catch(async (e) => {
        logger.warn(`Error sending photo to Telegram and use a fallback: ${e.message}`);
        return throttledCall('sendMessage', textPayload)
          .then((res) => {
            logSent('sendMessage', listing, chatId);
            return res;
          })
          .catch((e) => {
            logger.error(`Error sending message to Telegram: ${e.message}`);
            throw e;
          });
      });
  }

  // More than one image: send as a single album (already capped at Telegram's own
  // sendMediaGroup limit above), each fetched and compressed rather than handed over as bare URLs -
  // see buildMediaGroupFormData for why that is also the one place a fetch failure for a single
  // photo falls back to its own URL instead of dropping it.
  try {
    const fd = await buildMediaGroupFormData({
      chatId,
      imageUrls: images,
      caption,
      parseMode,
      messageThreadId: message_thread_id,
    });
    await throttledCall('sendMediaGroup', fd);
    logSent('sendMediaGroup', listing, chatId);
  } catch (e) {
    logger.warn(`Error sending media group to Telegram and use a fallback: ${e.message}`);
    return throttledCall('sendMessage', textPayload)
      .then((res) => {
        logSent('sendMessage', listing, chatId);
        return res;
      })
      .catch((e) => {
        logger.error(`Error sending message to Telegram: ${e.message}`);
        throw e;
      });
  }
}

/**
 * Send new listings to Telegram.
 * - Respects per-chat Telegram rate limits using a lightweight throttle cache.
 * - Falls back to sendMessage when sendPhoto fails or image is missing.
 *
 * @param {Object} params
 * @param {Array<Object>} params.newListings - Array of new listing objects.
 * @param {Array<Object>} params.notificationConfig - Notification adapters configuration array.
 * @param {string} params.jobKey - Storage job key to resolve the human readable job name.
 * @returns {Promise<any[]>} Promise resolving when all send operations complete.
 */
export const send = ({ newListings = [], notificationConfig, jobKey, baseUrl }) => {
  const adapterCfg = notificationConfig.find((adapter) => adapter.id === config.id);
  if (!adapterCfg || !adapterCfg.fields) {
    throw new Error(`Telegram adapter configuration missing for job '${jobKey || ''}'`);
  }
  const { token, chatId, messageThreadId, plainText, apiUrl } = adapterCfg.fields;
  if (!token || !chatId) {
    throw new Error("Telegram 'token' and 'chatId' must be provided in notification config");
  }

  const chatIds = String(chatId)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Optional Telegram topic/thread support (supergroups)
  let message_thread_id;
  if (messageThreadId !== undefined && messageThreadId !== null && `${messageThreadId}`.trim() !== '') {
    const n = Number(messageThreadId);
    if (Number.isInteger(n) && n > 0) {
      message_thread_id = n;
    } else {
      logger.warn(
        `Telegram adapter: 'messageThreadId' is invalid ('${messageThreadId}'). It must be a positive integer. Ignoring.`,
      );
    }
  }

  const job = getJob(jobKey);
  const jobName = job == null ? jobKey : job.name;

  if (!Array.isArray(newListings) || newListings.length === 0) return Promise.resolve([]);

  logger.info(
    `Telegram: dispatching ${newListings.length} new listing(s) to ${chatIds.length} chat(s) for job '${jobName}'`,
  );

  const resolvedApiUrl = resolveApiUrl(apiUrl);
  const allPromises = chatIds.flatMap((id) => {
    const caller = makeTelegramCaller(token, jobName, resolvedApiUrl);
    const throttledCall = getThrottled(id, caller);
    const opts = { baseUrl, plainText, message_thread_id };
    return newListings.map((listing) => sendListingToChat(throttledCall, listing, id, opts));
  });

  return Promise.all(allPromises);
};

/**
 * Telegram notification adapter configuration schema.
 * @type {{id:string,name:string,readme:string,description:string,fields:{token:{type:string,label:string,description:string},chatId:{type:string,label:string,description:string},messageThreadId?:{type:string,label:string,description:string}}}}
 */
/**
 * Sends price changes over the same throttled per-chat path as new listings.
 *
 * Reusing `sendListingToChat` matters more here than the wording does: Telegram rate-limits per
 * chat, and a second, unthrottled path would be the one that trips the limit and takes the new
 * listing notifications down with it.
 *
 * @param {{priceChanges: any[], notificationConfig: any[], jobKey: string, baseUrl: string}} params
 * @returns {Promise<any>}
 */
export const sendPriceChange = ({ priceChanges = [], notificationConfig, jobKey, baseUrl }) => {
  const adapterCfg = notificationConfig.find((adapter) => adapter.id === config.id);
  if (!adapterCfg || !adapterCfg.fields) {
    throw new Error(`Telegram adapter configuration missing for job '${jobKey || ''}'`);
  }
  const { token, chatId, messageThreadId, plainText, apiUrl } = adapterCfg.fields;
  if (!token || !chatId) {
    throw new Error("Telegram 'token' and 'chatId' must be provided in notification config");
  }
  if (!Array.isArray(priceChanges) || priceChanges.length === 0) return Promise.resolve([]);

  const chatIds = String(chatId)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let message_thread_id;
  if (messageThreadId !== undefined && messageThreadId !== null && `${messageThreadId}`.trim() !== '') {
    const n = Number(messageThreadId);
    if (Number.isInteger(n) && n > 0) {
      message_thread_id = n;
    }
  }

  const job = getJob(jobKey);
  const jobName = job == null ? jobKey : job.name;

  logger.info(
    `Telegram: dispatching ${priceChanges.length} price change(s) to ${chatIds.length} chat(s) for job '${jobName}'`,
  );

  const resolvedApiUrl = resolveApiUrl(apiUrl);
  const allPromises = chatIds.flatMap((id) => {
    const caller = makeTelegramCaller(token, jobName, resolvedApiUrl);
    const throttledCall = getThrottled(id, caller);
    const opts = { baseUrl, plainText, message_thread_id };
    return priceChanges.map((change) => sendListingToChat(throttledCall, toPriceChangeListing(change), id, opts));
  });

  return Promise.all(allPromises);
};

export const config = {
  id: 'telegram',
  name: 'Telegram',
  readme: readAdapterReadme('telegram.md'),
  description: 'Fredy will send new listings to your mobile, using Telegram.',
  fields: {
    token: {
      type: 'text',
      label: 'Token',
      description: 'The token needed to access this service.',
      // Never leaves the server for anyone who may not edit this channel.
      secret: true,
    },
    chatId: {
      type: 'chatId',
      label: 'Chat Id',
      description:
        'The chat ID to send messages to. Separate multiple IDs with commas to notify several recipients (e.g. 123456789, 987654321).',
      // Shown as the channel's destination in the UI.
      target: true,
    },
    messageThreadId: {
      type: 'text',
      optional: true,
      label: 'Message Thread Id (optional)',
      description:
        'Optional: The topic/thread id within a supergroup to post into (Telegram message_thread_id). Provide a positive integer.',
    },
    plainText: {
      type: 'boolean',
      optional: true,
      label: 'Send as plain text',
      description: 'Send messages as plain text instead of HTML formatted.',
    },
    apiUrl: {
      type: 'text',
      optional: true,
      label: 'API Url (optional)',
      description: `Optional: Base url of a Telegram API relay (e.g. https://telegram.example.com). Leave empty to use ${DEFAULT_API_URL}.`,
    },
  },
};
