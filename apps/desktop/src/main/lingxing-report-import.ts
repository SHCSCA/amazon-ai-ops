import { attachUniqueProductContext } from './lingxing-report-product-attribution';
import * as path from 'node:path';
import type { LingxingRawReportControlTotals } from '@amazon-ai-ops/report-parser';
import type { ReportParserSession } from './report-parser-runtime';
import type { ReportSourceSnapshot } from './report-parser-source';
import type { captureReportImportCommitGuard } from './report-import-commit-guard';
import { logReportParserFailure } from './report-parser-errors';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingImportRepository, StoreRepository, ReportImportReconciliationInput } from '@amazon-ai-ops/local-db';
import type { AdDailyMetrics, LingxingReportBatch, LingxingReportFile } from '@amazon-ai-ops/shared-types';
import { assertLingxingParsedReportImportable } from './lingxing-report-import-validation';

export type LingxingBatchFilesResult = { batch: LingxingReportBatch; files: LingxingReportFile[] };
export function invalidLingxingImportReconciliationEvidence(detail: string): Error {
  return new Error(`${LINGXING_IMPORT_RECONCILIATION_EVIDENCE_INVALID}: ${detail}`);
}

const LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING =
  'LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING';
export const LINGXING_IMPORT_RECONCILIATION_EVIDENCE_INVALID =
  'LINGXING_IMPORT_RECONCILIATION_EVIDENCE_INVALID';

/**
 * Read provider-owned raw workbook control totals through a scanner that does
 * not consume mapped metrics or canonical parser output. The source SHA-256 is
 * checked before and after the scan, then committed with Store/Profile,
 * businessDate, exact batch window and file identity. Parsed rows never certify
 * themselves. metricDate remains the canonical window-end evidence date.
 */
async function readIndependentLingxingReportControlTotals(
  result: LingxingBatchFilesResult,
  importFile: {
    lingxingFileId: string;
    reportType: string;
    filePath: string;
    fileHash: string;
  },
  parser: ReportParserSession,
  snapshot: ReportSourceSnapshot,
): Promise<ReportImportReconciliationInput> {
    if (!snapshot || snapshot.sha256 !== importFile.fileHash) throw invalidLingxingImportReconciliationEvidence('独立扫描缺少同一来源字节快照。');
    parser.assertCurrent(snapshot);
    let totals: LingxingRawReportControlTotals;
    try {
      totals = await parser.controlTotals(snapshot, {
        dateStart: result.batch.dateStart,
        dateEnd: result.batch.dateEnd,
      });
    } catch (error) {
      throw invalidLingxingImportReconciliationEvidence(
        `${importFile.reportType} 的原始报表 control total 无法独立读取：`
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    parser.assertCurrent(snapshot);
    return {
      dateStart: result.batch.dateStart,
      dateEnd: result.batch.dateEnd,
      metricDate: result.batch.dateEnd,
      reportType: importFile.reportType,
      expectedRows: totals.expectedRows,
      expectedCost: totals.expectedCost,
      tolerance: 0,
    };
}

function assertExactIndependentLingxingReportControlTotals(
  result: LingxingBatchFilesResult,
  reconciliations: readonly ReportImportReconciliationInput[],
): void {
  const requiredTypes = LINGXING_AD_REPORTS.map((report) => report.type);
  const reportTypes = reconciliations.map((row) => row.reportType);
  if (reconciliations.length !== requiredTypes.length
    || new Set(reportTypes).size !== requiredTypes.length
    || requiredTypes.some((reportType) => !reportTypes.includes(reportType))) {
    throw invalidLingxingImportReconciliationEvidence(
      `独立 control totals 必须逐报精确覆盖 ${requiredTypes.length} 类领星报表。`,
    );
  }
  for (const reconciliation of reconciliations) {
    if (reconciliation.dateStart !== result.batch.dateStart
      || reconciliation.dateEnd !== result.batch.dateEnd
      || reconciliation.metricDate !== result.batch.dateEnd
      || !Number.isSafeInteger(reconciliation.expectedRows)
      || reconciliation.expectedRows < 0
      || !Number.isFinite(reconciliation.expectedCost)) {
      throw invalidLingxingImportReconciliationEvidence(
        `${reconciliation.reportType} 的独立 control total 完整窗口、行数或 USD 花费无效。`,
      );
    }
  }
}

export async function importLingxingDownloadedReportMetrics(
  result: LingxingBatchFilesResult,
  dependencies: { repository: LingxingImportRepository; stores: StoreRepository; parser: ReportParserSession;
    guard: ReturnType<typeof captureReportImportCommitGuard> },
  options: { startedAt?: string } = {},
): Promise<{
  inserted: number;
  parsedFiles: number;
  skippedFiles: number;
  deletedExisting: number;
  deduplicated: boolean;
  importRunId?: string;
  errors: Array<{ reportType: string; filePath?: string; message: string }>;
}> {
  result = structuredClone({ batch: result.batch, files: result.files });
  dependencies = { ...dependencies };
  options = { ...options };
  if (!result.batch.storeId) {
    throw new Error('店铺级领星导入仓库或批次 StoreContext 尚未就绪。');
  }
  if (result.files.length > LINGXING_AD_REPORTS.length) throw new Error('REPORT_IMPORT_FILE_COUNT_LIMIT');
  const storeId = result.batch.storeId;
  const store = dependencies.stores.getStore(storeId);
  if (!store || store.status !== 'active') {
    throw new Error(`店铺 ${storeId} 不存在或已停用，拒绝导入领星报表。`);
  }
  const parser = dependencies.parser;
  if (!parser || !dependencies.guard) throw new Error('REPORT_IMPORT_TRUSTED_PARSER_AND_GUARD_REQUIRED');
  dependencies.guard.assertCurrent();
  const snapshots = new Map<string, ReportSourceSnapshot>();
  const reconciliations: ReportImportReconciliationInput[] = [];
  let resultBytes = 0;
  const errors: Array<{ reportType: string; filePath?: string; message: string }> = [];
  const parsedMetrics: AdDailyMetrics[] = [];
  const importFiles: Array<{
    lingxingFileId: string;
    reportType: string;
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    fileHash: string;
    importedRows: number;
  }> = [];
  let skippedFiles = 0;

  for (const file of result.files) {
    if (file.status !== 'downloaded' || !file.filePath) {
      skippedFiles += 1;
      continue;
    }
    let snapshot: ReportSourceSnapshot | undefined;
    try {
      dependencies.guard.assertCurrent();
      snapshot = parser.read(file.filePath);
      const sourceFile = snapshot.path, fileHash = snapshot.sha256;
      const parsed = await parser.parse(snapshot, { reportType: file.reportType, requireRegisteredTemplate: true });
      parser.assertCurrent(snapshot);
      dependencies.guard.assertCurrent();
      assertLingxingParsedReportImportable(parsed, {
        dateStart: result.batch.dateStart,
        dateEnd: result.batch.dateEnd,
        sourceName: path.basename(sourceFile),
      });
      resultBytes += Buffer.byteLength(JSON.stringify(parsed.data));
      if (resultBytes > parser.maxAggregateResultBytes) throw new Error('REPORT_IMPORT_AGGREGATE_RESULT_LIMIT');
      const rawTotal = await readIndependentLingxingReportControlTotals(result, {
        lingxingFileId: file.id, reportType: file.reportType, filePath: sourceFile, fileHash,
      }, parser, snapshot);
      dependencies.guard.assertCurrent();
      reconciliations.push(rawTotal);
      // 两条独立解析已消费同一快照，只保留身份元数据供事务内最终重验。
      snapshots.set(sourceFile, { ...snapshot, bytes: new Uint8Array() });
      importFiles.push({
        lingxingFileId: file.id,
        reportType: file.reportType,
        filePath: sourceFile,
        fileName: path.basename(sourceFile),
        fileSizeBytes: snapshot.sizeBytes,
        fileHash,
        importedRows: parsed.data.length,
      });
      parsedMetrics.push(...parsed.data.map((metric) => ({
        ...metric,
        batchId: result.batch.id,
        reportType: file.reportType,
        storeName: store.displayName,
        marketplaceCode: 'US',
        currency: 'USD',
        sourceFile,
      })));
    } catch (error) {
      const failure = logReportParserFailure('report_parser.import_file_failed', error);
      errors.push({
        reportType: file.reportType,
        filePath: file.filePath,
        message: failure instanceof Error ? failure.message : String(failure),
      });
    } finally { if (snapshot) parser.release(snapshot); }
  }

  const metrics = attachUniqueProductContext(parsedMetrics);
  if (errors.length > 0 || importFiles.length === 0) {
    return {
      inserted: 0,
      parsedFiles: importFiles.length,
      skippedFiles,
      deletedExisting: 0,
      deduplicated: false,
      errors,
    };
  }

  if (reconciliations.length !== LINGXING_AD_REPORTS.length) {
    throw new Error(
      `${LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING}: `
      + '当前采集器未捕获领星逐报独立行数/花费 control totals；拒绝由解析结果自证 matched，且未写入 completed import run。',
    );
  }
  assertExactIndependentLingxingReportControlTotals(result, reconciliations);
  const runId = `import_${result.batch.id}`;
  const commit = dependencies.guard.commit(() => {
    for (const snapshot of snapshots.values()) parser.assertCurrent(snapshot);
    return dependencies.repository.commitImportForStore(storeId, {
    runId,
    idempotencyKey: `lingxing:${result.batch.id}`,
    batchId: result.batch.id,
    files: importFiles,
    metrics,
    reconciliations,
    startedAt: options.startedAt ?? result.batch.completedAt ?? result.batch.createdAt,
    });
  });
  return {
    inserted: commit.run.metricRowCount,
    parsedFiles: commit.run.sourceFileCount,
    skippedFiles,
    deletedExisting: 0,
    deduplicated: commit.deduplicated,
    importRunId: commit.run.runId,
    errors,
  };
}
