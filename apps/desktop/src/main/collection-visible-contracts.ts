import {
  type BrowserLeaseManager,
  type BrowserTransitionBarrierProof,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  type StoreConnection,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
  type StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionExecutionAutomationAuthority,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import {
  type ProviderIdentityPageLike,
  type ProviderPageIdentityResult,
} from './provider-page-active-identity';
import {
  type VisibleBrowserControllerLike,
  type VisibleBrowserRuntimeRegistry,
} from './visible-browser-runtime-registry';

export type CloseInput = Parameters<StoreCollectionOrchestratorDependencies['closeVisibleRuntime']>[0];

export type LeaseInput = Parameters<StoreCollectionOrchestratorDependencies['assertCollectionLeaseReleased']>[0];

export type RuntimeInput = Parameters<StoreCollectionOrchestratorDependencies['startCollectionOnlyVisibleRuntime']>[0];

export type VerifyInput = Parameters<StoreCollectionOrchestratorDependencies['verifyVisibleLingxingIdentity']>[0];

export interface CollectionOnlyBrowserController extends VisibleBrowserControllerLike {
  launch(): Promise<void>;
  navigate(url: string): Promise<void>;
  getPage(): ProviderIdentityPageLike | null;
}

export interface CollectionOnlyBrowserFactoryInput {
  purpose: 'collection_only';
  provider: 'lingxing';
  context: StoreContextEnvelope;
  userDataDir: string;
  headless: false;
}

export interface StoreCollectionVisibleRuntimeAdapterOptions {
  registry: VisibleBrowserRuntimeRegistry;
  browserLeases: Pick<
    BrowserLeaseManager,
    | 'activeLeases'
    | 'assertNoActiveLeases'
    | 'enterTransitionBarrier'
    | 'confirmTransitionRuntimeClosed'
    | 'confirmTransitionLeasesEmpty'
    | 'confirmTransitionRuntimeStarted'
    | 'completeTransitionIdentityVerified'
    | 'completeTransitionAfterExactEmpty'
    | 'markTransitionSafetyUnknown'
    | 'assertTransitionProofCurrent'
  >;
  // 初始关闭时验证颁发方；后续使用冻结绑定，保证授权消费后仍可精确清理。
  assertTransitionAuthority(
    authority: StoreCollectionExecutionAutomationAuthority,
  ): void;
  readCurrentAuthority(): StoreCollectionAuthorityReadback;
  listActiveStores(): readonly StoreRecord[];
  listStoreConnections(storeId: StoreId): readonly StoreConnection[];
  resolveStoreCapsule(context: StoreContextEnvelope): StoreCapsulePaths;
  createHeadedBrowserController(
    input: CollectionOnlyBrowserFactoryInput,
  ): CollectionOnlyBrowserController;
  inspectLingxingIdentity?(input: {
    page: ProviderIdentityPageLike;
    connection: Pick<StoreConnection, 'provider' | 'accountLabel' | 'externalAccountId'>;
    mode: 'collection_only';
  }): Promise<ProviderPageIdentityResult>;
  // 与 ready 写入共享同步事务，前后权限核验失败时必须回滚。
  withLingxingReadyMetadataTransaction<Result>(
    work: (writer: { saveReady(metadata: StoreSessionMetadata): void }) => Result,
  ): Result;
  now?: () => Date;
}

export class StoreCollectionVisibleRuntimeAdapterError extends Error {
  constructor(
    readonly code:
      | 'COLLECTION_LEASE_ACTIVE'
      | 'IDENTITY_UNVERIFIED'
      | 'LOGIN_REQUIRED'
      | 'MFA_REQUIRED'
      | 'RUNTIME_CLOSE_FAILED'
      | 'RUNTIME_START_FAILED'
      | 'SAFETY_STATE_UNKNOWN'
      | 'UNSUPPORTED_STORE',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StoreCollectionVisibleRuntimeAdapterError';
  }
}

export interface TransitionBinding {
  owner: string;
  automationCapability: Readonly<object>;
  scopeIdentity: StoreCollectionTransitionCapabilityScope;
  scopeSnapshot: StoreCollectionTransitionCapabilityScope;
  authoritySnapshot: StoreCollectionAuthorityReadback;
  intentDomainCapability: Readonly<object>;
  initialIntentCapability: Readonly<object>;
  terminalCleanupIntentCapability: Readonly<object>;
  phase:
    | 'bound'
    | 'initial_runtime_closed'
    | 'initial_leases_proven'
    | 'runtime_started'
    | 'identity_verified'
    | 'aborted'
    | 'cleanup_runtime_closed'
    | 'retired';
}

export interface ActiveTransitionBarrier {
  owner: string;
  automationCapability: Readonly<object>;
  transitionCapability: Readonly<object>;
  proof: BrowserTransitionBarrierProof;
}
