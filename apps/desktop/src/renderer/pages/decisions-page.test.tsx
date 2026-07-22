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
  buildDecisionsReviewRequest,
  buildDecisionsTargetBindingFeedback,
  buildDecisionsTargetBindingRequest,
  clearDecisionsHandoffStorage,
  createDecisionsLoadRequestGuard,
  decisionActionLabel,
  decisionEligibilitySummary,
  decisionsPrimaryQueueTask,
  decisionsInteractionLocked,
  decisionsAuthorityQueryState,
  decisionsHandoffMatchesQuery,
  decisionsQueryKey,
  decisionsRowsForPublishedQuery,
  decisionsSharedApprovalPolicyBlockers,
  decisionsReviewBlockers,
  decisionsTargetBindingBlockers,
  isConfirmedDecisionsReviewResolution,
  isConfirmedDecisionsTargetBinding,
  invalidateDecisionsLoadRequests,
  isLatestDecisionsLoadRequest,
  loadDecisionsAuthoritativeRows,
  nextDecisionsTab,
  resolveDecisionsCurrentBatchId,
  selectDecisionsBatchHandoffRows,
} from './decisions-page';

const decisionsPageSource = readFileSync(new URL('./decisions-page.tsx', import.meta.url), 'utf8');
const decisionsCssSource = readFileSync(new URL('../styles/decisions.css', import.meta.url), 'utf8');

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
      writableTarget: {
        entityType: 'keyword',
        entityId: 'amzn-keyword-101',
        entityName: 'wireless charger',
        campaignName: 'SP - Charger',
        adGroupName: 'Exact',
        metricDate: '2026-07-13',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: 18,
        identitySource: 'ads_ui',
        verifiedBy: 'Alice',
        verifiedAt: '2026-07-16T04:30:00.000Z',
        verificationNote: 'Matched the editable keyword row.',
        identityProofPath: 'D:/proof/keyword-101.png',
      },
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
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('待判断');
    expect(markup).toContain('待审批');
    expect(markup).toContain('已决策');
    expect(markup.match(/data-action-priority="primary"/g)).toHaveLength(1);
  });

  it.each(['recommendations', 'approval', 'decided'] as const)(
    'keeps every tab control bound to one stable panel when %s is active',
    (activeSubview) => {
      const markup = renderToStaticMarkup(<DecisionsPage activeSubview={activeSubview} />);
      const controlledPanelIds = Array.from(
        markup.matchAll(/aria-controls="(decisions-panel-[^"]+)"/g),
        (match) => match[1],
      );
      const renderedPanelIds = Array.from(
        markup.matchAll(/<div(?=[^>]*role="tabpanel")(?=[^>]*id="(decisions-panel-[^"]+)")[^>]*>/g),
        (match) => match[1],
      );

      expect(controlledPanelIds).toHaveLength(3);
      expect(new Set(controlledPanelIds).size).toBe(3);
      expect(renderedPanelIds).toHaveLength(3);
      expect(new Set(renderedPanelIds)).toEqual(new Set(controlledPanelIds));

      for (const candidate of ['recommendations', 'approval', 'decided'] as const) {
        const panelTag = markup.match(
          new RegExp(`<div(?=[^>]*role="tabpanel")(?=[^>]*id="decisions-panel-${candidate}")[^>]*>`),
        )?.[0];
        expect(panelTag).toBeTruthy();
        expect(panelTag).toContain(`aria-labelledby="decisions-tab-${candidate}"`);
        if (candidate === activeSubview) expect(panelTag).not.toContain('hidden=""');
        else expect(panelTag).toContain('hidden=""');
      }
    },
  );

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

  it('promotes the highest-priority queue row into the first-screen task instead of repeating summary cards', () => {
    const review = recommendation('needs_review', { id: 201 });
    const unbound = recommendation('pending', { id: 202 });
    delete unbound.evidence?.writableTarget;

    expect(decisionsPrimaryQueueTask(review)).toEqual({
      actionLabel: '复核首条建议与 Ads 对象',
      description: '降低出价 · wireless charger。先核对真实证据与唯一 Ads 对象，再决定是否回到待审批。',
      rowId: 201,
      title: '先处理首条需人工复核建议',
    });
    expect(decisionsPrimaryQueueTask(unbound)).toMatchObject({
      actionLabel: '核验首条 Ads 对象',
      rowId: 202,
      title: '先核验首条建议的 Ads 对象',
    });
    expect(decisionsPageSource).not.toContain('SummaryStrip');
    expect(decisionsPageSource).toContain('openDecisionInspector(primaryQueueRow)');
    expect(decisionsPageSource).toContain("actionId: 'open-controlled-review-inspector'");
    expect(decisionsPageSource).toContain("actionId: 'generate-recommendations'");
  });

  it('keeps the first-screen overlay trigger mounted while the inspector hides task actions', () => {
    expect(decisionsPageSource).toContain("data-inspector-open={selected ? 'true' : undefined}");
    expect(decisionsPageSource).toContain('primaryAction={primaryTaskAction}');
    expect(decisionsPageSource).not.toContain('primaryAction={selected ? undefined : primaryTaskAction}');
    expect(decisionsCssSource).toMatch(
      /\.decisions-workspace\[data-inspector-open="true"\]\s+\.task-banner__actions\s*\{[^}]*display:\s*none;/,
    );
  });

  it('keeps target-binding success visible inside the inspector without implying approval or execution', () => {
    expect(buildDecisionsTargetBindingFeedback(202, 'wireless charger')).toEqual({
      label: '仍待审批',
      title: '对象已核验 · 仍待审批 #202',
      detail: 'wireless charger 已写入不可覆盖的对象绑定审计；建议仍保持待审批，尚未批准，也未执行 Ads。',
      tone: 'ready',
    });
    expect(decisionsPageSource).toContain('setDecisionFeedback(buildDecisionsTargetBindingFeedback(');
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

  it('renders a dedicated controlled-review form that only returns needs-review rows to pending', () => {
    expect(decisionsPageSource).toContain('className="decisions-review-form"');
    expect(decisionsPageSource).toContain('复核人');
    expect(decisionsPageSource).toContain('复核依据');
    expect(decisionsPageSource).toContain('可写对象类型');
    expect(decisionsPageSource).toContain('Ads 对象 ID');
    expect(decisionsPageSource).toContain('身份核验证据路径');
    expect(decisionsPageSource).toContain('确认复核，回到待审批');
    expect(decisionsPageSource).toContain('api?.resolveRecommendationReview');
    expect(decisionsPageSource).toContain('buildDecisionsReviewRequest({');
    expect(decisionsPageSource).toContain('isConfirmedDecisionsReviewResolution(currentRow, reviewRequest, result, refreshed)');
    expect(decisionsPageSource).toContain('disabled={reviewBlockers.length > 0 || mutationLocked}');
    expect(decisionsPageSource).not.toContain("selected.status === 'needs_review' && api?.approveRecommendation");
  });

  it('renders a separate pending target-binding step before any approval action', () => {
    expect(decisionsPageSource).toContain("selected.status === 'pending' && !selected.evidence?.writableTarget");
    expect(decisionsPageSource).toContain('核验 Ads 对象，保持待审批');
    expect(decisionsPageSource).toContain('api?.bindRecommendationWritableTarget');
    expect(decisionsPageSource).toContain('buildDecisionsTargetBindingRequest({');
    expect(decisionsPageSource).toContain('isConfirmedDecisionsTargetBinding(refreshed, result, bindingRequest)');
    expect(decisionsPageSource).toContain('disabled={targetBindingBlockers.length > 0 || mutationLocked}');
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
  it('builds a locked pending target-binding request without turning it into an approval', () => {
    const row = recommendation('pending', { id: 303, revision: 12 });
    delete row.evidence?.writableTarget;

    expect(buildDecisionsTargetBindingRequest({
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: ' Alice ',
        rationale: ' Current Ads row verified. ',
        entityType: 'keyword',
        entityId: ' amzn-keyword-303 ',
        sourceFile: ' D:/reports/keyword.csv ',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: ' D:/proof/keyword.png ',
        verificationNote: ' Matched campaign, ad group, and keyword ID. ',
      },
    })).toEqual({
      recommendationId: 303,
      expectedRevision: 12,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
        batchId: 'batch-20260714',
      },
      binding: {
        boundBy: 'Alice',
        note: 'Current Ads row verified.',
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-303',
          sourceFile: 'D:/reports/keyword.csv',
          sourceRow: 18,
          identitySource: 'ads_ui',
          identityProofPath: 'D:/proof/keyword.png',
          verificationNote: 'Matched campaign, ad group, and keyword ID.',
        },
      },
    });
  });

  it('allows only an otherwise approvable unbound pending lower-bid row into target binding', () => {
    const row = recommendation('pending', { entityId: 'synthetic-keyword-row' });
    delete row.evidence?.writableTarget;
    const base = {
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      allowedSourceFiles: ['D:/reports/keyword.csv', 'D:/reports/keyword.xlsx'],
      form: {
        reviewedBy: 'Alice',
        rationale: 'Current Ads row verified.',
        entityType: 'keyword' as const,
        entityId: 'amzn-keyword-303',
        sourceFile: 'D:/reports/keyword.csv',
        sourceRow: '18',
        identitySource: 'ads_ui' as const,
        identityProofPath: 'D:/proof/keyword.png',
        verificationNote: 'Matched campaign, ad group, and keyword ID.',
      },
    };

    expect(decisionsTargetBindingBlockers(base)).toEqual([]);
    expect(decisionsTargetBindingBlockers({
      ...base,
      row: { ...row, evidence: { ...row.evidence, quantReviewRequired: true } },
    })).toContain('需量化复核的建议必须先走受控复核');
    expect(decisionsTargetBindingBlockers({
      ...base,
      row: recommendation('pending'),
    })).toContain('当前建议已存在 Ads 可写对象或绑定审计');
  });

  it('recognizes target-binding success only after the reloaded revision and audit both match', () => {
    const row = recommendation('pending', { id: 303, revision: 13 });
    const target = row.evidence!.writableTarget!;
    const request = buildDecisionsTargetBindingRequest({
      row: { ...row, revision: 12 },
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: 'Alice',
        rationale: 'Verified.',
        entityType: 'keyword',
        entityId: 'amzn-keyword-101',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: 'D:/proof/keyword-101.png',
        verificationNote: 'Matched the editable keyword row.',
      },
    });
    row.evidence = {
      ...row.evidence,
      writableTargetBinding: {
        schemaVersion: 1,
        fromRevision: 12,
        boundRevision: 13,
        boundBy: 'Alice',
        boundAt: '2026-07-16T04:30:00.000Z',
        note: 'Verified.',
        scope: {
          dateFrom: '2026-07-07',
          dateTo: '2026-07-13',
          storeName: 'US Store',
          marketplaceCode: 'US',
          asin: 'B0TEST101',
          batchId: 'batch-20260714',
        },
        metricSource: {
          batchId: 'batch-20260714',
          sourceFiles: ['D:/reports/keyword.xlsx'],
          sourceRow: 18,
        },
        writableTarget: target,
      },
    };

    const result = { ok: true as const, recommendationId: 303, status: 'pending' as const, revision: 13, boundAt: '2026-07-16T04:30:00.000Z' };
    expect(isConfirmedDecisionsTargetBinding(row, result, request)).toBe(true);
    expect(isConfirmedDecisionsTargetBinding({ ...row, revision: 12 }, result, request)).toBe(false);
    expect(isConfirmedDecisionsTargetBinding(row, result, {
      ...request,
      scope: { ...request.scope, batchId: 'cross-batch' },
    })).toBe(false);
    expect(isConfirmedDecisionsTargetBinding(row, result, {
      ...request,
      binding: { ...request.binding, boundBy: 'Mallory' },
    })).toBe(false);
  });

  it('confirms controlled review only when the API result and reloaded rev+1 audit match the submitted request', () => {
    const submitted = recommendation('needs_review', {
      id: 202,
      revision: 11,
      evidence: {
        ...recommendation().evidence,
        quantReviewRequired: true,
      },
    });
    const request = buildDecisionsReviewRequest({
      row: submitted,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: 'Alice',
        rationale: 'Controlled quant review completed.',
        entityType: 'keyword',
        entityId: 'amzn-keyword-202',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: 'D:/proof/keyword-202.png',
        verificationNote: 'Matched campaign, ad group, and keyword ID.',
      },
    });
    const reviewedAt = '2026-07-16T04:45:00.000Z';
    const target = {
      ...submitted.evidence!.writableTarget!,
      entityId: 'amzn-keyword-202',
      verifiedBy: 'Alice',
      verifiedAt: reviewedAt,
      verificationNote: 'Matched campaign, ad group, and keyword ID.',
      identityProofPath: 'D:/proof/keyword-202.png',
    };
    const refreshed: RecommendationView = {
      ...submitted,
      status: 'pending',
      revision: 12,
      evidence: {
        ...submitted.evidence,
        writableTarget: target,
        reviewResolution: {
          schemaVersion: 1,
          fromStatus: 'needs_review',
          fromRevision: 11,
          resolvedRevision: 12,
          reviewedBy: 'Alice',
          reviewedAt,
          rationale: 'Controlled quant review completed.',
          resolvedBlockers: ['quant_review_required'],
          scope: { ...request.scope },
          metricSource: {
            batchId: 'batch-20260714',
            sourceFiles: ['D:/reports/keyword.xlsx'],
            sourceRow: 18,
          },
          writableTarget: target,
        },
      },
    };
    const result = {
      ok: true as const,
      recommendationId: 202,
      previousStatus: 'needs_review' as const,
      status: 'pending' as const,
      revision: 12,
      reviewedAt,
      resolvedBlockers: ['quant_review_required'] as ['quant_review_required'],
    };

    expect(isConfirmedDecisionsReviewResolution(submitted, request, result, refreshed)).toBe(true);
    expect(isConfirmedDecisionsReviewResolution(submitted, request, result, {
      ...refreshed,
      evidence: { ...refreshed.evidence, reviewResolution: undefined },
    })).toBe(false);
    expect(isConfirmedDecisionsReviewResolution(submitted, request, result, {
      ...refreshed,
      evidence: {
        ...refreshed.evidence,
        reviewResolution: {
          ...refreshed.evidence!.reviewResolution!,
          scope: { ...request.scope, batchId: 'cross-batch' },
        },
      },
    })).toBe(false);
    expect(isConfirmedDecisionsReviewResolution(submitted, request, {
      ...result,
      resolvedBlockers: [] as unknown as ['quant_review_required'],
    }, refreshed)).toBe(false);
  });

  it('builds controlled review requests from the displayed revision and locked scope instead of editable authority fields', () => {
    const row = recommendation('needs_review', { id: 202, revision: 11 });

    expect(buildDecisionsReviewRequest({
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      form: {
        reviewedBy: ' Alice ',
        rationale: ' Current Ads row verified. ',
        entityType: 'keyword',
        entityId: ' amzn-keyword-202 ',
        sourceFile: ' D:/reports/keyword.xlsx ',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: ' D:/proof/keyword.png ',
        verificationNote: ' Matched campaign, ad group, and keyword ID. ',
      },
    })).toEqual({
      recommendationId: 202,
      expectedRevision: 11,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
        batchId: 'batch-20260714',
      },
      review: {
        reviewedBy: 'Alice',
        rationale: 'Current Ads row verified.',
        writableTarget: {
          entityType: 'keyword',
          entityId: 'amzn-keyword-202',
          sourceFile: 'D:/reports/keyword.xlsx',
          sourceRow: 18,
          identitySource: 'ads_ui',
          identityProofPath: 'D:/proof/keyword.png',
          verificationNote: 'Matched campaign, ad group, and keyword ID.',
        },
      },
    });
  });

  it('keeps controlled review disabled until the writable Ads target is complete and unambiguous', () => {
    const row = recommendation('needs_review', {
      entityId: 'synthetic-keyword-row',
      evidence: {
        ...recommendation().evidence,
        quantReviewRequired: true,
      },
    });
    const base = {
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      allowedSourceFiles: ['D:/reports/keyword.xlsx'],
      form: {
        reviewedBy: 'Alice',
        rationale: 'Current Ads row verified.',
        entityType: 'keyword' as const,
        entityId: 'amzn-keyword-202',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui' as const,
        identityProofPath: 'D:/proof/keyword.png',
        verificationNote: 'Matched campaign, ad group, and keyword ID.',
      },
    };

    expect(decisionsReviewBlockers(base)).toEqual([]);
    expect(decisionsReviewBlockers({
      ...base,
      form: { ...base.form, entityId: 'synthetic-keyword-row' },
    })).toContain('可写对象 ID 仍是建议生成用的合成标识，无法唯一定位 Ads 对象');
    expect(decisionsReviewBlockers({
      ...base,
      form: { ...base.form, sourceFile: 'D:/reports/user_search_term.xlsx' },
    })).toContain('可写对象来源文件不属于当前锁定批次');
    expect(decisionsReviewBlockers({
      ...base,
      form: { ...base.form, identityProofPath: '' },
    })).toContain('缺少 Ads 身份核验证据路径');
  });

  it('keeps controlled review disabled when the recommendation evidence itself is outside the locked batch', () => {
    const row = recommendation('needs_review', {
      entityId: 'synthetic-keyword-row',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: ['D:/forged/keyword.xlsx'],
        quantReviewRequired: true,
      },
    });

    expect(decisionsReviewBlockers({
      row,
      scope: {
        dateFrom: '2026-07-07',
        dateTo: '2026-07-13',
        storeName: 'US Store',
        marketplaceCode: 'US',
        asin: 'B0TEST101',
      },
      currentBatchId: 'batch-20260714',
      allowedSourceFiles: ['D:/reports/keyword.xlsx'],
      form: {
        reviewedBy: 'Alice',
        rationale: 'Verified.',
        entityType: 'keyword',
        entityId: 'amzn-keyword-202',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: '18',
        identitySource: 'ads_ui',
        identityProofPath: 'D:/proof/keyword.png',
        verificationNote: 'Matched current Ads row.',
      },
    })).toContain('建议来源证据不属于当前锁定批次');
  });

  it('requires the mixed preview pending row to verify its Ads target before approval', async () => {
    const api = createBrowserPreviewElectronApi('SHC001', 'mixed-recommendations');
    const [pending] = await api.getRecommendations({
      dateFrom: '2026-05-21',
      dateTo: '2026-06-23',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      batchId: 'batch_preview_20260625',
      status: 'pending',
    });
    const pipeline = await api.getBusinessUiDataPipeline();

    expect(decisionEligibilitySummary(pending, {
      scope: { storeName: 'FT-US-US', marketplaceCode: 'US' },
      currentBatchId: pending.evidence?.batchId,
      allowedSourceFiles: pipeline.collection.realReportFiles.map((file: { filePath: string }) => file.filePath),
      stale: false,
    })).toMatchObject({
      label: '先核验 Ads 对象',
      canApprove: false,
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

  it('uses the shared approval policy blockers for renderer eligibility', () => {
    const row = recommendation('pending', {
      currentValue: '0.88',
      recommendedValue: '1.02',
      evidence: {
        ...recommendation().evidence,
        decisionAgreement: 'conflict',
        decisionRequiresReview: true,
      },
    });
    const sharedBlockers = decisionsSharedApprovalPolicyBlockers(row, eligibilityContext);
    const eligibility = decisionEligibilitySummary(row, eligibilityContext);

    expect(sharedBlockers).toEqual(expect.arrayContaining([
      '降价动作的建议出价必须低于当前出价',
      'AI/规则冲突',
      'AI/规则合并标记需复核',
    ]));
    expect(eligibility.blockers).toEqual(expect.arrayContaining(sharedBlockers));
    expect(eligibility.canApprove).toBe(false);
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
