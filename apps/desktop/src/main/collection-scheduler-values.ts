import {
  normalizeStoreContextEnvelope,
  type LingxingReportType,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAuthorityReadback,
} from './store-collection-orchestrator';
import {
  FULL_REPORT_TYPES,
  FULL_REPORT_TYPE_SET,
} from "./collection-scheduler-constants";

export function cloneExactAuthority(value: StoreCollectionAuthorityReadback): StoreCollectionAuthorityReadback {
  if (!value || (value.activeStoreId !== null && typeof value.activeStoreId !== 'string')) {
    throw new Error('scheduler authority readback 无效。');
  }
  if (value.activeStoreId === null) {
    if (value.context !== null) throw new Error('null scheduler authority 不能携带 context。');
    return { activeStoreId: null, context: null };
  }
  if (!value.context) throw new Error('active scheduler authority 缺少 context。');
  const context = normalizeStoreContextEnvelope(value.context);
  if (context.storeId !== value.activeStoreId) {
    throw new Error('scheduler authority store/context 不一致。');
  }
  return { activeStoreId: value.activeStoreId, context };
}

export function assertUsStoreContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new Error('scheduler 第一版只接受 US/USD/America/Los_Angeles。');
  }
}

export function sameContext(left: StoreContextEnvelope, right: StoreContextEnvelope): boolean {
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

export function sameFullReportSet(values: readonly LingxingReportType[]): boolean {
  return Array.isArray(values)
    && values.length === FULL_REPORT_TYPES.length
    && new Set(values).size === FULL_REPORT_TYPES.length
    && values.every((value) => FULL_REPORT_TYPE_SET.has(value));
}

export function isTerminalJobState(value: unknown): boolean {
  return value === 'completed'
    || value === 'completed_with_errors'
    || value === 'failed'
    || value === 'cancelled'
    || value === 'stale_authority';
}

export function requiredNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

export function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

export function optionalIsoInstant(value: unknown): boolean {
  return value === undefined || isIsoInstant(value);
}

export function inclusiveUtcDays(dateStart: string, dateEnd: string): number {
  const start = Date.parse(`${dateStart}T00:00:00.000Z`);
  const end = Date.parse(`${dateEnd}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
