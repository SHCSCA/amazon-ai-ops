interface ReportCoverageCollectionLike {
  fileAudit?: {
    realReportFileCount?: number | null;
  } | null;
  realReportFiles?: unknown[] | null;
}

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
