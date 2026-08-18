import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DecisionRecord, MissionControlCapabilityProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewDecisionDomainApi } from './mission-domain-window-api';
import { createPreviewAnalysisAuthorityApi } from './analysis-authority-window-api';
import {
  DecisionsWorkspace,
  DecisionDialog,
  analysisActionBatchOptions,
  authorizationMissionIds,
  buildAnalysisBatchAuthorizationRequest,
  buildCreateDecisionInput,
  buildReviseDecisionInput,
  decisionCapabilityReady,
  decisionActionVisibility,
  decisionListScopeLabel,
  decisionOperatorCopy,
  decisionRevisionDisplayLabel,
  formatDecisionMoney,
  preferredDecisionId,
  responseMatchesDecisionDetail,
  type DecisionWorkspaceView,
  type DecisionDraft,
} from './decisions-workspace';

const context = {
  storeId: 'preview-store-shc001', browserProfileId: 'preview-profile-shc001',
  marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22', sessionGeneration: 1,
} as StoreContextEnvelope;

function capability(capabilityId: string, view: DecisionWorkspaceView, state: MissionControlCapabilityProjection['state'] = 'PROTOTYPE_ONLY'): MissionControlCapabilityProjection {
  return { capabilityId, workspace: 'decisions', view, action: capabilityId.endsWith('.view') ? 'view' : 'update', state, detail: `${capabilityId} ${state}` } as MissionControlCapabilityProjection;
}

const actionCapabilities = [
  capability('decisions.recommendations.create', 'decisions/recommendations'),
  capability('decisions.recommendations.update', 'decisions/recommendations'),
  capability('decisions.approval.approve', 'decisions/approval'),
  capability('decisions.approval.reject', 'decisions/approval'),
  capability('decisions.grants.issue', 'decisions/decided'),
  capability('decisions.grants.revoke', 'decisions/decided'),
];

describe('DecisionsWorkspace', () => {
  it.each([
    ['decisions/recommendations', 'AI 建议', '先把建议修订成可核验决策'],
    ['decisions/approval', '人工审批', '处理等待人工决议'],
    ['decisions/decided', '已决策', '整批授权一次'],
  ] as const)('renders a distinct %s queue', (view, title, marker) => {
    const markup = renderToStaticMarkup(<DecisionsWorkspace
      apiOverride={createPreviewDecisionDomainApi()}
      blockedReason="仅开发预览"
      capabilities={[capability(`decisions.${view.split('/')[1]}.view`, view), ...actionCapabilities]}
      previewMode
      storeContext={context}
      view={view}
    />);
    expect(markup).toContain(`data-view="${view}"`);
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain(`<h1 id="workspace-page-${view.replace('/', '-')}-title">建议与审批</h1>`);
    expect(markup).toContain(title);
    expect(markup).toContain(marker);
    expect(markup).toContain('Amazon 美国站');
    expect(markup).toContain('task-banner--compact');
    expect(markup).toContain('decision-domain-layout');
    expect(markup).toContain('decision-domain-list-panel');
    expect(markup).toContain('decision-domain-detail');
    const ordinaryMarkup = markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    const ordinaryText = ordinaryMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    expect(ordinaryText).not.toContain('Amazon US');
    expect(ordinaryText).not.toMatch(/Mission|Decision|Authority|Renderer|Main|StoreContext|UNKNOWN|\brevision\b|\bdraft\b|set_keyword_bid|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|adapter|ACTION|READBACK|EFFECT/i);
    expect(markup).not.toContain('已执行</button>');
    expect(markup).not.toContain('已回读</button>');
    if (view === 'decisions/decided') {
      expect(markup).toContain('选择授权运营任务');
      expect(markup).toContain('选择最新动作批次');
      expect(markup).toContain('无需选中某条已决策记录');
      expect(markup).not.toContain('加入授权批次');
      expect(markup).not.toContain('允许对象 ID');
    }
  });

  it('fails closed without the production authority surface', () => {
    const markup = renderToStaticMarkup(<DecisionsWorkspace
      blockedReason="Decision Main Authority 未接入"
      capabilities={[capability('decisions.approval.view', 'decisions/approval', 'BLOCKED')]}
      previewMode={false}
      storeContext={context}
      view="decisions/approval"
    />);
    expect(markup).toContain('data-capability-state="BLOCKED"');
    expect(markup).toContain('失败关闭');
    expect(markup).not.toContain('显式内存 adapter');
  });

  it('keeps internal decision and mission terms out of the production ordinary surface', () => {
    const productionCapabilities = [
      capability('decisions.recommendations.view', 'decisions/recommendations', 'PRODUCTION_NATIVE'),
      ...actionCapabilities.map((item) => ({ ...item, state: 'PRODUCTION_NATIVE' as const })),
    ];
    const markup = renderToStaticMarkup(<DecisionsWorkspace
      apiOverride={createPreviewDecisionDomainApi()}
      blockedReason=""
      capabilities={productionCapabilities}
      previewMode={false}
      storeContext={context}
      view="decisions/recommendations"
    />);
    const ordinaryMarkup = markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    const ordinaryText = ordinaryMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    expect(ordinaryText).not.toMatch(/\b(?:MissionGrant|Mission|Decision|Grant|Authority|Renderer|Main|revision|draft|set_keyword_bid)\b/);
    expect(ordinaryText).toContain('经营决策');
    expect(ordinaryText).toContain('运营任务');
  });

  it('translates underscore-delimited authority codes before they reach operators', () => {
    expect(decisionOperatorCopy(
      'AUTHORITY_REVISION_MISMATCH: MAIN_STORE_CONTEXT_UNKNOWN',
      '当前店铺的决策证据不一致，请刷新后重试。',
    )).toBe('当前店铺的决策证据不一致，请刷新后重试。');
    expect(decisionOperatorCopy('审批已记录，请刷新列表。', 'fallback'))
      .toBe('审批已记录，请刷新列表。');
  });

  it('keeps relation ids, revisions and action values inside the decision dialog diagnostics', () => {
    const draft: DecisionDraft = {
      title: '核心词降价', missionId: 'MISSION-1', dataBatchId: 'BATCH-1', policyVersionId: 'POLICY-V3',
      policyRevision: '2', actionRevision: '7', rationale: '高花费低转化', recommendation: '降价 10%',
      facts: '7 天花费 $120', alternatives: '保持竞价', expectedEffect: '降低浪费', validUntil: '2026-07-29',
      actionType: 'set_keyword_bid', adEntityId: 'KW-1', productId: 'ASIN-1', currentValue: '1.20',
      recommendedValue: '1.08', confidence: '0.86', status: 'needs_approval',
    };
    const markup = renderToStaticMarkup(<DecisionDialog
      busy={false}
      draft={draft}
      onChange={() => undefined}
      onClose={() => undefined}
      onSave={() => undefined}
      record={null}
    />);
    const ordinaryMarkup = markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    const ordinaryText = ordinaryMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    expect(markup).toContain('<summary>诊断详情</summary>');
    expect(ordinaryText).not.toMatch(/MISSION-1|BATCH-1|POLICY-V3|KW-1|ASIN-1|set_keyword_bid|\brevision\b|Mission|Decision/);
    expect(ordinaryText).toContain('新建经营决策');
  });

  it('shows business scope and version checks instead of ids and action values in decision rows', () => {
    expect(decisionListScopeLabel({ productId: 'ASIN-INTERNAL-1', actionType: 'set_keyword_bid' }))
      .toBe('指定产品 · 调整关键词竞价');
    expect(decisionListScopeLabel({ actionType: 'set_keyword_bid' }))
      .toBe('店铺级 · 调整关键词竞价');
    expect(decisionRevisionDisplayLabel(7)).toBe('版本已校验');
  });

  it('builds immutable Decision creation and CAS revision inputs', () => {
    const draft = {
      title: '批次核心词降价', missionId: 'MISSION-1', dataBatchId: 'BATCH-1', policyVersionId: 'POLICY-V3',
      policyRevision: '2', actionRevision: '7', rationale: '高花费低转化', recommendation: '降价 10%',
      facts: '7 天花费 $120；ACOS 42%', alternatives: '保持竞价；降价 5%', expectedEffect: '降低浪费',
      validUntil: '2026-07-29', actionType: 'set_keyword_bid', adEntityId: 'KW-1', productId: 'ASIN-1',
      currentValue: '1.20', recommendedValue: '1.08', confidence: '0.86', status: 'needs_approval' as const,
    };
    const created = buildCreateDecisionInput(draft, 'DECISION-1');
    expect(created).toMatchObject({ policyRevision: 2, actionRevision: 7, facts: ['7 天花费 $120', 'ACOS 42%'] });
    const record = { ...created, storeId: context.storeId, status: 'approved', revision: 4, createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z' } as DecisionRecord;
    expect(buildReviseDecisionInput(record, draft).expectedRevision).toBe(4);

  });

  it('authorizes only an exact analysis proposal batch without Renderer grant fields', async () => {
    const analysisApi = createPreviewAnalysisAuthorityApi();
    const projection = await analysisApi.getMissionProjection(context, 'MISSION-1');
    const [batch] = analysisActionBatchOptions(projection);
    const request = buildAnalysisBatchAuthorizationRequest(context, 'MISSION-1', batch.id, projection);
    const result = await analysisApi.authorizeProposalBatch(request);
    expect(result).toMatchObject({ authorized: true, mode: 'manual_approval' });
    expect(request).toEqual({ context, missionId: 'MISSION-1', proposalIds: expect.any(Array) });
    expect(Object.keys(request).sort()).toEqual(['context', 'missionId', 'proposalIds']);
    expect(await analysisApi.authorizeProposalBatch({ ...request, proposalIds: request.proposalIds.slice(0, 1) }))
      .toMatchObject({ authorized: false, blockers: [expect.stringMatching(/整批授权/)] });
  });

  it('chooses an authorization Mission and action batch independently from the decided detail selection', async () => {
    const rows = [
      { id: 'DEC-APPROVED', missionId: 'MISSION-DECIDED', status: 'approved' },
      { id: 'DEC-POLICY', missionId: 'MISSION-POLICY-AUTO', status: 'proposed' },
      { id: 'DEC-APPROVAL', missionId: 'MISSION-MANUAL', status: 'needs_approval' },
      { id: 'DEC-REJECTED', missionId: 'MISSION-REJECTED', status: 'rejected' },
    ] as DecisionRecord[];
    expect(authorizationMissionIds(rows)).toEqual([
      'MISSION-MANUAL',
      'MISSION-POLICY-AUTO',
      'MISSION-DECIDED',
    ]);

    const projection = await createPreviewAnalysisAuthorityApi().getMissionProjection(context, 'MISSION-POLICY-AUTO');
    const batches = analysisActionBatchOptions(projection);
    expect(batches).toEqual([expect.objectContaining({ proposalCount: 2 })]);
    expect(buildAnalysisBatchAuthorizationRequest(
      context,
      'MISSION-POLICY-AUTO',
      batches[0].id,
      projection,
    )).toMatchObject({
      missionId: 'MISSION-POLICY-AUTO',
      proposalIds: projection.proposals.map((proposal) => proposal.id),
    });

    const newerEmptyProjection = {
      ...projection,
      actionBatches: [
        {
          ...projection.actionBatches[0],
          id: 'newer-empty-action-batch',
          actionRevision: projection.actionBatches[0].actionRevision + 1,
          createdAt: '2026-07-23T00:00:00.000Z',
        },
        ...projection.actionBatches,
      ],
    };
    expect(analysisActionBatchOptions(newerEmptyProjection)).toEqual([
      expect.objectContaining({ id: 'newer-empty-action-batch', proposalCount: 0 }),
    ]);
  });

  it('rejects a cross-store projection before requesting exact-batch authorization', async () => {
    const projection = await createPreviewAnalysisAuthorityApi().getMissionProjection(context, 'MISSION-1');
    const foreign = {
      ...projection,
      proposals: projection.proposals.map((proposal, index) => index === 0
        ? { ...proposal, storeId: 'foreign-store' as typeof proposal.storeId }
        : proposal),
    };
    expect(() => buildAnalysisBatchAuthorizationRequest(
      context,
      'MISSION-1',
      projection.proposals[0].actionBatchId,
      foreign,
    )).toThrow(/跨店铺/);
  });

  it('renders linked proposal cents as USD dollars', () => {
    expect(formatDecisionMoney(120, 120)).toBe('$1.20');
    expect(formatDecisionMoney(102, 102)).toBe('$1.02');
    expect(formatDecisionMoney(1.2)).toBe('$1.20');
    expect(formatDecisionMoney(undefined)).toBe('—');
  });

  it('confines mutating actions to their owning Decision view', () => {
    expect(decisionActionVisibility('decisions/recommendations', 'proposed')).toEqual({ revise: true, resolve: false });
    expect(decisionActionVisibility('decisions/approval', 'needs_approval')).toEqual({ revise: false, resolve: true });
    expect(decisionActionVisibility('decisions/decided', 'approved')).toEqual({ revise: false, resolve: false });
    expect(decisionActionVisibility('decisions/approval', 'approved')).toEqual({ revise: false, resolve: false });
  });

  it('binds grant capabilities to the decided view and prefers an actionable recommendation', () => {
    const grantCapabilities = [
      capability('decisions.grants.revoke', 'decisions/decided'),
      capability('decisions.grants.issue', 'decisions/decided'),
    ];
    expect(decisionCapabilityReady(grantCapabilities, 'decisions.grants.revoke', 'decisions/decided', true)).toBe(true);
    expect(decisionCapabilityReady(grantCapabilities, 'decisions.grants.issue', 'decisions/decided', true)).toBe(true);
    expect(decisionCapabilityReady(grantCapabilities, 'decisions.grants.revoke', 'decisions/approval', true)).toBe(false);

    const blocked = { id: 'DECISION-BLOCKED', status: 'blocked' } as DecisionRecord;
    const proposed = { id: 'DECISION-PROPOSED', status: 'proposed' } as DecisionRecord;
    expect(preferredDecisionId('decisions/recommendations', [blocked, proposed])).toBe('DECISION-PROPOSED');
    expect(preferredDecisionId('decisions/decided', [{ ...blocked, status: 'rejected' }, { ...proposed, status: 'approved' }])).toBe('DECISION-PROPOSED');
  });

  it('rejects stale detail responses after the same store and Decision become current again', () => {
    expect(responseMatchesDecisionDetail('store-a', 'store-a', 'decision-a', 'decision-a', 4, 4)).toBe(true);
    expect(responseMatchesDecisionDetail('store-a', 'store-a', 'decision-a', 'decision-a', 5, 4)).toBe(false);
    expect(responseMatchesDecisionDetail('store-b', 'store-a', 'decision-a', 'decision-a', 4, 4)).toBe(false);
    expect(responseMatchesDecisionDetail('store-a', 'store-a', 'decision-b', 'decision-a', 4, 4)).toBe(false);
  });
});
