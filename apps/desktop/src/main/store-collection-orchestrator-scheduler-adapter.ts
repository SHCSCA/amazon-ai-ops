import { isDeepStrictEqual } from 'node:util';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
  type LingxingReportType,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRuntimeConfigProjection,
} from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionAuthorityProof,
  LingxingImportRepository,
} from '@amazon-ai-ops/local-db';
import type { LingxingCollectionCoordinator } from './lingxing-collection-coordinator';
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionOrchestratorSchedulerProjection,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import type { StoreCollectionOrchestratorDomainAdapter } from './store-collection-orchestrator-domain-adapter';
import {
  deriveStoreCollectionWindow,
  storeCollectionScheduleSemanticFingerprint,
} from './store-collection-scheduler';

const SAFE_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const EXECUTION_ATTEMPT_ID = /^sca:[a-f0-9]{64}$/;
const EXECUTION_REQUEST_ID = /^scr:[a-f0-9]{64}$/;
const SAFE_JOB_ID = /^[A-Za-z0-9._-]{1,180}$/;

const FULL_REPORT_TYPES = Object.freeze(
  LINGXING_AD_REPORTS.map((report) => report.type),
) as readonly LingxingReportType[];
const FULL_REPORT_TYPE_SET = new Set<LingxingReportType>(FULL_REPORT_TYPES);

type SchedulerPort = StoreCollectionOrchestratorDependencies['scheduler'];
type SchedulerExecuteInput = Parameters<SchedulerPort['execute']>[0];
type SchedulerRecoverInput = Parameters<SchedulerPort['recover']>[0];

export interface StoreCollectionOrchestratorSchedulerAdapterOptions {
  domain: Pick<StoreCollectionOrchestratorDomainAdapter, 'claimSchedulerTransitionAuthority'>;
  config: {
    getForStoreId(storeId: StoreId): StoreRuntimeConfigProjection;
  };
  coordinator: Pick<LingxingCollectionCoordinator, 'start'>;
  repository: Pick<
    LingxingImportRepository,
    'readUniqueCollectionAuthorityProofForStoreByRequestId'
  >;
}

interface AuthorizedSchedulerRequest<
  Domain extends StoreCollectionTransitionCapabilityDomain,
> {
  input: Domain extends 'transition_execution' ? SchedulerExecuteInput : SchedulerRecoverInput;
  context: StoreContextEnvelope;
  expectedAuthority: StoreCollectionAuthorityReadback;
  scope: StoreCollectionTransitionCapabilityScope<Domain>;
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  dateStart: string;
  dateEnd: string;
}
type AuthorizedSchedulerAuthority<
  Domain extends StoreCollectionTransitionCapabilityDomain,
> = Omit<AuthorizedSchedulerRequest<Domain>, 'dateStart' | 'dateEnd'>;

/**
 * Binds the multistore orchestration request identity to the existing
 * LingxingCollectionCoordinator and its durable authority DB job.
 *
 * This port owns no timer, browser, store switching, repair, or retry logic.
 * execute creates exactly one full-eight production request; recover is
 * strictly read-only and can only classify that exact durable request.
 */
export class StoreCollectionOrchestratorSchedulerAdapter implements SchedulerPort {
  constructor(private readonly options: StoreCollectionOrchestratorSchedulerAdapterOptions) {}

  async execute(
    input: SchedulerExecuteInput,
  ): Promise<StoreCollectionOrchestratorSchedulerProjection<'transition_execution'>> {
    const base = this.authorizeStructure(input, 'transition_execution');
    const configProjection = this.options.config.getForStoreId(base.context.storeId);
    const config = configProjection?.current;
    if (!config || config.status !== 'active') {
      throw new Error('scheduler 要求当前店铺存在 active runtime config。');
    }
    if (config.storeId !== base.context.storeId
      || config.marketplace !== 'US'
      || config.currency !== 'USD'
      || config.businessTimezone !== 'America/Los_Angeles') {
      throw new Error('scheduler runtime config 发生 Store/marketplace/currency/timezone 身份漂移。');
    }
    const window = deriveStoreCollectionWindow(
      base.context.businessDate,
      config.values.collectionLookbackDays,
    );
    const fingerprint = storeCollectionScheduleSemanticFingerprint({
      storeId: base.context.storeId,
      browserProfileId: base.context.browserProfileId,
      businessDate: base.context.businessDate,
      lookbackDays: config.values.collectionLookbackDays,
      ...window,
    });
    if (fingerprint !== input.expectedFingerprint) {
      throw new Error('scheduler runtime config/date window fingerprint 已漂移。');
    }
    this.assertExecutionIdentity(input, base.scope, base.context);
    const claim = this.options.domain.claimSchedulerTransitionAuthority(input, {
      capabilityDomain: 'transition_execution',
      context: base.context,
      expectedAuthority: base.expectedAuthority,
      attemptId: input.attemptId,
      requestId: input.requestId,
    });
    if (claim.executionScope !== base.scope || claim.transitionScope !== base.scope) {
      throw new Error('scheduler execution claim 未绑定 exact transition scope。');
    }
    const authorized: AuthorizedSchedulerRequest<'transition_execution'> = {
      ...base,
      executionScope: claim.executionScope,
      ...window,
    };
    const preexisting = this.options.repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      authorized.context.storeId,
      input.requestId,
    );
    if (preexisting) {
      throw new Error('scheduler execute 拒绝复用既有 durable Store/Request 任务。');
    }

    const output = await this.options.coordinator.start({
      requestId: input.requestId,
      storeContext: authorized.context,
      dateStart: authorized.dateStart,
      dateEnd: authorized.dateEnd,
      mode: 'create-and-download',
      reportTypes: FULL_REPORT_TYPES,
      canary: false,
    });
    if (!isTerminalJobState(output?.result?.job?.state)) {
      throw new Error('Lingxing coordinator 未返回 durable terminal job。');
    }

    const durable = this.options.repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      authorized.context.storeId,
      input.requestId,
    );
    if (!durable) {
      throw new Error('Lingxing coordinator 返回后 exact durable Store/Request job 不存在。');
    }
    const identityProblem = exactJobIdentityProblem(durable.job, authorized);
    if (identityProblem) {
      throw new Error(`durable Lingxing job identity mismatch: ${identityProblem}`);
    }
    if (!sameCoordinatorAndDurableJob(output.result.job, durable.job)) {
      throw new Error('Lingxing coordinator result 与 durable authority DB job 不一致。');
    }

    return projection(input, authorized.expectedAuthority, 'accepted');
  }

  async recover(
    input: SchedulerRecoverInput,
  ): Promise<StoreCollectionOrchestratorSchedulerProjection<'recovery_existing_request_only'>> {
    const base = this.authorizeStructure(input, 'recovery_existing_request_only');
    const claim = this.options.domain.claimSchedulerTransitionAuthority(input, {
      capabilityDomain: 'recovery_existing_request_only',
      context: base.context,
      expectedAuthority: base.expectedAuthority,
      attemptId: input.attemptId,
      requestId: input.requestId,
    });
    this.assertExecutionIdentity(input, claim.executionScope, base.context);
    const durable = this.options.repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      base.context.storeId,
      input.requestId,
    );
    if (!durable) {
      return projection(input, base.expectedAuthority, 'not_found');
    }
    const window = deriveHistoricalCollectionWindow(
      durable.job,
      base.context,
      input.expectedFingerprint,
    );
    const authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'> = {
      ...base,
      executionScope: claim.executionScope,
      ...window,
    };
    const identityProblem = exactJobIdentityProblem(durable.job, authorized);
    if (identityProblem) {
      return projection(input, authorized.expectedAuthority, 'unknown');
    }
    return projection(
      input,
      authorized.expectedAuthority,
      classifyDurableProof(durable, authorized),
    );
  }

  private authorizeStructure<Domain extends StoreCollectionTransitionCapabilityDomain>(
    input: Domain extends 'transition_execution' ? SchedulerExecuteInput : SchedulerRecoverInput,
    capabilityDomain: Domain,
  ): AuthorizedSchedulerAuthority<Domain> {
    if (!input
      || !SAFE_ID.test(input.cycleId)
      || !SAFE_ID.test(input.transitionId)
      || !FINGERPRINT.test(input.expectedFingerprint)
      || !EXECUTION_ATTEMPT_ID.test(input.attemptId)
      || !EXECUTION_REQUEST_ID.test(input.requestId)) {
      throw new Error('scheduler request 缺少安全 cycle/transition/fingerprint/attempt/request identity。');
    }
    const context = normalizeStoreContextEnvelope(input.context);
    assertUsStoreContext(context);
    const scope = input.transitionScope;
    if (!scope
      || scope.capabilityDomain !== capabilityDomain
      || scope.cycleId !== input.cycleId
      || scope.transitionId !== input.transitionId
      || scope.purpose !== 'collection'
      || scope.expectedFingerprint !== input.expectedFingerprint
      || !scope.target
      || scope.target.storeId !== context.storeId
      || scope.target.browserProfileId !== context.browserProfileId
      || scope.target.marketplace !== context.marketplace
      || scope.target.currency !== context.currency
      || scope.target.businessTimezone !== context.businessTimezone) {
      throw new Error('scheduler request 与 transition capability scope 不一致。');
    }
    const expectedAuthority = cloneExactAuthority(input.expectedAuthority);
    if (expectedAuthority.activeStoreId !== context.storeId
      || !expectedAuthority.context
      || !sameContext(expectedAuthority.context, context)) {
      throw new Error('scheduler expectedAuthority 与 exact Store/Profile/Generation 不一致。');
    }

    return {
      input: input as AuthorizedSchedulerRequest<Domain>['input'],
      context,
      expectedAuthority,
      scope: scope as StoreCollectionTransitionCapabilityScope<Domain>,
      executionScope: undefined as never,
    };
  }

  private assertExecutionIdentity(
    input: SchedulerExecuteInput | SchedulerRecoverInput,
    executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>,
    context: StoreContextEnvelope,
  ): void {
    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      transitionScope: executionScope,
      context,
    });
    if (identity.attemptId !== input.attemptId || identity.requestId !== input.requestId) {
      throw new Error('scheduler attempt/request 无法由 admitted execution scope 复算。');
    }
  }
}

function exactJobIdentityProblem(
  job: LingxingCollectionJobSnapshot,
  authorized: AuthorizedSchedulerRequest<StoreCollectionTransitionCapabilityDomain>,
): string | null {
  if (!job || typeof job !== 'object' || !SAFE_JOB_ID.test(job.jobId)) return 'jobId';
  const request = job.request;
  if (!request
    || request.requestId !== authorized.input.requestId
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

function deriveHistoricalCollectionWindow(
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

function classifyDurableProof(
  proof: LingxingCollectionAuthorityProof,
  authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
): StoreCollectionOrchestratorSchedulerProjection['state'] {
  const shape = durableLifecycleShape(proof, authorized);
  switch (shape) {
    case 'queued':
      return queuedProofReasonable(proof, authorized) ? 'accepted' : 'unknown';
    case 'running':
      return runningProofReasonable(proof, authorized) ? 'waiting' : 'unknown';
    case 'completed_pending':
      return downloadProofExact(proof, authorized) && noCompletedImportProof(proof)
        ? 'waiting'
        : 'unknown';
    case 'completed_failed':
      return downloadProofExact(proof, authorized)
        && noCompletedImportProof(proof)
        ? 'failed'
        : 'unknown';
    case 'completed_succeeded':
      return succeededImportProofExact(proof, authorized)
        ? 'succeeded'
        : 'unknown';
    case 'terminal_not_applicable':
      return terminalFailureProofExact(proof, authorized)
      ? 'failed'
      : 'unknown';
    default:
      return 'unknown';
  }
}

type DurableLifecycleShape =
  | 'queued'
  | 'running'
  | 'completed_pending'
  | 'completed_failed'
  | 'completed_succeeded'
  | 'terminal_not_applicable';

/**
 * One fail-closed lifecycle matrix shared by every durable classification.
 * File/import proof is checked only after this job/import/batch shape gate.
 */
function durableLifecycleShape(
  proof: LingxingCollectionAuthorityProof,
  authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
): DurableLifecycleShape | null {
  const { job, batch } = proof;
  if (!isIsoInstant(job.createdAt) || !isIsoInstant(job.updatedAt)) return null;
  if (job.state === 'queued') {
    return job.completedAt === undefined
      && allImportLifecycleFieldsEmpty(job)
      && noCompletedImportProof(proof)
      && (!batch || batchIdentityExact(batch, job, authorized, 'pending'))
      ? 'queued'
      : null;
  }
  if (job.state === 'running') {
    return job.completedAt === undefined
      && allImportLifecycleFieldsEmpty(job)
      && noCompletedImportProof(proof)
      && (!batch || batchIdentityExact(batch, job, authorized, 'running'))
      ? 'running'
      : null;
  }
  if (job.state === 'completed') {
    if (!isIsoInstant(job.completedAt)
      || !batch
      || !batchIdentityExact(batch, job, authorized, 'completed')) {
      return null;
    }
    if (job.importState === 'pending') {
      return optionalIsoInstant(job.importAttemptedAt)
        && job.importCompletedAt === undefined
        && job.importError === undefined
        ? 'completed_pending'
        : null;
    }
    if (job.importState === 'failed') {
      return isIsoInstant(job.importAttemptedAt)
        && isIsoInstant(job.importCompletedAt)
        && requiredNonBlank(job.importError)
        ? 'completed_failed'
        : null;
    }
    if (job.importState === 'succeeded') {
      return isIsoInstant(job.importAttemptedAt)
        && isIsoInstant(job.importCompletedAt)
        && job.importError === undefined
        ? 'completed_succeeded'
        : null;
    }
    return null;
  }
  if (job.state === 'completed_with_errors'
    || job.state === 'failed'
    || job.state === 'cancelled'
    || job.state === 'stale_authority') {
    const expectedBatchStatus = job.state === 'completed_with_errors'
      ? 'completed_with_errors'
      : 'failed';
    return isIsoInstant(job.completedAt)
      && job.importState === 'not_applicable'
      && job.importAttemptedAt === undefined
      && job.importCompletedAt === undefined
      && job.importError === undefined
      && Boolean(batch)
      && batchIdentityExact(batch!, job, authorized, expectedBatchStatus)
      && noCompletedImportProof(proof)
      ? 'terminal_not_applicable'
      : null;
  }
  return null;
}

function allImportLifecycleFieldsEmpty(job: LingxingCollectionJobSnapshot): boolean {
  return job.importState === undefined
    && job.importAttemptedAt === undefined
    && job.importCompletedAt === undefined
    && job.importError === undefined;
}

function queuedProofReasonable(
  proof: LingxingCollectionAuthorityProof,
  _authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
): boolean {
  return proof.lingxingFileCount === 0
    && proof.lingxingFiles.length === 0
    && proof.checkpointCount === proof.job.reports.length
    && proof.job.reports.every((checkpoint) => checkpoint.state === 'queued');
}

function runningProofReasonable(
  proof: LingxingCollectionAuthorityProof,
  authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
): boolean {
  return proof.lingxingFileCount === proof.lingxingFiles.length
    && uniqueReportSubset(proof.lingxingFiles.map((file) => file.reportType))
    && proof.lingxingFiles.every((file) => (
      file.storeId === authorized.context.storeId
      && file.batchId === proof.job.jobId
      && typeof file.id === 'string'
      && file.id.length > 0
    ));
}

function terminalFailureProofExact(
  proof: LingxingCollectionAuthorityProof,
  authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
): boolean {
  return proof.lingxingFileCount === proof.lingxingFiles.length
    && uniqueReportSubset(proof.lingxingFiles.map((file) => file.reportType))
    && proof.lingxingFiles.every((file) => (
      file.storeId === authorized.context.storeId
      && file.batchId === proof.job.jobId
    ));
}

function downloadProofExact(
  proof: LingxingCollectionAuthorityProof,
  authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
): boolean {
  if (!proof.batch
    || !batchIdentityExact(proof.batch, proof.job, authorized, 'completed')
    || proof.checkpointCount !== FULL_REPORT_TYPES.length
    || proof.job.reports.length !== FULL_REPORT_TYPES.length
    || proof.lingxingFileCount !== FULL_REPORT_TYPES.length
    || proof.lingxingFiles.length !== FULL_REPORT_TYPES.length
    || !sameFullReportSet(proof.job.reports.map((checkpoint) => checkpoint.reportType))
    || !sameFullReportSet(proof.lingxingFiles.map((file) => file.reportType))) {
    return false;
  }
  const filesByType = new Map(proof.lingxingFiles.map((file) => [file.reportType, file]));
  return proof.job.reports.every((checkpoint) => {
    const identity = checkpoint.createdReportIdentity;
    const file = filesByType.get(checkpoint.reportType);
    return checkpoint.state === 'downloaded'
      && Number.isFinite(checkpoint.fileSizeBytes)
      && checkpoint.fileSizeBytes! > 0
      && Boolean(identity)
      && identity!.provider === 'lingxing'
      && identity!.reportType === checkpoint.reportType
      && identity!.dateStart === authorized.dateStart
      && identity!.dateEnd === authorized.dateEnd
      && requiredNonBlank(identity!.externalReportName)
      && isIsoInstant(identity!.createdAt)
      && Boolean(file)
      && file!.storeId === authorized.context.storeId
      && file!.batchId === proof.job.jobId
      && file!.status === 'downloaded'
      && requiredNonBlank(file!.filePath)
      && Number.isFinite(file!.fileSizeBytes)
      && file!.fileSizeBytes! > 0
      && file!.fileSizeBytes === checkpoint.fileSizeBytes;
  });
}

function succeededImportProofExact(
  proof: LingxingCollectionAuthorityProof,
  authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
): boolean {
  if (!downloadProofExact(proof, authorized)
    || proof.importRunCount !== 1
    || proof.importRuns.length !== 1
    || proof.importFileSnapshotCount !== FULL_REPORT_TYPES.length
    || proof.importFileSnapshots.length !== FULL_REPORT_TYPES.length
    || proof.importedReportFileCount !== FULL_REPORT_TYPES.length
    || proof.importedReportFiles.length !== FULL_REPORT_TYPES.length
    || !sameFullReportSet(proof.importFileSnapshots.map((row) => row.reportType as LingxingReportType))
    || !sameFullReportSet(proof.importedReportFiles.map((row) => row.reportType as LingxingReportType))) {
    return false;
  }
  const run = proof.importRuns[0]!;
  if (run.storeId !== authorized.context.storeId
    || run.batchId !== proof.job.jobId
    || run.status !== 'completed'
    || run.sourceFileCount !== FULL_REPORT_TYPES.length
    || !requiredNonBlank(run.runId)
    || !requiredNonBlank(run.idempotencyKey)
    || !SHA256.test(run.inputFingerprint)
    || !isIsoInstant(run.startedAt)
    || !isIsoInstant(run.completedAt)
    || !isIsoInstant(run.createdAt)) {
    return false;
  }
  const liveByType = new Map(proof.lingxingFiles.map((row) => [row.reportType, row]));
  const importedByType = new Map(
    proof.importedReportFiles.map((row) => [row.reportType, row]),
  );
  return proof.importFileSnapshots.every((snapshot) => {
    const reportType = snapshot.reportType as LingxingReportType;
    const live = liveByType.get(reportType);
    const imported = importedByType.get(reportType);
    return snapshot.storeId === authorized.context.storeId
      && snapshot.runId === run.runId
      && snapshot.batchId === proof.job.jobId
      && requiredNonBlank(snapshot.snapshotId)
      && requiredNonBlank(snapshot.filePath)
      && requiredNonBlank(snapshot.fileName)
      && Number.isInteger(snapshot.fileSizeBytes)
      && snapshot.fileSizeBytes > 0
      && SHA256.test(snapshot.fileHash)
      && Number.isInteger(snapshot.importedRows)
      && snapshot.importedRows >= 0
      && isIsoInstant(snapshot.capturedAt)
      && Boolean(live)
      && snapshot.lingxingFileId === live!.id
      && snapshot.filePath === live!.filePath
      && snapshot.fileName === live!.displayName
      && snapshot.fileSizeBytes === live!.fileSizeBytes
      && Boolean(imported)
      && snapshot.reportFileId === imported!.id
      && imported!.storeId === authorized.context.storeId
      && imported!.batchId === proof.job.jobId
      && imported!.status === 'imported'
      && requiredNonBlank(imported!.filePath)
      && requiredNonBlank(imported!.fileName)
      && Number.isInteger(imported!.fileSizeBytes)
      && imported!.fileSizeBytes > 0
      && imported!.fileHash !== undefined
      && SHA256.test(imported!.fileHash)
      && imported!.fileHash === snapshot.fileHash
      && imported!.filePath === snapshot.filePath
      && imported!.fileName === snapshot.fileName
      && imported!.fileSizeBytes === snapshot.fileSizeBytes
      && imported!.importedRows === snapshot.importedRows
      && isIsoInstant(imported!.lastImportedAt)
      && !imported!.importError;
  });
}

function noCompletedImportProof(proof: LingxingCollectionAuthorityProof): boolean {
  return proof.importRunCount === 0
    && proof.importRuns.length === 0
    && proof.importFileSnapshotCount === 0
    && proof.importFileSnapshots.length === 0
    && proof.importedReportFileCount === 0
    && proof.importedReportFiles.length === 0;
}

function batchIdentityExact(
  batch: NonNullable<LingxingCollectionAuthorityProof['batch']>,
  job: LingxingCollectionJobSnapshot,
  authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'>,
  expectedStatus: NonNullable<LingxingCollectionAuthorityProof['batch']>['status'],
): boolean {
  return batch.id === job.jobId
    && batch.storeId === authorized.context.storeId
    && batch.requestId === authorized.input.requestId
    && batch.browserProfileId === authorized.context.browserProfileId
    && batch.businessDate === authorized.context.businessDate
    && batch.sessionGeneration === authorized.context.sessionGeneration
    && batch.marketplaceCode === 'US'
    && batch.dateStart === authorized.dateStart
    && batch.dateEnd === authorized.dateEnd
    && batch.status === expectedStatus
    && requiredNonBlank(batch.downloadDir)
    && isIsoInstant(batch.createdAt)
    && (expectedStatus === 'pending'
      || expectedStatus === 'running'
      ? batch.completedAt === undefined
      : isIsoInstant(batch.completedAt));
}

function uniqueReportSubset(values: readonly LingxingReportType[]): boolean {
  return values.length <= FULL_REPORT_TYPES.length
    && new Set(values).size === values.length
    && values.every((value) => FULL_REPORT_TYPE_SET.has(value));
}

function projection<Domain extends StoreCollectionTransitionCapabilityDomain>(
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

function sameCoordinatorAndDurableJob(
  coordinator: LingxingCollectionJobSnapshot,
  durable: LingxingCollectionJobSnapshot,
): boolean {
  return isDeepStrictEqual(canonicalJob(coordinator), canonicalJob(durable));
}

function canonicalJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
  return {
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
  };
}

function cloneExactAuthority(value: StoreCollectionAuthorityReadback): StoreCollectionAuthorityReadback {
  if (!value || (value.activeStoreId !== null && typeof value.activeStoreId !== 'string')) {
    throw new Error('scheduler authority readback 无效。');
  }
  if (value.activeStoreId === null) {
    if (value.context !== null) throw new Error('null scheduler authority 不能携带 context。');
    return { activeStoreId: null, context: null };
  }
  if (!value.context) throw new Error('active scheduler authority 缺少 context。');
  const context = normalizeStoreContextEnvelope(value.context);
  if (context.storeId !== value.activeStoreId) {
    throw new Error('scheduler authority store/context 不一致。');
  }
  return { activeStoreId: value.activeStoreId, context };
}

function assertUsStoreContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new Error('scheduler 第一版只接受 US/USD/America/Los_Angeles。');
  }
}

function sameContext(left: StoreContextEnvelope, right: StoreContextEnvelope): boolean {
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

function sameFullReportSet(values: readonly LingxingReportType[]): boolean {
  return Array.isArray(values)
    && values.length === FULL_REPORT_TYPES.length
    && new Set(values).size === FULL_REPORT_TYPES.length
    && values.every((value) => FULL_REPORT_TYPE_SET.has(value));
}

function isTerminalJobState(value: unknown): boolean {
  return value === 'completed'
    || value === 'completed_with_errors'
    || value === 'failed'
    || value === 'cancelled'
    || value === 'stale_authority';
}

const SHA256 = /^[a-f0-9]{64}$/i;

function requiredNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function optionalIsoInstant(value: unknown): boolean {
  return value === undefined || isIsoInstant(value);
}

function inclusiveUtcDays(dateStart: string, dateEnd: string): number {
  const start = Date.parse(`${dateStart}T00:00:00.000Z`);
  const end = Date.parse(`${dateEnd}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
