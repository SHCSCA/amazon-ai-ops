import type { OperationScope } from '../types';

export function keywordOpportunityScopeKey(scope: Partial<OperationScope>): string {
  return [
    scope.dateFrom,
    scope.dateTo,
    scope.storeName,
    scope.marketplaceCode,
    scope.asin,
    scope.batchId,
  ].map((value) => String(value || '').trim()).join('|');
}

export function createKeywordOpportunityRequestGate() {
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
      if (scopeKey !== activeScopeKey) {
        activeScopeKey = scopeKey;
        sequence += 1;
      }
      sequence += 1;
      return { scopeKey, sequence };
    },
    isCurrent(request: { scopeKey: string; sequence: number }) {
      return request.scopeKey === activeScopeKey && request.sequence === sequence;
    },
  };
}
