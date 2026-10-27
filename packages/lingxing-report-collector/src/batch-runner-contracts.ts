// 职责模块保留原有公开接口及安全校验边界。
import { normalizeStoreContextEnvelope, type LingxingCollectionExternalStep, type LingxingCollectionGuardContext, type LingxingCollectionGuardDecision, type LingxingCollectionJobSnapshot, type LingxingCollectionProgressEvent, type LingxingCollectionReportCheckpoint, type LingxingCollectionReportState, type LingxingCollectionRequestDto, type LingxingCollectionResumeState, type LingxingCreateReportOutcome, type LingxingCreatedReportIdentity, type LingxingReportBatch, type LingxingReportDefinition, type LingxingReportFile, type LingxingReportType, type StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { DownloadCenterPage, type DownloadCenterAutomationPort } from './download-center-page';

export type MaybePromise<T> = T | Promise<T>;

export type LingxingCollectionProgressSink = (event: LingxingCollectionProgressEvent) => MaybePromise<void>;

export type LingxingCollectionAuthorityGuard = (context: LingxingCollectionGuardContext) => MaybePromise<LingxingCollectionGuardDecision>;

export type LingxingCollectionCancellationGuard = (context: LingxingCollectionGuardContext) => MaybePromise<LingxingCollectionGuardDecision>;

export interface RunBatchOptions {
    requestId: string;
    storeContext: StoreContextEnvelope;
    storeDisplayName: string;
    dateStart: string;
    dateEnd: string;
    rootDownloadDir: string;
    appVersion?: string;
    reportTypes?: readonly LingxingReportType[];
    maxRetries?: number;
    automation: DownloadCenterAutomationPort;
    progressSink: LingxingCollectionProgressSink;
    authorityGuard: LingxingCollectionAuthorityGuard;
    cancellationGuard: LingxingCollectionCancellationGuard;
    executionStoreContext?: StoreContextEnvelope;
    progressEventNamespace?: string;
    resumeFrom?: LingxingCollectionResumeState | LingxingInPlaceResumeState;
    deferReconciledCreateFailures?: boolean;
}

export interface LingxingInPlaceResumeState extends LingxingCollectionResumeState {
    job: LingxingCollectionJobSnapshot;
    batch: LingxingReportBatch;
    files: readonly LingxingReportFile[];
}

export interface RunBatchResult {
    batch: LingxingReportBatch;
    files: LingxingReportFile[];
    job: LingxingCollectionJobSnapshot;
}

export type ReportDownloadMode = 'create-and-download' | 'download-existing';

export type MutableCollectionJob = Omit<LingxingCollectionJobSnapshot, 'reports' | 'request'> & {
    request: LingxingCollectionRequestDto;
    reports: LingxingCollectionReportCheckpoint[];
};

export class GuardBlockedError extends Error {
    constructor(readonly state: 'cancelled' | 'stale_authority', readonly blockerCode: string, message: string) {
        super(message);
        this.name = 'GuardBlockedError';
    }
}

export class UnknownCreateOutcomeError extends Error {
    constructor(readonly blockerCode: string, message: string) {
        super(message);
        this.name = 'UnknownCreateOutcomeError';
    }
}

export class KnownNotCreatedError extends Error {
    constructor(readonly retryable: boolean, readonly blockerCode: string, message: string) {
        super(message);
        this.name = 'KnownNotCreatedError';
    }
}

export class ProgressPersistenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProgressPersistenceError';
    }
}

export interface ValidatedResumeState {
    checkpoints: Map<LingxingReportType, LingxingCollectionReportCheckpoint>;
    downloadedFiles: Map<LingxingReportType, LingxingReportFile>;
    inPlace?: LingxingInPlaceResumeState;
}
