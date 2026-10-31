import { loadAdObservedSnapshot } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ad-observed-snapshot';
import { buildAdProductObservedLedger } from './ad-product-observed-ledger';
import { mapBusinessAdMetricRow } from './business-metric-projection';
import { buildProductHistoryObservation, type ProductHistoryObservationScope } from './ad-product-history-observation';
import type { BusinessMetricSource } from './main-runtime-contracts';
import type Database from 'better-sqlite3';

export function loadProductHistoryObservation(
  db: Database.Database | undefined | null,
  scope: ProductHistoryObservationScope,
  source?: BusinessMetricSource,
  limit = 5000,
) {
  const sourceFiles = [...new Set(source?.sourceFiles.filter(Boolean) || [])];
  const batchIds = [...new Set(source?.batchIds?.filter(Boolean) || (source?.batchId ? [source.batchId] : []))];
  const sourceBound = Boolean(scope.storeId && sourceFiles.length && batchIds.length);
  if (!db || !sourceBound) return buildProductHistoryObservation(scope, [], { truncated: false, sourceBound: false });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('产品历史观察行数上限无效。');
  const asinSql = scope.asin ? "AND upper(COALESCE(asin, '')) = upper(?)" : '';
  const rows = db.prepare(`
    SELECT * FROM ad_daily_metrics
    WHERE store_id = ? AND marketplace_code = ? AND date >= ? AND date <= ?
      AND batch_id IN (${batchIds.map(() => '?').join(', ')})
      AND source_file IN (${sourceFiles.map(() => '?').join(', ')})
      ${asinSql}
    ORDER BY date, asin, report_type, batch_id, source_file, source_row, id
    LIMIT ?
  `).all(scope.storeId, scope.marketplaceCode, scope.dateFrom, scope.dateTo,
    ...batchIds, ...sourceFiles, ...(scope.asin ? [scope.asin] : []), limit + 1) as Array<Record<string, unknown>>;
  const quality = buildProductHistoryObservation(scope,
    rows.slice(0, limit).map((row) => ({ ...mapBusinessAdMetricRow(row), storeId: String(row.store_id || '') })),
    { truncated: rows.length > limit, sourceBound });
  quality.observedLedger = buildAdProductObservedLedger(scope, loadAdObservedSnapshot(db, {
    ...scope, batchIds, sourceFiles,
  }, limit));
  return quality;
}
