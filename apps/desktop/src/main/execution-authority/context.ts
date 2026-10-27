import type { RuntimeLogPort } from '../runtime-logger';
import { type KeywordBidCommand } from '@amazon-ai-ops/action-executor';
import { type BrowserLease, BrowserLeaseManager, type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import  {
  AnalysisAuthorityRepository,
  ExecutionAuthorityRepository,
  MissionDomainRepository,
  type PolicyGrantDispatchRecord,
  type PolicyGrantDispatchTrigger,
} from '@amazon-ai-ops/local-db';
import  {
  type AdExecutionProgressEvent,
  type AdExecutionBatchProjection,
  type AdExecutionJobProjection,
  type AdExecutionStartupRecoveryResult,
  type AdExecutionUnknownReconciliationResult,
  type AdKeywordIdentityVersionRecord,
  type CreateAdExecutionBatchRequest,
  type CreateAdExecutionBatchResult,
  type CancelAdExecutionBatchRequest,
  type MissionGrantRecord,
  type ResolveAdExecutionIdentityRequest,
  type ReconcileUnknownAdExecutionBatchRequest,
  type StartAdExecutionBatchRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { PolicyDispatchSuppressionReadPort } from '../store-collection-policy-suppression';
import  {
  ExecutionBrowserRuntime,
  ExecutionAuthorityServiceOptions,
  RunningBatch,
  PolicyDispatchLane,
  PolicyDispatchRetryTimer,
  AdmittedAuthorityOperation,
} from './contracts';
export interface ExecutionAuthorityServiceContext {
    logger: RuntimeLogPort;
    repository: ExecutionAuthorityRepository;
    missionRepository: MissionDomainRepository;
    analysisRepository: AnalysisAuthorityRepository;
    storeCoordinator: ExecutionAuthorityServiceOptions['storeCoordinator'];
    leases: BrowserLeaseManager;
    resolveBrowserRuntime: ExecutionAuthorityServiceOptions['resolveBrowserRuntime'];
    emit: NonNullable<ExecutionAuthorityServiceOptions['emitProgress']>;
    now: () => Date;
    policyDispatchRetryMs: number;
    policyDispatchTimer: NonNullable<ExecutionAuthorityServiceOptions['policyDispatchTimer']>;
    policyDispatchSuppression: PolicyDispatchSuppressionReadPort;
    running: Map<string, RunningBatch>;
    policyDispatchLanes: Map<string, PolicyDispatchLane>;
    policyDispatchRetryTimers: Map<string, PolicyDispatchRetryTimer>;
    recoveredBatchReconciliations: Map<string, Set<string>>;
    admittedOperations: Set<Promise<void>>;
    stopping: boolean;
    listBatches(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[];
    withAdmittedBrowserOperation<Result>(label: string, work: () => Promise<Result> | Result): Promise<Result>;
    resolveIdentity(request: ResolveAdExecutionIdentityRequest): Promise<AdKeywordIdentityVersionRecord>;
    resolveIdentityAdmitted(request: ResolveAdExecutionIdentityRequest): Promise<AdKeywordIdentityVersionRecord>;
    createBatch(request: CreateAdExecutionBatchRequest): CreateAdExecutionBatchResult;
    startBatch(request: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection>;
    startBatchAdmitted(request: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection>;
    enqueuePolicyGrant(contextInput: StoreContextEnvelope, grant: MissionGrantRecord): Promise<void>;
    enqueuePolicyGrantAdmitted(contextInput: StoreContextEnvelope, grant: MissionGrantRecord): Promise<void>;
    resumePolicyGrantDispatches(contextInput: StoreContextEnvelope, trigger: Extract<PolicyGrantDispatchTrigger, 'store_activated' | 'session_ready'>): Promise<void>;
    resumePolicyGrantDispatchesAdmitted(contextInput: StoreContextEnvelope, trigger: Extract<PolicyGrantDispatchTrigger, 'store_activated' | 'session_ready'>): Promise<void>;
    cancelBatch(request: CancelAdExecutionBatchRequest): AdExecutionBatchProjection;
    reconcileUnknownBatch(request: ReconcileUnknownAdExecutionBatchRequest): Promise<AdExecutionUnknownReconciliationResult>;
    reconcileUnknownBatchAdmitted(request: ReconcileUnknownAdExecutionBatchRequest): Promise<AdExecutionUnknownReconciliationResult>;
    takeOverVisibleBrowser(request: StartAdExecutionBatchRequest): Promise<{
        status: 'VISIBLE';
        batchId: string;
    }>;
    takeOverVisibleBrowserAdmitted(request: StartAdExecutionBatchRequest): Promise<{
        status: 'VISIBLE';
        batchId: string;
    }>;
    recoverStartup(): AdExecutionStartupRecoveryResult;
    reconcileActiveStore(contextInput: StoreContextEnvelope): void;
    assertStoreMutationAllowed(contextInput: StoreContextEnvelope): void;
    prepareForShutdown(timeoutMs?: number): Promise<void>;
    markPostIntentJobsUnknownForShutdown(): void;
    runBatch(context: StoreContextEnvelope, batchId: string, running: RunningBatch): Promise<AdExecutionBatchProjection>;
    navigateToJob(context: StoreContextEnvelope, job: AdExecutionJobProjection, lease: BrowserLease): Promise<ExecutionBrowserRuntime>;
    commandFor(context: StoreContextEnvelope, grant: MissionGrantRecord, job: AdExecutionJobProjection, capsule: StoreCapsulePaths): KeywordBidCommand;
    policyGrantDispatch(context: StoreContextEnvelope, grantId: string): PolicyGrantDispatchRecord;
    wakePolicyGrantPump(contextInput: StoreContextEnvelope, trigger: PolicyGrantDispatchTrigger): Promise<void>;
    runPolicyGrantPump(lane: PolicyDispatchLane): Promise<void>;
    runPolicyGrantPumpAttempt(context: StoreContextEnvelope, candidate: PolicyGrantDispatchRecord, trigger: PolicyGrantDispatchTrigger): Promise<'continue' | 'wait' | 'suppressed'>;
    completeUnsafeExistingDispatch(context: StoreContextEnvelope, dispatch: PolicyGrantDispatchRecord, trigger: PolicyGrantDispatchTrigger, attempt: number): 'continue';
    ensureAuthorizedExecutionLink(context: StoreContextEnvelope, projection: AdExecutionBatchProjection): void;
    reconcileExecutionMissionLinks(context: StoreContextEnvelope): void;
    waitPolicyGrantDispatch(context: StoreContextEnvelope, grantId: string, trigger: PolicyGrantDispatchTrigger, attempt: number, batchId: string | undefined, error: unknown): 'wait';
    holdPolicyGrantDispatchForSuppression(context: StoreContextEnvelope, grantId: string, trigger: PolicyGrantDispatchTrigger, attempt: number): 'suppressed';
    schedulePolicyDispatchRetry(context: StoreContextEnvelope, nextRetryAt: string): void;
    clearPolicyDispatchRetry(storeKey: string): void;
    assertPolicyPumpRunning(): void;
    policyDispatchIsSuppressed(): boolean;
    requireDispatchablePolicyGrant(context: StoreContextEnvelope, grantIdInput: string): MissionGrantRecord;
    requireRuntime(context: StoreContextEnvelope): ExecutionBrowserRuntime;
    assertLeaseAndRuntime(lease: BrowserLease, context: StoreContextEnvelope, expectedAdsAccountId: string): void;
    requireLiveGrant(context: StoreContextEnvelope, grantIdInput: string): MissionGrantRecord;
    assertGrantUsesEffectivePolicyVersion(context: StoreContextEnvelope, grant: MissionGrantRecord): void;
    requireBatch(context: StoreContextEnvelope, batchId: string): AdExecutionBatchProjection;
    requireJob(context: StoreContextEnvelope, batchId: string, jobId: string): AdExecutionJobProjection;
    cancelRemainingBeforeIntent(context: StoreContextEnvelope, projection: AdExecutionBatchProjection, reasonCode: string): void;
    markUnknownAndStop(context: StoreContextEnvelope, batchId: string, job: AdExecutionJobProjection, reasonCode: string, detail: string): AdExecutionBatchProjection;
    revokeGrantAndStopMission(context: StoreContextEnvelope, projection: AdExecutionBatchProjection, reason: string, unknown: boolean): void;
    finalizeSucceededBatch(context: StoreContextEnvelope, projection: AdExecutionBatchProjection): void;
    appendCheckpointOnce(context: StoreContextEnvelope, missionId: string, batchId: string, stage: 'ACTION' | 'READBACK', status: string, evidenceCount: number): void;
    reconcileRecoveredBatches(context: StoreContextEnvelope): void;
    assertContext(context: StoreContextEnvelope): StoreContextEnvelope;
    admitAuthorityOperation(labelInput: string): AdmittedAuthorityOperation;
    assertNotStopping(): void;
    progress(context: StoreContextEnvelope, batchId: string, jobId: string | undefined, phase: AdExecutionProgressEvent['phase'], status: AdExecutionProgressEvent['status'], message: string): void;
    timestamp(): string;
}
