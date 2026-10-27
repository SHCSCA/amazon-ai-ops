import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createBrowserPreviewElectronApi } from '../dev-preview-api';
import type { BusinessDataPipeline } from '../types';
import {
  DECISIONS_AUTHORITATIVE_STATUSES,
  activateDecisionsQueryKey,
  beginDecisionsLoadRequest,
  buildDecisionsGenerationRequest,
  buildDecisionsRecommendationGateIssues,
  createDecisionsLoadRequestGuard,
  decisionsAuthorityQueryState,
  decisionsQueryKey,
  decisionsRowsForPublishedQuery,
  invalidateDecisionsLoadRequests,
  isLatestDecisionsLoadRequest,
  loadDecisionsAuthoritativeRows,
  resolveDecisionsCurrentBatchId,
} from './decisions-page';
import {
  recommendation,
} from "./decisions-page.test-fixtures";

describe('recommendation generation contract', () => {
  it('resolves the current batch through the canonical scope, latest, then source fallback order', () => {
    expect(resolveDecisionsCurrentBatchId({
      scopeBatchId: 'scope-batch',
      latestBatchId: 'latest-batch',
      sourceBatchIds: ['source-batch'],
    })).toBe('scope-batch');
    expect(resolveDecisionsCurrentBatchId({
      scopeBatchId: ' ',
      latestBatchId: '',
      sourceBatchIds: ['', 'source-batch'],
    })).toBe('source-batch');
  });

  it('reuses the real-report gate and builds the scoped generation payload', async () => {
    expect(buildDecisionsRecommendationGateIssues({
      data: null,
      currentBatchId: undefined,
      pipelineLoading: true,
    })).toEqual(['当前范围的数据状态尚未读取完成']);

    const api = createBrowserPreviewElectronApi('SHC001', 'mixed-recommendations');
    const pipeline = await api.getBusinessUiDataPipeline();
    expect(buildDecisionsRecommendationGateIssues({
      data: pipeline as unknown as BusinessDataPipeline,
      currentBatchId: pipeline.collection.latestBatch?.id,
      pipelineLoading: true,
    })).toEqual(['当前范围的数据状态尚未读取完成']);
    expect(buildDecisionsRecommendationGateIssues({
      data: pipeline as unknown as BusinessDataPipeline,
      currentBatchId: pipeline.collection.latestBatch?.id,
      pipelineLoading: false,
    })).toEqual([]);

    expect(buildDecisionsGenerationRequest({
      dateFrom: '2026-07-07',
      dateTo: '2026-07-13',
      storeName: 'US Store',
      marketplaceCode: 'US',
      asin: 'B0TEST101',
    }, 'batch-20260714')).toEqual({
      dateFrom: '2026-07-07',
      dateTo: '2026-07-13',
      storeName: 'US Store',
      marketplaceCode: 'US',
      asin: 'B0TEST101',
      batchId: 'batch-20260714',
      limit: 300,
    });
  });
});

describe('authoritative queue loading', () => {
  it('synchronously hides and mutation-locks rows published for a different query', () => {
    const rows = [recommendation('pending')];
    expect(decisionsAuthorityQueryState({
      publishedQueryKey: 'scope-a',
      currentQueryKey: 'scope-b',
      loading: false,
      stale: false,
    })).toEqual({
      matchesCurrentQuery: false,
      loading: true,
      stale: true,
      mutationLocked: true,
    });
    expect(decisionsRowsForPublishedQuery(rows, 'scope-a', 'scope-b')).toEqual([]);
    expect(decisionsRowsForPublishedQuery(rows, 'scope-b', 'scope-b')).toEqual(rows);
  });

  it('lets only the newest read for the active query publish and supports invalidating an unmounted request', () => {
    const queryKey = decisionsQueryKey({ storeName: 'US Store', batchId: 'batch-a' });
    const guard = createDecisionsLoadRequestGuard(queryKey);
    const first = beginDecisionsLoadRequest(guard, queryKey);
    const second = beginDecisionsLoadRequest(guard, queryKey);

    expect(isLatestDecisionsLoadRequest(guard, first)).toBe(false);
    expect(isLatestDecisionsLoadRequest(guard, second)).toBe(true);

    invalidateDecisionsLoadRequests(guard);
    expect(isLatestDecisionsLoadRequest(guard, second)).toBe(false);
  });

  it('does not let an old-scope closure start a newer request or publish into the new scope', () => {
    const oldQueryKey = decisionsQueryKey({ storeName: 'US Store', asin: 'OLD', batchId: 'batch-a' });
    const nextQueryKey = decisionsQueryKey({ storeName: 'US Store', asin: 'NEW', batchId: 'batch-b' });
    const guard = createDecisionsLoadRequestGuard(oldQueryKey);
    const oldRequest = beginDecisionsLoadRequest(guard, oldQueryKey);

    activateDecisionsQueryKey(guard, nextQueryKey);
    const sequenceAfterScopeChange = guard.sequence;
    const lateOldScopeRequest = beginDecisionsLoadRequest(guard, oldQueryKey);
    const nextRequest = beginDecisionsLoadRequest(guard, nextQueryKey);

    expect(lateOldScopeRequest).toBeNull();
    expect(guard.sequence).toBe(sequenceAfterScopeChange + 1);
    expect(isLatestDecisionsLoadRequest(guard, oldRequest)).toBe(false);
    expect(isLatestDecisionsLoadRequest(guard, nextRequest)).toBe(true);
  });

  it('loads all four represented statuses once with a hard per-status limit of 100', async () => {
    const getRecommendations = vi.fn(async (filter: Record<string, unknown>) => ([
      recommendation(String(filter.status), { id: DECISIONS_AUTHORITATIVE_STATUSES.indexOf(String(filter.status) as never) + 1 }),
    ]));

    const rows = await loadDecisionsAuthoritativeRows(getRecommendations, {
      storeName: 'US Store',
      marketplaceCode: 'US',
      batchId: 'batch-20260714',
      limit: 999,
    });

    expect(getRecommendations).toHaveBeenCalledTimes(4);
    expect(getRecommendations.mock.calls.map(([filter]) => filter.status)).toEqual([
      'pending',
      'needs_review',
      'approved',
      'rejected',
    ]);
    expect(getRecommendations.mock.calls.every(([filter]) => filter.limit === 100)).toBe(true);
    expect(rows.map((row) => row.status)).toEqual([
      'pending',
      'needs_review',
      'approved',
      'rejected',
    ]);
  });

  it('keeps only rows that match the authoritative status response and de-duplicates by id', async () => {
    const shared = recommendation('pending', { id: 101, revision: 8 });
    const getRecommendations = vi.fn(async ({ status }: { status?: string }) => {
      if (status === 'pending') return [shared, shared, recommendation('approved', { id: 999 })];
      if (status === 'approved') return [recommendation('approved', { id: 202 })];
      return [];
    });

    const rows = await loadDecisionsAuthoritativeRows(getRecommendations, {});

    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [101, 'pending'],
      [202, 'approved'],
    ]);
  });
});
