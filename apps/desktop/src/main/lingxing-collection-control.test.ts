import { describe, expect, it } from 'vitest';
import type {
  LingxingCollectionJobSnapshot,
  StoreId,
} from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { bindLingxingCollectionCancellation } from './lingxing-collection-control';

const storeA = 'store-a' as StoreId;
const storeB = 'store-b' as StoreId;

function job(
  storeId: StoreId,
  jobId: string,
  requestId: string,
  state: LingxingCollectionJobSnapshot['state'] = 'running',
): LingxingCollectionJobSnapshot {
  return {
    jobId,
    request: {
      requestId,
      storeContext: normalizeStoreContextEnvelope({
        storeId,
        browserProfileId: `profile-${storeId}`,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
        businessDate: '2026-07-22',
        sessionGeneration: 1,
      }),
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: ['campaign'],
    },
    state,
    reports: [],
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:01:00.000Z',
  };
}

describe('bindLingxingCollectionCancellation', () => {
  const jobs = new Map([
    [`${storeA}:job-a`, job(storeA, 'job-a', 'request-shared')],
    [`${storeB}:job-b`, job(storeB, 'job-b', 'request-shared')],
    [`${storeA}:job-complete`, job(storeA, 'job-complete', 'request-complete', 'completed')],
  ]);
  const repository = {
    getCollectionJobForStore(storeId: StoreId, jobId: string) {
      return jobs.get(`${storeId}:${jobId}`);
    },
  };

  it('returns the exact current-store job/request identity', () => {
    expect(bindLingxingCollectionCancellation(repository, storeA, {
      requestId: 'request-shared',
      jobId: 'job-a',
    })).toEqual({ storeId: storeA, requestId: 'request-shared', jobId: 'job-a' });
  });

  it('rejects cross-store, mismatched, terminal and malformed targets', () => {
    expect(() => bindLingxingCollectionCancellation(repository, storeA, {
      requestId: 'request-shared',
      jobId: 'job-b',
    })).toThrow(/当前店铺同一任务/);
    expect(() => bindLingxingCollectionCancellation(repository, storeA, {
      requestId: 'different-request',
      jobId: 'job-a',
    })).toThrow(/当前店铺同一任务/);
    expect(() => bindLingxingCollectionCancellation(repository, storeA, {
      requestId: 'request-complete',
      jobId: 'job-complete',
    })).toThrow(/不能再取消/);
    expect(() => bindLingxingCollectionCancellation(repository, storeA, {
      requestId: '../bad',
      jobId: 'job-a',
    })).toThrow(/有效的 requestId/);
  });
});
