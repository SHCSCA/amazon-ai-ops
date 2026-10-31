import { LINGXING_REPORT_TYPE_SET } from './main-input-contract';
import * as path from 'path';
import * as fs from 'fs';
import { REPORT_PARSE_HARD_LIMITS } from '@amazon-ai-ops/report-parser';
import { type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { importLingxingDownloadedReportMetrics, type LingxingBatchFilesResult } from './lingxing-report-import';
import { inferAdMetricReportType } from '@amazon-ai-ops/local-db/src/sqlite/ad-metric-grain';
import { LINGXING_AD_REPORTS, verifyDownloadedFileAsync, inspectReportRowsContent, writeManifest } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingReportBatch, LingxingReportFile, LingxingReportType } from '@amazon-ai-ops/shared-types';
import { isPathInsideDirectory } from './acceptance-audit-export';
import { isExistingRawBusinessReportPath } from './business-report-files';
import { canonicalizeExistingPath } from './main-store-access-runtime';
import type { NormalizedBusinessUiScope } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';
import { captureReportImportCommitGuard, type SynchronousImportCheck } from './report-import-commit-guard';
import { captureReportSourceIdentity } from './report-parser-source';
import { fingerprintLingxingCollectionAuthorityProof, type CollectionResumeClaim } from '@amazon-ai-ops/local-db';
import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';

export async function handleDownloadReport(dateRange: { start: string; end: string }): Promise<string> {
  throw new Error(
    `旧版单报表下载入口已停用，避免访问过期的领星页面和未验证 selector。请在左侧“广告报表”中使用“采集预检”/“验证页面”/“启动采集”流程。日期范围：${dateRange.start} - ${dateRange.end}`,
  );
}

export async function handleParseReport(filePath: string): Promise<number> {
  throw new Error(
    `旧版无店铺归属的报表解析入口已停用：${path.basename(filePath || '') || '未提供文件'}。`
    + ' 请从当前美国站店铺的“采集与导入”工作台执行，系统会写入 store_id、文件快照与对账记录。',
  );
}

export function localBatchStamp(): string {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function safeLocalReportFileName(filePath: string, index: number): string {
  const extension = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 96) || `report_${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}_${baseName}${extension}`;
}

export function inferLingxingReportTypeFromLocalPath(filePath: string): LingxingReportType | undefined {
  const name = path.basename(filePath).toLowerCase().replace(/[\s\-()（）]+/g, '_');
  const explicit = inferAdMetricReportType('', name);
  if (explicit === 'search_term') return 'user_search_term';
  if (explicit && LINGXING_REPORT_TYPE_SET.has(explicit)) return explicit as LingxingReportType;
  if (/用户.*搜索词|search.*term|搜索词/.test(name)) return 'user_search_term';
  if (/商品.*投放|product.*target|asin.*target/.test(name)) return 'product_targeting';
  if (/推广.*商品|广告.*商品|advertised.*product/.test(name)) return 'advertised_product';
  if (/自动.*投放|auto.*target/.test(name)) return 'auto_targeting';
  if (/关键词|keyword/.test(name)) return 'keyword';
  if (/广告位|placement/.test(name)) return 'placement';
  if (/广告组|ad_group|ad.*group/.test(name)) return 'ad_group';
  if (/广告活动|campaign/.test(name)) return 'campaign';
  return undefined;
}

export async function buildLocalBusinessReportBatch(
  scope: NormalizedBusinessUiScope,
  selectedPaths: string[],
  capsule: StoreCapsulePaths,
): Promise<{ batch: LingxingReportBatch; files: LingxingReportFile[] }> {
  const mainRuntimeContext = getMainRuntimeContext();
  const uniquePaths = Array.from(new Set(selectedPaths.map((item) => canonicalizeExistingPath(item)).filter(Boolean)));
  if (uniquePaths.length > LINGXING_AD_REPORTS.length) throw new Error('REPORT_IMPORT_FILE_COUNT_LIMIT');
  const rejectedPaths = uniquePaths.filter((filePath) => !isExistingRawBusinessReportPath(filePath));
  if (rejectedPaths.length > 0) {
    throw new Error(`本地导入被阻断：以下文件不是可用的 .xlsx/.xls/.csv 原始广告表格：${rejectedPaths.map((item) => path.basename(item)).join('、')}`);
  }

  const now = new Date().toISOString();
  const batchId = `batch_local_${localBatchStamp()}`;
  const downloadDir = path.join(
    capsule.downloadsDir,
    'local-imports',
    `${scope.dateFrom}_${scope.dateTo}`,
    batchId,
  );
  if (!isPathInsideDirectory(downloadDir, capsule.downloadsDir)) {
    throw new Error('本地导入被阻断：目标目录不属于当前店铺独立数据舱。');
  }
  fs.mkdirSync(downloadDir, { recursive: true });

  const files: LingxingReportFile[] = [];
  const usedReportTypes = new Set<string>();
  const unknownFiles: string[] = [];

  const parser = mainRuntimeContext.reportParserRuntime.createSession();
  for (const [index, sourcePath] of uniquePaths.entries()) {
    const reportType = inferLingxingReportTypeFromLocalPath(sourcePath);
    if (!reportType) {
      unknownFiles.push(path.basename(sourcePath));
      continue;
    }
    if (usedReportTypes.has(reportType)) {
      throw new Error(`本地导入被阻断：${path.basename(sourcePath)} 与已选择文件重复对应 ${reportType}，每类报表当前只保留 1 个文件。`);
    }
    usedReportTypes.add(reportType);
    const definition = LINGXING_AD_REPORTS.find((item) => item.type === reportType);
    const targetPath = path.join(downloadDir, safeLocalReportFileName(sourcePath, index));
    const sourceSnapshot = parser.read(sourcePath);
    try { fs.writeFileSync(targetPath, sourceSnapshot.bytes, { flag: 'wx' }); }
    finally { parser.release(sourceSnapshot); }
    const verification = await verifyDownloadedFileAsync(targetPath, {
      minBytes: 1,
      expectedDownloadDir: downloadDir,
      expectedReportType: reportType,
    }, async (filePath, expectedType) => inspectReportRowsContent(await parser.preflight(filePath), expectedType));
    mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(scope.storeContext);
    if (!verification.valid) {
      throw new Error(`本地导入被阻断：${path.basename(sourcePath)} 校验失败：${verification.errorMessage || '不是有效广告报表'}`);
    }
    files.push({
      id: `${batchId}_${reportType}`,
      batchId,
      reportType,
      displayName: definition?.displayName || reportType,
      status: 'downloaded',
      maxAutoRetries: 0,
      autoRetryCount: 0,
      filePath: targetPath,
      fileSizeBytes: verification.fileSizeBytes,
      attemptErrors: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  if (unknownFiles.length > 0) {
    throw new Error(`本地导入被阻断：无法从文件名识别报表类型：${unknownFiles.join('、')}。请使用包含 campaign、ad_group、placement、advertised_product、auto_targeting、keyword、product_targeting、search_term，或中文报表名的文件名。`);
  }
  if (files.length === 0) {
    throw new Error('本地导入被阻断：未选择可导入的真实广告报表。');
  }

  const batch: LingxingReportBatch = {
    id: batchId,
    requestId: `local-import:${batchId}`,
    storeId: scope.storeId,
    browserProfileId: scope.storeContext.browserProfileId,
    businessDate: scope.storeContext.businessDate,
    sessionGeneration: scope.storeContext.sessionGeneration,
    appVersion: mainRuntimeContext.APP_VERSION,
    dateStart: scope.dateFrom,
    dateEnd: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    
    
    
    status: 'completed_with_errors',
    downloadDir,
    createdAt: now,
    completedAt: now,
  };
  batch.manifestPath = writeManifest(batch, files);
  return { batch, files };
}

export function fileSizeOrZero(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function fileHashOrNull(filePath: string): string | null {
  try {
    return captureReportSourceIdentity(filePath, REPORT_PARSE_HARD_LIMITS.maxInputBytes).sha256;
  } catch {
    return null;
  }
}

export function reportFileIndexKey(batchId: string, reportType: string, filePath: string): string {
  return [
    batchId,
    reportType,
    canonicalizeExistingPath(filePath).toLowerCase(),
  ].join('|');
}

export function importStoreScopedLingxingDownloadedReportMetrics(result: LingxingBatchFilesResult,
  options: { startedAt?: string; assertCurrent: SynchronousImportCheck; expectedJob?: LingxingCollectionJobSnapshot; expectedClaim?: CollectionResumeClaim }) {
  result = structuredClone({ batch: result.batch, files: result.files });
  options = { ...options, expectedJob: options.expectedJob && structuredClone(options.expectedJob),
    expectedClaim: options.expectedClaim && structuredClone(options.expectedClaim) };
  const mainRuntimeContext = getMainRuntimeContext();
  const { db: database, lingxingImportRepo: repository, storeRepo: stores, configurationBus } = mainRuntimeContext.state;
  if (!database || !repository || !stores || !configurationBus || !result.batch.storeId || typeof options?.assertCurrent !== 'function') throw new Error('REPORT_IMPORT_TRUSTED_CONTEXT_REQUIRED');
  const parser = mainRuntimeContext.reportParserRuntime.createSession();
  const guard = captureReportImportCommitGuard({ database, storeId: result.batch.storeId, batchId: result.batch.id,
    jobId: options.expectedJob?.jobId, expectedJob: options.expectedJob, expectedClaim: options.expectedClaim,
    readClaimProof: options.expectedClaim ? () => {
      const proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(result.batch.storeId!, options.expectedClaim!.requestId);
      if (!proof) throw new Error('REPORT_IMPORT_CLAIM_PROOF_REQUIRED');
      return fingerprintLingxingCollectionAuthorityProof(proof);
    } : undefined,
    assertAuthority: options.assertCurrent,
    assertConnection: () => {
      if (mainRuntimeContext.state.db !== database || mainRuntimeContext.state.lingxingImportRepo !== repository
        || mainRuntimeContext.state.storeRepo !== stores || mainRuntimeContext.state.configurationBus !== configurationBus) throw new Error('REPORT_IMPORT_RUNTIME_CHANGED');
    },
    readSessionGeneration: () => configurationBus.get(`${mainRuntimeContext.STORE_SESSION_GENERATION_SETTING_PREFIX}${result.batch.storeId}`),
  });
  return importLingxingDownloadedReportMetrics(result, { repository, stores, parser, guard }, options);
}

export function loadLatestImportableLingxingBatchForScope(scope: NormalizedBusinessUiScope): LingxingBatchFilesResult | undefined {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return undefined;
  const batch = mainRuntimeContext.state.db.prepare(`
    SELECT *
    FROM lingxing_report_batches
    WHERE status IN ('completed', 'completed_with_errors')
      AND store_id = @storeId
      AND COALESCE(request_id, '') NOT LIKE 'canary:%'
      AND date_start = @dateFrom
      AND date_end = @dateTo
      AND marketplace_code = @marketplaceCode
    ORDER BY completed_at DESC, created_at DESC
    LIMIT 1
  `).get(scope) as any;
  if (!batch) return undefined;

  const rows = mainRuntimeContext.state.db.prepare(`
    SELECT *
    FROM lingxing_report_files
    WHERE store_id = ? AND batch_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(scope.storeId, batch.id) as any[];

  return {
    batch: {
      id: batch.id,
      requestId: batch.request_id,
      storeId: batch.store_id,
      browserProfileId: batch.browser_profile_id,
      businessDate: batch.business_date,
      sessionGeneration: batch.session_generation,
      appVersion: batch.app_version,
      dateStart: batch.date_start,
      dateEnd: batch.date_end,
      storeName: batch.store_name,
      marketplaceCode: batch.marketplace_code,
      status: batch.status,
      downloadDir: batch.download_dir,
      manifestPath: batch.manifest_path,
      createdAt: batch.created_at,
      completedAt: batch.completed_at,
    },
    files: rows.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      reportType: row.report_type,
      displayName: row.display_name,
      status: row.status,
      maxAutoRetries: row.max_auto_retries,
      autoRetryCount: row.auto_retry_count,
      filePath: row.file_path,
      fileSizeBytes: row.file_size_bytes,
      errorMessage: row.error_message,
      attemptErrors: row.attempt_errors_json ? JSON.parse(row.attempt_errors_json) : [],
      failureScreenshotPath: row.failure_screenshot_path,
      failureDomSnapshotPath: row.failure_dom_snapshot_path,
      failureTracePath: row.failure_trace_path,
      traceUnavailableReason: row.trace_unavailable_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function backfillAdMetricsFromLatestBatchIfNeeded(scope: NormalizedBusinessUiScope) {
  const mainRuntimeContext = getMainRuntimeContext();
  const existing = mainRuntimeContext.state.db?.prepare(`
    SELECT 1 FROM ad_daily_metrics
    WHERE store_id = ? AND date >= ? AND date <= ?
    LIMIT 1
  `).get(scope.storeId, scope.dateFrom, scope.dateTo);
  if (existing) return undefined;
  const latestBatch = loadLatestImportableLingxingBatchForScope(scope);
  return latestBatch ? importStoreScopedLingxingDownloadedReportMetrics(latestBatch, {
    assertCurrent: () => mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(scope.storeContext),
  }) : undefined;
}
