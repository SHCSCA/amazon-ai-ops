import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeStoreId,
  normalizeStoreContextEnvelope,
  type AdDailyMetrics,
  type LingxingCollectionJobSnapshot,
  type LingxingReportBatch,
  type LingxingReportFile,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import {
  LingxingImportRepository,
  reconcileUsdAmount,
  type CommitReportImportInput,
} from './lingxing-import-repo';

const databases: Database.Database[] = [];
const tempDirectories: string[] = [];

afterEach(() => {
  while (databases.length) {
    const database = databases.pop();
    if (database?.open) database.close();
  }
  while (tempDirectories.length) {
    const directory = tempDirectories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createHarness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-lingxing-import-'));
  tempDirectories.push(directory);
  const database = initSqlite(path.join(directory, 'import.db'));
  databases.push(database);
  const storeA = normalizeStoreId('store-a');
  const storeB = normalizeStoreId('store-b');
  insertStore(database, storeA, 'profile-a', 'Shop Alpha');
  insertStore(database, storeB, 'profile-b', 'Shop Beta');
  return {
    database,
    databasePath: path.join(directory, 'import.db'),
    repository: new LingxingImportRepository(database),
    storeA,
    storeB,
  };
}

function collectionJob(
  storeId: StoreId,
  browserProfileId: string,
  state: LingxingCollectionJobSnapshot['state'],
  updatedAt: string,
): LingxingCollectionJobSnapshot {
  return {
    jobId: 'collection-job-1',
    request: {
      requestId: 'request-1',
      storeContext: normalizeStoreContextEnvelope({
        storeId,
        browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
        businessDate: '2026-07-22',
        sessionGeneration: 3,
      }),
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: ['keyword'],
    },
    state,
    reports: [{
      reportType: 'keyword',
      state: state === 'queued' ? 'queued' : 'created',
      attemptIndex: 0,
      autoRetryCount: 0,
      ...(state === 'queued' ? {} : {
        createdReportIdentity: {
          provider: 'lingxing' as const,
          reportType: 'keyword' as const,
          externalReportName: 'keyword-2026-07-21',
          externalReportId: 'lx-report-1',
          dateStart: '2026-07-21',
          dateEnd: '2026-07-21',
          createdAt: updatedAt,
        },
      }),
      updatedAt,
    }],
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt,
  };
}

function terminalCollection(
  storeId: StoreId,
  browserProfileId: string,
  storeName: string,
  batchId: string,
) {
  const completedAt = '2026-07-22T00:05:00.000Z';
  const baseJob = collectionJob(storeId, browserProfileId, 'running', completedAt);
  const source = collectionSnapshot(storeId, storeName, batchId);
  return {
    job: {
      ...baseJob,
      jobId: batchId,
      state: 'completed' as const,
      reports: baseJob.reports.map((checkpoint) => ({
        ...checkpoint,
        state: 'downloaded' as const,
        fileSizeBytes: 2048,
        updatedAt: completedAt,
      })),
      updatedAt: completedAt,
      completedAt,
    },
    batch: {
      ...source.batch,
      requestId: baseJob.request.requestId,
      browserProfileId: baseJob.request.storeContext.browserProfileId,
      businessDate: baseJob.request.storeContext.businessDate,
      sessionGeneration: baseJob.request.storeContext.sessionGeneration,
      status: 'completed' as const,
      completedAt,
    },
    files: source.files.map((file) => ({
      ...file,
      status: 'downloaded' as const,
      updatedAt: completedAt,
    })),
  };
}

function insertStore(
  database: Database.Database,
  storeId: StoreId,
  browserProfileId: string,
  displayName: string,
): void {
  database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
  `).run(storeId, browserProfileId, displayName, '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
}

function collectionSnapshot(
  storeId: StoreId,
  storeName: string,
  batchId: string,
): { batch: LingxingReportBatch; files: LingxingReportFile[] } {
  const fileId = `${batchId}-keyword`;
  return {
    batch: {
      id: batchId,
      storeId,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      storeName,
      marketplaceCode: 'US',
      status: 'completed',
      downloadDir: `C:/${batchId}`,
      manifestPath: `C:/${batchId}/manifest.json`,
      createdAt: '2026-07-22T00:00:00.000Z',
      completedAt: '2026-07-22T00:05:00.000Z',
    },
    files: [{
      id: fileId,
      batchId,
      reportType: 'keyword',
      displayName: '关键词报表',
      status: 'downloaded',
      filePath: 'C:/shared/keyword-2026-07-21.xlsx',
      fileSizeBytes: 2048,
      createdAt: '2026-07-22T00:01:00.000Z',
      updatedAt: '2026-07-22T00:04:00.000Z',
    }],
  };
}

function metric(
  storeName: string,
  batchId: string,
  overrides: Partial<AdDailyMetrics> = {},
): AdDailyMetrics {
  return {
    batchId,
    reportType: 'keyword',
    date: '2026-07-21',
    storeName,
    marketplaceCode: 'US',
    asin: 'B0SHARED',
    msku: 'SHARED-MSKU',
    campaignName: 'Shared campaign',
    adGroupName: 'Shared group',
    targeting: 'smart lock',
    searchTerm: 'smart lock',
    matchType: 'exact',
    impressions: 100,
    clicks: 10,
    cost: 10.01,
    orders: 1,
    sales: 30,
    currency: 'USD',
    acos: 0.3337,
    cpc: 1.001,
    cvr: 0.1,
    sourceFile: 'C:/shared/keyword-2026-07-21.xlsx',
    sourceRow: 2,
    ...overrides,
  };
}

function importInput(
  storeName: string,
  batchId: string,
  overrides: Partial<CommitReportImportInput> = {},
): CommitReportImportInput {
  return {
    runId: 'run-shared',
    idempotencyKey: 'daily-keyword-2026-07-21',
    batchId,
    files: [{
      lingxingFileId: `${batchId}-keyword`,
      reportType: 'keyword',
      filePath: 'C:/shared/keyword-2026-07-21.xlsx',
      fileName: 'keyword-2026-07-21.xlsx',
      fileSizeBytes: 2048,
      fileHash: 'abc123',
      importedRows: 1,
    }],
    metrics: [metric(storeName, batchId)],
    reconciliations: [{
      metricDate: '2026-07-21',
      reportType: 'keyword',
      expectedRows: 1,
      expectedCost: 10,
    }],
    startedAt: '2026-07-22T00:06:00.000Z',
    completedAt: '2026-07-22T00:07:00.000Z',
    ...overrides,
  };
}

describe('LingxingImportRepository', () => {
  it('persists a full-job lineage and rejects unbound or cross-window continuations', () => {
    const { repository, storeA, storeB } = createHarness();
    const expectedReportTypes = [
      'campaign', 'ad_group', 'placement', 'advertised_product',
      'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
    ] as const;
    const rootBase = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:01:00.000Z');
    const root: LingxingCollectionJobSnapshot = {
      ...rootBase,
      request: { ...rootBase.request, reportTypes: expectedReportTypes },
      lineage: {
        lineageId: rootBase.jobId,
        rootJobId: rootBase.jobId,
        expectedReportTypes,
        purpose: 'production_full',
      },
      reports: expectedReportTypes.map((reportType) => ({
        reportType,
        state: 'queued' as const,
        attemptIndex: 0,
        autoRetryCount: 0,
        updatedAt: rootBase.updatedAt,
      })),
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, root);

    const continuationBase = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:02:00.000Z');
    const continuation: LingxingCollectionJobSnapshot = {
      ...continuationBase,
      jobId: 'resume-job-1',
      request: { ...continuationBase.request, requestId: 'resume-request-1' },
      lineage: {
        lineageId: root.jobId,
        rootJobId: root.jobId,
        parentJobId: root.jobId,
        expectedReportTypes,
        purpose: 'resume',
      },
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, continuation);
    expect(repository.getCollectionJobForStore(storeA, continuation.jobId)?.lineage)
      .toEqual(continuation.lineage);

    expect(() => repository.upsertCollectionJobSnapshotForStore(storeA, {
      ...continuation,
      jobId: 'unbound-resume',
      lineage: { ...continuation.lineage!, parentJobId: 'missing-parent' },
    })).toThrow('父任务不存在');
    expect(() => repository.upsertCollectionJobSnapshotForStore(storeA, {
      ...continuation,
      jobId: 'wrong-window-resume',
      request: { ...continuation.request, dateEnd: '2026-07-22' },
    })).toThrow('日期窗或授权范围不一致');
    expect(() => repository.upsertCollectionJobSnapshotForStore(storeB, {
      ...continuation,
      jobId: 'cross-store-resume',
      request: {
        ...continuation.request,
        storeContext: normalizeStoreContextEnvelope({
          ...continuation.request.storeContext,
          storeId: storeB,
          browserProfileId: 'profile-b',
        }),
      },
    })).toThrow('父任务不存在于当前店铺');
    expect(() => repository.upsertCollectionJobSnapshotForStore(storeA, {
      ...continuation,
      jobId: 'canary-class-resume',
      request: { ...continuation.request, requestId: 'canary:resume-request-1' },
    })).toThrow('日期窗或授权范围不一致');
  });

  it('atomically commits the completed job and its terminal batch/files without a nested transaction', () => {
    const { database, repository, storeA } = createHarness();
    const terminalBase = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'terminal-batch-a');
    const terminal = {
      ...terminalBase,
      job: { ...terminalBase.job, importState: 'pending' as const },
    };
    const running = {
      ...terminal.job,
      state: 'running' as const,
      reports: terminal.job.reports.map((checkpoint) => ({
        ...checkpoint,
        state: 'downloading' as const,
      })),
      completedAt: undefined,
      importState: undefined,
      updatedAt: '2026-07-22T00:04:00.000Z',
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, running);

    const committed = repository.commitCollectionTerminalForStore(storeA, terminal);

    expect(committed.job).toEqual(expect.objectContaining({
      jobId: 'terminal-batch-a',
      state: 'completed',
      importState: 'pending',
      completedAt: '2026-07-22T00:05:00.000Z',
    }));
    expect(repository.getCollectionJobForStore(storeA, 'terminal-batch-a'))
      .toEqual(expect.objectContaining({ state: 'completed' }));
    expect(repository.getCollectionSnapshotForStore(storeA, 'terminal-batch-a')).toEqual({
      batch: expect.objectContaining({
        id: 'terminal-batch-a',
        storeId: storeA,
        requestId: 'request-1',
        status: 'completed',
      }),
      files: [expect.objectContaining({
        batchId: 'terminal-batch-a',
        storeId: storeA,
        status: 'downloaded',
      })],
    });
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM lingxing_collection_jobs WHERE store_id = ?) AS jobs,
        (SELECT COUNT(*) FROM lingxing_report_batches WHERE store_id = ?) AS batches,
        (SELECT COUNT(*) FROM lingxing_report_files WHERE store_id = ?) AS files
    `).get(storeA, storeA, storeA)).toEqual({ jobs: 1, batches: 1, files: 1 });

    repository.upsertCollectionJobSnapshotForStore(storeA, {
      ...committed.job,
      importState: 'succeeded',
      importAttemptedAt: '2026-07-22T00:05:01.000Z',
      importCompletedAt: '2026-07-22T00:05:02.000Z',
      updatedAt: '2026-07-22T00:05:02.000Z',
    });
    expect(repository.getCollectionJobForStore(storeA, 'terminal-batch-a'))
      .toEqual(expect.objectContaining({
        importState: 'succeeded',
        importAttemptedAt: '2026-07-22T00:05:01.000Z',
        importCompletedAt: '2026-07-22T00:05:02.000Z',
      }));
  });

  it('pages a completed-with-errors job when at least one downloaded checkpoint has a verified file', () => {
    const { repository, storeA } = createHarness();
    const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'partial-terminal');
    const failedAt = '2026-07-22T00:05:00.000Z';
    const partial = {
      ...terminal,
      job: {
        ...terminal.job,
        state: 'completed_with_errors' as const,
        importState: 'pending' as const,
        request: {
          ...terminal.job.request,
          reportTypes: ['keyword', 'campaign'] as const,
        },
        reports: [
          ...terminal.job.reports,
          {
            reportType: 'campaign' as const,
            state: 'failed' as const,
            attemptIndex: 2,
            autoRetryCount: 2,
            errorCode: 'LINGXING_COLLECTION_STEP_FAILED',
            updatedAt: failedAt,
          },
        ],
      },
      batch: { ...terminal.batch, status: 'completed_with_errors' as const },
      files: [
        ...terminal.files,
        {
          id: 'partial-terminal-campaign',
          batchId: 'partial-terminal',
          reportType: 'campaign' as const,
          displayName: '广告活动报表',
          status: 'failed' as const,
          fileSizeBytes: 0,
          createdAt: failedAt,
          updatedAt: failedAt,
        },
      ],
    };
    repository.commitCollectionTerminalForStore(storeA, partial);

    const page = repository.listRecoverableCollectionImportsForStore(storeA, { limit: 10 });

    expect(page.jobs).toEqual([
      expect.objectContaining({
        jobId: 'partial-terminal',
        state: 'completed_with_errors',
        importState: 'pending',
      }),
    ]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('walks every pending/failed recovery candidate by cursor instead of a recent-jobs cap', () => {
    const { repository, storeA } = createHarness();
    const expectedIds = ['recovery-a', 'recovery-b', 'recovery-c'];
    expectedIds.forEach((batchId, index) => {
      const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', batchId);
      const completedAt = `2026-07-22T00:0${index + 5}:00.000Z`;
      repository.commitCollectionTerminalForStore(storeA, {
        ...terminal,
        job: {
          ...terminal.job,
          importState: index === 1 ? 'failed' : 'pending',
          ...(index === 1 ? { importError: 'parser unavailable' } : {}),
          reports: terminal.job.reports.map((checkpoint) => ({ ...checkpoint, updatedAt: completedAt })),
          updatedAt: completedAt,
          completedAt,
        },
        batch: { ...terminal.batch, completedAt },
        files: terminal.files.map((file) => ({ ...file, updatedAt: completedAt })),
      });
    });

    const visited: string[] = [];
    let cursor: { updatedAt: string; jobId: string } | undefined;
    do {
      const page = repository.listRecoverableCollectionImportsForStore(storeA, {
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      visited.push(...page.jobs.map((job) => job.jobId));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(visited)).toEqual(new Set(expectedIds));
    expect(visited).toHaveLength(expectedIds.length);
    expect(repository.listCollectionJobsForStore(storeA, 1)).toHaveLength(1);
  });

  it('does not offer an all-failed terminal job as a partial import recovery candidate', () => {
    const { repository, storeA } = createHarness();
    const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'all-failed-terminal');
    repository.commitCollectionTerminalForStore(storeA, {
      ...terminal,
      job: {
        ...terminal.job,
        state: 'completed_with_errors',
        importState: 'failed',
        importError: 'no verified report was downloaded',
        reports: terminal.job.reports.map((checkpoint) => ({ ...checkpoint, state: 'failed' as const })),
      },
      batch: { ...terminal.batch, status: 'completed_with_errors' },
      files: terminal.files.map((file) => ({ ...file, status: 'failed' as const })),
    });

    expect(repository.listRecoverableCollectionImportsForStore(storeA).jobs).toEqual([]);
  });

  it('rolls back terminal job, batch and prior file inserts when a later file identity mismatches', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = terminalCollection(storeA, 'profile-a', 'Shop Alpha', 'terminal-rollback');
    const mismatched = {
      ...terminal,
      files: [{ ...terminal.files[0], batchId: 'foreign-batch' }],
    };

    expect(() => repository.commitCollectionTerminalForStore(storeA, mismatched))
      .toThrow(/batchId.*不一致/);
    expect(repository.getCollectionJobForStore(storeA, 'terminal-rollback')).toBeUndefined();
    expect(repository.getCollectionSnapshotForStore(storeA, 'terminal-rollback')).toBeUndefined();
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM lingxing_collection_jobs) AS jobs,
        (SELECT COUNT(*) FROM lingxing_collection_report_checkpoints) AS checkpoints,
        (SELECT COUNT(*) FROM lingxing_report_batches) AS batches,
        (SELECT COUNT(*) FROM lingxing_report_files) AS files
    `).get()).toEqual({ jobs: 0, checkpoints: 0, batches: 0, files: 0 });
  });

  it('persists every path-free progress event and restores a store-scoped resume state after reopen', () => {
    const { database, databasePath, repository, storeA, storeB } = createHarness();
    const queued = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:00:01.000Z');
    const created = {
      ...collectionJob(storeA, 'profile-a', 'running', '2026-07-22T00:00:02.000Z'),
      detail: 'provider detail saved at C:\\private\\collector\\state.json',
    };

    repository.upsertCollectionProgressForStore(storeA, {
      eventId: 'event-1',
      emittedAt: queued.updatedAt,
      job: queued,
    });
    const saved = repository.upsertCollectionProgressForStore(storeA, {
      eventId: 'event-2',
      emittedAt: created.updatedAt,
      changedReportType: 'keyword',
      externalStep: 'create',
      job: created,
    });
    expect(saved.detail).toBe('provider detail saved at [local-path-redacted]');
    expect(() => repository.upsertCollectionProgressForStore(storeA, {
      eventId: 'event-stale',
      emittedAt: queued.updatedAt,
      job: queued,
    })).toThrow(/拒绝回退/);
    expect(repository.getCollectionJobForStore(storeB, created.jobId)).toBeUndefined();
    const raw = database.prepare(`
      SELECT snapshot_json AS snapshotJson FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeA, created.jobId) as { snapshotJson: string };
    expect(raw.snapshotJson).not.toMatch(/filePath|downloadDir|manifestPath|C:\\|C:\//);

    database.close();
    const reopened = initSqlite(databasePath);
    databases.push(reopened);
    const reopenedRepository = new LingxingImportRepository(reopened);
    expect(reopenedRepository.listCollectionJobsForStore(storeA)).toEqual([
      expect.objectContaining({ jobId: created.jobId, state: 'running' }),
    ]);
    expect(reopenedRepository.getCollectionResumeStateForStore(storeA, created.jobId)).toEqual({
      jobId: created.jobId,
      request: created.request,
      reports: [expect.objectContaining({
        reportType: 'keyword',
        state: 'created',
        createdReportIdentity: expect.objectContaining({ externalReportId: 'lx-report-1' }),
      })],
    });
    expect(reopenedRepository.findLatestCollectionResumeStateForStore(storeA, 'request-1'))
      .toEqual(expect.objectContaining({ jobId: created.jobId }));
  });

  it('persists cancellation before acknowledgement and keeps it terminal after immediate reopen', () => {
    const { database, databasePath, repository, storeA } = createHarness();
    const running = collectionJob(
      storeA,
      'profile-a',
      'running',
      '2026-07-22T00:01:00.000Z',
    );
    repository.upsertCollectionJobSnapshotForStore(storeA, running);

    const cancelled = repository.cancelCollectionJobForStore(storeA, running.jobId, {
      requestId: running.request.requestId,
      completedAt: '2026-07-22T00:02:00.000Z',
    });
    expect(cancelled).toEqual(expect.objectContaining({
      state: 'cancelled',
      completedAt: '2026-07-22T00:02:00.000Z',
      blockerCode: 'LINGXING_COLLECTION_CANCELLED_BY_OPERATOR',
      importState: 'not_applicable',
    }));
    expect(cancelled.reports).toEqual([
      expect.objectContaining({ reportType: 'keyword', state: 'cancelled' }),
    ]);

    database.close();
    const reopened = initSqlite(databasePath);
    databases.push(reopened);
    const reopenedRepository = new LingxingImportRepository(reopened);
    expect(reopenedRepository.getCollectionJobForStore(storeA, running.jobId))
      .toEqual(expect.objectContaining({ state: 'cancelled' }));

    const lateRunning = {
      ...running,
      updatedAt: '2026-07-22T00:03:00.000Z',
      reports: running.reports.map((checkpoint) => ({
        ...checkpoint,
        updatedAt: '2026-07-22T00:03:00.000Z',
      })),
    };
    expect(reopenedRepository.upsertCollectionProgressForStore(storeA, {
      eventId: 'late-runner-progress',
      emittedAt: lateRunning.updatedAt,
      job: lateRunning,
    })).toEqual(expect.objectContaining({ state: 'cancelled' }));
    expect(reopenedRepository.getCollectionJobForStore(storeA, running.jobId))
      .toEqual(expect.objectContaining({ state: 'cancelled' }));
  });

  it('closes every queued/running orphan as cancelled during startup recovery', () => {
    const { repository, storeA } = createHarness();
    const queued = collectionJob(storeA, 'profile-a', 'queued', '2026-07-22T00:01:00.000Z');
    const runningBase = collectionJob(
      storeA,
      'profile-a',
      'running',
      '2026-07-22T00:01:30.000Z',
    );
    const running = {
      ...runningBase,
      jobId: 'collection-job-2',
      request: { ...runningBase.request, requestId: 'request-2' },
    };
    repository.upsertCollectionJobSnapshotForStore(storeA, queued);
    repository.upsertCollectionJobSnapshotForStore(storeA, running);

    const recovered = repository.recoverInterruptedCollectionJobsForStore(storeA, {
      completedAt: '2026-07-22T00:02:00.000Z',
    });

    expect(recovered).toHaveLength(2);
    expect(recovered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobId: queued.jobId,
        state: 'cancelled',
        blockerCode: 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
      }),
      expect.objectContaining({
        jobId: running.jobId,
        state: 'cancelled',
        blockerCode: 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
      }),
    ]));
    expect(repository.recoverInterruptedCollectionJobsForStore(storeA, {
      completedAt: '2026-07-22T00:03:00.000Z',
    })).toEqual([]);
  });

  it('accepts an older runner cancelled result without weakening the cancellation tombstone', () => {
    const { repository, storeA } = createHarness();
    const terminal = terminalCollection(
      storeA,
      'profile-a',
      'Shop Alpha',
      'cancelled-runner-race',
    );
    const running: LingxingCollectionJobSnapshot = {
      ...terminal.job,
      state: 'running',
      reports: terminal.job.reports.map((checkpoint) => ({
        ...checkpoint,
        state: 'created' as const,
        updatedAt: '2026-07-22T00:04:00.000Z',
      })),
      updatedAt: '2026-07-22T00:04:00.000Z',
    };
    delete running.completedAt;
    repository.upsertCollectionJobSnapshotForStore(storeA, running);
    repository.cancelCollectionJobForStore(storeA, running.jobId, {
      requestId: running.request.requestId,
      completedAt: '2026-07-22T00:06:00.000Z',
    });

    const runnerCancelled = {
      ...terminal,
      job: {
        ...terminal.job,
        state: 'cancelled' as const,
        importState: 'not_applicable' as const,
        blockerCode: 'LINGXING_COLLECTION_CANCELLED',
        updatedAt: '2026-07-22T00:05:00.000Z',
        completedAt: '2026-07-22T00:05:00.000Z',
      },
      batch: {
        ...terminal.batch,
        status: 'failed' as const,
        completedAt: '2026-07-22T00:05:00.000Z',
      },
    };
    const committed = repository.commitCollectionTerminalForStore(storeA, runnerCancelled);

    expect(committed.job).toEqual(expect.objectContaining({
      state: 'cancelled',
      blockerCode: 'LINGXING_COLLECTION_CANCELLED_BY_OPERATOR',
      completedAt: '2026-07-22T00:06:00.000Z',
    }));
    expect(committed.batch.status).toBe('failed');
    expect(() => repository.commitCollectionTerminalForStore(storeA, {
      ...terminal,
      job: {
        ...terminal.job,
        updatedAt: '2026-07-22T00:07:00.000Z',
        completedAt: '2026-07-22T00:07:00.000Z',
      },
      batch: { ...terminal.batch, completedAt: '2026-07-22T00:07:00.000Z' },
    })).toThrow(/已持久化取消终态/);
  });

  it('isolates two stores with the same business date and filename across every import table', () => {
    const { repository, storeA, storeB } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    repository.saveCollectionSnapshotForStore(storeB, collectionSnapshot(storeB, 'Shop Beta', 'batch-b'));

    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a'));
    repository.commitImportForStore(storeB, importInput('Shop Beta', 'batch-b'));

    expect(repository.listBatchesForStore(storeA)).toEqual([
      expect.objectContaining({ storeId: storeA, id: 'batch-a', dateStart: '2026-07-21' }),
    ]);
    expect(repository.getCollectionSnapshotForStore(storeA, 'batch-b')).toBeUndefined();
    expect(repository.listReportFilesForStore(storeA, 'batch-a')).toEqual([
      expect.objectContaining({ storeId: storeA, fileName: 'keyword-2026-07-21.xlsx' }),
    ]);
    expect(repository.listReportFilesForStore(storeB, 'batch-b')).toEqual([
      expect.objectContaining({ storeId: storeB, fileName: 'keyword-2026-07-21.xlsx' }),
    ]);
    expect(repository.listAdMetricsForStore(storeA, 'batch-a')).toEqual([
      expect.objectContaining({ storeId: storeA, storeName: 'Shop Alpha', cost: 10.01 }),
    ]);
    expect(repository.listAdMetricsForStore(storeB, 'batch-b')).toEqual([
      expect.objectContaining({ storeId: storeB, storeName: 'Shop Beta', cost: 10.01 }),
    ]);
    expect(repository.listImportRunsForStore(storeA)).toHaveLength(1);
    expect(repository.listImportRunsForStore(storeB)).toHaveLength(1);
    expect(repository.listFileSnapshotsForStore(storeA, 'run-shared')).toEqual([
      expect.objectContaining({ storeId: storeA, batchId: 'batch-a', fileName: 'keyword-2026-07-21.xlsx' }),
    ]);
  });

  it('deduplicates an identical import by store and rejects idempotency-key payload drift', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    const input = importInput('Shop Alpha', 'batch-a');

    expect(repository.commitImportForStore(storeA, input).deduplicated).toBe(false);
    expect(repository.commitImportForStore(storeA, {
      ...input,
      runId: 'retry-run-id-is-deduplicated-by-key',
      files: [...input.files].reverse(),
      metrics: [...input.metrics].reverse(),
    }).deduplicated).toBe(true);
    expect(() => repository.commitImportForStore(storeA, {
      ...input,
      metrics: [{ ...input.metrics[0], clicks: 11 }],
    })).toThrow(/幂等键.*不同输入|不可变历史/);

    expect(database.prepare('SELECT COUNT(*) AS count FROM report_import_runs').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM report_import_file_snapshots').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM ad_daily_metrics').get()).toEqual({ count: 1 });
  });

  it('rolls back run, report file, immutable snapshot and metrics when a later metric is invalid', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    const valid = metric('Shop Alpha', 'batch-a');
    const invalid = metric('Shop Beta', 'batch-a', { sourceRow: 3, searchTerm: 'invalid store row' });

    expect(() => repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a', {
      metrics: [valid, invalid],
      reconciliations: [],
    }))).toThrow(/权威记录不一致/);

    for (const table of [
      'report_import_runs',
      'report_import_file_snapshots',
      'report_import_reconciliations',
      'report_files',
      'ad_daily_metrics',
    ]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  it('treats exactly USD 0.01 as matched and USD 0.0101 as a mismatch', () => {
    expect(reconcileUsdAmount(10, 10.01)).toEqual(expect.objectContaining({
      absoluteDelta1e4: 100,
      tolerance1e4: 100,
      withinTolerance: true,
    }));
    expect(reconcileUsdAmount(10, 10.0101)).toEqual(expect.objectContaining({
      absoluteDelta1e4: 101,
      tolerance1e4: 100,
      withinTolerance: false,
    }));

    const { repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a', {
      metrics: [metric('Shop Alpha', 'batch-a', { cost: 10.01 })],
      reconciliations: [
        { metricDate: '2026-07-21', reportType: 'keyword', expectedRows: 1, expectedCost: 10 },
      ],
    }));

    expect(repository.listReconciliationsForStore(storeA, 'run-shared')).toEqual([
      expect.objectContaining({ metricDate: '2026-07-21', absoluteCostDelta: 0.01, status: 'matched' }),
    ]);

    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-b'));
    expect(() => repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-b', {
      runId: 'run-mismatch',
      idempotencyKey: 'mismatch-key',
      metrics: [metric('Shop Alpha', 'batch-b', { cost: 10.0101 })],
      reconciliations: [
        { metricDate: '2026-07-21', reportType: 'keyword', expectedRows: 1, expectedCost: 10 },
      ],
    }))).toThrow(/IMPORT_RECONCILIATION_MISMATCH/);
    expect(repository.getImportRunForStore(storeA, 'run-mismatch')).toBeUndefined();
    expect(repository.listReportFilesForStore(storeA, 'batch-b')).toEqual([]);
    expect(repository.listAdMetricsForStore(storeA, 'batch-b')).toEqual([]);
    expect(repository.listFileSnapshotsForStore(storeA, 'run-mismatch')).toEqual([]);
  });

  it('protects completed run, file snapshot and reconciliation rows from update or delete', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-a'));

    expect(() => database.prepare(`
      UPDATE report_import_runs SET completed_at = '2099-01-01' WHERE store_id = ?
    `).run(storeA)).toThrow(/immutable/);
    expect(() => database.prepare(`
      DELETE FROM report_import_file_snapshots WHERE store_id = ?
    `).run(storeA)).toThrow(/immutable/);
    expect(() => database.prepare(`
      UPDATE report_import_reconciliations SET status = 'mismatch' WHERE store_id = ?
    `).run(storeA)).toThrow(/immutable/);
  });
});
