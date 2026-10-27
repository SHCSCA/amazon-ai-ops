import {
missionControlContextKey,
type StoreContextEnvelope
} from '@amazon-ai-ops/shared-types';
import type { MissionControlStorePhase } from './mission-control/store-context';
import { rendererRuntimeLog } from './runtime-log';
import type { OperationScope } from './types';

export interface StoreAuthoritySnapshot {
  authorityKey: string | null;
  contextEpoch: number;
  phase: MissionControlStorePhase;
}

export function shouldInvalidateLoginForStoreAuthority(
  isLoggedIn: boolean,
  previous: StoreAuthoritySnapshot,
  current: StoreAuthoritySnapshot,
): boolean {
  if (!isLoggedIn) return false;

  // 首次选择建立权限；后续重新选择也必须作废旧会话。
  if (current.phase === 'switching') return current.contextEpoch > 0;

  // 曾存在的权限丢失后，旧会话不能用于后续店铺。
  if (current.authorityKey === null) return current.contextEpoch > 0;

  // 世代区分首次初始化与 Main 直接替换权限。
  if (previous.authorityKey === null) return current.contextEpoch > 1;
  return previous.authorityKey !== current.authorityKey;
}

export function shouldRestoreLoginForStoreAuthority(input: {
  responseIsLoggedIn: boolean;
  responseAuthorityKey: string | null;
  requestedAuthorityKey: string;
  currentAuthorityKey: string | null;
}): boolean {
  return input.responseIsLoggedIn
    && input.responseAuthorityKey !== null
    && input.responseAuthorityKey === input.requestedAuthorityKey
    && input.responseAuthorityKey === input.currentAuthorityKey;
}

export function appStateAuthorityKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const context = (value as { storeContext?: unknown }).storeContext;
  if (!context) return null;
  try {
    return missionControlContextKey(context as StoreContextEnvelope);
  } catch (caught) {
    rendererRuntimeLog.warn('renderer.login_authority_invalid', { error: caught });
    return null;
  }
}

export function defaultOperationScopeForAuthority(
  context: StoreContextEnvelope,
  storeName: string,
): OperationScope {
  const end = new Date(`${context.businessDate}T12:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: context.businessDate,
    storeName,
    marketplaceCode: 'US',
    currency: 'USD',
    asin: undefined,
    batchId: undefined,
  };
}

export function operationScopeBelongsToAuthority(
  value: unknown,
  context: StoreContextEnvelope,
  storeName: string,
): value is OperationScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Partial<OperationScope>;
  return typeof scope.dateFrom === 'string'
    && typeof scope.dateTo === 'string'
    && scope.storeName === storeName
    && scope.marketplaceCode === context.marketplace
    && scope.currency === context.currency;
}

export function shouldStartLoginRestoreForAuthority(
  restoredAuthorityKey: string | null,
  current: StoreAuthoritySnapshot,
): current is StoreAuthoritySnapshot & { authorityKey: string } {
  return current.phase === 'ready'
    && Boolean(current.authorityKey)
    && restoredAuthorityKey !== current.authorityKey;
}
