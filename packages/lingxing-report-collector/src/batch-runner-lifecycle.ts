// 职责模块保留原有公开接口及安全校验边界。
import * as path from 'path';
import { normalizeStoreContextEnvelope, type LingxingCollectionExternalStep, type LingxingCollectionGuardContext, type LingxingCollectionGuardDecision, type LingxingCollectionJobSnapshot, type LingxingCollectionProgressEvent, type LingxingCollectionReportCheckpoint, type LingxingCollectionReportState, type LingxingCollectionRequestDto, type LingxingCollectionResumeState, type LingxingCreateReportOutcome, type LingxingCreatedReportIdentity, type LingxingReportBatch, type LingxingReportDefinition, type LingxingReportFile, type LingxingReportType, type StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { DownloadCenterPage, type DownloadCenterAutomationPort } from './download-center-page';
import { verifyDownloadedFileAsync } from './file-verifier';
import { writeManifest } from './manifest';
import { type RunBatchOptions, type RunBatchResult, type ReportDownloadMode, type MutableCollectionJob, GuardBlockedError, UnknownCreateOutcomeError, ProgressPersistenceError, KnownNotCreatedError } from './batch-runner-contracts';
import { validateRequestId, stableStoreContextKey, validateStoreDisplayName, validateDateRange, selectReports, errorMessage, pathFreeDetail, legacyStatusForState, normalizeBlockerCode, createOutcomeError } from './batch-runner-values';
import { validateResumeStateAsync, isReconciledCreateFailure } from './batch-runner-resume';
import { stamp, isoNow, isoAfter } from './batch-runner-clock';
import { snapshotJob, cloneCreatedIdentity, cloneReportFile, normalizeCreatedIdentity } from './batch-runner-snapshots';

export async function runLingxingReportBatch(options: RunBatchOptions): Promise<RunBatchResult> {
    return runLingxingReportBatchInternal(options, 'create-and-download');
}

export async function downloadExistingLingxingReportBatch(options: RunBatchOptions): Promise<RunBatchResult> {
    return runLingxingReportBatchInternal(options, 'download-existing');
}

export async function runLingxingReportBatchInternal(options: RunBatchOptions, mode: ReportDownloadMode): Promise<RunBatchResult> {
    if (typeof options.reportContentInspector !== 'function') throw new Error('REPORT_CONTENT_INSPECTOR_REQUIRED');
    const requestId = validateRequestId(options.requestId);
    const storeContext = Object.freeze({ ...normalizeStoreContextEnvelope(options.storeContext) });
    const executionStoreContext = Object.freeze({
        ...normalizeStoreContextEnvelope(options.executionStoreContext ?? options.storeContext),
    });
    if (stableStoreContextKey(storeContext) !== stableStoreContextKey(executionStoreContext)
        || executionStoreContext.sessionGeneration < storeContext.sessionGeneration) {
        throw new Error('executionStoreContext must match the durable store axes and cannot use an older session generation');
    }
    const progressEventNamespace = options.progressEventNamespace === undefined
        ? undefined
        : validateRequestId(options.progressEventNamespace);
    const storeDisplayName = validateStoreDisplayName(options.storeDisplayName);
    validateDateRange(options.dateStart, options.dateEnd);
    const requestedMaxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(requestedMaxRetries)
        || requestedMaxRetries < 0
        || requestedMaxRetries > 10) {
        throw new Error('maxRetries must be an integer between 0 and 10');
    }
    const durableAttemptFloor = options.resumeFrom?.reports.reduce((highest, checkpoint) => (Number.isInteger(checkpoint.attemptIndex)
        && checkpoint.attemptIndex >= 0
        && checkpoint.attemptIndex <= 10
        ? Math.max(highest, checkpoint.attemptIndex)
        : highest), 0) ?? 0;
    const maxRetries = Math.max(requestedMaxRetries, durableAttemptFloor);
    const selectedReports = selectReports(options.reportTypes);
    const request: LingxingCollectionRequestDto = Object.freeze({
        requestId,
        storeContext,
        dateStart: options.dateStart,
        dateEnd: options.dateEnd,
        mode,
        reportTypes: Object.freeze(selectedReports.map((report) => report.type)),
    });
    const validatedResume = await validateResumeStateAsync(options.reportContentInspector, options.resumeFrom, request, maxRetries, options.rootDownloadDir, options.deferReconciledCreateFailures === true);
    const resumeCheckpoints = validatedResume.checkpoints;
    const batchId = options.resumeFrom?.jobId ?? `batch_${stamp()}`;
    const downloadDir = validatedResume.inPlace?.batch.downloadDir ?? path.join(options.rootDownloadDir, 'lingxing-ad-reports', `${options.dateStart}_${options.dateEnd}`, batchId);
    const createdAt = validatedResume.inPlace?.batch.createdAt ?? isoNow();
    if (validatedResume.inPlace?.batch.appVersion
        && options.appVersion
        && validatedResume.inPlace.batch.appVersion !== options.appVersion) {
        throw new Error('in-place resume cannot change the durable batch appVersion');
    }
    const batch: LingxingReportBatch = validatedResume.inPlace
        ? {
            ...validatedResume.inPlace.batch,
            status: 'running',
            completedAt: undefined,
            manifestPath: undefined,
        }
        : {
            id: batchId,
            requestId,
            storeId: storeContext.storeId,
            browserProfileId: storeContext.browserProfileId,
            businessDate: storeContext.businessDate,
            sessionGeneration: storeContext.sessionGeneration,
            appVersion: options.appVersion,
            dateStart: options.dateStart,
            dateEnd: options.dateEnd,
            storeName: storeDisplayName,
            marketplaceCode: storeContext.marketplace,
            status: 'running',
            downloadDir,
            createdAt,
        };
    const initialJobTimestamp = validatedResume.inPlace
        ? isoAfter(validatedResume.inPlace.job.updatedAt)
        : createdAt;
    const job: MutableCollectionJob = validatedResume.inPlace
        ? {
            ...validatedResume.inPlace.job,
            request,
            state: 'running',
            reports: selectedReports.map((report) => (resumeCheckpoints.get(report.type)!)),
            completedAt: undefined,
            blockerCode: undefined,
            detail: undefined,
            updatedAt: initialJobTimestamp,
        }
        : {
            jobId: batchId,
            request,
            state: 'running',
            reports: selectedReports.map((report) => (resumeCheckpoints.get(report.type) ?? {
                reportType: report.type,
                state: 'queued',
                attemptIndex: 0,
                autoRetryCount: 0,
                updatedAt: createdAt,
            })),
            createdAt,
            updatedAt: createdAt,
        };
    const page = new DownloadCenterPage(options.automation);
    const files: LingxingReportFile[] = [];
    const durableFilesByType = new Map<LingxingReportType, LingxingReportFile>((validatedResume.inPlace?.files ?? []).map((file) => [file.reportType, file]));
    let progressSequence = 0;
    let progressSinkFailed = false;
    let aborted: GuardBlockedError | null = null;
    let reconciliationBlocked: UnknownCreateOutcomeError | null = null;
    const emitProgress = async (changedReportType?: LingxingReportType, externalStep?: LingxingCollectionExternalStep): Promise<void> => {
        job.updatedAt = isoNow();
        progressSequence += 1;
        const event: LingxingCollectionProgressEvent = {
            eventId: `${progressEventNamespace ?? job.jobId}:${progressSequence}`,
            emittedAt: job.updatedAt,
            ...(changedReportType ? { changedReportType } : {}),
            ...(externalStep ? { externalStep } : {}),
            job: snapshotJob(job),
        };
        try {
            await options.progressSink(event);
        }
        catch (error) {
            progressSinkFailed = true;
            throw new ProgressPersistenceError(`collection progress sink failed: ${errorMessage(error)}`);
        }
    };
    const updateReport = async (checkpoint: LingxingCollectionReportCheckpoint, file: LingxingReportFile, state: LingxingCollectionReportState, detail?: string, externalStep?: LingxingCollectionExternalStep): Promise<void> => {
        checkpoint.state = state;
        checkpoint.detail = detail === undefined ? undefined : pathFreeDetail(detail);
        checkpoint.updatedAt = isoNow();
        checkpoint.autoRetryCount = checkpoint.attemptIndex;
        file.status = legacyStatusForState(state);
        file.updatedAt = checkpoint.updatedAt;
        await emitProgress(checkpoint.reportType, externalStep);
    };
    const guardExternalStep = async (step: LingxingCollectionExternalStep, reportType?: LingxingReportType, attemptIndex = 0, createdReportIdentity?: LingxingCreatedReportIdentity): Promise<void> => {
        const context: LingxingCollectionGuardContext = {
            jobId: job.jobId,
            requestId,
            storeContext: executionStoreContext,
            ...(reportType ? { reportType } : {}),
            attemptIndex,
            step,
            ...(createdReportIdentity ? { createdReportIdentity: cloneCreatedIdentity(createdReportIdentity) } : {}),
        };
        let authority: LingxingCollectionGuardDecision;
        try {
            authority = await options.authorityGuard(context);
        }
        catch (error) {
            throw new GuardBlockedError('stale_authority', 'LINGXING_COLLECTION_AUTHORITY_GUARD_FAILED', errorMessage(error));
        }
        if (!authority || authority.allowed !== true) {
            const blocked = authority as Exclude<LingxingCollectionGuardDecision, {
                allowed: true;
            }> | undefined;
            throw new GuardBlockedError('stale_authority', normalizeBlockerCode(blocked?.blockerCode, 'LINGXING_COLLECTION_AUTHORITY_STALE'), blocked?.detail || 'Store authority is no longer current');
        }
        let cancellation: LingxingCollectionGuardDecision;
        try {
            cancellation = await options.cancellationGuard(context);
        }
        catch (error) {
            throw new GuardBlockedError('cancelled', 'LINGXING_COLLECTION_CANCELLATION_GUARD_FAILED', errorMessage(error));
        }
        if (!cancellation || cancellation.allowed !== true) {
            const blocked = cancellation as Exclude<LingxingCollectionGuardDecision, {
                allowed: true;
            }> | undefined;
            throw new GuardBlockedError('cancelled', normalizeBlockerCode(blocked?.blockerCode, 'LINGXING_COLLECTION_CANCELLED'), blocked?.detail || 'Collection was cancelled');
        }
    };
    await emitProgress();
    for (let reportIndex = 0; reportIndex < selectedReports.length; reportIndex += 1) {
        const report = selectedReports[reportIndex];
        const checkpoint = job.reports[reportIndex];
        const downloadedFile = validatedResume.downloadedFiles.get(report.type);
        if (downloadedFile) {
            files.push(cloneReportFile(downloadedFile));
            continue;
        }
        const durableFile = durableFilesByType.get(report.type);
        const { filePath: _staleFilePath, fileSizeBytes: _staleFileSizeBytes, ...durableFileBase } = durableFile ? cloneReportFile(durableFile) : {};
        const file: LingxingReportFile = {
            ...durableFileBase,
            id: durableFile?.id ?? `${batchId}_${report.type}`,
            batchId,
            reportType: report.type,
            displayName: durableFile?.displayName ?? report.displayName,
            status: legacyStatusForState(checkpoint.state),
            maxAutoRetries: maxRetries,
            autoRetryCount: checkpoint.autoRetryCount,
            attemptErrors: [...(durableFile?.attemptErrors ?? [])],
            createdAt: durableFile?.createdAt ?? createdAt,
            updatedAt: checkpoint.updatedAt,
        };
        if (options.deferReconciledCreateFailures === true
            && isReconciledCreateFailure(checkpoint)) {
            file.errorMessage = checkpoint.detail;
            files.push(file);
            continue;
        }
        let createdReportIdentity = checkpoint.createdReportIdentity;
        let readyConfirmed = checkpoint.state === 'ready';
        let reportCompleted = false;
        for (let attempt = checkpoint.attemptIndex; attempt <= maxRetries; attempt += 1) {
            checkpoint.attemptIndex = attempt;
            checkpoint.autoRetryCount = attempt;
            file.autoRetryCount = attempt;
            const isFinalAttempt = attempt === maxRetries;
            let traceStarted = false;
            let tracePath: string | undefined;
            try {
                if (isFinalAttempt && options.automation.startAttemptTrace) {
                    await guardExternalStep('start_trace', report.type, attempt, createdReportIdentity);
                    await options.automation.startAttemptTrace(report, { start: options.dateStart, end: options.dateEnd }, attempt);
                    traceStarted = true;
                }
                await updateReport(checkpoint, file, 'navigating', '正在打开当前店铺的领星下载中心。', 'navigate');
                await guardExternalStep('navigate', report.type, attempt, createdReportIdentity);
                await page.navigate();
                if (mode === 'create-and-download' && !createdReportIdentity) {
                    await updateReport(checkpoint, file, 'creating', '正在提交领星报表创建请求。', 'create');
                    await guardExternalStep('create', report.type, attempt);
                    let outcome: LingxingCreateReportOutcome;
                    try {
                        outcome = await page.create(report, { start: options.dateStart, end: options.dateEnd });
                    }
                    catch (error) {
                        throw new UnknownCreateOutcomeError('LINGXING_CREATE_CALL_INTERRUPTED', `report creation call ended without a confirmed outcome: ${errorMessage(error)}`);
                    }
                    if (!outcome || outcome.status !== 'created') {
                        throw createOutcomeError(outcome);
                    }
                    try {
                        createdReportIdentity = normalizeCreatedIdentity(outcome.identity, report.type, options.dateStart, options.dateEnd);
                    }
                    catch (error) {
                        throw new UnknownCreateOutcomeError('LINGXING_CREATED_IDENTITY_INVALID', errorMessage(error));
                    }
                    checkpoint.createdReportIdentity = createdReportIdentity;
                    readyConfirmed = false;
                    await updateReport(checkpoint, file, 'created', `已保存领星报表身份 ${createdReportIdentity.externalReportName}。`, 'create');
                }
                if (!readyConfirmed) {
                    await updateReport(checkpoint, file, 'waiting_ready', '正在等待领星报表生成完成。', 'wait_ready');
                    await guardExternalStep('wait_ready', report.type, attempt, createdReportIdentity);
                    await page.waitUntilReady(report, { start: options.dateStart, end: options.dateEnd }, createdReportIdentity);
                    readyConfirmed = true;
                    await updateReport(checkpoint, file, 'ready', '领星报表已进入可下载状态。', 'wait_ready');
                }
                await updateReport(checkpoint, file, 'downloading', '正在下载领星报表。', 'download');
                await guardExternalStep('download', report.type, attempt, createdReportIdentity);
                const filePath = await page.download(report, { start: options.dateStart, end: options.dateEnd }, downloadDir, createdReportIdentity);
                file.filePath = filePath;
                await updateReport(checkpoint, file, 'verifying', '正在校验报表类型、日期、路径和文件大小。', 'verify');
                await guardExternalStep('verify', report.type, attempt, createdReportIdentity);
                const verification = await verifyDownloadedFileAsync(filePath, {
                    minBytes: 128,
                    expectedFilenameKeyword: report.expectedFilenameKeyword,
                    expectedDateRange: { start: options.dateStart, end: options.dateEnd },
                    expectedDownloadDir: downloadDir,
                    expectedReportType: report.type,
                }, options.reportContentInspector);
                await guardExternalStep('verify', report.type, attempt, createdReportIdentity);
                file.fileSizeBytes = verification.fileSizeBytes;
                checkpoint.fileSizeBytes = verification.fileSizeBytes;
                if (!verification.valid) {
                    throw new Error(verification.errorMessage || 'Downloaded file verification failed', { cause: verification.failure });
                }
                if (traceStarted) {
                    await guardExternalStep('stop_trace', report.type, attempt, createdReportIdentity);
                    await options.automation.stopAttemptTrace?.(report, { start: options.dateStart, end: options.dateEnd }, attempt, false);
                    traceStarted = false;
                }
                file.errorMessage = undefined;
                checkpoint.errorCode = undefined;
                await updateReport(checkpoint, file, 'downloaded', '报表下载与校验完成。');
                reportCompleted = true;
                break;
            }
            catch (error) {
                const message = errorMessage(error);
                file.errorMessage = message;
                file.attemptErrors!.push(message);
                const guardError = error instanceof GuardBlockedError ? error : null;
                const unknownCreateError = error instanceof UnknownCreateOutcomeError ? error : null;
                const knownNotCreatedError = error instanceof KnownNotCreatedError ? error : null;
                const persistenceError = error instanceof ProgressPersistenceError ? error : null;
                const retryable = !guardError
                    && !unknownCreateError
                    && !persistenceError
                    && (!knownNotCreatedError || knownNotCreatedError.retryable)
                    && !isFinalAttempt;
                if (guardError) {
                    aborted = guardError;
                    checkpoint.errorCode = guardError.blockerCode;
                }
                else if (unknownCreateError) {
                    checkpoint.errorCode = unknownCreateError.blockerCode;
                    reconciliationBlocked = unknownCreateError;
                }
                else if (knownNotCreatedError) {
                    checkpoint.errorCode = knownNotCreatedError.blockerCode;
                }
                else if (persistenceError) {
                    checkpoint.errorCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
                }
                else {
                    checkpoint.errorCode = 'LINGXING_COLLECTION_STEP_FAILED';
                }
                const verifiedDownloadProgressFailed = Boolean(persistenceError
                    && checkpoint.state === 'downloaded'
                    && file.status === 'downloaded'
                    && file.filePath
                    && checkpoint.fileSizeBytes !== undefined);
                if (verifiedDownloadProgressFailed) {
                    checkpoint.detail = pathFreeDetail(`${pathFreeDetail(message)}；文件已校验完成，禁止自动重复下载，需由 Main 从已验证文件恢复。`);
                    checkpoint.updatedAt = isoNow();
                    file.errorMessage = undefined;
                    file.updatedAt = checkpoint.updatedAt;
                    reportCompleted = true;
                    break;
                }
                if (retryable) {
                    const recoveryState: LingxingCollectionReportState = readyConfirmed
                        ? 'ready'
                        : createdReportIdentity
                            ? 'created'
                            : 'failed';
                    try {
                        await updateReport(checkpoint, file, recoveryState, `${pathFreeDetail(message)}；将从最近确定状态重试，不会重复创建已确认报表。`);
                    }
                    catch (progressError) {
                        checkpoint.errorCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
                        file.errorMessage = errorMessage(progressError);
                        file.attemptErrors!.push(file.errorMessage);
                        progressSinkFailed = true;
                        break;
                    }
                    continue;
                }
                let terminalGuardError = guardError;
                if (traceStarted && !terminalGuardError && !persistenceError) {
                    try {
                        await guardExternalStep('stop_trace', report.type, attempt, createdReportIdentity);
                        tracePath = await options.automation.stopAttemptTrace?.(report, { start: options.dateStart, end: options.dateEnd }, attempt, true);
                    }
                    catch (traceError) {
                        if (traceError instanceof GuardBlockedError) {
                            terminalGuardError = traceError;
                        }
                        else {
                            file.traceUnavailableReason = `停止 Trace 失败：${errorMessage(traceError)}`;
                        }
                    }
                    traceStarted = false;
                }
                if (!terminalGuardError
                    && !persistenceError
                    && options.automation.captureFailureEvidence) {
                    try {
                        await guardExternalStep('capture_failure_evidence', report.type, attempt, createdReportIdentity);
                        const evidence = await options.automation.captureFailureEvidence(report, { start: options.dateStart, end: options.dateEnd }, file.attemptErrors!);
                        file.failureScreenshotPath = evidence?.screenshotPath;
                        file.failureDomSnapshotPath = evidence?.domSnapshotPath;
                        file.failureTracePath = tracePath ?? evidence?.tracePath;
                        file.traceUnavailableReason = file.traceUnavailableReason ?? evidence?.traceUnavailableReason;
                    }
                    catch (evidenceError) {
                        if (evidenceError instanceof GuardBlockedError) {
                            terminalGuardError = evidenceError;
                        }
                        else {
                            file.traceUnavailableReason = file.traceUnavailableReason
                                ?? `采集失败证据失败：${errorMessage(evidenceError)}`;
                        }
                    }
                }
                if (terminalGuardError && terminalGuardError !== guardError) {
                    aborted = terminalGuardError;
                    file.attemptErrors!.push(terminalGuardError.message);
                    if (!unknownCreateError) {
                        checkpoint.errorCode = terminalGuardError.blockerCode;
                        file.errorMessage = terminalGuardError.message;
                    }
                }
                const terminalState: LingxingCollectionReportState = unknownCreateError
                    ? 'create_unknown'
                    : terminalGuardError
                        ? terminalGuardError.state
                        : 'failed';
                checkpoint.state = terminalState;
                checkpoint.detail = pathFreeDetail(unknownCreateError
                    ? message
                    : terminalGuardError?.message ?? message);
                checkpoint.updatedAt = isoNow();
                file.status = 'failed';
                file.updatedAt = checkpoint.updatedAt;
                if (!progressSinkFailed) {
                    try {
                        await emitProgress(report.type);
                    }
                    catch {
                        progressSinkFailed = true;
                    }
                }
                break;
            }
        }
        if (!reportCompleted && file.status !== 'failed') {
            file.status = 'failed';
            checkpoint.state = 'failed';
            checkpoint.updatedAt = isoNow();
        }
        files.push(file);
        if (aborted || progressSinkFailed || reconciliationBlocked)
            break;
    }
    const failedCount = files.filter((file) => file.status === 'failed').length;
    const completedAt = isoNow();
    if (reconciliationBlocked) {
        job.state = 'failed';
        job.blockerCode = reconciliationBlocked.blockerCode;
        job.detail = `${pathFreeDetail(reconciliationBlocked.message)}；必须先人工核对领星下载中心，未核对前不会继续后续报表。`;
        batch.status = 'failed';
    }
    else if (aborted) {
        job.state = aborted.state;
        job.blockerCode = aborted.blockerCode;
        job.detail = pathFreeDetail(aborted.message);
        batch.status = 'failed';
    }
    else if (progressSinkFailed) {
        job.state = 'failed';
        job.blockerCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
        job.detail = '阶段进度无法持久化，任务已停止且不会盲目重复创建。';
        batch.status = 'failed';
    }
    else {
        job.state = failedCount === 0
            ? 'completed'
            : failedCount === files.length
                ? 'failed'
                : 'completed_with_errors';
        batch.status = job.state === 'completed'
            ? 'completed'
            : job.state === 'completed_with_errors'
                ? 'completed_with_errors'
                : 'failed';
    }
    job.completedAt = completedAt;
    job.updatedAt = completedAt;
    batch.completedAt = completedAt;
    const manifestAllowed = !aborted && !progressSinkFailed;
    let manifestWritten = false;
    if (manifestAllowed) {
        try {
            await guardExternalStep('write_manifest');
            const manifestJob = snapshotJob(job);
            const manifestPath = writeManifest(batch, files, manifestJob);
            if (!manifestPath || !String(manifestPath).trim()) {
                throw new Error('manifest writer returned no path');
            }
            batch.manifestPath = manifestPath;
            manifestWritten = true;
        }
        catch (error) {
            if (error instanceof GuardBlockedError) {
                if (!reconciliationBlocked) {
                    job.state = error.state;
                    job.blockerCode = error.blockerCode;
                    job.detail = pathFreeDetail(error.message);
                }
            }
            else if (!reconciliationBlocked) {
                job.state = 'failed';
                job.blockerCode = 'LINGXING_COLLECTION_MANIFEST_WRITE_FAILED';
                job.detail = pathFreeDetail(`采集 manifest 写入失败：${errorMessage(error)}`);
            }
            batch.status = 'failed';
            batch.manifestPath = undefined;
        }
    }
    if (!manifestWritten && !progressSinkFailed) {
        try {
            await emitProgress();
        }
        catch (error) {
            job.state = 'failed';
            job.blockerCode = 'LINGXING_COLLECTION_PROGRESS_NOT_DURABLE';
            job.detail = pathFreeDetail(errorMessage(error));
            batch.status = 'failed';
            progressSinkFailed = true;
        }
    }
    const finalJob = snapshotJob(job);
    return { batch, files, job: finalJob };
}
