import {
  StoreMutationLaneError,
  type StoreMutationLaneKind,
} from './visible-browser-runtime-registry';
import {
  isUserVisibleBrowserTransitionPreMutationError,
} from './user-visible-browser-transition';
import {
  type StoreCollectionActiveLaneTarget,
  type StoreCollectionActiveLaneOperation,
  StoreCollectionMainRuntimeError,
  type StoreCollectionCancellationResult,
} from "./collection-main-contracts";
import {
  verifyCancellationSettlement,
} from "./collection-main-cancellation-values";

import type { CollectionMainRuntimeContext } from './collection-main-runtime';

export function withMutationLane<Result>(this: CollectionMainRuntimeContext,
  kind: StoreMutationLaneKind,
  owner: string,
  work: () => Promise<Result> | Result,
  target?: StoreCollectionActiveLaneTarget): Promise<Result> {
    const operation = this.performMutationLaneWork(kind, owner, work, target);
    this.activeLaneOperations.add(operation);
    void operation.finally(() => {
      this.activeLaneOperations.delete(operation);
    }).catch(() => undefined);
    return operation;
  }

export async function performMutationLaneWork<Result>(this: CollectionMainRuntimeContext,
  kind: StoreMutationLaneKind,
  owner: string,
  work: () => Promise<Result> | Result,
  target?: StoreCollectionActiveLaneTarget): Promise<Result> {
    let capability: Readonly<object>;
    try {
      capability = this.createAuthorityCapability();
      this.registerRuntimeCapability(capability);
      this.mutationLane.registerAuthority({ kind, owner, capability });
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
    let claim;
    try {
      claim = this.mutationLane.claim({ kind, owner, capability });
    } catch (error) {
      if (!(error instanceof StoreMutationLaneError && error.code === 'LANE_HELD')) {
        this.markStickyUnknown();
      }
      throw error;
    }
    const active: StoreCollectionActiveLaneOperation = {
      claim,
      target,
      cancellation: null,
    };
    if (this.activeLaneOperation) {
      this.markStickyUnknown();
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main collection runtime has overlapping mutation-lane operation records',
      );
    }
    this.activeLaneOperation = active;
    let workResult: Promise<Result> | Result | undefined;
    let result: Result | undefined;
    let safePreMutationRejection: unknown;
    try {
      workResult = work();
    } catch (error) {
      if (isUserVisibleBrowserTransitionPreMutationError(error)) {
        safePreMutationRejection = error;
      } else {
        this.markStickyUnknown();
        throw await this.failActiveCancellation(active, error);
      }
    }
    if (!safePreMutationRejection) {
      try {
        result = await workResult;
      } catch (error) {
        this.markStickyUnknown();
        throw await this.failActiveCancellation(active, error);
      }
    }
    let cancellationResult: StoreCollectionCancellationResult | null | undefined;
    const cancellation = active.cancellation;
    if (cancellation?.mode === 'cooperative') {
      if (cancellation.signalFailed) {
        let failure = cancellation.signalFailure;
        try {
          await (cancellation.cleanupOperation
            ?? this.clearCancellationSignalSafely(cancellation.request, cancellation.input));
        } catch (cleanupError) {
          failure = cleanupError;
        }
        cancellation.reject(failure);
        throw failure;
      }
      try {
        const settlement = await cancellation.request
          .readDurableSettlement(cancellation.input);
        cancellationResult = verifyCancellationSettlement(
          settlement,
          cancellation.input,
        );
      } catch (error) {
        let failure = error;
        try {
          await this.clearCancellationSignalSafely(
            cancellation.request,
            cancellation.input,
          );
        } catch (cleanupError) {
          failure = cleanupError;
        }
        this.markStickyUnknown();
        cancellation.reject(failure);
        throw failure;
      }
      try {
        await this.clearCancellationSignalSafely(
          cancellation.request,
          cancellation.input,
        );
      } catch (error) {
        cancellation.reject(error);
        throw error;
      }
    }
    try {
      const receipt = this.mutationLane.release(claim);
      if (receipt.released !== true
        || receipt.claimCapability !== claim.claimCapability
        || receipt.sequence !== claim.sequence) {
        throw new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'mutation lane release did not bind the exact claim',
        );
      }
    } catch (error) {
      this.markStickyUnknown();
      throw await this.failActiveCancellation(active, error);
    }
    if (this.activeLaneOperation !== active) {
      const error = new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main collection runtime lost the exact mutation-lane operation record',
      );
      this.markStickyUnknown();
      throw await this.failActiveCancellation(active, error);
    }
    this.activeLaneOperation = null;
    if (cancellation?.mode === 'cooperative') {
      if (cancellationResult) {
        cancellation.resolve(cancellationResult);
      } else {
        cancellation.reject(new StoreCollectionMainRuntimeError(
          'CANCELLATION_SETTLEMENT_UNPROVEN',
          'collection cancellation did not prove an exact durable cancelled settlement',
        ));
      }
    } else if (cancellation?.mode === 'after_release_idle') {
      try {
        cancellation.resolve(
          await this.performIdleCollectionCancellation(cancellation.request),
        );
      } catch (error) {
        cancellation.reject(error);
      }
    }
    if (safePreMutationRejection) throw safePreMutationRejection;
    return result as Result;
  }
