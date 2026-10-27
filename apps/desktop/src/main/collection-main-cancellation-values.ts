import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreMutationLaneClaim,
} from './visible-browser-runtime-registry';
import {
  type StoreCollectionCancellationRequest,
  type NormalizedCollectionCancellationRequest,
  StoreCollectionMainRuntimeError,
  type StoreCollectionCancellationPath,
  type StoreCollectionCancellationCallbackInput,
  type StoreCollectionCancellationSettlement,
  type StoreCollectionCancellationResult,
} from "./collection-main-contracts";
import {
  assertUsContext,
  exactResumeIdentity,
} from "./collection-main-request-values";

export function normalizeCancellationRequest(
  input: StoreCollectionCancellationRequest,
): NormalizedCollectionCancellationRequest {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('collection cancellation request is required');
    }
    const context = normalizeStoreContextEnvelope(input.context);
    assertUsContext(context);
    if (typeof input.signalActiveCancellation !== 'function'
      || typeof input.clearCancellationSignal !== 'function'
      || typeof input.cancelIdle !== 'function'
      || typeof input.readDurableSettlement !== 'function') {
      throw new TypeError('collection cancellation callbacks are required');
    }
    return Object.freeze({
      context: Object.freeze({ ...context }),
      jobId: exactResumeIdentity(input.jobId, 'jobId'),
      requestId: exactResumeIdentity(input.requestId, 'requestId'),
      signalActiveCancellation: input.signalActiveCancellation,
      clearCancellationSignal: input.clearCancellationSignal,
      cancelIdle: input.cancelIdle,
      readDurableSettlement: input.readDurableSettlement,
    });
  } catch (error) {
    if (error instanceof StoreCollectionMainRuntimeError
      && error.code === 'INVALID_CANCELLATION_REQUEST') {
      throw error;
    }
    throw new StoreCollectionMainRuntimeError(
      'INVALID_CANCELLATION_REQUEST',
      'collection cancellation requires one exact Store, job, request, and callback set',
      { cause: error },
    );
  }
}

export function cancellationCallbackInput(
  request: NormalizedCollectionCancellationRequest,
  path: StoreCollectionCancellationPath,
  lane: Readonly<{ owner: string; sequence: number }>,
  requireNewResumeReceipt: boolean,
): StoreCollectionCancellationCallbackInput {
  return Object.freeze({
    context: request.context,
    storeId: request.context.storeId,
    jobId: request.jobId,
    requestId: request.requestId,
    path,
    laneOwner: lane.owner,
    laneSequence: lane.sequence,
    requireNewResumeReceipt,
  });
}

export function verifyCancellationSettlement(
  settlement: StoreCollectionCancellationSettlement,
  input: StoreCollectionCancellationCallbackInput,
): StoreCollectionCancellationResult | null {
  if (!settlement
    || typeof settlement !== 'object'
    || Array.isArray(settlement)
    || settlement.durableCancelled !== true
    || settlement.storeId !== input.storeId
    || settlement.jobId !== input.jobId
    || settlement.requestId !== input.requestId
    || typeof settlement.newResumeReceipt !== 'boolean'
    || (input.requireNewResumeReceipt && settlement.newResumeReceipt !== true)) {
    return null;
  }
  return Object.freeze({
    cancelled: true,
    path: input.path,
    laneOwner: input.laneOwner,
    laneSequence: input.laneSequence,
    storeId: input.storeId,
    jobId: input.jobId,
    requestId: input.requestId,
    newResumeReceipt: settlement.newResumeReceipt,
  });
}

export function isCancellableCollectionLane(claim: StoreMutationLaneClaim): boolean {
  return claim.kind === 'automation'
    && (claim.owner === 'manual-collection'
      || claim.owner === 'manual-collection-resume'
      || claim.owner === 'scheduled-collection');
}

export function sameStoreContext(
  left: StoreContextEnvelope,
  right: StoreContextEnvelope,
): boolean {
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

export function sameCancellationCompositeKey(
  left: NormalizedCollectionCancellationRequest,
  right: NormalizedCollectionCancellationRequest,
): boolean {
  return left.context.storeId === right.context.storeId
    && left.jobId === right.jobId
    && left.requestId === right.requestId;
}
