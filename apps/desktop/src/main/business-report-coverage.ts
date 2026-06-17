export interface BusinessReportCoverageFile {
  reportType?: string | null;
  importedRows?: number | null;
}

export interface BusinessReportCoverageSummary {
  realReportFileCount: number;
  realReportTypeCount: number;
  missingReportTypes: string[];
  importedRowsByType: Map<string, number>;
  statusWithImportedRows: (importedRows: number) => 'ready' | 'partial' | 'blocked';
}

function normalizeType(value: unknown): string {
  return String(value || '').trim();
}

export function summarizeBusinessReportCoverage(input: {
  expectedTypes: readonly string[];
  realReportFiles: readonly BusinessReportCoverageFile[];
}): BusinessReportCoverageSummary {
  const expectedTypes = input.expectedTypes.map(normalizeType).filter(Boolean);
  const realTypes = new Set<string>();
  const importedRowsByType = new Map<string, number>();
  for (const file of input.realReportFiles) {
    const reportType = normalizeType(file.reportType);
    if (!reportType) continue;
    realTypes.add(reportType);
    importedRowsByType.set(reportType, (importedRowsByType.get(reportType) || 0) + Number(file.importedRows || 0));
  }
  const missingReportTypes = expectedTypes.filter((reportType) => !realTypes.has(reportType));
  const realReportTypeCount = expectedTypes.filter((reportType) => realTypes.has(reportType)).length;
  return {
    realReportFileCount: realReportTypeCount,
    realReportTypeCount,
    missingReportTypes,
    importedRowsByType,
    statusWithImportedRows(importedRows: number) {
      if (realReportTypeCount >= expectedTypes.length && importedRows > 0) return 'ready';
      return realReportTypeCount > 0 ? 'partial' : 'blocked';
    },
  };
}
