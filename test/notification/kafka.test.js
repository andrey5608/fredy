/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const producer = { connect: vi.fn(), send: vi.fn(), disconnect: vi.fn() };
const kafkaOptions = [];
vi.mock('kafkajs', () => ({
  logLevel: { NOTHING: 0 },
  Kafka: class {
    constructor(options) {
      kafkaOptions.push(options);
    }
    producer() {
      return producer;
    }
  },
}));

const { send, sendPriceChange, config } = await import('../../lib/notification/adapter/kafka.js');

const channel = (fields = {}) => ({ id: 'kafka', fields: { brokers: 'redpanda:9092, other:9092', ...fields } });
const listing = {
  id: 'a1',
  title: 'Flat',
  price: '900 €',
  size: '40 m²',
  rooms: 2,
  address: 'Somewhere 1',
  description: 'Nice',
  link: 'https://portal.example/a1',
  image: 'https://cdn.example.com/0.jpg',
  images: ['https://cdn.example.com/0.jpg', 'https://cdn.example.com/1.jpg'],
};
const run = (fields, jobKey = 'job-1') =>
  send({ serviceName: 'immowelt', newListings: [listing], notificationConfig: [channel(fields)], jobKey });

const sentMessages = () =>
  producer.send.mock.calls[0][0].messages.map((m) => ({ key: m.key, value: JSON.parse(m.value) }));

describe('kafka adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kafkaOptions.length = 0;
    producer.connect.mockResolvedValue();
    producer.send.mockResolvedValue();
    producer.disconnect.mockResolvedValue();
  });

  it('writes one message per listing, keyed by the listing id', async () => {
    await send({
      serviceName: 'immowelt',
      newListings: [listing, { ...listing, id: 'b2' }],
      notificationConfig: [channel({ topic: 'all.listings' })],
      jobKey: 'job-1',
      baseUrl: 'http://fredy:9998',
    });

    expect(kafkaOptions[0].brokers).toEqual(['redpanda:9092', 'other:9092']);
    expect(producer.send.mock.calls[0][0].topic).toBe('all.listings');
    const messages = sentMessages();
    expect(messages.map((m) => m.key)).toEqual(['a1', 'b2']);
    expect(messages[0].value).toMatchObject({
      event: 'newListing',
      jobId: 'job-1',
      provider: 'immowelt',
      listing: {
        id: 'a1',
        title: 'Flat',
        rooms: 2,
        url: 'https://portal.example/a1',
        fredyUrl: 'http://fredy:9998/#/listings/listing/a1',
      },
    });
  });

  it('carries no photo, whatever the listing holds', async () => {
    await run({});

    const raw = producer.send.mock.calls[0][0].messages[0].value;
    expect(raw).not.toMatch(/cdn\.example\.com/);
    expect(raw).not.toMatch(/"images?(Urls?)?"/);
  });

  it('gives each job its own topic when the channel names none', async () => {
    await run({}, 'mg1waX4RHmIzL5NDYtYp-');

    expect(producer.send.mock.calls[0][0].topic).toBe('fredy.mg1waX4RHmIzL5NDYtYp-');
  });

  it('keeps a topic name legal for Kafka', async () => {
    await run({ topic: '  ' }, 'job with/odd chars');

    expect(producer.send.mock.calls[0][0].topic).toBe('fredy.job_with_odd_chars');
  });

  it('marks a price change with its own event and the old and new price', async () => {
    await sendPriceChange({
      serviceName: 'immowelt',
      priceChanges: [
        {
          ...listing,
          oldPrice: '1.000 €',
          newPrice: '900 €',
          changePercent: '-10%',
          direction: 'down',
          changeHeadline: 'Price drop',
        },
      ],
      notificationConfig: [channel({ topic: 't' })],
      jobKey: 'job-1',
    });

    expect(sentMessages()[0].value).toMatchObject({
      event: 'priceChange',
      listing: { id: 'a1', oldPrice: '1.000 €', newPrice: '900 €', direction: 'down' },
    });
  });

  describe('security', () => {
    it('connects without authentication when no username is given', async () => {
      await run({ password: 'ignored' });

      expect(kafkaOptions[0].sasl).toBeUndefined();
      expect(kafkaOptions[0].ssl).toBeUndefined();
    });

    it('logs in with SASL plain by default once a username is given', async () => {
      await run({ username: 'fredy', password: 'secret' });

      expect(kafkaOptions[0].sasl).toEqual({ mechanism: 'plain', username: 'fredy', password: 'secret' });
    });

    it('takes the mechanism and TLS switch as configured', async () => {
      await run({ username: 'fredy', password: 'secret', saslMechanism: 'SCRAM-SHA-512', ssl: true });

      expect(kafkaOptions[0].sasl.mechanism).toBe('scram-sha-512');
      expect(kafkaOptions[0].ssl).toBe(true);
    });

    it('refuses an unknown mechanism before opening a connection', async () => {
      await expect(run({ username: 'fredy', saslMechanism: 'kerberos' })).rejects.toThrow(/mechanism/);
      expect(producer.connect).not.toHaveBeenCalled();
    });

    it('marks only the password as a secret', () => {
      const secrets = Object.entries(config.fields)
        .filter(([, field]) => field.secret)
        .map(([name]) => name);
      expect(secrets).toEqual(['password']);
    });
  });

  it('disconnects even when the broker refuses the batch, and rejects', async () => {
    producer.send.mockRejectedValue(new Error('broker down'));

    await expect(run({})).rejects.toThrow('broker down');
    expect(producer.disconnect).toHaveBeenCalledOnce();
  });

  it('refuses a channel without brokers before opening a connection', async () => {
    await expect(run({ brokers: ' ' })).rejects.toThrow(/broker/);
    expect(producer.connect).not.toHaveBeenCalled();
  });
});
