import { describe, expect, it } from 'vitest';
import type {
  LingxingCollectionJobSnapshot,
  LingxingReportType,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { buildProductionCollectionLineageReadiness } from './lingxing-collection-lineage';

const reportTypes = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const satisfies readonly LingxingReportType[];

const context = normalizeStoreContextEnvelope({
  storeId: 'store-us-a',
  browserProfileId: 'profile-us-a',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 3,
});

function job(input: {
  jobId: string;
  reportTypes?: readonly LingxingReportType[];
  failedType?: LingxingReportType;
  importState?: LingxingCollectionJobSnapshot['importState'];
  updatedAt?: string;
  context?: StoreContextEnvelope;
  lineage?: LingxingCollectionJobSnapshot['lineage'];
  requestId?: string;
}): LingxingCollectionJobSnapshot {
  const types = input.reportTypes ?? reportTypes;
  const updatedAt = input.updatedAt ?? '2026-07-22T08:00:00.000Z';
  return {
    jobId: input.jobId,
    request: {
      requestId: input.requestId ?? `request-${input.jobId}`,
      storeContext: input.context ?? context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: types,
    },
    ...(input.lineage ? { lineage: input.lineage } : {}),
    state: input.failedType ? 'completed_with_errors' : 'completed',
    reports: types.map((reportType) => ({
      reportType,
      state: reportType === input.failedType ? 'failed' : 'downloaded',
      attemptIndex: 0,
      autoRetryCount: 0,
      updatedAt,
    })),
    createdAt: '2026-07-22T07:00:00.000Z',
    updatedAt,
    completedAt: updatedAt,
    importState: input.importState ?? 'succeeded',
  };
}

function filesForJob(jobId: string, types: readonly LingxingReportType[] = reportTypes) {
  return types.map((reportType, index) => ({
    reportType,
    batchId: jobId,
    importedRows: index + 10,
    artifactId: `artifact:v1:${jobId}-${reportType}`,
  }));
}

describe('buildProductionCollectionLineageReadiness', () => {
  it('accepts one self-contained full eight-report job only when every file and import bind to that job', () => {
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [job({ jobId: 'full-eight' })],
      files: filesForJob('full-eight'),
    });

    expect(result).toMatchObject({
      state: 'ready',
      canEnterDiagnosis: true,
      rootJobId: 'full-eight',
      latestJobId: 'full-eight',
      downloadedReportCount: 8,
      sourceMatchedReportCount: 8,
      importedReportCount: 8,
    });
    expect(result.lineageJobIds).toEqual(['full-eight']);
    expect(result.blockers).toEqual([]);
  });

  it('does not combine a newer standalone partial retry with an older full job from the same date window', () => {
    const full = job({ jobId: 'older-full', updatedAt: '2026-07-22T08:00:00.000Z' });
    const standalone = job({
      jobId: 'standalone-keyword',
      reportTypes: ['keyword'],
      updatedAt: '2026-07-22T09:00:00.000Z',
    });
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [full, standalone],
      files: [...filesForJob('older-full'), ...filesForJob('standalone-keyword', ['keyword'])],
    });

    expect(result).toMatchObject({
      state: 'blocked',
      canEnterDiagnosis: false,
      latestJobId: 'standalone-keyword',
      downloadedReportCount: 1,
      sourceMatchedReportCount: 1,
      importedReportCount: 1,
    });
    expect(result.lineageJobIds).toEqual(['standalone-keyword']);
    expect(result.blockers.join('；')).toContain('独立单报表任务');
  });

  it('combines an authorized continuation with its production root and binds each report to its winning batch', () => {
    const root = job({
      jobId: 'root-eight',
      failedType: 'keyword',
      lineage: {
        lineageId: 'root-eight',
        rootJobId: 'root-eight',
        expectedReportTypes: reportTypes,
        purpose: 'production_full',
      },
      updatedAt: '2026-07-22T08:00:00.000Z',
    });
    const continuation = job({
      jobId: 'resume-keyword',
      reportTypes: ['keyword'],
      lineage: {
        lineageId: 'root-eight',
        rootJobId: 'root-eight',
        parentJobId: 'root-eight',
        expectedReportTypes: reportTypes,
        purpose: 'resume',
      },
      updatedAt: '2026-07-22T09:00:00.000Z',
    });
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [root, continuation],
      files: [
        ...filesForJob('root-eight', reportTypes.filter((type) => type !== 'keyword')),
        ...filesForJob('resume-keyword', ['keyword']),
      ],
    });

    expect(result).toMatchObject({
      state: 'ready',
      canEnterDiagnosis: true,
      lineageId: 'root-eight',
      rootJobId: 'root-eight',
      latestJobId: 'resume-keyword',
      downloadedReportCount: 8,
      sourceMatchedReportCount: 8,
      importedReportCount: 8,
    });
    expect(result.lineageJobIds).toEqual(['resume-keyword', 'root-eight']);
    expect(result.reportBindings.find((binding) => binding.reportType === 'keyword')).toMatchObject({
      jobId: 'resume-keyword',
      fileBatchId: 'resume-keyword',
      state: 'imported',
    });
  });

  it('fails closed when a displayed file came from a batch outside the selected lineage', () => {
    const full = job({ jobId: 'full-eight' });
    const files = filesForJob('full-eight').map((file) => (
      file.reportType === 'keyword' ? { ...file, batchId: 'unbound-keyword' } : file
    ));
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [full],
      files,
    });

    expect(result.canEnterDiagnosis).toBe(false);
    expect(result.sourceMatchedReportCount).toBe(7);
    expect(result.reportBindings.find((binding) => binding.reportType === 'keyword')).toMatchObject({
      state: 'source_mismatch',
      expectedBatchId: 'full-eight',
    });
    expect(result.blockers.join('；')).toContain('任务血缘不一致');
  });

  it('fails closed for pending imports, ignores canary and excludes another store', () => {
    const otherContext = normalizeStoreContextEnvelope({
      ...context,
      storeId: 'store-us-b',
      browserProfileId: 'profile-us-b',
    });
    const pending = job({ jobId: 'pending-full', importState: 'pending' });
    const canary = job({ jobId: 'canary-newer', requestId: 'canary:probe', updatedAt: '2026-07-22T11:00:00.000Z' });
    const other = job({ jobId: 'other-store', context: otherContext, updatedAt: '2026-07-22T12:00:00.000Z' });
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [other, canary, pending],
      files: filesForJob('pending-full'),
    });

    expect(result.latestJobId).toBe('pending-full');
    expect(result.canEnterDiagnosis).toBe(false);
    expect(result.importedReportCount).toBe(0);
    expect(result.blockers.join('；')).toContain('逐报表入库成功凭证');
  });

  it('accepts a valid zero-row report only with an exact per-file import receipt', () => {
    const files = filesForJob('zero-row-valid').map((file) => (
      file.reportType === 'user_search_term'
        ? {
            ...file,
            importedRows: 0,
            status: 'downloaded',
            fileHash: 'a'.repeat(64),
            lastImportedAt: '2026-07-22T08:01:00.000Z',
          }
        : file
    ));
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [job({ jobId: 'zero-row-valid' })],
      files,
    });

    expect(result.canEnterDiagnosis).toBe(true);
    expect(result.importedReportCount).toBe(8);
    expect(result.reportBindings.find((binding) => binding.reportType === 'user_search_term')).toMatchObject({
      state: 'imported',
      importedRows: 0,
    });
  });

  it('keeps a zero-row report blocked when its per-file receipt is incomplete', () => {
    const files = filesForJob('zero-row-unproven').map((file) => (
      file.reportType === 'user_search_term'
        ? { ...file, importedRows: 0, status: 'downloaded', fileHash: 'b'.repeat(64) }
        : file
    ));
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [job({ jobId: 'zero-row-unproven' })],
      files,
    });

    expect(result.canEnterDiagnosis).toBe(false);
    expect(result.importedReportCount).toBe(7);
    expect(result.blockers.join('；')).toContain('逐报表入库成功凭证');
  });

  it('returns an explicit missing state rather than inferring completion from aggregate files', () => {
    const result = buildProductionCollectionLineageReadiness({
      currentContext: context,
      dateStart: '2026-07-21',
      dateEnd: '2026-07-21',
      jobs: [],
      files: filesForJob('unknown-batch'),
    });

    expect(result).toMatchObject({
      state: 'missing',
      canEnterDiagnosis: false,
      downloadedReportCount: 0,
      sourceMatchedReportCount: 0,
      importedReportCount: 0,
    });
    expect(result.detail).toContain('没有可核对的生产采集任务');
  });
});
