
export function buildDataReconciliationMarkdown(report: any): string {
  const blockers = Array.isArray(report.blockers) && report.blockers.length
    ? report.blockers.map((item: string) => `- ${item}`).join('\n')
    : '- none';
  const files = (report.realReportFiles || [])
    .map((file: any) => `- ${file.reportType}: ${file.filePath} (${file.importedRows || 0} rows)`)
    .join('\n') || '- none';
  const byType = (report.db?.byReportType || [])
    .map((row: any) => `- ${row.reportType || 'unknown'}: ${row.rows} rows, spend ${row.spend} USD, orders ${row.orders}, sales ${row.sales} USD`)
    .join('\n') || '- none';
  return [
    '# Amazon AI Ops Data Reconciliation',
    '',
    `Generated at: ${report.generatedAt}`,
    `Scope: ${report.scope.dateFrom} to ${report.scope.dateTo} / ${report.scope.storeName} / ${report.scope.marketplaceCode} / USD`,
    `Batch ids: ${(report.sourceBatchIds || []).join(', ') || 'none'}`,
    '',
    '## Canonical Totals',
    '',
    `Source: ${report.db?.canonical?.summarySource || 'none'}`,
    `Rows: ${report.db?.totals?.canonical?.rows ?? 0}`,
    `Spend: ${report.db?.totals?.canonical?.spend ?? 0} USD`,
    `Orders: ${report.db?.totals?.canonical?.orders ?? 0}`,
    `Sales: ${report.db?.totals?.canonical?.sales ?? 0} USD`,
    `Clicks: ${report.db?.totals?.canonical?.clicks ?? 0}`,
    '',
    '## Real Report Files',
    '',
    files,
    '',
    '## DB By Report Type',
    '',
    byType,
    '',
    '## Blockers',
    '',
    blockers,
    '',
    '## Interpretation',
    '',
    '- Do not add campaign/ad_group/placement/advertised_product totals together with keyword/search term/targeting totals.',
    '- Canonical totals use user_search_term first, then search_term, then actionable fallback only when no search term table exists.',
    '- This report proves local data consistency only; final delivery still depends on the final readiness manifest.',
    '',
  ].join('\n');
}
