import { attachUniqueProductContext } from './lingxing-report-product-attribution';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ReportParser } from '@amazon-ai-ops/report-parser';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingImportRepository, StoreRepository, ReportImportReconciliationInput } from '@amazon-ai-ops/local-db';
import type { AdDailyMetrics, LingxingReportBatch, LingxingReportFile } from '@amazon-ai-ops/shared-types';
import { assertLingxingParsedReportImportable } from './lingxing-report-import-validation';

export type LingxingBatchFilesResult = { batch: LingxingReportBatch; files: LingxingReportFile[] };
function canonicalizeExistingPath(filePath: string): string { return fs.realpathSync.native(path.resolve(filePath)); }
function fileHashOrNull(filePath: string): string | null {
  try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); } catch { return null; }
}
function fileSizeOrZero(filePath: string): number { return fs.statSync(filePath).size; }
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
function readIndependentLingxingReportControlTotals(
  result: LingxingBatchFilesResult,
  importFiles: ReadonlyArray<{
    lingxingFileId: string;
    reportType: string;
    filePath: string;
    fileHash: string;
  }>,
): readonly ReportImportReconciliationInput[] | undefined {
  if (importFiles.length !== LINGXING_AD_REPORTS.length) return undefined;
  return importFiles.map((importFile) => {
    const beforeHash = fileHashOrNull(importFile.filePath);
    let totals: ReturnType<typeof ReportParser.readLingxingRawReportControlTotals>;
    try {
      totals = ReportParser.readLingxingRawReportControlTotals(importFile.filePath, {
        dateStart: result.batch.dateStart,
        dateEnd: result.batch.dateEnd,
      });
    } catch (error) {
      throw invalidLingxingImportReconciliationEvidence(
        `${importFile.reportType} 的原始报表 control total 无法独立读取：`
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const afterHash = fileHashOrNull(importFile.filePath);
    if (beforeHash !== importFile.fileHash || afterHash !== importFile.fileHash) {
      throw invalidLingxingImportReconciliationEvidence(
        `${importFile.reportType} 的原始报表在 control total 扫描前后发生变化。`,
      );
    }
    return {
      dateStart: result.batch.dateStart,
      dateEnd: result.batch.dateEnd,
      metricDate: result.batch.dateEnd,
      reportType: importFile.reportType,
      expectedRows: totals.expectedRows,
      expectedCost: totals.expectedCost,
      tolerance: 0,
    };
  });
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

export function importLingxingDownloadedReportMetrics(
  result: LingxingBatchFilesResult,
  dependencies: { repository: LingxingImportRepository; stores: StoreRepository },
  options: { startedAt?: string } = {},
): {
  inserted: number;
  parsedFiles: number;
  skippedFiles: number;
  deletedExisting: number;
  deduplicated: boolean;
  importRunId?: string;
  errors: Array<{ reportType: string; filePath?: string; message: string }>;
} {
  if (!result.batch.storeId) {
    throw new Error('店铺级领星导入仓库或批次 StoreContext 尚未就绪。');
  }
  const storeId = result.batch.storeId;
  const store = dependencies.stores.getStore(storeId);
  if (!store || store.status !== 'active') {
    throw new Error(`店铺 ${storeId} 不存在或已停用，拒绝导入领星报表。`);
  }
  const parser = new ReportParser();
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
    try {
      const sourceFile = canonicalizeExistingPath(file.filePath);
      const fileHash = fileHashOrNull(sourceFile);
      if (!fileHash) throw new Error(`无法计算报表 SHA-256：${path.basename(sourceFile)}。`);
      const parsed = parser.autoParse(sourceFile, { reportType: file.reportType, requireRegisteredTemplate: true });
      if (fileHashOrNull(sourceFile) !== fileHash) {
        throw invalidLingxingImportReconciliationEvidence(`${file.reportType} 在解析期间发生变化，请重新下载后导入。`);
      }
      assertLingxingParsedReportImportable(parsed, {
        dateStart: result.batch.dateStart,
        dateEnd: result.batch.dateEnd,
        sourceName: path.basename(sourceFile),
      });
      importFiles.push({
        lingxingFileId: file.id,
        reportType: file.reportType,
        filePath: sourceFile,
        fileName: path.basename(sourceFile),
        fileSizeBytes: fileSizeOrZero(sourceFile),
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
      errors.push({
        reportType: file.reportType,
        filePath: file.filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
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

  const reconciliations = readIndependentLingxingReportControlTotals(result, importFiles);
  if (!reconciliations) {
    throw new Error(
      `${LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING}: `
      + '当前采集器未捕获领星逐报独立行数/花费 control totals；拒绝由解析结果自证 matched，且未写入 completed import run。',
    );
  }
  assertExactIndependentLingxingReportControlTotals(result, reconciliations);
  if (importFiles.some(file => fileHashOrNull(file.filePath) !== file.fileHash)) {
    throw invalidLingxingImportReconciliationEvidence('报表在解析/对账后发生变化，未提交导入；请重新下载。');
  }

  const runId = `import_${result.batch.id}`;
  const commit = dependencies.repository.commitImportForStore(storeId, {
    runId,
    idempotencyKey: `lingxing:${result.batch.id}`,
    batchId: result.batch.id,
    files: importFiles,
    metrics,
    reconciliations,
    startedAt: options.startedAt ?? result.batch.completedAt ?? result.batch.createdAt,
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
