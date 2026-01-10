/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Copyright (c) 2025 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import restana from 'restana';
import { isAdmin } from '../security.js';
import * as jobStorage from '../../services/storage/jobStorage.js';

const service = restana();
const notificationAdapterRouter = service.newRouter();
const notificationAdapterList = fs.readdirSync('./lib//notification/adapter').filter((file) => file.endsWith('.js'));
const notificationAdapter = await Promise.all(
  notificationAdapterList.map(async (pro) => {
    return await import(`../../notification/adapter/${pro}`);
  }),
);

function canUserAccessJob(job, currentUser, canSeeAll) {
  if (canSeeAll) return true;
  if (!currentUser) return false;
  const sharedWith = Array.isArray(job.shared_with_user) ? job.shared_with_user : [];
  return job.userId === currentUser || sharedWith.includes(currentUser);
}

export function collectExistingAdapters({ jobs = [], currentUser = null, isAdmin: canSeeAll = false } = {}) {
  const accessibleJobs = jobs.filter((job) => canUserAccessJob(job, currentUser, canSeeAll));

  const unique = new Map();
  accessibleJobs.forEach((job) => {
    (job.notificationAdapter || []).forEach((adapterConfig) => {
      const key = JSON.stringify({ id: adapterConfig.id, fields: adapterConfig.fields });
      if (!unique.has(key)) {
        unique.set(key, {
          ...adapterConfig,
          name: adapterConfig.name ?? adapterConfig.id,
          sourceJobId: job.id,
          sourceJobName: job.name ?? 'Unnamed Job',
        });
      }
    });
  });

  return Array.from(unique.values());
}
notificationAdapterRouter.post('/try', async (req, res) => {
  const { id, fields } = req.body;
  const adapter = notificationAdapter.find((adapter) => adapter.config.id === id);
  if (adapter == null) {
    res.send(404);
  }
  const notificationConfig = [];
  const notificationObject = {};
  Object.keys(fields).forEach((key) => {
    notificationObject[key] = fields[key].value;
  });
  notificationConfig.push({
    fields: { ...notificationObject },
    enabled: true,
    id,
  });
  try {
    await adapter.send({
      serviceName: 'TestCall',
      newListings: [
        {
          price: '42 €',
          title: 'This is a test listing',
          address: 'some address',
          size: '666 2m',
          link: 'https://www.orange-coding.net',
        },
      ],
      notificationConfig,
      jobKey: 'TestJob',
    });
    res.send();
  } catch (Exception) {
    res.send(new Error(Exception));
  }
});
notificationAdapterRouter.get('/', async (req, res) => {
  res.body = notificationAdapter.map((adapter) => adapter.config);
  res.send();
});

notificationAdapterRouter.get('/existing', async (req, res) => {
  const currentUser = req.session.currentUser;
  const canSeeAll = isAdmin(req);

  try {
    const jobs = jobStorage.getJobs();
    res.body = collectExistingAdapters({ jobs, currentUser, isAdmin: canSeeAll });
    res.send();
  } catch (error) {
    res.send(new Error('Error while fetching existing notification adapters.', { cause: error }));
  }
});
export { notificationAdapterRouter };
