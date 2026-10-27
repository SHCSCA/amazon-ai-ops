import {
  isDeepStrictEqual,
} from 'node:util';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
  type LingxingReportType,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type LingxingCollectionAuthorityProof,
} from '@amazon-ai-ops/local-db';
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorSchedulerProjection,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import {
  deriveStoreCollectionWindow,
  storeCollectionScheduleSemanticFingerprint,
} from './store-collection-scheduler';
import {
  SAFE_JOB_ID,
  FULL_REPORT_TYPES,
} from "./collection-scheduler-constants";
import {
  type StoreCollectionDurableProofScope,
  type SchedulerExecuteInput,
  type SchedulerRecoverInput,
} from "./collection-scheduler-contracts";
import {
  sameFullReportSet,
  sameContext,
  isIsoDate,
  inclusiveUtcDays,
  cloneExactAuthority,
  codepointCompare,
} from "./collection-scheduler-values";

export function exactJobIdentityProblem(
  job: LingxingCollectionJobSnapshot,
  authorized: StoreCollectionDurableProofScope,
): string | null {
  if (!job || typeof job !== 'object' || !SAFE_JOB_ID.test(job.jobId)) return 'jobId';
  const request = job.request;
  if (!request
    || request.requestId !== authorized.requestId
    || request.requestId.startsWith('canary:')
    || request.mode !== 'create-and-download'
    || request.dateStart !== authorized.dateStart
    || request.dateEnd !== authorized.dateEnd
    || !sameFullReportSet(request.reportTypes)) {
    return 'request/window/mode/report-set';
  }
  let requestContext: StoreContextEnvelope;
  try {
    requestContext = normalizeStoreContextEnvelope(request.storeContext);
  } catch {
    return 'request-context';
  }
  if (!sameContext(requestContext, authorized.context)) return 'Store/Profile/Generation';
  if (!job.lineage
    || job.lineage.purpose !== 'production_full'
    || job.lineage.lineageId !== job.jobId
    || job.lineage.rootJobId !== job.jobId
    || job.lineage.parentJobId !== undefined
    || !sameFullReportSet(job.lineage.expectedReportTypes)) {
    return 'production-full-lineage';
  }
  if (!Array.isArray(job.reports)
    || job.reports.length !== FULL_REPORT_TYPES.length
    || !sameFullReportSet(job.reports.map((checkpoint) => checkpoint.reportType))) {
    return 'checkpoint-report-set';
  }
  return null;
}

export function deriveHistoricalCollectionWindow(
  job: LingxingCollectionJobSnapshot,
  context: StoreContextEnvelope,
  expectedFingerprint: string,
): { dateStart: string; dateEnd: string } {
  const dateStart = job?.request?.dateStart;
  const dateEnd = job?.request?.dateEnd;
  if (!isIsoDate(dateStart) || !isIsoDate(dateEnd)) {
    throw new Error('historical durable job 缺少有效 date window。');
  }
  const expectedEnd = deriveStoreCollectionWindow(context.businessDate, 1).dateEnd;
  if (dateEnd !== expectedEnd) {
    throw new Error('historical durable job dateEnd 与 businessDate 不一致。');
  }
  const lookbackDays = inclusiveUtcDays(dateStart, dateEnd);
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
    throw new Error('historical durable job lookback 超出 1..90 天边界。');
  }
  const derivedWindow = deriveStoreCollectionWindow(context.businessDate, lookbackDays);
  if (derivedWindow.dateStart !== dateStart || derivedWindow.dateEnd !== dateEnd) {
    throw new Error('historical durable job date window 无法确定性复算。');
  }
  const fingerprint = storeCollectionScheduleSemanticFingerprint({
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    lookbackDays,
    dateStart,
    dateEnd,
  });
  if (fingerprint !== expectedFingerprint) {
    throw new Error('historical durable job fingerprint 与冻结 transition 不一致。');
  }
  return { dateStart, dateEnd };
}

export function authorityJobRowExact(
  proof: LingxingCollectionAuthorityProof,
  authorized: StoreCollectionDurableProofScope,
): boolean {
  const { job, jobRow } = proof;
  const context = normalizeStoreContextEnvelope(job.request.storeContext);
  let rowReportTypes: unknown;
  try {
    rowReportTypes = JSON.parse(jobRow.reportTypesJson);
  } catch {
    return false;
  }
  return jobRow.storeId === authorized.context.storeId
    && jobRow.storeId === context.storeId
    && jobRow.jobId === job.jobId
    && jobRow.requestId === authorized.requestId
    && jobRow.requestId === job.request.requestId
    && jobRow.browserProfileId === authorized.context.browserProfileId
    && jobRow.browserProfileId === context.browserProfileId
    && jobRow.marketplace === 'US'
    && jobRow.currency === 'USD'
    && jobRow.businessTimezone === 'America/Los_Angeles'
    && jobRow.businessDate === authorized.context.businessDate
    && jobRow.businessDate === context.businessDate
    && jobRow.sessionGeneration === authorized.context.sessionGeneration
    && jobRow.sessionGeneration === context.sessionGeneration
    && jobRow.dateStart === authorized.dateStart
    && jobRow.dateStart === job.request.dateStart
    && jobRow.dateEnd === authorized.dateEnd
    && jobRow.dateEnd === job.request.dateEnd
    && jobRow.mode === 'create-and-download'
    && sameFullReportSet(rowReportTypes as LingxingReportType[])
    && jobRow.state === job.state
    && jobRow.createdAt === job.createdAt
    && jobRow.updatedAt === job.updatedAt
    && jobRow.completedAt === (job.completedAt ?? null)
    && jobRow.blockerCode === (job.blockerCode ?? null)
    && jobRow.detail === (job.detail ?? null);
}

export function projection<Domain extends StoreCollectionTransitionCapabilityDomain>(
  input: Domain extends 'transition_execution' ? SchedulerExecuteInput : SchedulerRecoverInput,
  authority: StoreCollectionAuthorityReadback,
  state: StoreCollectionOrchestratorSchedulerProjection<Domain>['state'],
): StoreCollectionOrchestratorSchedulerProjection<Domain> {
  const exactTerminal = state === 'accepted' || state === 'succeeded' || state === 'failed';
  return {
    owner: input.owner,
    capability: input.capability,
    transitionCapability: input.transitionCapability,
    transitionScope: input.transitionScope as StoreCollectionTransitionCapabilityScope<Domain>,
    state,
    authority: cloneExactAuthority(authority),
    cycleId: input.cycleId,
    transitionId: input.transitionId,
    fingerprint: input.expectedFingerprint,
    attemptId: input.attemptId,
    requestId: input.requestId,
    ...(exactTerminal ? { accepted: true, duplicate: false } : {}),
  };
}

export function sameCoordinatorAndDurableJob(
  coordinator: LingxingCollectionJobSnapshot,
  durable: LingxingCollectionJobSnapshot,
): boolean {
  return isDeepStrictEqual(canonicalJob(coordinator), canonicalJob(durable));
}

export function canonicalJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
  // 可选字段清除后按持久化 JSON 的缺省形态核验。
  return JSON.parse(JSON.stringify({
    ...job,
    request: {
      ...job.request,
      storeContext: normalizeStoreContextEnvelope(job.request.storeContext),
      reportTypes: [...job.request.reportTypes].sort(codepointCompare),
    },
    ...(job.lineage ? {
      lineage: {
        ...job.lineage,
        expectedReportTypes: [...job.lineage.expectedReportTypes].sort(codepointCompare),
      },
    } : {}),
    reports: [...job.reports].sort((left, right) => (
      codepointCompare(left.reportType, right.reportType)
    )),
  }));
}
