import {
  type LingxingCollectionAuthorityGuard,
  type LingxingCollectionProgressSink,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionProgressEvent,
  LingxingCollectionRequestDto,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  missionControlContextKey,
} from '@amazon-ai-ops/shared-types';
import type {
  CollectionOperation,
} from '@amazon-ai-ops/browser-worker';
import {
  assertPathContained,
  ensureStoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  COLLECTION_LEASE_TTL_MS,
} from "./collection-coordinator-constants";
import {
  type LingxingCollectionRuntime,
  type StartLingxingCollectionInput,
} from "./collection-coordinator-contracts";
import {
  attachCollectionJobLineage,
} from "./collection-coordinator-lineage-values";
import {
  assertProgressBelongsToRequest,
} from "./collection-coordinator-request-values";

import type { CollectionCoordinatorRuntime } from './collection-coordinator-runtime';
import { publishCollectionProgressAfterPersistence } from './collection-progress-publication';

export function publishResumeProgress(this: CollectionCoordinatorRuntime,
  event: LingxingCollectionProgressEvent,
  currentContext: StoreContextEnvelope): void {
    if (!this.dependencies.publishProgress) return;
    publishCollectionProgressAfterPersistence({ phase: 'resume', event,
      assertCurrent: () => this.dependencies.authority.assertActiveStoreContext(currentContext),
      publish: () => this.dependencies.publishProgress!(event),
    });
  }

export function resolveAuthorizedRuntime(this: CollectionCoordinatorRuntime,
  context: StoreContextEnvelope,
  canary: boolean): LingxingCollectionRuntime {
    const runtime = this.dependencies.resolveRuntime(context, { canary });
    if (!runtime?.automation || !runtime.capsule || !runtime.target) {
      throw new Error('LINGXING_COLLECTION_RUNTIME_UNAVAILABLE');
    }
    if (
      runtime.storeId !== context.storeId
      || runtime.browserProfileId !== context.browserProfileId
      || runtime.capsule.storeId !== context.storeId
      || runtime.capsule.browserProfileId !== context.browserProfileId
      || !runtime.storeDisplayName.trim()
      || runtime.target.marketplaceCode !== 'US'
      || runtime.target.storeId !== context.storeId
      || !runtime.target.storeName.trim()
      || runtime.canary !== canary
    ) {
      throw new Error('LINGXING_COLLECTION_RUNTIME_SCOPE_MISMATCH');
    }
    const capsule = ensureStoreCapsulePaths(runtime.capsule);
    assertPathContained(capsule.storeRoot, capsule.downloadsDir);
    return { ...runtime, capsule };
  }

export function captureAuthority(this: CollectionCoordinatorRuntime,
  submitted: StoreContextEnvelope): StoreContextEnvelope {
    const captured = this.dependencies.authority.assertActiveStoreContext(submitted);
    const authoritative = this.dependencies.authority.getActiveStoreContext();
    if (
      !authoritative
      || missionControlContextKey(authoritative) !== missionControlContextKey(captured)
    ) {
      throw new Error('LINGXING_COLLECTION_STORE_CONTEXT_CHANGED');
    }
    return Object.freeze({ ...authoritative });
  }

export function buildProgressSink(this: CollectionCoordinatorRuntime,
  request: LingxingCollectionRequestDto,
  input: StartLingxingCollectionInput): LingxingCollectionProgressSink {
    return async (event) => {
      const durableEvent = {
        ...event,
        job: attachCollectionJobLineage(event.job, request, input),
      };
      assertProgressBelongsToRequest(durableEvent, request);
      if (this.isCancellationRequested(
        durableEvent.job.jobId,
        request,
        durableEvent.job.request.storeContext,
      )) return;
      // 进度落盘是安全边界，写入失败必须在下次外部操作前拒绝。
      await this.dependencies.persistence.persistProgress(durableEvent);
      if (this.isCancellationRequested(
        durableEvent.job.jobId,
        request,
        durableEvent.job.request.storeContext,
      )) return;
      if (!this.dependencies.publishProgress) return;
      publishCollectionProgressAfterPersistence({ phase: 'progress', event: durableEvent,
        assertCurrent: () => this.dependencies.authority.assertActiveStoreContext(durableEvent.job.request.storeContext),
        publish: () => this.dependencies.publishProgress!(durableEvent),
      });
    };
  }

export function buildAuthorityGuard(this: CollectionCoordinatorRuntime,
  operation: CollectionOperation,
  context: StoreContextEnvelope,
  runtime: LingxingCollectionRuntime): LingxingCollectionAuthorityGuard {
    return () => {
      try {
        operation.renew(COLLECTION_LEASE_TTL_MS);
        this.dependencies.assertRuntimeCurrent?.(context, runtime);
        return { allowed: true };
      } catch (error) {
        return {
          allowed: false,
          blockerCode: 'LINGXING_COLLECTION_AUTHORITY_STALE',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    };
  }

export function publishTerminalProgress(this: CollectionCoordinatorRuntime,
  result: RunBatchResult): void {
    if (!this.dependencies.publishProgress) return;
    const event = { eventId: `${result.job.jobId}:terminal:${result.job.importState || 'legacy'}`,
      emittedAt: result.job.updatedAt, job: result.job };
    publishCollectionProgressAfterPersistence({ phase: 'terminal', event,
      assertCurrent: () => this.dependencies.authority.assertActiveStoreContext(result.job.request.storeContext),
      publish: () => this.dependencies.publishProgress!(event),
    });
  }
