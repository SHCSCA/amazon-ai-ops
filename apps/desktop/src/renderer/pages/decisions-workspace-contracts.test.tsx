import { transactionPageSource } from './transaction-page-source.test-support';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  DECISIONS_TABLE_COLUMN_DEFINITIONS,
  DecisionsPage,
  buildDecisionsTargetBindingFeedback,
  clearDecisionsHandoffStorage,
  decisionActionLabel,
  decisionsPrimaryQueueTask,
  decisionsInteractionLocked,
  decisionsHandoffMatchesQuery,
  nextDecisionsTab,
  selectDecisionsBatchHandoffRows,
} from './decisions-page';
import {
  decisionsPageSource,
  decisionsCssSource,
  recommendation,
  eligibilityContext,
} from "./decisions-page.test-fixtures";

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
    expect(transactionPageSource("decisions-workspace.tsx")).toContain('openDecisionInspector(primaryQueueRow)');
    expect(transactionPageSource("decisions-workspace.tsx")).toContain("actionId: 'open-controlled-review-inspector'");
    expect(transactionPageSource("decisions-workspace.tsx")).toContain("actionId: 'generate-recommendations'");
  });

  it('keeps the first-screen overlay trigger mounted while the inspector hides task actions', () => {
    expect(transactionPageSource("decisions-view.tsx")).toContain("data-inspector-open={selected ? 'true' : undefined}");
    expect(transactionPageSource("decisions-view.tsx")).toContain('primaryAction={primaryTaskAction}');
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
    expect(transactionPageSource("decisions-target-actions.ts")).toContain('setDecisionFeedback(buildDecisionsTargetBindingFeedback(');
  });

  it('puts the human decision directly after core evidence and folds technical provenance by default', () => {
    const formIndex = decisionsPageSource.indexOf('decisions-inspector-form-title');
    const readOnlyIndex = decisionsPageSource.indexOf('className="decisions-readonly-decision"');
    const technicalIndex = decisionsPageSource.indexOf('className="decisions-technical-disclosure"');

    expect(formIndex).toBeGreaterThan(-1);
    expect(readOnlyIndex).toBeGreaterThan(-1);
    expect(technicalIndex).toBeGreaterThan(formIndex);
    expect(technicalIndex).toBeGreaterThan(readOnlyIndex);
    expect(transactionPageSource("decisions-view.tsx")).toContain('<details className="decisions-technical-disclosure">');
    expect(decisionsPageSource).not.toContain('<details className="decisions-technical-disclosure" open>');
  });

  it('renders a dedicated controlled-review form that only returns needs-review rows to pending', () => {
    expect(transactionPageSource("decisions-view.tsx")).toContain('className="decisions-review-form"');
    expect(transactionPageSource("decisions-view.tsx")).toContain('复核人');
    expect(transactionPageSource("decisions-view.tsx")).toContain('复核依据');
    expect(transactionPageSource("decisions-view.tsx")).toContain('可写对象类型');
    expect(transactionPageSource("decisions-view.tsx")).toContain('Ads 对象 ID');
    expect(transactionPageSource("decisions-view.tsx")).toContain('身份核验证据路径');
    expect(transactionPageSource("decisions-view.tsx")).toContain('确认复核，回到待审批');
    expect(transactionPageSource("decisions-review-actions.ts")).toContain('api?.resolveRecommendationReview');
    expect(transactionPageSource("decisions-review-actions.ts")).toContain('buildDecisionsReviewRequest({');
    expect(transactionPageSource("decisions-review-actions.ts")).toContain('isConfirmedDecisionsReviewResolution(currentRow, reviewRequest, result, refreshed)');
    expect(transactionPageSource("decisions-view.tsx")).toContain('disabled={reviewBlockers.length > 0 || mutationLocked}');
    expect(decisionsPageSource).not.toContain("selected.status === 'needs_review' && api?.approveRecommendation");
  });

  it('renders a separate pending target-binding step before any approval action', () => {
    expect(transactionPageSource("decisions-view.tsx")).toContain("selected.status === 'pending' && !selected.evidence?.writableTarget");
    expect(transactionPageSource("decisions-view.tsx")).toContain('核验 Ads 对象，保持待审批');
    expect(transactionPageSource("decisions-target-actions.ts")).toContain('api?.bindRecommendationWritableTarget');
    expect(transactionPageSource("decisions-target-actions.ts")).toContain('buildDecisionsTargetBindingRequest({');
    expect(transactionPageSource("decisions-target-actions.ts")).toContain('isConfirmedDecisionsTargetBinding(refreshed, result, bindingRequest)');
    expect(transactionPageSource("decisions-view.tsx")).toContain('disabled={targetBindingBlockers.length > 0 || mutationLocked}');
    expect(transactionPageSource("decisions-view.tsx")).toContain('从当前 Ads 页面识别（只读）');
    expect(transactionPageSource("decisions-target-actions.ts")).toContain('executionAuthority?.discoverRecommendationTarget');
    expect(transactionPageSource("decisions-view.tsx")).toContain('setReviewForm((current) => ({');
    expect(transactionPageSource("decisions-view.tsx")).toContain('不会自动绑定、批准或执行');
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
    expect(transactionPageSource("decisions-workspace.tsx")).toMatch(/const eligibilityContext[\s\S]*?locked:\s*mutationLocked/);
    expect(transactionPageSource('decisions-review-actions.ts')).toMatch(/async function reviewSelectedRecommendationsDecisionsPageAction\([\s\S]*?\)[\s\S]*?if \(mutationLocked\) return;/);
    expect(transactionPageSource("decisions-workspace.tsx")).toMatch(/label:\s*`复核所选[\s\S]*?disabled:\s*selectedBatchRows\.length === 0 \|\| mutationLocked/);
    expect(transactionPageSource("decisions-view.tsx")).toContain('disabled={!selectedEligibility.canApprove || mutationLocked}');
    expect(transactionPageSource("decisions-view.tsx")).toContain('disabled={!selectedEligibility.canReject || mutationLocked}');
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
