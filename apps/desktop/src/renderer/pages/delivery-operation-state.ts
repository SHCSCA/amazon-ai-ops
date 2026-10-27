import type { OperationScope } from '../types';

interface DeliveryAuthority {
  authorityKey: string | null;
  contextEpoch: number;
  phase: string;
}

export function deliveryOperationContextKey(scope: OperationScope, authority: DeliveryAuthority): string {
  return JSON.stringify([authority.authorityKey, authority.contextEpoch, authority.phase,
    scope.storeName, scope.marketplaceCode, scope.dateFrom, scope.dateTo, scope.asin ?? null,
    scope.batchId ?? null, scope.currency]);
}

export { createWorkspaceOperationState as createDeliveryOperationState } from '../components/workspace/operation-state';
