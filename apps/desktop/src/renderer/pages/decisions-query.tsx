import {
  buildRecommendationGateIssues,
  resolveRecommendationBatchId,
} from '../recommendation-readiness';
import {
  importedReportTypeCoverageCount,
  realReportCoverageCount,
} from '../report-coverage';
import type {
  BusinessDataPipeline,
  OperationScope,
  RecommendationView,
} from '../types';
import {
  DECISIONS_AUTHORITATIVE_STATUSES,
} from "./decisions-constants";
import {
  type DecisionsLoadRequestGuard,
  type DecisionsLoadRequest,
  type GetRecommendations,
} from "./decisions-contracts";

export function decisionsQueryKey(filter: Record<string, unknown>): string {
  return [
    filter.dateFrom,
    filter.dateTo,
    filter.storeName,
    filter.marketplaceCode,
    filter.asin,
    filter.batchId,
  ].map((value) => String(value || '').trim()).join('|');
}

export function createDecisionsLoadRequestGuard(queryKey = ''): DecisionsLoadRequestGuard {
  return { sequence: 0, queryKey };
}

export function activateDecisionsQueryKey(
  guard: DecisionsLoadRequestGuard,
  queryKey: string,
): void {
  if (guard.queryKey === queryKey) return;
  guard.queryKey = queryKey;
  guard.sequence += 1;
}

export function beginDecisionsLoadRequest(
  guard: DecisionsLoadRequestGuard,
  queryKey = guard.queryKey,
): DecisionsLoadRequest | null {
  if (queryKey !== guard.queryKey) return null;
  guard.sequence += 1;
  return { sequence: guard.sequence, queryKey };
}

export function invalidateDecisionsLoadRequests(guard: DecisionsLoadRequestGuard): void {
  guard.sequence += 1;
}

export function isLatestDecisionsLoadRequest(
  guard: DecisionsLoadRequestGuard,
  request: DecisionsLoadRequest | null,
): boolean {
  return Boolean(
    request
    && guard.sequence === request.sequence
    && guard.queryKey === request.queryKey,
  );
}

export function isDecisionsQueryKeyActive(
  guard: DecisionsLoadRequestGuard,
  queryKey: string,
): boolean {
  return guard.queryKey === queryKey;
}

export function decisionsAuthorityQueryState(input: {
  publishedQueryKey: string | null;
  currentQueryKey: string;
  loading: boolean;
  stale: boolean;
}): {
  matchesCurrentQuery: boolean;
  loading: boolean;
  stale: boolean;
  mutationLocked: boolean;
} {
  const matchesCurrentQuery = Boolean(
    input.publishedQueryKey
    && input.publishedQueryKey === input.currentQueryKey,
  );
  const loading = input.loading || !matchesCurrentQuery;
  const stale = input.stale || !matchesCurrentQuery;
  return {
    matchesCurrentQuery,
    loading,
    stale,
    mutationLocked: loading || stale,
  };
}

export function decisionsRowsForPublishedQuery<T>(
  rows: readonly T[],
  publishedQueryKey: string | null,
  currentQueryKey: string,
): T[] {
  return publishedQueryKey === currentQueryKey ? [...rows] : [];
}

export const resolveDecisionsCurrentBatchId = resolveRecommendationBatchId;

export function buildDecisionsRecommendationGateIssues(input: {
  data: BusinessDataPipeline | null;
  currentBatchId?: string;
  pipelineLoading: boolean;
}): string[] {
  if (input.pipelineLoading) return ['当前范围的数据状态尚未读取完成'];
  if (!input.data) {
    return ['当前范围的数据状态不可用'];
  }
  const realReportFileCount = realReportCoverageCount(input.data.collection);
  const importedReportTypeCount = importedReportTypeCoverageCount(input.data.collection);
  const importedRowCount = input.data.collection.fileAudit?.importedRowCount
    ?? input.data.quant.importedRows
    ?? 0;
  return buildRecommendationGateIssues({
    requiredReportCount: 8,
    realReportFileCount,
    realReportFilesLength: input.data.collection.realReportFiles.length,
    importedReportTypeCount,
    importedRowCount,
    quantImportedRows: input.data.quant.importedRows,
    hasImportedMetrics: input.data.quant.hasImportedMetrics,
    currentBatchId: input.currentBatchId,
    collectionBlockers: input.data.collection.blockers || [],
    quantBlockers: input.data.quant.blockers || [],
  });
}

export function buildDecisionsGenerationRequest(
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>,
  currentBatchId?: string,
) {
  return {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    limit: 300,
  };
}

export function asRecommendationRows(value: unknown): RecommendationView[] {
  return Array.isArray(value)
    ? value.filter((row): row is RecommendationView => Boolean(
      row
      && typeof row === 'object'
      && Number.isFinite(Number((row as RecommendationView).id)),
    ))
    : [];
}

export async function loadDecisionsAuthoritativeRows(
  getRecommendations: GetRecommendations,
  filter: Record<string, unknown>,
): Promise<RecommendationView[]> {
  const groups = await Promise.all(DECISIONS_AUTHORITATIVE_STATUSES.map(async (status) => ({
    status,
    rows: asRecommendationRows(await getRecommendations({
      ...filter,
      status,
      limit: 100,
    })).filter((row) => row.status === status),
  })));

  const merged: RecommendationView[] = [];
  const indexById = new Map<number, number>();
  for (const group of groups) {
    for (const row of group.rows) {
      const id = Number(row.id);
      const existingIndex = indexById.get(id);
      if (existingIndex === undefined) {
        indexById.set(id, merged.length);
        merged.push(row);
        continue;
      }

      const current = merged[existingIndex];
      if (Number(row.revision || 0) >= Number(current.revision || 0)) {
        merged[existingIndex] = row;
      }
    }
  }
  return merged;
}

export function decisionsInteractionLocked(input: {
  loading?: boolean;
  generating?: boolean;
  handoffBusy?: boolean;
  submitting?: boolean;
}): boolean {
  return Boolean(input.loading || input.generating || input.handoffBusy || input.submitting);
}
