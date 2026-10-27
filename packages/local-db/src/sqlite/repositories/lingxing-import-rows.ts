import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type StoreAuthority, type ReportImportFileInput, type ReportImportRunRecord, type CommitReportImportInput, type ReportImportCommitResult } from './lingxing-import-contracts';
import { stableJson, requiredText, normalizeBatchStoreName, canonicalIsoDate } from './lingxing-import-values';
import { validateImportFile, metricParams } from './lingxing-import-metrics';
import { mapRun } from './lingxing-import-records';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function getWritableStoreAuthority(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId): StoreAuthority {
    const row = repositoryContext.methods.getStoreAuthority(storeId);
    if (row.status !== 'active')
        throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
    return row;
}

export function getStoreAuthority(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId): StoreAuthority {
    const row = repositoryContext.db.prepare(`
      SELECT stores.display_name AS displayName,
             stores.marketplace,
             stores.currency,
             stores.status,
             stores.browser_profile_id AS browserProfileId,
             stores.business_timezone AS businessTimezone,
             (
               SELECT connection.collection_store_name
               FROM store_connections AS connection
               WHERE connection.store_id = stores.store_id
                 AND connection.provider = 'lingxing'
               LIMIT 1
             ) AS lingxingCollectionStoreName
      FROM stores
      WHERE stores.store_id = ?
    `).get(storeId) as StoreAuthority | undefined;
    if (!row)
        throw new Error(`未知店铺 ${storeId}。`);
    if (row.marketplace !== 'US' || row.currency !== 'USD') {
        throw new Error(`店铺 ${storeId} 不是 Amazon US / USD 权威数据域。`);
    }
    return row;
}

export function upsertCollectionCheckpoint(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string, checkpoint: LingxingCollectionReportCheckpoint): void {
    repositoryContext.db.prepare(`
      INSERT INTO lingxing_collection_report_checkpoints (
        store_id, job_id, report_type, state, attempt_index,
        auto_retry_count, created_report_identity_json, file_size_bytes,
        error_code, detail, updated_at
      ) VALUES (
        @storeId, @jobId, @reportType, @state, @attemptIndex,
        @autoRetryCount, @createdReportIdentityJson, @fileSizeBytes,
        @errorCode, @detail, @updatedAt
      )
      ON CONFLICT(store_id, job_id, report_type) DO UPDATE SET
        state = excluded.state,
        attempt_index = excluded.attempt_index,
        auto_retry_count = excluded.auto_retry_count,
        created_report_identity_json = excluded.created_report_identity_json,
        file_size_bytes = excluded.file_size_bytes,
        error_code = excluded.error_code,
        detail = excluded.detail,
        updated_at = excluded.updated_at
    `).run({
        storeId,
        jobId,
        reportType: checkpoint.reportType,
        state: checkpoint.state,
        attemptIndex: checkpoint.attemptIndex,
        autoRetryCount: checkpoint.autoRetryCount,
        createdReportIdentityJson: checkpoint.createdReportIdentity
            ? stableJson(checkpoint.createdReportIdentity)
            : null,
        fileSizeBytes: checkpoint.fileSizeBytes ?? null,
        errorCode: checkpoint.errorCode ?? null,
        detail: checkpoint.detail ?? null,
        updatedAt: checkpoint.updatedAt,
    });
}

export function assertBatchInput(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, authority: StoreAuthority, batch: LingxingReportBatch): void {
    requiredText(batch.id, 'batch.id');
    const existing = repositoryContext.db.prepare(`
      SELECT store_id AS storeId, store_name AS storeName
      FROM lingxing_report_batches
      WHERE id = ?
    `).get(batch.id) as {
        storeId?: string | null;
        storeName?: string | null;
    } | undefined;
    if (existing && existing.storeId !== storeId) {
        throw new Error(`领星批次 ${batch.id} 已属于其他店铺或尚未完成归属确认。`);
    }
    if (batch.storeId && String(batch.storeId) !== String(storeId)) {
        throw new Error('领星批次 storeId 与当前权威店铺不一致。');
    }
    if (batch.browserProfileId && String(batch.browserProfileId) !== authority.browserProfileId) {
        throw new Error('领星批次 browserProfileId 与当前权威店铺不一致。');
    }
    if (batch.sessionGeneration !== undefined
        && (!Number.isSafeInteger(Number(batch.sessionGeneration)) || Number(batch.sessionGeneration) < 0)) {
        throw new Error('领星批次 sessionGeneration 无效。');
    }
    const submittedStoreName = batch.storeName ?? null;
    if (existing) {
        if ((existing.storeName ?? null) !== submittedStoreName) {
            throw new Error('LINGXING_BATCH_AUTHORITY_IMMUTABLE: 既有批次的外部店铺名称快照不可改写。');
        }
    }
    else if (submittedStoreName !== null) {
        const normalizedSubmitted = normalizeBatchStoreName(submittedStoreName, '领星批次 storeName');
        const allowedNames = [
            authority.displayName,
            authority.lingxingCollectionStoreName,
        ].filter((value): value is string => Boolean(value))
            .map((value) => normalizeBatchStoreName(value, '店铺权威名称'));
        if (!allowedNames.includes(normalizedSubmitted)) {
            throw new Error('领星批次店铺名称既不匹配当前 collection selector，也不匹配本地逻辑店铺名。');
        }
    }
    if (batch.marketplaceCode && batch.marketplaceCode.trim().toUpperCase() !== authority.marketplace) {
        throw new Error('领星批次站点与 store_id 的权威记录不一致。');
    }
}

export function upsertBatchRow(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, batch: LingxingReportBatch): void {
    const existing = repositoryContext.db.prepare(`
      SELECT store_id AS storeId,
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
             completed_at AS completedAt,
             EXISTS(
               SELECT 1 FROM report_import_runs AS run
               WHERE run.store_id = lingxing_report_batches.store_id
                 AND run.batch_id = lingxing_report_batches.id
             ) AS hasCommittedImport
      FROM lingxing_report_batches
      WHERE id = ?
    `).get(batch.id) as {
        storeId?: string | null;
        requestId?: string | null;
        browserProfileId?: string | null;
        businessDate?: string | null;
        sessionGeneration?: number | null;
        appVersion?: string | null;
        dateStart: string;
        dateEnd: string;
        storeName?: string | null;
        marketplaceCode?: string | null;
        status: string;
        downloadDir: string;
        manifestPath?: string | null;
        createdAt: string;
        completedAt?: string | null;
        hasCommittedImport: number;
    } | undefined;
    if (existing && existing.storeId !== storeId) {
        throw new Error(`领星批次 ${batch.id} 已属于其他店铺或尚未完成归属确认。`);
    }
    const next = {
        requestId: batch.requestId ?? null,
        browserProfileId: batch.browserProfileId ?? null,
        businessDate: batch.businessDate ?? null,
        sessionGeneration: batch.sessionGeneration ?? null,
        appVersion: batch.appVersion ?? null,
        dateStart: batch.dateStart,
        dateEnd: batch.dateEnd,
        storeName: batch.storeName ?? null,
        marketplaceCode: batch.marketplaceCode ?? 'US',
        status: batch.status,
        downloadDir: batch.downloadDir,
        manifestPath: batch.manifestPath ?? null,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt ?? null,
    };
    if (existing && (existing.dateStart !== next.dateStart
        || existing.dateEnd !== next.dateEnd
        || existing.createdAt !== next.createdAt
        || existing.marketplaceCode !== next.marketplaceCode
        || existing.storeName !== next.storeName
        || (existing.requestId !== null && existing.requestId !== next.requestId)
        || (existing.browserProfileId !== null
            && existing.browserProfileId !== next.browserProfileId)
        || (existing.businessDate !== null && existing.businessDate !== next.businessDate)
        || (existing.sessionGeneration !== null
            && existing.sessionGeneration !== next.sessionGeneration))) {
        throw new Error('LINGXING_BATCH_AUTHORITY_IMMUTABLE: 既有批次的日期窗口或 Store/Profile 核心身份不可改写。');
    }
    if (existing?.hasCommittedImport === 1 && (existing.requestId !== next.requestId
        || existing.browserProfileId !== next.browserProfileId
        || existing.businessDate !== next.businessDate
        || existing.sessionGeneration !== next.sessionGeneration
        || existing.appVersion !== next.appVersion
        || existing.storeName !== next.storeName
        || existing.status !== next.status
        || existing.downloadDir !== next.downloadDir
        || existing.manifestPath !== next.manifestPath
        || existing.completedAt !== next.completedAt)) {
        throw new Error('IMPORTED_BATCH_AUTHORITY_IMMUTABLE: 已提交导入证据的批次身份与来源元数据不可改写。');
    }
    repositoryContext.db.prepare(`
      INSERT INTO lingxing_report_batches (
        id, request_id, browser_profile_id, business_date, session_generation,
        app_version, date_start, date_end, store_name, marketplace_code,
        status, download_dir, manifest_path, created_at, completed_at, store_id
      ) VALUES (
        @id, @requestId, @browserProfileId, @businessDate, @sessionGeneration,
        @appVersion, @dateStart, @dateEnd, @storeName, @marketplaceCode,
        @status, @downloadDir, @manifestPath, @createdAt, @completedAt, @storeId
      )
      ON CONFLICT(id) DO UPDATE SET
        request_id = excluded.request_id,
        browser_profile_id = excluded.browser_profile_id,
        business_date = excluded.business_date,
        session_generation = excluded.session_generation,
        app_version = excluded.app_version,
        date_start = excluded.date_start,
        date_end = excluded.date_end,
        store_name = excluded.store_name,
        marketplace_code = excluded.marketplace_code,
        status = excluded.status,
        download_dir = excluded.download_dir,
        manifest_path = excluded.manifest_path,
        completed_at = excluded.completed_at
      WHERE lingxing_report_batches.store_id = excluded.store_id
    `).run({
        id: batch.id,
        ...next,
        storeId,
    });
}

export function upsertLingxingFileRow(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, file: LingxingReportFile): void {
    const existing = repositoryContext.db.prepare(`
      SELECT store_id AS storeId FROM lingxing_report_files WHERE id = ?
    `).get(file.id) as {
        storeId?: string | null;
    } | undefined;
    if (existing && existing.storeId !== storeId) {
        throw new Error(`领星文件 ${file.id} 已属于其他店铺或尚未完成归属确认。`);
    }
    repositoryContext.methods.assertBatchOwnership(storeId, file.batchId);
    repositoryContext.db.prepare(`
      INSERT INTO lingxing_report_files (
        id, batch_id, report_type, display_name, status,
        max_auto_retries, auto_retry_count, file_path, file_size_bytes,
        error_message, attempt_errors_json, failure_screenshot_path,
        failure_dom_snapshot_path, failure_trace_path, trace_unavailable_reason,
        created_at, updated_at, store_id
      ) VALUES (
        @id, @batchId, @reportType, @displayName, @status,
        @maxAutoRetries, @autoRetryCount, @filePath, @fileSizeBytes,
        @errorMessage, @attemptErrorsJson, @failureScreenshotPath,
        @failureDomSnapshotPath, @failureTracePath, @traceUnavailableReason,
        @createdAt, @updatedAt, @storeId
      )
      ON CONFLICT(id) DO UPDATE SET
        report_type = excluded.report_type,
        display_name = excluded.display_name,
        status = excluded.status,
        max_auto_retries = excluded.max_auto_retries,
        auto_retry_count = excluded.auto_retry_count,
        file_path = excluded.file_path,
        file_size_bytes = excluded.file_size_bytes,
        error_message = excluded.error_message,
        attempt_errors_json = excluded.attempt_errors_json,
        failure_screenshot_path = excluded.failure_screenshot_path,
        failure_dom_snapshot_path = excluded.failure_dom_snapshot_path,
        failure_trace_path = excluded.failure_trace_path,
        trace_unavailable_reason = excluded.trace_unavailable_reason,
        updated_at = excluded.updated_at
      WHERE lingxing_report_files.store_id = excluded.store_id
        AND lingxing_report_files.batch_id = excluded.batch_id
    `).run({
        id: file.id,
        batchId: file.batchId,
        reportType: file.reportType,
        displayName: file.displayName,
        status: file.status,
        maxAutoRetries: file.maxAutoRetries ?? 2,
        autoRetryCount: file.autoRetryCount ?? 0,
        filePath: file.filePath ?? null,
        fileSizeBytes: file.fileSizeBytes ?? 0,
        errorMessage: file.errorMessage ?? null,
        attemptErrorsJson: JSON.stringify(file.attemptErrors ?? []),
        failureScreenshotPath: file.failureScreenshotPath ?? null,
        failureDomSnapshotPath: file.failureDomSnapshotPath ?? null,
        failureTracePath: file.failureTracePath ?? null,
        traceUnavailableReason: file.traceUnavailableReason ?? null,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        storeId,
    });
}

export function upsertReportFileRow(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, batchId: string, file: ReportImportFileInput, importedAt: string): number {
    validateImportFile(file);
    const existing = repositoryContext.db.prepare(`
      SELECT id, store_id AS storeId FROM report_files
      WHERE batch_id = ? AND report_type = ? AND file_path = ?
    `).get(batchId, file.reportType, file.filePath) as {
        id: number;
        storeId?: string | null;
    } | undefined;
    if (existing && existing.storeId !== storeId) {
        throw new Error('报表文件身份已属于其他店铺或尚未完成归属确认。');
    }
    if (existing) {
        repositoryContext.db.prepare(`
        UPDATE report_files
        SET file_name = @fileName, file_size = @fileSizeBytes,
            status = 'imported', imported_rows = @importedRows,
            file_hash = @fileHash, import_error = NULL,
            last_imported_at = @importedAt, updated_at = @importedAt
        WHERE id = @id AND store_id = @storeId
      `).run({ ...file, id: existing.id, storeId, importedAt });
        return existing.id;
    }
    const result = repositoryContext.db.prepare(`
      INSERT INTO report_files (
        store_id, batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, import_error, last_imported_at,
        created_at, updated_at
      ) VALUES (
        @storeId, @batchId, @reportType, @filePath, @fileName, @fileSizeBytes,
        'imported', @importedRows, @fileHash, NULL, @importedAt,
        @importedAt, @importedAt
      )
    `).run({ ...file, storeId, batchId, importedAt });
    return Number(result.lastInsertRowid);
}

export function insertMetricRow(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, authority: StoreAuthority, batchId: string, batchStoreName: string | null, metric: AdDailyMetrics): void {
    const expectedStoreName = batchStoreName ?? authority.displayName;
    if (metric.batchId !== batchId)
        throw new Error('广告指标 batchId 与导入运行批次不一致。');
    if (normalizeBatchStoreName(metric.storeName, '广告指标 storeName')
        !== normalizeBatchStoreName(expectedStoreName, '批次 storeName')
        || metric.marketplaceCode.trim().toUpperCase() !== authority.marketplace
        || String(metric.currency ?? 'USD').trim().toUpperCase() !== authority.currency)
        throw new Error('指标店铺标识与 store_id 绑定批次的权威记录不一致。');
    for (const [label, value] of [
        ['impressions', metric.impressions],
        ['clicks', metric.clicks],
        ['cost', metric.cost],
        ['orders', metric.orders],
        ['sales', metric.sales],
    ] as const) {
        if (!Number.isFinite(value) || value < 0)
            throw new Error(`广告指标 ${label} 无效。`);
    }
    const params = metricParams(storeId, metric);
    repositoryContext.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE store_id = @storeId
        AND COALESCE(batch_id, '') = COALESCE(@batchId, '')
        AND COALESCE(report_type, '') = COALESCE(@reportType, '')
        AND COALESCE(date, '') = COALESCE(@date, '')
        AND COALESCE(asin, '') = COALESCE(@asin, '')
        AND COALESCE(msku, '') = COALESCE(@msku, '')
        AND COALESCE(campaign_name, '') = COALESCE(@campaignName, '')
        AND COALESCE(ad_group_name, '') = COALESCE(@adGroupName, '')
        AND COALESCE(targeting, '') = COALESCE(@targeting, '')
        AND COALESCE(search_term, '') = COALESCE(@searchTerm, '')
        AND COALESCE(match_type, '') = COALESCE(@matchType, '')
        AND COALESCE(source_file, '') = COALESCE(@sourceFile, '')
        AND COALESCE(source_row, -1) = COALESCE(@sourceRow, -1)
    `).run(params);
    repositoryContext.db.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, portfolio_name,
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, currency,
        acos, cpc, cvr, source_file, source_row
      ) VALUES (
        @storeId, @batchId, @reportType, @portfolioName,
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, 'USD',
        @acos, @cpc, @cvr, @sourceFile, @sourceRow
      )
    `).run(params);
}

export function assertBatchOwnership(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, batchId: string): {
    dateStart: string;
    dateEnd: string;
    storeName: string | null;
} {
    const row = repositoryContext.db.prepare(`
      SELECT store_id AS storeId, date_start AS dateStart, date_end AS dateEnd,
             store_name AS storeName
      FROM lingxing_report_batches
      WHERE id = ?
    `).get(batchId) as {
        storeId?: string | null;
        dateStart?: string | null;
        dateEnd?: string | null;
        storeName?: string | null;
    } | undefined;
    if (!row || row.storeId !== storeId)
        throw new Error(`报表批次 ${batchId} 不属于店铺 ${storeId}。`);
    const dateStart = canonicalIsoDate(row.dateStart, '批次 dateStart');
    const dateEnd = canonicalIsoDate(row.dateEnd, '批次 dateEnd');
    if (dateStart > dateEnd)
        throw new Error('报表批次日期窗口无效。');
    return { dateStart, dateEnd, storeName: row.storeName ?? null };
}

export function findExistingRun(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, runId: string, idempotencyKey: string): ReportImportRunRecord | undefined {
    const row = repositoryContext.db.prepare(`
      SELECT * FROM report_import_runs
      WHERE store_id = ? AND (run_id = ? OR idempotency_key = ?)
      ORDER BY CASE WHEN run_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(storeId, runId, idempotencyKey, runId);
    return row ? mapRun(row, storeId) : undefined;
}

export function resolveDuplicate(repositoryContext: LingxingImportRepositoryContext, existing: ReportImportRunRecord, input: CommitReportImportInput, fingerprint: string): ReportImportCommitResult {
    if (existing.inputFingerprint !== fingerprint) {
        throw new Error('导入 runId 或幂等键已绑定不同输入，拒绝覆盖不可变历史。');
    }
    if (existing.idempotencyKey === input.idempotencyKey) {
        return { run: existing, deduplicated: true };
    }
    if (existing.runId === input.runId) {
        throw new Error('导入 runId 已绑定不同幂等键，拒绝覆盖不可变历史。');
    }
    return { run: existing, deduplicated: true };
}
