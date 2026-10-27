import {
  type LingxingCollectionCancellationGuard,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionRequestDto,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  transitionCollectionResultToCancelled,
} from "./collection-coordinator-state-values";
import type { CollectionCoordinatorRuntime } from './collection-coordinator-runtime';

export function buildCancellationGuard(this: CollectionCoordinatorRuntime): LingxingCollectionCancellationGuard {
    return (context) => this.dependencies.isCancelled?.({
      jobId: context.jobId,
      requestId: context.requestId,
      storeId: context.storeContext.storeId,
    })
      ? {
          allowed: false,
          blockerCode: 'LINGXING_COLLECTION_CANCELLED',
          detail: '运营者已取消本次领星采集。',
        }
      : { allowed: true };
  }

export function cancelResultIfRequested(this: CollectionCoordinatorRuntime,
  result: RunBatchResult,
  request: LingxingCollectionRequestDto,
  context: StoreContextEnvelope): RunBatchResult {
    if (result.job.state === 'cancelled') return result;
    if (!this.isCancellationRequested(result.job.jobId, request, context)) return result;
    return transitionCollectionResultToCancelled(result);
  }

export function isCancellationRequested(this: CollectionCoordinatorRuntime,
  jobId: string,
  request: LingxingCollectionRequestDto,
  context: StoreContextEnvelope): boolean {
    return this.dependencies.isCancelled?.({
      jobId,
      requestId: request.requestId,
      storeId: context.storeId,
    }) ?? false;
  }

export function assertNotCancelled(this: CollectionCoordinatorRuntime,
  jobId: string,
  request: LingxingCollectionRequestDto,
  context: StoreContextEnvelope,
  allowCancelledTerminal = false): void {
    if (this.dependencies.isCancelled?.({
      jobId,
      requestId: request.requestId,
      storeId: context.storeId,
    }) && !allowCancelledTerminal) {
      throw new Error('LINGXING_COLLECTION_CANCELLED');
    }
  }
