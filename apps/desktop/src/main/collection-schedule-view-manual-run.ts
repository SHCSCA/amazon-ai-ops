import type {
  StoreCollectionScheduleRunResult,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  inspectManualCycle,
  assertPostRunAuthority,
  assertManualRunScopeUnchanged,
  isPreSchedulerIdentityFailure,
} from "./collection-schedule-view-manual-proof";
import {
  rendererSafeJob,
} from "./collection-schedule-view-values";

import type { CollectionScheduleViewRuntime } from './collection-schedule-view-runtime';

export async function runNow(this: CollectionScheduleViewRuntime,
  contextInput: StoreContextEnvelope): Promise<StoreCollectionScheduleRunResult> {
    const beforeReadback = this.readAuthorized(contextInput);
    const requested = beforeReadback.context;
    const beforeRun = beforeReadback.projection;
    if (beforeRun.state === 'failed' && beforeReadback.durable) {
      return this.resumeJob(requested, beforeReadback.durable.job.jobId);
    }
    const cycle = inspectManualCycle(await this.options.manualRun(requested), requested);
    const currentInput = this.options.authority.getActiveStoreContext();
    if (!currentInput) {
      throw new Error('Main active authority changed during manual run');
    }
    const current = this.options.authority.assertActiveStoreContext(currentInput);
    assertPostRunAuthority(requested, current);
    const readback = this.readAuthorized(current);
    assertManualRunScopeUnchanged(beforeRun, readback.projection);

    if (cycle.disposition === 'skipped') {
      if (!readback.durable && !readback.protectedAttempt) {
        throw new Error('manual duplicate has no exact durable or protected proof');
      }
      if (!['claimed', 'succeeded', 'failed'].includes(readback.projection.state)) {
        throw new Error('manual duplicate proof did not project an idempotent attempt state');
      }
      return {
        accepted: false,
        duplicate: true,
        projection: readback.projection,
        ...(readback.durable ? { job: rendererSafeJob(readback.durable.job) } : {}),
      };
    }

    const outcome = cycle.outcome;
    if (outcome.fingerprint !== readback.projection.fingerprint) {
      throw new Error('manual cycle outcome fingerprint does not match the refreshed projection');
    }
    const exactRequestId = readback.durable?.jobRow.requestId
      ?? readback.protectedAttempt?.semanticAttempt.schedulerRequestId;
    if (exactRequestId && outcome.requestId !== exactRequestId) {
      throw new Error('manual cycle outcome requestId does not match durable/protected authority');
    }
    if (!readback.durable && !readback.protectedAttempt) {
      if (!['due', 'waiting'].includes(readback.projection.state)
        || outcome.state !== 'blocked'
        || !isPreSchedulerIdentityFailure(outcome.failureCode)
        || outcome.requestId !== undefined) {
        throw new Error('record-free manual attempt lacks exact pre-scheduler identity block proof');
      }
    } else if (outcome.state === 'succeeded' && readback.projection.state === 'failed') {
      throw new Error('manual cycle success conflicts with the refreshed authority projection');
    } else if (outcome.state !== 'succeeded' && readback.projection.state === 'succeeded') {
      throw new Error('manual cycle failure conflicts with the refreshed authority projection');
    }
    return {
      accepted: true,
      duplicate: false,
      projection: readback.projection,
      ...(readback.durable ? { job: rendererSafeJob(readback.durable.job) } : {}),
    };
  }
