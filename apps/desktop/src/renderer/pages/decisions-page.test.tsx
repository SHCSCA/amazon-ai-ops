import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createBrowserPreviewElectronApi } from '../dev-preview-api';
import type { BusinessDataPipeline, RecommendationView } from '../types';
import {
  DECISIONS_AUTHORITATIVE_STATUSES,
  DECISIONS_TABLE_COLUMN_DEFINITIONS,
  DecisionsPage,
  activateDecisionsQueryKey,
  beginDecisionsLoadRequest,
  buildDecisionsDecisionRequest,
  buildDecisionsGenerationRequest,
  buildDecisionsRecommendationGateIssues,
  clearDecisionsHandoffStorage,
  createDecisionsLoadRequestGuard,
  decisionActionLabel,
  decisionEligibilitySummary,
  decisionsInteractionLocked,
  decisionsAuthorityQueryState,
  decisionsHandoffMatchesQuery,
  decisionsQueryKey,
  decisionsRowsForPublishedQuery,
  invalidateDecisionsLoadRequests,
  isLatestDecisionsLoadRequest,
  loadDecisionsAuthoritativeRows,
  nextDecisionsTab,
  resolveDecisionsCurrentBatchId,
  selectDecisionsBatchHandoffRows,
} from './decisions-page';

const decisionsPageSource = readFileSync(new URL('./decisions-page.tsx', import.meta.url), 'utf8');

function recommendation(
  status: RecommendationView['status'] = 'pending',
  patch: Partial<RecommendationView> = {},
): RecommendationView {
  return {
    id: 101,
    actionType: 'lower_bid',
    entityType: 'keyword',
    entityName: 'wireless charger',
    currentValue: '1.20',
    recommendedValue: '0.90',
    reason: 'ACOS 高于目标值，先收紧出价。',
    acos: 0.46,
    clicks: 38,
    cost: 72.5,
    riskLevel: 'low',
    status,
    revision: 7,
    confidence: 0.91,
    evidence: {
      asin: 'B0TEST101',
      batchId: 'batch-20260714',
      date: '2026-07-13',
      campaignName: 'SP - Charger',
      adGroupName: 'Exact',
      targeting: 'wireless charger',
      sourceFiles: ['D:/reports/keyword.xlsx'],
      sourceRow: 18,
      decisionAgreement: 'aligned',
      decisionReasons: ['规则与 AI 对高 ACOS 判断一致'],
      explanationSource: 'rule',
    },
    ...patch,
  };
}

const eligibilityContext = {
  scope: {
    storeName: 'US Store',
    marketplaceCode: 'US',
  },
  currentBatchId: 'batch-20260714',
  allowedSourceFiles: ['D:/reports/keyword.xlsx'],
  stale: false,
};

describe('DecisionsPage information architecture', () => {
  it('renders one task-first decisions workspace with canonical tabs and one primary action', () => {
    const markup = renderToStaticMarkup(<DecisionsPage activeSubview="approval" />);

    expect(markup).toContain('data-workspace="decisions"');
    expect(markup).toContain('data-workspace-subview="approval"');
    expect(markup).toContain('data-workspace-evidence-root="true"');
    expect(markup).toContain('class="decisions-workbench-layout"');
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain('<h1 id="workspace-page-decisions-title">建议与审批</h1>');
    expect(markup).toContain('批准不等于执行');
    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('待判断');
    expect(markup).toContain('待审批');
    expect(markup).toContain('已决策');
    expect(markup.match(/data-action-priority="primary"/g)).toHaveLength(1);
  });

  it('renders safely during SSR without window or an Electron API', () => {
    expect(() => renderToStaticMarkup(
      <DecisionsPage activeSubview="recommendations" />,
    )).not.toThrow();
  });

  it('uses generate as the recommendations primary action and refresh as its secondary action', () => {
    const markup = renderToStaticMarkup(<DecisionsPage activeSubview="recommendations" />);

    expect(markup).toMatch(/data-action-priority="primary"[^>]*disabled=""[^>]*>[\s\S]*?生成优化建议/);
    expect(markup).toMatch(/data-action-priority="secondary"[^>]*>[\s\S]*?刷新权威队列/);
    expect(markup).toContain('当前范围的数据状态尚未读取完成');
  });

  it('puts the human decision directly after core evidence and folds technical provenance by default', () => {
    const formIndex = decisionsPageSource.indexOf('decisions-inspector-form-title');
    const readOnlyIndex = decisionsPageSource.indexOf('className="decisions-readonly-decision"');
    const technicalIndex = decisionsPageSource.indexOf('className="decisions-technical-disclosure"');

    expect(formIndex).toBeGreaterThan(-1);
    expect(readOnlyIndex).toBeGreaterThan(-1);
    expect(technicalIndex).toBeGreaterThan(formIndex);
    expect(technicalIndex).toBeGreaterThan(readOnlyIndex);
    expect(decisionsPageSource).toContain('<details className="decisions-technical-disclosure">');
    expect(decisionsPageSource).not.toContain('<details className="decisions-technical-disclosure" open>');
  });
});

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

describe('decisions table contract', () => {
  it('keeps exactly five business columns and never hides evidence as supporting content', () => {
    expect(DECISIONS_TABLE_COLUMN_DEFINITIONS).toEqual([
      { key: 'action', header: '动作', priority: 'anchor' },
      { key: 'object', header: '对象', priority: 'primary' },
      { key: 'change', header: '当前 → 建议', priority: 'primary' },
      { key: 'evidence', header: '证据', priority: 'primary' },
      { key: 'decision', header: '决策', priority: 'action' },
    ]);
    expect(DECISIONS_TABLE_COLUMN_DEFINITIONS).toHaveLength(5);
    expect(DECISIONS_TABLE_COLUMN_DEFINITIONS.some((column) => String(column.header) === '操作')).toBe(false);
  });

  it('uses operator-facing action labels', () => {
    expect(decisionActionLabel('lower_bid')).toBe('降低出价');
    expect(decisionActionLabel('negative_keyword')).toBe('添加否定词');
    expect(decisionActionLabel('adjust_campaign_budget')).toBe('调整活动预算');
    expect(decisionActionLabel('add_negative_exact')).toBe('添加精准否定');
    expect(decisionActionLabel('add_negative_phrase')).toBe('添加词组否定');
    expect(decisionActionLabel('add_negative_broad')).toBe('添加广泛否定');
    expect(decisionActionLabel('resume_target')).toBe('恢复投放对象');
    expect(decisionActionLabel('create_campaign')).toBe('新建广告活动');
    expect(decisionActionLabel('archive_campaign')).toBe('归档广告活动');
    expect(decisionActionLabel('custom_action')).toBe('custom action');
  });
});

describe('batch approval handoff and interaction isolation', () => {
  it('keeps only selected authority rows that remain eligible pending recommendations', () => {
    const eligible = recommendation('pending', { id: 101 });
    const review = recommendation('needs_review', { id: 102 });
    const blocked = recommendation('pending', {
      id: 103,
      evidence: { ...recommendation().evidence, sourceFiles: [] },
    });
    const unselected = recommendation('pending', { id: 104 });

    expect(selectDecisionsBatchHandoffRows(
      [eligible, review, blocked, unselected],
      new Set(['101', '102', '103']),
      eligibilityContext,
    ).map((row) => row.id)).toEqual([101]);
  });

  it('locks peer navigation, row selection, refresh and checkboxes for every active transaction', () => {
    expect(decisionsInteractionLocked({})).toBe(false);
    for (const key of ['loading', 'generating', 'handoffBusy', 'submitting'] as const) {
      expect(decisionsInteractionLocked({ [key]: true })).toBe(true);
    }
  });

  it('uses the stronger mutation lock for eligibility, batch handoff and decision mutations', () => {
    expect(decisionsPageSource).toMatch(/const eligibilityContext[\s\S]*?locked:\s*mutationLocked/);
    expect(decisionsPageSource).toMatch(/async function reviewSelectedRecommendations\(\)[\s\S]*?if \(mutationLocked\) return;/);
    expect(decisionsPageSource).toMatch(/label:\s*`复核所选[\s\S]*?disabled:\s*selectedBatchRows\.length === 0 \|\| mutationLocked/);
    expect(decisionsPageSource).toContain('disabled={!selectedEligibility.canApprove || mutationLocked}');
    expect(decisionsPageSource).toContain('disabled={!selectedEligibility.canReject || mutationLocked}');
  });

  it('treats a handoff as one-query-only and clears its compatibility storage once consumed', () => {
    expect(decisionsHandoffMatchesQuery('scope-a', 'scope-a')).toBe(true);
    expect(decisionsHandoffMatchesQuery('scope-a', 'scope-b')).toBe(false);

    const storage = { removeItem: vi.fn() };
    clearDecisionsHandoffStorage(storage);
    expect(storage.removeItem).toHaveBeenCalledWith('amazon-ai-ops:approval-selection');
  });
});

describe('canonical decision tab keyboard navigation', () => {
  it.each([
    ['recommendations', 'ArrowRight', 'approval'],
    ['approval', 'ArrowRight', 'decided'],
    ['decided', 'ArrowRight', 'recommendations'],
    ['recommendations', 'ArrowLeft', 'decided'],
    ['approval', 'Home', 'recommendations'],
    ['approval', 'End', 'decided'],
  ] as const)('moves %s with %s to %s', (active, key, expected) => {
    expect(nextDecisionsTab(active, key)).toBe(expected);
  });

  it('ignores keys that do not navigate the canonical tablist', () => {
    expect(nextDecisionsTab('approval', 'Enter')).toBeNull();
    expect(nextDecisionsTab('approval', 'Tab')).toBeNull();
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

describe('decision safety summaries', () => {
  it('keeps the mixed preview pending row genuinely eligible for the approval smoke path', async () => {
    const api = createBrowserPreviewElectronApi('SHC001', 'mixed-recommendations');
    const [pending] = await api.getRecommendations({ status: 'pending' });
    const pipeline = await api.getBusinessUiDataPipeline();

    expect(decisionEligibilitySummary(pending, {
      scope: { storeName: 'FT-US-US', marketplaceCode: 'US' },
      currentBatchId: pending.evidence?.batchId,
      allowedSourceFiles: pipeline.collection.realReportFiles.map((file: { filePath: string }) => file.filePath),
      stale: false,
    })).toMatchObject({
      label: '可以批准',
      canApprove: true,
      canReject: true,
    });
  });

  it('allows an evidence-complete pending row to be approved or rejected', () => {
    expect(decisionEligibilitySummary(recommendation('pending'), eligibilityContext)).toMatchObject({
      label: '可以批准',
      canApprove: true,
      canReject: true,
      readOnly: false,
      blockers: [],
    });
  });

  it('never offers approval for needs_review while preserving a reject path', () => {
    expect(decisionEligibilitySummary(recommendation('needs_review'), eligibilityContext)).toMatchObject({
      label: '需要人工复核',
      canApprove: false,
      canReject: true,
      readOnly: false,
    });
  });

  it.each(['approved', 'rejected'] as const)('keeps %s strictly read-only', (status) => {
    expect(decisionEligibilitySummary(recommendation(status), eligibilityContext)).toMatchObject({
      label: status === 'approved' ? '已批准' : '已拒绝',
      canApprove: false,
      canReject: false,
      readOnly: true,
      detail: expect.stringContaining('批准不等于执行'),
    });
  });

  it('fails closed when previously loaded data is stale', () => {
    expect(decisionEligibilitySummary(recommendation('pending'), {
      ...eligibilityContext,
      stale: true,
    })).toMatchObject({
      label: '数据已过期',
      canApprove: false,
      canReject: false,
      readOnly: false,
    });
  });

  it('fails closed while a newer authoritative read is in flight', () => {
    expect(decisionEligibilitySummary(recommendation('pending'), {
      ...eligibilityContext,
      locked: true,
    })).toMatchObject({
      label: '正在确认权威状态',
      canApprove: false,
      canReject: false,
      readOnly: false,
    });
  });

  it('uses the canonical approval payload and carries expectedRevision', () => {
    const row = recommendation('pending');
    const request = buildDecisionsDecisionRequest({
      decision: 'approved',
      approverName: 'Alice',
      approvalNote: '已核对真实报表。',
      currentBatchId: 'batch-20260714',
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
    });

    expect(request.id).toBe(101);
    expect(request.expectedRevision).toBe(7);
    expect(request.decision).toMatchObject({
      decision: 'approved',
      approvedBy: 'Alice',
      note: '已核对真实报表。',
      recommendationId: 101,
      sourceRow: 18,
    });
  });
});
