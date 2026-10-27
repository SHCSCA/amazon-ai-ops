import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_COLLECTION_IMPORT_STATES, normalizeLingxingCollectionStoreName, normalizeStoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type LingxingCollectionAuthorityProof, COMPLETE_LINGXING_REPORT_TYPES, type StoreScopedLingxingReportFile } from './lingxing-import-contracts';
import { sameCompleteLingxingReportTypeSet, cloneCollectionCheckpoint, requiredText, isCanonicalUtcInstant, stableJson } from './lingxing-import-values';

export function normalizeInPlaceResumeReports(proof: LingxingCollectionAuthorityProof): LingxingCollectionReportCheckpoint[] {
    if ((proof.job.state !== 'failed' && proof.job.state !== 'completed_with_errors')
        || proof.job.request.mode !== 'create-and-download'
        || !sameCompleteLingxingReportTypeSet(proof.job.request.reportTypes)
        || proof.checkpointCount !== COMPLETE_LINGXING_REPORT_TYPES.size
        || proof.job.reports.length !== COMPLETE_LINGXING_REPORT_TYPES.size) {
        throw new Error('原地续跑只接受原任务失败或部分失败的完整八报表 create-and-download 快照。');
    }
    if (!proof.batch
        || proof.batch.id !== proof.job.jobId
        || proof.batch.requestId !== proof.job.request.requestId
        || proof.batch.storeId !== proof.job.request.storeContext.storeId
        || proof.batch.browserProfileId !== proof.job.request.storeContext.browserProfileId
        || proof.batch.businessDate !== proof.job.request.storeContext.businessDate
        || proof.batch.sessionGeneration !== proof.job.request.storeContext.sessionGeneration
        || proof.batch.dateStart !== proof.job.request.dateStart
        || proof.batch.dateEnd !== proof.job.request.dateEnd) {
        throw new Error('原地续跑 job/request/batch durable identity 不一致。');
    }
    const filesByType = new Map<LingxingReportType, StoreScopedLingxingReportFile[]>();
    if (proof.lingxingFileCount !== proof.lingxingFiles.length
        || proof.lingxingFileCount > COMPLETE_LINGXING_REPORT_TYPES.size) {
        throw new Error('原地续跑 durable file rows 被截断或超过完整八报表范围。');
    }
    for (const file of proof.lingxingFiles) {
        if (file.storeId !== proof.job.request.storeContext.storeId
            || file.batchId !== proof.job.jobId
            || !COMPLETE_LINGXING_REPORT_TYPES.has(file.reportType)) {
            throw new Error('原地续跑 durable file 不属于 exact store/batch/report scope。');
        }
        const current = filesByType.get(file.reportType) ?? [];
        current.push(file);
        filesByType.set(file.reportType, current);
        if (current.length > 1) {
            throw new Error(`原地续跑 reportType ${file.reportType} 存在重复 durable file。`);
        }
    }
    return proof.job.reports.map((checkpoint) => {
        const identity = checkpoint.createdReportIdentity;
        if (identity)
            assertResumeCreatedIdentity(identity, checkpoint, proof.job);
        if (checkpoint.state === 'creating'
            || checkpoint.state === 'create_unknown'
            || checkpoint.state === 'cancelled'
            || checkpoint.state === 'stale_authority') {
            throw new Error(`checkpoint ${checkpoint.reportType}/${checkpoint.state} 禁止自动原地续跑。`);
        }
        if (checkpoint.state === 'downloaded') {
            const files = filesByType.get(checkpoint.reportType) ?? [];
            if (!identity
                || files.length !== 1
                || files[0].status !== 'downloaded'
                || !files[0].filePath
                || !Number.isSafeInteger(files[0].fileSizeBytes)
                || files[0].fileSizeBytes! <= 0
                || checkpoint.fileSizeBytes !== files[0].fileSizeBytes) {
                throw new Error(`downloaded checkpoint ${checkpoint.reportType} 缺少唯一 durable file proof。`);
            }
            return cloneCollectionCheckpoint(checkpoint);
        }
        if (checkpoint.state === 'queued') {
            if (identity)
                throw new Error('queued checkpoint 不能携带 created identity。');
            return cloneCollectionCheckpoint(checkpoint);
        }
        if (checkpoint.state === 'failed' && (checkpoint.errorCode === 'LINGXING_CREATE_CONFIRMED_ABSENT'
            || checkpoint.errorCode === 'LINGXING_CREATE_CONFIRMED_FAILED')) {
            if (identity) {
                throw new Error('已核对创建失败 checkpoint 不能携带 created identity。');
            }
            return cloneCollectionCheckpoint(checkpoint);
        }
        if (checkpoint.state === 'created' || checkpoint.state === 'ready') {
            if (!identity)
                throw new Error(`${checkpoint.state} checkpoint 必须携带 created identity。`);
            return cloneCollectionCheckpoint(checkpoint);
        }
        if (checkpoint.state === 'waiting_ready' && !identity) {
            throw new Error('waiting_ready checkpoint 缺少 created identity，拒绝猜测创建结果。');
        }
        if ((checkpoint.state === 'downloading' || checkpoint.state === 'verifying') && !identity) {
            throw new Error(`${checkpoint.state} checkpoint 缺少 created identity。`);
        }
        const normalizedState = checkpoint.state === 'downloading' || checkpoint.state === 'verifying'
            ? 'ready'
            : identity
                ? 'created'
                : 'queued';
        return {
            ...cloneCollectionCheckpoint(checkpoint),
            state: normalizedState,
            fileSizeBytes: undefined,
            errorCode: undefined,
            detail: '由 Main durable recovery 归一化，尚未执行任何浏览器动作。',
        };
    });
}

export function isFinalSucceededResumeProof(proof: LingxingCollectionAuthorityProof): boolean {
    return proof.job.state === 'completed'
        && proof.job.importState === 'succeeded'
        && proof.job.reports.length === COMPLETE_LINGXING_REPORT_TYPES.size
        && proof.job.reports.every((checkpoint) => checkpoint.state === 'downloaded')
        && proof.lingxingFileCount === COMPLETE_LINGXING_REPORT_TYPES.size
        && proof.lingxingFiles.length === COMPLETE_LINGXING_REPORT_TYPES.size
        && proof.batch?.status === 'completed'
        && proof.importRunCount === 1
        && proof.metricEvidenceCount === 1;
}

export function normalizeInterruptedResumeReports(reports: readonly LingxingCollectionReportCheckpoint[], updatedAt: string): LingxingCollectionReportCheckpoint[] {
    return reports.map((checkpoint) => {
        if (checkpoint.state === 'downloaded'
            || checkpoint.state === 'queued'
            || checkpoint.state === 'created'
            || checkpoint.state === 'ready'
            || checkpoint.state === 'create_unknown'
            || checkpoint.state === 'cancelled'
            || checkpoint.state === 'stale_authority') {
            return cloneCollectionCheckpoint(checkpoint);
        }
        if (checkpoint.state === 'creating') {
            return {
                ...cloneCollectionCheckpoint(checkpoint),
                state: 'create_unknown',
                errorCode: 'LINGXING_CREATE_OUTCOME_UNKNOWN_AFTER_RESTART',
                detail: '应用重启时创建调用尚无确定结果，必须人工核对。',
                updatedAt,
            };
        }
        const identity = checkpoint.createdReportIdentity;
        const state = checkpoint.state === 'downloading' || checkpoint.state === 'verifying'
            ? (identity ? 'ready' : 'create_unknown')
            : identity
                ? 'created'
                : 'queued';
        return {
            ...cloneCollectionCheckpoint(checkpoint),
            state,
            fileSizeBytes: state === 'queued' || state === 'created' || state === 'ready'
                ? undefined
                : checkpoint.fileSizeBytes,
            errorCode: state === 'create_unknown'
                ? 'LINGXING_CREATE_OUTCOME_UNKNOWN_AFTER_RESTART'
                : undefined,
            detail: state === 'create_unknown'
                ? '应用重启后无法证明安全恢复点，必须人工核对。'
                : '应用重启已恢复到最近可证明的安全状态，等待人工重新发起。',
            updatedAt,
        };
    });
}

export function assertResumeCreatedIdentity(identity: NonNullable<LingxingCollectionReportCheckpoint['createdReportIdentity']>, checkpoint: LingxingCollectionReportCheckpoint, job: LingxingCollectionJobSnapshot): void {
    if (identity.provider !== 'lingxing'
        || identity.reportType !== checkpoint.reportType
        || identity.dateStart !== job.request.dateStart
        || identity.dateEnd !== job.request.dateEnd
        || !requiredText(identity.externalReportName, 'created identity externalReportName')
        || !isCanonicalUtcInstant(identity.createdAt)) {
        throw new Error(`checkpoint ${checkpoint.reportType} created identity 与原请求不一致。`);
    }
}

export function assertExecutionContextCanResume(durableValue: StoreContextEnvelope, executionValue: StoreContextEnvelope): void {
    const durable = normalizeStoreContextEnvelope(durableValue);
    const execution = normalizeStoreContextEnvelope(executionValue);
    const stableDurable = {
        ...durable,
        sessionGeneration: 0,
    };
    const stableExecution = {
        ...execution,
        sessionGeneration: 0,
    };
    if (stableJson(stableDurable) !== stableJson(stableExecution)
        || execution.sessionGeneration < durable.sessionGeneration) {
        throw new Error('当前执行上下文与 durable store axes 不一致或 generation 回退。');
    }
}
