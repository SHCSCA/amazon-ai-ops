import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeStoreCapabilityId,
  normalizeStoreId,
  normalizeStoreContextEnvelope,
  type AdDailyMetrics,
  type LingxingCollectionJobSnapshot,
  type LingxingReportBatch,
  type LingxingReportFile,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { StoreRepository } from './store-repo';
import {
  fingerprintLingxingCollectionAuthorityProof,
  LingxingImportRepository,
  reconcileUsdAmount,
  type CommitReportImportInput,
} from './lingxing-import-repo';

const databases: Database.Database[] = [];
const tempDirectories: string[] = [];
const AUTHORITY_REPORT_TYPES = [
  'campaign', 'ad_group', 'placement', 'advertised_product',
  'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
] as const;

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

function fullAuthorityTerminal(
  storeId: StoreId,
  browserProfileId: string,
  batchId: string,
) {
  const completedAt = '2026-07-22T00:05:00.000Z';
  const context = normalizeStoreContextEnvelope({
    storeId,
    browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 3,
  });
  const reports = AUTHORITY_REPORT_TYPES.map((reportType) => ({
    reportType,
    state: 'downloaded' as const,
    attemptIndex: 0,
    autoRetryCount: 0,
    createdReportIdentity: {
      provider: 'lingxing' as const,
      reportType,
      externalReportName: `${reportType}-2026-07-21`,
      externalReportId: `external-${reportType}`,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      createdAt: '2026-07-22T00:02:00.000Z',
    },
    fileSizeBytes: 2048,
    updatedAt: completedAt,
  }));
  const job: LingxingCollectionJobSnapshot = {
    jobId: batchId,
    request: {
      requestId: 'authority-request-1',
      storeContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    },
    lineage: {
      lineageId: batchId,
      rootJobId: batchId,
      expectedReportTypes: AUTHORITY_REPORT_TYPES,
      purpose: 'production_full',
    },
    state: 'completed',
    reports,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: completedAt,
    completedAt,
    importState: 'pending',
  };
  const batch: LingxingReportBatch = {
    id: batchId,
    requestId: job.request.requestId,
    storeId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    dateStart: job.request.dateStart,
    dateEnd: job.request.dateEnd,
    storeName: 'Shop Alpha',
    marketplaceCode: 'US',
    status: 'completed',
    downloadDir: `C:/${batchId}`,
    manifestPath: `C:/${batchId}/manifest.json`,
    createdAt: job.createdAt,
    completedAt,
  };
  const files: LingxingReportFile[] = AUTHORITY_REPORT_TYPES.map((reportType) => ({
    id: `${batchId}-${reportType}`,
    batchId,
    reportType,
    displayName: `${reportType}.xlsx`,
    status: 'downloaded',
    filePath: `C:/${batchId}/${reportType}.xlsx`,
    fileSizeBytes: 2048,
    createdAt: '2026-07-22T00:01:00.000Z',
    updatedAt: completedAt,
  }));
  return { job, batch, files };
}

function failedFullAuthorityTerminal(
  storeId: StoreId,
  batchId: string,
  downloadedCount = 3,
) {
  const terminal = fullAuthorityTerminal(storeId, 'profile-a', batchId);
  const failedAt = '2026-07-22T00:05:00.000Z';
  terminal.job = {
    ...terminal.job,
    state: 'failed',
    reports: terminal.job.reports.map((checkpoint, index) => (
      index < downloadedCount
        ? checkpoint
        : {
            reportType: checkpoint.reportType,
            state: 'failed' as const,
            attemptIndex: 0,
            autoRetryCount: 0,
            errorCode: 'LINGXING_COLLECTION_STEP_FAILED',
            detail: 'safe failure before report creation',
            updatedAt: failedAt,
          }
    )),
    blockerCode: 'LINGXING_COLLECTION_STEP_FAILED',
    detail: 'resume fixture',
    updatedAt: failedAt,
    completedAt: failedAt,
    importState: 'not_applicable',
  };
  terminal.batch = {
    ...terminal.batch,
    status: 'failed',
    completedAt: failedAt,
  };
  terminal.files = terminal.files.slice(0, downloadedCount);
  return terminal;
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
  window: { dateStart: string; dateEnd: string } = {
    dateStart: '2026-07-21',
    dateEnd: '2026-07-21',
  },
): { batch: LingxingReportBatch; files: LingxingReportFile[] } {
  const fileId = `${batchId}-keyword`;
  return {
    batch: {
      id: batchId,
      storeId,
      dateStart: window.dateStart,
      dateEnd: window.dateEnd,
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
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
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

function fullAuthorityImportInput(
  terminal: ReturnType<typeof fullAuthorityTerminal>,
  startedAt: string,
  completedAt: string,
): CommitReportImportInput {
  return {
    runId: `import_${terminal.job.jobId}`,
    idempotencyKey: `lingxing:${terminal.job.jobId}`,
    batchId: terminal.job.jobId,
    files: terminal.files.map((file) => ({
      lingxingFileId: file.id,
      reportType: file.reportType,
      filePath: file.filePath!,
      fileName: path.basename(file.filePath!),
      fileSizeBytes: file.fileSizeBytes!,
      fileHash: 'a'.repeat(64),
      importedRows: 1,
    })),
    metrics: terminal.files.map((file, index) => metric('Shop Alpha', terminal.job.jobId, {
      reportType: file.reportType,
      sourceFile: file.filePath,
      sourceRow: index + 2,
      searchTerm: `authority-${file.reportType}`,
      cost: index + 1,
    })),
    reconciliations: terminal.files.map((file, index) => ({
      dateStart: terminal.job.request.dateStart,
      dateEnd: terminal.job.request.dateEnd,
      metricDate: terminal.job.request.dateEnd,
      reportType: file.reportType,
      expectedRows: 1,
      expectedCost: index + 1,
    })),
    startedAt,
    completedAt,
  };
}

function persistSucceededAuthorityProof(
  repository: LingxingImportRepository,
  storeId: StoreId,
  batchId: string,
): ReturnType<typeof fullAuthorityTerminal> {
  const terminal = fullAuthorityTerminal(storeId, 'profile-a', batchId);
  const attemptedAt = '2026-07-22T00:06:00.000Z';
  terminal.job = {
    ...terminal.job,
    importState: 'pending',
    importAttemptedAt: attemptedAt,
    updatedAt: attemptedAt,
  };
  repository.commitCollectionTerminalForStore(storeId, terminal);
  const commit = repository.commitImportForStore(
    storeId,
    fullAuthorityImportInput(terminal, attemptedAt, '2026-07-22T00:07:00.000Z'),
  );
  const completedAt = new Date(Date.parse(commit.run.createdAt) + 1).toISOString();
  terminal.job = repository.upsertCollectionJobSnapshotForStore(storeId, {
    ...terminal.job,
    importState: 'succeeded',
    importCompletedAt: completedAt,
    updatedAt: completedAt,
  });
  return terminal;
}

describe('LingxingImportRepository', () => {
  it('reads an exact store/request uniquely and fails closed on duplicate durable jobs', () => {
    const { repository, storeA, storeB } = createHarness();
    const first = collectionJob(
      storeA,
      'profile-a',
      'queued',
      '2026-07-22T00:01:00.000Z',
    );

    expect(repository.findUniqueCollectionJobForStoreByRequestId(storeA, first.request.requestId))
      .toBeUndefined();
    repository.upsertCollectionJobSnapshotForStore(storeA, first);
    expect(repository.findUniqueCollectionJobForStoreByRequestId(storeA, first.request.requestId))
      .toEqual(first);
    expect(repository.findUniqueCollectionJobForStoreByRequestId(storeB, first.request.requestId))
      .toBeUndefined();

    repository.upsertCollectionJobSnapshotForStore(storeA, {
      ...first,
      jobId: 'collection-job-duplicate',
      updatedAt: '2026-07-22T00:02:00.000Z',
      reports: first.reports.map((checkpoint) => ({
        ...checkpoint,
        updatedAt: '2026-07-22T00:02:00.000Z',
      })),
    });
    expect(() => repository.findUniqueCollectionJobForStoreByRequestId(
      storeA,
      first.request.requestId,
    )).toThrow(/多个 durable 采集任务/);
  });

  it('finds an exact full-eight semantic collection scope while keeping every scope axis isolated', () => {
    const { repository, storeA, storeB } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-authority-batch');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const exactScope = {
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: terminal.job.request.storeContext.businessDate,
      dateStart: terminal.job.request.dateStart,
      dateEnd: terminal.job.request.dateEnd,
      mode: 'create-and-download' as const,
      reportTypes: AUTHORITY_REPORT_TYPES,
    };

    expect(repository.inspectUniqueCollectionJobForSemanticScope(exactScope)?.job.jobId)
      .toBe(terminal.job.jobId);
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      ...exactScope,
      storeId: storeB,
      browserProfileId: 'profile-b',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      ...exactScope,
      browserProfileId: 'profile-b',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      ...exactScope,
      businessDate: '2026-07-23',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      ...exactScope,
      dateStart: '2026-07-20',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      ...exactScope,
      dateEnd: '2026-07-22',
    })).toBeUndefined();
    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      ...exactScope,
      reportTypes: [...AUTHORITY_REPORT_TYPES].reverse(),
    })?.job.jobId).toBe(terminal.job.jobId);
    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
      ...exactScope,
      reportTypes: AUTHORITY_REPORT_TYPES.slice(0, 7),
    } as never)).toThrow(/严格且不重复的 8\/8/);
  });

  it('returns queued authority for an exact semantic scope regardless of durable state', () => {
    const { repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-queued');
    const queued: LingxingCollectionJobSnapshot = {
      ...terminal.job,
      state: 'queued',
      reports: terminal.job.reports.map((checkpoint) => ({
        reportType: checkpoint.reportType,
        state: 'queued',
        attemptIndex: checkpoint.attemptIndex,
        autoRetryCount: checkpoint.autoRetryCount,
        updatedAt: terminal.job.createdAt,
      })),
      updatedAt: terminal.job.createdAt,
    };
    delete queued.completedAt;
    delete queued.importState;
    delete queued.importAttemptedAt;
    delete queued.importCompletedAt;
    repository.upsertCollectionJobSnapshotForStore(storeA, queued);

    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: '2026-07-22',
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    })?.job.state).toBe('queued');
  });

  it('matches the exact full-eight report set independent of durable JSON array order', () => {
    const { repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-reordered');
    const reversedTypes = [...AUTHORITY_REPORT_TYPES].reverse();
    repository.commitCollectionTerminalForStore(storeA, {
      ...terminal,
      job: {
        ...terminal.job,
        request: {
          ...terminal.job.request,
          reportTypes: reversedTypes,
        },
        lineage: terminal.job.lineage ? {
          ...terminal.job.lineage,
          expectedReportTypes: reversedTypes,
        } : undefined,
      },
    });

    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: '2026-07-22',
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    })?.job.jobId).toBe(terminal.job.jobId);
  });

  it('does not treat wrong mode or a partial report set as the exact full-eight scope', () => {
    const { repository, storeA } = createHarness();
    const wrongModeBase = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-wrong-mode');
    repository.commitCollectionTerminalForStore(storeA, {
      ...wrongModeBase,
      job: {
        ...wrongModeBase.job,
        request: {
          ...wrongModeBase.job.request,
          requestId: 'semantic-wrong-mode-request',
          mode: 'download-existing',
        },
      },
      batch: {
        ...wrongModeBase.batch,
        requestId: 'semantic-wrong-mode-request',
      },
    });
    const partialBase = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-partial');
    repository.commitCollectionTerminalForStore(storeA, {
      ...partialBase,
      job: {
        ...partialBase.job,
        request: {
          ...partialBase.job.request,
          requestId: 'semantic-partial-request',
          reportTypes: AUTHORITY_REPORT_TYPES.slice(0, 7),
        },
        lineage: undefined,
        reports: partialBase.job.reports.slice(0, 7),
      },
      batch: {
        ...partialBase.batch,
        requestId: 'semantic-partial-request',
      },
      files: partialBase.files.slice(0, 7),
    });

    expect(repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: '2026-07-22',
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    })).toBeUndefined();
  });

  it('fails closed when two durable jobs claim the same semantic collection scope', () => {
    const { repository, storeA } = createHarness();
    const first = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-duplicate-a');
    const secondBase = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-duplicate-b');
    const second = {
      ...secondBase,
      job: {
        ...secondBase.job,
        request: {
          ...secondBase.job.request,
          requestId: 'authority-request-2',
        },
      },
      batch: {
        ...secondBase.batch,
        requestId: 'authority-request-2',
      },
    };
    repository.commitCollectionTerminalForStore(storeA, first);
    repository.commitCollectionTerminalForStore(storeA, second);

    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: '2026-07-22',
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/多个 durable 采集任务|拒绝歧义回读/);
  });

  it.each([
    {
      name: 'row/snapshot identity drift',
      tamper: (
        database: Database.Database,
        storeId: StoreId,
        terminal: ReturnType<typeof fullAuthorityTerminal>,
      ) => {
        const snapshot = {
          ...terminal.job,
          request: {
            ...terminal.job.request,
            storeContext: {
              ...terminal.job.request.storeContext,
              browserProfileId: 'profile-b',
            },
          },
        };
        database.prepare(`
          UPDATE lingxing_collection_jobs
          SET snapshot_json = ?
          WHERE store_id = ? AND job_id = ?
        `).run(JSON.stringify(snapshot), storeId, terminal.job.jobId);
      },
    },
    {
      name: 'checkpoint mismatch',
      tamper: (
        database: Database.Database,
        storeId: StoreId,
        terminal: ReturnType<typeof fullAuthorityTerminal>,
      ) => {
        database.prepare(`
          DELETE FROM lingxing_collection_report_checkpoints
          WHERE store_id = ? AND job_id = ? AND report_type = 'keyword'
        `).run(storeId, terminal.job.jobId);
      },
    },
  ])('fails closed on semantic authority $name', ({ tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-tampered');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    tamper(database, storeA, terminal);

    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: '2026-07-22',
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/authority proof.*不一致/);
  });

  it('fails closed when the exact core scope contains malformed durable report-set JSON', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-malformed-report-set');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    database.prepare(`
      UPDATE lingxing_collection_jobs
      SET report_types_json = '{'
      WHERE store_id = ? AND job_id = ?
    `).run(storeA, terminal.job.jobId);

    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: '2026-07-22',
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/损坏的 durable report-set/);
  });

  it('fails closed when a core-scope row carries a valid JSON report set that drifts from its snapshot', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'semantic-valid-json-drift');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    database.prepare(`
      UPDATE lingxing_collection_jobs
      SET report_types_json = ?
      WHERE store_id = ? AND job_id = ?
    `).run(JSON.stringify(AUTHORITY_REPORT_TYPES.slice(0, 7)), storeA, terminal.job.jobId);

    expect(() => repository.inspectUniqueCollectionJobForSemanticScope({
      storeId: storeA,
      browserProfileId: 'profile-a',
      businessDate: '2026-07-22',
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: AUTHORITY_REPORT_TYPES,
    })).toThrow(/authority proof.*不一致|损坏的 durable report-set/);
  });

  it('reads one transactionally coherent scheduler authority proof across job, 8 files and completed import evidence', () => {
    const { repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'authority-batch');
    const committed = repository.commitCollectionTerminalForStore(storeA, terminal);
    repository.commitImportForStore(storeA, {
      runId: 'authority-import-run',
      idempotencyKey: 'authority-import-key',
      batchId: terminal.batch.id,
      files: terminal.files.map((file, index) => ({
        lingxingFileId: file.id,
        reportType: file.reportType,
        filePath: file.filePath!,
        fileName: file.displayName,
        fileSizeBytes: file.fileSizeBytes!,
        fileHash: `${index + 1}`.repeat(64),
        importedRows: 0,
      })),
      metrics: [],
      reconciliations: AUTHORITY_REPORT_TYPES.map((reportType) => ({
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        metricDate: '2026-07-21',
        reportType,
        expectedRows: 0,
        expectedCost: 0,
      })),
      startedAt: '2026-07-22T00:05:01.000Z',
      completedAt: '2026-07-22T00:05:02.000Z',
    });
    repository.upsertCollectionJobSnapshotForStore(storeA, {
      ...committed.job,
      importState: 'succeeded',
      importAttemptedAt: '2026-07-22T00:05:01.000Z',
      importCompletedAt: '2026-07-22T00:05:02.000Z',
      updatedAt: '2026-07-22T00:05:02.000Z',
    });

    const proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    );

    expect(proof).toMatchObject({
      job: {
        jobId: terminal.job.jobId,
        state: 'completed',
        importState: 'succeeded',
      },
      jobRow: {
        storeId: storeA,
        jobId: terminal.job.jobId,
        requestId: terminal.job.request.requestId,
        browserProfileId: 'profile-a',
        state: 'completed',
      },
      checkpointCount: 8,
      batch: {
        id: terminal.batch.id,
        storeId: storeA,
        status: 'completed',
      },
      lingxingFileCount: 8,
      importRunCount: 1,
      importFileSnapshotCount: 8,
      importedReportFileCount: 8,
      reconciliationRowCount: 8,
    });
    expect(proof?.lingxingFiles.map((file) => file.reportType).sort())
      .toEqual([...AUTHORITY_REPORT_TYPES].sort());
    expect(proof?.importRuns).toEqual([
      expect.objectContaining({
        runId: 'authority-import-run',
        batchId: terminal.batch.id,
        status: 'completed',
        sourceFileCount: 8,
      }),
    ]);
    expect(proof?.importFileSnapshots.every((snapshot) => (
      snapshot.runId === 'authority-import-run'
      && snapshot.batchId === terminal.batch.id
      && snapshot.fileHash.length === 64
      && snapshot.fileSizeBytes === 2048
      && Boolean(snapshot.lingxingFileId)
      && Number.isInteger(snapshot.reportFileId)
    ))).toBe(true);
    expect(proof?.importedReportFiles.every((file) => (
      file.status === 'imported'
      && file.fileHash?.length === 64
      && file.fileSizeBytes === 2048
    ))).toBe(true);
    expect(proof?.reconciliations.every((row) => (
      row.runId === 'authority-import-run'
      && row.batchId === terminal.batch.id
      && row.status === 'matched'
      && row.withinTolerance
    ))).toBe(true);

    proof!.lingxingFiles[0]!.displayName = 'caller-mutation.xlsx';
    expect(repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    )?.lingxingFiles[0]?.displayName).not.toBe('caller-mutation.xlsx');
  });

  it.each([
    {
      name: 'SQL job identity drift',
      tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
        database.prepare(`
          UPDATE lingxing_collection_jobs
          SET browser_profile_id = 'profile-b'
          WHERE store_id = ? AND job_id = ?
        `).run(storeId, jobId);
      },
    },
    {
      name: 'checkpoint count drift',
      tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
        database.prepare(`
          DELETE FROM lingxing_collection_report_checkpoints
          WHERE store_id = ? AND job_id = ? AND report_type = 'keyword'
        `).run(storeId, jobId);
      },
    },
  ])('throws instead of returning a mixed authority proof after $name', ({ tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'tampered-authority-batch');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    tamper(database, storeA, terminal.job.jobId);

    expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    )).toThrow(/authority proof.*不一致/);
  });

  it.each([
    {
      name: 'batch created_at',
      tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
        database.prepare(`
          UPDATE lingxing_report_batches SET created_at = '1'
          WHERE store_id = ? AND id = ?
        `).run(storeId, jobId);
      },
    },
    {
      name: 'Lingxing file updated_at',
      tamper: (database: Database.Database, storeId: StoreId, jobId: string) => {
        database.prepare(`
          UPDATE lingxing_report_files SET updated_at = '1'
          WHERE store_id = ? AND batch_id = ? AND report_type = 'keyword'
        `).run(storeId, jobId);
      },
    },
  ])('rejects non-canonical UTC authority-proof $name', ({ tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'timestamp-authority-batch');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    tamper(database, storeA, terminal.job.jobId);

    expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    )).toThrow(/非规范 ISO-8601 UTC/);
  });

  it('rejects canonical succeeded-import timestamps when completed precedes started', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'inverted-import-timeline');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    expect(() => repository.commitImportForStore(storeA, {
      runId: 'inverted-import-run',
      idempotencyKey: 'inverted-import-key',
      batchId: terminal.batch.id,
      files: terminal.files.map((file, index) => ({
        lingxingFileId: file.id,
        reportType: file.reportType,
        filePath: file.filePath!,
        fileName: file.displayName,
        fileSizeBytes: file.fileSizeBytes!,
        fileHash: `${index + 1}`.repeat(64),
        importedRows: 0,
      })),
      metrics: [],
      reconciliations: [],
      startedAt: '2026-07-22T00:05:03.000Z',
      completedAt: '2026-07-22T00:05:02.000Z',
    })).toThrow(/IMPORT_RUN_TIMELINE_INVALID/);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM report_import_runs WHERE store_id = ? AND run_id = ?
    `).get(storeA, 'inverted-import-run')).toEqual({ count: 0 });
    expect(repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    )).toMatchObject({ importRunCount: 0, importRuns: [] });
  });

  it.each([
    {
      name: 'run createdAt before completedAt',
      batchId: 'authority-timeline-run-created',
      tamper: (database: Database.Database, storeId: StoreId, batchId: string) => {
        database.exec('DROP TRIGGER trg_report_import_runs_immutable_update');
        database.prepare(`
          UPDATE report_import_runs
          SET created_at = '2026-07-22T00:06:59.000Z'
          WHERE store_id = ? AND batch_id = ?
        `).run(storeId, batchId);
      },
    },
    {
      name: 'imported file lastImportedAt before unique run start',
      batchId: 'authority-timeline-file-imported',
      tamper: (database: Database.Database, storeId: StoreId, batchId: string) => {
        database.prepare(`
          UPDATE report_files
          SET last_imported_at = '2026-07-22T00:05:30.000Z'
          WHERE store_id = ? AND batch_id = ?
        `).run(storeId, batchId);
      },
    },
  ])('rejects persisted succeeded authority proof with $name', ({ batchId, tamper }) => {
    const { database, repository, storeA } = createHarness();
    const terminal = persistSucceededAuthorityProof(
      repository,
      storeA,
      batchId,
    );
    tamper(database, storeA, terminal.job.jobId);

    expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    )).toThrow(/authority proof.*时间顺序/);
  });

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

  it('binds new batches to the current Lingxing selector while preserving historical selector snapshots', () => {
    const { database, repository, storeA, storeB } = createHarness();
    const storeRepository = new StoreRepository(database);
    const connection = storeRepository.createConnection({
      id: normalizeStoreCapabilityId('cap-selector-snapshot-a'),
      storeId: storeA,
      provider: 'lingxing',
      collectionStoreName: 'Lingxing US Store',
    });
    const historical = terminalCollection(
      storeA,
      'profile-a',
      'Lingxing US Store',
      'batch-selector-history',
    );
    const committed = repository.commitCollectionTerminalForStore(storeA, historical);
    expect(committed.batch).toMatchObject({
      storeId: storeA,
      storeName: 'Lingxing US Store',
      browserProfileId: 'profile-a',
      sessionGeneration: 3,
      marketplaceCode: 'US',
    });

    storeRepository.updateConnection({
      id: connection.id,
      storeId: storeA,
      expectedUpdatedAt: connection.updatedAt,
      collectionStoreName: 'Lingxing US Store Renamed',
    });

    expect(repository.getCollectionSnapshotForStore(storeA, historical.batch.id)?.batch.storeName)
      .toBe('Lingxing US Store');
    expect(repository.saveCollectionSnapshotForStore(storeA, historical).batch.storeName)
      .toBe('Lingxing US Store');
    expect(() => repository.saveCollectionSnapshotForStore(storeA, {
      ...historical,
      batch: {
        ...historical.batch,
        storeName: 'Lingxing US Store Renamed',
      },
    })).toThrow(/LINGXING_BATCH_AUTHORITY_IMMUTABLE/);
    expect(repository.commitImportForStore(
      storeA,
      importInput('Lingxing US Store', historical.batch.id, {
        runId: 'run-selector-history',
        idempotencyKey: 'selector-history-key',
      }),
    ).deduplicated).toBe(false);
    expect(repository.listAdMetricsForStore(storeA, historical.batch.id)).toEqual([
      expect.objectContaining({
        storeId: storeA,
        storeName: 'Lingxing US Store',
      }),
    ]);

    expect(() => repository.saveCollectionSnapshotForStore(
      storeA,
      collectionSnapshot(storeA, 'Lingxing US Store', 'batch-stale-selector-forged'),
    )).toThrow(/既不匹配当前 collection selector.*本地逻辑店铺名/);
    expect(() => repository.saveCollectionSnapshotForStore(
      storeA,
      collectionSnapshot(storeA, 'Arbitrary Third Name', 'batch-third-name-forged'),
    )).toThrow(/既不匹配当前 collection selector.*本地逻辑店铺名/);

    expect(repository.saveCollectionSnapshotForStore(
      storeA,
      collectionSnapshot(storeA, 'Lingxing US Store Renamed', 'batch-current-selector'),
    ).batch.storeName).toBe('Lingxing US Store Renamed');
    expect(repository.saveCollectionSnapshotForStore(
      storeA,
      collectionSnapshot(storeA, 'Shop Alpha', 'batch-logical-local-import'),
    ).batch.storeName).toBe('Shop Alpha');

    expect(repository.getCollectionSnapshotForStore(storeB, historical.batch.id)).toBeUndefined();
    expect(() => repository.commitImportForStore(
      storeB,
      importInput('Lingxing US Store', historical.batch.id, {
        runId: 'run-cross-store-selector-history',
        idempotencyKey: 'cross-store-selector-history-key',
      }),
    )).toThrow(/不属于店铺/);
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

  it('keeps implicit import completion/creation at or after an explicit future startedAt', () => {
    const { repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(
      storeA,
      collectionSnapshot(storeA, 'Shop Alpha', 'batch-future-start'),
    );
    const startedAt = new Date(Date.now() + 60_000).toISOString();

    const result = repository.commitImportForStore(storeA, importInput(
      'Shop Alpha',
      'batch-future-start',
      {
        runId: 'run-future-start',
        idempotencyKey: 'future-start-key',
        startedAt,
        completedAt: undefined,
      },
    ));

    expect(Date.parse(result.run.completedAt)).toBeGreaterThanOrEqual(Date.parse(startedAt));
    expect(Date.parse(result.run.createdAt)).toBeGreaterThanOrEqual(
      Date.parse(result.run.completedAt),
    );
  });

  it('rejects a past explicit completedAt when startedAt defaults to now without durable side effects', () => {
    const { database, repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(
      storeA,
      collectionSnapshot(storeA, 'Shop Alpha', 'batch-reversed-run'),
    );

    const completedAt = new Date(Date.now() - 60_000).toISOString();
    expect(() => repository.commitImportForStore(storeA, importInput(
      'Shop Alpha',
      'batch-reversed-run',
      {
        runId: 'run-reversed',
        idempotencyKey: 'reversed-key',
        startedAt: undefined,
        completedAt,
      },
    ))).toThrow(/IMPORT_RUN_TIMELINE_INVALID/);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM report_import_runs WHERE store_id = ? AND run_id = ?
    `).get(storeA, 'run-reversed')).toEqual({ count: 0 });
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

  it('reconciles one control-total across the complete two-day batch window', () => {
    const { repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(
      storeA,
      'Shop Alpha',
      'batch-two-day',
      { dateStart: '2026-07-20', dateEnd: '2026-07-21' },
    ));

    repository.commitImportForStore(storeA, importInput('Shop Alpha', 'batch-two-day', {
      runId: 'run-two-day',
      idempotencyKey: 'two-day-window',
      files: [{
        ...importInput('Shop Alpha', 'batch-two-day').files[0]!,
        lingxingFileId: 'batch-two-day-keyword',
        importedRows: 2,
      }],
      metrics: [
        metric('Shop Alpha', 'batch-two-day', {
          date: '2026-07-20',
          cost: 4,
          sourceRow: 2,
        }),
        metric('Shop Alpha', 'batch-two-day', {
          date: '2026-07-21',
          cost: 6,
          searchTerm: 'smart lock second day',
          sourceRow: 3,
        }),
      ],
      reconciliations: [{
        dateStart: '2026-07-20',
        dateEnd: '2026-07-21',
        metricDate: '2026-07-21',
        reportType: 'keyword',
        expectedRows: 2,
        expectedCost: 10,
      }],
    }));

    expect(repository.listReconciliationsForStore(storeA, 'run-two-day')).toEqual([
      expect.objectContaining({
        dateStart: '2026-07-20',
        dateEnd: '2026-07-21',
        metricDate: '2026-07-21',
        actualRows: 2,
        actualCost: 10,
        status: 'matched',
      }),
    ]);
  });

  it('keeps an imported two-day batch window immutable when the same batch id is replayed as one day', () => {
    const { repository, storeA } = createHarness();
    const original = collectionSnapshot(
      storeA,
      'Shop Alpha',
      'batch-two-day-immutable',
      { dateStart: '2026-07-20', dateEnd: '2026-07-21' },
    );
    repository.saveCollectionSnapshotForStore(storeA, original);
    repository.commitImportForStore(storeA, importInput('Shop Alpha', original.batch.id, {
      runId: 'run-two-day-immutable',
      idempotencyKey: 'two-day-immutable',
      files: [{
        ...importInput('Shop Alpha', original.batch.id).files[0]!,
        lingxingFileId: `${original.batch.id}-keyword`,
        importedRows: 2,
      }],
      metrics: [
        metric('Shop Alpha', original.batch.id, { date: '2026-07-20', cost: 4, sourceRow: 2 }),
        metric('Shop Alpha', original.batch.id, {
          date: '2026-07-21',
          cost: 6,
          sourceRow: 3,
          searchTerm: 'immutable second day',
        }),
      ],
      reconciliations: [{
        dateStart: '2026-07-20',
        dateEnd: '2026-07-21',
        metricDate: '2026-07-21',
        reportType: 'keyword',
        expectedRows: 2,
        expectedCost: 10,
      }],
    }));

    expect(() => repository.saveCollectionSnapshotForStore(storeA, {
      ...original,
      batch: {
        ...original.batch,
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
      },
    })).toThrow(/LINGXING_BATCH_AUTHORITY_IMMUTABLE/);
    expect(() => repository.saveCollectionSnapshotForStore(storeA, {
      ...original,
      batch: {
        ...original.batch,
        downloadDir: 'C:/drifted-download-directory',
        manifestPath: 'C:/drifted-download-directory/manifest.json',
      },
    })).toThrow(/IMPORTED_BATCH_AUTHORITY_IMMUTABLE/);
    expect(repository.listBatchesForStore(storeA)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: original.batch.id,
        dateStart: '2026-07-20',
        dateEnd: '2026-07-21',
      }),
    ]));
    expect(repository.listReconciliationsForStore(storeA, 'run-two-day-immutable')).toEqual([
      expect.objectContaining({
        dateStart: '2026-07-20',
        dateEnd: '2026-07-21',
        actualRows: 2,
        actualCost: 10,
      }),
    ]);
    expect(repository.getImportRunForStore(storeA, 'run-two-day-immutable')).toMatchObject({
      batchId: original.batch.id,
      status: 'completed',
      sourceFileCount: 1,
      reconciliationCount: 1,
    });
  });

  it.each([
    {
      label: 'partial control-total window',
      reconciliation: {
        dateStart: '2026-07-21',
        dateEnd: '2026-07-21',
        metricDate: '2026-07-21',
        reportType: 'keyword',
        expectedRows: 1,
        expectedCost: 6,
      },
      error: /IMPORT_RECONCILIATION_WINDOW_MISMATCH/,
    },
    {
      label: 'wrong complete-window total',
      reconciliation: {
        dateStart: '2026-07-20',
        dateEnd: '2026-07-21',
        metricDate: '2026-07-21',
        reportType: 'keyword',
        expectedRows: 2,
        expectedCost: 9,
      },
      error: /IMPORT_RECONCILIATION_MISMATCH/,
    },
  ])('atomically rejects a two-day import with $label', ({ reconciliation, error }) => {
    const { database, repository, storeA } = createHarness();
    const batchId = `batch-two-day-failure-${reconciliation.expectedCost}`;
    const runId = `run-two-day-failure-${reconciliation.expectedCost}`;
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(
      storeA,
      'Shop Alpha',
      batchId,
      { dateStart: '2026-07-20', dateEnd: '2026-07-21' },
    ));
    const input = importInput('Shop Alpha', batchId, {
      runId,
      idempotencyKey: `${runId}-key`,
      metrics: [
        metric('Shop Alpha', batchId, { date: '2026-07-20', cost: 4, sourceRow: 2 }),
        metric('Shop Alpha', batchId, {
          date: '2026-07-21',
          cost: 6,
          searchTerm: 'smart lock second day',
          sourceRow: 3,
        }),
      ],
      reconciliations: [reconciliation],
    });

    expect(() => repository.commitImportForStore(storeA, input)).toThrow(error);
    for (const [table, predicate] of [
      ['report_import_runs', 'run_id = ?'],
      ['report_import_file_snapshots', 'run_id = ?'],
      ['report_import_reconciliations', 'run_id = ?'],
      ['report_files', 'batch_id = ?'],
      ['ad_daily_metrics', 'batch_id = ?'],
    ] as const) {
      const identity = predicate.startsWith('run_id') ? runId : batchId;
      expect(database.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE store_id = ? AND ${predicate}`,
      ).get(storeA, identity)).toEqual({ count: 0 });
    }
  });

  it.each([
    {
      label: 'an extra metric report type without a reconciliation',
      build: (batchId: string) => importInput('Shop Alpha', batchId, {
        runId: 'run-extra-report-type',
        idempotencyKey: 'extra-report-type',
        metrics: [
          metric('Shop Alpha', batchId),
          metric('Shop Alpha', batchId, {
            reportType: 'campaign',
            campaignName: 'uncovered campaign',
            searchTerm: 'uncovered campaign metric',
            sourceRow: 3,
          }),
        ],
      }),
      error: /IMPORT_METRIC_REPORT_TYPE_UNCOVERED/,
    },
    {
      label: 'a file imported-row count that differs from its metrics and reconciliation',
      build: (batchId: string) => importInput('Shop Alpha', batchId, {
        runId: 'run-file-row-drift',
        idempotencyKey: 'file-row-drift',
        files: [{
          ...importInput('Shop Alpha', batchId).files[0]!,
          importedRows: 2,
        }],
      }),
      error: /IMPORT_REPORT_ROW_COUNT_MISMATCH/,
    },
  ])('atomically rejects exact-count drift from $label', ({ build, error }) => {
    const { database, repository, storeA } = createHarness();
    const batchId = 'batch-exact-count-drift';
    repository.saveCollectionSnapshotForStore(
      storeA,
      collectionSnapshot(storeA, 'Shop Alpha', batchId),
    );

    expect(() => repository.commitImportForStore(storeA, build(batchId))).toThrow(error);

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
        {
          dateStart: '2026-07-21', dateEnd: '2026-07-21', metricDate: '2026-07-21',
          reportType: 'keyword', expectedRows: 1, expectedCost: 10,
        },
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
        {
          dateStart: '2026-07-21', dateEnd: '2026-07-21', metricDate: '2026-07-21',
          reportType: 'keyword', expectedRows: 1, expectedCost: 10,
        },
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

  it('atomically completes an exact pending import recovery proof and rejects stale replay', () => {
    const { database, databasePath, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'authority-recovery-batch');
    const attemptedAt = '2026-07-22T00:06:00.000Z';
    terminal.job = {
      ...terminal.job,
      importState: 'pending',
      importAttemptedAt: attemptedAt,
      updatedAt: attemptedAt,
    };
    repository.commitCollectionTerminalForStore(storeA, terminal);
    repository.commitImportForStore(
      storeA,
      fullAuthorityImportInput(terminal, attemptedAt, '2026-07-22T00:07:00.000Z'),
    );
    database.close();
    const reopenedDatabase = initSqlite(databasePath);
    databases.push(reopenedDatabase);
    const reopenedRepository = new LingxingImportRepository(reopenedDatabase);
    const proof = reopenedRepository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    )!;
    const recoveryCompletedAt = new Date(
      Date.parse(proof.importRuns[0]!.createdAt) + 1,
    ).toISOString();
    const token = {
      storeId: storeA,
      jobId: terminal.job.jobId,
      requestId: terminal.job.request.requestId,
      expectedJobUpdatedAt: terminal.job.updatedAt,
      expectedImportState: 'pending' as const,
      expectedRunId: `import_${terminal.job.jobId}`,
      expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
    };

    expect(() => reopenedRepository.completeRecoveredCollectionImportForStore(token, {
      attemptedAt,
      completedAt: proof.importRuns[0]!.completedAt,
    })).toThrow(/COLLECTION_IMPORT_RECOVERY_CAS_INVALID/);
    expect(reopenedRepository.getCollectionJobForStore(storeA, terminal.job.jobId)).toMatchObject({
      importState: 'pending',
      updatedAt: attemptedAt,
    });

    const succeeded = reopenedRepository.completeRecoveredCollectionImportForStore(token, {
      attemptedAt,
      completedAt: recoveryCompletedAt,
    });
    expect(succeeded).toMatchObject({
      importState: 'succeeded',
      importAttemptedAt: attemptedAt,
      importCompletedAt: recoveryCompletedAt,
      updatedAt: recoveryCompletedAt,
    });
    expect(() => reopenedRepository.completeRecoveredCollectionImportForStore(token, {
      attemptedAt,
      completedAt: '2026-07-22T00:09:00.000Z',
    })).toThrow(/COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT/);
    expect(reopenedRepository.getCollectionJobForStore(storeA, terminal.job.jobId)?.importCompletedAt)
      .toBe(recoveryCompletedAt);
  });

  it('does not overwrite pending state when immutable authority evidence drifts before recovery CAS', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = fullAuthorityTerminal(storeA, 'profile-a', 'authority-recovery-drift');
    const attemptedAt = '2026-07-22T00:06:00.000Z';
    terminal.job = {
      ...terminal.job,
      importState: 'pending',
      importAttemptedAt: attemptedAt,
      updatedAt: attemptedAt,
    };
    repository.commitCollectionTerminalForStore(storeA, terminal);
    repository.commitImportForStore(
      storeA,
      fullAuthorityImportInput(terminal, attemptedAt, '2026-07-22T00:07:00.000Z'),
    );
    const proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      terminal.job.request.requestId,
    )!;
    const token = {
      storeId: storeA,
      jobId: terminal.job.jobId,
      requestId: terminal.job.request.requestId,
      expectedJobUpdatedAt: terminal.job.updatedAt,
      expectedImportState: 'pending' as const,
      expectedRunId: `import_${terminal.job.jobId}`,
      expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
    };
    database.prepare(`
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id,
        status, source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 0, 0, 0, ?, ?, ?)
    `).run(
      storeA,
      'foreign-completed-run',
      'foreign-completed-run-key',
      'b'.repeat(64),
      terminal.job.jobId,
      attemptedAt,
      '2026-07-22T00:07:30.000Z',
      '2026-07-22T00:07:30.000Z',
    );

    expect(() => repository.completeRecoveredCollectionImportForStore(token, {
      attemptedAt,
      completedAt: '2026-07-22T00:08:00.000Z',
    })).toThrow(/COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT/);
    expect(repository.getCollectionJobForStore(storeA, terminal.job.jobId)).toMatchObject({
      importState: 'pending',
      updatedAt: attemptedAt,
    });
  });

  it('acquires one same-job resume claim, rotates it on progress, and consumes it once on success', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'same-job-resume-1');
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(
      storeA,
      terminal.job.jobId,
    )!;
    expect(packet.jobId).toBe(terminal.job.jobId);
    expect(packet.files).toHaveLength(3);
    expect(packet.reports.filter((checkpoint) => checkpoint.state === 'downloaded'))
      .toHaveLength(3);
    expect(packet.reports.filter((checkpoint) => checkpoint.state === 'queued'))
      .toHaveLength(5);
    const executionStoreContext = normalizeStoreContextEnvelope({
      ...packet.request.storeContext,
      sessionGeneration: 4,
    });
    const claimInput = {
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
      executionStoreContext,
      claimedAt: '2026-07-22T00:05:30.000Z',
    };
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
      ...claimInput,
      attemptId: 'attempt-same-job-1',
    });
    expect(() => repository.acquireCollectionResumeClaimForStore(storeA, {
      ...claimInput,
      attemptId: 'attempt-double-click',
    })).toThrow(/CLAIM_CONFLICT/);

    const runningAt = '2026-07-22T00:06:00.000Z';
    const runningJob: LingxingCollectionJobSnapshot = {
      ...packet.job,
      state: 'running',
      reports: packet.reports,
      blockerCode: undefined,
      detail: undefined,
      completedAt: undefined,
      updatedAt: runningAt,
    };
    const nextClaim = repository.commitCollectionResumeProgressForStore(storeA, {
      claim,
      event: {
        eventId: `${claim.attemptId}:runner:1`,
        emittedAt: runningAt,
        job: runningJob,
      },
    });
    expect(nextClaim.version).toBe(2);
    expect(nextClaim.claimToken).not.toBe(claim.claimToken);
    expect(() => repository.commitCollectionResumeProgressForStore(storeA, {
      claim,
      event: {
        eventId: `${claim.attemptId}:runner:replay`,
        emittedAt: '2026-07-22T00:06:01.000Z',
        job: { ...runningJob, updatedAt: '2026-07-22T00:06:01.000Z' },
      },
    })).toThrow(/CAS_CONFLICT/);

    const completedAt = '2026-07-22T00:07:00.000Z';
    const reports = packet.reports.map((checkpoint) => ({
      ...checkpoint,
      state: 'downloaded' as const,
      createdReportIdentity: checkpoint.createdReportIdentity ?? {
        provider: 'lingxing' as const,
        reportType: checkpoint.reportType,
        externalReportName: `${checkpoint.reportType}-resumed`,
        externalReportId: `external-resumed-${checkpoint.reportType}`,
        dateStart: packet.request.dateStart,
        dateEnd: packet.request.dateEnd,
        createdAt: '2026-07-22T00:06:30.000Z',
      },
      fileSizeBytes: 2048,
      updatedAt: completedAt,
    }));
    const files: LingxingReportFile[] = reports.map((checkpoint) => (
      packet.files.find((file) => file.reportType === checkpoint.reportType) ?? {
        id: `${packet.jobId}-${checkpoint.reportType}`,
        batchId: packet.jobId,
        reportType: checkpoint.reportType,
        displayName: `${checkpoint.reportType}.xlsx`,
        status: 'downloaded' as const,
        filePath: `C:/${packet.jobId}/${checkpoint.reportType}.xlsx`,
        fileSizeBytes: 2048,
        createdAt: '2026-07-22T00:06:30.000Z',
        updatedAt: completedAt,
      }
    )).map((file) => ({ ...file, status: 'downloaded', updatedAt: completedAt }));
    const prepared = repository.commitCollectionResumeRunnerResultForStore(storeA, {
      claim: nextClaim,
      job: {
        ...runningJob,
        state: 'completed',
        reports,
        completedAt,
        updatedAt: completedAt,
        importState: 'pending',
      },
      batch: {
        ...packet.batch,
        status: 'completed',
        completedAt,
      },
      files,
    });
    expect(prepared.result.job.jobId).toBe(packet.jobId);
    expect(prepared.result.files).toHaveLength(8);
    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(
      storeA,
      packet.jobId,
      packet.request.requestId,
    )).toBeUndefined();

    const attemptedAt = '2026-07-22T00:07:01.000Z';
    const attemptedClaim = repository.commitCollectionResumeProgressForStore(storeA, {
      claim: prepared.claim,
      event: {
        eventId: `${claim.attemptId}:import:pending`,
        emittedAt: attemptedAt,
        job: {
          ...prepared.result.job,
          importState: 'pending',
          importAttemptedAt: attemptedAt,
          updatedAt: attemptedAt,
        },
      },
    });
    const importCompletedAt = '2026-07-22T00:07:02.000Z';
    const crashImportInput = fullAuthorityImportInput(
      {
        job: { ...prepared.result.job, importAttemptedAt: attemptedAt, updatedAt: attemptedAt },
        batch: prepared.result.batch,
        files: prepared.result.files,
      },
      attemptedAt,
      importCompletedAt,
    );
    const imported = repository.commitImportForStore(storeA, crashImportInput);
    const importedClaim = repository.advanceCollectionResumeClaimAfterImportForStore(storeA, {
      claim: attemptedClaim,
      advancedAt: imported.run.createdAt,
    });
    const succeededAt = new Date(Date.parse(imported.run.createdAt) + 1).toISOString();
    const finalClaim = repository.commitCollectionResumeProgressForStore(storeA, {
      claim: importedClaim,
      event: {
        eventId: `${claim.attemptId}:import:succeeded`,
        emittedAt: succeededAt,
        job: {
          ...prepared.result.job,
          importState: 'succeeded',
          importAttemptedAt: attemptedAt,
          importCompletedAt: succeededAt,
          updatedAt: succeededAt,
        },
      },
    });
    const receipt = repository.finalizeCollectionResumeAttemptForStore(storeA, {
      claim: finalClaim,
      outcome: 'succeeded',
      completedAt: succeededAt,
    });
    expect(receipt).toMatchObject({
      attemptId: claim.attemptId,
      outcome: 'succeeded',
      durableSessionGeneration: 3,
      executionSessionGeneration: 4,
    });
    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(
      storeA,
      packet.jobId,
      packet.request.requestId,
    )).toEqual(receipt);
    expect(() => repository.finalizeCollectionResumeAttemptForStore(storeA, {
      claim: finalClaim,
      outcome: 'succeeded',
      completedAt: succeededAt,
    })).toThrow(/CAS_CONFLICT/);
  });

  it('allows an exact full-eight completed-with-errors snapshot to resume its failed report checkpoints in place', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'partial-full8-resume');
    terminal.job = {
      ...terminal.job,
      state: 'completed_with_errors',
    };
    terminal.batch = {
      ...terminal.batch,
      status: 'completed_with_errors',
    };
    repository.commitCollectionTerminalForStore(storeA, terminal);

    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId);

    expect(packet).toMatchObject({
      jobId: terminal.job.jobId,
      job: { state: 'completed_with_errors' },
    });
    expect(packet?.reports.filter((checkpoint) => checkpoint.state === 'downloaded')).toHaveLength(3);
    expect(packet?.reports.filter((checkpoint) => checkpoint.state === 'queued')).toHaveLength(5);
  });

  it('interrupts an orphaned creating resume at startup without browser work or a reusable claim', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'startup-resume-1', 0);
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId)!;
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
      executionStoreContext: packet.request.storeContext,
      attemptId: 'attempt-startup-1',
      claimedAt: '2026-07-22T00:05:30.000Z',
    });
    const progressAt = '2026-07-22T00:06:00.000Z';
    repository.commitCollectionResumeProgressForStore(storeA, {
      claim,
      event: {
        eventId: `${claim.attemptId}:runner:1`,
        emittedAt: progressAt,
        changedReportType: packet.reports[0].reportType,
        job: {
          ...packet.job,
          state: 'running',
          completedAt: undefined,
          blockerCode: undefined,
          detail: undefined,
          reports: packet.reports.map((checkpoint, index) => index === 0
            ? { ...checkpoint, state: 'creating', updatedAt: progressAt }
            : checkpoint),
          updatedAt: progressAt,
        },
      },
    });

    const receipts = repository.interruptOrphanedCollectionResumeClaimsForStartup(
      '2020-01-01T00:00:00.000Z',
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      attemptId: claim.attemptId,
      outcome: 'interrupted',
    });
    expect(Date.parse(receipts[0].completedAt)).toBeGreaterThan(Date.parse(progressAt));
    const interrupted = repository.getCollectionJobForStore(storeA, packet.jobId)!;
    expect(interrupted.state).toBe('failed');
    expect(interrupted.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'create_unknown' }),
    ]));
    expect(() => repository.getCollectionInPlaceResumeStateForStore(storeA, packet.jobId))
      .toThrow(/create_unknown/);
    expect(repository.interruptOrphanedCollectionResumeClaimsForStartup(
      '2026-07-22T00:07:00.000Z',
    )).toEqual([]);
  });

  it('keeps general recovery away from a no-progress resume claim and preserves its receipt timeline', () => {
    const { repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'startup-no-progress', 3);
    repository.commitCollectionTerminalForStore(storeA, terminal);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, terminal.job.jobId)!;
    const claimedAt = '2026-07-22T00:05:30.000Z';
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
      executionStoreContext: packet.request.storeContext,
      attemptId: 'attempt-no-progress',
      claimedAt,
    });

    expect(repository.recoverInterruptedCollectionJobsForStore(storeA, {
      completedAt: '2026-07-22T00:06:00.000Z',
    })).toEqual([]);
    const receipt = repository.interruptOrphanedCollectionResumeClaimsForStartup(
      '2020-01-01T00:00:00.000Z',
    )[0];
    expect(receipt).toMatchObject({
      attemptId: claim.attemptId,
      outcome: 'interrupted',
    });
    expect(Date.parse(receipt.finalJobUpdatedAt)).toBeGreaterThanOrEqual(Date.parse(claimedAt));
    expect(Date.parse(receipt.completedAt)).toBeGreaterThan(Date.parse(receipt.finalJobUpdatedAt));
    expect(repository.getCollectionJobForStore(storeA, packet.jobId)).toEqual(
      expect.objectContaining({ state: 'failed', updatedAt: receipt.finalJobUpdatedAt }),
    );
  });

  it('rejects an in-place packet with duplicate durable files for one report type', () => {
    const { database, repository, storeA } = createHarness();
    const terminal = failedFullAuthorityTerminal(storeA, 'duplicate-resume-file', 1);
    repository.commitCollectionTerminalForStore(storeA, terminal);
    database.prepare(`
      INSERT INTO lingxing_report_files (
        id, batch_id, report_type, display_name, status,
        max_auto_retries, auto_retry_count, file_path, file_size_bytes,
        error_message, attempt_errors_json, failure_screenshot_path,
        failure_dom_snapshot_path, failure_trace_path, trace_unavailable_reason,
        created_at, updated_at, store_id
      )
      SELECT id || '-duplicate', batch_id, report_type, display_name, status,
             max_auto_retries, auto_retry_count, file_path, file_size_bytes,
             error_message, attempt_errors_json, failure_screenshot_path,
             failure_dom_snapshot_path, failure_trace_path, trace_unavailable_reason,
             created_at, updated_at, store_id
      FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
      LIMIT 1
    `).run(storeA, terminal.job.jobId);

    expect(() => repository.getCollectionInPlaceResumeStateForStore(
      storeA,
      terminal.job.jobId,
    )).toThrow(/重复 durable file/);
  });

  it('appends a succeeded successor after startup interrupts the import-commit crash window', () => {
    const { repository, storeA } = createHarness();
    const failed = failedFullAuthorityTerminal(storeA, 'resume-import-crash', 3);
    repository.commitCollectionTerminalForStore(storeA, failed);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, failed.job.jobId)!;
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
      executionStoreContext: packet.request.storeContext,
      attemptId: 'attempt-import-crash',
      claimedAt: '2026-07-22T00:05:30.000Z',
    });
    const succeeded = fullAuthorityTerminal(storeA, 'profile-a', packet.jobId);
    const runnerCompletedAt = '2026-07-22T00:07:00.000Z';
    succeeded.job = {
      ...succeeded.job,
      request: packet.request,
      lineage: packet.job.lineage,
      importState: 'pending',
      completedAt: runnerCompletedAt,
      updatedAt: runnerCompletedAt,
    };
    succeeded.batch = {
      ...succeeded.batch,
      requestId: packet.request.requestId,
      downloadDir: packet.batch.downloadDir,
      createdAt: packet.batch.createdAt,
      completedAt: runnerCompletedAt,
    };
    const prepared = repository.commitCollectionResumeRunnerResultForStore(storeA, {
      claim,
      ...succeeded,
    });
    const attemptedAt = '2026-07-22T00:07:01.000Z';
    const attemptedClaim = repository.commitCollectionResumeProgressForStore(storeA, {
      claim: prepared.claim,
      event: {
        eventId: `${claim.attemptId}:import:pending`,
        emittedAt: attemptedAt,
        job: {
          ...prepared.result.job,
          importState: 'pending',
          importAttemptedAt: attemptedAt,
          updatedAt: attemptedAt,
        },
      },
    });
    const importCompletedAt = '2026-07-22T00:07:02.000Z';
    const crashImportInput = fullAuthorityImportInput(
      {
        job: { ...prepared.result.job, importAttemptedAt: attemptedAt, updatedAt: attemptedAt },
        batch: prepared.result.batch,
        files: prepared.result.files,
      },
      attemptedAt,
      importCompletedAt,
    );
    const imported = repository.commitImportForStore(storeA, crashImportInput);
    expect(imported.deduplicated).toBe(false);
    // Simulate process loss before advanceCollectionResumeClaimAfterImportForStore.
    const interrupted = repository.interruptOrphanedCollectionResumeClaimsForStartup(
      '2020-01-01T00:00:00.000Z',
    );
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].outcome).toBe('interrupted');
    expect(() => repository.advanceCollectionResumeClaimAfterImportForStore(storeA, {
      claim: attemptedClaim,
    })).toThrow(/CAS_CONFLICT/);

    const pendingProof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      packet.request.requestId,
    )!;
    const recoveryCompletedAt = new Date(Date.parse(imported.run.createdAt) + 2).toISOString();
    repository.completeRecoveredCollectionImportForStore({
      storeId: storeA,
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      expectedJobUpdatedAt: pendingProof.job.updatedAt,
      expectedImportState: 'pending',
      expectedRunId: imported.run.runId,
      expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(pendingProof),
    }, {
      attemptedAt,
      completedAt: recoveryCompletedAt,
    });
    const finalProof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      packet.request.requestId,
    )!;
    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(
      storeA,
      packet.jobId,
      packet.request.requestId,
    )).toMatchObject({
      attemptId: claim.attemptId,
      outcome: 'succeeded',
      finalJobUpdatedAt: finalProof.job.updatedAt,
      finalAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(finalProof),
    });
    expect(repository.commitImportForStore(storeA, crashImportInput).deduplicated).toBe(true);
  });

  it('appends a succeeded successor when startup interrupts before the first import run', () => {
    const { repository, storeA } = createHarness();
    const failed = failedFullAuthorityTerminal(storeA, 'resume-before-import', 3);
    repository.commitCollectionTerminalForStore(storeA, failed);
    const packet = repository.getCollectionInPlaceResumeStateForStore(storeA, failed.job.jobId)!;
    const claim = repository.acquireCollectionResumeClaimForStore(storeA, {
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
      executionStoreContext: packet.request.storeContext,
      attemptId: 'attempt-before-import',
      claimedAt: '2026-07-22T00:05:30.000Z',
    });
    const completed = fullAuthorityTerminal(storeA, 'profile-a', packet.jobId);
    const runnerCompletedAt = '2026-07-22T00:07:00.000Z';
    completed.job = {
      ...completed.job,
      request: packet.request,
      lineage: packet.job.lineage,
      importState: 'pending',
      completedAt: runnerCompletedAt,
      updatedAt: runnerCompletedAt,
    };
    completed.batch = {
      ...completed.batch,
      requestId: packet.request.requestId,
      downloadDir: packet.batch.downloadDir,
      createdAt: packet.batch.createdAt,
      completedAt: runnerCompletedAt,
    };
    const prepared = repository.commitCollectionResumeRunnerResultForStore(storeA, {
      claim,
      ...completed,
    });
    const attemptedAt = '2026-07-22T00:07:01.000Z';
    repository.commitCollectionResumeProgressForStore(storeA, {
      claim: prepared.claim,
      event: {
        eventId: `${claim.attemptId}:import:pending`,
        emittedAt: attemptedAt,
        job: {
          ...prepared.result.job,
          importState: 'pending',
          importAttemptedAt: attemptedAt,
          updatedAt: attemptedAt,
        },
      },
    });

    const interrupted = repository.interruptOrphanedCollectionResumeClaimsForStartup(
      '2020-01-01T00:00:00.000Z',
    );
    expect(interrupted).toEqual([
      expect.objectContaining({ attemptId: claim.attemptId, outcome: 'interrupted' }),
    ]);
    expect(repository.listImportRunsForStore(storeA)).toEqual([]);

    const importInput = fullAuthorityImportInput(
      {
        job: { ...prepared.result.job, importAttemptedAt: attemptedAt, updatedAt: attemptedAt },
        batch: prepared.result.batch,
        files: prepared.result.files,
      },
      attemptedAt,
      '2026-07-22T00:07:02.000Z',
    );
    const imported = repository.commitImportForStore(storeA, importInput);
    const pendingProof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeA,
      packet.request.requestId,
    )!;
    const recoveryCompletedAt = new Date(Date.parse(imported.run.createdAt) + 2).toISOString();
    repository.completeRecoveredCollectionImportForStore({
      storeId: storeA,
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      expectedJobUpdatedAt: pendingProof.job.updatedAt,
      expectedImportState: 'pending',
      expectedRunId: imported.run.runId,
      expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(pendingProof),
    }, {
      attemptedAt,
      completedAt: recoveryCompletedAt,
    });

    expect(repository.readUniqueSucceededCollectionResumeReceiptForStore(
      storeA,
      packet.jobId,
      packet.request.requestId,
    )).toEqual(expect.objectContaining({
      attemptId: claim.attemptId,
      outcome: 'succeeded',
    }));
    expect(repository.commitImportForStore(storeA, importInput).deduplicated).toBe(true);
  });

  it.each(['update', 'delete', 'insert'] as const)(
    'rejects authority proof when committed ad metrics drift by %s',
    (operation) => {
      const { database, repository, storeA } = createHarness();
      const terminal = persistSucceededAuthorityProof(
        repository,
        storeA,
        `metric-evidence-${operation}`,
      );
      expect(repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
        storeA,
        terminal.job.request.requestId,
      )?.metricEvidenceCount).toBe(1);
      if (operation === 'update') {
        database.prepare(`
          UPDATE ad_daily_metrics SET clicks = clicks + 1
          WHERE store_id = ? AND batch_id = ?
        `).run(storeA, terminal.job.jobId);
      } else if (operation === 'delete') {
        database.prepare(`
          DELETE FROM ad_daily_metrics
          WHERE id = (
            SELECT id FROM ad_daily_metrics WHERE store_id = ? AND batch_id = ? LIMIT 1
          )
        `).run(storeA, terminal.job.jobId);
      } else {
        database.prepare(`
          INSERT INTO ad_daily_metrics (
            store_id, batch_id, report_type, date, store_name, marketplace_code,
            impressions, clicks, cost, orders, sales, currency,
            acos, cpc, cvr, source_file, source_row
          ) VALUES (?, ?, 'campaign', '2026-07-21', 'Shop Alpha', 'US',
                    1, 1, 1, 1, 1, 'USD', 1, 1, 1, 'tampered.xlsx', 999)
        `).run(storeA, terminal.job.jobId);
      }
      expect(() => repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
        storeA,
        terminal.job.request.requestId,
      )).toThrow(/广告指标与不可变导入证据不一致/);
    },
  );
});
