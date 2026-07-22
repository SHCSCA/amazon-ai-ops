import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DecisionRecord, MissionControlCapabilityProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewDecisionDomainApi } from './mission-domain-window-api';
import {
  DecisionsWorkspace,
  buildCreateDecisionInput,
  buildHumanGrantInput,
  buildReviseDecisionInput,
  decisionCapabilityReady,
  decisionActionVisibility,
  preferredDecisionId,
  responseMatchesDecisionDetail,
  type DecisionWorkspaceView,
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
  capability('decisions.grants.issue', 'decisions/decided', 'BLOCKED'),
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
    expect(markup).toContain(title);
    expect(markup).toContain(marker);
    expect(markup).toContain('Amazon US');
    expect(markup).toContain('task-banner--compact');
    expect(markup).toContain('decision-domain-layout');
    expect(markup).toContain('decision-domain-list-panel');
    expect(markup).toContain('decision-domain-detail');
    expect(markup).not.toContain('已执行</button>');
    expect(markup).not.toContain('已回读</button>');
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

  it('builds CAS revisions and an exact multi-decision human grant', () => {
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

    const second = { ...record, id: 'DECISION-2', adEntityId: 'KW-2' };
    const grant = buildHumanGrantInput([record, second], {
      missionRevision: '3', allowedAdEntityIds: 'KW-1\nKW-2', maxChangePct: '15', totalImpactBudget: '60', expiresOn: '2026-07-23',
    }, 'GRANT-1');
    expect(grant.decisionIds).toEqual(['DECISION-1', 'DECISION-2']);
    expect(grant.allowedAdEntityIds).toEqual(['KW-1', 'KW-2']);
    expect(grant).not.toHaveProperty('issuer');
    expect(() => buildHumanGrantInput([record, second], {
      missionRevision: '3', allowedAdEntityIds: 'KW-1', maxChangePct: '15', totalImpactBudget: '60', expiresOn: '2026-07-23',
    }, 'GRANT-2')).toThrow(/精确一致/);
  });

  it('confines mutating actions to their owning Decision view', () => {
    expect(decisionActionVisibility('decisions/recommendations', 'proposed')).toEqual({ revise: true, resolve: false, batchGrant: false });
    expect(decisionActionVisibility('decisions/approval', 'needs_approval')).toEqual({ revise: false, resolve: true, batchGrant: false });
    expect(decisionActionVisibility('decisions/decided', 'approved')).toEqual({ revise: false, resolve: false, batchGrant: true });
    expect(decisionActionVisibility('decisions/approval', 'approved')).toEqual({ revise: false, resolve: false, batchGrant: false });
  });

  it('binds grant capabilities to the decided view and prefers an actionable recommendation', () => {
    const grantCapabilities = [
      capability('decisions.grants.revoke', 'decisions/decided'),
      capability('decisions.grants.issue', 'decisions/decided', 'BLOCKED'),
    ];
    expect(decisionCapabilityReady(grantCapabilities, 'decisions.grants.revoke', 'decisions/decided', true)).toBe(true);
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
