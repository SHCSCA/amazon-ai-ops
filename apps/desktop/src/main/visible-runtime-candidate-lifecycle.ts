import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type VisibleBrowserRuntime,
  type VisibleBrowserRuntimeCandidate,
  type VisibleBrowserRuntimeClaim,
  VisibleBrowserRuntimeRegistryError,
  type RuntimeClaimRecord,
} from "./visible-runtime-contracts";
import {
  sameStoreProfileGeneration,
  safeIdentity,
  assertUsContext,
  assertCandidate,
  nextEpoch,
  freezeRuntime,
  sameContext,
  runtimeObject,
} from "./visible-runtime-values";

import type { VisibleRuntimeRegistryContext } from './visible-runtime-runtime';

export function read(this: VisibleRuntimeRegistryContext): VisibleBrowserRuntime | null {
    return this.currentRuntime;
  }

export function publishCandidate(this: VisibleRuntimeRegistryContext,
  input: VisibleBrowserRuntimeCandidate): VisibleBrowserRuntimeClaim {
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

export function claimCurrent(this: VisibleRuntimeRegistryContext,
  expectedContext?: StoreContextEnvelope): VisibleBrowserRuntimeClaim {
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

export function assertClaimCurrent(this: VisibleRuntimeRegistryContext,
  claim: VisibleBrowserRuntimeClaim): VisibleBrowserRuntime {
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

export function verifyLingxingCandidate(this: VisibleRuntimeRegistryContext,
  claim: VisibleBrowserRuntimeClaim): VisibleBrowserRuntimeClaim {
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

export function requireCurrent(this: VisibleRuntimeRegistryContext): VisibleBrowserRuntime {
    if (!this.currentRuntime) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_NOT_FOUND',
        'visible browser runtime was not found',
      );
    }
    return this.currentRuntime;
  }

export function issueClaim(this: VisibleRuntimeRegistryContext,
  runtime: VisibleBrowserRuntime): VisibleBrowserRuntimeClaim {
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

export function requireClaim(this: VisibleRuntimeRegistryContext,
  claim: VisibleBrowserRuntimeClaim,
  allowUsed: boolean): RuntimeClaimRecord {
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

export function consumeClaim(this: VisibleRuntimeRegistryContext,
  claim: VisibleBrowserRuntimeClaim): RuntimeClaimRecord {
    const record = this.requireClaim(claim, false);
    this.assertRuntimeCas(record.runtime, record.epoch);
    record.used = true;
    if (this.liveClaim === claim) this.liveClaim = null;
    return record;
  }

export function revokeVisibleRuntimeClaim(this: VisibleRuntimeRegistryContext): void {
    if (!this.liveClaim) return;
    const record = this.requireClaim(this.liveClaim, false);
    record.used = true;
    this.liveClaim = null;
  }

export function assertRuntimeCas(this: VisibleRuntimeRegistryContext,
  runtime: VisibleBrowserRuntime,
  epoch: number): void {
    if (this.currentRuntime !== runtime || this.epoch !== epoch) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'visible runtime identity or epoch changed during an asynchronous operation',
      );
    }
  }
