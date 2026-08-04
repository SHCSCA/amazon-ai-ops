interface ReportCoverageCollectionLike {
  fileAudit?: {
    realReportFileCount?: number | null;
  } | null;
  realReportFiles?: unknown[] | null;
  reportOptions?: Array<{
    type?: string | null;
    status?: string | null;
    realFileAvailable?: boolean | null;
    importedRows?: number | null;
  }> | null;
}

export const REQUIRED_FORMAL_REPORT_TYPE_COUNT = 8;

export function realReportCoverageCount(collection: ReportCoverageCollectionLike | null | undefined): number {
  const auditedCount = collection?.fileAudit?.realReportFileCount;
  if (typeof auditedCount === 'number' && Number.isFinite(auditedCount)) {
    return Math.max(0, auditedCount);
  }
  return Math.max(0, collection?.realReportFiles?.length ?? 0);
}

export function hasRealReportCoverage(collection: ReportCoverageCollectionLike | null | undefined): boolean {
  return realReportCoverageCount(collection) > 0;
}

export function importedReportTypeCoverageCount(
  collection: ReportCoverageCollectionLike | null | undefined,
): number {
  const importedTypes = new Set(
    (collection?.reportOptions || [])
      .filter((report) => report.realFileAvailable === true && (
        Number(report.importedRows || 0) > 0
        || /imported|completed|complete|succeeded/i.test(String(report.status || ''))
      ))
      .map((report) => String(report.type || '').trim())
      .filter(Boolean),
  );
  return importedTypes.size;
}

export function hasFormalReportCoverage(
  collection: ReportCoverageCollectionLike | null | undefined,
  requiredReportTypeCount = REQUIRED_FORMAL_REPORT_TYPE_COUNT,
): boolean {
  return realReportCoverageCount(collection) >= requiredReportTypeCount
    && importedReportTypeCoverageCount(collection) >= requiredReportTypeCount;
}
