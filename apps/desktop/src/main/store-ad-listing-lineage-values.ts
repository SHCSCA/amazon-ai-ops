import { type LingxingReportType } from '@amazon-ai-ops/shared-types';
import { type ProductionLineageJobRow, type ProductionLineageJob, type ProductionLineage } from "./store-ad-listing-contracts";
import { PRODUCTION_REPORT_TYPE_SET, PRODUCTION_REPORT_TYPES } from "./store-ad-listing-constants";

export function isLingxingReportType(value: unknown): value is LingxingReportType {
  return PRODUCTION_REPORT_TYPE_SET.has(String(value ?? '').trim());
}

export function parseProductionLineageJob(row: ProductionLineageJobRow): ProductionLineageJob | undefined {
  const reportTypes = safeReportTypes(row.report_types_json);
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.snapshot_json);
  } catch {
    return undefined;
  }
  const lineage = safeProductionLineage(
    snapshot && typeof snapshot === 'object'
      ? (snapshot as Record<string, unknown>).lineage
      : undefined,
  );
  return {
    jobId: String(row.job_id),
    dateStart: String(row.date_start),
    dateEnd: String(row.date_end),
    reportTypes,
    lineage,
    createdAt: String(row.created_at),
  };
}

export function safeReportTypes(value: string): LingxingReportType[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => !isLingxingReportType(item))) return [];
    return parsed.map((item) => String(item) as LingxingReportType);
  } catch {
    return [];
  }
}

export function safeProductionLineage(value: unknown): ProductionLineage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const purpose = String(record.purpose ?? '');
  const expectedReportTypes = Array.isArray(record.expectedReportTypes)
    && record.expectedReportTypes.every(isLingxingReportType)
    ? record.expectedReportTypes.map((item) => String(item) as LingxingReportType)
    : [];
  if (purpose !== 'production_full' && purpose !== 'resume' && purpose !== 'retry') return undefined;
  const lineageId = String(record.lineageId ?? '');
  const rootJobId = String(record.rootJobId ?? '');
  const parentJobId = record.parentJobId === undefined ? undefined : String(record.parentJobId);
  if (!lineageId || !rootJobId || (record.parentJobId !== undefined && !parentJobId)) return undefined;
  return {
    lineageId,
    rootJobId,
    parentJobId,
    expectedReportTypes,
    purpose,
  };
}

export function hasCompleteReportTypeSet(values: Iterable<LingxingReportType>): boolean {
  const reportTypes = [...values];
  return reportTypes.length === PRODUCTION_REPORT_TYPES.length
    && new Set(reportTypes).size === PRODUCTION_REPORT_TYPES.length
    && PRODUCTION_REPORT_TYPES.every((reportType) => reportTypes.includes(reportType));
}

export function isValidProductionRoot(job: ProductionLineageJob): boolean {
  const lineage = job.lineage;
  return hasCompleteReportTypeSet(job.reportTypes)
    && Boolean(lineage)
    && lineage!.lineageId === job.jobId
    && lineage!.rootJobId === job.jobId
    && lineage!.parentJobId === undefined
    && lineage!.purpose === 'production_full'
    && hasCompleteReportTypeSet(lineage!.expectedReportTypes);
}

export function validatedProductionLineageFamily(
  root: ProductionLineageJob,
  candidates: readonly ProductionLineageJob[],
): ProductionLineageJob[] {
  const byId = new Map(candidates.map((job) => [job.jobId, job]));
  const valid = new Map<string, boolean>([[root.jobId, true]]);
  const isValidMember = (job: ProductionLineageJob, visiting = new Set<string>()): boolean => {
    const cached = valid.get(job.jobId);
    if (cached !== undefined) return cached;
    const lineage = job.lineage;
    if (
      !lineage
      || lineage.lineageId !== root.jobId
      || lineage.rootJobId !== root.jobId
      || !lineage.parentJobId
      || (lineage.purpose !== 'resume' && lineage.purpose !== 'retry')
      || !hasCompleteReportTypeSet(lineage.expectedReportTypes)
      || job.dateStart !== root.dateStart
      || job.dateEnd !== root.dateEnd
      || job.reportTypes.length < 1
      || new Set(job.reportTypes).size !== job.reportTypes.length
      || job.reportTypes.some((reportType) => !PRODUCTION_REPORT_TYPE_SET.has(reportType))
      || visiting.has(job.jobId)
    ) {
      valid.set(job.jobId, false);
      return false;
    }
    const parent = byId.get(lineage.parentJobId);
    if (!parent) {
      valid.set(job.jobId, false);
      return false;
    }
    const parentValid = parent.jobId === root.jobId
      || isValidMember(parent, new Set(visiting).add(job.jobId));
    valid.set(job.jobId, parentValid);
    return parentValid;
  };
  return candidates.filter((job) => job.jobId === root.jobId || isValidMember(job));
}
