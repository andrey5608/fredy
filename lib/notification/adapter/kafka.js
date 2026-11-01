/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Kafka, logLevel } from 'kafkajs';
import { readAdapterReadme } from '../../services/markdown.js';
import { toPriceChangeListing } from '../priceChangeMessage.js';

/**
 * The listing as it goes onto the topic. Deliberately has no picture field of any kind: this
 * channel carries the facts about an advert, and a consumer that wants photos follows `url`.
 */
const mapListing = (listing, baseUrl) => ({
  id: listing.id,
  title: listing.title,
  price: listing.price,
  size: listing.size,
  rooms: listing.rooms,
  address: listing.address,
  description: listing.description,
  // Absent rather than null when nothing was routed, like on the http channel.
  ...(listing.commute ? { commute: listing.commute } : {}),
  url: listing.link,
  fredyUrl: baseUrl && listing.id ? `${baseUrl}/#/listings/listing/${listing.id}` : null,
});

const parseBrokers = (text) =>
  String(text ?? '')
    .split(/[,;\s]+/)
    .filter((broker) => broker !== '');

const MECHANISMS = ['plain', 'scram-sha-256', 'scram-sha-512'];

/**
 * The topic of a job when the channel names none: `fredy.<jobId>`, so every job gets its own.
 * Kafka allows only letters, digits, `.`, `_` and `-` in a topic name; anything else is replaced.
 */
const topicFor = ({ topic }, jobKey) => {
  const named = typeof topic === 'string' ? topic.trim() : '';
  return named !== '' ? named : `fredy.${jobKey}`.replace(/[^a-zA-Z0-9._-]/g, '_');
};

/**
 * Credentials for the broker. SASL is on only when a username is given; TLS is a separate switch
 * because a SASL login over plain text is a choice some local setups make.
 *
 * @param {Record<string, any>} fields The channel's fields.
 * @returns {{ssl?: boolean, sasl?: Object}}
 */
const securityFor = ({ ssl, saslMechanism, username, password }) => {
  const security = ssl === true ? { ssl: true } : {};
  const user = typeof username === 'string' ? username.trim() : '';
  if (user === '') return security;
  const mechanism = (saslMechanism ?? '').trim().toLowerCase() || 'plain';
  if (!MECHANISMS.includes(mechanism)) {
    throw new Error(`Kafka channel: SASL mechanism must be one of ${MECHANISMS.join(', ')}.`);
  }
  return { ...security, sasl: { mechanism, username: user, password: password ?? '' } };
};

/**
 * Connect, produce one batch, disconnect. A connection per batch rather than a cached producer:
 * a batch comes once per run, and a channel whose brokers were edited has nothing stale to evict.
 *
 * @param {Record<string, any>} fields The channel's fields.
 * @param {string} jobKey
 * @param {Array<{key: string, value: Object}>} messages
 * @returns {Promise<void>}
 */
const produce = async (fields, jobKey, messages) => {
  const brokers = parseBrokers(fields.brokers);
  if (brokers.length === 0) {
    throw new Error('Kafka channel needs at least one broker.');
  }
  const kafka = new Kafka({
    clientId: 'fredy',
    brokers,
    ...securityFor(fields),
    connectionTimeout: 5000,
    requestTimeout: 10000,
    retry: { retries: 2 },
    logLevel: logLevel.NOTHING,
  });
  const producer = kafka.producer();
  await producer.connect();
  try {
    await producer.send({
      topic: topicFor(fields, jobKey),
      messages: messages.map(({ key, value }) => ({ key, value: JSON.stringify(value) })),
    });
  } finally {
    await producer.disconnect().catch(() => {});
  }
};

const fieldsOf = (notificationConfig) => notificationConfig.find((a) => a.id === config.id).fields;

export const send = ({ serviceName, newListings, notificationConfig, jobKey, baseUrl }) => {
  const timestamp = new Date().toISOString();
  return produce(
    fieldsOf(notificationConfig),
    jobKey,
    newListings.map((listing) => ({
      key: String(listing.id),
      value: {
        event: 'newListing',
        jobId: jobKey,
        provider: serviceName,
        timestamp,
        listing: mapListing(listing, baseUrl),
      },
    })),
  );
};

/**
 * Price changes go to the same topic under their own `event`, so one consumer can tell the two
 * apart without guessing from the shape.
 */
export const sendPriceChange = ({ serviceName, priceChanges, notificationConfig, jobKey, baseUrl }) => {
  const timestamp = new Date().toISOString();
  return produce(
    fieldsOf(notificationConfig),
    jobKey,
    priceChanges.map((change) => ({
      key: String(change.id),
      value: {
        event: 'priceChange',
        jobId: jobKey,
        provider: serviceName,
        timestamp,
        listing: {
          ...mapListing(toPriceChangeListing(change), baseUrl),
          oldPrice: change.oldPrice,
          newPrice: change.newPrice,
          changePercent: change.changePercent,
          direction: change.direction,
        },
      },
    })),
  );
};

export const config = {
  id: 'kafka',
  name: 'Kafka / Redpanda',
  readme: readAdapterReadme('kafka.md'),
  description: 'Fredy will publish every new listing, without photos, to a Kafka topic.',
  fields: {
    brokers: {
      type: 'text',
      label: 'Brokers',
      description: 'Comma separated bootstrap servers, e.g. redpanda:9092.',
      // Shown as the channel's destination in the UI.
      target: true,
    },
    topic: {
      type: 'text',
      optional: true,
      label: 'Topic (optional)',
      description: 'The topic the listings are written to. Left empty, every job writes to its own: fredy.<jobId>.',
    },
    ssl: {
      type: 'boolean',
      label: 'TLS',
      description: 'Connect to the brokers over TLS.',
    },
    username: {
      type: 'text',
      optional: true,
      label: 'SASL username (optional)',
      description: 'Optional: turns SASL on. Leave empty for a broker without authentication.',
    },
    password: {
      type: 'text',
      optional: true,
      label: 'SASL password (optional)',
      description: 'Optional: password for the SASL username.',
      secret: true,
    },
    saslMechanism: {
      type: 'text',
      optional: true,
      label: 'SASL mechanism (optional)',
      description: 'plain, scram-sha-256 or scram-sha-512. Defaults to plain.',
    },
  },
};
