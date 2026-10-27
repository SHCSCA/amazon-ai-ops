import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';

export const COMPLETE_LINGXING_REPORT_TYPES = new Set<LingxingReportType>([
    'campaign', 'ad_group', 'placement', 'advertised_product',
    'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
]);

export interface StoreScopedLingxingReportBatch extends LingxingReportBatch {
    storeId: StoreId;
}

export interface StoreScopedLingxingReportFile extends LingxingReportFile {
    storeId: StoreId;
}

export interface LingxingCollectionAuthorityProof {
    job: LingxingCollectionJobSnapshot;
    jobRow: {
        storeId: StoreId;
        jobId: string;
        requestId: string;
        browserProfileId: string;
        marketplace: string;
        currency: string;
        businessTimezone: string;
        businessDate: string;
        sessionGeneration: number;
        dateStart: string;
        dateEnd: string;
        mode: string;
        reportTypesJson: string;
        state: string;
        createdAt: string;
        updatedAt: string;
        completedAt: string | null;
        blockerCode: string | null;
        detail: string | null;
    };
    checkpointCount: number;
    batch?: StoreScopedLingxingReportBatch;
    lingxingFileCount: number;
    lingxingFiles: StoreScopedLingxingReportFile[];
    importRunCount: number;
    importRuns: ReportImportRunRecord[];
    importFileSnapshotCount: number;
    importFileSnapshots: ReportImportFileSnapshotRecord[];
    importedReportFileCount: number;
    importedReportFiles: StoreScopedImportedReportFile[];
    reconciliationRowCount: number;
    reconciliations: ReportImportReconciliationRecord[];
    metricEvidenceCount: number;
    metricEvidence: ReportImportMetricEvidenceRecord[];
}

export interface ReportImportMetricEvidenceRecord {
    storeId: StoreId;
    runId: string;
    batchId: string;
    rowCount: number;
    payloadSha256: string;
    createdAt: string;
}

export interface CollectionInPlaceResumeState extends LingxingCollectionResumeState {
    job: LingxingCollectionJobSnapshot;
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
    expectedJobUpdatedAt: string;
    authorityProofSha256: string;
}

export interface AcquireCollectionResumeClaimInput {
    jobId: string;
    requestId: string;
    expectedJobUpdatedAt: string;
    expectedAuthorityProofSha256: string;
    executionStoreContext: StoreContextEnvelope;
    attemptId?: string;
    claimedAt?: string;
}

export interface CollectionResumeClaim {
    storeId: StoreId;
    attemptId: string;
    jobId: string;
    requestId: string;
    claimToken: string;
    expectedJobUpdatedAt: string;
    expectedAuthorityProofSha256: string;
    version: number;
    claimedAt: string;
}

export interface CommitCollectionResumeProgressInput {
    claim: CollectionResumeClaim;
    event: LingxingCollectionProgressEvent;
}

export interface CommitCollectionResumeRunnerResultInput extends CommitCollectionTerminalInput {
    claim: CollectionResumeClaim;
}

export interface CommitCollectionResumeRunnerResultOutput {
    claim: CollectionResumeClaim;
    result: CollectionTerminalCommitResult;
}

export interface AdvanceCollectionResumeClaimAfterImportInput {
    claim: CollectionResumeClaim;
    advancedAt?: string;
}

export interface FinalizeCollectionResumeAttemptInput {
    claim: CollectionResumeClaim;
    outcome: 'succeeded' | 'failed';
    completedAt?: string;
    detail?: string;
}

export interface InterruptCollectionResumeClaimInput {
    claim: CollectionResumeClaim;
    interruptedAt?: string;
    detail?: string;
}

export interface CollectionResumeAttemptReceipt {
    storeId: StoreId;
    attemptId: string;
    jobId: string;
    requestId: string;
    outcome: 'succeeded' | 'failed' | 'interrupted';
    baseJobUpdatedAt: string;
    finalJobUpdatedAt: string;
    baseAuthorityProofSha256: string;
    finalAuthorityProofSha256: string;
    durableSessionGeneration: number;
    executionSessionGeneration: number;
    executionContextSha256: string;
    claimedAt: string;
    completedAt: string;
    detail?: string;
}

export interface ActiveCollectionResumeClaimRow {
    storeId: StoreId;
    jobId: string;
    requestId: string;
    attemptId: string;
    claimTokenSha256: string;
    expectedJobUpdatedAt: string;
    expectedAuthorityProofSha256: string;
    version: number;
    claimedAt: string;
    baseJobUpdatedAt: string;
    baseAuthorityProofSha256: string;
    durableSessionGeneration: number;
    executionSessionGeneration: number;
    executionContextSha256: string;
}

export interface CollectionImportRecoveryCasToken {
    storeId: StoreId;
    jobId: string;
    requestId: string;
    expectedJobUpdatedAt: string;
    expectedImportState: 'pending' | 'failed';
    expectedRunId: string;
    expectedAuthorityProofSha256: string;
}

export interface CompleteRecoveredCollectionImportInput {
    attemptedAt: string;
    completedAt: string;
}

export interface LingxingCollectionSemanticScope {
    storeId: StoreId;
    browserProfileId: string;
    businessDate: string;
    dateStart: string;
    dateEnd: string;
    mode: 'create-and-download';
    reportTypes: readonly LingxingReportType[];
}

export type LingxingCollectionAuthorityJobRow = LingxingCollectionAuthorityProof['jobRow'] & {
    snapshotJson: string;
};

export interface LingxingCollectionSnapshotInput {
    batch: LingxingReportBatch;
    files: readonly LingxingReportFile[];
}

export interface CommitCollectionTerminalInput extends LingxingCollectionSnapshotInput {
    job: LingxingCollectionJobSnapshot;
}

export interface CollectionTerminalCommitResult {
    job: LingxingCollectionJobSnapshot;
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
}

export type RecoverableCollectionImportState = 'pending' | 'failed';

export interface CollectionImportRecoveryCursor {
    updatedAt: string;
    jobId: string;
}

export interface CollectionImportRecoveryPage {
    jobs: LingxingCollectionJobSnapshot[];
    nextCursor?: CollectionImportRecoveryCursor;
}

export interface ListRecoverableCollectionImportsOptions {
    limit?: number;
    cursor?: CollectionImportRecoveryCursor;
    importStates?: readonly RecoverableCollectionImportState[];
}

export interface CancelCollectionJobOptions {
    requestId: string;
    completedAt?: string;
    blockerCode?: string;
    detail?: string;
}

export interface RecoverInterruptedCollectionJobsOptions {
    completedAt?: string;
    blockerCode?: string;
    detail?: string;
}

export interface ReportImportFileInput {
    lingxingFileId?: string;
    reportType: string;
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    fileHash: string;
    importedRows: number;
}

export interface ReportImportReconciliationInput {
    dateStart: string;
    dateEnd: string;
    metricDate: string;
    reportType: string;
    expectedRows: number;
    expectedCost: number;
    tolerance?: number;
}

export interface CommitReportImportInput {
    runId: string;
    idempotencyKey: string;
    batchId: string;
    files: readonly ReportImportFileInput[];
    metrics: readonly AdDailyMetrics[];
    reconciliations: readonly ReportImportReconciliationInput[];
    startedAt?: string;
    completedAt?: string;
}

export interface ReportImportRunRecord {
    storeId: StoreId;
    runId: string;
    idempotencyKey: string;
    inputFingerprint: string;
    batchId: string;
    status: 'completed';
    sourceFileCount: number;
    metricRowCount: number;
    reconciliationCount: number;
    startedAt: string;
    completedAt: string;
    createdAt: string;
}

export interface ReportImportCommitResult {
    run: ReportImportRunRecord;
    deduplicated: boolean;
}

export interface ReportImportFileSnapshotRecord {
    storeId: StoreId;
    snapshotId: string;
    runId: string;
    batchId: string;
    lingxingFileId?: string;
    reportFileId?: number;
    reportType: string;
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    fileHash: string;
    importedRows: number;
    capturedAt: string;
}

export interface StoreScopedImportedReportFile {
    id: number;
    storeId: StoreId;
    batchId: string;
    reportType: string;
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    status: string;
    importedRows: number;
    fileHash?: string;
    importError?: string;
    lastImportedAt?: string;
}

export type StoreScopedImportedAdMetric = AdDailyMetrics & {
    storeId: StoreId;
};

export interface ReportImportReconciliationRecord {
    storeId: StoreId;
    reconciliationId: string;
    runId: string;
    batchId: string;
    dateStart: string;
    dateEnd: string;
    metricDate: string;
    reportType: string;
    currency: 'USD';
    expectedRows: number;
    actualRows: number;
    expectedCost: number;
    actualCost: number;
    absoluteCostDelta: number;
    tolerance: number;
    withinTolerance: boolean;
    status: 'matched' | 'mismatch';
    reconciledAt: string;
}

export interface AmountReconciliation {
    expectedAmount1e4: number;
    actualAmount1e4: number;
    absoluteDelta1e4: number;
    tolerance1e4: number;
    withinTolerance: boolean;
}

export interface StoreAuthority {
    displayName: string;
    lingxingCollectionStoreName?: string | null;
    browserProfileId: string;
    businessTimezone: string;
    marketplace: string;
    currency: string;
    status: string;
}

export const TERMINAL_COLLECTION_REPORT_STATES = new Set<LingxingCollectionReportCheckpoint['state']>([
    'downloaded',
    'failed',
    'create_unknown',
    'cancelled',
    'stale_authority',
]);

export const TERMINAL_COLLECTION_JOB_STATES = new Set<LingxingCollectionJobSnapshot['state']>([
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
    'stale_authority',
]);
