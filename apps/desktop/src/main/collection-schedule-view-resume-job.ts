import {
  isDeepStrictEqual,
} from 'node:util';
import {
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreCollectionScheduleRunResult,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  assertPostRunAuthority,
} from "./collection-schedule-view-manual-proof";
import {
  selectedJobId,
  classifySelectedDurableReadback,
  selectedJobProjection,
  exactResumeRequest,
  snapshotResumeReceipt,
  assertSelectedResumeScopeUnchanged,
  assertExactResumeAttemptReceipt,
} from "./collection-schedule-view-resume-proof";
import {
  assertUsContext,
} from "./collection-schedule-view-identity-proof";
import {
  rendererSafeJob,
} from "./collection-schedule-view-values";
import type { CollectionScheduleViewRuntime } from './collection-schedule-view-runtime';

export async function resumeJob(this: CollectionScheduleViewRuntime,
  contextInput: StoreContextEnvelope,
  jobIdInput: string,
  options: { deferReconciledCreateFailures?: boolean } = {}): Promise<StoreCollectionScheduleRunResult> {
    const requested = this.options.authority.assertActiveStoreContext(contextInput);
    assertUsContext(requested);
    const jobId = selectedJobId(jobIdInput);
    const selected = this.options.importRepository.getCollectionJobForStore(
      requested.storeId,
      jobId,
    );
    if (!selected || selected.jobId !== jobId) throw new Error('selected collection job does not exist');
    const selectedContext = normalizeStoreContextEnvelope(selected.request.storeContext);
    if (selectedContext.storeId !== requested.storeId
      || selectedContext.browserProfileId !== requested.browserProfileId
      || selectedContext.businessDate !== requested.businessDate
      || selectedContext.sessionGeneration > requested.sessionGeneration) {
      throw new Error('selected collection job does not belong to the active Store authority');
    }
    const durable = this.options.importRepository
      .readUniqueCollectionAuthorityProofForStoreByRequestId(
        requested.storeId,
        selected.request.requestId,
      );
    if (!durable
      || durable.job.jobId !== jobId
      || !isDeepStrictEqual(durable.job, selected)) {
      throw new Error('selected failed job changed before its exact authority readback');
    }
    const before = classifySelectedDurableReadback(
      requested,
      durable,
      this.options.orchestrator,
      this.options.importRepository,
    );
    if (before.state === 'claimed' || before.state === 'succeeded') {
      return {
        accepted: false,
        duplicate: true,
        projection: selectedJobProjection(requested, before),
        job: rendererSafeJob(durable.job),
      };
    }
    const resumeState = this.options.importRepository.getCollectionInPlaceResumeStateForStore(
      requested.storeId,
      jobId,
    );
    if (!resumeState) {
      throw new Error('selected failed job has no exact resumable authority proof');
    }
    const request = {
      ...exactResumeRequest(requested, durable, resumeState),
      ...(options.deferReconciledCreateFailures === true
        ? { deferReconciledCreateFailures: true }
        : {}),
    };
    const previousReceipt = snapshotResumeReceipt(
      this.options.importRepository.readLatestCollectionResumeAttemptReceiptForStore(
        requested.storeId,
        request.jobId,
        request.requestId,
      ),
    );
    await this.options.resumeExisting(request);

    const currentInput = this.options.authority.getActiveStoreContext();
    if (!currentInput) throw new Error('Main active authority changed during same-job resume');
    const current = this.options.authority.assertActiveStoreContext(currentInput);
    assertPostRunAuthority(requested, current);
    const refreshed = this.options.importRepository
      .readUniqueCollectionAuthorityProofForStoreByRequestId(
        requested.storeId,
        request.requestId,
      );
    if (!refreshed
      || refreshed.job.jobId !== request.jobId
      || refreshed.job.request.requestId !== request.requestId) {
      throw new Error('same-job resume did not preserve the exact durable job/request identity');
    }
    const after = classifySelectedDurableReadback(
      current,
      refreshed,
      this.options.orchestrator,
      this.options.importRepository,
    );
    assertSelectedResumeScopeUnchanged(before, after);
    if (after.state !== 'failed' && after.state !== 'succeeded') {
      throw new Error('same-job resume did not settle as failed or succeeded');
    }
    const receipt = this.options.importRepository
      .readLatestCollectionResumeAttemptReceiptForStore(
        requested.storeId,
        durable.job.jobId,
        durable.job.request.requestId,
      );
    assertExactResumeAttemptReceipt({
      receipt,
      request,
      before: durable,
      after: refreshed,
      current,
      expectedOutcome: after.state,
      previousReceipt,
    });
    return {
      accepted: true,
      duplicate: false,
      projection: selectedJobProjection(current, after),
      job: rendererSafeJob(refreshed.job),
    };
  }
