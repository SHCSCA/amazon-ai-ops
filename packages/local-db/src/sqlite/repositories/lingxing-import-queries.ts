import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type StoreScopedLingxingReportBatch, type ReportImportRunRecord, type ReportImportFileSnapshotRecord, type StoreScopedImportedReportFile, type StoreScopedImportedAdMetric, type ReportImportReconciliationRecord } from './lingxing-import-contracts';
import { boundedPositiveInteger } from './lingxing-import-values';
import { mapBatch, mapRun, mapFileSnapshot, mapReconciliation } from './lingxing-import-records';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function listBatchesForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, limit = 100): StoreScopedLingxingReportBatch[] {
    const boundedLimit = boundedPositiveInteger(limit, 100, 1000);
    return repositoryContext.db.prepare(`
      SELECT * FROM lingxing_report_batches
      WHERE store_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(storeId, boundedLimit).map((row) => mapBatch(row, storeId));
}

export function getImportRunForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, runId: string): ReportImportRunRecord | undefined {
    const row = repositoryContext.db.prepare(`
      SELECT * FROM report_import_runs WHERE store_id = ? AND run_id = ?
    `).get(storeId, runId);
    return row ? mapRun(row, storeId) : undefined;
}

export function listImportRunsForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, limit = 100): ReportImportRunRecord[] {
    const boundedLimit = boundedPositiveInteger(limit, 100, 1000);
    return repositoryContext.db.prepare(`
      SELECT * FROM report_import_runs
      WHERE store_id = ?
      ORDER BY completed_at DESC, run_id DESC
      LIMIT ?
    `).all(storeId, boundedLimit).map((row) => mapRun(row, storeId));
}

export function listFileSnapshotsForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, runId: string): ReportImportFileSnapshotRecord[] {
    return repositoryContext.db.prepare(`
      SELECT * FROM report_import_file_snapshots
      WHERE store_id = ? AND run_id = ?
      ORDER BY report_type, file_path, snapshot_id
    `).all(storeId, runId).map((row) => mapFileSnapshot(row, storeId));
}

export function listReportFilesForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, batchId: string): StoreScopedImportedReportFile[] {
    return repositoryContext.db.prepare(`
      SELECT * FROM report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, file_path, id
    `).all(storeId, batchId).map((row: any) => ({
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
    }));
}

export function listAdMetricsForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, batchId: string): StoreScopedImportedAdMetric[] {
    return repositoryContext.db.prepare(`
      SELECT * FROM ad_daily_metrics
      WHERE store_id = ? AND batch_id = ?
      ORDER BY date, report_type, source_file, source_row, id
    `).all(storeId, batchId).map((row: any) => ({
        id: row.id,
        storeId,
        batchId: row.batch_id,
        reportType: row.report_type ?? undefined,
        portfolioName: row.portfolio_name ?? undefined,
        date: row.date,
        storeName: row.store_name,
        marketplaceCode: row.marketplace_code,
        asin: row.asin,
        sourceAsin: row.source_asin ?? undefined,
      sourceMetricMask: row.source_metric_mask ?? undefined,
        msku: row.msku,
        campaignName: row.campaign_name,
        adGroupName: row.ad_group_name,
        targeting: row.targeting,
        searchTerm: row.search_term,
        matchType: row.match_type,
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
        orders: row.orders,
        sales: row.sales,
        currency: row.currency ?? 'USD',
        acos: row.acos,
        cpc: row.cpc,
        cvr: row.cvr,
        sourceFile: row.source_file,
        sourceRow: row.source_row ?? undefined,
        createdAt: row.created_at,
    }));
}

export function listReconciliationsForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, runId: string): ReportImportReconciliationRecord[] {
    return repositoryContext.db.prepare(`
      SELECT reconciliation.*,
             batch.date_start AS reconciliation_date_start,
             batch.date_end AS reconciliation_date_end
      FROM report_import_reconciliations AS reconciliation
      INNER JOIN lingxing_report_batches AS batch
        ON batch.store_id = reconciliation.store_id
       AND batch.id = reconciliation.batch_id
      WHERE reconciliation.store_id = ? AND reconciliation.run_id = ?
      ORDER BY reconciliation.metric_date,
               reconciliation.report_type,
               reconciliation.reconciliation_id
    `).all(storeId, runId).map((row) => mapReconciliation(row, storeId));
}
