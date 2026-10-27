// 职责模块保留原有公开接口及安全校验边界。
import * as path from 'path';
import { normalizeStoreContextEnvelope, type LingxingCollectionExternalStep, type LingxingCollectionGuardContext, type LingxingCollectionGuardDecision, type LingxingCollectionJobSnapshot, type LingxingCollectionProgressEvent, type LingxingCollectionReportCheckpoint, type LingxingCollectionReportState, type LingxingCollectionRequestDto, type LingxingCollectionResumeState, type LingxingCreateReportOutcome, type LingxingCreatedReportIdentity, type LingxingReportBatch, type LingxingReportDefinition, type LingxingReportFile, type LingxingReportType, type StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type LingxingInPlaceResumeState, type MutableCollectionJob } from './batch-runner-contracts';
import { containsUnsafeIdentityText } from './batch-runner-values';

export function isInPlaceResumeState(value: LingxingCollectionResumeState | LingxingInPlaceResumeState | undefined): value is LingxingInPlaceResumeState {
    return Boolean(value
        && 'job' in value
        && 'batch' in value
        && 'files' in value
        && Array.isArray(value.files));
}

export function cloneReportFile(file: LingxingReportFile): LingxingReportFile {
    return {
        ...file,
        ...(file.attemptErrors ? { attemptErrors: [...file.attemptErrors] } : {}),
    };
}

export function assertPathWithin(rootPath: string, candidatePath: string, label: string): void {
    const root = path.resolve(rootPath);
    const candidate = path.resolve(candidatePath);
    const relative = path.relative(root, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`${label} must remain inside the authorized store download root`);
    }
}

export function cloneCreatedIdentity(identity: LingxingCreatedReportIdentity): LingxingCreatedReportIdentity {
    return { ...identity };
}

export function cloneCheckpoint(checkpoint: LingxingCollectionReportCheckpoint): LingxingCollectionReportCheckpoint {
    return {
        ...checkpoint,
        ...(checkpoint.createdReportIdentity
            ? { createdReportIdentity: cloneCreatedIdentity(checkpoint.createdReportIdentity) }
            : {}),
    };
}

export function cloneRequest(request: LingxingCollectionRequestDto): LingxingCollectionRequestDto {
    return {
        ...request,
        storeContext: { ...request.storeContext },
        reportTypes: [...request.reportTypes],
    };
}

export function snapshotJob(job: MutableCollectionJob): LingxingCollectionJobSnapshot {
    return {
        ...job,
        request: cloneRequest(job.request),
        reports: job.reports.map(cloneCheckpoint),
    };
}

export function normalizeCreatedIdentity(value: LingxingCreatedReportIdentity, reportType: LingxingReportType, dateStart: string, dateEnd: string): LingxingCreatedReportIdentity {
    if (!value || typeof value !== 'object') {
        throw new Error('create result did not include a report identity');
    }
    const externalReportName = String(value.externalReportName || '').trim();
    const createdAt = String(value.createdAt || '').trim();
    if (value.provider !== 'lingxing'
        || value.reportType !== reportType
        || value.dateStart !== dateStart
        || value.dateEnd !== dateEnd
        || !externalReportName
        || externalReportName.length > 320
        || containsUnsafeIdentityText(externalReportName)
        || !createdAt
        || Number.isNaN(Date.parse(createdAt))) {
        throw new Error('create result returned an invalid or mismatched report identity');
    }
    const externalReportId = value.externalReportId === undefined
        ? undefined
        : String(value.externalReportId).trim();
    if (value.externalReportId !== undefined
        && (!externalReportId
            || externalReportId.length > 320
            || containsUnsafeIdentityText(externalReportId))) {
        throw new Error('create result returned an invalid external report id');
    }
    return Object.freeze({
        provider: 'lingxing' as const,
        reportType,
        externalReportName,
        ...(externalReportId ? { externalReportId } : {}),
        dateStart,
        dateEnd,
        createdAt: new Date(createdAt).toISOString(),
    });
}
