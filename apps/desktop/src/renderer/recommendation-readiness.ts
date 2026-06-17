export interface RecommendationGateIssueInput {
  requiredReportCount?: number;
  realReportFileCount: number;
  realReportFilesLength: number;
  importedRowCount: number;
  quantImportedRows: number;
  hasImportedMetrics: boolean;
  currentBatchId?: string;
  collectionBlockers?: string[];
  quantBlockers?: string[];
}

const DEFAULT_REQUIRED_REPORT_COUNT = 8;

export function resolveRecommendationBatchId(input: {
  scopeBatchId?: string;
  latestBatchId?: string;
  sourceBatchIds?: string[];
}): string | undefined {
  return firstNonEmpty([
    input.scopeBatchId,
    input.latestBatchId,
    ...(input.sourceBatchIds || []),
  ]);
}

export function buildRecommendationGateIssues(input: RecommendationGateIssueInput): string[] {
  const issues = new Set<string>();
  const requiredReportCount = Math.max(1, Number(input.requiredReportCount || DEFAULT_REQUIRED_REPORT_COUNT));
  const realReportFileCount = Math.max(0, Number(input.realReportFileCount || input.realReportFilesLength || 0));
  const importedRowCount = Math.max(0, Number(input.importedRowCount || input.quantImportedRows || 0));

  if (realReportFileCount <= 0) {
    issues.add('当前范围缺少真实 xlsx/xls/csv 原始报表文件');
  } else if (realReportFileCount < requiredReportCount) {
    issues.add(`当前范围只完成 ${realReportFileCount}/${requiredReportCount} 类真实广告报表，需补齐 8 类后才能生成正式建议`);
  }

  if (importedRowCount <= 0) {
    issues.add('当前范围没有写入 DB 的广告指标行');
  }
  if (input.quantImportedRows > 0 && !input.hasImportedMetrics) {
    issues.add('当前范围没有 keyword/search term/target 等可执行口径指标');
  }
  for (const blocker of [...(input.collectionBlockers || []), ...(input.quantBlockers || [])]) {
    if (blocker) issues.add(blocker);
  }
  if (!input.currentBatchId) issues.add('当前范围没有可绑定的采集批次');
  return Array.from(issues);
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.map((value) => String(value || '').trim()).find(Boolean);
}
