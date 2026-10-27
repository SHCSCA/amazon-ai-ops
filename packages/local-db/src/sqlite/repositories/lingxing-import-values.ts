import { createHash, randomBytes } from 'crypto';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_COLLECTION_IMPORT_STATES, normalizeLingxingCollectionStoreName, normalizeStoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type AmountReconciliation, COMPLETE_LINGXING_REPORT_TYPES } from './lingxing-import-contracts';

export function reconcileUsdAmount(expected: number, actual: number, tolerance = 0.01): AmountReconciliation {
    const expectedAmount1e4 = amountTo1e4(expected, 'expected');
    const actualAmount1e4 = amountTo1e4(actual, 'actual');
    const tolerance1e4 = amountTo1e4(tolerance, 'tolerance');
    const absoluteDelta1e4 = Math.abs(actualAmount1e4 - expectedAmount1e4);
    return {
        expectedAmount1e4,
        actualAmount1e4,
        absoluteDelta1e4,
        tolerance1e4,
        withinTolerance: absoluteDelta1e4 <= tolerance1e4,
    };
}

export function sameCompleteLingxingReportTypeSet(value: unknown): value is LingxingReportType[] {
    return Array.isArray(value)
        && value.length === COMPLETE_LINGXING_REPORT_TYPES.size
        && new Set(value).size === COMPLETE_LINGXING_REPORT_TYPES.size
        && value.every((reportType) => (typeof reportType === 'string'
            && COMPLETE_LINGXING_REPORT_TYPES.has(reportType as LingxingReportType)));
}

export function canonicalIsoDate(value: unknown, label: string): string {
    const text = requiredText(value, label);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)
        || !Number.isFinite(Date.parse(`${text}T00:00:00.000Z`))
        || new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) !== text) {
        throw new Error(`${label} 必须是规范 YYYY-MM-DD。`);
    }
    return text;
}

export function isCanonicalUtcInstant(value: unknown): value is string {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && Number.isFinite(new Date(value).getTime())
        && new Date(value).toISOString() === value;
}

export function canonicalUtcInstant(value: unknown, label: string): string {
    if (!isCanonicalUtcInstant(value)) {
        throw new Error(`${label} 必须是规范 ISO-8601 UTC 时间戳。`);
    }
    return value;
}

export function canonicalMonotonicAfter(requestedValue: unknown, floorValue: unknown, label: string): string {
    const requested = canonicalUtcInstant(requestedValue, label);
    const floor = canonicalUtcInstant(floorValue, `${label} floor`);
    return new Date(Math.max(Date.parse(requested), Date.parse(floor) + 1)).toISOString();
}

export function latestCanonicalInstant(values: readonly unknown[], label: string): string {
    if (values.length === 0)
        throw new Error(`${label} 至少需要一个时间戳。`);
    return values.map((value, index) => canonicalUtcInstant(value, `${label}[${index}]`))
        .reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
}

export function requiredSha256(value: unknown, label: string): string {
    const text = requiredText(value, label).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(text))
        throw new Error(`${label} 必须是 SHA-256。`);
    return text;
}

export function parseRequiredJson<T>(value: string, label: string): T {
    try {
        return JSON.parse(value) as T;
    }
    catch {
        throw new Error(`${label} JSON 已损坏。`);
    }
}

export function cloneCollectionCheckpoint(checkpoint: LingxingCollectionReportCheckpoint): LingxingCollectionReportCheckpoint {
    return {
        ...checkpoint,
        ...(checkpoint.createdReportIdentity
            ? { createdReportIdentity: { ...checkpoint.createdReportIdentity } }
            : {}),
    };
}

export function safeResumeIdentifier(value: unknown, label: string): string {
    const normalized = requiredText(value, label);
    if (!/^[A-Za-z0-9._:-]{1,180}$/.test(normalized)) {
        throw new Error(`${label} 必须是安全标识符。`);
    }
    return normalized;
}

export function sha256Text(value: unknown, label: string): string {
    const normalized = requiredText(value, label).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error(`${label} 必须是 sha256 hex。`);
    }
    return normalized;
}

export function hashOpaqueClaimToken(value: unknown): string {
    return createHash('sha256')
        .update(requiredText(value, 'claimToken'))
        .digest('hex');
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function compareByStableJson(left: unknown, right: unknown): number {
    return stableJson(left).localeCompare(stableJson(right));
}

export function stableJson(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, child]) => child !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function amountTo1e4(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0)
        throw new Error(`${label} amount must be a non-negative finite number.`);
    const scaled = Math.round(value * 10000);
    if (!Number.isSafeInteger(scaled))
        throw new Error(`${label} amount is outside the supported range.`);
    return scaled;
}

export function stableId(prefix: string, ...parts: string[]): string {
    const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
    return `${prefix}_${digest}`;
}

export function requiredText(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${label} 不能为空。`);
    return value.trim();
}

export function pathFreeText(value: string): string {
    return value
        .replace(/[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path-redacted]')
        .replace(/\\\\[^\s"'<>]+/g, '[local-path-redacted]')
        .replace(/\/(?:Users|home|tmp|var|opt|mnt)\/[^\s"'<>]*/g, '[local-path-redacted]');
}

export function normalizeBatchStoreName(value: unknown, label: string): string {
    try {
        const normalized = normalizeLingxingCollectionStoreName(value);
        if (normalized)
            return normalized;
    }
    catch {
    }
    throw new Error(`${label} 无效。`);
}

export function boundedPositiveInteger(value: number, fallback: number, max: number): number {
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(1, Math.min(Math.trunc(value), max));
}

export function parseJsonArray(value: unknown): string[] {
    if (typeof value !== 'string')
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
        return [];
    }
}
