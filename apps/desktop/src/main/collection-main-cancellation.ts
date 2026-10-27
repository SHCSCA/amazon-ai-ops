import {
  type StoreCollectionCancellationRequest,
  type StoreCollectionCancellationResult,
  StoreCollectionMainRuntimeError,
  type StoreCollectionActiveCancellation,
  type NormalizedCollectionCancellationRequest,
  type StoreCollectionCancellationCallbackInput,
  type StoreCollectionCancellationSettlement,
  type StoreCollectionActiveLaneOperation,
} from "./collection-main-contracts";
import {
  isPromiseLike,
} from "./collection-main-request-values";
import {
  normalizeCancellationRequest,
  cancellationCallbackInput,
  isCancellableCollectionLane,
  sameCancellationCompositeKey,
  sameStoreContext,
  verifyCancellationSettlement,
} from "./collection-main-cancellation-values";

import type { CollectionMainRuntimeContext } from './collection-main-runtime';

export function cancelCollection(this: CollectionMainRuntimeContext,
  input: StoreCollectionCancellationRequest): Promise<StoreCollectionCancellationResult> {
    try {
      this.assertAutomationReady('collection cancellation');
      const request = normalizeCancellationRequest(input);
      const lane = this.mutationLane.inspect();
      if (!lane.held) {
        try {
          this.assertUserOperationAllowed();
        } catch (error) {
          return this.rejectCancellationAfterClear(
            request,
            cancellationCallbackInput(
              request,
              'idle',
              { owner: 'manual-collection-cancel', sequence: lane.sequence },
              false,
            ),
            error,
          );
        }
        return this.performIdleCollectionCancellation(request);
      }

      const active = this.activeLaneOperation;
      const current = lane.current;
      if (!active
        || !current
        || active.claim.kind !== current.kind
        || active.claim.owner !== current.owner
        || active.claim.sequence !== current.sequence
        || !isCancellableCollectionLane(active.claim)) {
        return this.rejectCancellationAfterClear(
          request,
          cancellationCallbackInput(
            request,
            'active',
            current ?? { owner: 'unknown', sequence: lane.sequence },
            false,
          ),
          new StoreCollectionMainRuntimeError(
            'COLLECTION_CANCELLATION_BLOCKED',
            'collection cancellation cannot cross a non-collection or externally held mutation lane',
          ),
        );
      }
      if (active.cancellation) {
        if (sameCancellationCompositeKey(active.cancellation.request, request)) {
          return active.cancellation.operation;
        }
        return this.rejectCancellationAfterClear(
          request,
          cancellationCallbackInput(
            request,
            'active',
            active.claim,
            active.claim.owner === 'manual-collection-resume',
          ),
          new StoreCollectionMainRuntimeError(
            'COLLECTION_CANCELLATION_BLOCKED',
            'the active collection lane already has a cancellation request',
          ),
        );
      }
      if (active.claim.owner === 'manual-collection-resume'
        && (!active.target
          || active.target.jobId !== request.jobId
          || active.target.requestId !== request.requestId
          || !sameStoreContext(active.target.context, request.context))) {
        return this.rejectCancellationAfterClear(
          request,
          cancellationCallbackInput(request, 'active', active.claim, true),
          new StoreCollectionMainRuntimeError(
            'COLLECTION_CANCELLATION_BLOCKED',
            'active resume cancellation must target the exact Store, job, and request',
          ),
        );
      }

      let resolveCancellation!: (result: StoreCollectionCancellationResult) => void;
      let rejectCancellation!: (error: unknown) => void;
      const operation = new Promise<StoreCollectionCancellationResult>((resolve, reject) => {
        resolveCancellation = resolve;
        rejectCancellation = reject;
      });
      if (active.claim.owner !== 'manual-collection-resume') {
        active.cancellation = {
          mode: 'after_release_idle',
          request,
          operation,
          resolve: resolveCancellation,
          reject: rejectCancellation,
        };
        return operation;
      }

      const callbackInput = cancellationCallbackInput(request, 'active', active.claim, true);
      const cancellation: StoreCollectionActiveCancellation = {
        mode: 'cooperative',
        input: callbackInput,
        request,
        operation,
        resolve: resolveCancellation,
        reject: rejectCancellation,
        signalFailed: false,
      };
      active.cancellation = cancellation;
      try {
        const signalResult = request.signalActiveCancellation(callbackInput);
        if (isPromiseLike(signalResult)) {
          throw new StoreCollectionMainRuntimeError(
            'SAFETY_STATE_UNKNOWN',
            'active collection cancellation signal must complete synchronously',
          );
        }
      } catch (error) {
        this.markStickyUnknown();
        cancellation.signalFailed = true;
        cancellation.signalFailure = error;
        const cleanupOperation = this.clearCancellationSignalSafely(
          request,
          callbackInput,
        );
        cancellation.cleanupOperation = cleanupOperation;
        void cleanupOperation.then(
          () => rejectCancellation(error),
          rejectCancellation,
        );
      }
      return operation;
    } catch (error) {
      return Promise.reject(error);
    }
  }

export async function performIdleCollectionCancellation(this: CollectionMainRuntimeContext,
  request: NormalizedCollectionCancellationRequest): Promise<StoreCollectionCancellationResult> {
    let callbackInput: StoreCollectionCancellationCallbackInput | undefined;
    let clearAttempted = false;
    try {
      const result = await this.withMutationLane(
        'user',
        'manual-collection-cancel',
        async () => {
          const active = this.activeLaneOperation;
          if (!active || active.claim.owner !== 'manual-collection-cancel') {
            throw new StoreCollectionMainRuntimeError(
              'SAFETY_STATE_UNKNOWN',
              'idle collection cancellation lost its exact mutation-lane claim',
            );
          }
          callbackInput = cancellationCallbackInput(
            request,
            'idle',
            active.claim,
            false,
          );
          let settlement: StoreCollectionCancellationSettlement;
          try {
            await request.cancelIdle(callbackInput);
            settlement = await request.readDurableSettlement(callbackInput);
          } catch (error) {
            clearAttempted = true;
            await this.clearCancellationSignalSafely(request, callbackInput);
            throw error;
          }
          const verified = verifyCancellationSettlement(settlement, callbackInput);
          clearAttempted = true;
          await this.clearCancellationSignalSafely(request, callbackInput);
          return verified;
        },
      );
      if (result) return result;
      throw new StoreCollectionMainRuntimeError(
        'CANCELLATION_SETTLEMENT_UNPROVEN',
        'idle collection cancellation did not prove an exact durable cancelled settlement',
      );
    } catch (error) {
      if (!clearAttempted) {
        const lane = this.mutationLane.inspect();
        await this.clearCancellationSignalSafely(
          request,
          callbackInput ?? cancellationCallbackInput(
            request,
            'idle',
            lane.current ?? { owner: 'manual-collection-cancel', sequence: lane.sequence },
            false,
          ),
        );
      }
      throw error;
    }
  }

export async function failActiveCancellation(this: CollectionMainRuntimeContext,
  active: StoreCollectionActiveLaneOperation,
  error: unknown): Promise<unknown> {
    const cancellation = active.cancellation;
    if (!cancellation) return error;
    const input = cancellation.mode === 'cooperative'
      ? cancellation.input
      : cancellationCallbackInput(
        cancellation.request,
        'active',
        active.claim,
        false,
      );
    try {
      await (cancellation.mode === 'cooperative' && cancellation.cleanupOperation
        ? cancellation.cleanupOperation
        : this.clearCancellationSignalSafely(cancellation.request, input));
    } catch (cleanupError) {
      cancellation.reject(cleanupError);
      return cleanupError;
    }
    cancellation.reject(error);
    return error;
  }

export async function rejectCancellationAfterClear(this: CollectionMainRuntimeContext,
  request: NormalizedCollectionCancellationRequest,
  input: StoreCollectionCancellationCallbackInput,
  error: unknown): Promise<never> {
    await this.clearCancellationSignalSafely(request, input);
    throw error;
  }

export async function clearCancellationSignalSafely(this: CollectionMainRuntimeContext,
  request: NormalizedCollectionCancellationRequest,
  input: StoreCollectionCancellationCallbackInput): Promise<void> {
    try {
      await request.clearCancellationSignal(input);
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
  }
