import { createHash, randomBytes } from 'crypto';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type CommitReportImportInput, type ReportImportFileInput, type ReportImportReconciliationInput } from './lingxing-import-contracts';
import { requiredText, canonicalIsoDate, canonicalUtcInstant, compareByStableJson, stableJson } from './lingxing-import-values';

export function normalizeCommitInput(input: CommitReportImportInput): CommitReportImportInput {
    const runId = requiredText(input.runId, 'runId');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
    const batchId = requiredText(input.batchId, 'batchId');
    const files = input.files.map((file) => ({
        ...file,
        lingxingFileId: file.lingxingFileId ? requiredText(file.lingxingFileId, 'lingxingFileId') : undefined,
        reportType: requiredText(file.reportType, 'reportType'),
        filePath: requiredText(file.filePath, 'filePath'),
        fileName: requiredText(file.fileName, 'fileName'),
        fileHash: requiredText(file.fileHash, 'fileHash').toLowerCase(),
    }));
    const reconciliations = input.reconciliations.map((reconciliation) => ({
        ...reconciliation,
        dateStart: canonicalIsoDate(reconciliation.dateStart, 'reconciliation.dateStart'),
        dateEnd: canonicalIsoDate(reconciliation.dateEnd, 'reconciliation.dateEnd'),
        metricDate: canonicalIsoDate(reconciliation.metricDate, 'reconciliation.metricDate'),
        reportType: requiredText(reconciliation.reportType, 'reportType'),
        tolerance: reconciliation.tolerance ?? 0.01,
    }));
    const startedAt = input.startedAt === undefined
        ? undefined
        : canonicalUtcInstant(input.startedAt, 'startedAt');
    const completedAt = input.completedAt === undefined
        ? undefined
        : canonicalUtcInstant(input.completedAt, 'completedAt');
    if (startedAt !== undefined
        && completedAt !== undefined
        && Date.parse(startedAt) > Date.parse(completedAt)) {
        throw new Error('IMPORT_RUN_TIMELINE_INVALID: completedAt 不能早于 startedAt。');
    }
    return {
        ...input,
        runId,
        idempotencyKey,
        batchId,
        files,
        metrics: input.metrics.map(normalizeMetricForImport),
        reconciliations,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(completedAt === undefined ? {} : { completedAt }),
    };
}

export function assertExactReportImportCoverage(input: CommitReportImportInput): void {
    const filesByType = new Map<string, ReportImportFileInput>();
    for (const file of input.files) {
        if (filesByType.has(file.reportType)) {
            throw new Error(`IMPORT_REPORT_TYPE_NOT_UNIQUE: report file ${file.reportType} 在同一运行中重复。`);
        }
        filesByType.set(file.reportType, file);
    }
    const reconciliationsByType = new Map<string, ReportImportReconciliationInput>();
    for (const reconciliation of input.reconciliations) {
        if (!Number.isSafeInteger(reconciliation.expectedRows) || reconciliation.expectedRows < 0) {
            throw new Error(`IMPORT_RECONCILIATION_MISMATCH: ${reconciliation.reportType} expectedRows 必须是非负安全整数。`);
        }
        if (reconciliationsByType.has(reconciliation.reportType)) {
            throw new Error(`IMPORT_REPORT_TYPE_NOT_UNIQUE: reconciliation ${reconciliation.reportType} 在同一运行中重复。`);
        }
        reconciliationsByType.set(reconciliation.reportType, reconciliation);
    }
    if (filesByType.size !== reconciliationsByType.size
        || [...filesByType.keys()].some((reportType) => !reconciliationsByType.has(reportType))) {
        throw new Error('IMPORT_REPORT_COVERAGE_MISMATCH: 每种报表必须唯一对应一个文件和一条 reconciliation。');
    }
    const metricRowsByType = new Map<string, number>();
    for (const metric of input.metrics) {
        const reportType = requiredText(metric.reportType, 'metric.reportType');
        if (!reconciliationsByType.has(reportType)) {
            throw new Error(`IMPORT_METRIC_REPORT_TYPE_UNCOVERED: 指标 reportType ${reportType} 没有唯一 reconciliation。`);
        }
        metricRowsByType.set(reportType, (metricRowsByType.get(reportType) ?? 0) + 1);
    }
    let coveredMetricRows = 0;
    for (const [reportType, reconciliation] of reconciliationsByType) {
        const file = filesByType.get(reportType)!;
        const actualRows = metricRowsByType.get(reportType) ?? 0;
        if (actualRows !== file.importedRows || actualRows !== reconciliation.expectedRows) {
            throw new Error(`IMPORT_RECONCILIATION_MISMATCH IMPORT_REPORT_ROW_COUNT_MISMATCH ${reportType}: `
                + `metrics ${actualRows}, file ${file.importedRows}, reconciliation ${reconciliation.expectedRows}。`);
        }
        coveredMetricRows += actualRows;
    }
    if (!Number.isSafeInteger(coveredMetricRows) || coveredMetricRows !== input.metrics.length) {
        throw new Error(`IMPORT_METRIC_ROW_TOTAL_MISMATCH: metrics ${input.metrics.length}, covered ${coveredMetricRows}。`);
    }
}

export function validateImportFile(file: ReportImportFileInput): void {
    if (!Number.isSafeInteger(file.fileSizeBytes) || file.fileSizeBytes < 0) {
        throw new Error('报表文件大小必须是非负安全整数。');
    }
    if (!Number.isSafeInteger(file.importedRows) || file.importedRows < 0) {
        throw new Error('报表导入行数必须是非负安全整数。');
    }
}

export function normalizeMetricForImport(metric: AdDailyMetrics): AdDailyMetrics {
    return {
        batchId: metric.batchId,
        reportType: metric.reportType,
        portfolioName: metric.portfolioName,
        date: canonicalIsoDate(metric.date, 'metric.date'),
        storeName: metric.storeName,
        marketplaceCode: metric.marketplaceCode,
        asin: metric.asin,
        msku: metric.msku,
        campaignName: metric.campaignName,
        adGroupName: metric.adGroupName,
        targeting: metric.targeting,
        searchTerm: metric.searchTerm,
        matchType: metric.matchType,
        impressions: metric.impressions,
        clicks: metric.clicks,
        cost: metric.cost,
        orders: metric.orders,
        sales: metric.sales,
        currency: metric.currency ?? 'USD',
        acos: metric.acos,
        cpc: metric.cpc,
        cvr: metric.cvr,
        sourceFile: metric.sourceFile,
        sourceRow: metric.sourceRow,
    };
}

export function importFingerprint(input: CommitReportImportInput): string {
    const payload = {
        batchId: input.batchId,
        files: [...input.files].sort(compareByStableJson),
        metrics: [...input.metrics].sort(compareByStableJson),
        reconciliations: [...input.reconciliations].sort(compareByStableJson),
    };
    return createHash('sha256').update(stableJson(payload)).digest('hex');
}

export function metricParams(storeId: StoreId, metric: AdDailyMetrics): Record<string, unknown> {
    return {
        storeId,
        batchId: metric.batchId ?? null,
        reportType: metric.reportType ?? null,
        portfolioName: metric.portfolioName ?? null,
        date: metric.date,
        storeName: metric.storeName,
        marketplaceCode: metric.marketplaceCode,
        asin: metric.asin,
        msku: metric.msku,
        campaignName: metric.campaignName,
        adGroupName: metric.adGroupName,
        targeting: metric.targeting,
        searchTerm: metric.searchTerm,
        matchType: metric.matchType,
        impressions: metric.impressions,
        clicks: metric.clicks,
        cost: metric.cost,
        orders: metric.orders,
        sales: metric.sales,
        acos: metric.acos,
        cpc: metric.cpc,
        cvr: metric.cvr,
        sourceFile: metric.sourceFile,
        sourceRow: metric.sourceRow ?? null,
    };
}

export function metricIdentity(metric: AdDailyMetrics): string {
    return stableJson([
        metric.batchId ?? '',
        metric.reportType ?? '',
        metric.date,
        metric.asin,
        metric.msku,
        metric.campaignName,
        metric.adGroupName,
        metric.targeting,
        metric.searchTerm,
        metric.matchType,
        metric.sourceFile,
        metric.sourceRow ?? -1,
    ]);
}
