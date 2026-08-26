import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionControlCapabilityProjection, PolicyRecord, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewPolicyDomainApi } from './mission-domain-window-api';
import {
  PolicyDialog,
  PolicyWorkspace,
  StrategyWizardDialog,
  VersionDialog,
  bindVersionDraftToScope,
  buildPolicyScopeOptions,
  buildCreatePolicyInput,
  buildPolicyVersionDraft,
  buildPolicyVersionInput,
  formatPolicyActionBoundary,
  formatExecutionWindowSummary,
  loadPolicyScopeOptions,
  operatorFacingBlocker,
  policyVersionDetailForSelection,
  responseMatchesPolicyDetail,
} from './policy-workspace';

const context = {
  storeId: 'preview-store-shc001', browserProfileId: 'preview-profile-shc001',
  marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22', sessionGeneration: 1,
} as StoreContextEnvelope;

function capability(capabilityId: string, state: MissionControlCapabilityProjection['state'] = 'PROTOTYPE_ONLY'): MissionControlCapabilityProjection {
  return { capabilityId, workspace: 'policy', view: 'policy/rules', action: capabilityId.endsWith('.view') ? 'view' : 'update', state, detail: `${capabilityId} ${state}` } as MissionControlCapabilityProjection;
}

const previewCapabilities = [
  'policy.version.view', 'policy.policy.create', 'policy.policy.update', 'policy.policy.archive', 'policy.policy.restore',
  'policy.version.create', 'policy.version.update', 'policy.version.enable', 'policy.version.disable', 'policy.kill-switch.enable',
  'policy.kill-switch.clear', 'policy.runtime.mode.set',
].map((id) => capability(id));

function ordinaryText(markup: string): string {
  return markup
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('PolicyWorkspace', () => {
  it('states exact priority semantics in the operator four-step dialog', () => {
    const markup = renderToStaticMarkup(<StrategyWizardDialog
      busy={false}
      draft={{
        step: 1,
        policy: { name: '守护利润', scope: 'store', priority: '10' },
        scopeLevel: 'store',
        scopeValue: 'store',
        version: buildPolicyVersionDraft(null, context.businessTimezone),
      }}
      onChange={() => undefined}
      onClose={() => undefined}
      onSave={() => undefined}
      scopeOptions={[{ value: 'store', level: 'store', label: '当前店铺', allowedAdEntityIds: [] }]}
    />);
    expect(ordinaryText(markup)).toContain('数字越小越优先');
  });

  it('derives five store-scoped selector levels without exposing identifiers in labels', () => {
    const options = buildPolicyScopeOptions('当前店铺', [{ asin: 'B0TEST0001', title: '测试产品' }], [
      { kind: 'campaign', objectKey: 'opaque-campaign', name: '品牌活动' },
      { kind: 'ad_group', objectKey: 'opaque-group', name: '核心广告组', campaignName: '品牌活动' },
      {
        kind: 'target', objectKey: 'opaque-target', entityId: 'opaque-keyword', resolved: true,
        nonExecutable: false, name: 'running shoes', campaignName: '品牌活动', adGroupName: '核心广告组',
        asin: 'B0TEST0001', adsAccountId: 'account-1', campaignId: 'campaign-1', adGroupId: 'group-1',
        keywordId: 'keyword-1', objectRevision: 1,
      },
    ]);
    expect(new Set(options.map((option) => option.level))).toEqual(new Set(['store', 'product', 'campaign', 'ad_group', 'keyword']));
    expect(options.find((option) => option.level === 'product')).toMatchObject({ label: '测试产品 · B0TEST0001', allowedAdEntityIds: ['opaque-keyword'] });
    expect(options.find((option) => option.level === 'keyword')?.label).toBe('品牌活动 > 核心广告组 > running shoes');
    expect(options.map((option) => option.label).join(' ')).not.toContain('opaque-');
  });

  it('uses canonical Ads hierarchy tokens and keeps same-named campaigns and groups disjoint', () => {
    const options = buildPolicyScopeOptions('当前店铺', [], [
      {
        kind: 'target', objectKey: 'target-a', entityId: 'entity-a', resolved: true, nonExecutable: false,
        name: 'same keyword', campaignName: '同名活动', adGroupName: '同名广告组', adsAccountId: 'account/A',
        campaignId: 'campaign/A', adGroupId: 'group/A', keywordId: 'keyword/A', objectRevision: 1,
      },
      {
        kind: 'target', objectKey: 'target-b', entityId: 'entity-b', resolved: true, nonExecutable: false,
        name: 'same keyword', campaignName: '同名活动', adGroupName: '同名广告组', adsAccountId: 'account/B',
        campaignId: 'campaign/B', adGroupId: 'group/B', keywordId: 'keyword/B', objectRevision: 1,
      },
    ]);

    const campaigns = options.filter((option) => option.level === 'campaign');
    const adGroups = options.filter((option) => option.level === 'ad_group');
    expect(campaigns).toEqual([
      expect.objectContaining({
        value: 'campaign:account%2FA/campaign%2FA', label: '同名活动（同名对象 1/2）',
        allowedAdEntityIds: ['entity-a'],
      }),
      expect.objectContaining({
        value: 'campaign:account%2FB/campaign%2FB', label: '同名活动（同名对象 2/2）',
        allowedAdEntityIds: ['entity-b'],
      }),
    ]);
    expect(adGroups).toEqual([
      expect.objectContaining({
        value: 'ad_group:account%2FA/campaign%2FA/group%2FA',
        label: '同名活动 > 同名广告组（同名对象 1/2）',
        allowedAdEntityIds: ['entity-a'],
      }),
      expect.objectContaining({
        value: 'ad_group:account%2FB/campaign%2FB/group%2FB',
        label: '同名活动 > 同名广告组（同名对象 2/2）',
        allowedAdEntityIds: ['entity-b'],
      }),
    ]);
    expect(new Set(campaigns.map((option) => option.label)).size).toBe(2);
    expect(new Set(adGroups.map((option) => option.label)).size).toBe(2);
    expect(options.map((option) => option.label).join(' ')).not.toMatch(/account\/|campaign\/|group\//);
  });

  it('omits writable campaign and ad-group scopes without canonical identity while preserving safe scopes', () => {
    const options = buildPolicyScopeOptions('当前店铺', [{ asin: 'B0TEST0001', title: '测试产品' }], [{
      kind: 'target', objectKey: 'target-without-canonical', entityId: 'stable-keyword', resolved: true,
      nonExecutable: false, name: 'stable keyword', campaignName: '显示活动', adGroupName: '显示广告组',
      asin: 'B0TEST0001',
    }]);

    expect(options.some((option) => option.level === 'campaign')).toBe(false);
    expect(options.some((option) => option.level === 'ad_group')).toBe(false);
    expect(options.find((option) => option.level === 'store')?.allowedAdEntityIds).toEqual(['stable-keyword']);
    expect(options.find((option) => option.level === 'product')?.allowedAdEntityIds).toEqual(['stable-keyword']);
    expect(options.find((option) => option.level === 'keyword')).toMatchObject({
      value: 'keyword:stable-keyword',
      allowedAdEntityIds: ['stable-keyword'],
    });
  });

  it('loads campaigns, ad groups and stable targets instead of relying on the campaign default', async () => {
    const requestedKinds: string[] = [];
    const options = await loadPolicyScopeOptions({
      listStoreProducts: async () => [{ asin: 'B0TEST0001', title: '测试产品' }],
      listStoreAdObjects: async (_storeContext, input) => {
        requestedKinds.push(input.kind);
        if (input.kind === 'campaign') return [{ kind: 'campaign', objectKey: 'campaign', name: '品牌活动' }];
        if (input.kind === 'ad_group') return [{ kind: 'ad_group', objectKey: 'group', name: '核心广告组', campaignName: '品牌活动' }];
        return [{
          kind: 'target', objectKey: 'target', entityId: 'opaque-keyword', entityRevision: 1,
          resolved: true, nonExecutable: false, name: 'running shoes', campaignName: '品牌活动',
          adGroupName: '核心广告组', asin: 'B0TEST0001', adsAccountId: 'account-1',
          campaignId: 'campaign-1', adGroupId: 'group-1', keywordId: 'keyword-1', objectRevision: 1,
        }];
      },
    }, context);

    expect(requestedKinds).toEqual(['campaign', 'ad_group', 'target']);
    expect(new Set(options.map((option) => option.level))).toEqual(new Set(['store', 'product', 'campaign', 'ad_group', 'keyword']));
    expect(options.find((option) => option.level === 'store')?.allowedAdEntityIds).toEqual(['opaque-keyword']);
  });

  it('fails closed with a visible retry when any real scope authority source cannot be read', async () => {
    await expect(loadPolicyScopeOptions({
      listStoreProducts: async () => [],
      listStoreAdObjects: async (_storeContext, input) => {
        if (input.kind === 'target') throw new Error('target authority unavailable');
        return [];
      },
    }, context)).rejects.toThrow(/target authority unavailable/);

    const source = readFileSync(new URL('./policy-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain("setScopeOptionsPhase('error')");
    expect(source).toContain('策略对象读取失败');
    expect(source).toContain('重新读取对象');
    expect(source).not.toContain('setScopeOptions(storeOnly)');
    expect(source).not.toContain("scopeOptions.find((option) => option.level === 'store') ?? {");
  });

  it('presents the operator strategy flow as four Chinese steps with a visible enable path', () => {
    const source = readFileSync(new URL('./policy-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('对象范围');
    expect(source).toContain('允许动作');
    expect(source).toContain('变更、预算、次数、冷却与时段限制');
    expect(source).toContain('中文证据与停止条件');
    expect(source).toContain('数字越小越先匹配');
    expect(source).toContain('调整关键词竞价');
    expect(source).toContain('查看启用条件');
    expect(source).toContain('创建草稿版本');
    expect(source).toContain('检查边界');
    expect(source).toContain('启用策略');
  });

  it('renders immutable policy authority with limited runtime controls', () => {
    const markup = renderToStaticMarkup(<PolicyWorkspace
      apiOverride={createPreviewPolicyDomainApi()}
      blockedReason="仅开发预览"
      capabilities={previewCapabilities}
      previewMode
      storeContext={context}
    />);
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain('<h1 id="workspace-page-policy-rules-title">策略与风控</h1>');
    expect(markup).toContain('自动边界与审批策略');
    expect(markup).toContain('不可变策略版本');
    expect(markup).toContain('紧急停止');
    expect(markup).toContain('Amazon US');
    expect(markup).toContain('不能写熔断器或 activeVersion');
    expect(markup).toContain('data-task-density="compact"');
    expect(markup).toContain('策略店铺隔离范围');
    expect(markup).not.toContain('设置 circuitBreakerState');
  });

  it('fails closed without production Policy authority', () => {
    const markup = renderToStaticMarkup(<PolicyWorkspace
      blockedReason="Policy Main Authority 未接入"
      capabilities={[capability('policy.version.view', 'BLOCKED')]}
      previewMode={false}
      storeContext={context}
    />);
    expect(markup).toContain('data-capability-state="BLOCKED"');
    expect(markup).toContain('失败关闭');
    expect(markup).not.toContain('显式内存 adapter');
  });

  it('keeps production ordinary copy operator-facing when the blocker contains internal terms', () => {
    const markup = renderToStaticMarkup(<PolicyWorkspace
      blockedReason="Policy Main Authority 未接入；UNKNOWN revision draft set_keyword_bid"
      capabilities={[capability('policy.version.view', 'BLOCKED')]}
      previewMode={false}
      storeContext={context}
    />);
    const text = ordinaryText(markup);
    expect(text).toContain('策略');
    expect(text).not.toMatch(/Mission|Experiment|Decision|Authority|Renderer|Main|UNKNOWN|\brevision\b|\bdraft\b|set_keyword_bid/);
  });

  it('redacts lowercase authority and internal identifiers with a Chinese reason and next step', () => {
    const raw = 'ad entity keyword-id-7788 failed authority check for store id store-internal-42';
    const visible = operatorFacingBlocker(raw, '策略');

    expect(visible).toContain('原因：');
    expect(visible).toContain('下一步：');
    expect(visible).not.toContain('keyword-id-7788');
    expect(visible).not.toContain('store-internal-42');
    expect(visible).not.toMatch(/authority|internal|\bid\b/i);
  });

  it.each([
    'duplicate policy POLICY-preview-store-shc001-1722000000000',
    'duplicate version POL-preview-store-shc001-POLICY-preview-store-shc001-1722000000000-V1',
  ])('does not expose an unknown mutation error or its generated identifier: %s', (raw) => {
    const visible = operatorFacingBlocker(raw, '策略');

    expect(visible).toContain('原因：');
    expect(visible).toContain('下一步：');
    expect(visible).not.toContain(raw);
    expect(visible).not.toContain('preview-store-shc001');
  });

  it('accepts an empty entity allowlist as zero execution authority', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '安全空白策略', scope: 'store', priority: '10' }, 'POLICY-EMPTY'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const version = buildPolicyVersionInput(policy, {
      ...buildPolicyVersionDraft(null, context.businessTimezone),
      version: '1', allowedAdEntityIds: '', maxChangePct: '10', totalImpactBudget: '0',
    }, 'POLICY-EMPTY-V1');
    expect(version.rules.allowedAdEntityIds).toEqual([]);
    expect(version.rules.allowedActionTypes).toEqual(['set_keyword_bid']);
    expect(version.rules).toMatchObject({
      maxDailyActionCount: 25,
      cooldownMinutes: 30,
      executionWindow: {
        timeZone: context.businessTimezone,
        daysOfWeek: [1, 2, 3, 4, 5],
        start: '08:00',
        end: '18:00',
      },
    });
    expect(formatExecutionWindowSummary(version.rules)).toContain('25 次/日');
  });

  it('hard-limits the V1 keyword bid change to ten percent in defaults, UI and validation', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '十个百分点边界', scope: 'store', priority: '10' }, 'POLICY-TEN-PCT'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const draft = buildPolicyVersionDraft(null, context.businessTimezone);
    const markup = renderToStaticMarkup(<VersionDialog
      record={null}
      draft={draft}
      busy={false}
      onChange={() => undefined}
      onClose={() => undefined}
      onSave={() => undefined}
    />);

    expect(draft.maxChangePct).toBe('10');
    expect(markup).toContain('max="10"');
    expect(markup).not.toContain('max="15"');
    expect(() => buildPolicyVersionInput(policy, { ...draft, maxChangePct: '11' }, 'POLICY-TEN-PCT-V1'))
      .toThrow(/0.10%/);
    expect(buildPolicyVersionInput(policy, { ...draft, maxChangePct: '10' }, 'POLICY-TEN-PCT-V1').rules.maxChangePct)
      .toBe(10);
  });

  it('freezes the policy scope control after the first version exists', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '范围冻结策略', scope: 'store', priority: '10' }, 'POLICY-SCOPE-FROZEN'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const markup = renderToStaticMarkup(<PolicyDialog
      record={policy}
      draft={{ name: policy.name, scope: policy.scope, priority: String(policy.priority) }}
      busy={false}
      scopeFrozen
      scopeOptions={[{ value: 'store', level: 'store', label: '当前店铺', allowedAdEntityIds: ['opaque-keyword'] }]}
      onChange={() => undefined}
      onClose={() => undefined}
      onSave={() => undefined}
    />);

    expect(markup).toContain('<select disabled=""');
    expect(ordinaryText(markup)).toContain('已有版本，对象范围已冻结');
    expect(ordinaryText(markup)).toContain('请新建策略');
    const source = readFileSync(new URL('./policy-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('scopeFrozen={selectedVersions.length > 0}');
  });

  it('derives version allowlists only from the selected real scope and never renders editable identifiers', () => {
    const attackerDraft = {
      ...buildPolicyVersionDraft(null, context.businessTimezone),
      allowedAdEntityIds: 'attacker-controlled-id',
    };
    const bound = bindVersionDraftToScope(attackerDraft, {
      value: 'keyword:opaque-keyword',
      level: 'keyword',
      label: '品牌活动 > 核心广告组 > running shoes',
      allowedAdEntityIds: ['opaque-keyword'],
    });
    expect(bound.allowedAdEntityIds).toBe('opaque-keyword');
    expect(bindVersionDraftToScope(attackerDraft, undefined).allowedAdEntityIds).toBe('');

    const markup = renderToStaticMarkup(<VersionDialog
      record={null}
      draft={bound}
      busy={false}
      onChange={() => undefined}
      onClose={() => undefined}
      onSave={() => undefined}
    />);
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('opaque-keyword');
    expect(ordinaryText(markup)).toContain('1 个已核验关键词/投放对象');
    expect(ordinaryText(markup)).toContain('对象由策略范围自动绑定');
  });

  it('summarizes lower and upper action bounds with every runtime limit', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '完整边界策略', scope: 'store', priority: '10' }, 'POLICY-BOUNDARY'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const version = buildPolicyVersionInput(policy, buildPolicyVersionDraft(null, context.businessTimezone), 'POLICY-BOUNDARY-V1');
    expect(formatPolicyActionBoundary(version.rules)).toBe(
      '单次高于 0% 且不超过 10% · 批次 0–50 USD · 25 次/日 · 冷却 30 分钟 · 周一至周五 08:00–18:00 · America/Los_Angeles',
    );
  });

  it('renders and validates immutable daily limit, cooldown, timezone and execution-window fields', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '窗口策略', scope: 'store', priority: '10' }, 'POLICY-WINDOW'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const draft = buildPolicyVersionDraft(null, context.businessTimezone);
    const markup = renderToStaticMarkup(<VersionDialog
      record={null}
      draft={draft}
      busy={false}
      onChange={() => undefined}
      onClose={() => undefined}
      onSave={() => undefined}
    />);
    expect(markup).toContain('每日动作上限');
    expect(markup).toContain('同对象冷却时间');
    expect(markup).toContain('V1 执行窗口');
    expect(markup).toContain('America/Los_Angeles');
    expect(() => buildPolicyVersionInput(policy, { ...draft, maxDailyActionCount: '0' }, 'BAD-DAILY'))
      .toThrow(/每日动作上限/);
    expect(() => buildPolicyVersionInput(policy, { ...draft, executionDaysOfWeek: [] }, 'BAD-DAYS'))
      .toThrow(/执行日/);
    expect(() => buildPolicyVersionInput(policy, {
      ...draft, executionWindowStart: '18:00', executionWindowEnd: '08:00',
    }, 'BAD-WINDOW')).toThrow(/不能跨午夜/);
    expect(() => buildPolicyVersionInput(policy, { ...draft, executionTimeZone: 'Not/A_Timezone' }, 'BAD-TZ'))
      .toThrow(/IANA/);
  });

  it('rejects stale policy detail responses even after an A to B to A store round trip', () => {
    expect(responseMatchesPolicyDetail('store-a', 'store-a', 'policy-a', 'policy-a', 3, 3)).toBe(true);
    expect(responseMatchesPolicyDetail('store-a', 'store-a', 'policy-a', 'policy-a', 4, 3)).toBe(false);
    expect(responseMatchesPolicyDetail('store-b', 'store-a', 'policy-a', 'policy-a', 3, 3)).toBe(false);
    expect(responseMatchesPolicyDetail('store-a', 'store-a', 'policy-b', 'policy-a', 3, 3)).toBe(false);
  });

  it('drops policy A versions and its editor immediately when policy B becomes selected', async () => {
    const api = createPreviewPolicyDomainApi();
    const policyA = (await api.listPolicies(context, { includeArchived: true }))[0]!;
    const versionA = (await api.listPolicyVersions(context, policyA.id))[0]!;
    const policyBId = `${policyA.id}-other`;
    const editorA = {
      policyId: policyA.id,
      record: versionA,
      draft: buildPolicyVersionDraft(versionA, context.businessTimezone),
    };

    expect(policyVersionDetailForSelection(policyA.id, [versionA], editorA)).toEqual({
      versions: [versionA],
      versionEditor: editorA,
    });
    expect(policyVersionDetailForSelection(policyBId, [versionA], editorA)).toEqual({
      versions: [],
      versionEditor: null,
    });
    expect(policyVersionDetailForSelection(policyBId, [versionA], {
      ...editorA,
      policyId: policyBId,
    })).toEqual({
      versions: [],
      versionEditor: null,
    });

    const source = readFileSync(new URL('./policy-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/setVersions\(\[\]\);\s*setVersionEditor\(null\);\s*setSelectedId\(policyId\);/);
    expect(source).toContain('selectedVersionEditor && <VersionDialog');
    expect(source).toContain('if (!selectedVersionEditor)');
  });
});

describe('preview Policy domain adapter', () => {
  it('keeps enabled versions immutable and uses Main-compatible canAutoExecute semantics', async () => {
    const api = createPreviewPolicyDomainApi();
    const policies = await api.listPolicies(context, { includeArchived: true });
    const active = policies.find((policy) => policy.status === 'active')!;
    const versions = await api.listPolicyVersions(context, active.id);
    const enabled = versions.find((version) => version.status === 'enabled')!;
    await expect(api.updateDraftPolicyVersion(context, {
      id: enabled.id, expectedRevision: enabled.revision, actorId: 'operator', rules: enabled.rules,
    })).rejects.toThrow(/不可变|草稿/);

    const runtime = await api.getPolicyRuntime(context);
    expect(runtime.mode).toBe('manual_approval');
    expect(runtime.canAutoExecute).toBe(true);
    const automatic = await api.setAutonomyMode(context, { expectedRevision: runtime.revision, mode: 'policy_auto' });
    expect(automatic.mode).toBe('policy_auto');
    expect(automatic.canAutoExecute).toBe(true);
    const stopped = await api.setKillSwitch(context, { expectedRevision: automatic.revision, enabled: true });
    expect(stopped).toMatchObject({ mode: 'manual_approval', killSwitch: true, canAutoExecute: false });
    await expect(api.setKillSwitch(context, { expectedRevision: stopped.revision, enabled: false })).rejects.toThrow(/原因/);
    const cleared = await api.setKillSwitch(context, { expectedRevision: stopped.revision, enabled: false, reason: '人工复核完成' });
    expect(cleared).toMatchObject({ mode: 'manual_approval', killSwitch: false, canAutoExecute: true });
  });
});
