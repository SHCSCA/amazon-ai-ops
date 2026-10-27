import {
  type StoreMutationLaneClaim,
} from './visible-browser-runtime-registry';
import {
  StoreCollectionMainRuntimeError,
  type StoreCollectionMainCycleResult,
} from "./collection-main-contracts";
import {
  isDrainTimeoutFailure,
  isRetryableRegistryCloseFailure,
  remainingTimeout,
  waitForOperation,
  waitForSettledOperations,
} from "./collection-main-shutdown-values";

import type { CollectionMainRuntimeContext } from './collection-main-runtime';

export function stopAndDrain(this: CollectionMainRuntimeContext,
  timeoutMs = 5_000): Promise<void> {
    if (this.shutdownOperation) return this.shutdownOperation;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new StoreCollectionMainRuntimeError(
        'DRAIN_TIMEOUT',
        'Main collection runtime drain timeout must be a non-negative integer',
      ));
    }
    this.lifecycle = 'stopping';
    this.automationStarted = false;
    this.drainInProgress = true;
    this.clearAutomationTimer();

    let resolveOperation!: () => void;
    let rejectOperation!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    // 先公布当前退出操作，确保同步重入也等待同一次尝试。
    this.shutdownOperation = operation;
    try {
      void this.performStopAndDrain(timeoutMs).then(resolveOperation, rejectOperation);
    } catch (error) {
      rejectOperation(error);
    }
    // 超时后保持准入关闭，底层操作结算后允许重新核验退出状态。
    void operation.catch((error) => {
      if (isDrainTimeoutFailure(error) && this.shutdownOperation === operation) {
        this.shutdownOperation = null;
      }
    }).catch(() => undefined);
    return operation;
  }

export function closeRegistry(this: CollectionMainRuntimeContext,
  timeoutMs = 5_000): Promise<void> {
    if (this.registryClosed) return Promise.resolve();
    if (this.registryCloseOperation) return this.registryCloseOperation;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new StoreCollectionMainRuntimeError(
        'DRAIN_TIMEOUT',
        'visible runtime registry close timeout must be a positive integer',
      ));
    }
    if (!this.drainProven) {
      return Promise.reject(new StoreCollectionMainRuntimeError(
        'DRAIN_REQUIRED',
        'orchestrator drain must be proven before closing the visible runtime registry',
      ));
    }
    let shutdownClaim: StoreMutationLaneClaim;
    try {
      shutdownClaim = this.claimExactShutdownLane();
    } catch (error) {
      this.markStickyUnknown();
      return Promise.reject(error instanceof StoreCollectionMainRuntimeError
        ? error
        : new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'the exact drained mutation-lane state could not be claimed for registry shutdown',
          { cause: error },
        ));
    }

    let resolveOperation!: () => void;
    let rejectOperation!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    // 控制器关闭可能同步重入，必须先公布当前操作。
    this.registryCloseOperation = operation;
    try {
      void this.performRegistryClose(timeoutMs, shutdownClaim)
        .then(resolveOperation, rejectOperation);
    } catch (error) {
      rejectOperation(error);
    }
    void operation.catch((error) => {
      if (isRetryableRegistryCloseFailure(error)
        && this.registryCloseOperation === operation) {
        this.registryCloseOperation = null;
      }
    }).catch(() => undefined);
    return operation;
  }

export async function performStopAndDrain(this: CollectionMainRuntimeContext,
  timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    try {
      const orchestratorTimeout = remainingTimeout(timeoutMs, startedAt);
      await waitForOperation(
        this.orchestrator.stopAndDrain(orchestratorTimeout),
        orchestratorTimeout,
        'collection orchestrator did not stop before the Main shutdown deadline',
      );
      await waitForSettledOperations(
        [...this.activeLaneOperations],
        remainingTimeout(timeoutMs, startedAt),
      );
      const lane = this.mutationLane.inspect();
      if (lane.stickyUnknown || this.lifecycle === 'sticky_unknown') {
        throw new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'shared Store mutation lane became sticky unknown during orchestrator drain',
        );
      }
      if (lane.held) {
        throw new StoreCollectionMainRuntimeError(
          'DRAIN_TIMEOUT',
          'shared Store mutation lane did not prove exact empty after orchestrator drain',
        );
      }
      if (lane.state !== 'available' || !Number.isSafeInteger(lane.sequence)) {
        throw new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'shared Store mutation lane did not expose an exact available drain sequence',
        );
      }
      this.drainProof = Object.freeze({
        laneSequence: lane.sequence,
        laneState: 'available',
      });
      this.drainProven = true;
      this.lifecycle = 'stopped';
    } catch (error) {
      const lane = this.mutationLane.inspect();
      if (isDrainTimeoutFailure(error)
        && this.lifecycle !== 'sticky_unknown'
        && !lane.stickyUnknown) {
        this.lifecycle = 'stopping';
        this.drainProof = null;
        this.drainProven = false;
        throw error instanceof StoreCollectionMainRuntimeError
          ? error
          : new StoreCollectionMainRuntimeError(
            'DRAIN_TIMEOUT',
            'Main collection runtime did not prove an exact drain before the deadline',
            { cause: error },
          );
      }
      this.markStickyUnknown();
      throw error;
    } finally {
      this.drainInProgress = false;
    }
  }

export function acceptsGracefulShutdownStop(this: CollectionMainRuntimeContext): boolean {
    return this.drainInProgress && this.lifecycle === 'stopping';
  }

export async function performRegistryClose(this: CollectionMainRuntimeContext,
  timeoutMs: number,
  shutdownClaim: StoreMutationLaneClaim): Promise<void> {
    try {
      const proof = await waitForOperation(
        this.registry.closeAllAndSeal(),
        timeoutMs,
        'visible runtime registry did not close before the shutdown deadline',
      );
      this.registry.consumeEmptyProof(proof);
      this.assertExactShutdownLaneHeld(shutdownClaim);
      this.registryClosed = true;
    } catch (error) {
      if (isRetryableRegistryCloseFailure(error)) {
        // 保留终止通道声明及注册表封锁，后续退出只重试关闭与证明。
        try {
          this.assertExactShutdownLaneHeld(shutdownClaim);
        } catch (integrityError) {
          this.markStickyUnknown();
          throw integrityError;
        }
        this.lifecycle = 'stopped';
        throw error instanceof StoreCollectionMainRuntimeError
          ? error
          : new StoreCollectionMainRuntimeError(
            'REGISTRY_CLOSE_FAILED',
            'visible runtime registry did not close and consume its exact empty proof',
            { cause: error },
          );
      }
      this.markStickyUnknown();
      if (error instanceof StoreCollectionMainRuntimeError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        throw error;
      }
      throw new StoreCollectionMainRuntimeError(
        'REGISTRY_CLOSE_FAILED',
        'visible runtime registry did not close and consume its exact empty proof',
        { cause: error },
      );
    }
  }

export function claimExactShutdownLane(this: CollectionMainRuntimeContext): StoreMutationLaneClaim {
    if (this.shutdownLaneClaim) {
      this.assertExactShutdownLaneHeld(this.shutdownLaneClaim);
      return this.shutdownLaneClaim;
    }
    const proof = this.drainProof;
    const before = this.mutationLane.inspect();
    if (!proof
      || proof.laneState !== 'available'
      || before.state !== 'available'
      || before.held
      || before.stickyUnknown
      || before.sequence !== proof.laneSequence) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'mutation-lane state changed after the exact drain proof was issued',
      );
    }
    const capability = this.createAuthorityCapability();
    this.registerRuntimeCapability(capability);
    this.mutationLane.registerAuthority({
      kind: 'automation',
      owner: 'shutdown-registry-close',
      capability,
    });
    const claim = this.mutationLane.claim({
      kind: 'automation',
      owner: 'shutdown-registry-close',
      capability,
    });
    const after = this.mutationLane.inspect();
    if (claim.sequence !== proof.laneSequence + 1
      || after.state !== 'held'
      || !after.held
      || after.stickyUnknown
      || after.sequence !== claim.sequence
      || after.current?.kind !== claim.kind
      || after.current.owner !== claim.owner
      || after.current.sequence !== claim.sequence) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'shutdown mutation-lane claim did not bind the exact fresh drain sequence',
      );
    }
    this.shutdownLaneClaim = claim;
    return claim;
  }

export function assertExactShutdownLaneHeld(this: CollectionMainRuntimeContext,
  claim: StoreMutationLaneClaim): void {
    if (this.shutdownLaneClaim !== claim) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'shutdown mutation-lane claim identity changed during registry close',
      );
    }
    const held = this.mutationLane.inspect();
    if (held.state !== 'held'
      || !held.held
      || held.stickyUnknown
      || held.sequence !== claim.sequence
      || held.current?.kind !== claim.kind
      || held.current.owner !== claim.owner
      || held.current.sequence !== claim.sequence) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'shutdown mutation-lane claim was not held through registry empty proof',
      );
    }
    // 退出时保留同一不透明声明，防止注册表封锁后仍有通道修改店铺权限。
  }

export function requireCycleSettlement(this: CollectionMainRuntimeContext,
  result: StoreCollectionMainCycleResult,
  operation: string): StoreCollectionMainCycleResult {
    if (result?.state === 'completed'
      || (result?.state === 'stopped' && this.acceptsGracefulShutdownStop())) {
      return result;
    }
    throw new StoreCollectionMainRuntimeError(
      'SAFETY_STATE_UNKNOWN',
      `${operation} did not prove a completed cycle or an exact shutdown stop`,
    );
  }
