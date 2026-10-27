import {
  isDeepStrictEqual,
} from 'node:util';
import {
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreCollectionScheduleProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  fingerprintCollectionResumeExecutionContext,
  fingerprintLingxingCollectionAuthorityProof,
  type CollectionInPlaceResumeState,
  type CollectionResumeAttemptReceipt,
  type LingxingCollectionAuthorityProof,
} from '@amazon-ai-ops/local-db';
import type {
  StoreCollectionExistingResumeRequest,
} from './store-collection-main-runtime';
import {
  classifyStoreCollectionDurableProof,
} from './store-collection-orchestrator-scheduler-adapter';
import {
  type StoreCollectionSchedulerReadModelOptions,
  type SelectedDurableReadback,
} from "./collection-schedule-view-contracts";
import {
  assertDurableIdentity,
  assertProtectedIdentity,
} from "./collection-schedule-view-identity-proof";
import {
  deriveWindow,
  semanticFingerprint,
  detailForState,
} from "./collection-schedule-view-values";

export function selectedJobId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new TypeError('selected resume jobId must use 1-160 safe identity characters');
  }
  return value;
}

export function classifySelectedDurableReadback(
  current: StoreContextEnvelope,
  proof: LingxingCollectionAuthorityProof,
  orchestrator: StoreCollectionSchedulerReadModelOptions['orchestrator'],
  repository: StoreCollectionSchedulerReadModelOptions['importRepository'],
): SelectedDurableReadback {
  const window = {
    dateStart: proof.job.request.dateStart,
    dateEnd: proof.job.request.dateEnd,
  };
  const lookbackDays = inclusiveWindowDays(window.dateStart, window.dateEnd);
  const expectedWindow = deriveWindow(current.businessDate, lookbackDays);
  if (expectedWindow.dateStart !== window.dateStart || expectedWindow.dateEnd !== window.dateEnd) {
    throw new Error('selected resume job window does not belong to its active business date');
  }
  const durableContext = assertDurableIdentity(current, window, proof);
  const state = classifyStoreCollectionDurableProof(proof, {
    context: durableContext,
    requestId: proof.job.request.requestId,
    ...window,
  });
  const fingerprint = semanticFingerprint({
    context: durableContext,
    lookbackDays,
    ...window,
  });
  const protectedAttempt = orchestrator.readProtectedSemanticAttempt({
    storeId: current.storeId,
    browserProfileId: current.browserProfileId,
    expectedFingerprint: fingerprint,
  });
  if (protectedAttempt) {
    const succeededResumeReceipt = state === 'succeeded'
      && (protectedAttempt.terminalOutcome?.state === 'failed'
        || protectedAttempt.terminalOutcome?.state === 'blocked')
      ? repository.readUniqueSucceededCollectionResumeReceiptForStore(
          current.storeId,
          proof.job.jobId,
          proof.job.request.requestId,
        )
      : undefined;
    assertProtectedIdentity(
      current,
      fingerprint,
      protectedAttempt,
      proof,
      state,
      succeededResumeReceipt,
    );
  }
  return {
    state,
    storeId: current.storeId,
    browserProfileId: current.browserProfileId,
    businessDate: current.businessDate,
    jobId: proof.job.jobId,
    requestId: proof.job.request.requestId,
    ...window,
    fingerprint,
  };
}

export function inclusiveWindowDays(dateStart: string, dateEnd: string): number {
  const start = Date.parse(`${dateStart}T00:00:00.000Z`);
  const end = Date.parse(`${dateEnd}T00:00:00.000Z`);
  const value = (end - start) / 86_400_000 + 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > 90) {
    throw new Error('selected resume job lookback is outside 1..90 days');
  }
  return value;
}

export function assertSelectedResumeScopeUnchanged(
  before: SelectedDurableReadback,
  after: SelectedDurableReadback,
): void {
  if (before.storeId !== after.storeId
    || before.browserProfileId !== after.browserProfileId
    || before.businessDate !== after.businessDate
    || before.jobId !== after.jobId
    || before.requestId !== after.requestId
    || before.dateStart !== after.dateStart
    || before.dateEnd !== after.dateEnd
    || before.fingerprint !== after.fingerprint) {
    throw new Error('selected same-job resume scope changed before exact result readback');
  }
}

export function selectedJobProjection(
  current: StoreContextEnvelope,
  readback: SelectedDurableReadback,
): StoreCollectionScheduleProjection {
  return {
    storeId: current.storeId,
    businessDate: current.businessDate,
    enabled: true,
    state: readback.state,
    detail: detailForState(readback.state),
    dateStart: readback.dateStart,
    dateEnd: readback.dateEnd,
    fingerprint: readback.fingerprint,
  };
}

export function exactResumeRequest(
  current: StoreContextEnvelope,
  proof: LingxingCollectionAuthorityProof,
  resume: CollectionInPlaceResumeState,
): StoreCollectionExistingResumeRequest {
  const durableContext = normalizeStoreContextEnvelope(proof.job.request.storeContext);
  const expectedDigest = fingerprintLingxingCollectionAuthorityProof(proof);
  if ((proof.job.state !== 'failed' && proof.job.state !== 'completed_with_errors')
    || !proof.batch
    || resume.jobId !== proof.job.jobId
    || resume.job.jobId !== proof.job.jobId
    || resume.request.requestId !== proof.job.request.requestId
    || resume.expectedJobUpdatedAt !== proof.job.updatedAt
    || resume.authorityProofSha256 !== expectedDigest
    || !isDeepStrictEqual(resume.job, proof.job)
    || !isDeepStrictEqual(resume.request, proof.job.request)
    || !isDeepStrictEqual(resume.batch, proof.batch)
    || !isDeepStrictEqual(resume.files, proof.lingxingFiles)
    || durableContext.storeId !== current.storeId
    || durableContext.browserProfileId !== current.browserProfileId
    || durableContext.businessDate !== current.businessDate
    || durableContext.sessionGeneration > current.sessionGeneration) {
    throw new Error('same-job resumable authority proof changed during exact double readback');
  }
  return Object.freeze({
    context: Object.freeze({ ...current }),
    jobId: proof.job.jobId,
    requestId: proof.job.request.requestId,
    dateStart: proof.job.request.dateStart,
    dateEnd: proof.job.request.dateEnd,
    expectedJobUpdatedAt: proof.job.updatedAt,
    expectedAuthorityProofSha256: expectedDigest,
  });
}

export function assertExactResumeAttemptReceipt(input: {
  receipt: CollectionResumeAttemptReceipt | undefined;
  request: StoreCollectionExistingResumeRequest;
  before: LingxingCollectionAuthorityProof;
  after: LingxingCollectionAuthorityProof;
  current: StoreContextEnvelope;
  expectedOutcome: 'succeeded' | 'failed';
  previousReceipt: CollectionResumeAttemptReceipt | undefined;
}): void {
  const receipt = input.receipt;
  const durableContext = normalizeStoreContextEnvelope(input.before.job.request.storeContext);
  const beforeDigest = fingerprintLingxingCollectionAuthorityProof(input.before);
  const afterDigest = fingerprintLingxingCollectionAuthorityProof(input.after);
  if (!receipt
    || (input.previousReceipt && isDeepStrictEqual(input.previousReceipt, receipt))
    || receipt.storeId !== input.request.context.storeId
    || receipt.jobId !== input.request.jobId
    || receipt.requestId !== input.request.requestId
    || receipt.outcome !== input.expectedOutcome
    || receipt.baseJobUpdatedAt !== input.request.expectedJobUpdatedAt
    || receipt.baseJobUpdatedAt !== input.before.job.updatedAt
    || receipt.finalJobUpdatedAt !== input.after.job.updatedAt
    || receipt.baseAuthorityProofSha256 !== input.request.expectedAuthorityProofSha256
    || receipt.baseAuthorityProofSha256 !== beforeDigest
    || receipt.finalAuthorityProofSha256 !== afterDigest
    || receipt.durableSessionGeneration !== durableContext.sessionGeneration
    || receipt.executionSessionGeneration !== input.request.context.sessionGeneration
    || receipt.executionSessionGeneration > input.current.sessionGeneration
    || receipt.executionSessionGeneration < receipt.durableSessionGeneration
    || typeof receipt.attemptId !== 'string'
    || !/^[A-Za-z0-9._:-]{1,160}$/.test(receipt.attemptId)
    || !/^[a-f0-9]{64}$/.test(receipt.executionContextSha256)
    || receipt.executionContextSha256
      !== fingerprintCollectionResumeExecutionContext(input.request.context)
    || !orderedCanonicalInstants(
      receipt.baseJobUpdatedAt,
      receipt.claimedAt,
      receipt.finalJobUpdatedAt,
      receipt.completedAt,
    )) {
    throw new Error('same-job resume lacks one exact new append-only terminal attempt receipt');
  }
}

export function snapshotResumeReceipt(
  value: CollectionResumeAttemptReceipt | undefined,
): CollectionResumeAttemptReceipt | undefined {
  return value ? Object.freeze({ ...value }) : undefined;
}

export function orderedCanonicalInstants(...values: readonly string[]): boolean {
  if (values.some((value) => (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ))) return false;
  return values.every((value, index) => index === 0
    || Date.parse(values[index - 1]!) <= Date.parse(value));
}

export function exactSucceededResumeReceipt(
  current: StoreContextEnvelope,
  durable: LingxingCollectionAuthorityProof,
  receipt: CollectionResumeAttemptReceipt | undefined,
): boolean {
  if (!receipt) return false;
  const durableContext = normalizeStoreContextEnvelope(durable.job.request.storeContext);
  const executionContext = Object.freeze({
    ...current,
    sessionGeneration: receipt.executionSessionGeneration,
  });
  return receipt.storeId === durable.jobRow.storeId
    && receipt.jobId === durable.job.jobId
    && receipt.requestId === durable.job.request.requestId
    && receipt.outcome === 'succeeded'
    && receipt.finalJobUpdatedAt === durable.job.updatedAt
    && receipt.finalAuthorityProofSha256
      === fingerprintLingxingCollectionAuthorityProof(durable)
    && receipt.durableSessionGeneration === durableContext.sessionGeneration
    && receipt.executionSessionGeneration >= receipt.durableSessionGeneration
    && receipt.executionSessionGeneration <= current.sessionGeneration
    && receipt.executionContextSha256
      === fingerprintCollectionResumeExecutionContext(executionContext)
    && /^[A-Za-z0-9._:-]{1,160}$/.test(receipt.attemptId)
    && /^[a-f0-9]{64}$/.test(receipt.baseAuthorityProofSha256)
    && receipt.baseAuthorityProofSha256 !== receipt.finalAuthorityProofSha256
    && orderedCanonicalInstants(
      receipt.baseJobUpdatedAt,
      receipt.claimedAt,
      receipt.finalJobUpdatedAt,
      receipt.completedAt,
    );
}
