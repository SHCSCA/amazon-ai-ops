import { isDeepStrictEqual } from 'node:util';
import type {
  StoreConnection,
  StoreContextEnvelope,
  StoreId,
} from '@amazon-ai-ops/shared-types';
import {
  fingerprintCollectionResumeExecutionContext,
  fingerprintLingxingCollectionAuthorityProof,
  type CollectionInPlaceResumeState,
  type CollectionResumeAttemptReceipt,
  type LingxingCollectionAuthorityProof,
  type LingxingImportRepository,
} from '@amazon-ai-ops/local-db';
import type {
  LingxingCollectionCoordinator,
} from './lingxing-collection-coordinator';
import {
  StoreCollectionMainRuntime,
  type StoreCollectionMainCycleResult,
  type StoreCollectionMainOrchestratorPort,
  type StoreCollectionExistingResumeRequest,
  type StoreCollectionManualCycleAdmission,
  type StoreCollectionManualCyclePreMutationReason,
  type StoreCollectionManualCycleResult,
} from './store-collection-main-runtime';
import {
  StoreCollectionOrchestrator,
  StoreCollectionOrchestratorError,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionExecutionAutomationAuthority,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionOrchestratorHistoryPort,
  type StoreCollectionOrchestratorRecordCodec,
} from './store-collection-orchestrator';
import {
  StoreCollectionOrchestratorDomainAdapter,
  type StoreCollectionOrchestratorDomainAdapterOptions,
} from './store-collection-orchestrator-domain-adapter';
import {
  StoreCollectionOrchestratorSchedulerAdapter,
  type StoreCollectionOrchestratorSchedulerAdapterOptions,
} from './store-collection-orchestrator-scheduler-adapter';
import {
  StoreCollectionOrchestratorVisibleRuntimeAdapter,
  type StoreCollectionVisibleRuntimeAdapterOptions,
} from './store-collection-orchestrator-visible-runtime-adapter';
import {
  StoreCollectionPolicySuppressionController,
} from './store-collection-policy-suppression';
import {
  StoreCollectionSchedulerReadModel,
  type StoreCollectionSchedulerReadModelOptions,
} from './store-collection-scheduler-read-model';
import {
  StoreCoordinatorError,
} from './store-coordinator';
import type { StoreRuntimeConfigService } from './store-runtime-config-service';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
} from './visible-browser-runtime-registry';

const AUTOMATION_OWNER = 'store-collection-production-runtime';

type ProductionStoreCoordinator = StoreCollectionOrchestratorDomainAdapterOptions['coordinator']
  & StoreCollectionSchedulerReadModelOptions['authority']
  & {
    listConnections(storeId: StoreId): readonly StoreConnection[];
  };

type ProductionRuntimeConfig = StoreCollectionOrchestratorDomainAdapterOptions['config']
  & StoreCollectionOrchestratorSchedulerAdapterOptions['config']
  & Pick<StoreRuntimeConfigService, 'get'>;

type ProductionImportRepository = StoreCollectionOrchestratorDomainAdapterOptions['repository']
  & StoreCollectionOrchestratorSchedulerAdapterOptions['repository']
  & StoreCollectionSchedulerReadModelOptions['importRepository']
  & Pick<LingxingImportRepository, 'interruptOrphanedCollectionResumeClaimsForStartup'>;

type ProductionLingxingCoordinator = Pick<
  LingxingCollectionCoordinator,
  'start' | 'resumeInPlace'
>;

interface ProductionMainRuntimeTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface StoreCollectionProductionCompositionOptions {
  /** These are process singletons shared with every Store mutation path. */
  registry: VisibleBrowserRuntimeRegistry;
  mutationLane: StoreMutationLane;
  policySuppression: StoreCollectionPolicySuppressionController;
  storeCoordinator: ProductionStoreCoordinator;
  runtimeConfig: ProductionRuntimeConfig;
  lingxingCoordinator: ProductionLingxingCoordinator;
  importRepository: ProductionImportRepository;
  settings: Readonly<{
    history: StoreCollectionOrchestratorHistoryPort;
    recordCodec: StoreCollectionOrchestratorRecordCodec;
  }>;
  browser: Readonly<{
    leases: StoreCollectionVisibleRuntimeAdapterOptions['browserLeases'];
    resolveStoreCapsule: StoreCollectionVisibleRuntimeAdapterOptions['resolveStoreCapsule'];
    createHeadedBrowserController:
      StoreCollectionVisibleRuntimeAdapterOptions['createHeadedBrowserController'];
    inspectLingxingIdentity?: StoreCollectionVisibleRuntimeAdapterOptions['inspectLingxingIdentity'];
  }>;
  sessionMetadata: Readonly<{
    withLingxingReadyMetadataTransaction:
      StoreCollectionVisibleRuntimeAdapterOptions['withLingxingReadyMetadataTransaction'];
  }>;
  authorityReadback: Readonly<{
    readCurrentAuthority(): StoreCollectionAuthorityReadback;
  }>;
  /** This flag is consumed only by StoreCollectionMainRuntime. */
  packageUiReadOnly?: boolean;
  mainRuntime?: Readonly<{
    pollIntervalMs?: number;
    timer?: ProductionMainRuntimeTimer;
    createAuthorityCapability?: () => Readonly<object>;
    createManualCycleAdmissionCapability?: () => Readonly<object>;
    reportError?: (error: unknown) => void;
  }>;
  now?: () => Date;
  createCycleId?: () => string;
  historyRetentionLimit?: number;
  onError?: (error: unknown) => void;
  /**
   * Re-publishes the active Main authority after every attempted orchestrator
   * entry point, including rejection/failure paths that may have restored or
   * advanced a Store session generation.
   */
  onAuthoritySettled?: () => void | Promise<void>;
}

export interface StoreCollectionProductionComposition {
  runtime: StoreCollectionMainRuntime;
  orchestrator: StoreCollectionOrchestrator;
  schedulerReadModel: StoreCollectionSchedulerReadModel;
  registry: VisibleBrowserRuntimeRegistry;
  mutationLane: StoreMutationLane;
  policySuppression: StoreCollectionPolicySuppressionController;
}

/**
 * Main-process production composition root. Construction is intentionally
 * inert: timers, headed Chromium, Lingxing navigation and database writes can
 * begin only through StoreCollectionMainRuntime lifecycle methods.
 */
export function createStoreCollectionProductionComposition(
  options: StoreCollectionProductionCompositionOptions,
): StoreCollectionProductionComposition {
  const domain = new StoreCollectionOrchestratorDomainAdapter({
    coordinator: options.storeCoordinator,
    config: options.runtimeConfig,
    repository: options.importRepository,
    ...(options.now ? { now: options.now } : {}),
  });
  const scheduler = new StoreCollectionOrchestratorSchedulerAdapter({
    domain,
    config: options.runtimeConfig,
    coordinator: options.lingxingCoordinator,
    repository: options.importRepository,
  });
  const visibleRuntime = new StoreCollectionOrchestratorVisibleRuntimeAdapter({
    registry: options.registry,
    browserLeases: options.browser.leases,
    assertTransitionAuthority: (authority) => domain.assertTransitionAuthority(authority),
    readCurrentAuthority: () => options.authorityReadback.readCurrentAuthority(),
    listActiveStores: () => domain.listActiveStores(),
    listStoreConnections: (storeId) => options.storeCoordinator.listConnections(storeId),
    resolveStoreCapsule: options.browser.resolveStoreCapsule,
    createHeadedBrowserController: options.browser.createHeadedBrowserController,
    ...(options.browser.inspectLingxingIdentity
      ? { inspectLingxingIdentity: options.browser.inspectLingxingIdentity }
      : {}),
    withLingxingReadyMetadataTransaction:
      options.sessionMetadata.withLingxingReadyMetadataTransaction,
    ...(options.now ? { now: options.now } : {}),
  });

  const dependencies: StoreCollectionOrchestratorDependencies = {
    listActiveStores: () => domain.listActiveStores(),
    inspectStoreSchedule: (store) => domain.inspectStoreSchedule(store),
    inspectManualStoreSchedule: (store, context) => (
      domain.inspectManualStoreSchedule(store, context)
    ),
    getActiveStoreId: () => domain.getActiveStoreId(),
    acquireAutomationLease: async () => createAutomationLease(domain),
    registerSchedulerRecoveryAdmission: (input) => (
      domain.registerSchedulerRecoveryAdmission(input)
    ),
    deriveTransitionCapability: (input) => domain.deriveTransitionCapability(input),
    acquirePolicyDispatchSuppression: (authority) => (
      options.policySuppression.acquirePolicyDispatchSuppression(authority)
    ),
    readPolicyDispatchSuppression: (input) => (
      options.policySuppression.readPolicyDispatchSuppression(input)
    ),
    transitionAuthorityForCollection: (input) => (
      domain.transitionAuthorityForCollection(input)
    ),
    readActiveAuthority: (input) => domain.readActiveAuthority(input),
    readTransitionAuthority: async (input) => ({
      ...input,
      authority: readExactTransitionAuthority(options.authorityReadback, input),
    }),
    closeVisibleRuntime: (input) => visibleRuntime.closeVisibleRuntime(input),
    assertCollectionLeaseReleased: (input) => (
      visibleRuntime.assertCollectionLeaseReleased(input)
    ),
    startCollectionOnlyVisibleRuntime: (input) => (
      visibleRuntime.startCollectionOnlyVisibleRuntime(input)
    ),
    verifyVisibleLingxingIdentity: (input) => (
      visibleRuntime.verifyVisibleLingxingIdentity(input)
    ),
    scheduler,
    history: options.settings.history,
    recordCodec: options.settings.recordCodec,
    ...(options.now ? { now: options.now } : {}),
    ...(options.createCycleId ? { createCycleId: options.createCycleId } : {}),
    ...(options.historyRetentionLimit === undefined
      ? {}
      : { historyRetentionLimit: options.historyRetentionLimit }),
    ...(options.onError ? { onError: options.onError } : {}),
  };
  const orchestrator = new StoreCollectionOrchestrator(dependencies);
  const mainPort = createMainOrchestratorPort(
    orchestrator,
    createAuthoritySettledNotifier(options),
    () => options.importRepository.interruptOrphanedCollectionResumeClaimsForStartup(),
    (input) => resumeExistingCollection(options, input),
  );
  const runtime = new StoreCollectionMainRuntime({
    orchestrator: mainPort,
    registry: options.registry,
    mutationLane: options.mutationLane,
    policySuppression: options.policySuppression,
    packageUiReadOnly: options.packageUiReadOnly,
    ...(options.mainRuntime?.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: options.mainRuntime.pollIntervalMs }),
    ...(options.mainRuntime?.timer ? { timer: options.mainRuntime.timer } : {}),
    ...(options.mainRuntime?.createAuthorityCapability
      ? { createAuthorityCapability: options.mainRuntime.createAuthorityCapability }
      : {}),
    ...(options.mainRuntime?.createManualCycleAdmissionCapability
      ? {
          createManualCycleAdmissionCapability:
            options.mainRuntime.createManualCycleAdmissionCapability,
        }
      : {}),
    ...(options.mainRuntime?.reportError
      ? { reportError: options.mainRuntime.reportError }
      : {}),
  });
  const schedulerReadModel = new StoreCollectionSchedulerReadModel({
    authority: options.storeCoordinator,
    runtimeConfig: options.runtimeConfig,
    importRepository: options.importRepository,
    orchestrator,
    manualRun: (context) => runtime.runNow(context),
    resumeExisting: (input) => runtime.resumeExisting(input),
    ...(options.now ? { now: options.now } : {}),
  });

  return Object.freeze({
    runtime,
    orchestrator,
    schedulerReadModel,
    registry: options.registry,
    mutationLane: options.mutationLane,
    policySuppression: options.policySuppression,
  });
}

async function resumeExistingCollection(
  options: StoreCollectionProductionCompositionOptions,
  input: StoreCollectionExistingResumeRequest,
): Promise<StoreCollectionMainCycleResult> {
  const current = normalizeContext(input.context);
  const resumeFrom = options.importRepository.getCollectionInPlaceResumeStateForStore(
    current.storeId,
    input.jobId,
  );
  if (!resumeFrom) throw new Error('selected same-job resume state disappeared before execution');
  const durableContext = normalizeContext(resumeFrom.job.request.storeContext);
  if (resumeFrom.jobId !== input.jobId
    || resumeFrom.job.jobId !== input.jobId
    || resumeFrom.request.requestId !== input.requestId
    || resumeFrom.job.request.requestId !== input.requestId
    || resumeFrom.request.dateStart !== input.dateStart
    || resumeFrom.request.dateEnd !== input.dateEnd
    || resumeFrom.job.request.dateStart !== input.dateStart
    || resumeFrom.job.request.dateEnd !== input.dateEnd
    || resumeFrom.expectedJobUpdatedAt !== input.expectedJobUpdatedAt
    || resumeFrom.job.updatedAt !== input.expectedJobUpdatedAt
    || resumeFrom.authorityProofSha256 !== input.expectedAuthorityProofSha256
    || (resumeFrom.job.state !== 'failed' && resumeFrom.job.state !== 'completed_with_errors')
    || resumeFrom.batch.storeId !== current.storeId
    || resumeFrom.batch.id !== input.jobId
    || resumeFrom.batch.requestId !== input.requestId
    || durableContext.storeId !== current.storeId
    || durableContext.browserProfileId !== current.browserProfileId
    || durableContext.businessDate !== current.businessDate
    || durableContext.sessionGeneration > current.sessionGeneration) {
    throw new Error('selected same-job resume packet does not match its exact MainRuntime CAS');
  }
  const previousReceipt = snapshotReceipt(
    options.importRepository.readLatestCollectionResumeAttemptReceiptForStore(
      current.storeId,
      input.jobId,
      input.requestId,
    ),
  );
  const coordinatorResult = await options.lingxingCoordinator.resumeInPlace({
    currentStoreContext: current,
    resumeFrom,
    ...(input.deferReconciledCreateFailures === true
      ? { deferReconciledCreateFailures: true }
      : {}),
  });
  const settlement = requireExactResumeSettlement(
    options,
    input,
    resumeFrom,
    previousReceipt,
    coordinatorResult,
  );
  return {
    state: 'completed',
    outcome: settlement.outcome,
    storeId: current.storeId,
    browserProfileId: current.browserProfileId,
    businessDate: current.businessDate,
    jobId: input.jobId,
    requestId: input.requestId,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  };
}

interface ExactResumeSettlement {
  outcome: 'succeeded' | 'failed';
  proof: LingxingCollectionAuthorityProof;
  receipt: CollectionResumeAttemptReceipt;
}

function requireExactResumeSettlement(
  options: StoreCollectionProductionCompositionOptions,
  input: StoreCollectionExistingResumeRequest,
  resumeFrom: CollectionInPlaceResumeState,
  previousReceipt: CollectionResumeAttemptReceipt | undefined,
  coordinatorResult: Awaited<ReturnType<ProductionLingxingCoordinator['resumeInPlace']>>,
): ExactResumeSettlement {
  const proof = options.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId(
    input.context.storeId,
    input.requestId,
  );
  const receipt = options.importRepository.readLatestCollectionResumeAttemptReceiptForStore(
    input.context.storeId,
    input.jobId,
    input.requestId,
  );
  if (!proof || !receipt || (previousReceipt && isDeepStrictEqual(previousReceipt, receipt))) {
    throw new Error('same-job resume did not append one new exact terminal receipt');
  }
  const durableContext = normalizeContext(resumeFrom.request.storeContext);
  const executionContext = normalizeContext(input.context);
  const job = proof.job;
  const succeeded = job.state === 'completed' && job.importState === 'succeeded';
  const failed = job.state === 'failed'
    || job.state === 'cancelled'
    || job.state === 'stale_authority'
    || job.state === 'completed_with_errors'
    || (job.state === 'completed' && job.importState === 'failed');
  const outcome = succeeded ? 'succeeded' : failed ? 'failed' : undefined;
  const coordinatorJob = coordinatorResult.result.job;
  const coordinatorContext = normalizeContext(coordinatorJob.request.storeContext);
  const coordinatorSucceeded = coordinatorJob.state === 'completed'
    && coordinatorJob.importState === 'succeeded';
  const coordinatorFailed = coordinatorJob.state === 'failed'
    || coordinatorJob.state === 'cancelled'
    || coordinatorJob.state === 'stale_authority'
    || coordinatorJob.state === 'completed_with_errors'
    || (coordinatorJob.state === 'completed' && coordinatorJob.importState === 'failed');
  const coordinatorOutcome = coordinatorSucceeded
    ? 'succeeded'
    : coordinatorFailed ? 'failed' : undefined;
  const finalProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
  if (!outcome
    || job.jobId !== input.jobId
    || job.request.requestId !== input.requestId
    || !isDeepStrictEqual(job.request, resumeFrom.job.request)
    || proof.jobRow.storeId !== executionContext.storeId
    || proof.jobRow.jobId !== input.jobId
    || proof.jobRow.requestId !== input.requestId
    || proof.jobRow.browserProfileId !== durableContext.browserProfileId
    || proof.jobRow.businessDate !== durableContext.businessDate
    || proof.jobRow.sessionGeneration !== durableContext.sessionGeneration
    || proof.jobRow.dateStart !== input.dateStart
    || proof.jobRow.dateEnd !== input.dateEnd
    || proof.jobRow.state !== job.state
    || proof.jobRow.updatedAt !== job.updatedAt
    || coordinatorOutcome !== outcome
    || coordinatorJob.jobId !== input.jobId
    || !isDeepStrictEqual(coordinatorJob.request, resumeFrom.job.request)
    || coordinatorContext.storeId !== durableContext.storeId
    || coordinatorContext.browserProfileId !== durableContext.browserProfileId
    || coordinatorContext.businessDate !== durableContext.businessDate
    || coordinatorContext.sessionGeneration !== durableContext.sessionGeneration
    || receipt.storeId !== executionContext.storeId
    || receipt.jobId !== input.jobId
    || receipt.requestId !== input.requestId
    || receipt.outcome !== outcome
    || receipt.baseJobUpdatedAt !== input.expectedJobUpdatedAt
    || receipt.baseAuthorityProofSha256 !== input.expectedAuthorityProofSha256
    || receipt.finalJobUpdatedAt !== job.updatedAt
    || receipt.finalAuthorityProofSha256 !== finalProofSha256
    || receipt.durableSessionGeneration !== durableContext.sessionGeneration
    || receipt.executionSessionGeneration !== executionContext.sessionGeneration
    || receipt.executionContextSha256
      !== fingerprintCollectionResumeExecutionContext(executionContext)
    || !/^[A-Za-z0-9._:-]{1,160}$/.test(receipt.attemptId)
    || !orderedCanonicalInstants(
      receipt.baseJobUpdatedAt,
      receipt.claimedAt,
      receipt.finalJobUpdatedAt,
      receipt.completedAt,
    )) {
    throw new Error('same-job resume terminal receipt does not bind the exact final authority proof');
  }
  return { outcome, proof, receipt };
}

function snapshotReceipt(
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

function createAutomationLease(
  domain: StoreCollectionOrchestratorDomainAdapter,
): Awaited<ReturnType<StoreCollectionOrchestratorDependencies['acquireAutomationLease']>> {
  const authority = domain.issueAutomationAuthority(AUTOMATION_OWNER);
  let active = true;
  return {
    ...authority,
    async release() {
      if (!active) throw new Error('production automation lease release was replayed');
      active = false;
      domain.retireAutomationAuthority(authority);
      return { ...authority, released: true };
    },
  };
}

function createMainOrchestratorPort(
  orchestrator: StoreCollectionOrchestrator,
  notifyAuthoritySettled: () => Promise<void>,
  interruptOrphanResumeClaims: () => unknown,
  resumeExisting: (
    input: StoreCollectionExistingResumeRequest,
  ) => Promise<StoreCollectionMainCycleResult>,
): StoreCollectionMainOrchestratorPort {
  return {
    recoverExistingTransitionsOnly: () => withAuthoritySettled(
      async () => {
        interruptOrphanResumeClaims();
        return mainCycleResult(await orchestrator.recoverExistingTransitionsOnly());
      },
      notifyAuthoritySettled,
    ),
    runScheduledCycle: () => withAuthoritySettled(
      async () => mainCycleResult(await orchestrator.runCycle()),
      notifyAuthoritySettled,
    ),
    manualCycle: (context, admission) => withAuthoritySettled(
      () => manualCycle(orchestrator, context, admission),
      notifyAuthoritySettled,
    ),
    resumeExisting: (input) => withAuthoritySettled(
      () => resumeExisting(input),
      notifyAuthoritySettled,
    ),
    stopAndDrain: (timeoutMs) => orchestrator.stopAndDrain(timeoutMs),
    assertUserOperationAllowed: () => orchestrator.assertUserOperationAllowed(),
    isTransitionLocked: () => orchestrator.isTransitionLocked(),
  };
}

function createAuthoritySettledNotifier(
  options: StoreCollectionProductionCompositionOptions,
): () => Promise<void> {
  const report = options.mainRuntime?.reportError ?? options.onError;
  return async () => {
    if (!options.onAuthoritySettled) return;
    try {
      await options.onAuthoritySettled();
    } catch (error) {
      try {
        report?.(error);
      } catch {
        // Authority notification is observational. A broken reporter cannot
        // rewrite the already-settled orchestration result either.
      }
    }
  };
}

async function withAuthoritySettled<Result>(
  work: () => Promise<Result>,
  notifyAuthoritySettled: () => Promise<void>,
): Promise<Result> {
  try {
    return await work();
  } finally {
    await notifyAuthoritySettled();
  }
}

async function manualCycle(
  orchestrator: StoreCollectionOrchestrator,
  context: StoreContextEnvelope,
  admission: StoreCollectionManualCycleAdmission,
): Promise<StoreCollectionManualCycleResult> {
  if (admission.context !== context) {
    throw new Error('manual collection admission is not bound to the exact Main context object');
  }
  try {
    return mainCycleResult(await orchestrator.runStoreNow(context));
  } catch (error) {
    const reason = trustedManualAdmissionRejection(error);
    if (reason) return exactAdmissionRejection(admission, reason);
    throw error;
  }
}

function mainCycleResult(
  result: Awaited<ReturnType<StoreCollectionOrchestrator['runCycle']>>,
): StoreCollectionMainCycleResult {
  const projection: StoreCollectionMainCycleResult = { ...result };
  return projection;
}

function trustedManualAdmissionRejection(
  error: unknown,
): StoreCollectionManualCyclePreMutationReason | null {
  if (error instanceof StoreCollectionOrchestratorError
    && error.code === 'USER_OPERATION_BLOCKED') {
    return 'MANUAL_COLLECTION_NOT_ADMITTED';
  }
  if (!(error instanceof StoreCoordinatorError)) return null;
  if (error.code === 'STORE_NOT_ACTIVE') return 'STORE_NOT_ACTIVE';
  // StoreCoordinator emits STALE_STORE_CONTEXT only after its exact
  // SessionGenerationAuthority check fails; identity/date mismatches use the
  // distinct STORE_CONTEXT_MISMATCH code and remain hard failures here.
  if (error.code === 'STALE_STORE_CONTEXT') return 'SESSION_GENERATION_MISMATCH';
  return null;
}

function exactAdmissionRejection(
  admission: StoreCollectionManualCycleAdmission,
  reason: StoreCollectionManualCyclePreMutationReason,
): StoreCollectionManualCycleResult {
  return Object.freeze({
    state: 'rejected',
    mutationStarted: false,
    reason,
    admission,
  });
}

function readExactTransitionAuthority(
  reader: StoreCollectionProductionCompositionOptions['authorityReadback'],
  input: StoreCollectionExecutionAutomationAuthority & {
    expectedAuthority: StoreCollectionAuthorityReadback;
  },
): StoreCollectionAuthorityReadback {
  const expected = normalizeAuthority(input.expectedAuthority);
  // Two independent Main reads close the composition-level TOCTOU gap. The
  // orchestrator performs its own capability-bound exact comparison on the
  // returned confirmation as a separate validation layer.
  const before = normalizeAuthority(reader.readCurrentAuthority());
  assertSameAuthority(before, expected);
  const after = normalizeAuthority(reader.readCurrentAuthority());
  assertSameAuthority(after, expected);
  assertSameAuthority(after, before);
  return after;
}

function normalizeAuthority(
  authority: StoreCollectionAuthorityReadback,
): StoreCollectionAuthorityReadback {
  if (!authority || typeof authority !== 'object') {
    throw new Error('Main authority readback is missing');
  }
  if (authority.activeStoreId === null) {
    if (authority.context !== null) {
      throw new Error('empty Main authority cannot carry a Store context');
    }
    return Object.freeze({ activeStoreId: null, context: null });
  }
  const context = normalizeContext(authority.context);
  if (context.storeId !== authority.activeStoreId) {
    throw new Error('Main authority Store id does not match its context');
  }
  return Object.freeze({ activeStoreId: context.storeId, context });
}

function normalizeContext(value: StoreContextEnvelope | null): StoreContextEnvelope {
  if (!value) throw new Error('active Main authority requires one Store context');
  if (value.marketplace !== 'US'
    || value.currency !== 'USD'
    || value.businessTimezone !== 'America/Los_Angeles'
    || !Number.isSafeInteger(value.sessionGeneration)
    || value.sessionGeneration < 1) {
    throw new Error('Main authority is outside US/USD/America/Los_Angeles production scope');
  }
  return Object.freeze({ ...value });
}

function assertSameAuthority(
  actual: StoreCollectionAuthorityReadback,
  expected: StoreCollectionAuthorityReadback,
): void {
  if (actual.activeStoreId !== expected.activeStoreId
    || !sameNullableContext(actual.context, expected.context)) {
    throw new Error('Main transition authority changed during exact double readback');
  }
}

function sameNullableContext(
  left: StoreContextEnvelope | null,
  right: StoreContextEnvelope | null,
): boolean {
  return left === null || right === null
    ? left === right
    : sameContext(left, right);
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
