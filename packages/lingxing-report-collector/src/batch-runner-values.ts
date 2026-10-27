// 职责模块保留原有公开接口及安全校验边界。
import { normalizeStoreContextEnvelope, type LingxingCollectionExternalStep, type LingxingCollectionGuardContext, type LingxingCollectionGuardDecision, type LingxingCollectionJobSnapshot, type LingxingCollectionProgressEvent, type LingxingCollectionReportCheckpoint, type LingxingCollectionReportState, type LingxingCollectionRequestDto, type LingxingCollectionResumeState, type LingxingCreateReportOutcome, type LingxingCreatedReportIdentity, type LingxingReportBatch, type LingxingReportDefinition, type LingxingReportFile, type LingxingReportType, type StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from './report-types';
import { UnknownCreateOutcomeError, KnownNotCreatedError } from './batch-runner-contracts';

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function pathFreeDetail(value: unknown): string {
    return String(value ?? '')
        .slice(0, 2000)
        .replace(/[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path-redacted]')
        .replace(/\\\\[^\s"'<>]+/g, '[local-path-redacted]')
        .replace(/\/(?:Users|home|tmp|var|opt|mnt)\/[^\s"'<>]*/g, '[local-path-redacted]')
        .replace(/\b(password|passwd|cookie|token|secret|authorization)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]')
        .replace(/(https?:\/\/)([^/\s@]+)@/gi, '$1[userinfo-redacted]@');
}

export function containsUnsafeIdentityText(value: string): boolean {
    return /[\u0000-\u001F\u007F]/.test(value) || pathFreeDetail(value) !== value;
}

export function normalizeBlockerCode(value: unknown, fallback: string): string {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z0-9][A-Z0-9_.:-]{0,127}$/.test(normalized) ? normalized : fallback;
}

export function validateRequestId(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
        throw new Error('requestId must contain 1-128 safe identifier characters');
    }
    return normalized;
}

export function validateStoreDisplayName(value: string): string {
    const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (!normalized
        || normalized.length > 160
        || containsUnsafeIdentityText(normalized)) {
        throw new Error('storeDisplayName must be a safe non-empty display label of at most 160 characters');
    }
    return normalized;
}

export function validateDateRange(dateStart: string, dateEnd: string): void {
    const validIsoDate = (value: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
            return false;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (!validIsoDate(dateStart) || !validIsoDate(dateEnd) || dateStart > dateEnd) {
        throw new Error('dateStart and dateEnd must be a valid ascending YYYY-MM-DD range');
    }
}

export function selectReports(reportTypes?: readonly LingxingReportType[]): LingxingReportDefinition[] {
    if (reportTypes && reportTypes.length === 0) {
        throw new Error('reportTypes must be omitted for a full batch or contain at least one report type');
    }
    if (!reportTypes)
        return [...LINGXING_AD_REPORTS];
    const requested = new Set(reportTypes);
    if (requested.size !== reportTypes.length) {
        throw new Error(`Duplicate Lingxing report type in retry batch: ${reportTypes.join(', ')}`);
    }
    const selected = LINGXING_AD_REPORTS.filter((report) => requested.has(report.type));
    if (selected.length !== reportTypes.length) {
        throw new Error(`Unknown Lingxing report type in retry batch: ${reportTypes.join(', ')}`);
    }
    return selected;
}

export function storeContextKey(context: StoreContextEnvelope): string {
    return [
        context.storeId,
        context.browserProfileId,
        context.marketplace,
        context.currency,
        context.businessTimezone,
        context.businessDate,
        context.sessionGeneration,
    ].join('|');
}

export function stableStoreContextKey(context: StoreContextEnvelope): string {
    return [
        context.storeId,
        context.browserProfileId,
        context.marketplace,
        context.currency,
        context.businessTimezone,
        context.businessDate,
    ].join('|');
}

export function stableJsonForIdentity(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stableJsonForIdentity).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, child]) => child !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJsonForIdentity(child)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function legacyStatusForState(state: LingxingCollectionReportState): LingxingReportFile['status'] {
    if (state === 'queued')
        return 'pending';
    if (state === 'creating')
        return 'creating';
    if (state === 'created')
        return 'created';
    if (state === 'waiting_ready')
        return 'generating';
    if (state === 'ready')
        return 'ready';
    if (state === 'downloading' || state === 'verifying')
        return 'downloading';
    if (state === 'downloaded')
        return 'downloaded';
    return 'failed';
}

export function createOutcomeError(outcome: unknown): Error {
    if (!outcome || typeof outcome !== 'object') {
        return new UnknownCreateOutcomeError('LINGXING_CREATE_OUTCOME_INVALID', 'Lingxing report creation returned no confirmed outcome');
    }
    const candidate = outcome as Partial<Exclude<LingxingCreateReportOutcome, {
        status: 'created';
    }>>;
    if (candidate.status === 'unknown') {
        return new UnknownCreateOutcomeError(normalizeBlockerCode(candidate.blockerCode, 'LINGXING_CREATE_OUTCOME_UNKNOWN'), candidate.detail || 'Lingxing report creation outcome is unknown');
    }
    if (candidate.status === 'not_created' && typeof candidate.retryable === 'boolean') {
        return new KnownNotCreatedError(candidate.retryable, normalizeBlockerCode(candidate.blockerCode, 'LINGXING_REPORT_NOT_CREATED'), candidate.detail || 'Lingxing confirmed that the report was not created');
    }
    return new UnknownCreateOutcomeError('LINGXING_CREATE_OUTCOME_INVALID', 'Lingxing report creation returned an invalid or unsupported outcome');
}
