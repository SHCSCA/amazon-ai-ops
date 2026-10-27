import { rendererRuntimeLog } from '../runtime-log';
import React from 'react';
import { missionControlContextKey, type StoreCollectionScheduleProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { OperationScope } from '../types';
import { type AuthoritativeCollectionDateRange, type CollectionScheduleApi } from './collection-contracts';

export const SAFE_COLLECTION_REQUEST_PART = /[^A-Za-z0-9._:-]+/g;

export function createLingxingCollectionRequestId(
  action: string,
  now = Date.now(),
  randomToken?: string,
): string {
  const resolvedRandomToken = randomToken ?? createCollectionRandomToken();
  const safeAction = action.trim().replace(SAFE_COLLECTION_REQUEST_PART, '-').replace(/^-+|-+$/g, '') || 'action';
  const safeRandom = resolvedRandomToken.replace(SAFE_COLLECTION_REQUEST_PART, '').slice(0, 32) || 'local';
  return `lx:${safeAction}:${Math.max(0, Math.trunc(now)).toString(36)}:${safeRandom}`.slice(0, 128);
}

export function createCollectionRandomToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function buildAuthoritativeCollectionDateRange(input: {
  action: string;
  dateStart: string;
  dateEnd: string;
  storeContext: StoreContextEnvelope | null;
  storeName?: string;
  requestId?: string;
}): AuthoritativeCollectionDateRange {
  if (!input.storeContext) throw new Error('当前没有可用的店铺授权上下文，请重新选择美国站店铺。');
  if (input.storeContext.marketplace !== 'US' || input.storeContext.currency !== 'USD') {
    throw new Error('第一版仅支持美国站（US）和美元（USD）店铺。');
  }
  return {
    start: input.dateStart,
    end: input.dateEnd,
    requestId: input.requestId || createLingxingCollectionRequestId(input.action),
    storeContext: { ...input.storeContext },
    storeName: input.storeName,
    marketplaceCode: 'US',
  };
}

export function validCollectionIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function resolveAuthoritativeCollectionCapture(input: {
  action: string;
  api: CollectionScheduleApi | null | undefined;
  scope: OperationScope;
  storeContext: StoreContextEnvelope;
  storeName: string;
}): Promise<{
  authorityKey: string;
  dateRange: AuthoritativeCollectionDateRange;
  refreshScope: OperationScope;
}> {
  if (!input.api?.getStoreCollectionSchedule) {
    throw new Error('当前店铺采集窗口读取接口未就绪，请刷新应用后重试。');
  }
  let projection: StoreCollectionScheduleProjection;
  try {
    projection = await input.api.getStoreCollectionSchedule({ ...input.storeContext });
  } catch (caught) {
      rendererRuntimeLog.error('collection.collection_capture_failed', { error: caught });
    throw new Error('当前店铺采集窗口读取失败，请刷新当前店铺后重试。');
  }
  if (projection.storeId !== input.storeContext.storeId
    || projection.businessDate !== input.storeContext.businessDate) {
    throw new Error('采集窗口与当前店铺不一致，操作已阻断；请刷新当前店铺后重试。');
  }
  if (!projection.enabled) {
    throw new Error(projection.state === 'archived'
      ? '当前店铺采集计划已归档，请先在定时任务中恢复配置。'
      : '当前店铺尚未配置采集计划，请先在定时任务中完成配置。');
  }
  if (!validCollectionIsoDate(projection.dateStart)
    || !validCollectionIsoDate(projection.dateEnd)
    || projection.dateStart > projection.dateEnd) {
    throw new Error('当前店铺采集窗口尚未就绪，请刷新当前店铺或检查采集配置。');
  }
  const dateRange = buildAuthoritativeCollectionDateRange({
    action: input.action,
    dateStart: projection.dateStart,
    dateEnd: projection.dateEnd,
    storeContext: input.storeContext,
    storeName: input.storeName,
  });
  return {
    authorityKey: missionControlContextKey(input.storeContext),
    dateRange,
    refreshScope: {
      ...input.scope,
      dateFrom: projection.dateStart,
      dateTo: projection.dateEnd,
      storeName: input.storeName,
      marketplaceCode: 'US',
      currency: 'USD',
    },
  };
}
