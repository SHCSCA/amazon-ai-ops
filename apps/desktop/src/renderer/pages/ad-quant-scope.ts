import type { OperationScope } from '../types';

export function buildAiDiagnosisRunsRequest(input: {
  scope: OperationScope;
  latestBatchId?: string;
}) {
  return {
    dateFrom: input.scope.dateFrom,
    dateTo: input.scope.dateTo,
    storeName: input.scope.storeName,
    marketplaceCode: input.scope.marketplaceCode,
    asin: input.scope.asin,
    batchId: input.scope.batchId || input.latestBatchId,
    limit: 5,
  };
}

export function adQuantScopeKey(scope: Partial<OperationScope>): string {
  return [
    scope.dateFrom,
    scope.dateTo,
    scope.storeName,
    scope.marketplaceCode,
    scope.asin,
    scope.batchId,
  ].map((value) => String(value || '').trim()).join('|');
}

export function createAdQuantScopeRequestGate() {
  let activeScopeKey = '';
  let sequence = 0;
  return {
    activate(scopeKey: string) {
      if (scopeKey !== activeScopeKey) {
        activeScopeKey = scopeKey;
        sequence += 1;
      }
    },
    begin(scopeKey: string) {
      if (scopeKey !== activeScopeKey) return { scopeKey, sequence: -1 };
      sequence += 1;
      return { scopeKey, sequence };
    },
    isCurrent(request: { scopeKey: string; sequence: number }) {
      return request.sequence >= 0
        && request.scopeKey === activeScopeKey
        && request.sequence === sequence;
    },
  };
}
