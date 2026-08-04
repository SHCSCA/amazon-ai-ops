import { describe, expect, it } from 'vitest';
import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { buildMissionControlTodayProjection } from './mission-control-today-projection';

const context = normalizeStoreContextEnvelope({
  storeId: 'today-store',
  browserProfileId: 'today-profile',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 2,
});

function completedJob(
  importState: LingxingCollectionJobSnapshot['importState'],
): LingxingCollectionJobSnapshot {
  const reportTypes = [
    'campaign', 'ad_group', 'placement', 'advertised_product',
    'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
  ] as const;
  return {
    jobId: 'batch-eight',
    request: {
      requestId: 'production-eight',
      storeContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download' as const,
      reportTypes,
    },
    state: 'completed' as const,
    reports: reportTypes.map((reportType) => ({
      reportType,
      state: 'downloaded' as const,
      attemptIndex: 0,
      autoRetryCount: 0,
      updatedAt: '2026-07-22T08:00:00.000Z',
    })),
    lineage: {
      lineageId: 'batch-eight',
      rootJobId: 'batch-eight',
      expectedReportTypes: reportTypes,
      purpose: 'production_full',
    },
    createdAt: '2026-07-22T07:00:00.000Z',
    updatedAt: '2026-07-22T08:00:00.000Z',
    completedAt: '2026-07-22T08:00:00.000Z',
    importState,
  } satisfies LingxingCollectionJobSnapshot;
}

function importProofsFor(...jobs: LingxingCollectionJobSnapshot[]) {
  return jobs.flatMap((job) => job.reports
    .filter((report) => report.state === 'downloaded')
    .map((report) => ({
      batchId: job.jobId,
      reportType: report.reportType,
      importedRows: report.reportType === 'keyword' ? 0 : 1,
      fileHash: 'a'.repeat(64),
      runId: `import_${job.jobId}`,
    })));
}

describe('buildMissionControlTodayProjection', () => {
  it('projects real store readiness and advances to facts only after import succeeds', () => {
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{
        status: 'active',
        cost: { currentPrice: 29.99, purchaseCost: 8, targetAcos: 0.28 },
      }],
      collectionJobs: [completedJob('succeeded')],
      reportImportProofs: importProofsFor(completedJob('succeeded')),
      importedMetricRows: 6827,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 2,
      browserSessionReady: false,
      now: new Date('2026-07-22T09:00:00.000Z'),
    });

    expect(projection).toMatchObject({
      storeId: 'today-store',
      marketplace: 'US',
      currency: 'USD',
      facts: { productCount: 1, configuredProductCount: 1, importedMetricRows: 6827 },
      nextAction: { id: 'review-ad-facts', targetView: 'missions/facts' },
    });
    expect(projection.readiness.find((item) => item.id === 'import')?.state).toBe('ready');
    expect(projection.readiness.find((item) => item.id === 'browser')?.state).toBe('attention');
  });

  it('prioritizes product setup, incomplete collection and failed import without treating canary as production', () => {
    const canary = {
      ...completedJob('not_applicable'),
      jobId: 'canary-batch',
      request: { ...completedJob('not_applicable').request, requestId: 'canary:probe' },
      updatedAt: '2026-07-22T10:00:00.000Z',
    };
    const empty = buildMissionControlTodayProjection({
      context,
      products: [],
      collectionJobs: [canary],
      reportImportProofs: [],
      importedMetricRows: 0,
      operationEventsToday: 0,
      browserSessionReady: false,
    });
    expect(empty.facts.collectionJobCount).toBe(0);
    expect(empty.nextAction.id).toBe('configure-products');

    const failed = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [completedJob('failed')],
      reportImportProofs: [],
      importedMetricRows: 0,
      operationEventsToday: 0,
      browserSessionReady: true,
    });
    expect(failed.nextAction).toMatchObject({ id: 'recover-import', targetView: 'collection/reports' });
    expect(failed.readiness.find((item) => item.id === 'import')?.state).toBe('blocked');
  });

  it('does not unlock analysis when imported metrics are older than the completed collection window', () => {
    const stale = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [completedJob('succeeded')],
      reportImportProofs: importProofsFor(completedJob('succeeded')),
      importedMetricRows: 6827,
      latestMetricDate: '2026-07-20',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(stale.readiness.find((item) => item.id === 'import')).toMatchObject({
      state: 'attention',
      targetView: 'collection/import-check',
    });
    expect(stale.readiness.find((item) => item.id === 'import')?.detail).toContain('不在采集日期窗 2026-07-21 至 2026-07-21 内');
    expect(stale.nextAction).toMatchObject({ id: 'recover-import', targetView: 'collection/import-check' });
  });

  it('accepts a lineage import when the final day has no advertising rows but metrics remain inside the window', () => {
    const multiDayJob = completedJob('succeeded');
    multiDayJob.request = { ...multiDayJob.request, dateStart: '2026-07-20' };
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [multiDayJob],
      reportImportProofs: importProofsFor(multiDayJob),
      importedMetricRows: 420,
      latestMetricDate: '2026-07-20',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.readiness.find((item) => item.id === 'import')?.state).toBe('ready');
    expect(projection.nextAction.id).toBe('review-ad-facts');
  });

  it('aggregates a later single-report retry into the same collection date window', () => {
    const original = completedJob('succeeded');
    const partial = {
      ...original,
      state: 'completed_with_errors' as const,
      reports: original.reports.map((report) => report.reportType === 'keyword'
        ? { ...report, state: 'failed' as const }
        : report),
    };
    const keywordRetry: LingxingCollectionJobSnapshot = {
      ...original,
      jobId: 'keyword-retry',
      lineage: {
        lineageId: original.jobId,
        rootJobId: original.jobId,
        parentJobId: original.jobId,
        expectedReportTypes: [...original.request.reportTypes],
        purpose: 'resume',
      },
      request: {
        ...original.request,
        requestId: 'production-keyword-retry',
        reportTypes: ['keyword'],
      },
      reports: [{
        reportType: 'keyword',
        state: 'downloaded',
        attemptIndex: 0,
        autoRetryCount: 0,
        updatedAt: '2026-07-22T09:00:00.000Z',
      }],
      updatedAt: '2026-07-22T09:00:00.000Z',
      completedAt: '2026-07-22T09:00:00.000Z',
      importState: 'succeeded',
    };

    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [partial, keywordRetry],
      reportImportProofs: importProofsFor(partial, keywordRetry),
      importedMetricRows: 6827,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.facts).toMatchObject({
      collectionJobCount: 2,
      latestCollectionJob: {
        jobId: 'keyword-retry',
        state: 'lineage_completed',
        downloadedReports: 8,
        totalReports: 8,
      },
    });
    expect(projection.readiness.find((item) => item.id === 'collection')).toMatchObject({
      state: 'ready',
      detail: expect.stringContaining('聚合 2 次真实任务'),
    });
    expect(projection.readiness.find((item) => item.id === 'import')?.state).toBe('ready');
    expect(projection.nextAction.id).toBe('review-ad-facts');
  });

  it('ignores an unbound standalone retry instead of replacing the latest valid full root', () => {
    const original = completedJob('succeeded');
    const standalone: LingxingCollectionJobSnapshot = {
      ...original,
      jobId: 'standalone-keyword',
      lineage: undefined,
      request: {
        ...original.request,
        requestId: 'standalone-keyword-request',
        reportTypes: ['keyword'],
      },
      reports: [{ ...original.reports.find((report) => report.reportType === 'keyword')! }],
      updatedAt: '2026-07-22T09:30:00.000Z',
      completedAt: '2026-07-22T09:30:00.000Z',
    };

    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [original, standalone],
      reportImportProofs: importProofsFor(original),
      importedMetricRows: 6827,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.facts).toMatchObject({
      collectionJobCount: 1,
      latestCollectionJob: { jobId: 'batch-eight', downloadedReports: 8, totalReports: 8 },
    });
    expect(projection.readiness.find((item) => item.id === 'collection')?.state).toBe('ready');
    expect(projection.nextAction.id).toBe('review-ad-facts');
  });

  it('keeps a later independent full root isolated from an earlier successful root in the same date window', () => {
    const firstRoot = completedJob('succeeded');
    // Import bookkeeping may touch an older root after the newer run was
    // created. updatedAt must never let that older authority root win again.
    firstRoot.updatedAt = '2026-07-22T12:00:00.000Z';
    const secondRoot: LingxingCollectionJobSnapshot = {
      ...completedJob('pending'),
      jobId: 'batch-eight-second-root',
      lineage: {
        lineageId: 'batch-eight-second-root',
        rootJobId: 'batch-eight-second-root',
        expectedReportTypes: [...completedJob('pending').request.reportTypes],
        purpose: 'production_full',
      },
      request: {
        ...completedJob('pending').request,
        requestId: 'production-eight-second-root',
      },
      state: 'completed_with_errors',
      reports: completedJob('pending').reports.map((report) => report.reportType === 'keyword'
        ? { ...report, state: 'failed' as const }
        : report),
      createdAt: '2026-07-22T09:00:00.000Z',
      updatedAt: '2026-07-22T11:00:00.000Z',
      completedAt: '2026-07-22T11:00:00.000Z',
    };

    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [firstRoot, secondRoot],
      reportImportProofs: importProofsFor(firstRoot, secondRoot),
      importedMetricRows: 6827,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.facts).toMatchObject({
      collectionJobCount: 1,
      latestCollectionJob: {
        jobId: 'batch-eight-second-root',
        downloadedReports: 7,
        totalReports: 8,
      },
    });
    expect(projection.readiness.find((item) => item.id === 'collection')?.state).toBe('attention');
    expect(projection.nextAction.id).toBe('collect-eight-reports');
  });

  it('does not unlock analysis while any downloaded report import remains pending', () => {
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [completedJob('pending')],
      reportImportProofs: [],
      importedMetricRows: 6827,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.readiness.find((item) => item.id === 'import')).toMatchObject({
      state: 'attention',
      detail: expect.stringContaining('尚未确认成功'),
    });
    expect(projection.nextAction).toMatchObject({
      id: 'recover-import',
      targetView: 'collection/reports',
    });
  });

  it('rejects a standalone complete eight-report snapshot without Main-issued lineage', () => {
    const standalone = completedJob('succeeded');
    standalone.lineage = undefined;
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [standalone],
      reportImportProofs: importProofsFor(standalone),
      importedMetricRows: 6827,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.facts.collectionJobCount).toBe(0);
    expect(projection.readiness.find((item) => item.id === 'collection')?.state).toBe('blocked');
    expect(projection.nextAction.id).toBe('collect-eight-reports');
  });

  it('rejects a complete historical lineage whose window is not due for the current business date', () => {
    const historical = completedJob('succeeded');
    historical.request = {
      ...historical.request,
      dateStart: '2026-07-20',
      dateEnd: '2026-07-20',
    };
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [historical],
      reportImportProofs: importProofsFor(historical),
      importedMetricRows: 100,
      latestMetricDate: '2026-07-20',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.readiness.find((item) => item.id === 'collection')).toMatchObject({
      state: 'blocked',
      detail: expect.stringContaining('2026-07-21'),
    });
    expect(projection.nextAction.id).toBe('collect-eight-reports');
  });

  it('chooses the latest report checkpoint even when an older job was touched later by import state', () => {
    const root = completedJob('succeeded');
    root.state = 'completed_with_errors';
    root.reports = root.reports.map((report) => report.reportType === 'keyword'
      ? { ...report, state: 'failed', updatedAt: '2026-07-22T08:00:00.000Z' }
      : report);
    root.updatedAt = '2026-07-22T11:00:00.000Z';
    const retry: LingxingCollectionJobSnapshot = {
      ...completedJob('succeeded'),
      jobId: 'keyword-retry-checkpoint-newer',
      lineage: {
        lineageId: root.jobId,
        rootJobId: root.jobId,
        parentJobId: root.jobId,
        expectedReportTypes: [...root.request.reportTypes],
        purpose: 'retry',
      },
      request: {
        ...root.request,
        requestId: 'keyword-retry-checkpoint-newer-request',
        reportTypes: ['keyword'],
      },
      reports: [{
        reportType: 'keyword',
        state: 'downloaded',
        attemptIndex: 0,
        autoRetryCount: 0,
        updatedAt: '2026-07-22T09:00:00.000Z',
      }],
      updatedAt: '2026-07-22T10:00:00.000Z',
    };
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [root, retry],
      reportImportProofs: importProofsFor(root, retry),
      importedMetricRows: 100,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.readiness.find((item) => item.id === 'collection')?.state).toBe('ready');
    expect(projection.facts.latestCollectionJob?.downloadedReports).toBe(8);
  });

  it('requires an immutable import proof for every selected report attempt', () => {
    const job = completedJob('succeeded');
    const proofs = importProofsFor(job).filter((proof) => proof.reportType !== 'keyword');
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [job],
      reportImportProofs: proofs,
      importedMetricRows: 7,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.readiness.find((item) => item.id === 'import')).toMatchObject({
      state: 'attention',
      detail: expect.stringContaining('7/8'),
    });
    expect(projection.nextAction.id).toBe('recover-import');
  });

  it('rejects non-SHA-256 file hashes even when every report has a nonempty proof row', () => {
    const job = completedJob('succeeded');
    const malformedProofs = importProofsFor(job).map((proof) => ({
      ...proof,
      fileHash: `not-a-sha256-${proof.reportType}`,
    }));
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [job],
      reportImportProofs: malformedProofs,
      importedMetricRows: 0,
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.readiness.find((item) => item.id === 'import')).toMatchObject({
      state: 'attention',
      detail: expect.stringContaining('0/8'),
    });
    expect(projection.nextAction.detail).toContain('不可变导入证明');
    expect(projection.nextAction.detail).not.toContain('指标行');
  });

  it('accepts a valid zero-row report set when all eight immutable file proofs exist', () => {
    const job = completedJob('succeeded');
    const proofs = importProofsFor(job).map((proof) => ({ ...proof, importedRows: 0 }));
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [job],
      reportImportProofs: proofs,
      importedMetricRows: 0,
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.readiness.find((item) => item.id === 'import')?.state).toBe('ready');
    expect(projection.nextAction.id).toBe('review-ad-facts');
  });

  it('rejects a retry whose parent is absent from the validated root chain', () => {
    const root = completedJob('succeeded');
    root.state = 'completed_with_errors';
    root.reports = root.reports.map((report) => report.reportType === 'keyword'
      ? { ...report, state: 'failed' }
      : report);
    const orphan: LingxingCollectionJobSnapshot = {
      ...completedJob('succeeded'),
      jobId: 'orphan-keyword-retry',
      lineage: {
        lineageId: root.jobId,
        rootJobId: root.jobId,
        parentJobId: 'missing-parent-job',
        expectedReportTypes: [...root.request.reportTypes],
        purpose: 'retry',
      },
      request: {
        ...root.request,
        requestId: 'orphan-keyword-retry-request',
        reportTypes: ['keyword'],
      },
      reports: [{
        reportType: 'keyword',
        state: 'downloaded',
        attemptIndex: 0,
        autoRetryCount: 0,
        updatedAt: '2026-07-22T09:00:00.000Z',
      }],
      updatedAt: '2026-07-22T09:00:00.000Z',
    };
    const projection = buildMissionControlTodayProjection({
      context,
      products: [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.25 } }],
      collectionJobs: [root, orphan],
      reportImportProofs: importProofsFor(root, orphan),
      importedMetricRows: 8,
      latestMetricDate: '2026-07-21',
      operationEventsToday: 0,
      browserSessionReady: true,
    });

    expect(projection.facts.collectionJobCount).toBe(1);
    expect(projection.readiness.find((item) => item.id === 'collection')?.state).toBe('attention');
    expect(projection.facts.latestCollectionJob?.downloadedReports).toBe(7);
  });
});
