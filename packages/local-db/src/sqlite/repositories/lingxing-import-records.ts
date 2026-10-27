import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { parseRequiredJson, parseJsonArray, canonicalIsoDate } from './lingxing-import-values';
import { type StoreScopedLingxingReportBatch, type StoreScopedLingxingReportFile, type ReportImportRunRecord, type ReportImportFileSnapshotRecord, type StoreScopedImportedReportFile, type ReportImportReconciliationRecord } from './lingxing-import-contracts';

export function mapCollectionCheckpoint(row: any): LingxingCollectionReportCheckpoint {
    return {
        reportType: row.report_type,
        state: row.state,
        attemptIndex: row.attempt_index,
        autoRetryCount: row.auto_retry_count,
        ...(row.created_report_identity_json ? {
            createdReportIdentity: parseRequiredJson(row.created_report_identity_json, '已创建报表身份'),
        } : {}),
        ...(row.file_size_bytes !== null ? { fileSizeBytes: row.file_size_bytes } : {}),
        ...(row.error_code ? { errorCode: row.error_code } : {}),
        ...(row.detail ? { detail: row.detail } : {}),
        updatedAt: row.updated_at,
    };
}

export function mapBatch(row: any, storeId: StoreId): StoreScopedLingxingReportBatch {
    return {
        id: row.id,
        storeId,
        requestId: row.request_id ?? undefined,
        browserProfileId: row.browser_profile_id ?? undefined,
        businessDate: row.business_date ?? undefined,
        sessionGeneration: row.session_generation ?? undefined,
        appVersion: row.app_version ?? undefined,
        dateStart: row.date_start,
        dateEnd: row.date_end,
        storeName: row.store_name ?? undefined,
        marketplaceCode: row.marketplace_code ?? undefined,
        status: row.status,
        downloadDir: row.download_dir,
        manifestPath: row.manifest_path ?? undefined,
        createdAt: row.created_at,
        completedAt: row.completed_at ?? undefined,
    };
}

export function mapLingxingFile(row: any, storeId: StoreId): StoreScopedLingxingReportFile {
    return {
        id: row.id,
        storeId,
        batchId: row.batch_id,
        reportType: row.report_type,
        displayName: row.display_name,
        status: row.status,
        maxAutoRetries: row.max_auto_retries,
        autoRetryCount: row.auto_retry_count,
        filePath: row.file_path ?? undefined,
        fileSizeBytes: row.file_size_bytes,
        errorMessage: row.error_message ?? undefined,
        attemptErrors: parseJsonArray(row.attempt_errors_json),
        failureScreenshotPath: row.failure_screenshot_path ?? undefined,
        failureDomSnapshotPath: row.failure_dom_snapshot_path ?? undefined,
        failureTracePath: row.failure_trace_path ?? undefined,
        traceUnavailableReason: row.trace_unavailable_reason ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function mapRun(row: any, storeId: StoreId): ReportImportRunRecord {
    return {
        storeId,
        runId: row.run_id,
        idempotencyKey: row.idempotency_key,
        inputFingerprint: row.input_fingerprint,
        batchId: row.batch_id,
        status: row.status,
        sourceFileCount: row.source_file_count,
        metricRowCount: row.metric_row_count,
        reconciliationCount: row.reconciliation_count,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
    };
}

export function mapFileSnapshot(row: any, storeId: StoreId): ReportImportFileSnapshotRecord {
    return {
        storeId,
        snapshotId: row.snapshot_id,
        runId: row.run_id,
        batchId: row.batch_id,
        lingxingFileId: row.lingxing_file_id ?? undefined,
        reportFileId: row.report_file_id ?? undefined,
        reportType: row.report_type,
        filePath: row.file_path,
        fileName: row.file_name,
        fileSizeBytes: row.file_size_bytes,
        fileHash: row.file_hash,
        importedRows: row.imported_rows,
        capturedAt: row.captured_at,
    };
}

export function mapImportedReportFile(row: any, storeId: StoreId): StoreScopedImportedReportFile {
    return {
        id: row.id,
        storeId,
        batchId: row.batch_id,
        reportType: row.report_type,
        filePath: row.file_path,
        fileName: row.file_name,
        fileSizeBytes: row.file_size,
        status: row.status,
        importedRows: row.imported_rows,
        fileHash: row.file_hash ?? undefined,
        importError: row.import_error ?? undefined,
        lastImportedAt: row.last_imported_at ?? undefined,
    };
}

export function mapReconciliation(row: any, storeId: StoreId): ReportImportReconciliationRecord {
    return {
        storeId,
        reconciliationId: row.reconciliation_id,
        runId: row.run_id,
        batchId: row.batch_id,
        dateStart: canonicalIsoDate(row.reconciliation_date_start, 'reconciliation.dateStart'),
        dateEnd: canonicalIsoDate(row.reconciliation_date_end, 'reconciliation.dateEnd'),
        metricDate: row.metric_date,
        reportType: row.report_type,
        currency: 'USD',
        expectedRows: row.expected_rows,
        actualRows: row.actual_rows,
        expectedCost: row.expected_cost_1e4 / 10000,
        actualCost: row.actual_cost_1e4 / 10000,
        absoluteCostDelta: row.absolute_cost_delta_1e4 / 10000,
        tolerance: row.tolerance_1e4 / 10000,
        withinTolerance: row.within_tolerance === 1,
        status: row.status,
        reconciledAt: row.reconciled_at,
    };
}
