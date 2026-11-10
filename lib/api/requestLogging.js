/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { LogController } from 'fastify';
import logger from '../services/logger.js';

/** A response slower than this is a warning rather than a debug line. */
export const SLOW_RESPONSE_MS = 1_000;

/** A request without an answer after this long is reported while it is still open. */
export const PENDING_REQUEST_MS = 10_000;

/**
 * The path of a request, without its query string. Queries carry OAuth codes, search text and
 * addresses, none of which belongs in a log that gets pasted into bug reports.
 *
 * @param {{url: string}} request
 * @returns {string}
 */
export function pathOf(request) {
  const url = request.url ?? '';
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Whether a request holds its connection open on purpose, so "no answer yet" is its normal state and
 * not a hang: the job status stream (`.../events`, Server-Sent Events) and the GET of the MCP
 * transport, which is its server-to-client event stream.
 *
 * @param {string} path
 * @param {string} method
 * @returns {boolean}
 */
const isLongLived = (path, method) => path.endsWith('/events') || (method === 'GET' && path === '/api/mcp');

/**
 * Fastify's `loggerInstance`: its own logging, routed into Fredy's logger.
 *
 * Fastify used to run with `logger: false`, which silenced everything it knows - a handler that
 * threw, a 500, a plugin that failed - so a page whose data did not load left nothing in the log to
 * tell "the handler crashed" from "the request never arrived". This keeps its output on, in Fredy's
 * format and under `LOG_LEVEL`, instead of pulling in a second logger with its own format.
 *
 * Fastify's per-request lines are switched off where this is used ({@link FredyLogController}): they
 * print the full URL, query string included, and {@link registerRequestLogging} already writes one
 * line per request.
 *
 * Fastify speaks the pino interface: `log(message)` or `log(object, message)`, with the error under
 * `err` and the request under `req`.
 *
 * @returns {Record<string, Function>}
 */
export function createFastifyLogger() {
  const emit = (level) => (first, second) => {
    if (typeof first === 'string') {
      logger[level](first);
      return;
    }
    const err = first instanceof Error ? first : (first?.err ?? null);
    const req = first?.req;
    const where = req?.method ? ` (${req.method} ${pathOf(req)})` : '';
    const message = `${typeof second === 'string' ? second : (err?.message ?? 'Fastify')}${where}`;
    if (err) {
      logger[level](message, err);
    } else {
      logger[level](message);
    }
  };

  const adapter = {
    trace: emit('debug'),
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('error'),
    silent: () => {},
    level: 'trace',
    child: () => adapter,
  };
  return adapter;
}

/**
 * Which of Fastify's own log lines Fredy keeps. Errors stay: a handler that threw is logged by
 * Fastify with its stack (an `error` for a 5xx), and so is a route that does not exist. The two
 * lines written for every request are dropped, because they carry the full URL and
 * {@link registerRequestLogging} writes the same fact with the query string left out. This is
 * `LogController`, not the `disableRequestLogging` option, which also silences the error line and
 * is deprecated.
 */
export class FredyLogController extends LogController {
  incomingRequest() {}

  requestCompleted() {}
}

/**
 * Makes the HTTP layer visible in the log. Fastify runs with its own logger off, so until this
 * existed a failing handler, a slow one and one that never answered left nothing behind, and the
 * only symptom was a page whose data does not load.
 *
 * - every answered request: one `debug` line, method, path, status and duration. Visible with
 *   `LOG_LEVEL=debug`.
 * - a status of 500 or more is an `error`, a 4xx a `warn` (a 401 on the login probe is the normal
 *   way the app learns it is signed out, so that one stays `debug`), a slow answer a `warn`.
 * - a handler that throws is an `error` with its stack, whatever the client is then told. That line
 *   comes from Fastify's own logger, which {@link createFastifyLogger} routes into ours.
 * - a request still open after {@link PENDING_REQUEST_MS} is a `warn`, once, naming it; this is the
 *   line that answers "where does it hang".
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{slowMs?: number, pendingMs?: number}} [options] Thresholds, overridable for tests.
 * @returns {void}
 */
export function registerRequestLogging(fastify, { slowMs = SLOW_RESPONSE_MS, pendingMs = PENDING_REQUEST_MS } = {}) {
  fastify.addHook('onRequest', async (request, reply) => {
    request.fredyStartedAt = Date.now();
    const path = pathOf(request);
    if (isLongLived(path, request.method)) return;

    const timer = setTimeout(() => {
      logger.warn(`Request still open after ${Math.round(pendingMs / 1000)}s: ${request.method} ${path}`);
    }, pendingMs);
    timer.unref?.();
    // The response's 'close' fires when the answer is complete and also when the client gives up, so
    // one listener clears the timer on every way a request can end. The request's own 'close' is not
    // that signal: since Node 16 it fires once the body has been read, long before the answer.
    reply.raw.once('close', () => clearTimeout(timer));
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const path = pathOf(request);
    if (isLongLived(path, request.method)) return;

    const ms = Date.now() - (request.fredyStartedAt ?? Date.now());
    const status = reply.statusCode;
    const line = `${request.method} ${path} ${status} ${ms}ms`;
    if (status >= 500) {
      logger.error(line);
    } else if (ms >= slowMs) {
      logger.warn(`Slow response: ${line}`);
    } else if (status >= 400 && status !== 401) {
      logger.warn(line);
    } else {
      logger.debug(line);
    }
  });
}
