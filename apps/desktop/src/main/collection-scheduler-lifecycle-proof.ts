import {
  type LingxingCollectionJobSnapshot,
} from '@amazon-ai-ops/shared-types';
import {
  type LingxingCollectionAuthorityProof,
} from '@amazon-ai-ops/local-db';
import {
  FULL_REPORT_TYPES,
} from "./collection-scheduler-constants";
import {
  type StoreCollectionDurableProofScope,
  type DurableLifecycleShape,
} from "./collection-scheduler-contracts";
import {
  noCompletedImportProof,
  batchIdentityExact,
  uniqueReportSubset,
} from "./collection-scheduler-import-proof";
import {
  isIsoInstant,
  optionalIsoInstant,
  requiredNonBlank,
  sameFullReportSet,
} from "./collection-scheduler-values";

export function durableLifecycleShape(
  proof: LingxingCollectionAuthorityProof,
  authorized: StoreCollectionDurableProofScope,
): DurableLifecycleShape | null {
  const { job, batch } = proof;
  if (!isIsoInstant(job.createdAt) || !isIsoInstant(job.updatedAt)) return null;
  if (job.state === 'queued') {
    return job.completedAt === undefined
      && allImportLifecycleFieldsEmpty(job)
      && noCompletedImportProof(proof)
      && (!batch || batchIdentityExact(batch, job, authorized, 'pending'))
      ? 'queued'
      : null;
  }
  if (job.state === 'running') {
    return job.completedAt === undefined
      && allImportLifecycleFieldsEmpty(job)
      && noCompletedImportProof(proof)
      && (!batch || batchIdentityExact(batch, job, authorized, 'running'))
      ? 'running'
      : null;
  }
  if (job.state === 'completed') {
    if (!isIsoInstant(job.completedAt)
      || !batch
      || !batchIdentityExact(batch, job, authorized, 'completed')) {
      return null;
    }
    if (job.importState === 'pending') {
      return optionalIsoInstant(job.importAttemptedAt)
        && job.importCompletedAt === undefined
        && job.importError === undefined
        ? 'completed_pending'
        : null;
    }
    if (job.importState === 'failed') {
      return isIsoInstant(job.importAttemptedAt)
        && isIsoInstant(job.importCompletedAt)
        && requiredNonBlank(job.importError)
        ? 'completed_failed'
        : null;
    }
    if (job.importState === 'succeeded') {
      return isIsoInstant(job.importAttemptedAt)
        && isIsoInstant(job.importCompletedAt)
        && job.importError === undefined
        ? 'completed_succeeded'
        : null;
    }
    return null;
  }
  if (job.state === 'cancelled'
    && job.blockerCode === 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART'
    && requiredNonBlank(job.detail)
    && batch === undefined) {
    return isIsoInstant(job.completedAt)
      && job.importState === 'not_applicable'
      && job.importAttemptedAt === undefined
      && job.importCompletedAt === undefined
      && job.importError === undefined
      && noCompletedImportProof(proof)
      ? 'restart_cancelled_before_batch'
      : null;
  }
  if (job.state === 'completed_with_errors'
    || job.state === 'failed'
    || job.state === 'cancelled'
    || job.state === 'stale_authority') {
    const expectedBatchStatus = job.state === 'completed_with_errors'
      ? 'completed_with_errors'
      : 'failed';
    return isIsoInstant(job.completedAt)
      && job.importState === 'not_applicable'
      && job.importAttemptedAt === undefined
      && job.importCompletedAt === undefined
      && job.importError === undefined
      && Boolean(batch)
      && batchIdentityExact(batch!, job, authorized, expectedBatchStatus)
      && noCompletedImportProof(proof)
      ? 'terminal_not_applicable'
      : null;
  }
  return null;
}

export function allImportLifecycleFieldsEmpty(job: LingxingCollectionJobSnapshot): boolean {
  return job.importState === undefined
    && job.importAttemptedAt === undefined
    && job.importCompletedAt === undefined
    && job.importError === undefined;
}

export function queuedProofReasonable(
  proof: LingxingCollectionAuthorityProof,
  _authorized: StoreCollectionDurableProofScope,
): boolean {
  return proof.lingxingFileCount === 0
    && proof.lingxingFiles.length === 0
    && proof.checkpointCount === proof.job.reports.length
    && proof.job.reports.every((checkpoint) => checkpoint.state === 'queued');
}

export function runningProofReasonable(
  proof: LingxingCollectionAuthorityProof,
  authorized: StoreCollectionDurableProofScope,
): boolean {
  return proof.lingxingFileCount === proof.lingxingFiles.length
    && uniqueReportSubset(proof.lingxingFiles.map((file) => file.reportType))
    && proof.lingxingFiles.every((file) => (
      file.storeId === authorized.context.storeId
      && file.batchId === proof.job.jobId
      && typeof file.id === 'string'
      && file.id.length > 0
    ));
}

export function terminalFailureProofExact(
  proof: LingxingCollectionAuthorityProof,
  authorized: StoreCollectionDurableProofScope,
): boolean {
  return proof.lingxingFileCount === proof.lingxingFiles.length
    && uniqueReportSubset(proof.lingxingFiles.map((file) => file.reportType))
    && proof.lingxingFiles.every((file) => (
      file.storeId === authorized.context.storeId
      && file.batchId === proof.job.jobId
    ));
}

export function restartCancelledBeforeBatchProofExact(
  proof: LingxingCollectionAuthorityProof,
): boolean {
  const completedAt = proof.job.completedAt;
  return proof.batch === undefined
    && proof.checkpointCount === FULL_REPORT_TYPES.length
    && proof.job.reports.length === FULL_REPORT_TYPES.length
    && sameFullReportSet(proof.job.reports.map((checkpoint) => checkpoint.reportType))
    && proof.job.reports.every((checkpoint) => (
      checkpoint.state === 'cancelled'
      && checkpoint.errorCode === 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART'
      && requiredNonBlank(checkpoint.detail)
      && checkpoint.updatedAt === completedAt
      && checkpoint.createdReportIdentity === undefined
      && checkpoint.fileSizeBytes === undefined
    ))
    && proof.lingxingFileCount === 0
    && proof.lingxingFiles.length === 0;
}
