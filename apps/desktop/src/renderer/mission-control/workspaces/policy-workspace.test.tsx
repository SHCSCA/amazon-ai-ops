import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionControlCapabilityProjection, PolicyRecord, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewPolicyDomainApi } from './mission-domain-window-api';
import {
  PolicyWorkspace,
  StrategyWizardDialog,
  VersionDialog,
  buildPolicyScopeOptions,
  buildCreatePolicyInput,
  buildPolicyVersionDraft,
  buildPolicyVersionInput,
  formatPolicyActionBoundary,
  formatExecutionWindowSummary,
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
      { kind: 'target', objectKey: 'opaque-target', entityId: 'opaque-keyword', resolved: true, nonExecutable: false, name: 'running shoes', campaignName: '品牌活动', adGroupName: '核心广告组', asin: 'B0TEST0001' },
    ]);
    expect(new Set(options.map((option) => option.level))).toEqual(new Set(['store', 'product', 'campaign', 'ad_group', 'keyword']));
    expect(options.find((option) => option.level === 'product')).toMatchObject({ label: '测试产品 · B0TEST0001', allowedAdEntityIds: ['opaque-keyword'] });
    expect(options.find((option) => option.level === 'keyword')?.label).toBe('品牌活动 > 核心广告组 > running shoes');
    expect(options.map((option) => option.label).join(' ')).not.toContain('opaque-');
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

  it('accepts an empty entity allowlist as zero execution authority', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '安全空白策略', scope: 'store', priority: '10' }, 'POLICY-EMPTY'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const version = buildPolicyVersionInput(policy, {
      ...buildPolicyVersionDraft(null, context.businessTimezone),
      version: '1', allowedAdEntityIds: '', maxChangePct: '15', totalImpactBudget: '0',
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

  it('summarizes lower and upper action bounds with every runtime limit', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '完整边界策略', scope: 'store', priority: '10' }, 'POLICY-BOUNDARY'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const version = buildPolicyVersionInput(policy, buildPolicyVersionDraft(null, context.businessTimezone), 'POLICY-BOUNDARY-V1');
    expect(formatPolicyActionBoundary(version.rules)).toBe(
      '单次高于 0% 且不超过 15% · 批次 0–50 USD · 25 次/日 · 冷却 30 分钟 · 周一至周五 08:00–18:00 · America/Los_Angeles',
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
