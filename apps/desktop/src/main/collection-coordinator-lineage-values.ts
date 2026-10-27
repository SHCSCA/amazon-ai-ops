import {
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionJobSnapshot,
  LingxingCollectionRequestDto,
} from '@amazon-ai-ops/shared-types';
import {
  REPORT_TYPES,
} from "./collection-coordinator-constants";
import {
  type StartLingxingCollectionInput,
} from "./collection-coordinator-contracts";

export function attachCollectionLineage(
  result: RunBatchResult,
  request: LingxingCollectionRequestDto,
  input: StartLingxingCollectionInput,
): RunBatchResult {
  const job = attachCollectionJobLineage(result.job, request, input);
  return job === result.job ? result : { ...result, job };
}

export function attachCollectionJobLineage(
  job: LingxingCollectionJobSnapshot,
  request: LingxingCollectionRequestDto,
  input: StartLingxingCollectionInput,
): LingxingCollectionJobSnapshot {
  if (input.canary) return stripUntrustedCollectionLineage(job);
  const fullRequest = isExactFullCollectionRequest(request);
  const lineage = input.lineage ?? (fullRequest ? {
    lineageId: job.jobId,
    rootJobId: job.jobId,
    expectedReportTypes: [...request.reportTypes],
    purpose: 'production_full' as const,
  } : undefined);
  if (!lineage) return stripUntrustedCollectionLineage(job);

  const safeJobId = (value: string) => /^[A-Za-z0-9._-]{1,180}$/.test(value);
  const expected = new Set(lineage.expectedReportTypes);
  if (
    !safeJobId(lineage.lineageId)
    || !safeJobId(lineage.rootJobId)
    || (lineage.parentJobId !== undefined && !safeJobId(lineage.parentJobId))
    || lineage.lineageId !== lineage.rootJobId
    || expected.size !== REPORT_TYPES.size
    || [...REPORT_TYPES].some((reportType) => !expected.has(reportType))
    || request.reportTypes.some((reportType) => !expected.has(reportType))
    || !['production_full', 'resume', 'retry'].includes(lineage.purpose)
    || (lineage.purpose === 'production_full' && (
      lineage.rootJobId !== job.jobId
      || lineage.parentJobId !== undefined
      || !fullRequest
    ))
    || (lineage.purpose !== 'production_full' && !lineage.parentJobId)
  ) {
    throw new Error('LINGXING_COLLECTION_LINEAGE_INVALID');
  }
  return {
    ...job,
    lineage: {
      lineageId: lineage.lineageId,
      rootJobId: lineage.rootJobId,
      ...(lineage.parentJobId ? { parentJobId: lineage.parentJobId } : {}),
      expectedReportTypes: [...lineage.expectedReportTypes],
      purpose: lineage.purpose,
    },
  };
}

export function stripUntrustedCollectionLineage(
  job: LingxingCollectionJobSnapshot,
): LingxingCollectionJobSnapshot {
  if (job.lineage === undefined) return job;
  const { lineage: _untrustedLineage, ...safeJob } = job;
  return safeJob;
}

export function isExactFullCollectionRequest(request: LingxingCollectionRequestDto): boolean {
  return request.reportTypes.length === REPORT_TYPES.size
    && request.reportTypes.every((reportType) => REPORT_TYPES.has(reportType));
}

export function assertCanaryRequestIdentity(requestId: string, canary: boolean): void {
  const hasReservedPrefix = requestId.startsWith('canary:');
  if (hasReservedPrefix !== canary) {
    throw new Error(canary
      ? 'LINGXING_COLLECTION_CANARY_REQUEST_ID_REQUIRED'
      : 'LINGXING_COLLECTION_CANARY_REQUEST_ID_RESERVED');
  }
}
