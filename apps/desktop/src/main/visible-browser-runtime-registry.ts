import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  normalizeStoreContextEnvelope,
  type StoreConnection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export type VisibleBrowserRuntimePurpose = 'operator_full' | 'collection_only';
export type LingxingVisibleIdentityStatus = 'pending' | 'verified';
export type AmazonAdsVisibleIdentityStatus =
  | 'not_present'
  | 'unknown'
  | 'pending'
  | 'verified'
  | 'blocked';

export interface VisibleBrowserProviderIdentityStatus {
  readonly lingxing: LingxingVisibleIdentityStatus;
  readonly amazonAds: AmazonAdsVisibleIdentityStatus;
}

export interface VisibleBrowserControllerLike {
  close(): Promise<void>;
  getPage(): unknown | null;
  getContext(): unknown | null;
}

export interface VisibleBrowserRuntimeControllers {
  readonly lingxing: VisibleBrowserControllerLike;
  readonly amazonAds?: VisibleBrowserControllerLike;
}

export interface VisibleBrowserRuntime {
  readonly runtimeId: string;
  readonly epoch: number;
  readonly purpose: VisibleBrowserRuntimePurpose;
  readonly providerIdentityStatus: VisibleBrowserProviderIdentityStatus;
  readonly context: StoreContextEnvelope;
  readonly controllers: VisibleBrowserRuntimeControllers;
  readonly profileDirs?: Readonly<{
    lingxing: string;
    amazonAds?: string;
  }>;
  readonly connections?: Readonly<{
    lingxing: StoreConnection;
    amazonAds?: StoreConnection;
  }>;
  readonly attempt?: Readonly<{
    kind: 'manual' | 'automation';
    attemptId: string;
    attemptEpoch: number;
  }>;
}

declare const visibleRuntimeClaimBrand: unique symbol;
export type VisibleBrowserRuntimeClaim = Readonly<{
  capability: Readonly<object>;
  runtime: VisibleBrowserRuntime;
  readonly [visibleRuntimeClaimBrand]: 'VisibleBrowserRuntimeClaim';
}>;

export interface VisibleBrowserRuntimeCandidate {
  purpose: VisibleBrowserRuntimePurpose;
  context: StoreContextEnvelope;
  controllers: VisibleBrowserRuntimeControllers;
  profileDirs?: {
    lingxing: string;
    amazonAds?: string;
  };
  connections?: {
    lingxing: StoreConnection;
    amazonAds?: StoreConnection;
  };
  attempt?: {
    kind: 'manual' | 'automation';
    attemptId: string;
    attemptEpoch: number;
  };
  amazonAdsIdentityStatus?: Exclude<
    AmazonAdsVisibleIdentityStatus,
    'not_present' | 'verified'
  >;
}

export interface VisibleBrowserRuntimeEmptyProof {
  capability: Readonly<object>;
  empty: true;
  epoch: number;
}

declare const amazonAdsIdentityClaimBrand: unique symbol;
export type AmazonAdsVisibleIdentityClaim = Readonly<{
  capability: Readonly<object>;
  runtimeId: string;
  epoch: number;
  context: StoreContextEnvelope;
  readonly [amazonAdsIdentityClaimBrand]: 'AmazonAdsVisibleIdentityClaim';
}>;

export interface AmazonAdsVisibleIdentityClaimInput {
  runtimeId: string;
  epoch: number;
  context: StoreContextEnvelope;
}

export class VisibleBrowserRuntimeRegistryError extends Error {
  constructor(
    readonly code:
      | 'RUNTIME_ALREADY_ACTIVE'
      | 'RUNTIME_NOT_FOUND'
      | 'RUNTIME_CLOSING'
      | 'INVALID_RUNTIME'
      | 'INVALID_CLAIM'
      | 'CLAIM_REPLAYED'
      | 'CLAIM_HELD'
      | 'RUNTIME_CAS_MISMATCH'
      | 'RUNTIME_CLOSE_FAILED'
      | 'RUNTIME_RESIDUE'
      | 'CONTEXT_REBIND_FORBIDDEN'
      | 'INVALID_EMPTY_PROOF'
      | 'AMAZON_ADS_IDENTITY_FORBIDDEN'
      | 'AMAZON_ADS_IDENTITY_CLAIM_HELD'
      | 'INVALID_AMAZON_ADS_IDENTITY_CLAIM'
      | 'AMAZON_ADS_IDENTITY_CLAIM_REPLAYED'
      | 'AMAZON_ADS_IDENTITY_TRANSITION_FORBIDDEN'
      | 'RUNTIME_REGISTRY_SEALED',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'VisibleBrowserRuntimeRegistryError';
  }
}

interface RuntimeClaimRecord {
  runtime: VisibleBrowserRuntime;
  epoch: number;
  used: boolean;
}

interface AmazonAdsIdentityClaimRecord {
  claim: AmazonAdsVisibleIdentityClaim;
  runtime: VisibleBrowserRuntime;
  epoch: number;
  used: boolean;
}

/**
 * Main-owned single-visible-runtime registry.
 *
 * It deliberately exposes no "set current context" or business-date rebind
 * operation. Changing Store/Profile/date/generation always requires a strict
 * close followed by a fresh candidate publication.
 */
export class VisibleBrowserRuntimeRegistry {
  private currentRuntime: VisibleBrowserRuntime | null = null;
  private epoch = 0;
  private closing = false;
  private closeOperation: Promise<VisibleBrowserRuntimeEmptyProof> | null = null;
  private liveClaim: VisibleBrowserRuntimeClaim | null = null;
  private readonly claims = new WeakMap<object, RuntimeClaimRecord>();
  private liveAmazonAdsIdentityClaim: AmazonAdsVisibleIdentityClaim | null = null;
  private readonly amazonAdsIdentityClaims = new WeakMap<object, AmazonAdsIdentityClaimRecord>();
  private readonly emptyProofs = new WeakMap<object, VisibleBrowserRuntimeEmptyProof>();
  private terminalSealing = false;
  private terminalSealed = false;
  private terminalEmptyProof: VisibleBrowserRuntimeEmptyProof | null = null;
  private terminalSealOperation: Promise<VisibleBrowserRuntimeEmptyProof> | null = null;

  constructor(
    private readonly createRuntimeId: () => string = () => randomUUID(),
  ) {}

  read(): VisibleBrowserRuntime | null {
    return this.currentRuntime;
  }

  publishCandidate(input: VisibleBrowserRuntimeCandidate): VisibleBrowserRuntimeClaim {
    this.assertNotTerminalSealed();
    if (this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is closing',
      );
    }
    if (this.currentRuntime) {
      const next = normalizeStoreContextEnvelope(input?.context);
      const current = this.currentRuntime.context;
      if (sameStoreProfileGeneration(current, next) && current.businessDate !== next.businessDate) {
        throw new VisibleBrowserRuntimeRegistryError(
          'CONTEXT_REBIND_FORBIDDEN',
          'businessDate cannot be rebound on an active visible runtime',
        );
      }
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_ALREADY_ACTIVE',
        'a visible browser runtime is already active',
      );
    }
    const runtimeId = this.createRuntimeId();
    if (!safeIdentity(runtimeId)) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_RUNTIME',
        'runtime id factory returned an invalid identity',
      );
    }
    const context = normalizeStoreContextEnvelope(input?.context);
    assertUsContext(context);
    assertCandidate(input);
    this.epoch = nextEpoch(this.epoch);
    const runtime = freezeRuntime({
      runtimeId,
      epoch: this.epoch,
      purpose: input.purpose,
      providerIdentityStatus: {
        lingxing: 'pending',
        amazonAds: input.purpose === 'collection_only'
          ? 'not_present'
          : input.amazonAdsIdentityStatus ?? 'unknown',
      },
      context,
      controllers: input.controllers,
      ...(input.profileDirs ? { profileDirs: input.profileDirs } : {}),
      ...(input.connections ? { connections: input.connections } : {}),
      ...(input.attempt ? { attempt: input.attempt } : {}),
    });
    this.currentRuntime = runtime;
    return this.issueClaim(runtime);
  }

  claimCurrent(expectedContext?: StoreContextEnvelope): VisibleBrowserRuntimeClaim {
    this.assertNotTerminalSealed();
    const runtime = this.requireCurrent();
    if (this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is closing',
      );
    }
    if (expectedContext && !sameContext(runtime.context, expectedContext)) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'visible runtime does not match the exact Store/Profile/date/generation',
      );
    }
    if (this.liveClaim) {
      throw new VisibleBrowserRuntimeRegistryError(
        'CLAIM_HELD',
        'the active visible runtime already has a live claim',
      );
    }
    return this.issueClaim(runtime);
  }

  assertClaimCurrent(claim: VisibleBrowserRuntimeClaim): VisibleBrowserRuntime {
    const record = this.requireClaim(claim, false);
    if (record.used) {
      throw new VisibleBrowserRuntimeRegistryError(
        'CLAIM_REPLAYED',
        'visible runtime claim was already consumed',
      );
    }
    this.assertRuntimeCas(record.runtime, record.epoch);
    return record.runtime;
  }

  verifyLingxingCandidate(claim: VisibleBrowserRuntimeClaim): VisibleBrowserRuntimeClaim {
    this.assertNotTerminalSealed();
    const record = this.consumeClaim(claim);
    const runtime = record.runtime;
    if (runtime.providerIdentityStatus.lingxing !== 'pending') {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_RUNTIME',
        'only a pending Lingxing runtime identity can be verified',
      );
    }
    const verified = freezeRuntime({
      ...runtime,
      providerIdentityStatus: {
        ...runtime.providerIdentityStatus,
        lingxing: 'verified',
      },
    });
    if (this.currentRuntime !== runtime || this.epoch !== record.epoch) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'visible runtime changed before identity verification committed',
      );
    }
    this.currentRuntime = verified;
    return this.issueClaim(verified);
  }

  claimAmazonAdsIdentity(
    input: AmazonAdsVisibleIdentityClaimInput,
  ): AmazonAdsVisibleIdentityClaim {
    this.assertNotTerminalSealed();
    if (this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is closing',
      );
    }
    const runtime = this.requireCurrent();
    let expectedContext: StoreContextEnvelope;
    try {
      expectedContext = normalizeStoreContextEnvelope(input?.context);
    } catch (error) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_AMAZON_ADS_IDENTITY_CLAIM',
        'Amazon Ads identity claim context is invalid',
        { cause: error },
      );
    }
    if (input?.runtimeId !== runtime.runtimeId
      || input?.epoch !== runtime.epoch
      || !sameContext(runtime.context, expectedContext)) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'Amazon Ads identity claim does not match the exact runtime, epoch, or context',
      );
    }
    if (runtime.purpose !== 'operator_full'
      || !runtime.controllers.amazonAds
      || runtime.providerIdentityStatus.amazonAds === 'not_present') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_FORBIDDEN',
        'Amazon Ads identity claims require an operator_full runtime with an Ads controller',
      );
    }
    if (runtime.providerIdentityStatus.lingxing !== 'verified') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_FORBIDDEN',
        'Amazon Ads identity cannot transition before Lingxing identity is verified',
      );
    }
    if (this.liveAmazonAdsIdentityClaim) {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_CLAIM_HELD',
        'the exact runtime already has a live Amazon Ads identity claim',
      );
    }
    const capability = Object.freeze({});
    const claim = Object.freeze({
      capability,
      runtimeId: runtime.runtimeId,
      epoch: runtime.epoch,
      context: Object.freeze(normalizeStoreContextEnvelope(runtime.context)),
    }) as AmazonAdsVisibleIdentityClaim;
    this.amazonAdsIdentityClaims.set(capability, {
      claim,
      runtime,
      epoch: runtime.epoch,
      used: false,
    });
    this.liveAmazonAdsIdentityClaim = claim;
    return claim;
  }

  verifyAmazonAdsIdentity(claim: AmazonAdsVisibleIdentityClaim): VisibleBrowserRuntime {
    return this.transitionAmazonAdsIdentity(claim, 'verified');
  }

  blockAmazonAdsIdentity(claim: AmazonAdsVisibleIdentityClaim): VisibleBrowserRuntime {
    return this.transitionAmazonAdsIdentity(claim, 'blocked');
  }

  strictClose(claim: VisibleBrowserRuntimeClaim): Promise<VisibleBrowserRuntimeEmptyProof> {
    this.assertNotTerminalSealed();
    if (this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is already closing',
      );
    }
    const record = this.consumeClaim(claim);
    const operation = this.performStrictClose(record);
    this.closeOperation = operation;
    return operation;
  }

  strictCloseCurrent(
    expectedContext?: StoreContextEnvelope,
  ): Promise<VisibleBrowserRuntimeEmptyProof> {
    this.assertNotTerminalSealed();
    if (this.closing) {
      const runtime = this.currentRuntime;
      if (expectedContext && (!runtime || !sameContext(runtime.context, expectedContext))) {
        throw new VisibleBrowserRuntimeRegistryError(
          'RUNTIME_CAS_MISMATCH',
          'closing visible runtime does not match the exact Store/Profile/date/generation',
        );
      }
      if (this.closeOperation) return this.closeOperation;
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is already closing without a shared operation',
      );
    }
    const runtime = this.requireCurrent();
    if (expectedContext && !sameContext(runtime.context, expectedContext)) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'visible runtime does not match the exact close Store/Profile/date/generation',
      );
    }
    // Manual login code may still hold the candidate claim. Main's strict
    // close handoff revokes it by identity before issuing the one close claim.
    if (this.liveClaim) {
      const liveRecord = this.requireClaim(this.liveClaim, false);
      liveRecord.used = true;
      this.liveClaim = null;
    }
    const closeClaim = this.issueClaim(runtime);
    return this.strictClose(closeClaim);
  }

  private async performStrictClose(
    record: RuntimeClaimRecord,
  ): Promise<VisibleBrowserRuntimeEmptyProof> {
    const runtime = record.runtime;
    this.closing = true;
    const controllers = uniqueControllers(runtime.controllers);
    const failures: unknown[] = [];
    try {
      for (const controller of controllers) {
        try {
          await controller.close();
          this.assertRuntimeCas(runtime, record.epoch);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new VisibleBrowserRuntimeRegistryError(
          'RUNTIME_CLOSE_FAILED',
          `visible runtime close failed for ${failures.length} controller(s)`,
          { cause: failures[0] },
        );
      }
      for (const controller of controllers) {
        let page: unknown;
        let context: unknown;
        try {
          page = controller.getPage();
          context = controller.getContext();
        } catch (error) {
          throw new VisibleBrowserRuntimeRegistryError(
            'RUNTIME_RESIDUE',
            'visible runtime residue could not be inspected',
            { cause: error },
          );
        }
        if (page !== null || context !== null) {
          throw new VisibleBrowserRuntimeRegistryError(
            'RUNTIME_RESIDUE',
            'visible runtime retained a page or browser context after close',
          );
        }
      }
      this.assertRuntimeCas(runtime, record.epoch);
      this.revokeAmazonAdsIdentityClaim();
      this.currentRuntime = null;
      this.epoch = nextEpoch(this.epoch);
      return this.issueEmptyProof();
    } finally {
      // On every failure the runtime reference stays attached. Only the exact
      // successful CAS path above clears it.
      this.closing = false;
      this.closeOperation = null;
    }
  }

  closeAll(): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.terminalSealed) {
      return Promise.resolve(this.requireTerminalEmptyProof());
    }
    if (this.terminalSealing) {
      if (this.terminalSealOperation) return this.terminalSealOperation;
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime registry is entering its terminal shutdown seal',
      );
    }
    return this.closeAllUnsealed();
  }

  /**
   * Irreversibly closes and seals the registry for process shutdown. The exact
   * terminal empty proof is stable across repeated calls; no runtime or claim
   * can be published after terminal sealing begins.
   */
  closeAllAndSeal(): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.terminalSealed) {
      return Promise.resolve(this.requireTerminalEmptyProof());
    }
    if (this.terminalSealOperation) return this.terminalSealOperation;

    this.terminalSealing = true;
    let resolveSeal!: (proof: VisibleBrowserRuntimeEmptyProof) => void;
    let rejectSeal!: (error: unknown) => void;
    const operation = new Promise<VisibleBrowserRuntimeEmptyProof>((resolve, reject) => {
      resolveSeal = resolve;
      rejectSeal = reject;
    });
    // Publish the terminal attempt before a controller close can synchronously
    // re-enter shutdown. Publication/claim admission remains sealed from this
    // point onward, regardless of whether this particular close attempt wins.
    this.terminalSealOperation = operation;
    try {
      void this.completeTerminalSeal(this.closeAllForTerminalSeal())
        .then(resolveSeal, rejectSeal);
    } catch (error) {
      rejectSeal(error);
    }

    void operation.catch(() => {
      // The terminal admission seal is irreversible, but a failed controller
      // close or residue proof is retryable. A later attempt reuses the same
      // attached runtime and can only advance toward an exact empty proof.
      if (!this.terminalSealed && this.terminalSealOperation === operation) {
        this.terminalSealOperation = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  private async completeTerminalSeal(
    closeOperation: Promise<VisibleBrowserRuntimeEmptyProof>,
  ): Promise<VisibleBrowserRuntimeEmptyProof> {
    const proof = await closeOperation;
    this.assertEmptyProofCurrent(proof);
    this.terminalEmptyProof = proof;
    this.terminalSealed = true;
    this.terminalSealing = false;
    return proof;
  }

  private closeAllForTerminalSeal(): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.closing && this.closeOperation) return this.closeOperation;
    if (!this.currentRuntime) return Promise.resolve(this.issueEmptyProof());
    const runtime = this.currentRuntime;
    // Terminal shutdown consumes any candidate/login claim by exact identity,
    // but never reopens the public claim surface between retry attempts.
    if (this.liveClaim) {
      const liveRecord = this.requireClaim(this.liveClaim, false);
      liveRecord.used = true;
      this.liveClaim = null;
    }
    const closeClaim = this.issueClaim(runtime);
    const record = this.consumeClaim(closeClaim);
    const operation = this.performStrictClose(record);
    this.closeOperation = operation;
    return operation;
  }

  private closeAllUnsealed(): Promise<VisibleBrowserRuntimeEmptyProof> {
    if (this.closing && this.closeOperation) return this.closeOperation;
    if (!this.currentRuntime) return Promise.resolve(this.proveEmpty());
    return this.strictCloseCurrent(this.currentRuntime.context);
  }

  proveEmpty(): VisibleBrowserRuntimeEmptyProof {
    if (this.terminalSealed) return this.requireTerminalEmptyProof();
    if (this.terminalSealing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'cannot issue an independently consumable proof while terminal sealing is in progress',
      );
    }
    if (this.currentRuntime || this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_ALREADY_ACTIVE',
        'cannot prove the visible runtime registry empty while a runtime is attached',
      );
    }
    return this.issueEmptyProof();
  }

  consumeEmptyProof(proof: VisibleBrowserRuntimeEmptyProof): void {
    if (this.terminalSealing && !this.terminalSealed) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'cannot consume an empty proof while terminal sealing is in progress',
      );
    }
    this.assertEmptyProofCurrent(proof);
    // A terminal shutdown proof remains stable and idempotently verifiable.
    if (this.terminalSealed && proof === this.terminalEmptyProof) return;
    this.emptyProofs.delete(proof.capability);
  }

  private assertEmptyProofCurrent(proof: VisibleBrowserRuntimeEmptyProof): void {
    if (!proof
      || proof.empty !== true
      || !runtimeObject(proof.capability)
      || this.emptyProofs.get(proof.capability) !== proof
      || proof.epoch !== this.epoch
      || this.currentRuntime
      || this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_EMPTY_PROOF',
        'visible runtime empty proof is forged, replayed, stale, or no longer true',
      );
    }
  }

  private requireTerminalEmptyProof(): VisibleBrowserRuntimeEmptyProof {
    if (!this.terminalSealed || !this.terminalEmptyProof) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_EMPTY_PROOF',
        'terminal visible runtime empty proof is unavailable',
      );
    }
    this.assertEmptyProofCurrent(this.terminalEmptyProof);
    return this.terminalEmptyProof;
  }

  private assertNotTerminalSealed(): void {
    if (this.terminalSealed || this.terminalSealing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_REGISTRY_SEALED',
        'visible browser runtime registry is terminally sealed for shutdown',
      );
    }
  }

  private requireCurrent(): VisibleBrowserRuntime {
    if (!this.currentRuntime) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_NOT_FOUND',
        'visible browser runtime was not found',
      );
    }
    return this.currentRuntime;
  }

  private issueClaim(runtime: VisibleBrowserRuntime): VisibleBrowserRuntimeClaim {
    if (this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'cannot issue a visible runtime claim during strict close',
      );
    }
    if (this.liveClaim) {
      throw new VisibleBrowserRuntimeRegistryError(
        'CLAIM_HELD',
        'the active visible runtime already has a live claim',
      );
    }
    const capability = Object.freeze({});
    const claim = Object.freeze({ capability, runtime }) as VisibleBrowserRuntimeClaim;
    this.claims.set(capability, { runtime, epoch: runtime.epoch, used: false });
    this.liveClaim = claim;
    return claim;
  }

  private issueEmptyProof(): VisibleBrowserRuntimeEmptyProof {
    if (this.currentRuntime) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_ALREADY_ACTIVE',
        'cannot issue an empty proof while a runtime remains attached',
      );
    }
    const capability = Object.freeze({});
    const proof = Object.freeze({ capability, empty: true, epoch: this.epoch });
    this.emptyProofs.set(capability, proof);
    return proof;
  }

  private requireClaim(
    claim: VisibleBrowserRuntimeClaim,
    allowUsed: boolean,
  ): RuntimeClaimRecord {
    if (!claim
      || !runtimeObject(claim)
      || !runtimeObject(claim.capability)
      || !claim.runtime) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_CLAIM',
        'visible runtime claim is required',
      );
    }
    const record = this.claims.get(claim.capability);
    if (!record
      || claim.runtime !== record.runtime
      || (!allowUsed && record.used)) {
      throw new VisibleBrowserRuntimeRegistryError(
        record?.used ? 'CLAIM_REPLAYED' : 'INVALID_CLAIM',
        'visible runtime claim is forged or replayed',
      );
    }
    return record;
  }

  private consumeClaim(claim: VisibleBrowserRuntimeClaim): RuntimeClaimRecord {
    const record = this.requireClaim(claim, false);
    this.assertRuntimeCas(record.runtime, record.epoch);
    record.used = true;
    if (this.liveClaim === claim) this.liveClaim = null;
    return record;
  }

  private transitionAmazonAdsIdentity(
    claim: AmazonAdsVisibleIdentityClaim,
    nextStatus: Extract<AmazonAdsVisibleIdentityStatus, 'verified' | 'blocked'>,
  ): VisibleBrowserRuntime {
    this.assertNotTerminalSealed();
    const record = claim && runtimeObject(claim.capability)
      ? this.amazonAdsIdentityClaims.get(claim.capability)
      : undefined;
    if (!record || record.claim !== claim) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_AMAZON_ADS_IDENTITY_CLAIM',
        'Amazon Ads identity claim is forged or unknown',
      );
    }
    if (record.used) {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_CLAIM_REPLAYED',
        'Amazon Ads identity claim was already consumed or replayed',
      );
    }
    this.assertRuntimeCas(record.runtime, record.epoch);
    record.used = true;
    if (this.liveAmazonAdsIdentityClaim === claim) {
      this.liveAmazonAdsIdentityClaim = null;
    }
    const runtime = record.runtime;
    if (runtime.purpose !== 'operator_full'
      || !runtime.controllers.amazonAds
      || runtime.providerIdentityStatus.amazonAds === 'not_present') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_FORBIDDEN',
        'Amazon Ads identity transitions require the exact operator_full runtime',
      );
    }
    if (nextStatus === 'verified'
      && runtime.providerIdentityStatus.amazonAds === 'blocked') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_TRANSITION_FORBIDDEN',
        'a blocked Amazon Ads identity cannot become verified',
      );
    }
    if (runtime.providerIdentityStatus.amazonAds === nextStatus) {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_TRANSITION_FORBIDDEN',
        `Amazon Ads identity is already ${nextStatus}`,
      );
    }
    const epoch = nextEpoch(this.epoch);
    const nextRuntime = freezeRuntime({
      ...runtime,
      epoch,
      providerIdentityStatus: {
        ...runtime.providerIdentityStatus,
        amazonAds: nextStatus,
      },
    });
    this.assertRuntimeCas(runtime, record.epoch);
    this.revokeVisibleRuntimeClaim();
    this.epoch = epoch;
    this.currentRuntime = nextRuntime;
    return nextRuntime;
  }

  private revokeVisibleRuntimeClaim(): void {
    if (!this.liveClaim) return;
    const record = this.requireClaim(this.liveClaim, false);
    record.used = true;
    this.liveClaim = null;
  }

  private revokeAmazonAdsIdentityClaim(): void {
    if (!this.liveAmazonAdsIdentityClaim) return;
    const record = this.amazonAdsIdentityClaims.get(
      this.liveAmazonAdsIdentityClaim.capability,
    );
    if (record) record.used = true;
    this.liveAmazonAdsIdentityClaim = null;
  }

  private assertRuntimeCas(runtime: VisibleBrowserRuntime, epoch: number): void {
    if (this.currentRuntime !== runtime || this.epoch !== epoch) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'visible runtime identity or epoch changed during an asynchronous operation',
      );
    }
  }
}

export type StoreMutationLaneKind = 'user' | 'automation';

declare const storeMutationLaneClaimBrand: unique symbol;
export type StoreMutationLaneClaim = Readonly<{
  kind: StoreMutationLaneKind;
  owner: string;
  authorityCapability: Readonly<object>;
  claimCapability: Readonly<object>;
  sequence: number;
  readonly [storeMutationLaneClaimBrand]: 'StoreMutationLaneClaim';
}>;

export interface StoreMutationLaneReleaseReceipt {
  claimCapability: Readonly<object>;
  released: true;
  sequence: number;
}

export interface StoreMutationLaneSnapshot {
  state: 'available' | 'held' | 'sticky_unknown';
  held: boolean;
  stickyUnknown: boolean;
  sequence: number;
  current?: Readonly<{
    kind: StoreMutationLaneKind;
    owner: string;
    sequence: number;
  }>;
}

interface MutationAuthorityRecord {
  kind: StoreMutationLaneKind;
  owner: string;
  lifecycle: 'registered' | 'claimed' | 'released';
}

interface MutationClaimRecord {
  claim: StoreMutationLaneClaim;
  released: boolean;
}

export class StoreMutationLaneError extends Error {
  constructor(
    readonly code:
      | 'LANE_HELD'
      | 'INVALID_AUTHORITY'
      | 'AUTHORITY_REPLAYED'
      | 'INVALID_CLAIM'
      | 'CLAIM_REPLAYED'
      | 'SEQUENCE_EXHAUSTED'
      | 'SAFETY_STATE_UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'StoreMutationLaneError';
  }
}

/**
 * Synchronous admission lane shared by Renderer-triggered Store mutations and
 * collection automation. Admission always completes before a caller can reach
 * its first await.
 */
export class StoreMutationLane {
  private readonly authorities = new WeakMap<object, MutationAuthorityRecord>();
  private readonly claims = new WeakMap<object, MutationClaimRecord>();
  private current: StoreMutationLaneClaim | null = null;
  private sequence = 0;
  private stickyUnknown = false;

  registerAuthority(input: {
    kind: StoreMutationLaneKind;
    owner: string;
    capability: Readonly<object>;
  }): void {
    this.assertSafetyKnown();
    const owner = normalizeOwner(input?.owner);
    if ((input.kind !== 'user' && input.kind !== 'automation')
      || !runtimeObject(input.capability)) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane authority is invalid',
      );
    }
    const previous = this.authorities.get(input.capability);
    if (previous
      && (previous.kind !== input.kind || previous.owner !== owner)) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane capability cannot cross owner or user/automation domains',
      );
    }
    if (!previous) {
      this.authorities.set(input.capability, {
        kind: input.kind,
        owner,
        lifecycle: 'registered',
      });
    }
  }

  claim(input: {
    kind: StoreMutationLaneKind;
    owner: string;
    capability: Readonly<object>;
  }): StoreMutationLaneClaim {
    this.assertSafetyKnown();
    const owner = normalizeOwner(input?.owner);
    const record = runtimeObject(input?.capability)
      ? this.authorities.get(input.capability)
      : undefined;
    if (!record || record.kind !== input.kind || record.owner !== owner) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane authority is forged or owner/domain mismatched',
      );
    }
    if (record.lifecycle !== 'registered') {
      throw new StoreMutationLaneError(
        'AUTHORITY_REPLAYED',
        'mutation lane authority is one-shot and was already claimed',
      );
    }
    if (this.current) {
      throw new StoreMutationLaneError(
        'LANE_HELD',
        `store mutation lane is already held by ${this.current.kind}:${this.current.owner}`,
      );
    }
    const sequence = this.sequence + 1;
    if (!Number.isSafeInteger(sequence)) {
      throw new StoreMutationLaneError(
        'SEQUENCE_EXHAUSTED',
        'store mutation lane sequence is exhausted',
      );
    }
    this.sequence = sequence;
    // Consume the authority before returning control to the caller. The caller
    // therefore cannot reach its first await with a replayable admission token.
    record.lifecycle = 'claimed';
    const claimCapability = Object.freeze({});
    const claim = Object.freeze({
      kind: input.kind,
      owner,
      authorityCapability: input.capability,
      claimCapability,
      sequence,
    }) as StoreMutationLaneClaim;
    this.claims.set(claimCapability, { claim, released: false });
    this.current = claim;
    return claim;
  }

  release(claim: StoreMutationLaneClaim): StoreMutationLaneReleaseReceipt {
    this.assertSafetyKnown();
    const record = claim && runtimeObject(claim.claimCapability)
      ? this.claims.get(claim.claimCapability)
      : undefined;
    if (!record || record.claim !== claim || this.current !== claim) {
      throw new StoreMutationLaneError(
        record?.released ? 'CLAIM_REPLAYED' : 'INVALID_CLAIM',
        'mutation lane claim is forged, stale, or replayed',
      );
    }
    const authority = this.authorities.get(claim.authorityCapability);
    if (!authority
      || authority.lifecycle !== 'claimed'
      || authority.kind !== claim.kind
      || authority.owner !== claim.owner) {
      throw new StoreMutationLaneError(
        'INVALID_AUTHORITY',
        'mutation lane authority lifecycle no longer matches the exact claim',
      );
    }
    record.released = true;
    authority.lifecycle = 'released';
    this.current = null;
    return Object.freeze({
      claimCapability: claim.claimCapability,
      released: true,
      sequence: claim.sequence,
    });
  }

  isHeld(): boolean {
    return this.current !== null;
  }

  markSafetyStateUnknown(): StoreMutationLaneSnapshot {
    this.stickyUnknown = true;
    return this.inspect();
  }

  inspect(): StoreMutationLaneSnapshot {
    const current = this.current
      ? Object.freeze({
        kind: this.current.kind,
        owner: this.current.owner,
        sequence: this.current.sequence,
      })
      : undefined;
    return Object.freeze({
      state: this.stickyUnknown
        ? 'sticky_unknown'
        : current
          ? 'held'
          : 'available',
      held: current !== undefined,
      stickyUnknown: this.stickyUnknown,
      sequence: this.sequence,
      ...(current ? { current } : {}),
    });
  }

  private assertSafetyKnown(): void {
    if (this.stickyUnknown) {
      throw new StoreMutationLaneError(
        'SAFETY_STATE_UNKNOWN',
        'store mutation lane safety state is unknown',
      );
    }
  }
}

function assertCandidate(input: VisibleBrowserRuntimeCandidate): void {
  const lingxingProfileDir = normalizedProfileDir(input?.profileDirs?.lingxing);
  const amazonAdsProfileDir = normalizedProfileDir(input?.profileDirs?.amazonAds);
  if (!input
    || (input.purpose !== 'operator_full' && input.purpose !== 'collection_only')
    || !input.controllers
    || !controllerLike(input.controllers.lingxing)
    || (input.controllers.amazonAds !== undefined && !controllerLike(input.controllers.amazonAds))
    || (input.purpose === 'collection_only' && (
      input.controllers.amazonAds !== undefined
      || input.profileDirs?.amazonAds !== undefined
      || input.connections?.amazonAds !== undefined
      || input.amazonAdsIdentityStatus !== undefined
    ))) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime candidate has an invalid purpose or controller set',
    );
  }
  if (input.purpose === 'operator_full' && (
    !controllerLike(input.controllers.amazonAds)
    || input.controllers.lingxing === input.controllers.amazonAds
    || !lingxingProfileDir
    || !amazonAdsProfileDir
    || lingxingProfileDir === amazonAdsProfileDir
    || !input.connections?.lingxing
    || !input.connections.amazonAds
  )) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'operator_full runtime requires distinct Lingxing/Amazon Ads controllers, profiles, and connections',
    );
  }
  if (input.profileDirs?.lingxing !== undefined && !lingxingProfileDir) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime Lingxing profile directory must be non-empty',
    );
  }
  if (input.amazonAdsIdentityStatus !== undefined
    && !['unknown', 'pending', 'blocked'].includes(input.amazonAdsIdentityStatus)) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'initial Amazon Ads identity status is invalid',
    );
  }
  if (input.attempt) {
    if ((input.attempt.kind !== 'manual' && input.attempt.kind !== 'automation')
      || !safeIdentity(input.attempt.attemptId)
      || !Number.isSafeInteger(input.attempt.attemptEpoch)
      || input.attempt.attemptEpoch < 0) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_RUNTIME',
        'visible runtime attempt identity is invalid',
      );
    }
  }
  if (input.connections) {
    if (input.connections.lingxing.provider !== 'lingxing'
      || input.connections.lingxing.storeId !== input.context.storeId
      || (input.connections.amazonAds !== undefined
        && (input.connections.amazonAds.provider !== 'amazon_ads'
          || input.connections.amazonAds.storeId !== input.context.storeId))) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_RUNTIME',
        'visible runtime provider connections do not match the exact store',
      );
    }
  }
}

function normalizedProfileDir(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = path.win32.normalize(value.trim())
    .replace(/[\\/]+$/u, '')
    .toLocaleLowerCase('en-US');
  return normalized || null;
}

function freezeRuntime(input: VisibleBrowserRuntime): VisibleBrowserRuntime {
  const context = Object.freeze(normalizeStoreContextEnvelope(input.context));
  return Object.freeze({
    ...input,
    context,
    providerIdentityStatus: Object.freeze({ ...input.providerIdentityStatus }),
    controllers: Object.freeze({ ...input.controllers }),
    ...(input.profileDirs ? { profileDirs: Object.freeze({ ...input.profileDirs }) } : {}),
    ...(input.connections ? {
      connections: Object.freeze({
        lingxing: cloneConnection(input.connections.lingxing),
        ...(input.connections.amazonAds
          ? { amazonAds: cloneConnection(input.connections.amazonAds) }
          : {}),
      }),
    } : {}),
    ...(input.attempt ? { attempt: Object.freeze({ ...input.attempt }) } : {}),
  });
}

function cloneConnection(connection: StoreConnection): StoreConnection {
  return Object.freeze({
    ...connection,
    ...(connection.session
      ? { session: Object.freeze({ ...connection.session }) }
      : {}),
  });
}

function uniqueControllers(
  controllers: VisibleBrowserRuntimeControllers,
): VisibleBrowserControllerLike[] {
  return [...new Set([
    controllers.lingxing,
    ...(controllers.amazonAds ? [controllers.amazonAds] : []),
  ])];
}

function controllerLike(value: unknown): value is VisibleBrowserControllerLike {
  return Boolean(value)
    && typeof (value as VisibleBrowserControllerLike).close === 'function'
    && typeof (value as VisibleBrowserControllerLike).getPage === 'function'
    && typeof (value as VisibleBrowserControllerLike).getContext === 'function';
}

function assertUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime supports exact US/USD/America/Los_Angeles context only',
    );
  }
}

function sameStoreProfileGeneration(
  left: StoreContextEnvelope,
  rightInput: StoreContextEnvelope,
): boolean {
  const right = normalizeStoreContextEnvelope(rightInput);
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.sessionGeneration === right.sessionGeneration;
}

export function sameVisibleRuntimeContext(
  left: StoreContextEnvelope,
  right: StoreContextEnvelope,
): boolean {
  return sameContext(left, right);
}

function sameContext(
  leftInput: StoreContextEnvelope,
  rightInput: StoreContextEnvelope,
): boolean {
  const left = normalizeStoreContextEnvelope(leftInput);
  const right = normalizeStoreContextEnvelope(rightInput);
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

function nextEpoch(value: number): number {
  const next = value + 1;
  if (!Number.isSafeInteger(next)) {
    throw new VisibleBrowserRuntimeRegistryError(
      'INVALID_RUNTIME',
      'visible runtime epoch is exhausted',
    );
  }
  return next;
}

function safeIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
}

function normalizeOwner(value: unknown): string {
  if (!safeIdentity(value)) {
    throw new StoreMutationLaneError(
      'INVALID_AUTHORITY',
      'mutation lane owner must use 1-160 safe identity characters',
    );
  }
  return value;
}

function runtimeObject(value: unknown): value is Readonly<object> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}
