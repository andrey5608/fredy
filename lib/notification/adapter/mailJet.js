/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import mailjet from 'node-mailjet';
import path from 'path';
import fs from 'fs';
import Handlebars from 'handlebars';
import fetch from 'node-fetch';
import { readAdapterReadme } from '../../services/markdown.js';
import { getDirName, normalizeImageUrls } from '../../utils.js';
import logger from '../../services/logger.js';
import { toPriceChangeListing } from '../priceChangeMessage.js';
import { compressImageIfNeeded } from '../../services/images/imageProcessor.js';

const __dirname = getDirName();
// The CID-specific template (`cid:{{this.imageCid}}`, matching InlinedAttachments below) - not
// the shared template.hbs, which expects a plain image URL and previously rendered a broken empty
// src for every MailJet email since this file read the wrong one.
const template = fs.readFileSync(path.resolve(__dirname + '/notification/emailTemplate/mailjet.hbs'), 'utf8');
const emailTemplate = Handlebars.compile(template);

/**
 * How many of a listing's images are inlined as CID attachments. Capped tighter than every other
 * channel (smtp/resend show every image because a remote <img> costs nothing extra; Telegram's
 * per-image budget is the same 1 MB compressed) because each one here is raw bytes riding along
 * inside the email itself - three compressed photos already adds a few hundred KB to every message.
 * @type {number}
 */
const MAX_MAILJET_IMAGES = 3;

const guessMime = (url) => {
  const lower = url.split('?')[0].toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
};

const extensionFor = (mimeType) => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  return 'jpg';
};

/**
 * Fetch one image and compress it if it is over budget, the same way every other byte-carrying
 * channel (Telegram) does.
 *
 * @param {string} url
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
const fetchAndCompress = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed with status ${res.status} for URL: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return compressImageIfNeeded(buffer, { originalMimeType: guessMime(url) });
};

const mapListingsWithCid = async (serviceName, jobKey, listings, baseUrl) => {
  const out = [];
  const attachments = [];

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i] || {};
    // Every image the listing has, not just the one image still carries for compatibility - falls
    // back to that single field for every provider outside the multi-image set - capped at
    // MAX_MAILJET_IMAGES before any of them are fetched, so a large gallery costs no more requests
    // than the cap allows.
    const images = normalizeImageUrls(l.images?.length > 0 ? l.images : [l.image]).slice(0, MAX_MAILJET_IMAGES);

    const item = {
      title: l.title || '',
      link: l.link || '',
      address: l.address || '',
      size: l.size || '',
      price: l.price || '',
      commute: l.commute || '',
      serviceName,
      jobKey,
      hasImage: false,
      imageCid: '',
      extraImageCids: [],
      fredyUrl: baseUrl && l.id ? `${baseUrl}/#/listings/listing/${l.id}` : null,
    };

    for (let j = 0; j < images.length; j++) {
      try {
        const { buffer, mimeType } = await fetchAndCompress(images[j]);
        const cid = `listing-${i}-${j}`;
        attachments.push({
          ContentType: mimeType,
          Filename: `listing-${i}-${j}.${extensionFor(mimeType)}`,
          Base64Content: buffer.toString('base64'),
          ContentID: cid,
        });
        if (j === 0) {
          item.hasImage = true;
          item.imageCid = cid;
        } else {
          item.extraImageCids.push(cid);
        }
      } catch (error) {
        logger.warn(`Skipping image ${j} for listing ${i} due to error: ${error.message}`);
      }
    }

    out.push(item);
  }

  return { listings: out, attachments };
};

export const send = async ({ serviceName, newListings, notificationConfig, jobKey, baseUrl }) => {
  const { apiPublicKey, apiPrivateKey, receiver, from } = notificationConfig.find(
    (adapter) => adapter.id === config.id,
  ).fields;

  const to = receiver
    .trim()
    .split(',')
    .map((r) => ({ Email: r.trim() }))
    .filter((r) => r.Email.length > 0);

  const { listings, attachments } = await mapListingsWithCid(serviceName, jobKey, newListings, baseUrl);

  const html = emailTemplate({
    serviceName: `Job: (${jobKey}) | Service: ${serviceName}`,
    numberOfListings: listings.length,
    listings,
  });

  return mailjet
    .apiConnect(apiPublicKey, apiPrivateKey)
    .post('send', { version: 'v3.1' })
    .request({
      Messages: [
        {
          From: { Email: from, Name: 'Fredy' },
          To: to,
          Subject: `Fredy found ${listings.length} new listing(s) for ${serviceName}`,
          HTMLPart: html,
          InlinedAttachments: attachments,
        },
      ],
    });
};

/**
 * @param {{serviceName: string, priceChanges: any[], notificationConfig: any[], jobKey: string, baseUrl: string}} params
 * @returns {Promise<any>}
 */
export const sendPriceChange = async ({ serviceName, priceChanges, notificationConfig, jobKey, baseUrl }) => {
  const { apiPublicKey, apiPrivateKey, receiver, from } = notificationConfig.find(
    (adapter) => adapter.id === config.id,
  ).fields;

  const to = receiver
    .trim()
    .split(',')
    .map((r) => ({ Email: r.trim() }))
    .filter((r) => r.Email.length > 0);

  const { listings: changes, attachments } = await mapListingsWithCid(
    serviceName,
    jobKey,
    priceChanges.map(toPriceChangeListing),
    baseUrl,
  );

  const html = emailTemplate({
    serviceName: `Job: (${jobKey}) | Service: ${serviceName}`,
    numberOfListings: changes.length,
    listings: changes,
  });

  return mailjet
    .apiConnect(apiPublicKey, apiPrivateKey)
    .post('send', { version: 'v3.1' })
    .request({
      Messages: [
        {
          From: { Email: from, Name: 'Fredy' },
          To: to,
          Subject: `Fredy found ${changes.length} price change(s) for ${serviceName}`,
          HTMLPart: html,
          InlinedAttachments: attachments,
        },
      ],
    });
};

export const config = {
  id: 'mailjet',
  name: 'MailJet',
  description: 'MailJet is being used to send new listings via mail.',
  readme: readAdapterReadme('mailJet.md'),
  fields: {
    apiPublicKey: {
      type: 'text',
      label: 'Public Api Key',
      description: 'The public api key needed to access this service.',
      // Never leaves the server for anyone who may not edit this channel.
      secret: true,
    },
    apiPrivateKey: {
      type: 'text',
      label: 'Private Api Key',
      description: 'The private api key needed to access this service.',
      secret: true,
    },
    receiver: {
      type: 'email',
      label: 'Receiver Email',
      description: 'The email address (single one) which Fredy is using to send notifications to.',
      // Shown as the channel's destination in the UI.
      target: true,
    },
    from: {
      type: 'email',
      label: 'Sender email',
      description:
        'The email address from which Fredy send email. Beware, this email address needs to be verified by Sendgrid.',
    },
  },
};
