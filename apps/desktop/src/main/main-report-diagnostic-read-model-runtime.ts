import { parseStringArray, parseJsonArray, stringOrUndefined } from './main-value-coercion';
import * as path from 'path';
import * as fs from 'fs';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel, DownloadCenterSelectorCandidate, LingxingReportBatch, LingxingReportFile, LingxingReportType } from '@amazon-ai-ops/shared-types';
import { isPathInsideDirectory } from './acceptance-audit-export';
import { getLatestDownloadCenterDiagnosticRowForModel } from './download-center-diagnostic-store';
import { parseDiagnosticActionSelectorChecks, parseDownloadCenterPageModelSnapshot } from './main-download-automation-runtime';
import type { LingxingCollectionTarget } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function loadPersistedLingxingBatch(batchId: string): { batch: LingxingReportBatch; files: LingxingReportFile[] } {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) {
    throw new Error('本地数据库尚未初始化');
  }
  const storeId = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext()?.storeId;
  if (!storeId) throw new Error('请先选择店铺，再读取领星采集批次。');
  const batchRow = mainRuntimeContext.state.db.prepare(`
    SELECT
      id,
      store_id AS storeId,
      request_id AS requestId,
      browser_profile_id AS browserProfileId,
      business_date AS businessDate,
      session_generation AS sessionGeneration,
      app_version AS appVersion,
      date_start AS dateStart,
      date_end AS dateEnd,
      store_name AS storeName,
      marketplace_code AS marketplaceCode,
      status,
      download_dir AS downloadDir,
      manifest_path AS manifestPath,
      created_at AS createdAt,
      completed_at AS completedAt
    FROM lingxing_report_batches
    WHERE store_id = ? AND id = ?
  `).get(storeId, batchId) as (LingxingReportBatch & { appVersion?: string | null; manifestPath?: string | null; completedAt?: string | null }) | undefined;
  if (!batchRow) {
    throw new Error(`未找到领星采集批次：${batchId}`);
  }
  const fileRows = mainRuntimeContext.state.db.prepare(`
    SELECT
      id,
      batch_id AS batchId,
      report_type AS reportType,
      display_name AS displayName,
      status,
      max_auto_retries AS maxAutoRetries,
      auto_retry_count AS autoRetryCount,
      file_path AS filePath,
      file_size_bytes AS fileSizeBytes,
      error_message AS errorMessage,
      attempt_errors_json AS attemptErrorsJson,
      failure_screenshot_path AS failureScreenshotPath,
      failure_dom_snapshot_path AS failureDomSnapshotPath,
      failure_trace_path AS failureTracePath,
      trace_unavailable_reason AS traceUnavailableReason,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM lingxing_report_files
    WHERE store_id = ? AND batch_id = ?
    ORDER BY id ASC
  `).all(storeId, batchId) as Array<LingxingReportFile & { attemptErrorsJson?: string | null; filePath?: string | null; errorMessage?: string | null }>;

  return {
    batch: {
      ...batchRow,
      appVersion: batchRow.appVersion ?? undefined,
      storeName: batchRow.storeName ?? undefined,
      marketplaceCode: batchRow.marketplaceCode ?? undefined,
      manifestPath: batchRow.manifestPath ?? undefined,
      completedAt: batchRow.completedAt ?? undefined,
    },
    files: fileRows.map((row) => ({
      ...row,
      filePath: row.filePath ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      attemptErrors: parseStringArray(row.attemptErrorsJson),
      failureScreenshotPath: row.failureScreenshotPath ?? undefined,
      failureDomSnapshotPath: row.failureDomSnapshotPath ?? undefined,
      failureTracePath: row.failureTracePath ?? undefined,
      traceUnavailableReason: row.traceUnavailableReason ?? undefined,
    })),
  };
}

export function loadSuccessfulCanaryReportTypesForScope(
  dateRange: { start: string; end: string },
  target: LingxingCollectionTarget & { storeId: string },
  afterCheckedAt?: string,
): LingxingReportType[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return [];
  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT
      b.id AS batchId,
      b.created_at AS batchCreatedAt,
      b.download_dir AS downloadDir,
      f.report_type AS reportType,
      f.file_path AS filePath,
      f.file_size_bytes AS fileSizeBytes,
      f.error_message AS errorMessage,
      f.attempt_errors_json AS attemptErrorsJson
    FROM lingxing_report_batches b
    JOIN lingxing_report_files f ON f.store_id = b.store_id AND f.batch_id = b.id
    WHERE b.store_id = ?
      AND b.app_version = ?
      AND b.date_start = ?
      AND b.date_end = ?
      AND COALESCE(b.request_id, '') LIKE 'canary:%'
      AND COALESCE(b.marketplace_code, '') = COALESCE(?, '')
      AND b.status = 'completed'
      AND f.status = 'downloaded'
      AND (
        SELECT COUNT(*)
        FROM lingxing_report_files count_files
        WHERE count_files.store_id = b.store_id AND count_files.batch_id = b.id
      ) = 1
    ORDER BY b.created_at DESC, b.id DESC
  `).all(
    target.storeId,
    mainRuntimeContext.APP_VERSION,
    dateRange.start,
    dateRange.end,
    target.marketplaceCode ?? '',
  ) as Array<{
    batchId: string;
    batchCreatedAt: string;
    downloadDir: string;
    reportType: string;
    filePath?: string | null;
    fileSizeBytes?: number | null;
    errorMessage?: string | null;
    attemptErrorsJson?: string | null;
  }>;

  const afterMs = afterCheckedAt ? Date.parse(afterCheckedAt) : Number.NaN;
  const dateStartToken = compactDateToken(dateRange.start);
  const dateEndToken = compactDateToken(dateRange.end);
  const covered = new Set<LingxingReportType>();

  for (const row of rows) {
    const report = LINGXING_AD_REPORTS.find((item) => item.type === row.reportType);
    if (!report) continue;
    const createdAtMs = Date.parse(row.batchCreatedAt);
    if (Number.isFinite(afterMs) && (!Number.isFinite(createdAtMs) || createdAtMs < afterMs)) continue;
    if (row.errorMessage) continue;
    if (JSON.stringify(parseStringArray(row.attemptErrorsJson)) !== '[]') continue;
    if (!row.filePath || !fs.existsSync(row.filePath)) continue;
    if (!isPathInsideDirectory(path.resolve(row.filePath), path.resolve(row.downloadDir))) continue;
    const actualSize = fs.statSync(row.filePath).size;
    if (actualSize < 128 || row.fileSizeBytes !== actualSize) continue;
    const basename = path.basename(row.filePath).toLowerCase();
    if (!basename.includes(report.expectedFilenameKeyword.toLowerCase())) continue;
    if (!basename.includes(dateStartToken) || !basename.includes(dateEndToken)) continue;
    covered.add(report.type);
  }

  return [...covered];
}

export function compactDateToken(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function loadPersistedDownloadCenterDiagnostic(
  diagnosticId: number | undefined,
  dateStart: string,
  dateEnd: string,
): DownloadCenterDiagnosticResult | undefined {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return undefined;
  const storeId = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext()?.storeId;
  if (!storeId) return undefined;
  const row = diagnosticId
    ? mainRuntimeContext.state.db.prepare(`
        SELECT * FROM download_center_diagnostics WHERE store_id = ? AND id = ?
      `).get(storeId, diagnosticId)
    : mainRuntimeContext.state.db.prepare(`
        SELECT * FROM download_center_diagnostics
        WHERE store_id = ? AND date_start = ? AND date_end = ?
        ORDER BY checked_at DESC, id DESC
        LIMIT 1
      `).get(storeId, dateStart, dateEnd);
  if (!row) return undefined;
  return mapDownloadCenterDiagnosticRow(row as Record<string, unknown>);
}

export function loadLatestPersistedDownloadCenterDiagnosticForModel(
  model: DownloadCenterPageModel,
  dateStart: string,
  dateEnd: string,
  target: LingxingCollectionTarget & { storeId: string },
): DownloadCenterDiagnosticResult | undefined {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return undefined;
  const row = getLatestDownloadCenterDiagnosticRowForModel(mainRuntimeContext.state.db, model, dateStart, dateEnd, target);
  if (!row) return undefined;
  return mapDownloadCenterDiagnosticRow(row as Record<string, unknown>);
}

export function mapDownloadCenterDiagnosticRow(row: Record<string, unknown>): DownloadCenterDiagnosticResult {
  return {
    id: Number(row.id),
    appVersion: stringOrUndefined(row.app_version),
    pageModel: String(row.page_model || ''),
    pageModelSource: row.page_model_source === 'override' ? 'override' : row.page_model_source === 'bundled' ? 'bundled' : undefined,
    pageModelSnapshot: parseDownloadCenterPageModelSnapshot(stringOrUndefined(row.page_model_snapshot_json)),
    dateStart: stringOrUndefined(row.date_start),
    dateEnd: stringOrUndefined(row.date_end),
    storeName: stringOrUndefined(row.store_name),
    marketplaceCode: stringOrUndefined(row.marketplace_code),
    url: String(row.url || ''),
    title: String(row.title || ''),
    ready: Boolean(row.ready),
    requiresManualVerification: Boolean(row.requires_manual_verification),
    matchedEntryHints: parseStringArray(row.matched_entry_hints_json),
    matchedReportNames: parseStringArray(row.matched_report_names_json),
    selectorChecks: parseJsonArray(row.selector_checks_json) as DownloadCenterDiagnosticResult['selectorChecks'],
    missingRequiredSelectors: parseStringArray(row.missing_required_selectors_json),
    selectorCandidates: parseJsonArray(row.selector_candidates_json) as DownloadCenterSelectorCandidate[],
    actionSelectorChecks: parseDiagnosticActionSelectorChecks(stringOrUndefined(row.action_selector_checks_json)),
    checkedAt: String(row.checked_at || ''),
    screenshotPath: stringOrUndefined(row.screenshot_path),
    domSnapshotPath: stringOrUndefined(row.dom_snapshot_path),
    errorMessage: stringOrUndefined(row.error_message),
  };
}
