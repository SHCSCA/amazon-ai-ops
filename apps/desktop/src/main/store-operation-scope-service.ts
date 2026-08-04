import {
  canonicalizeAmazonAsin,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';

export interface StoreOperationScope {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: 'US';
  currency: 'USD';
  asin?: string;
  batchId?: string;
}

export interface StoreOperationScopeSettings {
  get(key: string): string | null | undefined;
  set(key: string, value: string): unknown;
}

export interface StoreOperationScopeServiceOptions {
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getStore'>;
  settings: StoreOperationScopeSettings;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function operationScopeSettingKey(storeId: StoreId): string {
  return `operation_scope:${storeId}`;
}

/** Main-owned, store-keyed persistence boundary for the collection scope. */
export class StoreOperationScopeService {
  constructor(private readonly options: StoreOperationScopeServiceOptions) {}

  get(contextInput: StoreContextEnvelope): StoreOperationScope | null {
    const store = this.authorize(contextInput);
    const raw = this.options.settings.get(operationScopeSettingKey(store.storeId));
    if (!raw) return null;
    try {
      return normalizeScope(JSON.parse(raw), store);
    } catch {
      return null;
    }
  }

  save(contextInput: StoreContextEnvelope, input: unknown): StoreOperationScope {
    const store = this.authorize(contextInput);
    const scope = normalizeScope(input, store);
    this.options.settings.set(operationScopeSettingKey(store.storeId), JSON.stringify(scope));
    return scope;
  }

  private authorize(contextInput: StoreContextEnvelope): StoreRecord {
    const context = this.options.storeCoordinator.assertActiveStoreContext(contextInput);
    const store = this.options.storeCoordinator.getStore(context.storeId);
    if (context.marketplace !== 'US' || store.marketplace !== 'US') {
      throw new Error('V1 采集范围只支持 Amazon 美国站。');
    }
    if (context.currency !== 'USD' || store.currency !== 'USD') {
      throw new Error('V1 采集范围只支持 USD。');
    }
    return store;
  }
}

function normalizeScope(input: unknown, store: StoreRecord): StoreOperationScope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('运营范围必须是对象。');
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    'dateFrom', 'dateTo', 'storeName', 'marketplaceCode', 'currency', 'asin', 'batchId',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new TypeError(`运营范围包含不支持字段：${unknown.join('、')}`);

  const dateFrom = requiredText(value.dateFrom, '开始日期', 10);
  const dateTo = requiredText(value.dateTo, '结束日期', 10);
  if (!validIsoDate(dateFrom) || !validIsoDate(dateTo)) {
    throw new TypeError('运营范围日期必须是有效的 YYYY-MM-DD。');
  }
  if (dateFrom > dateTo) throw new TypeError('运营范围开始日期不能晚于结束日期。');

  const submittedStoreName = requiredText(value.storeName, '店铺', 200);
  if (normalizeIdentity(submittedStoreName) !== normalizeIdentity(store.displayName)) {
    throw new Error('运营范围店铺与当前 Main StoreContext 不一致。');
  }
  if (String(value.marketplaceCode || '').trim().toUpperCase() !== 'US') {
    throw new Error('运营范围站点与当前美国站 StoreContext 不一致。');
  }
  if (String(value.currency || '').trim().toUpperCase() !== 'USD') {
    throw new Error('运营范围币种与当前 USD StoreContext 不一致。');
  }

  const asinText = optionalText(value.asin, 'ASIN', 10);
  let asin: string | undefined;
  if (asinText) {
    try {
      asin = canonicalizeAmazonAsin(asinText);
    } catch {
      throw new TypeError('运营范围 ASIN 必须是 10 位 ASCII 字母或数字。');
    }
  }
  const batchId = optionalText(value.batchId, '批次 ID', 200);
  return {
    dateFrom,
    dateTo,
    storeName: store.displayName,
    marketplaceCode: 'US',
    currency: 'USD',
    ...(asin ? { asin } : {}),
    ...(batchId ? { batchId } : {}),
  };
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label}必须是字符串。`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new TypeError(`${label}不能为空且不能超过 ${maxLength} 个字符。`);
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new TypeError(`${label}必须是字符串。`);
  const text = value.trim();
  if (text.length > maxLength) throw new TypeError(`${label}不能超过 ${maxLength} 个字符。`);
  return text || undefined;
}

function validIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
