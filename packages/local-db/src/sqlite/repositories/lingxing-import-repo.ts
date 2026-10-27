import type { Database } from 'better-sqlite3';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type CollectionImportRecoveryCasToken, type CompleteRecoveredCollectionImportInput, type CancelCollectionJobOptions, type RecoverInterruptedCollectionJobsOptions, type LingxingCollectionAuthorityProof, type LingxingCollectionSemanticScope, type LingxingCollectionAuthorityJobRow, type ListRecoverableCollectionImportsOptions, type CollectionImportRecoveryPage, type CollectionInPlaceResumeState, type AcquireCollectionResumeClaimInput, type CollectionResumeClaim, type CommitCollectionResumeProgressInput, type CommitCollectionResumeRunnerResultInput, type CommitCollectionResumeRunnerResultOutput, type AdvanceCollectionResumeClaimAfterImportInput, type FinalizeCollectionResumeAttemptInput, type CollectionResumeAttemptReceipt, type InterruptCollectionResumeClaimInput, type LingxingCollectionSnapshotInput, type StoreScopedLingxingReportBatch, type StoreScopedLingxingReportFile, type CommitCollectionTerminalInput, type CollectionTerminalCommitResult, type CommitReportImportInput, type ReportImportCommitResult, type ReportImportRunRecord, type ReportImportFileSnapshotRecord, type StoreScopedImportedReportFile, type StoreScopedImportedAdMetric, type ReportImportReconciliationRecord, type ActiveCollectionResumeClaimRow, type StoreAuthority, type ReportImportFileInput } from './lingxing-import-contracts';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';
import * as operations0 from './lingxing-import-jobs';
import * as operations1 from './lingxing-import-authority';
import * as operations2 from './lingxing-import-resume-state';
import * as operations3 from './lingxing-import-resume-claim';
import * as operations4 from './lingxing-import-resume-progress';
import * as operations5 from './lingxing-import-resume-completion';
import * as operations6 from './lingxing-import-snapshots';
import * as operations7 from './lingxing-import-commit';
import * as operations8 from './lingxing-import-queries';
import * as operations9 from './lingxing-import-rows';

// 所有职责共享同一数据库连接，事务仍由原操作边界控制。
export class LingxingImportRepository {
 private readonly operations: LingxingImportRepositoryContext;
 constructor(private readonly db: Database) {
  this.operations = { db: this.db, methods: {
upsertCollectionProgressForStore: (...args) => this.upsertCollectionProgressForStore(...args),
upsertCollectionJobSnapshotForStore: (...args) => this.upsertCollectionJobSnapshotForStore(...args),
completeRecoveredCollectionImportForStore: (...args) => this.completeRecoveredCollectionImportForStore(...args),
cancelCollectionJobForStore: (...args) => this.cancelCollectionJobForStore(...args),
recoverInterruptedCollectionJobsForStore: (...args) => this.recoverInterruptedCollectionJobsForStore(...args),
getCollectionJobForStore: (...args) => this.getCollectionJobForStore(...args),
listCollectionJobsForStore: (...args) => this.listCollectionJobsForStore(...args),
readUniqueCollectionAuthorityProofForStoreByRequestId: (...args) => this.readUniqueCollectionAuthorityProofForStoreByRequestId(...args),
inspectUniqueCollectionJobForSemanticScope: (...args) => this.inspectUniqueCollectionJobForSemanticScope(...args),
readCollectionAuthorityProofForSelectedRow: (...args) => this.readCollectionAuthorityProofForSelectedRow(...args),
findUniqueCollectionJobForStoreByRequestId: (...args) => this.findUniqueCollectionJobForStoreByRequestId(...args),
listRecoverableCollectionImportsForStore: (...args) => this.listRecoverableCollectionImportsForStore(...args),
getCollectionResumeStateForStore: (...args) => this.getCollectionResumeStateForStore(...args),
getCollectionInPlaceResumeStateForStore: (...args) => this.getCollectionInPlaceResumeStateForStore(...args),
acquireCollectionResumeClaimForStore: (...args) => this.acquireCollectionResumeClaimForStore(...args),
commitCollectionResumeProgressForStore: (...args) => this.commitCollectionResumeProgressForStore(...args),
commitCollectionResumeRunnerResultForStore: (...args) => this.commitCollectionResumeRunnerResultForStore(...args),
advanceCollectionResumeClaimAfterImportForStore: (...args) => this.advanceCollectionResumeClaimAfterImportForStore(...args),
finalizeCollectionResumeAttemptForStore: (...args) => this.finalizeCollectionResumeAttemptForStore(...args),
interruptCollectionResumeClaimForStore: (...args) => this.interruptCollectionResumeClaimForStore(...args),
interruptOrphanedCollectionResumeClaimsForStartup: (...args) => this.interruptOrphanedCollectionResumeClaimsForStartup(...args),
readLatestCollectionResumeAttemptReceiptForStore: (...args) => this.readLatestCollectionResumeAttemptReceiptForStore(...args),
readUniqueSucceededCollectionResumeReceiptForStore: (...args) => this.readUniqueSucceededCollectionResumeReceiptForStore(...args),
findLatestCollectionResumeStateForStore: (...args) => this.findLatestCollectionResumeStateForStore(...args),
saveCollectionSnapshotForStore: (...args) => this.saveCollectionSnapshotForStore(...args),
commitCollectionTerminalForStore: (...args) => this.commitCollectionTerminalForStore(...args),
getCollectionSnapshotForStore: (...args) => this.getCollectionSnapshotForStore(...args),
listBatchesForStore: (...args) => this.listBatchesForStore(...args),
commitImportForStore: (...args) => this.commitImportForStore(...args),
getImportRunForStore: (...args) => this.getImportRunForStore(...args),
listImportRunsForStore: (...args) => this.listImportRunsForStore(...args),
listFileSnapshotsForStore: (...args) => this.listFileSnapshotsForStore(...args),
listReportFilesForStore: (...args) => this.listReportFilesForStore(...args),
listAdMetricsForStore: (...args) => this.listAdMetricsForStore(...args),
listReconciliationsForStore: (...args) => this.listReconciliationsForStore(...args),
readActiveResumeClaimByAttempt: (...args) => this.readActiveResumeClaimByAttempt(...args),
assertActiveResumeClaim: (...args) => this.assertActiveResumeClaim(...args),
assertResumeClaimAuthorityCurrent: (...args) => this.assertResumeClaimAuthorityCurrent(...args),
appendResumeTerminalEvent: (...args) => this.appendResumeTerminalEvent(...args),
rotateActiveResumeClaim: (...args) => this.rotateActiveResumeClaim(...args),
consumeActiveResumeClaim: (...args) => this.consumeActiveResumeClaim(...args),
readResumeReceiptRows: (...args) => this.readResumeReceiptRows(...args),
requireResumeReceipt: (...args) => this.requireResumeReceipt(...args),
appendRecoveredSucceededResumeReceiptIfNeeded: (...args) => this.appendRecoveredSucceededResumeReceiptIfNeeded(...args),
persistCollectionJobSnapshotRows: (...args) => this.persistCollectionJobSnapshotRows(...args),
persistCollectionSnapshotRows: (...args) => this.persistCollectionSnapshotRows(...args),
getWritableStoreAuthority: (...args) => this.getWritableStoreAuthority(...args),
getStoreAuthority: (...args) => this.getStoreAuthority(...args),
upsertCollectionCheckpoint: (...args) => this.upsertCollectionCheckpoint(...args),
assertBatchInput: (...args) => this.assertBatchInput(...args),
upsertBatchRow: (...args) => this.upsertBatchRow(...args),
upsertLingxingFileRow: (...args) => this.upsertLingxingFileRow(...args),
upsertReportFileRow: (...args) => this.upsertReportFileRow(...args),
insertMetricRow: (...args) => this.insertMetricRow(...args),
assertBatchOwnership: (...args) => this.assertBatchOwnership(...args),
findExistingRun: (...args) => this.findExistingRun(...args),
resolveDuplicate: (...args) => this.resolveDuplicate(...args),
} };
}
upsertCollectionProgressForStore(storeId: StoreId, event: LingxingCollectionProgressEvent): LingxingCollectionJobSnapshot {
    return operations0.upsertCollectionProgressForStore(this.operations, storeId, event);
}

upsertCollectionJobSnapshotForStore(storeId: StoreId, snapshot: LingxingCollectionJobSnapshot, event?: {
    eventId: string;
    emittedAt: string;
}): LingxingCollectionJobSnapshot {
    return operations0.upsertCollectionJobSnapshotForStore(this.operations, storeId, snapshot, event);
}

completeRecoveredCollectionImportForStore(token: CollectionImportRecoveryCasToken, input: CompleteRecoveredCollectionImportInput): LingxingCollectionJobSnapshot {
    return operations0.completeRecoveredCollectionImportForStore(this.operations, token, input);
}

cancelCollectionJobForStore(storeId: StoreId, jobId: string, options: CancelCollectionJobOptions): LingxingCollectionJobSnapshot {
    return operations0.cancelCollectionJobForStore(this.operations, storeId, jobId, options);
}

recoverInterruptedCollectionJobsForStore(storeId: StoreId, options: RecoverInterruptedCollectionJobsOptions = {}): LingxingCollectionJobSnapshot[] {
    return operations0.recoverInterruptedCollectionJobsForStore(this.operations, storeId, options);
}

getCollectionJobForStore(storeId: StoreId, jobId: string): LingxingCollectionJobSnapshot | undefined {
    return operations0.getCollectionJobForStore(this.operations, storeId, jobId);
}

listCollectionJobsForStore(storeId: StoreId, limit = 100): LingxingCollectionJobSnapshot[] {
    return operations0.listCollectionJobsForStore(this.operations, storeId, limit);
}

readUniqueCollectionAuthorityProofForStoreByRequestId(storeId: StoreId, requestId: string): LingxingCollectionAuthorityProof | undefined {
    return operations1.readUniqueCollectionAuthorityProofForStoreByRequestId(this.operations, storeId, requestId);
}

inspectUniqueCollectionJobForSemanticScope(input: LingxingCollectionSemanticScope): LingxingCollectionAuthorityProof | undefined {
    return operations1.inspectUniqueCollectionJobForSemanticScope(this.operations, input);
}

private readCollectionAuthorityProofForSelectedRow(storeId: StoreId, exactRequestId: string, row: LingxingCollectionAuthorityJobRow): LingxingCollectionAuthorityProof {
    return operations1.readCollectionAuthorityProofForSelectedRow(this.operations, storeId, exactRequestId, row);
}

findUniqueCollectionJobForStoreByRequestId(storeId: StoreId, requestId: string): LingxingCollectionJobSnapshot | undefined {
    return operations0.findUniqueCollectionJobForStoreByRequestId(this.operations, storeId, requestId);
}

listRecoverableCollectionImportsForStore(storeId: StoreId, options: ListRecoverableCollectionImportsOptions = {}): CollectionImportRecoveryPage {
    return operations0.listRecoverableCollectionImportsForStore(this.operations, storeId, options);
}

getCollectionResumeStateForStore(storeId: StoreId, jobId: string): LingxingCollectionResumeState | undefined {
    return operations2.getCollectionResumeStateForStore(this.operations, storeId, jobId);
}

getCollectionInPlaceResumeStateForStore(storeId: StoreId, jobId: string): CollectionInPlaceResumeState | undefined {
    return operations2.getCollectionInPlaceResumeStateForStore(this.operations, storeId, jobId);
}

acquireCollectionResumeClaimForStore(storeId: StoreId, input: AcquireCollectionResumeClaimInput): CollectionResumeClaim {
    return operations3.acquireCollectionResumeClaimForStore(this.operations, storeId, input);
}

commitCollectionResumeProgressForStore(storeId: StoreId, input: CommitCollectionResumeProgressInput): CollectionResumeClaim {
    return operations4.commitCollectionResumeProgressForStore(this.operations, storeId, input);
}

commitCollectionResumeRunnerResultForStore(storeId: StoreId, input: CommitCollectionResumeRunnerResultInput): CommitCollectionResumeRunnerResultOutput {
    return operations4.commitCollectionResumeRunnerResultForStore(this.operations, storeId, input);
}

advanceCollectionResumeClaimAfterImportForStore(storeId: StoreId, input: AdvanceCollectionResumeClaimAfterImportInput): CollectionResumeClaim {
    return operations4.advanceCollectionResumeClaimAfterImportForStore(this.operations, storeId, input);
}

finalizeCollectionResumeAttemptForStore(storeId: StoreId, input: FinalizeCollectionResumeAttemptInput): CollectionResumeAttemptReceipt {
    return operations5.finalizeCollectionResumeAttemptForStore(this.operations, storeId, input);
}

interruptCollectionResumeClaimForStore(storeId: StoreId, input: InterruptCollectionResumeClaimInput): CollectionResumeAttemptReceipt {
    return operations5.interruptCollectionResumeClaimForStore(this.operations, storeId, input);
}

interruptOrphanedCollectionResumeClaimsForStartup(interruptedAt = new Date().toISOString()): CollectionResumeAttemptReceipt[] {
    return operations5.interruptOrphanedCollectionResumeClaimsForStartup(this.operations, interruptedAt);
}

readLatestCollectionResumeAttemptReceiptForStore(storeId: StoreId, jobId: string, requestId: string): CollectionResumeAttemptReceipt | undefined {
    return operations2.readLatestCollectionResumeAttemptReceiptForStore(this.operations, storeId, jobId, requestId);
}

readUniqueSucceededCollectionResumeReceiptForStore(storeId: StoreId, jobId: string, requestId: string): CollectionResumeAttemptReceipt | undefined {
    return operations2.readUniqueSucceededCollectionResumeReceiptForStore(this.operations, storeId, jobId, requestId);
}

findLatestCollectionResumeStateForStore(storeId: StoreId, requestId: string): LingxingCollectionResumeState | undefined {
    return operations2.findLatestCollectionResumeStateForStore(this.operations, storeId, requestId);
}

saveCollectionSnapshotForStore(storeId: StoreId, input: LingxingCollectionSnapshotInput): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
} {
    return operations6.saveCollectionSnapshotForStore(this.operations, storeId, input);
}

commitCollectionTerminalForStore(storeId: StoreId, input: CommitCollectionTerminalInput): CollectionTerminalCommitResult {
    return operations6.commitCollectionTerminalForStore(this.operations, storeId, input);
}

getCollectionSnapshotForStore(storeId: StoreId, batchId: string): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
} | undefined {
    return operations6.getCollectionSnapshotForStore(this.operations, storeId, batchId);
}

listBatchesForStore(storeId: StoreId, limit = 100): StoreScopedLingxingReportBatch[] {
    return operations8.listBatchesForStore(this.operations, storeId, limit);
}

commitImportForStore(storeId: StoreId, input: CommitReportImportInput): ReportImportCommitResult {
    return operations7.commitImportForStore(this.operations, storeId, input);
}

getImportRunForStore(storeId: StoreId, runId: string): ReportImportRunRecord | undefined {
    return operations8.getImportRunForStore(this.operations, storeId, runId);
}

listImportRunsForStore(storeId: StoreId, limit = 100): ReportImportRunRecord[] {
    return operations8.listImportRunsForStore(this.operations, storeId, limit);
}

listFileSnapshotsForStore(storeId: StoreId, runId: string): ReportImportFileSnapshotRecord[] {
    return operations8.listFileSnapshotsForStore(this.operations, storeId, runId);
}

listReportFilesForStore(storeId: StoreId, batchId: string): StoreScopedImportedReportFile[] {
    return operations8.listReportFilesForStore(this.operations, storeId, batchId);
}

listAdMetricsForStore(storeId: StoreId, batchId: string): StoreScopedImportedAdMetric[] {
    return operations8.listAdMetricsForStore(this.operations, storeId, batchId);
}

listReconciliationsForStore(storeId: StoreId, runId: string): ReportImportReconciliationRecord[] {
    return operations8.listReconciliationsForStore(this.operations, storeId, runId);
}

private readActiveResumeClaimByAttempt(storeId: StoreId, attemptId: string): ActiveCollectionResumeClaimRow | undefined {
    return operations3.readActiveResumeClaimByAttempt(this.operations, storeId, attemptId);
}

private assertActiveResumeClaim(storeId: StoreId, claim: CollectionResumeClaim): ActiveCollectionResumeClaimRow {
    return operations3.assertActiveResumeClaim(this.operations, storeId, claim);
}

private assertResumeClaimAuthorityCurrent(storeId: StoreId, active: ActiveCollectionResumeClaimRow): LingxingCollectionAuthorityProof {
    return operations3.assertResumeClaimAuthorityCurrent(this.operations, storeId, active);
}

private appendResumeTerminalEvent(active: ActiveCollectionResumeClaimRow, outcome: 'succeeded' | 'failed' | 'interrupted', finalJobUpdatedAt: string, finalAuthorityProofSha256: string, completedAt: string, detail?: string): void {
    return operations5.appendResumeTerminalEvent(this.operations, active, outcome, finalJobUpdatedAt, finalAuthorityProofSha256, completedAt, detail);
}

private rotateActiveResumeClaim(active: ActiveCollectionResumeClaimRow, finalJobUpdatedAt: string, finalAuthorityProofSha256: string, createdAt: string, detail: string): CollectionResumeClaim {
    return operations3.rotateActiveResumeClaim(this.operations, active, finalJobUpdatedAt, finalAuthorityProofSha256, createdAt, detail);
}

private consumeActiveResumeClaim(active: ActiveCollectionResumeClaimRow): void {
    return operations3.consumeActiveResumeClaim(this.operations, active);
}

private readResumeReceiptRows(storeId: StoreId, jobId: string, requestId: string, limit: number, outcome?: 'succeeded'): CollectionResumeAttemptReceipt[] {
    return operations2.readResumeReceiptRows(this.operations, storeId, jobId, requestId, limit, outcome);
}

private requireResumeReceipt(storeId: StoreId, attemptId: string): CollectionResumeAttemptReceipt {
    return operations2.requireResumeReceipt(this.operations, storeId, attemptId);
}

private appendRecoveredSucceededResumeReceiptIfNeeded(storeId: StoreId, proof: LingxingCollectionAuthorityProof, completedAt: string, predecessorJobUpdatedAt: string): void {
    return operations2.appendRecoveredSucceededResumeReceiptIfNeeded(this.operations, storeId, proof, completedAt, predecessorJobUpdatedAt);
}

private persistCollectionJobSnapshotRows(storeId: StoreId, snapshot: LingxingCollectionJobSnapshot, event?: {
    eventId: string;
    emittedAt: string;
}): LingxingCollectionJobSnapshot {
    return operations6.persistCollectionJobSnapshotRows(this.operations, storeId, snapshot, event);
}

private persistCollectionSnapshotRows(storeId: StoreId, authority: StoreAuthority, input: LingxingCollectionSnapshotInput): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
} {
    return operations6.persistCollectionSnapshotRows(this.operations, storeId, authority, input);
}

private getWritableStoreAuthority(storeId: StoreId): StoreAuthority {
    return operations9.getWritableStoreAuthority(this.operations, storeId);
}

private getStoreAuthority(storeId: StoreId): StoreAuthority {
    return operations9.getStoreAuthority(this.operations, storeId);
}

private upsertCollectionCheckpoint(storeId: StoreId, jobId: string, checkpoint: LingxingCollectionReportCheckpoint): void {
    return operations9.upsertCollectionCheckpoint(this.operations, storeId, jobId, checkpoint);
}

private assertBatchInput(storeId: StoreId, authority: StoreAuthority, batch: LingxingReportBatch): void {
    return operations9.assertBatchInput(this.operations, storeId, authority, batch);
}

private upsertBatchRow(storeId: StoreId, batch: LingxingReportBatch): void {
    return operations9.upsertBatchRow(this.operations, storeId, batch);
}

private upsertLingxingFileRow(storeId: StoreId, file: LingxingReportFile): void {
    return operations9.upsertLingxingFileRow(this.operations, storeId, file);
}

private upsertReportFileRow(storeId: StoreId, batchId: string, file: ReportImportFileInput, importedAt: string): number {
    return operations9.upsertReportFileRow(this.operations, storeId, batchId, file, importedAt);
}

private insertMetricRow(storeId: StoreId, authority: StoreAuthority, batchId: string, batchStoreName: string | null, metric: AdDailyMetrics): void {
    return operations9.insertMetricRow(this.operations, storeId, authority, batchId, batchStoreName, metric);
}

private assertBatchOwnership(storeId: StoreId, batchId: string): {
    dateStart: string;
    dateEnd: string;
    storeName: string | null;
} {
    return operations9.assertBatchOwnership(this.operations, storeId, batchId);
}

private findExistingRun(storeId: StoreId, runId: string, idempotencyKey: string): ReportImportRunRecord | undefined {
    return operations9.findExistingRun(this.operations, storeId, runId, idempotencyKey);
}

private resolveDuplicate(existing: ReportImportRunRecord, input: CommitReportImportInput, fingerprint: string): ReportImportCommitResult {
    return operations9.resolveDuplicate(this.operations, existing, input, fingerprint);
}
}
export { type StoreScopedLingxingReportBatch, type StoreScopedLingxingReportFile, type LingxingCollectionAuthorityProof, type ReportImportMetricEvidenceRecord, type CollectionInPlaceResumeState, type AcquireCollectionResumeClaimInput, type CollectionResumeClaim, type CommitCollectionResumeProgressInput, type CommitCollectionResumeRunnerResultInput, type CommitCollectionResumeRunnerResultOutput, type AdvanceCollectionResumeClaimAfterImportInput, type FinalizeCollectionResumeAttemptInput, type InterruptCollectionResumeClaimInput, type CollectionResumeAttemptReceipt, type CollectionImportRecoveryCasToken, type CompleteRecoveredCollectionImportInput, type LingxingCollectionSemanticScope, type LingxingCollectionSnapshotInput, type CommitCollectionTerminalInput, type CollectionTerminalCommitResult, type RecoverableCollectionImportState, type CollectionImportRecoveryCursor, type CollectionImportRecoveryPage, type ListRecoverableCollectionImportsOptions, type CancelCollectionJobOptions, type RecoverInterruptedCollectionJobsOptions, type ReportImportFileInput, type ReportImportReconciliationInput, type CommitReportImportInput, type ReportImportRunRecord, type ReportImportCommitResult, type ReportImportFileSnapshotRecord, type StoreScopedImportedReportFile, type StoreScopedImportedAdMetric, type ReportImportReconciliationRecord, type AmountReconciliation } from './lingxing-import-contracts';
export { fingerprintLingxingCollectionAuthorityProof, fingerprintCollectionResumeExecutionContext } from './lingxing-import-fingerprints';
export { reconcileUsdAmount } from './lingxing-import-values';
