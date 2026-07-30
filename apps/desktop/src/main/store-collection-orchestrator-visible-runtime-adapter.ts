import {
  deriveStoreCapsulePaths,
  type BrowserLeaseManager,
  type BrowserTransitionBarrierProof,
  type BrowserTransitionEnteredProof,
  type BrowserTransitionLeaseEmptyProof,
  type BrowserTransitionRuntimeClosedProof,
  type BrowserTransitionRuntimeStartedProof,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  normalizeStoreContextEnvelope,
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
  type StoreCollectionVisibleRuntimeIntent,
} from './store-collection-orchestrator';
import {
  inspectLingxingProviderPageIdentity,
  type ProviderIdentityPageLike,
  type ProviderPageIdentityResult,
} from './provider-page-active-identity';
import { getLingxingSessionNavigationPlan } from './lingxing-session-flow';
import {
  sameVisibleRuntimeContext,
  type VisibleBrowserControllerLike,
  type VisibleBrowserRuntimeClaim,
  type VisibleBrowserRuntimeRegistry,
} from './visible-browser-runtime-registry';

type CloseInput = Parameters<StoreCollectionOrchestratorDependencies['closeVisibleRuntime']>[0];
type LeaseInput = Parameters<StoreCollectionOrchestratorDependencies['assertCollectionLeaseReleased']>[0];
type RuntimeInput = Parameters<StoreCollectionOrchestratorDependencies['startCollectionOnlyVisibleRuntime']>[0];
type VerifyInput = Parameters<StoreCollectionOrchestratorDependencies['verifyVisibleLingxingIdentity']>[0];

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
  /**
   * Non-consuming Main-only issuer validator used only when the initial close
   * creates a transition binding. Later ports use the frozen local binding,
   * stage machine, and authority CAS so terminal cleanup remains possible
   * after the scheduler has consumed its own execution admission.
   */
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
  /**
   * Must execute `work` synchronously inside the same DB transaction used by
   * `saveReady`. If either authority check around saveReady throws, the
   * transaction must roll back and no `ready` row may remain.
   */
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

interface TransitionBinding {
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

interface ActiveTransitionBarrier {
  owner: string;
  automationCapability: Readonly<object>;
  transitionCapability: Readonly<object>;
  proof: BrowserTransitionBarrierProof;
}

/**
 * Main-only adapter for the orchestrator's four visible-browser ports.
 *
 * The adapter opens exactly one headed Lingxing controller using a derived
 * Lingxing profile. It has no credential or Amazon Ads inputs, and it does not
 * reconnect or mutate Store authority.
 */
export class StoreCollectionOrchestratorVisibleRuntimeAdapter implements Pick<
  StoreCollectionOrchestratorDependencies,
  | 'closeVisibleRuntime'
  | 'assertCollectionLeaseReleased'
  | 'startCollectionOnlyVisibleRuntime'
  | 'verifyVisibleLingxingIdentity'
> {
  private readonly now: () => Date;
  private readonly inspectIdentity: NonNullable<
    StoreCollectionVisibleRuntimeAdapterOptions['inspectLingxingIdentity']
  >;
  private readonly transitionBindings = new WeakMap<object, TransitionBinding>();
  private readonly intentDomainBindings = new WeakMap<object, Readonly<object>>();
  private runtimeClaim: VisibleBrowserRuntimeClaim | null = null;
  private activeBarrier: ActiveTransitionBarrier | null = null;

  constructor(private readonly options: StoreCollectionVisibleRuntimeAdapterOptions) {
    this.now = options.now ?? (() => new Date());
    this.inspectIdentity = options.inspectLingxingIdentity
      ?? inspectLingxingProviderPageIdentity;
  }

  async closeVisibleRuntime(
    input: CloseInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['closeVisibleRuntime']> {
    this.assertPortAuthority(input, 'close');
    const binding = this.requireTransitionBinding(input);
    const intent = this.visibleRuntimeIntentKind(input.visibleRuntimeIntent, binding);
    const closePhase = intent === 'initial' && binding.phase === 'bound'
      ? 'initial'
      : intent === 'terminal_cleanup' && (
        binding.phase === 'bound'
        || binding.phase === 'initial_runtime_closed'
        || binding.phase === 'initial_leases_proven'
        || binding.phase === 'runtime_started'
        || binding.phase === 'identity_verified'
        || binding.phase === 'aborted'
      )
        ? 'cleanup'
        : null;
    if (!closePhase) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `visible runtime close cannot replay transition phase ${binding.phase}`,
      );
    }
    const barrier = this.ensureTransitionBarrier(input);
    const runtime = this.options.registry.read();
    if (runtime) {
      if (!authorityAllowsContext(input.expectedAuthority, runtime.context)) {
        this.markBarrierUnknown(barrier);
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'attached visible runtime is outside the exact expected authority',
        );
      }
      this.runtimeClaim = null;
      let proof: Awaited<ReturnType<VisibleBrowserRuntimeRegistry['strictClose']>>;
      try {
        proof = await this.options.registry.strictCloseCurrent(runtime.context);
      } catch (error) {
        this.markBarrierUnknown(barrier);
        throw this.error(
          'RUNTIME_CLOSE_FAILED',
          'visible runtime could not be strictly closed and remains attached',
          error,
        );
      }
      try {
        this.assertPortAuthority(input, 'close_after_await');
      } catch (error) {
        this.options.registry.consumeEmptyProof(proof);
        this.markBarrierUnknown(barrier);
        throw error;
      }
      this.options.registry.consumeEmptyProof(proof);
    } else {
      const proof = this.options.registry.proveEmpty();
      this.options.registry.consumeEmptyProof(proof);
    }
    this.confirmBarrierRuntimeClosed(barrier);
    let authority: StoreCollectionAuthorityReadback;
    try {
      authority = this.assertPortAuthority(input, 'close_complete');
    } catch (error) {
      this.markBarrierUnknown(barrier);
      throw error;
    }
    binding.phase = closePhase === 'initial'
      ? 'initial_runtime_closed'
      : 'cleanup_runtime_closed';
    return confirmation(input, authority, { closed: true });
  }

  async assertCollectionLeaseReleased(
    input: LeaseInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['assertCollectionLeaseReleased']> {
    const authority = this.assertPortAuthority(input, 'lease_readback');
    const binding = this.requireTransitionBinding(input);
    const intent = this.visibleRuntimeIntentKind(input.visibleRuntimeIntent, binding);
    if (binding.phase !== 'initial_runtime_closed'
      && binding.phase !== 'cleanup_runtime_closed') {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `lease proof cannot replay transition phase ${binding.phase}`,
      );
    }
    if ((binding.phase === 'initial_runtime_closed' && intent !== 'initial')
      || (binding.phase === 'cleanup_runtime_closed' && intent !== 'terminal_cleanup')) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'lease proof intent does not match the exact completed close phase',
      );
    }
    const barrier = this.requireTransitionBarrier(input);
    if (barrier.proof.stage === 'runtime_closed') {
      barrier.proof = this.options.browserLeases.confirmTransitionLeasesEmpty(
        barrier.proof as BrowserTransitionRuntimeClosedProof,
      );
    } else if (barrier.proof.stage === 'leases_proven') {
      this.options.browserLeases.assertTransitionProofCurrent(
        barrier.proof as BrowserTransitionLeaseEmptyProof,
        'leases_proven',
      );
      this.options.browserLeases.assertNoActiveLeases();
    } else {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `lease readback is invalid at transition stage ${barrier.proof.stage}`,
      );
    }
    if (binding.phase === 'cleanup_runtime_closed') {
      this.assertPortAuthority(input, 'terminal_close_release');
      this.options.browserLeases.completeTransitionAfterExactEmpty(
        barrier.proof as BrowserTransitionLeaseEmptyProof,
        'terminal_close',
      );
      this.activeBarrier = null;
      binding.phase = 'retired';
    } else {
      binding.phase = 'initial_leases_proven';
    }
    return confirmation(input, authority, { released: true });
  }

  async startCollectionOnlyVisibleRuntime(
    input: RuntimeInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['startCollectionOnlyVisibleRuntime']> {
    try {
      this.assertRuntimeInput(input, 'start');
    } catch (error) {
      this.markActiveBarrierUnknownForExactInput(input);
      throw error;
    }
    const binding = this.requireTransitionBinding(input);
    if (this.visibleRuntimeIntentKind(input.visibleRuntimeIntent, binding) !== 'initial'
      || binding.phase !== 'initial_leases_proven'
      || binding.scopeSnapshot.purpose !== 'collection') {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `runtime start is not allowed in transition phase ${binding.phase}`,
      );
    }
    const barrier = this.requireTransitionBarrier(input, 'leases_proven');
    try {
      if (this.options.registry.read()) {
        throw this.error('RUNTIME_START_FAILED', 'a visible runtime is already attached');
      }
      const store = this.requireActiveStore(input.context);
      const connection = this.requireLingxingConnection(store.storeId);
      const capsule = this.options.resolveStoreCapsule(input.context);
      assertCapsule(capsule, input.context);
      const controller = this.options.createHeadedBrowserController({
        purpose: 'collection_only',
        provider: 'lingxing',
        context: normalizeStoreContextEnvelope(input.context),
        userDataDir: capsule.lingxingProfileDir,
        headless: false,
      });
      if (!controllerLike(controller)) {
        throw this.error('RUNTIME_START_FAILED', 'headed browser factory returned an invalid controller');
      }
      const claim = this.options.registry.publishCandidate({
        purpose: 'collection_only',
        context: input.context,
        controllers: { lingxing: controller },
        profileDirs: { lingxing: capsule.lingxingProfileDir },
        connections: { lingxing: connection },
        attempt: {
          kind: 'automation',
          attemptId: input.transitionScope.transitionId,
          attemptEpoch: input.context.sessionGeneration,
        },
      });
      this.runtimeClaim = claim;
      await controller.launch();
      this.assertRuntimeStillCurrent(input, claim, 'launch');
      await controller.navigate(getLingxingSessionNavigationPlan().initialUrl);
      this.assertRuntimeStillCurrent(input, claim, 'navigation');
      const finalAuthority = this.assertRuntimeInput(input, 'start_complete');
      barrier.proof = this.options.browserLeases.confirmTransitionRuntimeStarted(
        barrier.proof as BrowserTransitionLeaseEmptyProof,
      );
      binding.phase = 'runtime_started';
      return confirmation(input, finalAuthority, { started: true });
    } catch (error) {
      const failure = this.error(
        error instanceof StoreCollectionVisibleRuntimeAdapterError
          ? error.code
          : 'RUNTIME_START_FAILED',
        'collection-only visible Lingxing runtime failed to start',
        error,
      );
      return this.cleanupFailedRuntime(input, failure);
    }
  }

  async verifyVisibleLingxingIdentity(
    input: VerifyInput,
  ): ReturnType<StoreCollectionOrchestratorDependencies['verifyVisibleLingxingIdentity']> {
    try {
      this.assertRuntimeInput(input, 'verify');
    } catch (error) {
      this.markActiveBarrierUnknownForExactInput(input);
      throw error;
    }
    const binding = this.requireTransitionBinding(input);
    if (this.visibleRuntimeIntentKind(input.visibleRuntimeIntent, binding) !== 'initial'
      || binding.phase !== 'runtime_started'
      || binding.scopeSnapshot.purpose !== 'collection') {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `Lingxing identity verification is not allowed in transition phase ${binding.phase}`,
      );
    }
    const barrier = this.requireTransitionBarrier(input, 'runtime_started');
    const runtime = this.options.registry.read();
    const claim = this.runtimeClaim;
    if (!runtime
      || !claim
      || runtime.purpose !== 'collection_only'
      || runtime.providerIdentityStatus.lingxing !== 'pending'
      || runtime.providerIdentityStatus.amazonAds !== 'not_present'
      || !sameVisibleRuntimeContext(runtime.context, input.context)
      || claim.runtime !== runtime) {
      throw this.error(
        'IDENTITY_UNVERIFIED',
        'pending collection-only runtime does not match the exact Store/Profile/date/generation',
      );
    }
    const connection = runtime.connections?.lingxing
      ?? this.requireLingxingConnection(input.context.storeId);
    const page = runtime.controllers.lingxing.getPage();
    if (!pageLike(page)) {
      return this.cleanupFailedRuntime(
        input,
        this.error('IDENTITY_UNVERIFIED', 'visible Lingxing page is unavailable'),
      );
    }
    try {
      const result = await this.inspectIdentity({
        page,
        connection,
        mode: 'collection_only',
      });
      this.assertRuntimeStillCurrent(input, claim, 'identity');
      if (result.status !== 'ready') {
        throw this.error(identityFailureCode(result.status), identityFailureMessage(result.status));
      }
      const verifiedClaim = this.options.registry.verifyLingxingCandidate(claim);
      this.runtimeClaim = verifiedClaim;
      const verifiedAt = this.readNow();
      const metadata: StoreSessionMetadata = Object.freeze({
        storeId: input.context.storeId,
        browserProfileId: input.context.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: input.context.sessionGeneration,
        observedAt: verifiedAt,
        verifiedAt,
        ...(connection.accountLabel ? { accountLabel: connection.accountLabel } : {}),
        ...(connection.externalAccountId
          ? { externalAccountId: connection.externalAccountId }
          : {}),
      });
      let transactionWorkCalls = 0;
      let exactTransactionReceipt: Readonly<{
        authority: StoreCollectionAuthorityReadback;
      }> | null = null;
      const transactionResult = this.options.withLingxingReadyMetadataTransaction((writer) => {
        transactionWorkCalls += 1;
        if (transactionWorkCalls !== 1) {
          throw this.error(
            'SAFETY_STATE_UNKNOWN',
            'Lingxing ready metadata transaction invoked its work more than once',
          );
        }
        this.assertRuntimeStillCurrent(input, verifiedClaim, 'metadata_before_write');
        const writeResult = writer.saveReady(metadata) as unknown;
        if (promiseLike(writeResult)) {
          throw this.error(
            'SAFETY_STATE_UNKNOWN',
            'Lingxing ready metadata writer must be synchronous',
          );
        }
        this.assertRuntimeStillCurrent(input, verifiedClaim, 'metadata_before_commit');
        const committedAuthority = this.assertRuntimeInput(input, 'metadata_before_commit');
        exactTransactionReceipt = Object.freeze({
          authority: cloneAuthority(committedAuthority),
        });
        return exactTransactionReceipt;
      });
      if (promiseLike(transactionResult)
        || transactionWorkCalls !== 1
        || transactionResult !== exactTransactionReceipt
        || !exactTransactionReceipt
        || !sameAuthority(
          (transactionResult as { authority: StoreCollectionAuthorityReadback }).authority,
          input.expectedAuthority,
        )) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'Lingxing ready metadata transaction did not return an exact synchronous authority CAS',
        );
      }
      const committedReceipt = transactionResult as Readonly<{
        authority: StoreCollectionAuthorityReadback;
      }>;
      this.options.browserLeases.completeTransitionIdentityVerified(
        barrier.proof as BrowserTransitionRuntimeStartedProof,
      );
      this.activeBarrier = null;
      binding.phase = 'identity_verified';
      return confirmation(input, committedReceipt.authority, { verified: true });
    } catch (error) {
      const failure = error instanceof StoreCollectionVisibleRuntimeAdapterError
        ? error
        : this.error(
          'IDENTITY_UNVERIFIED',
          'visible Lingxing identity could not be verified',
          error,
        );
      return this.cleanupFailedRuntime(input, failure);
    }
  }

  private assertRuntimeStillCurrent(
    input: RuntimeInput,
    claim: VisibleBrowserRuntimeClaim,
    stage: string,
  ): void {
    this.options.registry.assertClaimCurrent(claim);
    this.assertRuntimeInput(input, `${stage}_after_await`);
    const barrier = this.requireTransitionBarrier(input);
    this.options.browserLeases.assertTransitionProofCurrent(barrier.proof);
    if (!sameVisibleRuntimeContext(claim.runtime.context, input.context)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'visible runtime context changed during an asynchronous operation',
      );
    }
  }

  private async cleanupFailedRuntime(
    input: RuntimeInput,
    failure: StoreCollectionVisibleRuntimeAdapterError,
  ): Promise<never> {
    this.runtimeClaim = null;
    const barrier = this.requireTransitionBarrier(input);
    const runtime = this.options.registry.read();
    if (runtime && !sameVisibleRuntimeContext(runtime.context, input.context)) {
      this.markBarrierUnknown(barrier);
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'failed runtime cleanup found a different exact Store/Profile/date/generation',
      );
    }
    let proof: Awaited<ReturnType<VisibleBrowserRuntimeRegistry['strictClose']>>;
    try {
      proof = runtime
        ? await this.options.registry.strictCloseCurrent(runtime.context)
        : this.options.registry.proveEmpty();
    } catch (error) {
      this.markBarrierUnknown(barrier);
      throw this.error(
        'RUNTIME_CLOSE_FAILED',
        'failed collection candidate remains attached after strict close',
        error,
      );
    }
    if (runtime) {
      try {
        this.assertRuntimeInput(input, 'failed_runtime_close_after_await');
      } catch (error) {
        this.options.registry.consumeEmptyProof(proof);
        this.markBarrierUnknown(barrier);
        throw error;
      }
    }
    this.options.registry.consumeEmptyProof(proof);
    this.confirmBarrierRuntimeClosed(barrier);
    barrier.proof = this.options.browserLeases.confirmTransitionLeasesEmpty(
      barrier.proof as BrowserTransitionRuntimeClosedProof,
    );
    try {
      this.assertRuntimeInput(input, 'failed_runtime_cleanup');
      this.options.browserLeases.completeTransitionAfterExactEmpty(
        barrier.proof as BrowserTransitionLeaseEmptyProof,
        'aborted',
      );
      this.activeBarrier = null;
      this.requireTransitionBinding(input).phase = 'aborted';
    } catch {
      this.markBarrierUnknown(barrier);
    }
    throw failure;
  }

  private assertRuntimeInput(input: RuntimeInput, stage: string): StoreCollectionAuthorityReadback {
    const authority = this.assertPortAuthority(input, stage);
    const context = normalizeStoreContextEnvelope(input.context);
    assertExactUsContext(context);
    if (!authorityAllowsContext(authority, context)
      || !input.transitionScope.target
      || !targetMatchesContext(input.transitionScope.target, context)
      || input.transitionScope.purpose !== 'collection') {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'runtime input is outside the exact transition target and current authority',
      );
    }
    this.requireActiveStore(context);
    return authority;
  }

  private assertPortAuthority(
    input: CloseInput,
    stage: string,
  ): StoreCollectionAuthorityReadback {
    if (!input
      || !runtimeObject(input.capability)
      || !runtimeObject(input.transitionCapability)
      || !input.transitionScope
      || typeof input.transitionScope !== 'object') {
      throw this.error('SAFETY_STATE_UNKNOWN', `visible runtime ${stage} authority is missing`);
    }
    const expected = normalizeAuthority(input.expectedAuthority);
    assertAuthorityUsOrNull(expected);
    if (!authorityWithinScope(expected, input.transitionScope)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `visible runtime ${stage} expected authority is outside transition scope`,
      );
    }
    const current = normalizeAuthority(this.options.readCurrentAuthority());
    assertAuthorityUsOrNull(current);
    if (!sameAuthority(current, expected)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        `visible runtime ${stage} authority drifted before admission`,
      );
    }
    const binding = this.assertStableTransitionBinding(input, stage, expected);
    const authorityAdvances = !sameAuthority(binding.authoritySnapshot, expected);
    if (authorityAdvances) {
      const permitsAuthorityAdvance = (
        stage === 'start'
        && binding.phase === 'initial_leases_proven'
        && binding.scopeSnapshot.purpose === 'collection'
      ) || (
        stage === 'close'
        && binding.phase === 'initial_leases_proven'
      );
      if (!permitsAuthorityAdvance) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          `visible runtime ${stage} authority changed outside its one allowed transition boundary`,
        );
      }
    }
    if (authorityAdvances) binding.authoritySnapshot = cloneAuthority(expected);
    return current;
  }

  private assertStableTransitionBinding(
    input: CloseInput,
    stage: string,
    expectedAuthority: StoreCollectionAuthorityReadback,
  ): TransitionBinding {
    const previous = this.transitionBindings.get(input.transitionCapability);
    if (!previous) {
      const intent = this.visibleRuntimeIntentKind(input.visibleRuntimeIntent);
      if (stage !== 'close' || intent !== 'initial') {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'a transition binding may only be issued by the initial close intent',
        );
      }
      let validatorResult: void;
      try {
        validatorResult = this.options.assertTransitionAuthority(input);
      } catch (error) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          `visible runtime ${stage} transition authority was rejected: ${
            error instanceof Error ? error.message : 'unknown authority failure'
          }`,
          error,
        );
      }
      if (validatorResult !== undefined) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'transition authority validator must be synchronous and return void',
        );
      }
      const binding: TransitionBinding = {
        owner: input.owner,
        automationCapability: input.capability,
        scopeIdentity: input.transitionScope,
        scopeSnapshot: cloneScope(input.transitionScope),
        authoritySnapshot: cloneAuthority(expectedAuthority),
        intentDomainCapability: input.visibleRuntimeIntent.domainCapability,
        initialIntentCapability: input.visibleRuntimeIntent.initialCapability,
        terminalCleanupIntentCapability:
          input.visibleRuntimeIntent.terminalCleanupCapability,
        phase: 'bound',
      };
      const existingIntentBinding = this.intentDomainBindings.get(
        binding.intentDomainCapability,
      );
      if (existingIntentBinding
        && existingIntentBinding !== input.transitionCapability) {
        throw this.error(
          'SAFETY_STATE_UNKNOWN',
          'visible runtime intent domain is aliased across transition capabilities',
        );
      }
      this.intentDomainBindings.set(
        binding.intentDomainCapability,
        input.transitionCapability,
      );
      this.transitionBindings.set(input.transitionCapability, binding);
      return binding;
    }
    this.visibleRuntimeIntentKind(input.visibleRuntimeIntent, previous);
    if (previous.owner !== input.owner
      || previous.automationCapability !== input.capability
      || previous.scopeIdentity !== input.transitionScope
      || !sameScope(previous.scopeSnapshot, input.transitionScope)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'transition capability is forged, replayed across owners, or scope-mutated',
      );
    }
    return previous;
  }

  private visibleRuntimeIntentKind(
    intent: StoreCollectionVisibleRuntimeIntent,
    binding?: TransitionBinding,
  ): 'initial' | 'terminal_cleanup' {
    if (!intent
      || !Object.isFrozen(intent)
      || !runtimeObject(intent.domainCapability)
      || !runtimeObject(intent.initialCapability)
      || !runtimeObject(intent.terminalCleanupCapability)
      || !runtimeObject(intent.selectedCapability)
      || intent.domainCapability === intent.initialCapability
      || intent.domainCapability === intent.terminalCleanupCapability
      || intent.initialCapability === intent.terminalCleanupCapability
      || (binding && (
        intent.domainCapability !== binding.intentDomainCapability
        || intent.initialCapability !== binding.initialIntentCapability
        || intent.terminalCleanupCapability !== binding.terminalCleanupIntentCapability
      ))) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'visible runtime intent capability is forged, aliased, or transition-mismatched',
      );
    }
    if (intent.selectedCapability === intent.initialCapability) return 'initial';
    if (intent.selectedCapability === intent.terminalCleanupCapability) {
      return 'terminal_cleanup';
    }
    throw this.error(
      'SAFETY_STATE_UNKNOWN',
      'visible runtime intent selected capability is forged',
    );
  }

  private requireTransitionBinding(input: CloseInput): TransitionBinding {
    const binding = this.transitionBindings.get(input.transitionCapability);
    if (!binding
      || binding.owner !== input.owner
      || binding.automationCapability !== input.capability
      || binding.scopeIdentity !== input.transitionScope
      || !sameScope(binding.scopeSnapshot, input.transitionScope)) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'transition binding is missing, forged, replayed across owners, or scope-mutated',
      );
    }
    return binding;
  }

  private requireActiveStore(context: StoreContextEnvelope): StoreRecord {
    const matches = this.options.listActiveStores().filter((store) => (
      store.status === 'active'
      && store.storeId === context.storeId
      && store.browserProfileId === context.browserProfileId
      && store.marketplace === context.marketplace
      && store.currency === context.currency
      && store.businessTimezone === context.businessTimezone
    ));
    if (matches.length !== 1) {
      throw this.error(
        'UNSUPPORTED_STORE',
        'Store/Profile is absent or ambiguous in the active US/USD/LA snapshot',
      );
    }
    assertExactUsContext(context);
    return matches[0];
  }

  private requireLingxingConnection(storeId: StoreId): StoreConnection {
    const matches = this.options.listStoreConnections(storeId)
      .filter((connection) => connection.provider === 'lingxing');
    if (matches.length !== 1
      || matches[0].storeId !== storeId
      || matches[0].status === 'blocked'
      || matches[0].status === 'not_configured'
      || typeof matches[0].externalAccountId !== 'string'
      || matches[0].externalAccountId.trim().length === 0) {
      throw this.error(
        'IDENTITY_UNVERIFIED',
        'exact Lingxing external account identity is unavailable for this store',
      );
    }
    return matches[0];
  }

  private ensureTransitionBarrier(input: CloseInput): ActiveTransitionBarrier {
    if (this.activeBarrier) return this.requireTransitionBarrier(input);
    const snapshot = this.options.browserLeases.activeLeases();
    if (snapshot.length !== 0) {
      throw this.error(
        'COLLECTION_LEASE_ACTIVE',
        `visible runtime transition blocked by ${snapshot.length} unreleased global browser lease(s)`,
      );
    }
    let proof: BrowserTransitionEnteredProof;
    try {
      proof = this.options.browserLeases.enterTransitionBarrier(input.owner);
    } catch (error) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'global browser transition barrier could not be entered',
        error,
      );
    }
    const barrier: ActiveTransitionBarrier = {
      owner: input.owner,
      automationCapability: input.capability,
      transitionCapability: input.transitionCapability,
      proof,
    };
    this.activeBarrier = barrier;
    return barrier;
  }

  private requireTransitionBarrier(
    input: CloseInput,
    expectedStage?: BrowserTransitionBarrierProof['stage'],
  ): ActiveTransitionBarrier {
    const barrier = this.activeBarrier;
    if (!barrier
      || barrier.owner !== input.owner
      || barrier.automationCapability !== input.capability
      || barrier.transitionCapability !== input.transitionCapability) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'browser transition barrier is missing or bound to another exact authority',
      );
    }
    try {
      this.options.browserLeases.assertTransitionProofCurrent(
        barrier.proof,
        expectedStage,
      );
    } catch (error) {
      throw this.error(
        'SAFETY_STATE_UNKNOWN',
        'browser transition barrier proof is forged, replayed, stale, or stage-mismatched',
        error,
      );
    }
    return barrier;
  }

  private confirmBarrierRuntimeClosed(barrier: ActiveTransitionBarrier): void {
    if (barrier.proof.stage !== 'runtime_closed') {
      barrier.proof = this.options.browserLeases.confirmTransitionRuntimeClosed(
        barrier.proof as
          | BrowserTransitionEnteredProof
          | BrowserTransitionLeaseEmptyProof
          | BrowserTransitionRuntimeStartedProof,
      );
    }
  }

  private markBarrierUnknown(barrier: ActiveTransitionBarrier): void {
    try {
      barrier.proof = this.options.browserLeases.markTransitionSafetyUnknown(barrier.proof);
    } catch {
      // The adapter intentionally keeps its binding. A forged/stale barrier
      // proof is already SAFETY_STATE_UNKNOWN and must never be released here.
    }
  }

  private markActiveBarrierUnknownForExactInput(input: CloseInput): void {
    const barrier = this.activeBarrier;
    if (barrier
      && barrier.owner === input.owner
      && barrier.automationCapability === input.capability
      && barrier.transitionCapability === input.transitionCapability) {
      this.markBarrierUnknown(barrier);
    }
  }

  private readNow(): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw this.error('SAFETY_STATE_UNKNOWN', 'visible runtime clock is invalid');
    }
    return value.toISOString();
  }

  private error(
    code: StoreCollectionVisibleRuntimeAdapterError['code'],
    message: string,
    cause?: unknown,
  ): StoreCollectionVisibleRuntimeAdapterError {
    return new StoreCollectionVisibleRuntimeAdapterError(
      code,
      message,
      cause === undefined ? undefined : { cause },
    );
  }
}

function confirmation<
  Input extends StoreCollectionExecutionAutomationAuthority,
  Result extends Record<string, true>,
>(
  input: Input,
  authority: StoreCollectionAuthorityReadback,
  result: Result,
): Input & { authority: StoreCollectionAuthorityReadback } & Result {
  return {
    owner: input.owner,
    capability: input.capability,
    transitionCapability: input.transitionCapability,
    transitionScope: input.transitionScope,
    authority: cloneAuthority(authority),
    ...result,
  } as Input & { authority: StoreCollectionAuthorityReadback } & Result;
}

function assertCapsule(capsule: StoreCapsulePaths, context: StoreContextEnvelope): void {
  if (!capsule || typeof capsule.trustedStoresRoot !== 'string') {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'derived store capsule is unavailable',
    );
  }
  let canonical: StoreCapsulePaths;
  try {
    canonical = deriveStoreCapsulePaths(
      capsule.trustedStoresRoot,
      context.storeId,
      context.browserProfileId,
    );
  } catch (error) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'store capsule could not be re-derived from the trusted root',
      { cause: error },
    );
  }
  if (capsule.storeId !== context.storeId
    || capsule.browserProfileId !== context.browserProfileId
    || typeof capsule.lingxingProfileDir !== 'string'
    || capsule.lingxingProfileDir.length === 0
    || capsule.lingxingProfileDir === capsule.amazonAdsProfileDir
    || capsule.storeRoot !== canonical.storeRoot
    || capsule.lingxingProfileDir !== canonical.lingxingProfileDir
    || capsule.amazonAdsProfileDir !== canonical.amazonAdsProfileDir) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'derived store capsule does not match the exact Store/Profile or provider split',
    );
  }
}

function controllerLike(value: unknown): value is CollectionOnlyBrowserController {
  return Boolean(value)
    && typeof (value as CollectionOnlyBrowserController).launch === 'function'
    && typeof (value as CollectionOnlyBrowserController).navigate === 'function'
    && typeof (value as CollectionOnlyBrowserController).close === 'function'
    && typeof (value as CollectionOnlyBrowserController).getPage === 'function'
    && typeof (value as CollectionOnlyBrowserController).getContext === 'function';
}

function pageLike(value: unknown): value is ProviderIdentityPageLike {
  return Boolean(value)
    && typeof (value as ProviderIdentityPageLike).url === 'function'
    && typeof (value as ProviderIdentityPageLike).title === 'function'
    && typeof (value as ProviderIdentityPageLike).evaluate === 'function';
}

function identityFailureCode(
  status: ProviderPageIdentityResult['status'],
): StoreCollectionVisibleRuntimeAdapterError['code'] {
  if (status === 'login_required') return 'LOGIN_REQUIRED';
  if (status === 'mfa_required') return 'MFA_REQUIRED';
  return 'IDENTITY_UNVERIFIED';
}

function identityFailureMessage(status: ProviderPageIdentityResult['status']): string {
  if (status === 'login_required') return 'visible Lingxing session requires operator login';
  if (status === 'mfa_required') return 'visible Lingxing session requires operator MFA';
  return 'visible Lingxing page identity is unverified';
}

function assertExactUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'UNSUPPORTED_STORE',
      'collection-only runtime supports exact US/USD/America/Los_Angeles stores only',
    );
  }
}

function authorityAllowsContext(
  authority: StoreCollectionAuthorityReadback,
  context: StoreContextEnvelope,
): boolean {
  return authority.activeStoreId === context.storeId
    && authority.context !== null
    && sameVisibleRuntimeContext(authority.context, context);
}

function targetMatchesContext(
  target: NonNullable<StoreCollectionTransitionCapabilityScope['target']>,
  context: StoreContextEnvelope,
): boolean {
  return target.storeId === context.storeId
    && target.browserProfileId === context.browserProfileId
    && target.marketplace === context.marketplace
    && target.currency === context.currency
    && target.businessTimezone === context.businessTimezone;
}

function authorityWithinScope(
  authority: StoreCollectionAuthorityReadback,
  scope: StoreCollectionTransitionCapabilityScope,
): boolean {
  const candidates = [
    scope.fromAuthority,
    scope.originAuthority,
    ...(scope.target ? [{
      activeStoreId: scope.target.storeId,
      context: authority.context && targetMatchesContext(scope.target, authority.context)
        ? authority.context
        : null,
    }] : []),
  ];
  return candidates.some((candidate) => {
    if (candidate.activeStoreId !== authority.activeStoreId) return false;
    if (candidate.context === null) return authority.context === null;
    return authority.context !== null
      && sameVisibleRuntimeContext(candidate.context, authority.context);
  }) || Boolean(
    scope.target
    && authority.context
    && authority.activeStoreId === scope.target.storeId
    && targetMatchesContext(scope.target, authority.context),
  );
}

function normalizeAuthority(value: StoreCollectionAuthorityReadback): StoreCollectionAuthorityReadback {
  if (!value || typeof value !== 'object') {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'Main Store authority readback is invalid',
    );
  }
  if (value.activeStoreId === null) {
    if (value.context !== null) {
      throw new StoreCollectionVisibleRuntimeAdapterError(
        'SAFETY_STATE_UNKNOWN',
        'null Store authority cannot carry a context',
      );
    }
    return { activeStoreId: null, context: null };
  }
  if (!value.context) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'active Store authority requires an exact context',
    );
  }
  const context = normalizeStoreContextEnvelope(value.context);
  if (context.storeId !== value.activeStoreId) {
    throw new StoreCollectionVisibleRuntimeAdapterError(
      'SAFETY_STATE_UNKNOWN',
      'active Store id and context do not match',
    );
  }
  return { activeStoreId: context.storeId, context };
}

function assertAuthorityUsOrNull(authority: StoreCollectionAuthorityReadback): void {
  if (authority.context) assertExactUsContext(authority.context);
}

function sameAuthority(
  left: StoreCollectionAuthorityReadback,
  right: StoreCollectionAuthorityReadback,
): boolean {
  if (left.activeStoreId !== right.activeStoreId) return false;
  if (!left.context || !right.context) return left.context === right.context;
  return sameVisibleRuntimeContext(left.context, right.context);
}

function cloneAuthority(
  value: StoreCollectionAuthorityReadback,
): StoreCollectionAuthorityReadback {
  return {
    activeStoreId: value.activeStoreId,
    context: value.context ? normalizeStoreContextEnvelope(value.context) : null,
  };
}

function cloneScope(
  scope: StoreCollectionTransitionCapabilityScope,
): StoreCollectionTransitionCapabilityScope {
  return {
    capabilityDomain: scope.capabilityDomain,
    capabilityId: scope.capabilityId,
    cycleId: scope.cycleId,
    transitionId: scope.transitionId,
    purpose: scope.purpose,
    fromAuthority: cloneAuthority(scope.fromAuthority),
    originAuthority: cloneAuthority(scope.originAuthority),
    target: scope.target ? { ...scope.target } : null,
    expectedFingerprint: scope.expectedFingerprint,
  };
}

function sameScope(
  left: StoreCollectionTransitionCapabilityScope,
  right: StoreCollectionTransitionCapabilityScope,
): boolean {
  return left.capabilityDomain === right.capabilityDomain
    && left.capabilityId === right.capabilityId
    && left.cycleId === right.cycleId
    && left.transitionId === right.transitionId
    && left.purpose === right.purpose
    && sameAuthority(left.fromAuthority, right.fromAuthority)
    && sameAuthority(left.originAuthority, right.originAuthority)
    && ((left.target === null && right.target === null)
      || Boolean(left.target && right.target
        && left.target.storeId === right.target.storeId
        && left.target.browserProfileId === right.target.browserProfileId
        && left.target.marketplace === right.target.marketplace
        && left.target.currency === right.target.currency
        && left.target.businessTimezone === right.target.businessTimezone))
    && left.expectedFingerprint === right.expectedFingerprint;
}

function runtimeObject(value: unknown): value is Readonly<object> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function promiseLike(value: unknown): value is PromiseLike<unknown> {
  return runtimeObject(value)
    && typeof (value as { then?: unknown }).then === 'function';
}
