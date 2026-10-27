import {
  isDeepStrictEqual,
} from 'node:util';
import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type LingxingCollectionAuthorityProof,
  type ReportImportRunRecord,
} from '@amazon-ai-ops/local-db';
import { fingerprintLingxingCollectionAuthorityProof } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-fingerprints';
import {
  type StoreCollectionOrchestratorSchedulerProjection,
} from './store-collection-orchestrator';
import {
  SAFE_ID,
} from "./collection-scheduler-constants";
import {
  type StoreCollectionDurableProofScope,
  type StoreCollectionDurableProofClassification,
  StoreCollectionDurableProofUnknownError,
  type StoreCollectionCommittedImportRecoveryExpectation,
  type StoreCollectionCommittedImportRecoveryReceipt,
} from "./collection-scheduler-contracts";
import {
  exactJobIdentityProblem,
  sameCoordinatorAndDurableJob,
  authorityJobRowExact,
} from "./collection-scheduler-job-identity";
import {
  durableLifecycleShape,
  queuedProofReasonable,
  runningProofReasonable,
  terminalFailureProofExact,
  restartCancelledBeforeBatchProofExact,
} from "./collection-scheduler-lifecycle-proof";
import {
  succeededImportProofExact,
  downloadProofExact,
  noCompletedImportProof,
} from "./collection-scheduler-import-proof";
import {
  isIsoInstant,
  requiredNonBlank,
  assertUsStoreContext,
  isIsoDate,
} from "./collection-scheduler-values";

export function classifyStoreCollectionDurableProof(
  proof: LingxingCollectionAuthorityProof,
  input: StoreCollectionDurableProofScope,
): StoreCollectionDurableProofClassification {
  const scope = normalizeDurableProofScope(input);
  const identityProblem = exactJobIdentityProblem(proof.job, scope);
  if (identityProblem) {
    throw new StoreCollectionDurableProofUnknownError(`identity mismatch: ${identityProblem}`);
  }
  const state = classifyDurableProof(proof, scope);
  if (state === 'accepted' || state === 'waiting') return 'claimed';
  if (state === 'succeeded' || state === 'failed') return state;
  throw new StoreCollectionDurableProofUnknownError('lifecycle or authority evidence incomplete');
}

export function assertStoreCollectionCommittedImportProofForRecovery(
  proof: LingxingCollectionAuthorityProof,
  input: StoreCollectionCommittedImportRecoveryExpectation,
): StoreCollectionCommittedImportRecoveryReceipt {
  const scope = normalizeDurableProofScope(input);
  const identityProblem = exactJobIdentityProblem(proof.job, scope);
  if (identityProblem) {
    throw new StoreCollectionDurableProofUnknownError(`identity mismatch: ${identityProblem}`);
  }
  if (!authorityProofTimelineExact(proof)) {
    throw new StoreCollectionDurableProofUnknownError('authority proof timeline incomplete');
  }
  if (!sameCoordinatorAndDurableJob(input.expectedJob, proof.job)
    || !authorityJobRowExact(proof, scope)) {
    throw new StoreCollectionDurableProofUnknownError(
      'expected job or SQL authority row drifted',
    );
  }
  const run = proof.importRunCount === 1 && proof.importRuns.length === 1
    ? proof.importRuns[0]
    : undefined;
  if (!run || !isDeepStrictEqual(run, input.expectedRun)) {
    throw new StoreCollectionDurableProofUnknownError(
      'expected unique completed import run drifted',
    );
  }
  if (!committedImportRecoveryLifecycleExact(proof, run)) {
    throw new StoreCollectionDurableProofUnknownError(
      'job is not an import-recoverable completed lifecycle',
    );
  }
  if (!succeededImportProofExact(proof, scope)) {
    throw new StoreCollectionDurableProofUnknownError(
      'committed full-eight import evidence incomplete',
    );
  }
  const authorityProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
  const context = normalizeStoreContextEnvelope(proof.job.request.storeContext);
  const expectedImportState = proof.job.importState;
  return {
    storeId: context.storeId,
    jobId: proof.job.jobId,
    requestId: proof.job.request.requestId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    dateStart: proof.job.request.dateStart,
    dateEnd: proof.job.request.dateEnd,
    jobUpdatedAt: proof.job.updatedAt,
    runId: run.runId,
    runCompletedAt: run.completedAt,
    authorityProofSha256,
    run: { ...run },
    ...(expectedImportState === 'pending' || expectedImportState === 'failed'
      ? {
          casToken: {
            storeId: context.storeId,
            jobId: proof.job.jobId,
            requestId: proof.job.request.requestId,
            expectedJobUpdatedAt: proof.job.updatedAt,
            expectedImportState,
            expectedRunId: run.runId,
            expectedAuthorityProofSha256: authorityProofSha256,
          },
        }
      : {}),
  };
}

export function committedImportRecoveryLifecycleExact(
  proof: LingxingCollectionAuthorityProof,
  run: ReportImportRunRecord,
): boolean {
  const { job } = proof;
  if (job.state !== 'completed'
    || !isIsoInstant(job.completedAt)
    || !isIsoInstant(job.importAttemptedAt)
    || !orderedIsoInstants(job.completedAt, job.importAttemptedAt)
    || !orderedIsoInstants(job.importAttemptedAt, run.startedAt)
    || !orderedIsoInstants(run.startedAt, run.completedAt)
    || !orderedIsoInstants(run.completedAt, run.createdAt)
    || proof.importFileSnapshots.some((row) => (
      row.runId !== run.runId
      || !orderedIsoInstants(run.startedAt, row.capturedAt)
      || !orderedIsoInstants(row.capturedAt, run.completedAt)
    ))
    || proof.reconciliations.some((row) => (
      row.runId !== run.runId
      || !orderedIsoInstants(run.startedAt, row.reconciledAt)
      || !orderedIsoInstants(row.reconciledAt, run.completedAt)
    ))
    || proof.importedReportFiles.some((row) => (
      !orderedIsoInstants(run.startedAt, row.lastImportedAt)
      || !orderedIsoInstants(row.lastImportedAt, run.completedAt)
    ))) {
    return false;
  }
  if (job.importState === 'pending') {
    return job.importCompletedAt === undefined
      && job.importError === undefined
      && orderedIsoInstants(job.updatedAt, run.startedAt);
  }
  if (job.importState === 'failed' || job.importState === 'succeeded') {
    return isIsoInstant(job.importCompletedAt)
      && orderedIsoInstants(run.completedAt, job.importCompletedAt)
      && orderedIsoInstants(job.importCompletedAt, job.updatedAt)
      && (job.importState === 'failed'
        ? requiredNonBlank(job.importError)
        : job.importError === undefined);
  }
  return false;
}

export function normalizeDurableProofScope(
  input: StoreCollectionDurableProofScope,
): StoreCollectionDurableProofScope {
  let context: StoreContextEnvelope;
  try {
    context = normalizeStoreContextEnvelope(input.context);
    assertUsStoreContext(context);
  } catch {
    throw new StoreCollectionDurableProofUnknownError('exact Store/Profile context invalid');
  }
  if (!SAFE_ID.test(input.requestId)
    || input.requestId.startsWith('canary:')
    || !isIsoDate(input.dateStart)
    || !isIsoDate(input.dateEnd)
    || input.dateStart > input.dateEnd) {
    throw new StoreCollectionDurableProofUnknownError('exact request/date window invalid');
  }
  return {
    context,
    requestId: input.requestId,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  };
}

export function classifyDurableProof(
  proof: LingxingCollectionAuthorityProof,
  authorized: StoreCollectionDurableProofScope,
): StoreCollectionOrchestratorSchedulerProjection['state'] {
  if (!authorityProofTimelineExact(proof)) return 'unknown';
  const shape = durableLifecycleShape(proof, authorized);
  switch (shape) {
    case 'queued':
      return queuedProofReasonable(proof, authorized) ? 'accepted' : 'unknown';
    case 'running':
      return runningProofReasonable(proof, authorized) ? 'waiting' : 'unknown';
    case 'completed_pending':
      return downloadProofExact(proof, authorized) && noCompletedImportProof(proof)
        ? 'waiting'
        : 'unknown';
    case 'completed_failed':
      return downloadProofExact(proof, authorized)
        && noCompletedImportProof(proof)
        ? 'failed'
        : 'unknown';
    case 'completed_succeeded':
      return succeededImportProofExact(proof, authorized)
        ? 'succeeded'
        : 'unknown';
    case 'terminal_not_applicable':
      return terminalFailureProofExact(proof, authorized)
      ? 'failed'
      : 'unknown';
    case 'restart_cancelled_before_batch':
      return restartCancelledBeforeBatchProofExact(proof)
        ? 'failed'
        : 'unknown';
    default:
      return 'unknown';
  }
}

export function authorityProofTimelineExact(proof: LingxingCollectionAuthorityProof): boolean {
  const { job } = proof;
  if (!orderedIsoInstants(job.createdAt, job.updatedAt)) return false;
  if (job.completedAt !== undefined
    && (!orderedIsoInstants(job.createdAt, job.completedAt)
      || !orderedIsoInstants(job.completedAt, job.updatedAt))) {
    return false;
  }
  if (job.importAttemptedAt !== undefined
    && !orderedIsoInstants(job.importAttemptedAt, job.updatedAt)) {
    return false;
  }
  if (job.importCompletedAt !== undefined
    && (!orderedIsoInstants(job.importAttemptedAt, job.importCompletedAt)
      || !orderedIsoInstants(job.importCompletedAt, job.updatedAt))) {
    return false;
  }
  if (job.reports.some((checkpoint) => (
    !orderedIsoInstants(job.createdAt, checkpoint.updatedAt)
    || !orderedIsoInstants(checkpoint.updatedAt, job.updatedAt)
    || (checkpoint.createdReportIdentity !== undefined
      && (!orderedIsoInstants(
        job.createdAt,
        checkpoint.createdReportIdentity.createdAt,
      )
        || !orderedIsoInstants(
          checkpoint.createdReportIdentity.createdAt,
          checkpoint.updatedAt,
        )))
  ))) {
    return false;
  }
  if (proof.batch
    && (!orderedIsoInstants(job.createdAt, proof.batch.createdAt)
      || !orderedIsoInstants(proof.batch.createdAt, job.updatedAt)
      || (proof.batch.completedAt !== undefined
        && (!orderedIsoInstants(proof.batch.createdAt, proof.batch.completedAt)
          || !orderedIsoInstants(proof.batch.completedAt, job.updatedAt))))) {
    return false;
  }
  if (proof.lingxingFiles.some((file) => (
    !orderedIsoInstants(job.createdAt, file.createdAt)
    || !orderedIsoInstants(file.createdAt, file.updatedAt)
    || !orderedIsoInstants(file.updatedAt, job.updatedAt)
    || (proof.batch?.completedAt !== undefined
      && !orderedIsoInstants(file.updatedAt, proof.batch.completedAt))
  ))) {
    return false;
  }
  if (proof.importRuns.some((run) => (
    !orderedIsoInstants(run.startedAt, run.completedAt)
    || !orderedIsoInstants(run.completedAt, run.createdAt)
  ))) {
    return false;
  }
  const runsById = new Map(proof.importRuns.map((run) => [run.runId, run]));
  if (proof.importFileSnapshots.some((snapshot) => {
    const run = runsById.get(snapshot.runId);
    return !run
      || !orderedIsoInstants(run.startedAt, snapshot.capturedAt)
      || !orderedIsoInstants(snapshot.capturedAt, run.completedAt);
  })) {
    return false;
  }
  if (proof.reconciliations.some((reconciliation) => {
    const run = runsById.get(reconciliation.runId);
    return !run
      || !orderedIsoInstants(run.startedAt, reconciliation.reconciledAt)
      || !orderedIsoInstants(reconciliation.reconciledAt, run.completedAt);
  })) {
    return false;
  }
  const uniqueRun = proof.importRunCount === 1 && proof.importRuns.length === 1
    ? proof.importRuns[0]
    : undefined;
  return proof.importedReportFiles.every((file) => (
    file.lastImportedAt === undefined
    || (Boolean(uniqueRun)
      && orderedIsoInstants(uniqueRun!.startedAt, file.lastImportedAt)
      && orderedIsoInstants(file.lastImportedAt, uniqueRun!.completedAt)
      && (job.importCompletedAt === undefined
        || orderedIsoInstants(file.lastImportedAt, job.importCompletedAt)))
  ));
}

export function orderedIsoInstants(earlier: unknown, later: unknown): boolean {
  return isIsoInstant(earlier)
    && isIsoInstant(later)
    && Date.parse(earlier) <= Date.parse(later);
}
