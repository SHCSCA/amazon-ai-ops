import type {
  LingxingCollectionImportState,
  LingxingCollectionJobSnapshot,
  LingxingCollectionReportState,
  LingxingReportType,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export const PRODUCTION_LINGXING_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const satisfies readonly LingxingReportType[];

export type ProductionCollectionLineageState = 'ready' | 'partial' | 'blocked' | 'missing';

export type ProductionCollectionReportBindingState =
  | 'imported'
  | 'import_pending'
  | 'import_failed'
  | 'source_mismatch'
  | 'download_incomplete'
  | 'missing';

export interface ProductionCollectionReportFileFact {
  reportType: string;
  batchId?: string;
  status?: string;
  importedRows?: number;
  /** Main-issued, store-bound handle proving that this report file exists. */
  artifactId?: string;
  fileHash?: string;
  lastImportedAt?: string;
}

export interface ProductionCollectionReportBinding {
  reportType: LingxingReportType;
  state: ProductionCollectionReportBindingState;
  jobId?: string;
  expectedBatchId?: string;
  fileBatchId?: string;
  reportState?: LingxingCollectionReportState;
  importState?: LingxingCollectionImportState;
  importedRows: number;
}

export interface ProductionCollectionLineageReadiness {
  state: ProductionCollectionLineageState;
  canEnterDiagnosis: boolean;
  title: string;
  detail: string;
  lineageId?: string;
  rootJobId?: string;
  latestJobId?: string;
  dateStart: string;
  dateEnd: string;
  lineageJobIds: string[];
  downloadedReportCount: number;
  sourceMatchedReportCount: number;
  importedReportCount: number;
  importedRows: number;
  reportBindings: ProductionCollectionReportBinding[];
  blockers: string[];
}

export interface BuildProductionCollectionLineageReadinessInput {
  currentContext?: StoreContextEnvelope | null;
  dateStart: string;
  dateEnd: string;
  jobs: readonly LingxingCollectionJobSnapshot[];
  files: readonly ProductionCollectionReportFileFact[];
}

interface CheckpointAttempt {
  job: LingxingCollectionJobSnapshot;
  reportType: LingxingReportType;
  reportState: LingxingCollectionReportState;
  updatedAt: string;
}

/**
 * Builds the Renderer gate for the exact current-store collection lineage.
 * Aggregate files from unrelated retries or same-date batches never satisfy it.
 */
export function buildProductionCollectionLineageReadiness(
  input: BuildProductionCollectionLineageReadinessInput,
): ProductionCollectionLineageReadiness {
  const empty = (detail: string): ProductionCollectionLineageReadiness => ({
    state: 'missing',
    canEnterDiagnosis: false,
    title: '生产采集血缘待建立',
    detail,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
    lineageJobIds: [],
    downloadedReportCount: 0,
    sourceMatchedReportCount: 0,
    importedReportCount: 0,
    importedRows: 0,
    reportBindings: PRODUCTION_LINGXING_REPORT_TYPES.map((reportType) => ({
      reportType,
      state: 'missing',
      importedRows: 0,
    })),
    blockers: [detail],
  });

  if (!input.currentContext) {
    return empty('当前没有可用的美国站店铺授权上下文，无法核对生产采集血缘。');
  }
  if (input.currentContext.marketplace !== 'US' || input.currentContext.currency !== 'USD') {
    return empty('第一版只接受 Amazon US / USD 店铺的生产采集任务。');
  }

  const candidates = input.jobs
    .filter((job) => belongsToStore(job, input.currentContext!))
    .filter((job) => job.request.dateStart === input.dateStart && job.request.dateEnd === input.dateEnd)
    .filter((job) => !job.request.requestId.startsWith('canary:') && job.importState !== 'not_applicable')
    .sort(compareJobNewestFirst);
  const latest = candidates[0];
  if (!latest) {
    return empty(`当前店铺 ${input.dateStart} 至 ${input.dateEnd} 没有可核对的生产采集任务；聚合文件不能替代任务血缘。`);
  }

  const lineageJobs = selectLineageJobs(candidates, latest).sort(compareJobNewestFirst);
  const rootJobId = latest.lineage?.rootJobId ?? (isSelfContainedFullJob(latest) ? latest.jobId : undefined);
  const root = rootJobId ? lineageJobs.find((job) => job.jobId === rootJobId) : undefined;
  const rootValid = Boolean(root && isSelfContainedFullJob(root));
  const attempts = newestAttemptsByReport(lineageJobs);
  const reportBindings = PRODUCTION_LINGXING_REPORT_TYPES.map((reportType) => {
    const attempt = attempts.get(reportType);
    if (!attempt) {
      return { reportType, state: 'missing', importedRows: 0 } satisfies ProductionCollectionReportBinding;
    }
    if (attempt.reportState !== 'downloaded') {
      return {
        reportType,
        state: 'download_incomplete',
        jobId: attempt.job.jobId,
        expectedBatchId: attempt.job.jobId,
        reportState: attempt.reportState,
        importState: attempt.job.importState,
        importedRows: 0,
      } satisfies ProductionCollectionReportBinding;
    }

    const typeFiles = input.files.filter((file) => file.reportType === reportType && Boolean(file.artifactId));
    const matchingFile = typeFiles
      .filter((file) => file.batchId === attempt.job.jobId)
      .sort((left, right) => Number(right.importedRows || 0) - Number(left.importedRows || 0))[0];
    if (!matchingFile) {
      return {
        reportType,
        state: 'source_mismatch',
        jobId: attempt.job.jobId,
        expectedBatchId: attempt.job.jobId,
        ...(typeFiles[0]?.batchId ? { fileBatchId: typeFiles[0].batchId } : {}),
        reportState: attempt.reportState,
        importState: attempt.job.importState,
        importedRows: 0,
      } satisfies ProductionCollectionReportBinding;
    }

    const importedRows = Math.max(0, Number(matchingFile.importedRows || 0));
    // A valid report can legitimately contain zero business rows. Do not use
    // row count as the import receipt: a zero-row file is complete only when
    // the exact source file carries both a content hash and a per-file import
    // timestamp inside a job whose import transaction succeeded.
    const hasPerFileImportReceipt = Boolean(
      /^[a-f0-9]{64}$/i.test(matchingFile.fileHash?.trim() ?? '')
      && Number.isFinite(Date.parse(matchingFile.lastImportedAt?.trim() ?? ''))
      && ['downloaded', 'imported'].includes(String(matchingFile.status || 'downloaded')),
    );
    const importSucceeded = attempt.job.importState === 'succeeded'
      && (importedRows > 0 || hasPerFileImportReceipt);
    return {
      reportType,
      state: importSucceeded
        ? 'imported'
        : attempt.job.importState === 'failed' ? 'import_failed' : 'import_pending',
      jobId: attempt.job.jobId,
      expectedBatchId: attempt.job.jobId,
      fileBatchId: matchingFile.batchId,
      reportState: attempt.reportState,
      importState: attempt.job.importState,
      importedRows,
    } satisfies ProductionCollectionReportBinding;
  });

  const downloadedReportCount = reportBindings.filter((binding) => binding.reportState === 'downloaded').length;
  const sourceMatchedReportCount = reportBindings.filter((binding) => (
    binding.fileBatchId && binding.fileBatchId === binding.expectedBatchId
  )).length;
  const importedReportCount = reportBindings.filter((binding) => binding.state === 'imported').length;
  const importedRows = reportBindings.reduce((sum, binding) => (
    binding.state === 'imported' ? sum + binding.importedRows : sum
  ), 0);
  const blockers: string[] = [];

  if (!rootValid) {
    blockers.push(latest.lineage
      ? '生产 continuation 缺少可回读的完整八报表 root 任务，不能确认授权链。'
      : '最新任务是独立单报表任务；独立单报表任务不能与其他批次拼接成生产 8/8。');
  }
  if (downloadedReportCount < PRODUCTION_LINGXING_REPORT_TYPES.length) {
    blockers.push(`当前生产 lineage 只有 ${downloadedReportCount}/8 类下载确认。`);
  }
  if (sourceMatchedReportCount < PRODUCTION_LINGXING_REPORT_TYPES.length) {
    blockers.push(`有 ${PRODUCTION_LINGXING_REPORT_TYPES.length - sourceMatchedReportCount} 类真实文件缺失或与任务血缘不一致。`);
  }
  if (importedReportCount < PRODUCTION_LINGXING_REPORT_TYPES.length) {
    blockers.push(`有 ${PRODUCTION_LINGXING_REPORT_TYPES.length - importedReportCount} 类缺少逐报表入库成功凭证。`);
  }

  const canEnterDiagnosis = Boolean(
    rootValid
    && downloadedReportCount === PRODUCTION_LINGXING_REPORT_TYPES.length
    && sourceMatchedReportCount === PRODUCTION_LINGXING_REPORT_TYPES.length
    && importedReportCount === PRODUCTION_LINGXING_REPORT_TYPES.length,
  );
  const hasHardBlocker = !rootValid
    || reportBindings.some((binding) => binding.state === 'source_mismatch' || binding.state === 'import_failed');
  const state: ProductionCollectionLineageState = canEnterDiagnosis
    ? 'ready'
    : hasHardBlocker ? 'blocked' : 'partial';
  const lineageId = latest.lineage?.lineageId ?? rootJobId;

  return {
    state,
    canEnterDiagnosis,
    title: canEnterDiagnosis
      ? '生产采集与入库血缘已闭合'
      : state === 'blocked' ? '生产采集血缘阻断' : '生产采集血缘尚未闭合',
    detail: canEnterDiagnosis
      ? `${downloadedReportCount}/8 类真实报表都绑定同一授权 lineage，${importedRows} 行指标可追溯到对应批次。`
      : blockers.join('；'),
    ...(lineageId ? { lineageId } : {}),
    ...(rootJobId ? { rootJobId } : {}),
    latestJobId: latest.jobId,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
    lineageJobIds: lineageJobs.map((job) => job.jobId),
    downloadedReportCount,
    sourceMatchedReportCount,
    importedReportCount,
    importedRows,
    reportBindings,
    blockers,
  };
}

function selectLineageJobs(
  candidates: readonly LingxingCollectionJobSnapshot[],
  latest: LingxingCollectionJobSnapshot,
): LingxingCollectionJobSnapshot[] {
  if (latest.lineage) {
    return candidates.filter((job) => (
      job.jobId === latest.lineage!.rootJobId
      || job.lineage?.lineageId === latest.lineage!.lineageId
    ));
  }
  return [latest];
}

function newestAttemptsByReport(
  jobs: readonly LingxingCollectionJobSnapshot[],
): Map<LingxingReportType, CheckpointAttempt> {
  const attempts = new Map<LingxingReportType, CheckpointAttempt>();
  const candidates = jobs.flatMap((job) => job.reports.map((report) => ({
    job,
    reportType: report.reportType,
    reportState: report.state,
    updatedAt: report.updatedAt || job.updatedAt,
  }))).sort((left, right) => {
    const checkpointOrder = right.updatedAt.localeCompare(left.updatedAt);
    return checkpointOrder || compareJobNewestFirst(left.job, right.job);
  });
  for (const attempt of candidates) {
    if (!attempts.has(attempt.reportType)) attempts.set(attempt.reportType, attempt);
  }
  return attempts;
}

function belongsToStore(
  job: LingxingCollectionJobSnapshot,
  context: StoreContextEnvelope,
): boolean {
  const stored = job.request.storeContext;
  return stored.storeId === context.storeId
    && stored.browserProfileId === context.browserProfileId
    && stored.marketplace === 'US'
    && stored.currency === 'USD';
}

function isSelfContainedFullJob(job: LingxingCollectionJobSnapshot): boolean {
  const requested = new Set(job.request.reportTypes);
  return requested.size === PRODUCTION_LINGXING_REPORT_TYPES.length
    && PRODUCTION_LINGXING_REPORT_TYPES.every((reportType) => requested.has(reportType));
}

function compareJobNewestFirst(
  left: LingxingCollectionJobSnapshot,
  right: LingxingCollectionJobSnapshot,
): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.jobId.localeCompare(left.jobId);
}
