/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { resolveMinLevel } from '../../lib/services/logger.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

describe('resolveMinLevel', () => {
  it('prints debug in development and starts at info everywhere else, as it always did', () => {
    expect(resolveMinLevel(undefined, 'development')).toBe(LEVELS.debug);
    expect(resolveMinLevel(undefined, 'production')).toBe(LEVELS.info);
    expect(resolveMinLevel('', 'production')).toBe(LEVELS.info);
  });

  it('lets LOG_LEVEL turn debug on in production, whatever its case or padding', () => {
    expect(resolveMinLevel('debug', 'production')).toBe(LEVELS.debug);
    expect(resolveMinLevel(' DEBUG ', 'production')).toBe(LEVELS.debug);
  });

  it('lets LOG_LEVEL quieten development as well', () => {
    expect(resolveMinLevel('warn', 'development')).toBe(LEVELS.warn);
    expect(resolveMinLevel('error', 'development')).toBe(LEVELS.error);
  });

  it('ignores a value that is not a level instead of silencing the log', () => {
    expect(resolveMinLevel('verbose', 'production')).toBe(LEVELS.info);
    expect(resolveMinLevel('toString', 'production')).toBe(LEVELS.info);
  });
});
