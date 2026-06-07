import { describe, it, beforeEach, expect, vi } from 'vitest';

describe('listingsStorage#getProviderDistributionForJobIds', () => {
  let getProviderDistributionForJobIds;
  let jobs;
  let insertJob;

  beforeEach(async () => {
    jobs = new Map();
    vi.resetModules();

    vi.doMock('../../../lib/services/storage/SqliteConnection.js', () => ({
      default: {
        query: (_sql, params) => {
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
      },
    }));

    ({ getProviderDistributionForJobIds } = await import('../../../lib/services/storage/listingsStorage.js'));

    insertJob = ({ id, providerJson }) => {
      const providers = typeof providerJson === 'string' ? JSON.parse(providerJson) : providerJson;
      jobs.set(id, providers || []);
    };
  });

  it('returns empty array when no jobIds provided', () => {
    const result = getProviderDistributionForJobIds([]);
    expect(result).toEqual([]);
  });

  it('counts all providers across jobs and returns percentages', () => {
    insertJob({ id: 'j1', providerJson: [{ id: 'immoscout' }, { id: 'immowelt' }] });
    insertJob({ id: 'j2', providerJson: [{ id: 'immoscout' }] });

    const result = getProviderDistributionForJobIds(['j1', 'j2']);
    expect(result).toHaveLength(2);

    const map = Object.fromEntries(result.map((r) => [r.type, r.value]));
    expect(map.immoscout).toBe(67);
    expect(map.immowelt).toBe(33);
    expect(result.reduce((s, r) => s + r.value, 0)).toBe(100);
  });

  it('handles drift correction when rounding', () => {
    insertJob({ id: 'j1', providerJson: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });

    const result = getProviderDistributionForJobIds(['j1']);
    expect(result.reduce((s, r) => s + r.value, 0)).toBe(100);
  });
});
