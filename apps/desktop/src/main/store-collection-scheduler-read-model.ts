import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
  type StoreRuntimeConfigRecord,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreCollectionScheduleProjection,
  StoreCollectionScheduleRunResult,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  fingerprintCollectionResumeExecutionContext,
  fingerprintLingxingCollectionAuthorityProof,
  type CollectionInPlaceResumeState,
  type CollectionResumeAttemptReceipt,
  type LingxingCollectionAuthorityProof,
  type LingxingImportRepository,
} from '@amazon-ai-ops/local-db';
import type { StoreCollectionExistingResumeRequest } from './store-collection-main-runtime';
import type { StoreCoordinator } from './store-coordinator';
import { classifyStoreCollectionDurableProof } from './store-collection-orchestrator-scheduler-adapter';
import type {
  StoreCollectionOrchestrator,
  StoreCollectionProtectedSemanticAttemptReadback,
} from './store-collection-orchestrator';
import type { StoreRuntimeConfigService } from './store-runtime-config-service';
import type { StoreCollectionSchedulerIpcPort } from './store-collection-scheduler-ipc';

export interface StoreCollectionSchedulerReadModelOptions {
  authority: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getActiveStoreContext'>;
  runtimeConfig: Pick<StoreRuntimeConfigService, 'get'>;
  importRepository: Pick<
    LingxingImportRepository,
    | 'inspectUniqueCollectionJobForSemanticScope'
    | 'getCollectionJobForStore'
    | 'readUniqueCollectionAuthorityProofForStoreByRequestId'
    | 'getCollectionInPlaceResumeStateForStore'
    | 'readLatestCollectionResumeAttemptReceiptForStore'
    | 'readUniqueSucceededCollectionResumeReceiptForStore'
  >;
  orchestrator: Pick<StoreCollectionOrchestrator, 'readProtectedSemanticAttempt'>;
  /**
   * Must be the caller's Package-UI-aware Main runtime entry point. This read
   * model deliberately does not own process-mode state; Package UI must reject
   * this callback before it can reach real orchestration.
   */
  manualRun(context: StoreContextEnvelope): Promise<unknown>;
  /** Explicit-user-only MainRuntime entry; timers and startup recovery never receive this port. */
  resumeExisting(input: StoreCollectionExistingResumeRequest): Promise<unknown>;
  now?: () => Date;
}

export class StoreCollectionSchedulerReadModel implements StoreCollectionSchedulerIpcPort {
  private readonly now: () => Date;

  constructor(private readonly options: StoreCollectionSchedulerReadModelOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get(contextInput: StoreContextEnvelope): StoreCollectionScheduleProjection {
    return this.readAuthorized(contextInput).projection;
  }

  private readAuthorized(contextInput: StoreContextEnvelope): AuthorizedReadback {
    const context = this.options.authority.assertActiveStoreContext(contextInput);
    assertUsContext(context);
    const config = this.options.runtimeConfig.get(context).current;
    if (!config) {
      return {
        context,
        projection: {
          storeId: context.storeId,
          businessDate: context.businessDate,
          enabled: false,
          state: 'not_configured',
          detail: '当前店铺尚未配置采集计划。',
        },
      };
    }
    assertConfig(context, config);
    if (config.status === 'archived') {
      return {
        context,
        projection: {
          storeId: context.storeId,
          businessDate: context.businessDate,
          enabled: false,
          state: 'archived',
          detail: '当前店铺采集配置已归档。',
        },
      };
    }
    const window = deriveWindow(context.businessDate, config.values.collectionLookbackDays);
    const fingerprint = semanticFingerprint({
      context,
      lookbackDays: config.values.collectionLookbackDays,
      ...window,
    });
    const durable = this.options.importRepository.inspectUniqueCollectionJobForSemanticScope({
      storeId: context.storeId,
      browserProfileId: context.browserProfileId,
      businessDate: context.businessDate,
      ...window,
      mode: 'create-and-download',
      reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
    });
    const protectedAttempt = this.options.orchestrator.readProtectedSemanticAttempt({
      storeId: context.storeId,
      browserProfileId: context.browserProfileId,
      expectedFingerprint: fingerprint,
    });
    const durableContext = durable
      ? assertDurableIdentity(context, window, durable)
      : undefined;
    const durableState = durable && durableContext
      ? classifyStoreCollectionDurableProof(durable, {
          context: durableContext,
          requestId: durable.jobRow.requestId,
          ...window,
        })
      : undefined;
    if (protectedAttempt) {
      const succeededResumeReceipt = durable
        && durableState === 'succeeded'
        && (protectedAttempt.terminalOutcome?.state === 'failed'
          || protectedAttempt.terminalOutcome?.state === 'blocked')
        ? this.options.importRepository.readUniqueSucceededCollectionResumeReceiptForStore(
            context.storeId,
            durable.job.jobId,
            durable.job.request.requestId,
          )
        : undefined;
      assertProtectedIdentity(
        context,
        fingerprint,
        protectedAttempt,
        durable,
        durableState,
        succeededResumeReceipt,
      );
    }
    const base = {
      storeId: context.storeId,
      businessDate: context.businessDate,
      enabled: true,
      scheduleLocalTime: config.values.collectionScheduleLocalTime,
      configRevision: config.revision,
      ...window,
      fingerprint,
    } as const;
    if (durable) {
      const state = durableState!;
      return {
        context,
        durable,
        protectedAttempt: protectedAttempt ?? undefined,
        projection: {
          ...base,
          state,
          detail: detailForState(state),
        },
      };
    }
    if (protectedAttempt) {
      const terminalState = protectedAttempt.terminalOutcome?.state;
      if (terminalState === 'succeeded') {
        throw new Error('protected success has no exact authority DB job');
      }
      const state = terminalState === 'failed' || terminalState === 'blocked'
        ? 'failed'
        : 'claimed';
      return {
        context,
        protectedAttempt,
        projection: {
          ...base,
          state,
          detail: detailForState(state),
        },
      };
    }
    const clock = localBusinessClock(this.now(), context.businessTimezone);
    if (clock.businessDate !== context.businessDate) {
      throw new Error('store collection clock does not match the active Main business date');
    }
    const due = clock.localTime >= config.values.collectionScheduleLocalTime;
    const state = due ? 'due' : 'waiting';
    return {
      context,
      projection: {
        ...base,
        state,
        detail: detailForState(state),
      },
    };
  }

  async runNow(contextInput: StoreContextEnvelope): Promise<StoreCollectionScheduleRunResult> {
    const beforeReadback = this.readAuthorized(contextInput);
    const requested = beforeReadback.context;
    const beforeRun = beforeReadback.projection;
    if (beforeRun.state === 'failed' && beforeReadback.durable) {
      return this.resumeJob(requested, beforeReadback.durable.job.jobId);
    }
    const cycle = inspectManualCycle(await this.options.manualRun(requested), requested);
    const currentInput = this.options.authority.getActiveStoreContext();
    if (!currentInput) {
      throw new Error('Main active authority changed during manual run');
    }
    const current = this.options.authority.assertActiveStoreContext(currentInput);
    assertPostRunAuthority(requested, current);
    const readback = this.readAuthorized(current);
    assertManualRunScopeUnchanged(beforeRun, readback.projection);

    if (cycle.disposition === 'skipped') {
      if (!readback.durable && !readback.protectedAttempt) {
        throw new Error('manual duplicate has no exact durable or protected proof');
      }
      if (!['claimed', 'succeeded', 'failed'].includes(readback.projection.state)) {
        throw new Error('manual duplicate proof did not project an idempotent attempt state');
      }
      return {
        accepted: false,
        duplicate: true,
        projection: readback.projection,
        ...(readback.durable ? { job: rendererSafeJob(readback.durable.job) } : {}),
      };
    }

    const outcome = cycle.outcome;
    if (outcome.fingerprint !== readback.projection.fingerprint) {
      throw new Error('manual cycle outcome fingerprint does not match the refreshed projection');
    }
    const exactRequestId = readback.durable?.jobRow.requestId
      ?? readback.protectedAttempt?.semanticAttempt.schedulerRequestId;
    if (exactRequestId && outcome.requestId !== exactRequestId) {
      throw new Error('manual cycle outcome requestId does not match durable/protected authority');
    }
    if (!readback.durable && !readback.protectedAttempt) {
      if (!['due', 'waiting'].includes(readback.projection.state)
        || outcome.state !== 'blocked'
        || !isPreSchedulerIdentityFailure(outcome.failureCode)
        || outcome.requestId !== undefined) {
        throw new Error('record-free manual attempt lacks exact pre-scheduler identity block proof');
      }
    } else if (outcome.state === 'succeeded' && readback.projection.state === 'failed') {
      throw new Error('manual cycle success conflicts with the refreshed authority projection');
    } else if (outcome.state !== 'succeeded' && readback.projection.state === 'succeeded') {
      throw new Error('manual cycle failure conflicts with the refreshed authority projection');
    }
    return {
      accepted: true,
      duplicate: false,
      projection: readback.projection,
      ...(readback.durable ? { job: rendererSafeJob(readback.durable.job) } : {}),
    };
  }

  async resumeJob(
    contextInput: StoreContextEnvelope,
    jobIdInput: string,
    options: { deferReconciledCreateFailures?: boolean } = {},
  ): Promise<StoreCollectionScheduleRunResult> {
    const requested = this.options.authority.assertActiveStoreContext(contextInput);
    assertUsContext(requested);
    const jobId = selectedJobId(jobIdInput);
    const selected = this.options.importRepository.getCollectionJobForStore(
      requested.storeId,
      jobId,
    );
    if (!selected || selected.jobId !== jobId) throw new Error('selected collection job does not exist');
    const selectedContext = normalizeStoreContextEnvelope(selected.request.storeContext);
    if (selectedContext.storeId !== requested.storeId
      || selectedContext.browserProfileId !== requested.browserProfileId
      || selectedContext.businessDate !== requested.businessDate
      || selectedContext.sessionGeneration > requested.sessionGeneration) {
      throw new Error('selected collection job does not belong to the active Store authority');
    }
    const durable = this.options.importRepository
      .readUniqueCollectionAuthorityProofForStoreByRequestId(
        requested.storeId,
        selected.request.requestId,
      );
    if (!durable
      || durable.job.jobId !== jobId
      || !isDeepStrictEqual(durable.job, selected)) {
      throw new Error('selected failed job changed before its exact authority readback');
    }
    const before = classifySelectedDurableReadback(
      requested,
      durable,
      this.options.orchestrator,
      this.options.importRepository,
    );
    if (before.state === 'claimed' || before.state === 'succeeded') {
      return {
        accepted: false,
        duplicate: true,
        projection: selectedJobProjection(requested, before),
        job: rendererSafeJob(durable.job),
      };
    }
    const resumeState = this.options.importRepository.getCollectionInPlaceResumeStateForStore(
      requested.storeId,
      jobId,
    );
    if (!resumeState) {
      throw new Error('selected failed job has no exact resumable authority proof');
    }
    const request = {
      ...exactResumeRequest(requested, durable, resumeState),
      ...(options.deferReconciledCreateFailures === true
        ? { deferReconciledCreateFailures: true }
        : {}),
    };
    const previousReceipt = snapshotResumeReceipt(
      this.options.importRepository.readLatestCollectionResumeAttemptReceiptForStore(
        requested.storeId,
        request.jobId,
        request.requestId,
      ),
    );
    await this.options.resumeExisting(request);

    const currentInput = this.options.authority.getActiveStoreContext();
    if (!currentInput) throw new Error('Main active authority changed during same-job resume');
    const current = this.options.authority.assertActiveStoreContext(currentInput);
    assertPostRunAuthority(requested, current);
    const refreshed = this.options.importRepository
      .readUniqueCollectionAuthorityProofForStoreByRequestId(
        requested.storeId,
        request.requestId,
      );
    if (!refreshed
      || refreshed.job.jobId !== request.jobId
      || refreshed.job.request.requestId !== request.requestId) {
      throw new Error('same-job resume did not preserve the exact durable job/request identity');
    }
    const after = classifySelectedDurableReadback(
      current,
      refreshed,
      this.options.orchestrator,
      this.options.importRepository,
    );
    assertSelectedResumeScopeUnchanged(before, after);
    if (after.state !== 'failed' && after.state !== 'succeeded') {
      throw new Error('same-job resume did not settle as failed or succeeded');
    }
    const receipt = this.options.importRepository
      .readLatestCollectionResumeAttemptReceiptForStore(
        requested.storeId,
        durable.job.jobId,
        durable.job.request.requestId,
      );
    assertExactResumeAttemptReceipt({
      receipt,
      request,
      before: durable,
      after: refreshed,
      current,
      expectedOutcome: after.state,
      previousReceipt,
    });
    return {
      accepted: true,
      duplicate: false,
      projection: selectedJobProjection(current, after),
      job: rendererSafeJob(refreshed.job),
    };
  }
}

function assertManualRunScopeUnchanged(
  before: StoreCollectionScheduleProjection,
  after: StoreCollectionScheduleProjection,
): void {
  if (before.storeId !== after.storeId
    || before.businessDate !== after.businessDate
    || before.enabled !== after.enabled
    || before.scheduleLocalTime !== after.scheduleLocalTime
    || before.configRevision !== after.configRevision
    || before.dateStart !== after.dateStart
    || before.dateEnd !== after.dateEnd
    || before.fingerprint !== after.fingerprint) {
    throw new Error('manual run scope changed before exact result readback');
  }
}

interface AuthorizedReadback {
  context: StoreContextEnvelope;
  projection: StoreCollectionScheduleProjection;
  durable?: LingxingCollectionAuthorityProof;
  protectedAttempt?: Readonly<StoreCollectionProtectedSemanticAttemptReadback>;
}

interface ManualCycleOutcomeReadback {
  storeId: string;
  browserProfileId: string;
  businessDate: string;
  fingerprint: string;
  requestId?: string;
  state: 'succeeded' | 'blocked' | 'failed';
  failureCode?: string;
}

type ManualCycleReadback =
  | { disposition: 'skipped' }
  | { disposition: 'attempted'; outcome: ManualCycleOutcomeReadback };

interface SelectedDurableReadback {
  state: 'claimed' | 'succeeded' | 'failed';
  storeId: string;
  browserProfileId: string;
  businessDate: string;
  jobId: string;
  requestId: string;
  dateStart: string;
  dateEnd: string;
  fingerprint: string;
}

function selectedJobId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new TypeError('selected resume jobId must use 1-160 safe identity characters');
  }
  return value;
}

function classifySelectedDurableReadback(
  current: StoreContextEnvelope,
  proof: LingxingCollectionAuthorityProof,
  orchestrator: StoreCollectionSchedulerReadModelOptions['orchestrator'],
  repository: StoreCollectionSchedulerReadModelOptions['importRepository'],
): SelectedDurableReadback {
  const window = {
    dateStart: proof.job.request.dateStart,
    dateEnd: proof.job.request.dateEnd,
  };
  const lookbackDays = inclusiveWindowDays(window.dateStart, window.dateEnd);
  const expectedWindow = deriveWindow(current.businessDate, lookbackDays);
  if (expectedWindow.dateStart !== window.dateStart || expectedWindow.dateEnd !== window.dateEnd) {
    throw new Error('selected resume job window does not belong to its active business date');
  }
  const durableContext = assertDurableIdentity(current, window, proof);
  const state = classifyStoreCollectionDurableProof(proof, {
    context: durableContext,
    requestId: proof.job.request.requestId,
    ...window,
  });
  const fingerprint = semanticFingerprint({
    context: durableContext,
    lookbackDays,
    ...window,
  });
  const protectedAttempt = orchestrator.readProtectedSemanticAttempt({
    storeId: current.storeId,
    browserProfileId: current.browserProfileId,
    expectedFingerprint: fingerprint,
  });
  if (protectedAttempt) {
    const succeededResumeReceipt = state === 'succeeded'
      && (protectedAttempt.terminalOutcome?.state === 'failed'
        || protectedAttempt.terminalOutcome?.state === 'blocked')
      ? repository.readUniqueSucceededCollectionResumeReceiptForStore(
          current.storeId,
          proof.job.jobId,
          proof.job.request.requestId,
        )
      : undefined;
    assertProtectedIdentity(
      current,
      fingerprint,
      protectedAttempt,
      proof,
      state,
      succeededResumeReceipt,
    );
  }
  return {
    state,
    storeId: current.storeId,
    browserProfileId: current.browserProfileId,
    businessDate: current.businessDate,
    jobId: proof.job.jobId,
    requestId: proof.job.request.requestId,
    ...window,
    fingerprint,
  };
}

function inclusiveWindowDays(dateStart: string, dateEnd: string): number {
  const start = Date.parse(`${dateStart}T00:00:00.000Z`);
  const end = Date.parse(`${dateEnd}T00:00:00.000Z`);
  const value = (end - start) / 86_400_000 + 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > 90) {
    throw new Error('selected resume job lookback is outside 1..90 days');
  }
  return value;
}

function assertSelectedResumeScopeUnchanged(
  before: SelectedDurableReadback,
  after: SelectedDurableReadback,
): void {
  if (before.storeId !== after.storeId
    || before.browserProfileId !== after.browserProfileId
    || before.businessDate !== after.businessDate
    || before.jobId !== after.jobId
    || before.requestId !== after.requestId
    || before.dateStart !== after.dateStart
    || before.dateEnd !== after.dateEnd
    || before.fingerprint !== after.fingerprint) {
    throw new Error('selected same-job resume scope changed before exact result readback');
  }
}

function selectedJobProjection(
  current: StoreContextEnvelope,
  readback: SelectedDurableReadback,
): StoreCollectionScheduleProjection {
  return {
    storeId: current.storeId,
    businessDate: current.businessDate,
    enabled: true,
    state: readback.state,
    detail: detailForState(readback.state),
    dateStart: readback.dateStart,
    dateEnd: readback.dateEnd,
    fingerprint: readback.fingerprint,
  };
}

function exactResumeRequest(
  current: StoreContextEnvelope,
  proof: LingxingCollectionAuthorityProof,
  resume: CollectionInPlaceResumeState,
): StoreCollectionExistingResumeRequest {
  const durableContext = normalizeStoreContextEnvelope(proof.job.request.storeContext);
  const expectedDigest = fingerprintLingxingCollectionAuthorityProof(proof);
  if ((proof.job.state !== 'failed' && proof.job.state !== 'completed_with_errors')
    || !proof.batch
    || resume.jobId !== proof.job.jobId
    || resume.job.jobId !== proof.job.jobId
    || resume.request.requestId !== proof.job.request.requestId
    || resume.expectedJobUpdatedAt !== proof.job.updatedAt
    || resume.authorityProofSha256 !== expectedDigest
    || !isDeepStrictEqual(resume.job, proof.job)
    || !isDeepStrictEqual(resume.request, proof.job.request)
    || !isDeepStrictEqual(resume.batch, proof.batch)
    || !isDeepStrictEqual(resume.files, proof.lingxingFiles)
    || durableContext.storeId !== current.storeId
    || durableContext.browserProfileId !== current.browserProfileId
    || durableContext.businessDate !== current.businessDate
    || durableContext.sessionGeneration > current.sessionGeneration) {
    throw new Error('same-job resumable authority proof changed during exact double readback');
  }
  return Object.freeze({
    context: Object.freeze({ ...current }),
    jobId: proof.job.jobId,
    requestId: proof.job.request.requestId,
    dateStart: proof.job.request.dateStart,
    dateEnd: proof.job.request.dateEnd,
    expectedJobUpdatedAt: proof.job.updatedAt,
    expectedAuthorityProofSha256: expectedDigest,
  });
}

function assertExactResumeAttemptReceipt(input: {
  receipt: CollectionResumeAttemptReceipt | undefined;
  request: StoreCollectionExistingResumeRequest;
  before: LingxingCollectionAuthorityProof;
  after: LingxingCollectionAuthorityProof;
  current: StoreContextEnvelope;
  expectedOutcome: 'succeeded' | 'failed';
  previousReceipt: CollectionResumeAttemptReceipt | undefined;
}): void {
  const receipt = input.receipt;
  const durableContext = normalizeStoreContextEnvelope(input.before.job.request.storeContext);
  const beforeDigest = fingerprintLingxingCollectionAuthorityProof(input.before);
  const afterDigest = fingerprintLingxingCollectionAuthorityProof(input.after);
  if (!receipt
    || (input.previousReceipt && isDeepStrictEqual(input.previousReceipt, receipt))
    || receipt.storeId !== input.request.context.storeId
    || receipt.jobId !== input.request.jobId
    || receipt.requestId !== input.request.requestId
    || receipt.outcome !== input.expectedOutcome
    || receipt.baseJobUpdatedAt !== input.request.expectedJobUpdatedAt
    || receipt.baseJobUpdatedAt !== input.before.job.updatedAt
    || receipt.finalJobUpdatedAt !== input.after.job.updatedAt
    || receipt.baseAuthorityProofSha256 !== input.request.expectedAuthorityProofSha256
    || receipt.baseAuthorityProofSha256 !== beforeDigest
    || receipt.finalAuthorityProofSha256 !== afterDigest
    || receipt.durableSessionGeneration !== durableContext.sessionGeneration
    || receipt.executionSessionGeneration !== input.request.context.sessionGeneration
    || receipt.executionSessionGeneration > input.current.sessionGeneration
    || receipt.executionSessionGeneration < receipt.durableSessionGeneration
    || typeof receipt.attemptId !== 'string'
    || !/^[A-Za-z0-9._:-]{1,160}$/.test(receipt.attemptId)
    || !/^[a-f0-9]{64}$/.test(receipt.executionContextSha256)
    || receipt.executionContextSha256
      !== fingerprintCollectionResumeExecutionContext(input.request.context)
    || !orderedCanonicalInstants(
      receipt.baseJobUpdatedAt,
      receipt.claimedAt,
      receipt.finalJobUpdatedAt,
      receipt.completedAt,
    )) {
    throw new Error('same-job resume lacks one exact new append-only terminal attempt receipt');
  }
}

function snapshotResumeReceipt(
  value: CollectionResumeAttemptReceipt | undefined,
): CollectionResumeAttemptReceipt | undefined {
  return value ? Object.freeze({ ...value }) : undefined;
}

function orderedCanonicalInstants(...values: readonly string[]): boolean {
  if (values.some((value) => (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ))) return false;
  return values.every((value, index) => index === 0
    || Date.parse(values[index - 1]!) <= Date.parse(value));
}

function assertUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new Error('store collection read model requires US/USD/America/Los_Angeles authority');
  }
}

function assertPostRunAuthority(
  requested: StoreContextEnvelope,
  current: StoreContextEnvelope,
): void {
  if (current.storeId !== requested.storeId
    || current.browserProfileId !== requested.browserProfileId
    || current.marketplace !== requested.marketplace
    || current.currency !== requested.currency
    || current.businessTimezone !== requested.businessTimezone
    || current.businessDate !== requested.businessDate
    || !Number.isSafeInteger(current.sessionGeneration)
    || current.sessionGeneration < requested.sessionGeneration) {
    throw new Error('Main active authority changed during manual run');
  }
  assertUsContext(current);
}

function inspectManualCycle(
  value: unknown,
  requested: StoreContextEnvelope,
): ManualCycleReadback {
  const cycle = asRecord(value);
  if (cycle.state !== 'completed'
    || typeof cycle.cycleId !== 'string'
    || cycle.cycleId.trim().length === 0) {
    throw manualCycleAmbiguous();
  }
  const skipped = readStoreIds(cycle.skippedStoreIds);
  const planned = readStoreIds(cycle.plannedDueStoreIds);
  const attempted = readStoreIds(cycle.attemptedStoreIds);
  const outcomes = Array.isArray(cycle.outcomes) ? cycle.outcomes : null;
  if (!outcomes
    || [...skipped, ...planned, ...attempted].some((storeId) => storeId !== requested.storeId)) {
    throw manualCycleAmbiguous();
  }
  const exactSkipped = skipped.length === 1
    && planned.length === 0
    && attempted.length === 0;
  const exactAttempted = skipped.length === 0
    && planned.length === 1
    && attempted.length === 1;
  if (exactSkipped) {
    if (outcomes.length !== 0) throw manualCycleAmbiguous();
    return { disposition: 'skipped' };
  }
  if (!exactAttempted || outcomes.length !== 1) throw manualCycleAmbiguous();
  const rawOutcome = asRecord(outcomes[0]);
  const state = rawOutcome.state;
  const requestId = rawOutcome.requestId;
  const failureCode = rawOutcome.failureCode;
  if (rawOutcome.storeId !== requested.storeId
    || rawOutcome.browserProfileId !== requested.browserProfileId
    || rawOutcome.businessDate !== requested.businessDate
    || typeof rawOutcome.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(rawOutcome.fingerprint)
    || !['succeeded', 'blocked', 'failed'].includes(String(state))
    || (requestId !== undefined && (typeof requestId !== 'string' || requestId.trim().length === 0))
    || (failureCode !== undefined && typeof failureCode !== 'string')) {
    throw manualCycleAmbiguous();
  }
  return {
    disposition: 'attempted',
    outcome: {
      storeId: requested.storeId,
      browserProfileId: requested.browserProfileId,
      businessDate: requested.businessDate,
      fingerprint: rawOutcome.fingerprint,
      state: state as ManualCycleOutcomeReadback['state'],
      ...(requestId === undefined ? {} : { requestId }),
      ...(failureCode === undefined ? {} : { failureCode }),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw manualCycleAmbiguous();
  }
  return value as Record<string, unknown>;
}

function readStoreIds(value: unknown): string[] {
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || item.trim().length === 0)
    || new Set(value).size !== value.length) {
    throw manualCycleAmbiguous();
  }
  return value as string[];
}

function manualCycleAmbiguous(): Error {
  return new Error('manual cycle result is unrelated or ambiguous');
}

function isPreSchedulerIdentityFailure(value: unknown): boolean {
  return typeof value === 'string'
    && ['LOGIN_REQUIRED', 'REAUTH_REQUIRED', 'MFA_REQUIRED', 'IDENTITY_UNVERIFIED'].includes(value);
}

function assertConfig(
  context: StoreContextEnvelope,
  config: StoreRuntimeConfigRecord,
): void {
  if (config.storeId !== context.storeId
    || config.marketplace !== 'US'
    || config.currency !== 'USD'
    || config.businessTimezone !== 'America/Los_Angeles'
    || !['active', 'archived'].includes(config.status)
    || !Number.isSafeInteger(config.revision)
    || config.revision < 1
    || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(config.values?.collectionScheduleLocalTime)
    || !Number.isSafeInteger(config.values?.collectionLookbackDays)
    || config.values.collectionLookbackDays < 1
    || config.values.collectionLookbackDays > 90) {
    throw new Error('store collection config does not match the active US Store authority');
  }
}

function assertDurableIdentity(
  context: StoreContextEnvelope,
  window: { dateStart: string; dateEnd: string },
  proof: LingxingCollectionAuthorityProof,
): StoreContextEnvelope {
  let requestContext: StoreContextEnvelope;
  try {
    requestContext = normalizeStoreContextEnvelope(proof.job.request.storeContext);
  } catch {
    throw new Error('authority DB job identity mismatch');
  }
  const exactReports = proof.job.request.reportTypes;
  if (proof.jobRow.storeId !== context.storeId
    || proof.jobRow.browserProfileId !== context.browserProfileId
    || proof.jobRow.marketplace !== 'US'
    || proof.jobRow.currency !== 'USD'
    || proof.jobRow.businessTimezone !== 'America/Los_Angeles'
    || proof.jobRow.businessDate !== context.businessDate
    || proof.jobRow.dateStart !== window.dateStart
    || proof.jobRow.dateEnd !== window.dateEnd
    || proof.jobRow.mode !== 'create-and-download'
    || proof.jobRow.jobId !== proof.job.jobId
    || proof.jobRow.requestId !== proof.job.request.requestId
    || proof.jobRow.state !== proof.job.state
    || requestContext.storeId !== context.storeId
    || requestContext.browserProfileId !== context.browserProfileId
    || requestContext.marketplace !== 'US'
    || requestContext.currency !== 'USD'
    || requestContext.businessTimezone !== 'America/Los_Angeles'
    || requestContext.businessDate !== context.businessDate
    || requestContext.sessionGeneration !== proof.jobRow.sessionGeneration
    || requestContext.sessionGeneration > context.sessionGeneration
    || proof.job.request.dateStart !== window.dateStart
    || proof.job.request.dateEnd !== window.dateEnd
    || proof.job.request.mode !== 'create-and-download'
    || exactReports.length !== ANALYSIS_REQUIRED_REPORT_TYPES.length
    || new Set(exactReports).size !== ANALYSIS_REQUIRED_REPORT_TYPES.length
    || ANALYSIS_REQUIRED_REPORT_TYPES.some((reportType) => !exactReports.includes(reportType))) {
    throw new Error('authority DB job identity mismatch');
  }
  return requestContext;
}

function assertProtectedIdentity(
  context: StoreContextEnvelope,
  fingerprint: string,
  protectedReadback: Readonly<StoreCollectionProtectedSemanticAttemptReadback>,
  durable?: LingxingCollectionAuthorityProof,
  durableState?: 'claimed' | 'succeeded' | 'failed',
  succeededResumeReceipt?: CollectionResumeAttemptReceipt,
): void {
  const semantic = protectedReadback.semanticAttempt;
  const terminal = protectedReadback.terminalOutcome;
  const semanticMatches = semantic.storeId === context.storeId
    && semantic.browserProfileId === context.browserProfileId
    && semantic.businessDate === context.businessDate
    && semantic.expectedFingerprint === fingerprint
    && Number.isSafeInteger(semantic.sessionGeneration)
    && semantic.sessionGeneration <= context.sessionGeneration
    && typeof semantic.schedulerRequestId === 'string'
    && semantic.schedulerRequestId.length > 0;
  const terminalMatches = !terminal || (
    terminal.cycleId === semantic.cycleId
    && terminal.transitionId === semantic.transitionId
    && terminal.storeId === semantic.storeId
    && terminal.browserProfileId === semantic.browserProfileId
    && terminal.businessDate === semantic.businessDate
    && terminal.sessionGeneration === semantic.sessionGeneration
    && terminal.fingerprint === semantic.expectedFingerprint
    && terminal.attemptId === semantic.schedulerAttemptId
    && terminal.requestId === semantic.schedulerRequestId
  );
  const durableMatches = !durable
    || (durable.jobRow.requestId === semantic.schedulerRequestId
      && durable.jobRow.sessionGeneration === semantic.sessionGeneration);
  const terminalStateMatches = !durable || durableProtectedTerminalMatches(
    durableState,
    terminal?.state ?? null,
    context,
    durable,
    succeededResumeReceipt,
  );
  if (!semanticMatches || !terminalMatches || !durableMatches || !terminalStateMatches) {
    throw new Error('authority DB/protected semantic attempt identity mismatch');
  }
}

function durableProtectedTerminalMatches(
  durableState: 'claimed' | 'succeeded' | 'failed' | undefined,
  protectedTerminal: 'succeeded' | 'blocked' | 'failed' | null,
  current: StoreContextEnvelope,
  durable: LingxingCollectionAuthorityProof,
  succeededResumeReceipt?: CollectionResumeAttemptReceipt,
): boolean {
  if (!durableState) return false;
  if (protectedTerminal === null) return durableState === 'claimed';
  if (protectedTerminal === 'succeeded') return durableState === 'succeeded';
  if (durableState === 'succeeded') {
    return exactSucceededResumeReceipt(current, durable, succeededResumeReceipt);
  }
  return durableState === 'failed';
}

function exactSucceededResumeReceipt(
  current: StoreContextEnvelope,
  durable: LingxingCollectionAuthorityProof,
  receipt: CollectionResumeAttemptReceipt | undefined,
): boolean {
  if (!receipt) return false;
  const durableContext = normalizeStoreContextEnvelope(durable.job.request.storeContext);
  const executionContext = Object.freeze({
    ...current,
    sessionGeneration: receipt.executionSessionGeneration,
  });
  return receipt.storeId === durable.jobRow.storeId
    && receipt.jobId === durable.job.jobId
    && receipt.requestId === durable.job.request.requestId
    && receipt.outcome === 'succeeded'
    && receipt.finalJobUpdatedAt === durable.job.updatedAt
    && receipt.finalAuthorityProofSha256
      === fingerprintLingxingCollectionAuthorityProof(durable)
    && receipt.durableSessionGeneration === durableContext.sessionGeneration
    && receipt.executionSessionGeneration >= receipt.durableSessionGeneration
    && receipt.executionSessionGeneration <= current.sessionGeneration
    && receipt.executionContextSha256
      === fingerprintCollectionResumeExecutionContext(executionContext)
    && /^[A-Za-z0-9._:-]{1,160}$/.test(receipt.attemptId)
    && /^[a-f0-9]{64}$/.test(receipt.baseAuthorityProofSha256)
    && receipt.baseAuthorityProofSha256 !== receipt.finalAuthorityProofSha256
    && orderedCanonicalInstants(
      receipt.baseJobUpdatedAt,
      receipt.claimedAt,
      receipt.finalJobUpdatedAt,
      receipt.completedAt,
    );
}

function rendererSafeJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
  const context = normalizeStoreContextEnvelope(job.request.storeContext);
  return {
    jobId: job.jobId,
    request: {
      requestId: job.request.requestId,
      storeContext: {
        storeId: context.storeId,
        browserProfileId: context.browserProfileId,
        marketplace: context.marketplace,
        currency: context.currency,
        businessTimezone: context.businessTimezone,
        businessDate: context.businessDate,
        sessionGeneration: context.sessionGeneration,
      },
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      mode: job.request.mode,
      reportTypes: [...job.request.reportTypes],
    },
    ...(job.lineage ? {
      lineage: {
        lineageId: job.lineage.lineageId,
        rootJobId: job.lineage.rootJobId,
        ...(job.lineage.parentJobId ? { parentJobId: job.lineage.parentJobId } : {}),
        expectedReportTypes: [...job.lineage.expectedReportTypes],
        purpose: job.lineage.purpose,
      },
    } : {}),
    state: job.state,
    reports: job.reports.map((report) => ({
      reportType: report.reportType,
      state: report.state,
      attemptIndex: report.attemptIndex,
      autoRetryCount: report.autoRetryCount,
      ...(report.createdReportIdentity ? {
        createdReportIdentity: {
          provider: report.createdReportIdentity.provider,
          reportType: report.createdReportIdentity.reportType,
          externalReportName: report.createdReportIdentity.externalReportName,
          ...(report.createdReportIdentity.externalReportId === undefined
            ? {}
            : { externalReportId: report.createdReportIdentity.externalReportId }),
          dateStart: report.createdReportIdentity.dateStart,
          dateEnd: report.createdReportIdentity.dateEnd,
          createdAt: report.createdReportIdentity.createdAt,
        },
      } : {}),
      ...(report.fileSizeBytes === undefined ? {} : { fileSizeBytes: report.fileSizeBytes }),
      ...(report.errorCode === undefined ? {} : { errorCode: report.errorCode }),
      updatedAt: report.updatedAt,
    })),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    ...(job.blockerCode === undefined ? {} : { blockerCode: job.blockerCode }),
    ...(job.importState === undefined ? {} : { importState: job.importState }),
    ...(job.importAttemptedAt === undefined ? {} : { importAttemptedAt: job.importAttemptedAt }),
    ...(job.importCompletedAt === undefined ? {} : { importCompletedAt: job.importCompletedAt }),
  };
}

function detailForState(
  state: 'waiting' | 'due' | 'claimed' | 'succeeded' | 'failed',
): string {
  switch (state) {
    case 'waiting': return '等待当前店铺配置的采集时间。';
    case 'due': return '已到当前店铺配置的采集时间。';
    case 'claimed': return '当前店铺采集任务已持久认领，正在等待采集或导入终结。';
    case 'succeeded': return '当前店铺本业务日采集与导入已完成。';
    case 'failed': return '当前店铺本业务日采集链已失败关闭，不会自动重试。';
  }
}

function deriveWindow(
  businessDate: string,
  lookbackDays: number,
): { dateStart: string; dateEnd: string } {
  const dateEnd = shiftIsoDate(businessDate, -1);
  return {
    dateStart: shiftIsoDate(dateEnd, -(lookbackDays - 1)),
    dateEnd,
  };
}

function shiftIsoDate(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('store collection business date is invalid');
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function semanticFingerprint(input: {
  context: StoreContextEnvelope;
  lookbackDays: number;
  dateStart: string;
  dateEnd: string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    collectionContractVersion: 'lingxing-us-ads-full8-v1',
    storeId: input.context.storeId,
    browserProfileId: input.context.browserProfileId,
    businessDate: input.context.businessDate,
    lookbackDays: input.lookbackDays,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  })).digest('hex');
}

function localBusinessClock(now: Date, timeZone: string): {
  businessDate: string;
  localTime: string;
} {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('store collection clock is invalid');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((part) => part.type === type)?.value ?? ''
  );
  return {
    businessDate: `${read('year')}-${read('month')}-${read('day')}`,
    localTime: `${read('hour')}:${read('minute')}`,
  };
}
