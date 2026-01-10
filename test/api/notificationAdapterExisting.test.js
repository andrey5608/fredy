/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { expect } from 'chai';
import { collectExistingAdapters } from '../../lib/api/routes/notificationAdapterRouter.js';

const baseAdapter = { id: 'telegram', fields: { token: 'abc' } };
const altAdapter = { id: 'telegram', fields: { token: 'def' }, name: 'Telegram B' };
const emailAdapter = { id: 'email', name: 'Email', fields: { to: 'user@example.com' } };

function makeJob({ id, userId, adapters, sharedWith = [], name }) {
  return {
    id,
    userId,
    name,
    shared_with_user: sharedWith,
    notificationAdapter: adapters,
  };
}

describe('collectExistingAdapters', () => {
  it('returns all unique adapters for admin', () => {
    const jobs = [
      makeJob({ id: 'j1', userId: 'u1', adapters: [baseAdapter], name: 'Job One' }),
      makeJob({ id: 'j2', userId: 'u2', adapters: [baseAdapter, emailAdapter], name: 'Job Two' }),
    ];

    const result = collectExistingAdapters({ jobs, currentUser: 'admin', isAdmin: true });
    expect(result).to.have.length(2);
    expect(result.map((a) => a.id)).to.have.members(['telegram', 'email']);
    const telegram = result.find((a) => a.id === 'telegram');
    expect(telegram.sourceJobId).to.equal('j1');
    expect(telegram.sourceJobName).to.equal('Job One');
    expect(telegram.name).to.equal('telegram'); // falls back to id when name missing
  });

  it('filters adapters by ownership and sharing for non-admin', () => {
    const jobs = [
      makeJob({ id: 'j1', userId: 'u1', adapters: [baseAdapter] }),
      makeJob({ id: 'j2', userId: 'u2', adapters: [altAdapter], sharedWith: ['u1'], name: 'Shared Job' }),
      makeJob({ id: 'j3', userId: 'u3', adapters: [emailAdapter] }),
    ];

    const result = collectExistingAdapters({ jobs, currentUser: 'u1', isAdmin: false });
    expect(result).to.have.length(2);
    expect(result.map((a) => a.id)).to.have.members(['telegram', 'telegram']);
    const shared = result.find((a) => a.sourceJobId === 'j2');
    expect(shared.name).to.equal('Telegram B');
  });

  it('deduplicates adapters with identical id and fields', () => {
    const jobs = [
      makeJob({ id: 'j1', userId: 'u1', adapters: [baseAdapter] }),
      makeJob({ id: 'j2', userId: 'u1', adapters: [baseAdapter] }),
    ];

    const result = collectExistingAdapters({ jobs, currentUser: 'u1', isAdmin: false });
    expect(result).to.have.length(1);
    expect(result[0].sourceJobId).to.equal('j1');
  });
});
