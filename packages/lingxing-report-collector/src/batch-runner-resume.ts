// 职责模块保留原有公开接口及安全校验边界。
import { normalizeStoreContextEnvelope, type LingxingCollectionExternalStep, type LingxingCollectionGuardContext, type LingxingCollectionGuardDecision, type LingxingCollectionJobSnapshot, type LingxingCollectionProgressEvent, type LingxingCollectionReportCheckpoint, type LingxingCollectionReportState, type LingxingCollectionRequestDto, type LingxingCollectionResumeState, type LingxingCreateReportOutcome, type LingxingCreatedReportIdentity, type LingxingReportBatch, type LingxingReportDefinition, type LingxingReportFile, type LingxingReportType, type StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from './report-types';
import { verifyDownloadedFile, verifyDownloadedFileAsync, type DownloadedFileVerificationOptions, type FileVerificationResult } from './file-verifier';
import type { ReportContentInspector } from './report-file-inspector';
import { type LingxingInPlaceResumeState, type ValidatedResumeState } from './batch-runner-contracts';
import { isInPlaceResumeState, assertPathWithin, cloneCheckpoint, normalizeCreatedIdentity, cloneReportFile } from './batch-runner-snapshots';
import { storeContextKey, stableJsonForIdentity } from './batch-runner-values';

export function isReconciledCreateFailure(checkpoint: LingxingCollectionReportCheckpoint): boolean {
    return checkpoint.state === 'failed'
        && !checkpoint.createdReportIdentity
        && (checkpoint.errorCode === 'LINGXING_CREATE_CONFIRMED_ABSENT'
            || checkpoint.errorCode === 'LINGXING_CREATE_CONFIRMED_FAILED');
}

type ResumeArguments = [resumeFrom: LingxingCollectionResumeState | LingxingInPlaceResumeState | undefined, request: LingxingCollectionRequestDto, maxRetries: number, rootDownloadDir: string, deferReconciledCreateFailures: boolean];
type VerificationStep = { filePath: string; options: DownloadedFileVerificationOptions };

function* validateResumeStateSteps(...[resumeFrom, request, maxRetries, rootDownloadDir, deferReconciledCreateFailures]: ResumeArguments): Generator<VerificationStep, ValidatedResumeState, FileVerificationResult> {
    if (!resumeFrom) {
        return { checkpoints: new Map(), downloadedFiles: new Map() };
    }
    const inPlace = isInPlaceResumeState(resumeFrom) ? resumeFrom : undefined;
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(resumeFrom.jobId)) {
        throw new Error('resume jobId is invalid');
    }
    if (resumeFrom.request.requestId !== request.requestId
        || resumeFrom.request.mode !== request.mode
        || resumeFrom.request.dateStart !== request.dateStart
        || resumeFrom.request.dateEnd !== request.dateEnd
        || storeContextKey(normalizeStoreContextEnvelope(resumeFrom.request.storeContext))
            !== storeContextKey(request.storeContext)
        || JSON.stringify(resumeFrom.request.reportTypes) !== JSON.stringify(request.reportTypes)) {
        throw new Error('resume state does not match the current store-authoritative request');
    }
    if (inPlace) {
        if (inPlace.job.jobId !== inPlace.jobId
            || stableJsonForIdentity(inPlace.job.request) !== stableJsonForIdentity(inPlace.request)
            || inPlace.batch.id !== inPlace.jobId
            || inPlace.batch.requestId !== request.requestId
            || inPlace.batch.storeId !== request.storeContext.storeId
            || inPlace.batch.browserProfileId !== request.storeContext.browserProfileId
            || inPlace.batch.marketplaceCode !== request.storeContext.marketplace
            || inPlace.batch.businessDate !== request.storeContext.businessDate
            || inPlace.batch.sessionGeneration !== request.storeContext.sessionGeneration
            || inPlace.batch.dateStart !== request.dateStart
            || inPlace.batch.dateEnd !== request.dateEnd) {
            throw new Error('in-place resume batch/job identity does not match the durable request');
        }
        if (request.reportTypes.length !== LINGXING_AD_REPORTS.length) {
            throw new Error('in-place resume requires the complete eight-report request');
        }
        assertPathWithin(rootDownloadDir, inPlace.batch.downloadDir, 'resume batch downloadDir');
    }
    const allowedReports = new Set(request.reportTypes);
    const checkpoints = new Map<LingxingReportType, LingxingCollectionReportCheckpoint>();
    const downloadedFiles = new Map<LingxingReportType, LingxingReportFile>();
    const filesByType = new Map<LingxingReportType, LingxingReportFile[]>();
    if (inPlace) {
        for (const rawFile of inPlace.files) {
            if (rawFile.batchId !== inPlace.jobId || !allowedReports.has(rawFile.reportType)) {
                throw new Error('in-place resume contains an out-of-scope durable file');
            }
            const current = filesByType.get(rawFile.reportType) ?? [];
            current.push(rawFile);
            if (current.length > 1) {
                throw new Error('in-place resume contains duplicate durable files for one report type');
            }
            filesByType.set(rawFile.reportType, current);
        }
    }
    for (const rawCheckpoint of resumeFrom.reports) {
        if (!allowedReports.has(rawCheckpoint.reportType) || checkpoints.has(rawCheckpoint.reportType)) {
            throw new Error('resume state contains a duplicate or out-of-scope report checkpoint');
        }
        if (!Number.isInteger(rawCheckpoint.attemptIndex)
            || rawCheckpoint.attemptIndex < 0
            || rawCheckpoint.attemptIndex > maxRetries) {
            throw new Error('resume state contains an invalid attempt index');
        }
        if (rawCheckpoint.state === 'queued') {
            if (rawCheckpoint.createdReportIdentity) {
                throw new Error('queued resume checkpoints must not contain a created report identity');
            }
            checkpoints.set(rawCheckpoint.reportType, cloneCheckpoint(rawCheckpoint));
            continue;
        }
        if (deferReconciledCreateFailures && isReconciledCreateFailure(rawCheckpoint)) {
            checkpoints.set(rawCheckpoint.reportType, cloneCheckpoint(rawCheckpoint));
            continue;
        }
        if (!rawCheckpoint.createdReportIdentity
            && (rawCheckpoint.state === 'navigating' || rawCheckpoint.state === 'failed')) {
            checkpoints.set(rawCheckpoint.reportType, {
                ...cloneCheckpoint(rawCheckpoint),
                state: 'queued',
                fileSizeBytes: undefined,
                errorCode: undefined,
            });
            continue;
        }
        if (rawCheckpoint.state === 'downloaded') {
            if (!inPlace) {
                throw new Error('downloaded resume checkpoints must be resolved by Main from the persisted verified file and are never redownloaded automatically');
            }
            const matchingFiles = filesByType.get(rawCheckpoint.reportType) ?? [];
            if (matchingFiles.length !== 1) {
                throw new Error('downloaded resume checkpoint requires exactly one durable file');
            }
            const durableFile = matchingFiles[0];
            if (!rawCheckpoint.createdReportIdentity) {
                throw new Error('downloaded resume checkpoint requires a confirmed created report identity');
            }
            normalizeCreatedIdentity(rawCheckpoint.createdReportIdentity, rawCheckpoint.reportType, request.dateStart, request.dateEnd);
            if (durableFile.status !== 'downloaded'
                || !durableFile.filePath
                || !Number.isSafeInteger(durableFile.fileSizeBytes)
                || durableFile.fileSizeBytes! <= 0
                || durableFile.fileSizeBytes !== rawCheckpoint.fileSizeBytes) {
                throw new Error('downloaded resume checkpoint has invalid durable file metadata');
            }
            const report = LINGXING_AD_REPORTS.find((candidate) => (candidate.type === rawCheckpoint.reportType));
            if (!report)
                throw new Error('downloaded resume checkpoint report type is unknown');
            const verification = yield { filePath: durableFile.filePath, options: {
                minBytes: 128,
                expectedFilenameKeyword: report.expectedFilenameKeyword,
                expectedDateRange: { start: request.dateStart, end: request.dateEnd },
                expectedDownloadDir: inPlace.batch.downloadDir,
                expectedReportType: report.type,
                expectedFileSizeBytes: durableFile.fileSizeBytes,
            } };
            if (!verification.valid || verification.fileSizeBytes !== durableFile.fileSizeBytes) {
                throw new Error(verification.errorMessage
                    || 'downloaded resume file no longer matches its durable verification metadata', { cause: verification.failure });
            }
            checkpoints.set(rawCheckpoint.reportType, cloneCheckpoint(rawCheckpoint));
            downloadedFiles.set(rawCheckpoint.reportType, cloneReportFile(durableFile));
            continue;
        }
        if (rawCheckpoint.state === 'create_unknown' || rawCheckpoint.state === 'creating') {
            throw new Error('resume is blocked because report creation requires human reconciliation');
        }
        if (rawCheckpoint.state === 'cancelled' || rawCheckpoint.state === 'stale_authority') {
            throw new Error('cancelled or stale-authority checkpoints require a newly authorized Main-owned resume request');
        }
        const identity = rawCheckpoint.createdReportIdentity
            ? normalizeCreatedIdentity(rawCheckpoint.createdReportIdentity, rawCheckpoint.reportType, request.dateStart, request.dateEnd)
            : undefined;
        if (!identity) {
            throw new Error('resume is allowed only from a checkpoint with a confirmed created report identity');
        }
        const state: LingxingCollectionReportState = rawCheckpoint.state === 'ready'
            ? 'ready'
            : 'created';
        checkpoints.set(rawCheckpoint.reportType, {
            ...rawCheckpoint,
            state,
            createdReportIdentity: identity,
        });
    }
    if (inPlace && checkpoints.size !== request.reportTypes.length) {
        throw new Error('in-place resume must contain exactly one checkpoint for every report type');
    }
    if (inPlace && resumeFrom.reports.length !== request.reportTypes.length) {
        throw new Error('in-place resume must contain exactly eight report checkpoints');
    }
    return { checkpoints, downloadedFiles, ...(inPlace ? { inPlace } : {}) };
}

export function validateResumeState(...args: ResumeArguments): ValidatedResumeState {
    const steps = validateResumeStateSteps(...args);
    let step = steps.next();
    while (!step.done) step = steps.next(verifyDownloadedFile(step.value.filePath, step.value.options));
    return step.value;
}

export async function validateResumeStateAsync(inspector: ReportContentInspector, ...args: ResumeArguments): Promise<ValidatedResumeState> {
    if (typeof inspector !== 'function') throw new Error('REPORT_CONTENT_INSPECTOR_REQUIRED');
    // 等待解析时不再引用调用方可改写的恢复记录和请求对象。
    const snapshot: ResumeArguments = [args[0] === undefined ? undefined : structuredClone(args[0]), structuredClone(args[1]), args[2], args[3], args[4]];
    const steps = validateResumeStateSteps(...snapshot);
    let step = steps.next();
    while (!step.done) step = steps.next(await verifyDownloadedFileAsync(step.value.filePath, step.value.options, inspector));
    return step.value;
}
