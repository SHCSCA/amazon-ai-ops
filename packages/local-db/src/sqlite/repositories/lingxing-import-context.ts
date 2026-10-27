import type { Database } from 'better-sqlite3';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type CollectionImportRecoveryCasToken, type CompleteRecoveredCollectionImportInput, type CancelCollectionJobOptions, type RecoverInterruptedCollectionJobsOptions, type LingxingCollectionAuthorityProof, type LingxingCollectionSemanticScope, type LingxingCollectionAuthorityJobRow, type ListRecoverableCollectionImportsOptions, type CollectionImportRecoveryPage, type CollectionInPlaceResumeState, type AcquireCollectionResumeClaimInput, type CollectionResumeClaim, type CommitCollectionResumeProgressInput, type CommitCollectionResumeRunnerResultInput, type CommitCollectionResumeRunnerResultOutput, type AdvanceCollectionResumeClaimAfterImportInput, type FinalizeCollectionResumeAttemptInput, type CollectionResumeAttemptReceipt, type InterruptCollectionResumeClaimInput, type LingxingCollectionSnapshotInput, type StoreScopedLingxingReportBatch, type StoreScopedLingxingReportFile, type CommitCollectionTerminalInput, type CollectionTerminalCommitResult, type CommitReportImportInput, type ReportImportCommitResult, type ReportImportRunRecord, type ReportImportFileSnapshotRecord, type StoreScopedImportedReportFile, type StoreScopedImportedAdMetric, type ReportImportReconciliationRecord, type ActiveCollectionResumeClaimRow, type StoreAuthority, type ReportImportFileInput } from './lingxing-import-contracts';

export interface LingxingImportRepositoryMethods {
upsertCollectionProgressForStore(storeId: StoreId, event: LingxingCollectionProgressEvent): LingxingCollectionJobSnapshot;
upsertCollectionJobSnapshotForStore(storeId: StoreId, snapshot: LingxingCollectionJobSnapshot, event?: {
    eventId: string;
    emittedAt: string;
}): LingxingCollectionJobSnapshot;
completeRecoveredCollectionImportForStore(token: CollectionImportRecoveryCasToken, input: CompleteRecoveredCollectionImportInput): LingxingCollectionJobSnapshot;
cancelCollectionJobForStore(storeId: StoreId, jobId: string, options: CancelCollectionJobOptions): LingxingCollectionJobSnapshot;
recoverInterruptedCollectionJobsForStore(storeId: StoreId, options?: RecoverInterruptedCollectionJobsOptions): LingxingCollectionJobSnapshot[];
getCollectionJobForStore(storeId: StoreId, jobId: string): LingxingCollectionJobSnapshot | undefined;
listCollectionJobsForStore(storeId: StoreId, limit?: number): LingxingCollectionJobSnapshot[];
readUniqueCollectionAuthorityProofForStoreByRequestId(storeId: StoreId, requestId: string): LingxingCollectionAuthorityProof | undefined;
inspectUniqueCollectionJobForSemanticScope(input: LingxingCollectionSemanticScope): LingxingCollectionAuthorityProof | undefined;
readCollectionAuthorityProofForSelectedRow(storeId: StoreId, exactRequestId: string, row: LingxingCollectionAuthorityJobRow): LingxingCollectionAuthorityProof;
findUniqueCollectionJobForStoreByRequestId(storeId: StoreId, requestId: string): LingxingCollectionJobSnapshot | undefined;
listRecoverableCollectionImportsForStore(storeId: StoreId, options?: ListRecoverableCollectionImportsOptions): CollectionImportRecoveryPage;
getCollectionResumeStateForStore(storeId: StoreId, jobId: string): LingxingCollectionResumeState | undefined;
getCollectionInPlaceResumeStateForStore(storeId: StoreId, jobId: string): CollectionInPlaceResumeState | undefined;
acquireCollectionResumeClaimForStore(storeId: StoreId, input: AcquireCollectionResumeClaimInput): CollectionResumeClaim;
commitCollectionResumeProgressForStore(storeId: StoreId, input: CommitCollectionResumeProgressInput): CollectionResumeClaim;
commitCollectionResumeRunnerResultForStore(storeId: StoreId, input: CommitCollectionResumeRunnerResultInput): CommitCollectionResumeRunnerResultOutput;
advanceCollectionResumeClaimAfterImportForStore(storeId: StoreId, input: AdvanceCollectionResumeClaimAfterImportInput): CollectionResumeClaim;
finalizeCollectionResumeAttemptForStore(storeId: StoreId, input: FinalizeCollectionResumeAttemptInput): CollectionResumeAttemptReceipt;
interruptCollectionResumeClaimForStore(storeId: StoreId, input: InterruptCollectionResumeClaimInput): CollectionResumeAttemptReceipt;
interruptOrphanedCollectionResumeClaimsForStartup(interruptedAt?: string): CollectionResumeAttemptReceipt[];
readLatestCollectionResumeAttemptReceiptForStore(storeId: StoreId, jobId: string, requestId: string): CollectionResumeAttemptReceipt | undefined;
readUniqueSucceededCollectionResumeReceiptForStore(storeId: StoreId, jobId: string, requestId: string): CollectionResumeAttemptReceipt | undefined;
findLatestCollectionResumeStateForStore(storeId: StoreId, requestId: string): LingxingCollectionResumeState | undefined;
saveCollectionSnapshotForStore(storeId: StoreId, input: LingxingCollectionSnapshotInput): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
};
commitCollectionTerminalForStore(storeId: StoreId, input: CommitCollectionTerminalInput): CollectionTerminalCommitResult;
getCollectionSnapshotForStore(storeId: StoreId, batchId: string): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
} | undefined;
listBatchesForStore(storeId: StoreId, limit?: number): StoreScopedLingxingReportBatch[];
commitImportForStore(storeId: StoreId, input: CommitReportImportInput): ReportImportCommitResult;
getImportRunForStore(storeId: StoreId, runId: string): ReportImportRunRecord | undefined;
listImportRunsForStore(storeId: StoreId, limit?: number): ReportImportRunRecord[];
listFileSnapshotsForStore(storeId: StoreId, runId: string): ReportImportFileSnapshotRecord[];
listReportFilesForStore(storeId: StoreId, batchId: string): StoreScopedImportedReportFile[];
listAdMetricsForStore(storeId: StoreId, batchId: string): StoreScopedImportedAdMetric[];
listReconciliationsForStore(storeId: StoreId, runId: string): ReportImportReconciliationRecord[];
readActiveResumeClaimByAttempt(storeId: StoreId, attemptId: string): ActiveCollectionResumeClaimRow | undefined;
assertActiveResumeClaim(storeId: StoreId, claim: CollectionResumeClaim): ActiveCollectionResumeClaimRow;
assertResumeClaimAuthorityCurrent(storeId: StoreId, active: ActiveCollectionResumeClaimRow): LingxingCollectionAuthorityProof;
appendResumeTerminalEvent(active: ActiveCollectionResumeClaimRow, outcome: 'succeeded' | 'failed' | 'interrupted', finalJobUpdatedAt: string, finalAuthorityProofSha256: string, completedAt: string, detail?: string): void;
rotateActiveResumeClaim(active: ActiveCollectionResumeClaimRow, finalJobUpdatedAt: string, finalAuthorityProofSha256: string, createdAt: string, detail: string): CollectionResumeClaim;
consumeActiveResumeClaim(active: ActiveCollectionResumeClaimRow): void;
readResumeReceiptRows(storeId: StoreId, jobId: string, requestId: string, limit: number, outcome?: 'succeeded'): CollectionResumeAttemptReceipt[];
requireResumeReceipt(storeId: StoreId, attemptId: string): CollectionResumeAttemptReceipt;
appendRecoveredSucceededResumeReceiptIfNeeded(storeId: StoreId, proof: LingxingCollectionAuthorityProof, completedAt: string, predecessorJobUpdatedAt: string): void;
persistCollectionJobSnapshotRows(storeId: StoreId, snapshot: LingxingCollectionJobSnapshot, event?: {
    eventId: string;
    emittedAt: string;
}): LingxingCollectionJobSnapshot;
persistCollectionSnapshotRows(storeId: StoreId, authority: StoreAuthority, input: LingxingCollectionSnapshotInput): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
};
getWritableStoreAuthority(storeId: StoreId): StoreAuthority;
getStoreAuthority(storeId: StoreId): StoreAuthority;
upsertCollectionCheckpoint(storeId: StoreId, jobId: string, checkpoint: LingxingCollectionReportCheckpoint): void;
assertBatchInput(storeId: StoreId, authority: StoreAuthority, batch: LingxingReportBatch): void;
upsertBatchRow(storeId: StoreId, batch: LingxingReportBatch): void;
upsertLingxingFileRow(storeId: StoreId, file: LingxingReportFile): void;
upsertReportFileRow(storeId: StoreId, batchId: string, file: ReportImportFileInput, importedAt: string): number;
insertMetricRow(storeId: StoreId, authority: StoreAuthority, batchId: string, batchStoreName: string | null, metric: AdDailyMetrics): void;
assertBatchOwnership(storeId: StoreId, batchId: string): {
    dateStart: string;
    dateEnd: string;
    storeName: string | null;
};
findExistingRun(storeId: StoreId, runId: string, idempotencyKey: string): ReportImportRunRecord | undefined;
resolveDuplicate(existing: ReportImportRunRecord, input: CommitReportImportInput, fingerprint: string): ReportImportCommitResult;
}
export interface LingxingImportRepositoryContext {
 readonly db: Database;
 readonly methods: LingxingImportRepositoryMethods;
}
