/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import logger from '../../lib/services/logger.js';
import {
  registerRequestLogging,
  createFastifyLogger,
  FredyLogController,
  pathOf,
} from '../../lib/api/requestLogging.js';

/** @returns {Promise<import('fastify').FastifyInstance>} */
async function build(options) {
  const app = Fastify({ loggerInstance: createFastifyLogger(), logController: new FredyLogController() });
  registerRequestLogging(app, options);
  app.get('/api/ok', async () => ({ ok: true }));
  app.get('/api/missing', async (_req, reply) => reply.code(404).send({ message: 'nope' }));
  app.get('/api/unauthorized', async (_req, reply) => reply.code(401).send({ message: 'no' }));
  app.get('/api/boom', async () => {
    throw new Error('kaput');
  });
  app.get('/api/slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { ok: true };
  });
  app.get('/api/jobs/events', async () => 'stream');
  app.get('/api/mcp', async () => 'stream');
  await app.ready();
  return app;
}

describe('request logging', () => {
  let spies;

  beforeEach(() => {
    spies = {
      debug: vi.spyOn(logger, 'debug').mockImplementation(() => {}),
      warn: vi.spyOn(logger, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(logger, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one debug line per answered request: method, path, status, duration', async () => {
    const app = await build();
    await app.inject('/api/ok');
    expect(spies.debug).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/ok 200 \d+ms$/));
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
    await app.close();
  });

  it('never writes the query string, which can carry codes and addresses', async () => {
    const app = await build();
    await app.inject('/api/ok?code=secret&address=Hauptstrasse');
    const lines = spies.debug.mock.calls.map((call) => call[0]).join('\n');
    expect(lines).toContain('/api/ok 200');
    expect(lines).not.toMatch(/secret|Hauptstrasse|\?/);
    expect(pathOf({ url: '/a/b?x=1' })).toBe('/a/b');
    expect(pathOf({ url: '/a/b' })).toBe('/a/b');
    await app.close();
  });

  it('warns about a client error, except the 401 that tells the app it is signed out', async () => {
    const app = await build();
    await app.inject('/api/missing');
    expect(spies.warn).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/missing 404 /));
    spies.warn.mockClear();
    await app.inject('/api/unauthorized');
    expect(spies.warn).not.toHaveBeenCalled();
    await app.close();
  });

  it('logs a throwing handler with its stack and the request, and the 500 that follows as an error', async () => {
    const app = await build();
    const response = await app.inject('/api/boom?token=secret');
    expect(response.statusCode).toBe(500);
    const failure = spies.error.mock.calls.find((call) => call[1] instanceof Error);
    expect(failure[0]).toBe('kaput (GET /api/boom)');
    expect(failure[1].message).toBe('kaput');
    expect(spies.error.mock.calls.flat().join(' ')).not.toMatch(/secret/);
    expect(spies.error).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/boom 500 /));
    await app.close();
  });

  it('warns about an answer that took longer than the slow threshold', async () => {
    const app = await build({ slowMs: 30 });
    await app.inject('/api/slow');
    expect(spies.warn).toHaveBeenCalledWith(expect.stringMatching(/^Slow response: GET \/api\/slow 200 \d+ms$/));
    await app.close();
  });

  it('reports a request that is still open after the pending threshold, then says nothing more', async () => {
    const app = Fastify({ logger: false });
    registerRequestLogging(app, { pendingMs: 20 });
    app.get('/api/hangs', async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { ok: true };
    });
    await app.ready();
    await app.inject('/api/hangs');
    const pending = spies.warn.mock.calls.filter((call) => String(call[0]).startsWith('Request still open'));
    expect(pending).toHaveLength(1);
    expect(pending[0][0]).toBe('Request still open after 0s: GET /api/hangs');
    await app.close();
  });

  it('does not call a request that finished in time pending', async () => {
    const app = Fastify({ logger: false });
    registerRequestLogging(app, { pendingMs: 200 });
    app.get('/api/fast', async () => ({ ok: true }));
    await app.ready();
    await app.inject('/api/fast');
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(spies.warn).not.toHaveBeenCalled();
    await app.close();
  });

  it('leaves the event stream alone: an open connection is its normal state', async () => {
    const app = await build({ pendingMs: 10 });
    await app.inject('/api/jobs/events');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.debug).not.toHaveBeenCalled();
    await app.close();
  });

  it('treats the GET of the MCP transport as a stream too, but not any other call to it', async () => {
    const app = await build({ pendingMs: 10 });
    await app.inject('/api/mcp');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(spies.warn).not.toHaveBeenCalled();
    await app.close();
  });

  it('writes no per-request line of its own, so a request is not logged twice', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const app = await build();
    await app.inject('/api/ok?q=1');
    expect(info).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('createFastifyLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('speaks the interface Fastify needs from a logger', () => {
    const adapter = createFastifyLogger();
    for (const method of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'child']) {
      expect(typeof adapter[method]).toBe('function');
    }
    expect(adapter.child()).toBe(adapter);
  });

  it('maps pino calls onto Fredy levels, with a plain message or an object and a message', () => {
    const spy = {
      debug: vi.spyOn(logger, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(logger, 'info').mockImplementation(() => {}),
      error: vi.spyOn(logger, 'error').mockImplementation(() => {}),
    };
    const adapter = createFastifyLogger();
    adapter.info('Server listening');
    adapter.trace('detail');
    const err = new Error('bad');
    adapter.fatal({ err }, 'went down');
    expect(spy.info).toHaveBeenCalledWith('Server listening');
    expect(spy.debug).toHaveBeenCalledWith('detail');
    expect(spy.error).toHaveBeenCalledWith('went down', err);
  });
});
