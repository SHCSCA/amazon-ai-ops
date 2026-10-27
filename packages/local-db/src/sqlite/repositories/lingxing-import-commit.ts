import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { hashCanonicalMetrics, readCanonicalMetrics, } from '../migrations/0010-collection-resume-authority';
import { type CommitReportImportInput, type ReportImportCommitResult } from './lingxing-import-contracts';
import { normalizeCommitInput, importFingerprint, metricIdentity, assertExactReportImportCoverage } from './lingxing-import-metrics';
import { stableId, reconcileUsdAmount } from './lingxing-import-values';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function commitImportForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: CommitReportImportInput): ReportImportCommitResult {
    const normalizedInput = normalizeCommitInput(input);
    const fingerprint = importFingerprint(normalizedInput);
    const existing = repositoryContext.methods.findExistingRun(storeId, normalizedInput.runId, normalizedInput.idempotencyKey);
    if (existing)
        return repositoryContext.methods.resolveDuplicate(existing, normalizedInput, fingerprint);
    const commit = repositoryContext.db.transaction((): ReportImportCommitResult => {
        const duplicate = repositoryContext.methods.findExistingRun(storeId, normalizedInput.runId, normalizedInput.idempotencyKey);
        if (duplicate)
            return repositoryContext.methods.resolveDuplicate(duplicate, normalizedInput, fingerprint);
        const authority = repositoryContext.methods.getWritableStoreAuthority(storeId);
        const batchWindow = repositoryContext.methods.assertBatchOwnership(storeId, normalizedInput.batchId);
        for (const reconciliation of normalizedInput.reconciliations) {
            if (reconciliation.dateStart !== batchWindow.dateStart
                || reconciliation.dateEnd !== batchWindow.dateEnd
                || reconciliation.metricDate !== batchWindow.dateEnd) {
                throw new Error('IMPORT_RECONCILIATION_WINDOW_MISMATCH: control-total 必须严格绑定批次完整日期窗口，'
                    + '且兼容字段 metricDate 必须等于 dateEnd。');
            }
        }
        const now = new Date().toISOString();
        const startedAt = normalizedInput.startedAt ?? now;
        const completedAt = normalizedInput.completedAt
            ?? (Date.parse(now) >= Date.parse(startedAt) ? now : startedAt);
        const createdAt = Date.parse(now) >= Date.parse(completedAt) ? now : completedAt;
        if (Date.parse(startedAt) > Date.parse(completedAt)
            || Date.parse(completedAt) > Date.parse(createdAt)) {
            throw new Error('IMPORT_RUN_TIMELINE_INVALID: 必须满足 startedAt <= completedAt <= createdAt。');
        }
        repositoryContext.db.prepare(`
        INSERT INTO report_import_runs (
          store_id, run_id, idempotency_key, input_fingerprint, batch_id,
          status, source_file_count, metric_row_count, reconciliation_count,
          started_at, completed_at, created_at
        ) VALUES (
          @storeId, @runId, @idempotencyKey, @inputFingerprint, @batchId,
          'completed', @sourceFileCount, @metricRowCount, @reconciliationCount,
          @startedAt, @completedAt, @createdAt
        )
      `).run({
            storeId,
            runId: normalizedInput.runId,
            idempotencyKey: normalizedInput.idempotencyKey,
            inputFingerprint: fingerprint,
            batchId: normalizedInput.batchId,
            sourceFileCount: normalizedInput.files.length,
            metricRowCount: normalizedInput.metrics.length,
            reconciliationCount: normalizedInput.reconciliations.length,
            startedAt,
            completedAt,
            createdAt,
        });
        normalizedInput.files.forEach((file, index) => {
            const reportFileId = repositoryContext.methods.upsertReportFileRow(storeId, normalizedInput.batchId, file, completedAt);
            if (file.lingxingFileId) {
                const liveFile = repositoryContext.db.prepare(`
            SELECT 1 FROM lingxing_report_files
            WHERE store_id = ? AND batch_id = ? AND id = ?
          `).get(storeId, normalizedInput.batchId, file.lingxingFileId);
                if (!liveFile)
                    throw new Error(`领星文件 ${file.lingxingFileId} 不属于当前店铺批次。`);
            }
            const snapshotId = stableId('file', storeId, normalizedInput.runId, String(index), file.fileHash);
            repositoryContext.db.prepare(`
          INSERT INTO report_import_file_snapshots (
            store_id, snapshot_id, run_id, batch_id, lingxing_file_id, report_file_id,
            report_type, file_path, file_name, file_size_bytes, file_hash,
            imported_rows, captured_at
          ) VALUES (
            @storeId, @snapshotId, @runId, @batchId, @lingxingFileId, @reportFileId,
            @reportType, @filePath, @fileName, @fileSizeBytes, @fileHash,
            @importedRows, @capturedAt
          )
        `).run({
                ...file,
                storeId,
                snapshotId,
                runId: normalizedInput.runId,
                batchId: normalizedInput.batchId,
                reportFileId,
                capturedAt: completedAt,
            });
        });
        const metricIdentities = new Set<string>();
        for (const metric of normalizedInput.metrics) {
            if (metric.date < batchWindow.dateStart || metric.date > batchWindow.dateEnd) {
                throw new Error('广告指标日期超出导入批次授权窗口。');
            }
            const identity = metricIdentity(metric);
            if (metricIdentities.has(identity)) {
                throw new Error('同一导入运行包含重复的广告指标数据粒度，拒绝覆盖后伪造行数。');
            }
            metricIdentities.add(identity);
            repositoryContext.methods.insertMetricRow(storeId, authority, normalizedInput.batchId, batchWindow.storeName, metric);
        }
        assertExactReportImportCoverage(normalizedInput);
        const committedMetrics = readCanonicalMetrics(repositoryContext.db, storeId, normalizedInput.batchId);
        const expectedMetricPayloadSha256 = hashCanonicalMetrics(normalizedInput.metrics);
        const committedMetricPayloadSha256 = hashCanonicalMetrics(committedMetrics);
        if (committedMetrics.length !== normalizedInput.metrics.length
            || committedMetricPayloadSha256 !== expectedMetricPayloadSha256) {
            throw new Error('IMPORT_METRIC_EVIDENCE_MISMATCH: 当前批次广告指标与规范化导入载荷不一致。');
        }
        repositoryContext.db.prepare(`
        INSERT INTO report_import_metric_evidence (
          store_id, run_id, batch_id, row_count, payload_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(storeId, normalizedInput.runId, normalizedInput.batchId, committedMetrics.length, committedMetricPayloadSha256, completedAt);
        normalizedInput.reconciliations.forEach((reconciliation, index) => {
            const actualMetrics = normalizedInput.metrics.filter((metric) => (metric.date >= reconciliation.dateStart
                && metric.date <= reconciliation.dateEnd
                && String(metric.reportType ?? '') === reconciliation.reportType));
            const amount = reconcileUsdAmount(reconciliation.expectedCost, actualMetrics.reduce((sum, metric) => sum + metric.cost, 0), reconciliation.tolerance);
            const rowsMatch = reconciliation.expectedRows === actualMetrics.length;
            const withinTolerance = rowsMatch && amount.withinTolerance;
            if (!withinTolerance) {
                throw new Error(`IMPORT_RECONCILIATION_MISMATCH ${reconciliation.dateStart}..${reconciliation.dateEnd} `
                    + `${reconciliation.reportType}: `
                    + `rows ${actualMetrics.length}/${reconciliation.expectedRows}, `
                    + `cost delta ${(amount.absoluteDelta1e4 / 10000).toFixed(4)} USD `
                    + `exceeds ${(amount.tolerance1e4 / 10000).toFixed(4)} USD.`);
            }
            repositoryContext.db.prepare(`
          INSERT INTO report_import_reconciliations (
            store_id, reconciliation_id, run_id, batch_id, metric_date,
            report_type, currency, expected_rows, actual_rows,
            expected_cost_1e4, actual_cost_1e4, absolute_cost_delta_1e4,
            tolerance_1e4, within_tolerance, status, reconciled_at
          ) VALUES (
            @storeId, @reconciliationId, @runId, @batchId, @metricDate,
            @reportType, 'USD', @expectedRows, @actualRows,
            @expectedCost1e4, @actualCost1e4, @absoluteCostDelta1e4,
            @tolerance1e4, @withinTolerance, @status, @reconciledAt
          )
        `).run({
                storeId,
                reconciliationId: stableId('reconcile', storeId, normalizedInput.runId, String(index)),
                runId: normalizedInput.runId,
                batchId: normalizedInput.batchId,
                metricDate: reconciliation.metricDate,
                reportType: reconciliation.reportType,
                expectedRows: reconciliation.expectedRows,
                actualRows: actualMetrics.length,
                expectedCost1e4: amount.expectedAmount1e4,
                actualCost1e4: amount.actualAmount1e4,
                absoluteCostDelta1e4: amount.absoluteDelta1e4,
                tolerance1e4: amount.tolerance1e4,
                withinTolerance: 1,
                status: 'matched',
                reconciledAt: completedAt,
            });
        });
        const run = repositoryContext.methods.getImportRunForStore(storeId, normalizedInput.runId);
        if (!run)
            throw new Error('导入事务提交前无法回读不可变运行记录。');
        return { run, deduplicated: false };
    });
    return commit.immediate();
}
