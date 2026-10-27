import {
  type BrowserTransitionBarrierProof,
  type BrowserTransitionEnteredProof,
  type BrowserTransitionLeaseEmptyProof,
  type BrowserTransitionRuntimeStartedProof,
} from '@amazon-ai-ops/browser-worker';
import {
  type CloseInput,
  type ActiveTransitionBarrier,
  StoreCollectionVisibleRuntimeAdapterError,
} from "./collection-visible-contracts";
import type { CollectionVisibleAdapterRuntime } from './collection-visible-runtime';

export function ensureTransitionBarrier(this: CollectionVisibleAdapterRuntime,
  input: CloseInput): ActiveTransitionBarrier {
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

export function requireTransitionBarrier(this: CollectionVisibleAdapterRuntime,
  input: CloseInput,
  expectedStage?: BrowserTransitionBarrierProof['stage']): ActiveTransitionBarrier {
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

export function confirmBarrierRuntimeClosed(this: CollectionVisibleAdapterRuntime,
  barrier: ActiveTransitionBarrier): void {
    if (barrier.proof.stage !== 'runtime_closed') {
      barrier.proof = this.options.browserLeases.confirmTransitionRuntimeClosed(
        barrier.proof as
          | BrowserTransitionEnteredProof
          | BrowserTransitionLeaseEmptyProof
          | BrowserTransitionRuntimeStartedProof,
      );
    }
  }

export function markBarrierUnknown(this: CollectionVisibleAdapterRuntime,
  barrier: ActiveTransitionBarrier): void {
    try {
      barrier.proof = this.options.browserLeases.markTransitionSafetyUnknown(barrier.proof);
    } catch {
      // 保留原绑定；伪造或过期屏障已属未知状态，不可在此释放。
    }
  }

export function markActiveBarrierUnknownForExactInput(this: CollectionVisibleAdapterRuntime,
  input: CloseInput): void {
    const barrier = this.activeBarrier;
    if (barrier
      && barrier.owner === input.owner
      && barrier.automationCapability === input.capability
      && barrier.transitionCapability === input.transitionCapability) {
      this.markBarrierUnknown(barrier);
    }
  }

export function readNow(this: CollectionVisibleAdapterRuntime): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw this.error('SAFETY_STATE_UNKNOWN', 'visible runtime clock is invalid');
    }
    return value.toISOString();
  }

export function error(this: CollectionVisibleAdapterRuntime,
  code: StoreCollectionVisibleRuntimeAdapterError['code'],
  message: string,
  cause?: unknown): StoreCollectionVisibleRuntimeAdapterError {
    return new StoreCollectionVisibleRuntimeAdapterError(
      code,
      message,
      cause === undefined ? undefined : { cause },
    );
  }
