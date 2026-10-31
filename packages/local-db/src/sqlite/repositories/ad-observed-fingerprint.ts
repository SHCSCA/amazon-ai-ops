import type Database from 'better-sqlite3';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { importFingerprint } from './lingxing-import-metrics';
import type { ReportImportFileInput, ReportImportReconciliationInput } from './lingxing-import-contracts';

// 使用导入时同一指纹算法；无法无损还原旧控制值时不认证窗口。
export function observedImportFingerprintMatches(db: Database.Database, input: {
  storeId: string; batchId: string; runId: string; dateFrom: string; dateTo: string;
  inputFingerprint: string; sourceFileCount: number; reconciliationCount: number;
  metrics: AdDailyMetrics[];
}): boolean {
  const files = db.prepare(`SELECT lingxing_file_id, report_type, file_path, file_name,
    file_size_bytes, file_hash, imported_rows FROM report_import_file_snapshots
    WHERE store_id = ? AND run_id = ? AND batch_id = ?`).all(input.storeId, input.runId, input.batchId) as Array<{
      lingxing_file_id: string | null; report_type: string; file_path: string; file_name: string;
      file_size_bytes: number; file_hash: string; imported_rows: number;
    }>;
  const controls = db.prepare(`SELECT metric_date, report_type, expected_rows, expected_cost_1e4,
    tolerance_1e4 FROM report_import_reconciliations WHERE store_id = ? AND run_id = ? AND batch_id = ?`)
    .all(input.storeId, input.runId, input.batchId) as Array<{
      metric_date: string; report_type: string; expected_rows: number; expected_cost_1e4: number; tolerance_1e4: number;
    }>;
  if (!files.length || files.length !== input.sourceFileCount || controls.length !== input.reconciliationCount
    || files.length !== controls.length || new Set(files.map(file => file.report_type)).size !== files.length
    || new Set(controls.map(control => control.report_type)).size !== controls.length
    || controls.some(control => control.metric_date !== input.dateTo
      || !files.some(file => file.report_type === control.report_type))) return false;
  const recoveredFiles: ReportImportFileInput[] = files.map(file => ({
    lingxingFileId: file.lingxing_file_id ?? undefined, reportType: file.report_type, filePath: file.file_path,
    fileName: file.file_name, fileSizeBytes: file.file_size_bytes, fileHash: file.file_hash, importedRows: file.imported_rows,
  }));
  const reconciliations: ReportImportReconciliationInput[] = controls.map(control => ({
    dateStart: input.dateFrom, dateEnd: input.dateTo, metricDate: control.metric_date,
    reportType: control.report_type, expectedRows: control.expected_rows,
    expectedCost: control.expected_cost_1e4 / 10000, tolerance: control.tolerance_1e4 / 10000,
  }));
  return importFingerprint({ runId: input.runId, idempotencyKey: '', batchId: input.batchId,
    files: recoveredFiles, metrics: input.metrics, reconciliations }) === input.inputFingerprint;
}
