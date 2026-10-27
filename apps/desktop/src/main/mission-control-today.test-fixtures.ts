import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
export const context = normalizeStoreContextEnvelope({
  storeId: 'today-store',
  browserProfileId: 'today-profile',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 2,
});

export function completedJob(
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

export function importProofsFor(...jobs: LingxingCollectionJobSnapshot[]) {
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
