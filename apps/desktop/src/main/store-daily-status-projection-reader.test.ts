import { describe, expect, it, vi } from 'vitest';
import type {
  LingxingCollectionJobSnapshot,
  OperatorWorkspaceSelection,
  StoreConnection,
  StoreId,
  StoreRecord,
  StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import { ANALYSIS_REQUIRED_REPORT_TYPES } from '@amazon-ai-ops/shared-types';
import type { LingxingCollectionAuthorityProof } from '@amazon-ai-ops/local-db';
import { StoreDailyStatusProjectionReader } from './store-daily-status-projection-reader';

const NOW = new Date('2026-08-04T12:00:00.000Z');
const iso = (minute: number) => `2026-08-04T12:${String(minute).padStart(2, '0')}:00.000Z`;

function store(id: string, displayName: string, status: StoreRecord['status'] = 'active'): StoreRecord {
  return {
    storeId: id as StoreId,
    browserProfileId: `browser-${id}` as StoreRecord['browserProfileId'],
    marketplace: 'US',
    currency: 'USD',
    displayName,
    status,
    businessTimezone: 'America/Los_Angeles',
    createdAt: iso(0),
    updatedAt: iso(1),
    ...(status === 'archived' ? { archivedAt: iso(1) } : {}),
  };
}

function connection(
  row: StoreRecord,
  provider: StoreConnection['provider'],
): StoreConnection {
  const externalAccountId = provider === 'lingxing' ? `Seller-${row.storeId}` : `Profile-${row.storeId}`;
  return {
    id: `cap-${provider}-${row.storeId}` as StoreConnection['id'],
    storeId: row.storeId,
    provider,
    status: 'ready',
    ...(provider === 'lingxing' ? { accountLabel: `operator-${row.storeId}` } : {}),
    externalAccountId,
    normalizedExternalAccountId: externalAccountId.toLowerCase(),
    ...(provider === 'lingxing' ? {
      collectionStoreName: `US Store ${row.storeId}`,
      normalizedCollectionStoreName: `us store ${row.storeId}`,
    } : {}),
    lastVerifiedAt: iso(2),
    createdAt: iso(0),
    updatedAt: iso(2),
  };
}

function session(
  row: StoreRecord,
  provider: StoreSessionMetadata['provider'],
  generation = 4,
): StoreSessionMetadata {
  return {
    storeId: row.storeId,
    browserProfileId: row.browserProfileId,
    provider,
    status: 'ready',
    sessionGeneration: generation,
    observedAt: iso(3),
    verifiedAt: iso(3),
  };
}

function job(
  row: StoreRecord,
  suffix = 'daily',
  createdMinute = 0,
  updatedMinute = 8,
): LingxingCollectionJobSnapshot {
  return {
    jobId: `job-${row.storeId}-${suffix}`,
    request: {
      requestId: `request-${row.storeId}-${suffix}`,
      storeContext: {
        storeId: row.storeId,
        browserProfileId: row.browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
        businessDate: '2026-08-04' as LingxingCollectionJobSnapshot['request']['storeContext']['businessDate'],
        sessionGeneration: 4,
      },
      dateStart: '2026-07-05',
      dateEnd: '2026-08-03',
      mode: 'create-and-download',
      reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
    },
    state: 'completed',
    reports: ANALYSIS_REQUIRED_REPORT_TYPES.map((reportType) => ({
      reportType,
      state: 'downloaded',
      attemptIndex: 0,
      autoRetryCount: 0,
      fileSizeBytes: 100,
      updatedAt: iso(4),
    })),
    importState: 'succeeded',
    importAttemptedAt: iso(5),
    importCompletedAt: iso(8),
    createdAt: iso(createdMinute),
    completedAt: iso(4),
    updatedAt: iso(updatedMinute),
  };
}

function proof(snapshot: LingxingCollectionJobSnapshot): LingxingCollectionAuthorityProof {
  return {
    job: snapshot,
    importedReportFileCount: 8,
    metricEvidence: [{ rowCount: 321, createdAt: iso(7) }],
    importRuns: [{ completedAt: iso(7) }],
    reconciliations: ANALYSIS_REQUIRED_REPORT_TYPES.map((reportType) => ({
      reportType,
      metricDate: '2026-08-03',
    })),
  } as unknown as LingxingCollectionAuthorityProof;
}

function harness(input: {
  stores: StoreRecord[];
  selected?: StoreRecord;
  jobs?: Map<StoreId, LingxingCollectionJobSnapshot[]>;
  corruptStores?: Set<StoreId>;
  corruptRequestIds?: Set<string>;
  sessionGeneration?: (storeId: StoreId) => number;
  classifications?: Map<string, 'claimed' | 'succeeded' | 'failed'>;
  metricRows?: Map<string, number>;
}) {
  const readTransactionMock = vi.fn((work: () => unknown) => work());
  const readTransaction = <Result>(work: () => Result): Result => (
    readTransactionMock(work) as Result
  );
  const connectionReads = vi.fn((storeId: StoreId) => {
    const row = input.stores.find((candidate) => candidate.storeId === storeId)!;
    return [connection(row, 'lingxing'), connection(row, 'amazon_ads')];
  });
  const sessionReads = vi.fn((storeId: StoreId) => {
    const row = input.stores.find((candidate) => candidate.storeId === storeId)!;
    return [session(row, 'lingxing'), session(row, 'amazon_ads')];
  });
  const jobs = input.jobs ?? new Map();
  const reader = new StoreDailyStatusProjectionReader({
    stores: {
      listStores: () => input.stores,
      listConnections: connectionReads,
      listSessionMetadata: sessionReads,
    },
    readTransaction,
    generations: { current: input.sessionGeneration ?? (() => 4) },
    imports: {
      listCollectionJobsForStore: (storeId) => jobs.get(storeId) ?? [],
      readUniqueCollectionAuthorityProofForStoreByRequestId: (storeId, requestId) => {
        if (input.corruptStores?.has(storeId) || input.corruptRequestIds?.has(requestId)) {
          throw new Error('corrupt proof with local path');
        }
        const snapshot = (jobs.get(storeId) ?? [])
          .find((candidate: LingxingCollectionJobSnapshot) => candidate.request.requestId === requestId);
        if (!snapshot) return undefined;
        const result = proof(snapshot);
        const metricRows = input.metricRows?.get(requestId);
        return metricRows === undefined
          ? result
          : {
              ...result,
              metricEvidence: [{ ...result.metricEvidence[0], rowCount: metricRows }],
            };
      },
    },
    selection: {
      getOperatorWorkspaceSelection: () => input.selected
        ? {
            schemaVersion: 1,
            storeId: input.selected.storeId,
            marketplace: 'US',
            selectedAt: iso(0),
          } satisfies OperatorWorkspaceSelection
        : null,
    },
    classifyProof: (candidate) => (
      input.classifications?.get(candidate.job.request.requestId) ?? 'succeeded'
    ),
    now: () => NOW,
  });
  return { reader, readTransaction: readTransactionMock, connectionReads, sessionReads };
}

describe('StoreDailyStatusProjectionReader', () => {
  it('returns deterministic multi-store ordering in one deferred read without changing authority', () => {
    const alpha = store('store-alpha', 'Alpha');
    const beta = store('store-beta', 'Beta');
    const inactive = store('store-inactive', 'Inactive', 'inactive');
    const test = harness({ stores: [inactive, alpha, beta], selected: beta });

    const result = test.reader.list({
      marketplace: 'US',
      includeInactive: true,
      includeArchived: false,
    });

    expect(result.stores.map((row) => row.key.storeId)).toEqual([
      'store-beta',
      'store-alpha',
      'store-inactive',
    ]);
    expect(result.stores[0].selected).toBe(true);
    expect(result.stores[2]).toMatchObject({ overall: 'inactive', eligibleForCollection: false });
    expect(test.readTransaction).toHaveBeenCalledOnce();
    expect(test.connectionReads).toHaveBeenCalledTimes(3);
    expect(test.sessionReads).toHaveBeenCalledTimes(3);
  });

  it('keeps one corrupt store UNKNOWN without contaminating a valid 8/8 imported store', () => {
    const good = store('store-good', 'Good');
    const bad = store('store-bad', 'Bad');
    const jobs = new Map<StoreId, LingxingCollectionJobSnapshot[]>([
      [good.storeId, [job(good)]],
      [bad.storeId, [job(bad)]],
    ]);
    const result = harness({
      stores: [bad, good],
      jobs,
      corruptStores: new Set([bad.storeId]),
    }).reader.list({ marketplace: 'US' });

    const valid = result.stores.find((row) => row.key.storeId === good.storeId)!;
    expect(valid).toMatchObject({
      collection: { state: 'succeeded', downloadedReportCount: 8 },
      import: { state: 'succeeded', importedReportCount: 8, metricRowCount: 321 },
      metrics: { freshness: 'fresh', latestMetricDate: '2026-08-03', lagDays: 0 },
      overall: 'ready',
    });
    const corrupt = result.stores.find((row) => row.key.storeId === bad.storeId)!;
    expect(corrupt).toMatchObject({
      collection: { state: 'unknown' },
      import: { state: 'unknown' },
      metrics: { freshness: 'unknown' },
      overall: 'unknown',
    });
    expect(corrupt.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      'COLLECTION_AUTHORITY_UNKNOWN',
      'IMPORT_AUTHORITY_UNKNOWN',
      'METRICS_AUTHORITY_UNKNOWN',
    ]));
  });

  it('treats no durable job as known not_started and never invents zero-row import proof', () => {
    const row = store('store-empty', 'Empty');
    const result = harness({ stores: [row] }).reader.list({ marketplace: 'US' }).stores[0];
    expect(result.collection).toEqual({
      state: 'not_started',
      requiredReportCount: 8,
      downloadedReportCount: 0,
    });
    expect(result.import).toEqual({ state: 'not_started' });
    expect(result.metrics).toMatchObject({ freshness: 'missing', expectedMetricDate: '2026-08-03' });
    expect(result.import.metricRowCount).toBeUndefined();
    expect(result.overall).toBe('not_started');
  });

  it('does not accept a stale durable ready session as collection eligible', () => {
    const row = store('store-stale', 'Stale');
    const result = harness({
      stores: [row],
      sessionGeneration: () => 5,
    }).reader.list({ marketplace: 'US' }).stores[0];
    expect(result.providers.lingxing.sessionStatus).toBe('unknown');
    expect(result.eligibleForCollection).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain('LINGXING_SESSION_NOT_READY');
  });

  it('filters inactive and archived stores explicitly and never marks them eligible', () => {
    const active = store('store-active', 'Active');
    const inactive = store('store-inactive', 'Inactive', 'inactive');
    const archived = store('store-archived', 'Archived', 'archived');
    const test = harness({ stores: [archived, inactive, active] });
    expect(test.reader.list({ marketplace: 'US' }).stores.map((row) => row.key.storeId))
      .toEqual(['store-active']);
    const all = test.reader.list({
      marketplace: 'US',
      includeInactive: true,
      includeArchived: true,
    }).stores;
    expect(all.find((row) => row.key.storeId === inactive.storeId))
      .toMatchObject({ overall: 'inactive', eligibleForCollection: false });
    expect(all.find((row) => row.key.storeId === archived.storeId))
      .toMatchObject({ overall: 'archived', eligibleForCollection: false });
  });

  it('selects the repo-sorted latest terminal retry for collection and import', () => {
    const row = store('store-retry-success', 'Retry Success');
    const failed = {
      ...job(row, 'failed', 6, 6),
      state: 'failed' as const,
      importState: 'failed' as const,
    };
    const retry = job(row, 'retry', 9, 9);
    const classifications = new Map<string, 'claimed' | 'succeeded' | 'failed'>([
      [failed.request.requestId, 'failed'],
      [retry.request.requestId, 'succeeded'],
    ]);
    const result = harness({
      stores: [row],
      jobs: new Map([[row.storeId, [retry, failed]]]),
      classifications,
      metricRows: new Map([[retry.request.requestId, 777]]),
    }).reader.list({ marketplace: 'US' }).stores[0];

    expect(result).toMatchObject({
      collection: { state: 'succeeded', jobId: retry.jobId },
      import: { state: 'succeeded', metricRowCount: 777 },
      metrics: { freshness: 'fresh', rowCount: 777 },
    });
  });

  it('shows a latest failed retry while retaining metrics from the latest verified success', () => {
    const row = store('store-retry-failed', 'Retry Failed');
    // Repo rows are updated_at sorted, so an old job touched later arrives
    // first. The read model must still choose the newest created attempt.
    const succeeded = job(row, 'succeeded', 8, 10);
    const failedRetry = {
      ...job(row, 'failed-retry', 9, 9),
      state: 'failed' as const,
      importState: 'failed' as const,
    };
    const classifications = new Map<string, 'claimed' | 'succeeded' | 'failed'>([
      [failedRetry.request.requestId, 'failed'],
      [succeeded.request.requestId, 'succeeded'],
    ]);
    const result = harness({
      stores: [row],
      jobs: new Map([[row.storeId, [succeeded, failedRetry]]]),
      classifications,
      metricRows: new Map([[succeeded.request.requestId, 456]]),
    }).reader.list({ marketplace: 'US' }).stores[0];

    expect(result).toMatchObject({
      collection: { state: 'failed', jobId: failedRetry.jobId },
      import: { state: 'failed' },
      metrics: { freshness: 'fresh', rowCount: 456 },
    });
    expect(result.collection.state).not.toBe('unknown');
  });

  it('fails only concurrent nonterminal same-day authorities closed as UNKNOWN', () => {
    const row = store('store-concurrent', 'Concurrent');
    const first = { ...job(row, 'running-a', 9, 9), state: 'running' as const, importState: 'pending' as const };
    const second = { ...job(row, 'running-b', 8, 8), state: 'queued' as const, importState: 'pending' as const };
    const classifications = new Map<string, 'claimed' | 'succeeded' | 'failed'>([
      [first.request.requestId, 'claimed'],
      [second.request.requestId, 'claimed'],
    ]);
    const result = harness({
      stores: [row],
      jobs: new Map([[row.storeId, [first, second]]]),
      classifications,
    }).reader.list({ marketplace: 'US' }).stores[0];

    expect(result).toMatchObject({
      collection: { state: 'unknown' },
      import: { state: 'unknown' },
      metrics: { freshness: 'missing' },
      overall: 'unknown',
    });
  });

  it('does not fall back from an invalid newest attempt while preserving older verified metrics', () => {
    const row = store('store-invalid-latest', 'Invalid Latest');
    const olderSuccess = job(row, 'older-success', 8, 8);
    const invalidLatest = job(row, 'invalid-latest', 9, 9);
    const result = harness({
      stores: [row],
      jobs: new Map([[row.storeId, [invalidLatest, olderSuccess]]]),
      corruptRequestIds: new Set([invalidLatest.request.requestId]),
      metricRows: new Map([[olderSuccess.request.requestId, 654]]),
    }).reader.list({ marketplace: 'US' }).stores[0];

    expect(result).toMatchObject({
      collection: { state: 'unknown' },
      import: { state: 'unknown' },
      metrics: { freshness: 'fresh', rowCount: 654 },
      overall: 'unknown',
    });
  });
});
