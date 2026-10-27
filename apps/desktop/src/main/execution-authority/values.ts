import { runtimeLogger, type RuntimeLogPort } from '../runtime-logger';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { LINGXING_KEYWORD_BID_ORIGIN, LINGXING_KEYWORD_BID_PATH } from '@amazon-ai-ops/action-executor';
import { type BrowserLease, BrowserLeaseManager } from '@amazon-ai-ops/browser-worker';
import  {
  AD_EXECUTION_RECONCILIATION_COPY,
  type AdExecutionReconciliationCase,
  type AdExecutionUnknownReconciliationResult,
  type PolicyVersionRules,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { ExecutionAuthorityShutdownError } from './errors';
export const EXECUTOR_ACTOR = 'execution-authority';
export const OPERATOR_ACTOR = 'operator';
export const POLICY_ACTOR = 'policy-engine';
export const EXECUTION_LEASE_TTL_MS = 60 * 60 * 1000;
export function canonicalPageUrl(adsAccountId: string, campaignId: string): string {
    return `${LINGXING_KEYWORD_BID_ORIGIN}${LINGXING_KEYWORD_BID_PATH}`
        + `?profile_id=${encodeURIComponent(requiredId(adsAccountId, 'adsAccountId'))}`
        + `&id=${encodeURIComponent(requiredId(campaignId, 'campaignId'))}`;
}
export function requiredId(value: unknown, field: string): string {
    const normalized = String(value ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(normalized)) {
        throw new TypeError(`${field} must be an opaque logical identifier.`);
    }
    return normalized;
}
export function requiredSha256(value: unknown, field: string): string {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new TypeError(`${field} must be a SHA-256 value.`);
    }
    return normalized;
}
export function requiredTimestamp(value: unknown, field: string): string {
    const normalized = String(value ?? '').trim();
    if (!Number.isFinite(Date.parse(normalized))
        || new Date(normalized).toISOString() !== normalized) {
        throw new TypeError(`${field} must be an ISO timestamp.`);
    }
    return normalized;
}
export function assertExecutionWindowOpen(rules: PolicyVersionRules, context: StoreContextEnvelope, now: Date): void {
    const window = rules.executionWindow;
    if (!window || window.timeZone !== context.businessTimezone
        || !Array.isArray(window.daysOfWeek)
        || typeof window.start !== 'string'
        || typeof window.end !== 'string'
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.start)
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.end)) {
        throw new Error('策略执行窗口与当前店铺业务时区不一致。');
    }
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
            timeZone: window.timeZone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(now);
    }
    catch {
        throw new Error('策略执行窗口时区无效。');
    }
    const part = (type: Intl.DateTimeFormatPartTypes): string => (parts.find((item) => item.type === type)?.value ?? '');
    const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
    const hour = Number(part('hour'));
    const minute = Number(part('minute'));
    const start = wallClockMinutes(window.start);
    const end = wallClockMinutes(window.end);
    const current = (hour * 60) + minute;
    if (dayOfWeek < 0 || !Number.isSafeInteger(hour) || !Number.isSafeInteger(minute)
        || start >= end || !window.daysOfWeek.includes(dayOfWeek)
        || current < start || current >= end) {
        throw new Error('当前不在策略允许的执行窗口内。');
    }
}
export function wallClockMinutes(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return (hour * 60) + minute;
}
export async function waitForExecutionAuthorityDrain(operations: readonly Promise<unknown>[], timeoutMs: number): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Object.freeze({});
    try {
        const result = await Promise.race<Readonly<object>>([
            Promise.allSettled(operations).then(() => Object.freeze({})),
            new Promise<Readonly<object>>((resolve) => {
                timeout = setTimeout(() => resolve(timedOut), timeoutMs);
            }),
        ]);
        if (result === timedOut) {
            throw new ExecutionAuthorityShutdownError(timeoutMs);
        }
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
export function normalizePolicyDispatchRetryMs(value: number | undefined): number {
    if (value === undefined)
        return 60000;
    if (!Number.isSafeInteger(value) || value < 1 || value > 24 * 60 * 60 * 1000) {
        throw new TypeError('policyDispatchRetryMs must be an integer between 1ms and 24h.');
    }
    return value;
}
export function safeReason(value: unknown): string {
    const normalized = String(value ?? '')
        .replace(/\b[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path]')
        .replace(/\\\\[^\\/\s"'<>]+[\\/][^\s"'<>]*/g, '[local-path]')
        .replace(/\bfile:(?:\/{2,}|\\{2,})[^\s"'<>]*/gi, '[local-path]')
        .replace(/\bhttps?:\/\/[^\s"'<>?#]+[^\s"'<>]*[?#][^\s"'<>]*/gi, '[url-redacted]')
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
        .replace(/\b(cookie|authorization|password|passwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
        .replace(/\b(account|profile|external_account_id|profile_id)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email-redacted]')
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, ' ');
    return (normalized || 'execution stopped by authority').slice(0, 500);
}
export function safeMessage(error: unknown, fallback = '执行协调器发生安全阻断。'): string {
    return error instanceof Error && error.message.trim()
        ? safeReason(error.message)
        : fallback;
}
export function compactId(prefix: string, values: readonly unknown[]): string {
    return `${prefix}:${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 48)}`;
}
export function sha256Text(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
export function sha256File(filePath: string): string {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
export function releaseLeaseQuietly(manager: BrowserLeaseManager, lease: BrowserLease, logger: RuntimeLogPort = runtimeLogger): void {
    try {
        manager.release(lease);
    }
    catch (error) {
        logger.warn('execution.lease_release_failed', { error });
    }
}
export function reconciliationResult(record: AdExecutionReconciliationCase): AdExecutionUnknownReconciliationResult {
    if (!record.outcome || !record.completedAt)
        throw new Error('只读对账正在进行；请等待原请求完成，禁止重复观察。');
    return { status: record.outcome, caseId: record.caseId, batchId: record.batchId, jobId: record.jobId, originalStatus: 'unknown',
        ...(record.first ? { firstObservedBidCents: record.first.observedBidCents, firstEvidenceRef: record.first.artifactRef } : {}),
        ...(record.reload ? { reloadObservedBidCents: record.reload.observedBidCents, observedBidCents: record.reload.observedBidCents, reloadEvidenceRef: record.reload.artifactRef } : {}),
        observedAt: record.completedAt, detail: AD_EXECUTION_RECONCILIATION_COPY[record.outcome] };
}
