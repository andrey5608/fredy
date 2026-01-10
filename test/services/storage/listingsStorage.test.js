import { expect } from 'chai';
import esmock from 'esmock';

describe('listingsStorage#getProviderDistributionForJobIds', () => {
  let getProviderDistributionForJobIds;
  let calls;
  let jobs;
  let insertJob;

  beforeEach(async () => {
    jobs = new Map();
    calls = { query: [] };

    const SqliteMock = {
      query: (sql, params) => {
        calls.query.push({ sql, params });
        const ids = Array.isArray(params) ? params : [];
        const counts = new Map();

        for (const jobId of ids) {
          const providers = jobs.get(jobId) || [];
          for (const provider of providers) {
            const providerId = provider?.id;
            if (!providerId) continue;
            counts.set(providerId, (counts.get(providerId) || 0) + 1);
          }
        }

        return Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([providerId, cnt]) => ({ providerId, cnt }));
      },
    };

    ({ getProviderDistributionForJobIds } = await esmock(
      '../../../lib/services/storage/listingsStorage.js',
      {},
      { '../../../lib/services/storage/SqliteConnection.js': SqliteMock },
    ));

    // Lightweight helper to seed jobs with provider JSON arrays
    insertJob = ({ id, providerJson }) => {
      const providers = typeof providerJson === 'string' ? JSON.parse(providerJson) : providerJson;
      jobs.set(id, providers || []);
    };
  });

  it('returns empty array when no jobIds provided', () => {
    const result = getProviderDistributionForJobIds([]);
    expect(result).to.deep.equal([]);
  });

  it('counts all providers across jobs and returns percentages', () => {
    insertJob({ id: 'j1', providerJson: [{ id: 'immoscout' }, { id: 'immowelt' }] });
    insertJob({ id: 'j2', providerJson: [{ id: 'immoscout' }] });

    const result = getProviderDistributionForJobIds(['j1', 'j2']);
    expect(result).to.have.length(2);

    const map = Object.fromEntries(result.map((r) => [r.type, r.value]));
    expect(map.immoscout).to.equal(67); // 2 of 3 providers
    expect(map.immowelt).to.equal(33); // 1 of 3 providers
    expect(result.reduce((s, r) => s + r.value, 0)).to.equal(100);
  });

  it('handles drift correction when rounding', () => {
    insertJob({ id: 'j1', providerJson: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });

    const result = getProviderDistributionForJobIds(['j1']);
    expect(result.reduce((s, r) => s + r.value, 0)).to.equal(100);
  });
});
