import type { Database } from 'better-sqlite3';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_COLLECTION_IMPORT_STATES, normalizeLingxingCollectionStoreName, normalizeStoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { TERMINAL_COLLECTION_REPORT_STATES, type StoreAuthority, COMPLETE_LINGXING_REPORT_TYPES, TERMINAL_COLLECTION_JOB_STATES, type LingxingCollectionAuthorityProof } from './lingxing-import-contracts';
import { pathFreeText, requiredText, parseRequiredJson, stableJson, isCanonicalUtcInstant } from './lingxing-import-values';

export function cancelledCollectionJobSnapshot(job: LingxingCollectionJobSnapshot, options: {
    completedAt?: string;
    blockerCode: string;
    detail: string;
}): LingxingCollectionJobSnapshot {
    const latestKnownAt = [job.updatedAt, ...job.reports.map((checkpoint) => checkpoint.updatedAt)]
        .reduce((latest, candidate) => (Date.parse(candidate) > Date.parse(latest) ? candidate : latest), job.updatedAt);
    const completedAt = nextCancellationTimestamp(latestKnownAt, options.completedAt);
    const checkpoints = new Map(job.reports.map((checkpoint) => [checkpoint.reportType, checkpoint]));
    const reports = job.request.reportTypes.map((reportType) => {
        const checkpoint = checkpoints.get(reportType);
        if (checkpoint && TERMINAL_COLLECTION_REPORT_STATES.has(checkpoint.state)) {
            return checkpoint;
        }
        return {
            reportType,
            state: 'cancelled' as const,
            attemptIndex: checkpoint?.attemptIndex ?? 0,
            autoRetryCount: checkpoint?.autoRetryCount ?? 0,
            ...(checkpoint?.createdReportIdentity
                ? { createdReportIdentity: checkpoint.createdReportIdentity }
                : {}),
            ...(checkpoint?.fileSizeBytes !== undefined
                ? { fileSizeBytes: checkpoint.fileSizeBytes }
                : {}),
            errorCode: options.blockerCode,
            detail: options.detail,
            updatedAt: completedAt,
        };
    });
    const cancelled: LingxingCollectionJobSnapshot = {
        ...job,
        state: 'cancelled',
        reports,
        updatedAt: completedAt,
        completedAt,
        blockerCode: options.blockerCode,
        detail: options.detail,
        importState: 'not_applicable',
    };
    delete cancelled.importAttemptedAt;
    delete cancelled.importCompletedAt;
    delete cancelled.importError;
    return cancelled;
}

export function nextCancellationTimestamp(previous: string, requested?: string): string {
    const previousMs = Date.parse(previous);
    const requestedMs = requested === undefined ? Date.now() : Date.parse(requested);
    if (!Number.isFinite(requestedMs)) {
        throw new Error('取消采集 completedAt 无效。');
    }
    const nextMs = Number.isFinite(previousMs)
        ? Math.max(requestedMs, previousMs + 1)
        : requestedMs;
    return new Date(nextMs).toISOString();
}

export function normalizeCollectionJobSnapshot(snapshot: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
    const context = normalizeStoreContextEnvelope(snapshot.request.storeContext);
    const reports = snapshot.reports.map((checkpoint) => ({
        reportType: checkpoint.reportType,
        state: checkpoint.state,
        attemptIndex: checkpoint.attemptIndex,
        autoRetryCount: checkpoint.autoRetryCount,
        ...(checkpoint.createdReportIdentity ? {
            createdReportIdentity: {
                provider: checkpoint.createdReportIdentity.provider,
                reportType: checkpoint.createdReportIdentity.reportType,
                externalReportName: checkpoint.createdReportIdentity.externalReportName,
                ...(checkpoint.createdReportIdentity.externalReportId
                    ? { externalReportId: checkpoint.createdReportIdentity.externalReportId }
                    : {}),
                dateStart: checkpoint.createdReportIdentity.dateStart,
                dateEnd: checkpoint.createdReportIdentity.dateEnd,
                createdAt: checkpoint.createdReportIdentity.createdAt,
            },
        } : {}),
        ...(checkpoint.fileSizeBytes !== undefined ? { fileSizeBytes: checkpoint.fileSizeBytes } : {}),
        ...(checkpoint.errorCode ? { errorCode: pathFreeText(checkpoint.errorCode) } : {}),
        ...(checkpoint.detail ? { detail: pathFreeText(checkpoint.detail) } : {}),
        updatedAt: checkpoint.updatedAt,
    })) as LingxingCollectionReportCheckpoint[];
    return {
        jobId: requiredText(snapshot.jobId, 'jobId'),
        request: {
            requestId: requiredText(snapshot.request.requestId, 'requestId'),
            storeContext: context,
            dateStart: requiredText(snapshot.request.dateStart, 'dateStart'),
            dateEnd: requiredText(snapshot.request.dateEnd, 'dateEnd'),
            mode: snapshot.request.mode,
            reportTypes: [...snapshot.request.reportTypes],
        },
        ...(snapshot.lineage ? {
            lineage: {
                lineageId: requiredText(snapshot.lineage.lineageId, 'lineageId'),
                rootJobId: requiredText(snapshot.lineage.rootJobId, 'rootJobId'),
                ...(snapshot.lineage.parentJobId
                    ? { parentJobId: requiredText(snapshot.lineage.parentJobId, 'parentJobId') }
                    : {}),
                expectedReportTypes: [...snapshot.lineage.expectedReportTypes],
                purpose: snapshot.lineage.purpose,
            },
        } : {}),
        state: snapshot.state,
        reports,
        createdAt: requiredText(snapshot.createdAt, 'createdAt'),
        updatedAt: requiredText(snapshot.updatedAt, 'updatedAt'),
        ...(snapshot.completedAt ? { completedAt: snapshot.completedAt } : {}),
        ...(snapshot.blockerCode ? { blockerCode: pathFreeText(snapshot.blockerCode) } : {}),
        ...(snapshot.detail ? { detail: pathFreeText(snapshot.detail) } : {}),
        ...(snapshot.importState ? { importState: snapshot.importState } : {}),
        ...(snapshot.importAttemptedAt
            ? { importAttemptedAt: requiredText(snapshot.importAttemptedAt, 'importAttemptedAt') }
            : {}),
        ...(snapshot.importCompletedAt
            ? { importCompletedAt: requiredText(snapshot.importCompletedAt, 'importCompletedAt') }
            : {}),
        ...(snapshot.importError ? { importError: pathFreeText(snapshot.importError) } : {}),
    };
}

export function validateCollectionJobSnapshot(storeId: StoreId, authority: StoreAuthority, snapshot: LingxingCollectionJobSnapshot): void {
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(snapshot.jobId))
        throw new Error('采集 jobId 无效。');
    if (snapshot.lineage) {
        const safeId = (value: string) => /^[A-Za-z0-9._-]{1,180}$/.test(value);
        const expectedTypes = new Set(snapshot.lineage.expectedReportTypes);
        if (!safeId(snapshot.lineage.lineageId)
            || !safeId(snapshot.lineage.rootJobId)
            || (snapshot.lineage.parentJobId !== undefined && !safeId(snapshot.lineage.parentJobId))
            || expectedTypes.size !== COMPLETE_LINGXING_REPORT_TYPES.size
            || [...COMPLETE_LINGXING_REPORT_TYPES].some((reportType) => !expectedTypes.has(reportType))
            || snapshot.request.reportTypes.some((reportType) => !expectedTypes.has(reportType))
            || !['production_full', 'resume', 'retry'].includes(snapshot.lineage.purpose)) {
            throw new Error('采集 lineage 无效或不包含完整八类报表授权范围。');
        }
    }
    const context = snapshot.request.storeContext;
    if (String(context.storeId) !== String(storeId)
        || String(context.browserProfileId) !== authority.browserProfileId
        || context.marketplace !== authority.marketplace
        || context.currency !== authority.currency
        || context.businessTimezone !== authority.businessTimezone)
        throw new Error('采集快照 StoreContext 与店铺权威记录不一致。');
    if (!Number.isSafeInteger(Number(context.sessionGeneration)) || Number(context.sessionGeneration) < 0) {
        throw new Error('采集快照 sessionGeneration 无效。');
    }
    if (snapshot.importState
        && !LINGXING_COLLECTION_IMPORT_STATES.includes(snapshot.importState)) {
        throw new Error('采集快照 importState 无效。');
    }
    if (snapshot.importState
        && snapshot.importState !== 'not_applicable'
        && snapshot.state !== 'completed'
        && snapshot.state !== 'completed_with_errors') {
        throw new Error('只有下载终态任务可以进入指标导入生命周期。');
    }
    if (snapshot.importState === 'succeeded' && !snapshot.importCompletedAt) {
        throw new Error('导入成功快照必须包含 importCompletedAt。');
    }
    if (snapshot.importState === 'failed' && !snapshot.importError) {
        throw new Error('导入失败快照必须包含 importError。');
    }
    const requestedTypes = new Set(snapshot.request.reportTypes);
    if (requestedTypes.size !== snapshot.request.reportTypes.length) {
        throw new Error('采集请求包含重复报表类型。');
    }
    const checkpointTypes = new Set<string>();
    for (const checkpoint of snapshot.reports) {
        if (!requestedTypes.has(checkpoint.reportType) || checkpointTypes.has(checkpoint.reportType)) {
            throw new Error('采集 checkpoint 重复或超出请求报表范围。');
        }
        checkpointTypes.add(checkpoint.reportType);
        if (!Number.isSafeInteger(checkpoint.attemptIndex) || checkpoint.attemptIndex < 0) {
            throw new Error('采集 checkpoint attemptIndex 无效。');
        }
        if (!Number.isSafeInteger(checkpoint.autoRetryCount) || checkpoint.autoRetryCount < 0) {
            throw new Error('采集 checkpoint autoRetryCount 无效。');
        }
        if (checkpoint.fileSizeBytes !== undefined
            && (!Number.isSafeInteger(checkpoint.fileSizeBytes) || checkpoint.fileSizeBytes < 0)) {
            throw new Error('采集 checkpoint fileSizeBytes 无效。');
        }
        if (checkpoint.createdReportIdentity
            && checkpoint.createdReportIdentity.reportType !== checkpoint.reportType) {
            throw new Error('采集 checkpoint 的已创建报表身份与报表类型不一致。');
        }
    }
}

export function validateCollectionLineage(database: Database, storeId: StoreId, snapshot: LingxingCollectionJobSnapshot): void {
    const lineage = snapshot.lineage;
    if (!lineage)
        return;
    const isProductionRoot = lineage.purpose === 'production_full';
    if (isProductionRoot) {
        if (lineage.lineageId !== snapshot.jobId
            || lineage.rootJobId !== snapshot.jobId
            || lineage.parentJobId !== undefined
            || snapshot.request.requestId.startsWith('canary:')
            || snapshot.request.reportTypes.length !== COMPLETE_LINGXING_REPORT_TYPES.size) {
            throw new Error('生产采集 root lineage 与完整八类任务身份不一致。');
        }
        return;
    }
    if (!lineage.parentJobId || lineage.parentJobId === snapshot.jobId) {
        throw new Error('采集 continuation lineage 缺少有效父任务。');
    }
    const parentRow = database.prepare(`
    SELECT snapshot_json AS snapshotJson
    FROM lingxing_collection_jobs
    WHERE store_id = ? AND job_id = ?
  `).get(storeId, lineage.parentJobId) as {
        snapshotJson: string;
    } | undefined;
    if (!parentRow)
        throw new Error('采集 continuation lineage 的父任务不存在于当前店铺。');
    const parent = parseRequiredJson<LingxingCollectionJobSnapshot>(parentRow.snapshotJson, '采集 lineage 父任务快照');
    const parentIsFull = parent.request.reportTypes.length === COMPLETE_LINGXING_REPORT_TYPES.size
        && [...COMPLETE_LINGXING_REPORT_TYPES].every((reportType) => parent.request.reportTypes.includes(reportType));
    const parentLineageId = parent.lineage?.lineageId ?? (parentIsFull ? parent.jobId : undefined);
    const sameCanaryClass = parent.request.requestId.startsWith('canary:')
        === snapshot.request.requestId.startsWith('canary:');
    if (!parentLineageId
        || lineage.lineageId !== parentLineageId
        || lineage.rootJobId !== parentLineageId
        || parent.request.dateStart !== snapshot.request.dateStart
        || parent.request.dateEnd !== snapshot.request.dateEnd
        || parent.request.storeContext.storeId !== snapshot.request.storeContext.storeId
        || parent.request.storeContext.marketplace !== snapshot.request.storeContext.marketplace
        || parent.request.storeContext.currency !== snapshot.request.storeContext.currency
        || !sameCanaryClass
        || JSON.stringify(parent.lineage?.expectedReportTypes ?? parent.request.reportTypes)
            !== JSON.stringify(lineage.expectedReportTypes)) {
        throw new Error('采集 continuation lineage 与父任务的店铺、日期窗或授权范围不一致。');
    }
}

export function validateCollectionTerminalIdentity(storeId: StoreId, authority: StoreAuthority, job: LingxingCollectionJobSnapshot, batch: LingxingReportBatch, files: readonly LingxingReportFile[]): void {
    validateCollectionJobSnapshot(storeId, authority, job);
    if (!TERMINAL_COLLECTION_JOB_STATES.has(job.state)) {
        throw new Error(`采集 job ${job.jobId} 尚未进入终态，拒绝 final commit。`);
    }
    if (!job.completedAt || !batch.completedAt) {
        throw new Error('终态采集 job 与批次都必须包含 completedAt。');
    }
    if (job.jobId !== batch.id)
        throw new Error('终态采集 jobId 与 batch.id 不一致。');
    if (!batch.requestId || batch.requestId !== job.request.requestId) {
        throw new Error('终态采集 requestId 与批次身份不一致。');
    }
    const context = job.request.storeContext;
    if (String(batch.storeId ?? '') !== String(context.storeId)
        || String(batch.browserProfileId ?? '') !== String(context.browserProfileId)
        || String(batch.businessDate ?? '') !== String(context.businessDate)
        || Number(batch.sessionGeneration) !== Number(context.sessionGeneration)
        || batch.marketplaceCode !== context.marketplace
        || batch.dateStart !== job.request.dateStart
        || batch.dateEnd !== job.request.dateEnd)
        throw new Error('终态采集 StoreContext、日期范围或批次身份不一致。');
    const expectedBatchStatus = job.state === 'completed'
        ? 'completed'
        : job.state === 'completed_with_errors'
            ? 'completed_with_errors'
            : 'failed';
    if (batch.status !== expectedBatchStatus) {
        throw new Error(`终态 job ${job.state} 与 batch.status ${batch.status} 不一致。`);
    }
    const requestedTypes = new Set(job.request.reportTypes);
    const checkpointTypes = new Set(job.reports.map((checkpoint) => checkpoint.reportType));
    if (checkpointTypes.size !== job.reports.length
        || checkpointTypes.size !== requestedTypes.size
        || [...requestedTypes].some((reportType) => !checkpointTypes.has(reportType))) {
        throw new Error('终态采集 checkpoint 未完整覆盖请求报表类型。');
    }
    const fileTypes = new Set(files.map((file) => file.reportType));
    if (fileTypes.size !== files.length || [...fileTypes].some((reportType) => !requestedTypes.has(reportType))) {
        throw new Error('终态采集文件重复或超出请求报表范围。');
    }
    if (job.state === 'completed' && (fileTypes.size !== requestedTypes.size
        || [...requestedTypes].some((reportType) => !fileTypes.has(reportType))
        || files.some((file) => file.status !== 'downloaded')
        || job.reports.some((checkpoint) => checkpoint.state !== 'downloaded'))) {
        throw new Error('completed 终态必须包含全部已下载报表与 checkpoint。');
    }
}

export function assertCollectionAuthorityJobRow(storeId: StoreId, requestId: string, row: LingxingCollectionAuthorityProof['jobRow'], snapshot: LingxingCollectionJobSnapshot, checkpointCount: number, checkpoints: readonly LingxingCollectionReportCheckpoint[]): void {
    const context = normalizeStoreContextEnvelope(snapshot.request.storeContext);
    const reportTypes = parseRequiredJson<unknown>(row.reportTypesJson, '采集 job SQL report_types_json');
    const sortedSnapshotCheckpoints = [...snapshot.reports]
        .sort((left, right) => String(left.reportType).localeCompare(String(right.reportType)));
    const sortedRows = [...checkpoints]
        .sort((left, right) => String(left.reportType).localeCompare(String(right.reportType)));
    if (row.storeId !== storeId
        || context.storeId !== storeId
        || row.jobId !== snapshot.jobId
        || row.requestId !== requestId
        || row.requestId !== snapshot.request.requestId
        || row.browserProfileId !== context.browserProfileId
        || row.marketplace !== context.marketplace
        || row.currency !== context.currency
        || row.businessTimezone !== context.businessTimezone
        || row.businessDate !== context.businessDate
        || row.sessionGeneration !== context.sessionGeneration
        || row.dateStart !== snapshot.request.dateStart
        || row.dateEnd !== snapshot.request.dateEnd
        || row.mode !== snapshot.request.mode
        || stableJson(reportTypes) !== stableJson(snapshot.request.reportTypes)
        || row.state !== snapshot.state
        || row.createdAt !== snapshot.createdAt
        || row.updatedAt !== snapshot.updatedAt
        || row.completedAt !== (snapshot.completedAt ?? null)
        || row.blockerCode !== (snapshot.blockerCode ?? null)
        || row.detail !== (snapshot.detail ?? null)
        || checkpointCount !== checkpoints.length
        || checkpointCount !== snapshot.reports.length
        || checkpointCount > COMPLETE_LINGXING_REPORT_TYPES.size
        || stableJson(sortedRows) !== stableJson(sortedSnapshotCheckpoints)
        || (snapshot.lineage?.purpose === 'production_full' && (snapshot.lineage.lineageId !== row.jobId
            || snapshot.lineage.rootJobId !== row.jobId
            || snapshot.lineage.parentJobId !== undefined))) {
        throw new Error('采集 authority proof 的 SQL row/snapshot/lineage/checkpoint 身份不一致。');
    }
}

export function assertCollectionAuthorityProofTimestamps(proof: LingxingCollectionAuthorityProof): void {
    const required: unknown[] = [
        proof.job.createdAt,
        proof.job.updatedAt,
        proof.jobRow.createdAt,
        proof.jobRow.updatedAt,
        ...proof.job.reports.flatMap((checkpoint) => [
            checkpoint.updatedAt,
            ...(checkpoint.createdReportIdentity
                ? [checkpoint.createdReportIdentity.createdAt]
                : []),
        ]),
        ...(proof.batch ? [proof.batch.createdAt] : []),
        ...proof.lingxingFiles.flatMap((file) => [file.createdAt, file.updatedAt]),
        ...proof.importRuns.flatMap((run) => [run.startedAt, run.completedAt, run.createdAt]),
        ...proof.importFileSnapshots.map((snapshot) => snapshot.capturedAt),
        ...proof.metricEvidence.map((evidence) => evidence.createdAt),
    ];
    const optional: unknown[] = [
        proof.job.completedAt,
        proof.job.importAttemptedAt,
        proof.job.importCompletedAt,
        proof.jobRow.completedAt,
        proof.batch?.completedAt,
        ...proof.importedReportFiles.map((file) => file.lastImportedAt),
    ];
    if (required.some((value) => !isCanonicalUtcInstant(value))
        || optional.some((value) => value !== undefined
            && value !== null
            && !isCanonicalUtcInstant(value))) {
        throw new Error('采集 authority proof 包含非规范 ISO-8601 UTC 时间戳。');
    }
    assertAuthorityTimestampOrder('job.createdAt <= job.updatedAt', proof.job.createdAt, proof.job.updatedAt);
    if (proof.job.completedAt) {
        assertAuthorityTimestampOrder('job.createdAt <= job.completedAt', proof.job.createdAt, proof.job.completedAt);
        assertAuthorityTimestampOrder('job.completedAt <= job.updatedAt', proof.job.completedAt, proof.job.updatedAt);
    }
    for (const checkpoint of proof.job.reports) {
        assertAuthorityTimestampOrder(`job.createdAt <= checkpoint.${checkpoint.reportType}.updatedAt`, proof.job.createdAt, checkpoint.updatedAt);
        assertAuthorityTimestampOrder(`checkpoint.${checkpoint.reportType}.updatedAt <= job.updatedAt`, checkpoint.updatedAt, proof.job.updatedAt);
        if (checkpoint.createdReportIdentity) {
            assertAuthorityTimestampOrder(`job.createdAt <= checkpoint.${checkpoint.reportType}.createdReportIdentity.createdAt`, proof.job.createdAt, checkpoint.createdReportIdentity.createdAt);
            assertAuthorityTimestampOrder(`checkpoint.${checkpoint.reportType}.createdReportIdentity.createdAt <= checkpoint.updatedAt`, checkpoint.createdReportIdentity.createdAt, checkpoint.updatedAt);
        }
    }
    if (proof.batch) {
        assertAuthorityTimestampOrder('job.createdAt <= batch.createdAt', proof.job.createdAt, proof.batch.createdAt);
        assertAuthorityTimestampOrder('batch.createdAt <= job.updatedAt', proof.batch.createdAt, proof.job.updatedAt);
        if (proof.batch.completedAt) {
            assertAuthorityTimestampOrder('batch.createdAt <= batch.completedAt', proof.batch.createdAt, proof.batch.completedAt);
            assertAuthorityTimestampOrder('batch.completedAt <= job.updatedAt', proof.batch.completedAt, proof.job.updatedAt);
        }
    }
    for (const file of proof.lingxingFiles) {
        assertAuthorityTimestampOrder(`lingxingFile.${file.id}.createdAt <= updatedAt`, file.createdAt, file.updatedAt);
        assertAuthorityTimestampOrder(`job.createdAt <= lingxingFile.${file.id}.createdAt`, proof.job.createdAt, file.createdAt);
        assertAuthorityTimestampOrder(`lingxingFile.${file.id}.updatedAt <= job.updatedAt`, file.updatedAt, proof.job.updatedAt);
        if (proof.batch?.completedAt) {
            assertAuthorityTimestampOrder(`lingxingFile.${file.id}.updatedAt <= batch.completedAt`, file.updatedAt, proof.batch.completedAt);
        }
    }
    if (proof.job.importAttemptedAt) {
        if (proof.job.completedAt) {
            assertAuthorityTimestampOrder('job.completedAt <= job.importAttemptedAt', proof.job.completedAt, proof.job.importAttemptedAt);
        }
        assertAuthorityTimestampOrder('job.importAttemptedAt <= job.updatedAt', proof.job.importAttemptedAt, proof.job.updatedAt);
    }
    if (proof.job.importCompletedAt) {
        if (proof.job.importAttemptedAt) {
            assertAuthorityTimestampOrder('job.importAttemptedAt <= job.importCompletedAt', proof.job.importAttemptedAt, proof.job.importCompletedAt);
        }
        assertAuthorityTimestampOrder('job.importCompletedAt <= job.updatedAt', proof.job.importCompletedAt, proof.job.updatedAt);
    }
    const runsById = new Map(proof.importRuns.map((run) => [run.runId, run]));
    for (const run of proof.importRuns) {
        assertAuthorityTimestampOrder(`importRun.${run.runId}.startedAt <= completedAt`, run.startedAt, run.completedAt);
        assertAuthorityTimestampOrder(`importRun.${run.runId}.completedAt <= createdAt`, run.completedAt, run.createdAt);
        if (proof.job.completedAt) {
            assertAuthorityTimestampOrder(`job.completedAt <= importRun.${run.runId}.startedAt`, proof.job.completedAt, run.startedAt);
        }
        if (proof.job.importAttemptedAt) {
            assertAuthorityTimestampOrder(`job.importAttemptedAt <= importRun.${run.runId}.startedAt`, proof.job.importAttemptedAt, run.startedAt);
        }
        if (proof.job.importCompletedAt) {
            assertAuthorityTimestampOrder(`importRun.${run.runId}.completedAt <= job.importCompletedAt`, run.completedAt, proof.job.importCompletedAt);
        }
    }
    for (const snapshot of proof.importFileSnapshots) {
        const run = runsById.get(snapshot.runId);
        if (!run)
            continue;
        assertAuthorityTimestampOrder(`importRun.${run.runId}.startedAt <= snapshot.${snapshot.snapshotId}.capturedAt`, run.startedAt, snapshot.capturedAt);
        assertAuthorityTimestampOrder(`snapshot.${snapshot.snapshotId}.capturedAt <= importRun.${run.runId}.completedAt`, snapshot.capturedAt, run.completedAt);
    }
    const uniqueRun = proof.importRunCount === 1 && proof.importRuns.length === 1
        ? proof.importRuns[0]
        : undefined;
    for (const file of proof.importedReportFiles) {
        if (!file.lastImportedAt)
            continue;
        if (!uniqueRun) {
            throw new Error(`采集 authority proof 时间顺序无效：importedReportFile.${file.id} 缺少唯一 import run。`);
        }
        assertAuthorityTimestampOrder(`importRun.${uniqueRun.runId}.startedAt <= importedReportFile.${file.id}.lastImportedAt`, uniqueRun.startedAt, file.lastImportedAt);
        assertAuthorityTimestampOrder(`importedReportFile.${file.id}.lastImportedAt <= importRun.${uniqueRun.runId}.completedAt`, file.lastImportedAt, uniqueRun.completedAt);
        if (proof.job.completedAt) {
            assertAuthorityTimestampOrder(`job.completedAt <= importedReportFile.${file.id}.lastImportedAt`, proof.job.completedAt, file.lastImportedAt);
        }
        if (proof.job.importCompletedAt) {
            assertAuthorityTimestampOrder(`importedReportFile.${file.id}.lastImportedAt <= job.importCompletedAt`, file.lastImportedAt, proof.job.importCompletedAt);
        }
    }
}

export function assertAuthorityTimestampOrder(label: string, earlier: string, later: string): void {
    if (Date.parse(earlier) > Date.parse(later)) {
        throw new Error(`采集 authority proof 时间顺序无效：${label}。`);
    }
}
