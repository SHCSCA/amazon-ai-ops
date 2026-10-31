import { observedImportFingerprintMatches } from './ad-observed-fingerprint';
import type Database from 'better-sqlite3';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { hashCanonicalMetrics, readCanonicalMetrics } from '../migrations/0010-collection-resume-authority';

export interface AdObservedSnapshotScope {
  storeId: string;
  marketplaceCode: string;
  dateFrom: string;
  dateTo: string;
  batchIds: string[];
  sourceFiles: string[];
}
export interface AdObservedSnapshot {
  status: 'verified' | 'unavailable';
  reason: string;
  source?: {
    storeId: string; batchId: string; runId: string; snapshotId: string;
    sourceFile: string; fileHash: string; dateFrom: string; dateTo: string;
  };
  metrics: AdDailyMetrics[];
}
const unavailable = (reason: string): AdObservedSnapshot => ({ status: 'unavailable', reason, metrics: [] });
const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// 只认证已提交文件快照与当前行一致；不证明逐产品日覆盖，也不授予操作权限。
export function loadAdObservedSnapshot(
  db: Database.Database,
  scope: AdObservedSnapshotScope,
  limit = 5000,
): AdObservedSnapshot {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('产品观察快照行数上限无效。');
  if (!scope.storeId || scope.marketplaceCode !== 'US' || scope.batchIds.length !== 1
    || !scope.batchIds[0] || !scope.sourceFiles.length || !validDate(scope.dateFrom)
    || !validDate(scope.dateTo) || scope.dateFrom > scope.dateTo) return unavailable('scope_invalid');
  return db.transaction((): AdObservedSnapshot => {
    const batchId = scope.batchIds[0];
    const batch = db.prepare(`SELECT date_start, date_end, marketplace_code, status
      FROM lingxing_report_batches WHERE store_id = ? AND id = ?`).get(scope.storeId, batchId) as
      { date_start: string; date_end: string; marketplace_code: string; status: string } | undefined;
    if (!batch || batch.status !== 'completed' || batch.marketplace_code !== scope.marketplaceCode
      || !validDate(batch.date_start) || !validDate(batch.date_end)
      || batch.date_start > scope.dateFrom || batch.date_end < scope.dateTo) return unavailable('batch_scope_unverified');
    const runs = db.prepare(`SELECT run_id, metric_row_count, input_fingerprint, source_file_count, reconciliation_count FROM report_import_runs
      WHERE store_id = ? AND batch_id = ? AND status = 'completed' LIMIT 2`).all(scope.storeId, batchId) as
      Array<{ run_id: string; metric_row_count: number; input_fingerprint: string; source_file_count: number; reconciliation_count: number }>;
    if (runs.length !== 1) return unavailable('run_not_unique');
    const run = runs[0];
    const snapshots = db.prepare(`SELECT snapshot_id, file_path, file_hash, imported_rows
      FROM report_import_file_snapshots WHERE store_id = ? AND run_id = ? AND batch_id = ?
      AND report_type = 'advertised_product' LIMIT 2`).all(scope.storeId, run.run_id, batchId) as
      Array<{ snapshot_id: string; file_path: string; file_hash: string; imported_rows: number }>;
    if (snapshots.length !== 1 || !scope.sourceFiles.includes(snapshots[0].file_path)
      || !/^[a-f0-9]{64}$/.test(snapshots[0].file_hash)) return unavailable('snapshot_unverified');
    const snapshot = snapshots[0];
    const evidence = db.prepare(`SELECT row_count, payload_sha256 FROM report_import_metric_evidence
      WHERE store_id = ? AND run_id = ? AND batch_id = ? LIMIT 2`).all(scope.storeId, run.run_id, batchId) as
      Array<{ row_count: number; payload_sha256: string }>;
    const count = (db.prepare(`SELECT COUNT(*) AS count FROM ad_daily_metrics
      WHERE store_id = ? AND batch_id = ?`).get(scope.storeId, batchId) as { count: number }).count;
    if (count > limit) return unavailable('row_limit_exceeded');
    if (evidence.length !== 1 || count !== run.metric_row_count || count !== evidence[0].row_count) {
      return unavailable('metric_evidence_mismatch');
    }
    const metrics = readCanonicalMetrics(db, scope.storeId, batchId) as AdDailyMetrics[];
    if (hashCanonicalMetrics(metrics) !== evidence[0].payload_sha256) return unavailable('metric_evidence_mismatch');
    if (!observedImportFingerprintMatches(db, { storeId: scope.storeId, batchId, runId: run.run_id,
      dateFrom: batch.date_start, dateTo: batch.date_end, inputFingerprint: run.input_fingerprint,
      sourceFileCount: run.source_file_count, reconciliationCount: run.reconciliation_count, metrics })) {
      return unavailable('import_fingerprint_mismatch');
    }
    const advertised = metrics.filter(row => row.reportType === 'advertised_product');
    if (advertised.length !== snapshot.imported_rows || advertised.some(row => row.sourceFile !== snapshot.file_path
      || row.marketplaceCode !== scope.marketplaceCode || row.currency !== 'USD'
      || !validDate(row.date) || row.date < batch.date_start || row.date > batch.date_end
      || !Number.isSafeInteger(row.sourceRow) || Number(row.sourceRow) < 1)
      || new Set(advertised.map(row => row.sourceRow)).size !== advertised.length) return unavailable('source_rows_unverified');
    return { status: 'verified', reason: 'immutable_snapshot_match_not_coverage', source: {
      storeId: scope.storeId, batchId, runId: run.run_id, snapshotId: snapshot.snapshot_id,
      sourceFile: snapshot.file_path, fileHash: snapshot.file_hash, dateFrom: batch.date_start, dateTo: batch.date_end,
    }, metrics: advertised.filter(row => row.date >= scope.dateFrom && row.date <= scope.dateTo) };
  }).deferred();
}
