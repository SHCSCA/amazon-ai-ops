import {
  type BrowserTransitionLeaseEmptyProof,
  type BrowserTransitionRuntimeClosedProof,
  type BrowserTransitionRuntimeStartedProof,
} from '@amazon-ai-ops/browser-worker';
import {
  normalizeStoreContextEnvelope,
  type StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorDependencies,
} from './store-collection-orchestrator';
import {
  getLingxingSessionNavigationPlan,
} from './lingxing-session-flow';
import {
  sameVisibleRuntimeContext,
  type VisibleBrowserRuntimeRegistry,
} from './visible-browser-runtime-registry';
import {
  type CloseInput,
  type LeaseInput,
  type RuntimeInput,
  StoreCollectionVisibleRuntimeAdapterError,
  type VerifyInput,
} from "./collection-visible-contracts";
import {
  authorityAllowsContext,
  confirmation,
  assertCapsule,
  controllerLike,
  pageLike,
  identityFailureCode,
  identityFailureMessage,
  promiseLike,
  cloneAuthority,
  sameAuthority,
} from "./collection-visible-values";

import type { CollectionVisibleAdapterRuntime } from './collection-visible-runtime';

export async function closeVisibleRuntime(this: CollectionVisibleAdapterRuntime,
  input: CloseInput): ReturnType<StoreCollectionOrchestratorDependencies['closeVisibleRuntime']> {
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

export async function assertCollectionLeaseReleased(this: CollectionVisibleAdapterRuntime,
  input: LeaseInput): ReturnType<StoreCollectionOrchestratorDependencies['assertCollectionLeaseReleased']> {
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

export async function startCollectionOnlyVisibleRuntime(this: CollectionVisibleAdapterRuntime,
  input: RuntimeInput): ReturnType<StoreCollectionOrchestratorDependencies['startCollectionOnlyVisibleRuntime']> {
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

export async function verifyVisibleLingxingIdentity(this: CollectionVisibleAdapterRuntime,
  input: VerifyInput): ReturnType<StoreCollectionOrchestratorDependencies['verifyVisibleLingxingIdentity']> {
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

export async function cleanupFailedRuntime(this: CollectionVisibleAdapterRuntime,
  input: RuntimeInput,
  failure: StoreCollectionVisibleRuntimeAdapterError): Promise<never> {
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
