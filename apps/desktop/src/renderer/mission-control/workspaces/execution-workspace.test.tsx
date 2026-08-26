import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AdExecutionBatchProjection,
  AdExecutionProgressEvent,
  AnalysisProposalSnapshotRecord,
  DecisionRecord,
  MissionAnalysisProjection,
  MissionGrantEventRecord,
  MissionGrantRecord,
  MissionControlCapabilityProjection,
  MissionRecord,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { createPreviewExecutionAuthorityApi } from './execution-authority-window-api';
import {
  buildExecutableGrantSelections,
  EXECUTION_CAPABILITY_IDS,
  ExecutionWorkspace,
  executionUserFacingError,
  executionCapabilityReady,
  executionMutationCanCommit,
  executionProgressBelongsToSelection,
  executionMissionsForContext,
  evidenceForExecutionJob,
  missionForExecutionBatch,
  preferredExecutionBatchId,
  preferredExecutionJobId,
  selectableExecutionMissions,
} from './execution-workspace';

const context = {
  storeId: 'preview-store-shc001',
  browserProfileId: 'preview-profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 7,
} as StoreContextEnvelope;

function executionCapability(
  capabilityId: string,
  action: MissionControlCapabilityProjection['action'],
  state: MissionControlCapabilityProjection['state'],
): MissionControlCapabilityProjection {
  return { capabilityId, workspace: 'execution', view: 'execution/live', action, state, detail: `${capabilityId} ${state}` };
}

const previewExecutionCapabilities = [
  executionCapability(EXECUTION_CAPABILITY_IDS.view, 'view', 'PROTOTYPE_ONLY'),
  executionCapability(EXECUTION_CAPABILITY_IDS.start, 'start', 'PROTOTYPE_ONLY'),
  executionCapability(EXECUTION_CAPABILITY_IDS.takeover, 'takeover', 'PROTOTYPE_ONLY'),
  executionCapability(EXECUTION_CAPABILITY_IDS.cancel, 'cancel', 'PROTOTYPE_ONLY'),
  executionCapability(EXECUTION_CAPABILITY_IDS.reconcileUnknown, 'reconcile-unknown', 'BLOCKED'),
] as const;

const ORDINARY_EXECUTION_FORBIDDEN_TERMS = [
  'Mission',
  'Experiment',
  'UNKNOWN',
  'revision',
  'draft',
  'set_keyword_bid',
  'Main',
  'StoreContext',
  'Authority',
  'Profile',
  'dry-run',
  'manifest',
  'fingerprint',
  'Renderer',
  'CRUD',
  'PRODUCTION_NATIVE',
  'PROTOTYPE_ONLY',
  'LEGACY_ADAPTER',
  'sequence',
  'append-only',
  'correction',
  'DECISION',
  'ACTION',
  'READBACK',
  'EFFECT',
] as const;

const ORDINARY_EXECUTION_LEGACY_COPY = [
  'MissionGrant',
  'Grant',
  'EXECUTION',
  'EVENT CONSOLE',
  'SERIAL STATE MACHINE',
  'mock',
  'API',
  'Ads',
  'preview://',
  'fingerprint door lock',
  'intent',
  'after',
  'reload',
] as const;

function ordinaryExecutionText(markup: string): string {
  return markup
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function authorityFixture() {
  const mission: MissionRecord = {
    id: 'MISSION-US-001',
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    businessDate: context.businessDate,
    createdSessionGeneration: context.sessionGeneration,
    dataBatchId: 'BATCH-US-0723',
    policyVersionId: 'POLICY-US-V3',
    title: '核心词广告效率',
    objective: '降低高花费核心词竞价并守住订单',
    status: 'active',
    phase: 'decision',
    priority: 'P1',
    productId: 'B0TESTUS01',
    observationStartsAt: '2026-07-23T00:00:00.000Z',
    observationEndsAt: '2026-07-30T00:00:00.000Z',
    successCriteria: ['ACOS 改善'],
    guardrails: ['订单不下降超过 10%'],
    revision: 3,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
  const decision: DecisionRecord = {
    id: 'DECISION-US-001',
    storeId: context.storeId,
    missionId: mission.id,
    dataBatchId: mission.dataBatchId,
    policyVersionId: mission.policyVersionId,
    policyRevision: 3,
    actionRevision: 2,
    title: '降低 smart lock exact 竞价',
    rationale: '花费效率低于目标',
    recommendation: '从 USD 1.20 降至 USD 1.08',
    facts: ['ACOS 高于阈值'],
    alternatives: ['保持不变'],
    actionType: 'set_keyword_bid',
    adEntityId: 'AD-ENTITY-US-001',
    currentValue: 120,
    recommendedValue: 108,
    confidence: 0.91,
    status: 'approved',
    revision: 2,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:01:00.000Z',
  };
  const grant: MissionGrantRecord = {
    id: 'GRANT-US-HUMAN-001',
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    missionId: mission.id,
    missionRevision: mission.revision,
    decisionIds: [decision.id],
    actionRevision: decision.actionRevision,
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: [decision.adEntityId!],
    maxChangePct: 10,
    totalImpactBudget: 0.1,
    expiresAt: '2026-07-24T00:00:00.000Z',
    policyVersionId: mission.policyVersionId,
    policyRevision: decision.policyRevision,
    requiredEvidence: ['page_identity', 'before_screenshot', 'after_screenshot', 'reload_screenshot', 'readback_value'],
    stopConditions: [{ code: 'unknown_result', detail: 'UNKNOWN 立即停止' }],
    issuer: { type: 'human', actorId: 'operator-001' },
    issuedAt: '2026-07-23T01:00:00.000Z',
    createdSessionGeneration: context.sessionGeneration,
  };
  const proposal: AnalysisProposalSnapshotRecord = {
    id: 'PROPOSAL-US-001',
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    missionId: mission.id,
    missionRevision: mission.revision,
    evidencePackageId: 'EVIDENCE-US-001',
    evidencePackageHash: 'a'.repeat(64),
    dataBatchId: mission.dataBatchId,
    policyVersionId: mission.policyVersionId,
    policyRevision: grant.policyRevision,
    ruleRevision: 'b'.repeat(64),
    modelRevision: 'model-v1',
    actionBatchId: 'ACTION-BATCH-US-001',
    actionRevision: grant.actionRevision,
    legacyRecommendationId: 1,
    actionType: 'set_keyword_bid',
    entityType: 'keyword',
    entityName: 'smart lock exact',
    campaignName: 'US Exact Core',
    adGroupName: 'Core terms',
    adEntityAuthorityId: 'AUTHORITY-US-001',
    adEntityId: decision.adEntityId,
    adEntityRevision: 1,
    currentBidCents: 120,
    proposedBidCents: 108,
    changePct: -10,
    confidence: 0.91,
    source: 'rule_ai',
    explanation: '规则与 AI 同意小步降价。',
    authorization: { human: { eligible: true, blockers: [] }, policy: { eligible: true, blockers: [] } },
    validUntil: '2026-07-24T00:00:00.000Z',
    createdAt: '2026-07-23T00:00:00.000Z',
    createdSessionGeneration: context.sessionGeneration,
  };
  const projection = {
    evidencePackages: [],
    actionBatches: [],
    proposals: [proposal],
    decisionLinks: [{
      id: 'LINK-US-001', storeId: context.storeId, proposalId: proposal.id,
      decisionId: decision.id, createdAt: '2026-07-23T00:01:00.000Z',
    }],
  } as MissionAnalysisProjection;
  const events: MissionGrantEventRecord[] = [{
    id: 'GRANT-EVENT-US-001', storeId: context.storeId, grantId: grant.id,
    eventType: 'issued', actorId: 'operator-001', createdAt: grant.issuedAt,
  }];
  return { mission, decision, grant, proposal, projection, events };
}

describe('execution workspace', () => {
  it('keeps all internal execution terms out of every ordinary first-screen surface', () => {
    const liveCapabilities = [
      executionCapability(EXECUTION_CAPABILITY_IDS.view, 'view', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.start, 'start', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.takeover, 'takeover', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.cancel, 'cancel', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.reconcileUnknown, 'reconcile-unknown', 'PRODUCTION_NATIVE'),
    ];
    const surfaces = {
      preview: renderToStaticMarkup(<ExecutionWorkspace
        apiOverride={createPreviewExecutionAuthorityApi()}
        blockedReason="仅开发预览"
        capabilities={previewExecutionCapabilities}
        previewEnabled
        storeContext={context}
      />),
      production: renderToStaticMarkup(<ExecutionWorkspace
        apiOverride={createPreviewExecutionAuthorityApi()}
        blockedReason=""
        capabilities={liveCapabilities}
        previewEnabled={false}
        storeContext={context}
      />),
      blocked: renderToStaticMarkup(<ExecutionWorkspace
        blockedReason="StoreContext UNKNOWN Authority Renderer raw failure"
        capabilities={[]}
        previewEnabled={false}
        storeContext={context}
      />),
    };

    for (const [surface, markup] of Object.entries(surfaces)) {
      const text = ordinaryExecutionText(markup);
      const leaks = ORDINARY_EXECUTION_FORBIDDEN_TERMS.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
      expect(leaks, `${surface} ordinary text: ${text}`).toEqual([]);
    }

    expect(surfaces.preview).toContain('<details>');
    expect(surfaces.preview).toContain('UNKNOWN · 队列已停止；只允许只读双次对账，禁止重试保存');
  });

  it('replaces legacy preview and queue copy with Chinese business labels outside diagnostics', () => {
    const markup = renderToStaticMarkup(<ExecutionWorkspace
      apiOverride={createPreviewExecutionAuthorityApi()}
      blockedReason="仅开发预览"
      capabilities={previewExecutionCapabilities}
      previewEnabled
      storeContext={context}
    />);
    const text = ordinaryExecutionText(markup);
    const leaks = ORDINARY_EXECUTION_LEGACY_COPY.filter((term) => text.toLowerCase().includes(term.toLowerCase()));

    expect(leaks, `preview ordinary text: ${text}`).toEqual([]);
    expect(text).toContain('仅开发预览 · 不连接真实广告页面，不提交任何广告调整');
    expect(text).toContain('排队 → 预检 → 写入意图 → 提交 → 保存后核验 → 刷新回读');
  });

  it('fails closed to stable business copy instead of exposing raw execution errors', () => {
    const raw = 'DECISION revision mismatch in Main Renderer sequence';
    const fallback = executionUserFacingError(new Error(raw));
    const mappedConnection = executionUserFacingError(new Error('browser session is not ready'));

    expect(fallback).toBe('实时执行暂不可用：请核对当前店铺连接、审批授权与可见浏览器状态。');
    expect(fallback).not.toContain(raw);
    expect(mappedConnection).toContain('浏览器会话未就绪');
    expect(mappedConnection).not.toMatch(/browser session|Profile|Main|Renderer/i);
  });

  it('renders the canonical visible-browser cockpit with an explicit development-only boundary', () => {
    const markup = renderToStaticMarkup(<ExecutionWorkspace
      apiOverride={createPreviewExecutionAuthorityApi()}
      blockedReason="仅开发预览"
      capabilities={previewExecutionCapabilities}
      previewEnabled
      storeContext={context}
    />);

    expect(markup).toContain('data-canonical-surface="execution"');
    expect(markup).toContain('仅开发预览');
    expect(markup).toContain('Amazon US / USD');
    expect(markup).toContain('核验当前广告对象');
    expect(markup).toContain('从完整授权建队列');
    expect(markup).toContain('可见广告页面');
    expect(markup).toContain('排队 → 预检 → 写入意图 → 提交 → 保存后核验 → 刷新回读');
    expect(markup).toContain('before / after / reload');
    expect(markup).toContain('append-only');
    expect(markup).toContain('不允许编辑或删除审计记录');
    expect(markup).toContain('data-action-priority="primary"');
    expect(markup).toContain('查看执行来源与边界');
    expect(markup).not.toContain(['USD 1.08', '1.30'].join(' → '));
    expect(markup).not.toContain(['15', '%'].join(''));
  });

  it('renders one visible page h1 named 实时执行 in both live and blocked states', () => {
    const liveMarkup = renderToStaticMarkup(<ExecutionWorkspace
      apiOverride={createPreviewExecutionAuthorityApi()}
      blockedReason="仅开发预览"
      capabilities={previewExecutionCapabilities}
      previewEnabled
      storeContext={context}
    />);
    const blockedMarkup = renderToStaticMarkup(<ExecutionWorkspace
      blockedReason="Execution Main Authority 未接入"
      capabilities={[]}
      previewEnabled={false}
      storeContext={context}
    />);
    const css = readFileSync(new URL('./execution-workspace.css', import.meta.url), 'utf8');

    for (const markup of [liveMarkup, blockedMarkup]) {
      expect(markup.match(/<h1(?:\s[^>]*)?>/g) ?? []).toHaveLength(1);
      expect(markup).toContain('<h1 class="execution-page-title">实时执行</h1>');
    }
    expect(liveMarkup).toContain('<h2>Prime Day 后 7 日利润守护</h2>');
    expect(css).toMatch(/\.execution-page-title\s*\{[\s\S]*?font-size:\s*20px/);
    expect(css).toMatch(/\.execution-mission-header h2\s*\{/);
  });

  it('keeps execution authority ids and English status values out of the blocked ordinary surface', () => {
    const markup = renderToStaticMarkup(<ExecutionWorkspace
      blockedReason="执行服务尚未接入"
      capabilities={[]}
      previewEnabled={false}
      storeContext={context}
    />);
    const ordinaryMarkup = markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    const ordinaryText = ordinaryMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    expect(ordinaryText).not.toMatch(/UNKNOWN|set_keyword_bid|\brevision\b|execution\/|execution\.queue|BLOCKED|Authority|Renderer|\bAPI\b/);
    expect(ordinaryText).toContain('实时执行尚未就绪');
    expect(ordinaryText).toContain('请先完成当前店铺连接、审批授权和可见浏览器检查');
  });

  it('translates uncertain results and revisions on the production execution workbench', () => {
    const capabilities = [
      executionCapability(EXECUTION_CAPABILITY_IDS.view, 'view', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.start, 'start', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.takeover, 'takeover', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.cancel, 'cancel', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.reconcileUnknown, 'reconcile-unknown', 'BLOCKED'),
    ];
    const markup = renderToStaticMarkup(<ExecutionWorkspace
      apiOverride={createPreviewExecutionAuthorityApi()}
      blockedReason=""
      capabilities={capabilities}
      previewEnabled={false}
      storeContext={context}
    />);
    const ordinaryMarkup = markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    const ordinaryText = ordinaryMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    expect(ordinaryText).not.toMatch(/UNKNOWN|set_keyword_bid|\brevision\b/);
    expect(ordinaryText).toContain('结果不确定');
    expect(ordinaryText).toContain('版本校验');
  });

  it('uses operator-facing Chinese names instead of execution internals on the production workbench', () => {
    const capabilities = [
      executionCapability(EXECUTION_CAPABILITY_IDS.view, 'view', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.start, 'start', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.takeover, 'takeover', 'PRODUCTION_NATIVE'),
      executionCapability(EXECUTION_CAPABILITY_IDS.cancel, 'cancel', 'PRODUCTION_NATIVE'),
    ];
    const markup = renderToStaticMarkup(<ExecutionWorkspace
      apiOverride={createPreviewExecutionAuthorityApi()}
      blockedReason=""
      capabilities={capabilities}
      previewEnabled={false}
      storeContext={context}
    />);
    const ordinaryMarkup = markup.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    const ordinaryText = ordinaryMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    expect(ordinaryText).not.toMatch(/\b(?:MissionGrant|Mission|Grant|Authority|Renderer|Main|Intent|After|Reload|WAITING|EXECUTION|Entity)\b|SERIAL STATE MACHINE|EVENT CONSOLE|append-only|任务 ID/);
    expect(ordinaryText).toContain('当前运营任务');
    expect(ordinaryText).toContain('有效执行授权');
    expect(ordinaryText).toContain('只追加审计事件');
  });

  it('fails closed when the production preload API is absent', () => {
    const markup = renderToStaticMarkup(<ExecutionWorkspace
      blockedReason="Execution Main Authority 未接入"
      capabilities={[executionCapability(EXECUTION_CAPABILITY_IDS.view, 'view', 'PRODUCTION_NATIVE')]}
      previewEnabled={false}
      storeContext={context}
    />);
    expect(markup).toContain('data-capability-state="BLOCKED"');
    expect(markup).toContain('不会回退到预览数据');
    expect(markup).not.toContain('preview-grant-human');
  });

  it('routes UNKNOWN reconciliation through the real read-only Main authority without retrying execution', () => {
    const source = readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('UNKNOWN · 队列已停止');
    expect(source).toContain('禁止自动重试');
    expect(source).toContain('人工接管');
    expect(source).toContain('api.reconcileUnknownBatch');
    expect(source).toContain('执行只读双次对账');
    expect(source).not.toContain('const reconciliationAuthorityReady = false');
    expect(source).not.toMatch(/重试(?:执行|队列|UNKNOWN)/);
  });

  it('matches exact action capabilities and guards every mutating API entry point', () => {
    expect(executionCapabilityReady(previewExecutionCapabilities, EXECUTION_CAPABILITY_IDS.cancel, true)).toBe(true);
    expect(executionCapabilityReady(previewExecutionCapabilities, EXECUTION_CAPABILITY_IDS.cancel, false)).toBe(false);
    expect(executionCapabilityReady(previewExecutionCapabilities, 'execution.queue.kill-switch', true)).toBe(false);

    const source = readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8');
    expect(source.indexOf('if (!startCapabilityReady)', source.indexOf('const resolveIdentity')))
      .toBeLessThan(source.indexOf('api.resolveIdentity', source.indexOf('const resolveIdentity')));
    expect(source.indexOf('if (!startCapabilityReady)', source.indexOf('const createBatch')))
      .toBeLessThan(source.indexOf('api.createBatch', source.indexOf('const createBatch')));
    expect(source.indexOf('if (!takeoverCapabilityReady)', source.indexOf('const inspectBrowser')))
      .toBeLessThan(source.indexOf('api.takeOverVisibleBrowser', source.indexOf('const inspectBrowser')));
    expect(source.indexOf('if (!startCapabilityReady)', source.indexOf('const startBatch')))
      .toBeLessThan(source.indexOf('api.startBatch', source.indexOf('const startBatch')));
    expect(source.indexOf('if (!cancelCapabilityReady)', source.indexOf('const cancelBatch')))
      .toBeLessThan(source.indexOf('api.cancelBatch', source.indexOf('const cancelBatch')));
    expect(source.indexOf('if (!reconcileCapabilityProjected)', source.indexOf('const reconcileUnknown')))
      .toBeLessThan(source.indexOf('api.reconcileUnknownBatch', source.indexOf('const reconcileUnknown')));
    expect(source).toContain('取消未提交批次');
    expect(source).not.toContain('跳过此对象');
  });

  it('uses readable authority selectors instead of typed opaque production ids', () => {
    const source = readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('当前运营任务');
    expect(source).toContain('有效执行授权');
    expect(source).toContain('已决定广告对象');
    expect(source).toContain('Authority 只读标识');
    expect(source).not.toContain('从已决定记录复制 Grant ID');
    expect(source).not.toMatch(/<input[^>]+(?:grantId|adEntityId)/);
  });

  it('offers only current-context active Missions and live approved US/USD grant entities', () => {
    const fixture = authorityFixture();
    const archived = { ...fixture.mission, id: 'MISSION-ARCHIVED', status: 'archived' as const };
    const foreign = { ...fixture.mission, id: 'MISSION-FOREIGN', storeId: 'preview-store-shc002' as MissionRecord['storeId'] };
    expect(executionMissionsForContext(context, [archived, foreign, fixture.mission]).map((mission) => mission.id))
      .toEqual([archived.id, fixture.mission.id]);
    expect(selectableExecutionMissions(context, [archived, foreign, fixture.mission]).map((mission) => mission.id))
      .toEqual([fixture.mission.id]);
    expect(readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8'))
      .toContain("listMissions(context, { includeArchived: true })");

    const selections = buildExecutableGrantSelections({
      context,
      mission: fixture.mission,
      grants: [fixture.grant],
      events: fixture.events,
      decisions: [fixture.decision],
      projection: fixture.projection,
      now: '2026-07-23T12:00:00.000Z',
    });
    expect(selections).toHaveLength(1);
    expect(selections[0].grant.id).toBe(fixture.grant.id);
    expect(selections[0].entities.map((proposal) => proposal.entityName)).toEqual(['smart lock exact']);
  });

  it('filters expired, consumed, unapproved, session-stale and unsafe grant targets', () => {
    const fixture = authorityFixture();
    const select = (overrides: {
      grant?: MissionGrantRecord;
      events?: MissionGrantEventRecord[];
      decision?: DecisionRecord;
      proposal?: AnalysisProposalSnapshotRecord;
    }) => buildExecutableGrantSelections({
      context,
      mission: fixture.mission,
      grants: [overrides.grant ?? fixture.grant],
      events: overrides.events ?? fixture.events,
      decisions: [overrides.decision ?? fixture.decision],
      projection: {
        ...fixture.projection,
        proposals: [overrides.proposal ?? fixture.proposal],
      },
      now: '2026-07-23T12:00:00.000Z',
    });

    expect(select({ grant: { ...fixture.grant, expiresAt: '2026-07-23T11:59:59.000Z' } })).toEqual([]);
    expect(select({ grant: { ...fixture.grant, createdSessionGeneration: context.sessionGeneration - 1 } })).toEqual([]);
    expect(select({ grant: { ...fixture.grant, maxChangePct: 11 } })).toEqual([]);
    expect(select({ grant: { ...fixture.grant, decisionIds: Array(11).fill(fixture.decision.id) } })).toEqual([]);
    expect(select({ grant: { ...fixture.grant, allowedAdEntityIds: Array(11).fill(fixture.decision.adEntityId!) } })).toEqual([]);
    expect(select({ decision: { ...fixture.decision, status: 'needs_approval' } })).toEqual([]);
    expect(select({ proposal: { ...fixture.proposal, proposedBidCents: 121, changePct: 0.83 } })).toEqual([]);
    expect(select({ events: [...fixture.events, {
      id: 'GRANT-EVENT-CONSUMED', storeId: context.storeId, grantId: fixture.grant.id,
      eventType: 'consumed', actorId: 'execution-authority', createdAt: '2026-07-23T10:00:00.000Z',
    }] })).toEqual([]);

    const duplicateProposal = { ...fixture.proposal, id: 'PROPOSAL-US-DUPLICATE' };
    expect(buildExecutableGrantSelections({
      context,
      mission: fixture.mission,
      grants: [fixture.grant],
      events: fixture.events,
      decisions: [fixture.decision],
      projection: {
        ...fixture.projection,
        proposals: [fixture.proposal, duplicateProposal],
        decisionLinks: [...fixture.projection.decisionLinks, {
          id: 'LINK-US-DUPLICATE', storeId: context.storeId, proposalId: duplicateProposal.id,
          decisionId: fixture.decision.id, createdAt: '2026-07-23T00:02:00.000Z',
        }],
      },
      now: '2026-07-23T12:00:00.000Z',
    })).toEqual([]);
  });

  it('keeps queue, browser, inspector and console contained at Windows scaling widths', () => {
    const css = readFileSync(new URL('./execution-workspace.css', import.meta.url), 'utf8');
    expect(css).toMatch(/container:\s*execution-workspace\s*\/\s*inline-size/);
    expect(css).toMatch(/\.execution-cockpit\s*\{[\s\S]*?grid-template-columns:/);
    expect(css).toMatch(/@container execution-workspace \(max-width:\s*1120px\)/);
    expect(css).toMatch(/@container execution-workspace \(max-width:\s*820px\)/);
    expect(css).toMatch(/@container execution-workspace \(max-width:\s*980px\)[\s\S]*?\.execution-cockpit--prototype\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}/);
    expect(css).toMatch(/\.execution-object-grid\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(css).toMatch(/\.execution-console__body\s*\{[\s\S]*?overflow:\s*auto/);
  });

  it('prefers a non-terminal batch without reordering append-only records', () => {
    const rows = [
      { batch: { id: 'BATCH-DONE', status: 'succeeded' } },
      { batch: { id: 'BATCH-ACTIVE', status: 'preflight' } },
      { batch: { id: 'BATCH-UNKNOWN', status: 'unknown' } },
    ] as unknown as AdExecutionBatchProjection[];
    expect(preferredExecutionBatchId(rows)).toBe('BATCH-ACTIVE');
    expect(rows.map((row) => row.batch.id)).toEqual(['BATCH-DONE', 'BATCH-ACTIVE', 'BATCH-UNKNOWN']);
  });

  it('accepts identity progress only for the currently selected execution grant', () => {
    const currentIdentity = {
      storeId: context.storeId,
      batchId: 'GRANT-CURRENT',
      phase: 'identity',
      status: 'ready',
      message: '当前授权身份已核验',
      occurredAt: '2026-07-23T12:00:00.000Z',
    } as AdExecutionProgressEvent;

    expect(executionProgressBelongsToSelection(currentIdentity, context, null, 'GRANT-CURRENT')).toBe(true);
    expect(executionProgressBelongsToSelection(
      { ...currentIdentity, batchId: 'GRANT-OTHER' },
      context,
      null,
      'GRANT-CURRENT',
    )).toBe(false);
    expect(executionProgressBelongsToSelection(
      { ...currentIdentity, jobId: 'JOB-FOREIGN' },
      context,
      null,
      'GRANT-CURRENT',
    )).toBe(false);
  });

  it('accepts non-identity progress only for the selected batch and one of its jobs', () => {
    const selected = {
      batch: { id: 'BATCH-CURRENT' },
      jobs: [{ id: 'JOB-CURRENT' }],
    } as unknown as AdExecutionBatchProjection;
    const currentJobProgress = {
      storeId: context.storeId,
      batchId: selected.batch.id,
      jobId: selected.jobs[0].id,
      phase: 'submit',
      status: 'submitted',
      message: '当前批次对象已提交',
      occurredAt: '2026-07-23T12:01:00.000Z',
    } as AdExecutionProgressEvent;

    for (const phase of ['submit', 'readback', 'terminal'] as const) {
      const phaseProgress = { ...currentJobProgress, phase };
      expect(executionProgressBelongsToSelection(phaseProgress, context, selected, 'GRANT-CURRENT')).toBe(true);
      expect(executionProgressBelongsToSelection(
        { ...phaseProgress, batchId: 'BATCH-OTHER' },
        context,
        selected,
        'GRANT-CURRENT',
      )).toBe(false);
      expect(executionProgressBelongsToSelection(
        { ...phaseProgress, jobId: 'JOB-OTHER' },
        context,
        selected,
        'GRANT-CURRENT',
      )).toBe(false);
    }
    expect(executionProgressBelongsToSelection(
      { ...currentJobProgress, storeId: 'preview-store-shc002' as StoreContextEnvelope['storeId'] },
      context,
      selected,
      'GRANT-CURRENT',
    )).toBe(false);
  });

  it('applies the current selection guard before listener updates and when deriving console rows', () => {
    const source = readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8');
    const listener = source.indexOf('return api.onProgress((event) => {');
    const listenerGuard = source.indexOf('executionProgressBelongsToSelection(', listener);
    const listenerWrite = source.indexOf('setProgressEvents(', listener);

    expect(listener).toBeGreaterThan(-1);
    expect(listenerGuard).toBeGreaterThan(listener);
    expect(listenerGuard).toBeLessThan(listenerWrite);
    expect(source).toContain('progressSelectionRef.current');
    expect(source).toContain('progressEvents.filter((event) => executionProgressBelongsToSelection(');
  });

  it('invalidates an in-flight mutation across A to B to A authority changes', () => {
    const firstRequest = { authorityKey: 'store-a/session-1', sequence: 1 };

    expect(executionMutationCanCommit(firstRequest, 'store-a/session-1', 1)).toBe(true);
    expect(executionMutationCanCommit(firstRequest, 'store-b/session-1', 2)).toBe(false);
    expect(executionMutationCanCommit(firstRequest, 'store-a/session-1', 3)).toBe(false);
    expect(executionMutationCanCommit(
      { authorityKey: 'store-a/session-1', sequence: 3 },
      'store-a/session-1',
      3,
    )).toBe(true);

    const source = readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('mutationSequence.current += 1');
    expect(source).toContain('const commitMutation = (commit: () => void) =>');
    expect(source).toContain("browserReadyGrantIdRef.current === selected!.batch.grantId");
  });

  it('keeps the operator-selected job instead of forcing every batch back to its first job', () => {
    const projection = {
      batch: { id: 'BATCH-MULTI', missionId: 'MISSION-B' },
      jobs: [
        { id: 'JOB-FIRST', evidence: [] },
        { id: 'JOB-SECOND', evidence: [] },
      ],
    } as unknown as AdExecutionBatchProjection;

    expect(preferredExecutionJobId(projection, 'JOB-SECOND')).toBe('JOB-SECOND');
    expect(preferredExecutionJobId(projection, 'MISSING-JOB')).toBe('JOB-FIRST');

    const source = readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('name="selected-execution-job"');
    expect(source).toContain('onChange={() => setSelectedJobId(job.id)}');
    expect(source).not.toMatch(/aria-label="选择当前执行对象"[^>]+readOnly[^>]+type="radio"/);
  });

  it('reads before, after and reload evidence only from the selected job', () => {
    const firstBefore = {
      id: 'EVIDENCE-FIRST-BEFORE', batchId: 'BATCH-MULTI', jobId: 'JOB-FIRST', slot: 'before',
    };
    const secondBefore = {
      id: 'EVIDENCE-SECOND-BEFORE', batchId: 'BATCH-MULTI', jobId: 'JOB-SECOND', slot: 'before',
    };
    const foreignAfter = {
      id: 'EVIDENCE-FOREIGN-AFTER', batchId: 'BATCH-OTHER', jobId: 'JOB-SECOND', slot: 'after',
    };
    const projection = {
      batch: { id: 'BATCH-MULTI', missionId: 'MISSION-B' },
      jobs: [
        { id: 'JOB-FIRST', evidence: [firstBefore] },
        { id: 'JOB-SECOND', evidence: [secondBefore, foreignAfter] },
      ],
    } as unknown as AdExecutionBatchProjection;

    expect(evidenceForExecutionJob(projection, 'JOB-SECOND', 'before')?.id).toBe('EVIDENCE-SECOND-BEFORE');
    expect(evidenceForExecutionJob(projection, 'JOB-SECOND', 'after')).toBeUndefined();
    expect(evidenceForExecutionJob(projection, 'JOB-FIRST', 'before')?.id).toBe('EVIDENCE-FIRST-BEFORE');
  });

  it('derives an existing batch title from the batch mission rather than the queue-creation selector', () => {
    const fixture = authorityFixture();
    const otherMission = { ...fixture.mission, id: 'MISSION-B', title: '批次绑定的真实运营任务' };
    const projection = {
      batch: { id: 'BATCH-MULTI', missionId: otherMission.id, missionRevision: otherMission.revision },
      jobs: [],
    } as unknown as AdExecutionBatchProjection;

    expect(missionForExecutionBatch([fixture.mission, otherMission], projection)?.title)
      .toBe('批次绑定的真实运营任务');
    expect(missionForExecutionBatch([fixture.mission], projection)).toBeNull();
    expect(missionForExecutionBatch([{ ...otherMission, revision: otherMission.revision + 1 }], projection)).toBeNull();
  });

  it('does not ship fixed example objects, reasons or an unimplemented experiment as production facts', () => {
    const source = readFileSync(new URL('./execution-workspace.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('smart lock exact');
    expect(source).not.toContain('US Exact Core');
    expect(source).not.toContain('近 7 日 CPC 上扬但转化率稳定');
    expect(source).not.toContain('核心词竞价弹性');
    expect(source).not.toContain('实验详情（未接入）');
    expect(source).toContain('当前批次没有可核验的关联经营实验');
  });
});
