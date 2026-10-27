import React from 'react';
import { missionControlContextKey, type LingxingCollectionProgressEvent, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type AuthoritativeCollectionDateRange } from './collection-contracts';
import { resolveAuthoritativeCollectionCapture } from './collection-capture';
import type { MissionControlStoreContextValue } from '../mission-control/store-context';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { OperationScope } from '../types';
export function createCollectionAuthorityCapture({ storeAuthority, scope, setScope, authorityKeyRef,
  collectionRequestIdRef, manualReconciliationRequestIdRef, setLiveCollectionProgress, getApi, isCurrentEpoch }: {
  storeAuthority: Pick<MissionControlStoreContextValue, 'authoritativeContext' | 'activeStore'>;
  scope: OperationScope;
  setScope: (scope: OperationScope) => void;
  authorityKeyRef: MutableRefObject<string | null>;
  collectionRequestIdRef: MutableRefObject<string | null>;
  manualReconciliationRequestIdRef: MutableRefObject<string | null>;
  setLiveCollectionProgress: Dispatch<SetStateAction<LingxingCollectionProgressEvent | null>>;
  getApi: () => any;
  isCurrentEpoch: () => boolean;
}) {
function captureCurrentStoreAuthority(): {
    authorityKey: string;
    storeContext: StoreContextEnvelope;
  } {
    const current = storeAuthority.authoritativeContext;
    if (!current) throw new Error('当前没有可用的店铺授权上下文，请重新选择美国站店铺。');
    if (current.marketplace !== 'US' || current.currency !== 'USD') {
      throw new Error('第一版仅支持美国站（US）和美元（USD）店铺。');
    }
    return {
      authorityKey: missionControlContextKey(current),
      storeContext: { ...current },
    };
  }

function captureBusinessImportScope(): {
    authorityKey: string;
    input: OperationScope & { storeContext: StoreContextEnvelope };
  } {
    const captured = captureCurrentStoreAuthority();
    return {
      authorityKey: captured.authorityKey,
      input: {
        ...scope,
        storeName: storeAuthority.activeStore?.displayName || scope.storeName,
        marketplaceCode: 'US',
        storeContext: captured.storeContext,
      },
    };
  }

async function captureCollectionRange(action: string): Promise<{
    authorityKey: string;
    dateRange: AuthoritativeCollectionDateRange;
    refreshScope: OperationScope;
  }> {
    const captured = captureCurrentStoreAuthority();
    const resolved = await resolveAuthoritativeCollectionCapture({
      action,
      api: getApi(),
      scope,
      storeContext: captured.storeContext,
      storeName: storeAuthority.activeStore?.displayName || scope.storeName,
    });
    if (!isCapturedAuthorityCurrent(resolved.authorityKey)) {
      throw new Error('读取采集窗口期间当前店铺已变化，操作已阻断；请在新店铺中重试。');
    }
    setScope(resolved.refreshScope);
    collectionRequestIdRef.current = resolved.dateRange.requestId;
    if (action !== 'diagnose') {
      manualReconciliationRequestIdRef.current = null;
      setLiveCollectionProgress(null);
    }
    return resolved;
  }

function isCapturedAuthorityCurrent(authorityKey: string): boolean {
    return isCurrentEpoch() && authorityKeyRef.current === authorityKey;
  }
  return { captureCurrentStoreAuthority, captureBusinessImportScope, captureCollectionRange, isCapturedAuthorityCurrent };
}
