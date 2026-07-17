import type Database from 'better-sqlite3';

export interface BusinessReportImportCoverageScope {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
}

export function countImportedRowsForReportFile(
  db: Database.Database,
  input: {
    scope: BusinessReportImportCoverageScope;
    sourceFiles: string[];
    batchId?: string;
  },
): number {
  const sourceFiles = Array.from(new Set(input.sourceFiles.filter(Boolean)));
  if (sourceFiles.length === 0) return 0;

  let sql = `
    date >= ?
    AND date <= ?
    AND COALESCE(store_name, '') = COALESCE(?, '')
    AND COALESCE(marketplace_code, '') = COALESCE(?, '')
    AND source_file IN (${sourceFiles.map(() => '?').join(', ')})
  `;
  const params: string[] = [
    input.scope.dateFrom,
    input.scope.dateTo,
    input.scope.storeName,
    input.scope.marketplaceCode,
    ...sourceFiles,
  ];

  // Import coverage is a file/batch fact. Aggregate reports such as campaign,
  // ad group, and placement do not carry ASIN values, so applying the product
  // lock here would incorrectly mark imported reports as missing. Product
  // diagnostics remain ASIN-scoped in their dedicated metric queries.
  if (input.batchId) {
    sql += ' AND batch_id = ?';
    params.push(input.batchId);
  }

  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ad_daily_metrics
    WHERE ${sql}
  `).get(...params) as { count?: number } | undefined;
  return Number(row?.count || 0);
}
