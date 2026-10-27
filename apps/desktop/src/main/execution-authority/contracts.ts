import type { RuntimeLogPort } from '../runtime-logger';
import { type KeywordBidCommand, type KeywordBidPreflightResult, type PlaywrightKeywordBidPageLike } from '@amazon-ai-ops/action-executor';
import { BrowserLeaseManager, type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import  {
  AnalysisAuthorityRepository,
  ExecutionAuthorityRepository,
  MissionDomainRepository,
  type PolicyGrantDispatchTrigger,
} from '@amazon-ai-ops/local-db';
import { type AdExecutionProgressEvent, type AdExecutionBatchProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from '../store-coordinator';
import type { PolicyDispatchSuppressionReadPort } from '../store-collection-policy-suppression';
export interface ExecutionBrowserRuntime {
    context: StoreContextEnvelope;
    externalAccountId: string;
    page: PlaywrightKeywordBidPageLike;
    capsule: StoreCapsulePaths;
    navigate(url: string): Promise<void>;
    bringToFront(): Promise<void>;
}
export interface ExecutionAuthorityServiceOptions {
    logger?: RuntimeLogPort;
    repository: ExecutionAuthorityRepository;
    missionRepository: MissionDomainRepository;
    analysisRepository: AnalysisAuthorityRepository;
    storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getActiveStoreContext'>;
    leases: BrowserLeaseManager;
    resolveBrowserRuntime(context: StoreContextEnvelope): ExecutionBrowserRuntime;
    emitProgress?(event: AdExecutionProgressEvent): void;
    now?: () => Date;
    policyDispatchRetryMs?: number;
    policyDispatchTimer?: {
        set(callback: () => void, delayMs: number): unknown;
        clear(handle: unknown): void;
    };
    policyDispatchSuppression: PolicyDispatchSuppressionReadPort;
}
export interface RunningBatch {
    batchId: string;
    cancelRequested: boolean;
    promise: Promise<AdExecutionBatchProjection>;
}
export interface PreparedJob {
    command: KeywordBidCommand;
    preflight: Extract<KeywordBidPreflightResult, {
        status: 'READY';
    }>;
    pageIdentityHash: string;
}
export interface PolicyDispatchLane {
    context: StoreContextEnvelope;
    trigger: PolicyGrantDispatchTrigger;
    rerunRequested: boolean;
    promise: Promise<void>;
}
export interface PolicyDispatchRetryTimer {
    context: StoreContextEnvelope;
    nextRetryAt: string;
    handle: unknown;
}
export interface AdmittedAuthorityOperation {
    readonly settlement: Promise<void>;
    settle(): void;
}
