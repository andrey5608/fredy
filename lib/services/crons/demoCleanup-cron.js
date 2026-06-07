/*
 * Copyright (c) 2025 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import cron from 'node-cron';
import { removeJobsByUserId } from '../storage/jobStorage.js';
import { getUsers } from '../storage/userStorage.js';
import { getSettings } from '../storage/settingsStorage.js';
import logger from '../logger.js';

/**
 * if we are running in demo environment, we have to cleanup the db files (specifically the jobs table)
 */
export function cleanupDemoAtMidnight() {
  cron.schedule('0 0 * * *', cleanup);
}

async function cleanup() {
  const settings = await getSettings();
  if (settings.demoMode) {
    const demoUser = getUsers(false).find((user) => user.username === 'demo');
    if (demoUser == null) {
      logger.error('Demo user not found, cannot remove Jobs');
      return;
    }
    removeJobsByUserId(demoUser.id);
  }
}
