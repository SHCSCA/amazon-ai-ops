import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionControlCapabilityProjection, PolicyRecord, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewPolicyDomainApi } from './mission-domain-window-api';
import { PolicyWorkspace, buildCreatePolicyInput, buildPolicyVersionInput, responseMatchesPolicyDetail } from './policy-workspace';

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

describe('PolicyWorkspace', () => {
  it('renders immutable policy authority with limited runtime controls', () => {
    const markup = renderToStaticMarkup(<PolicyWorkspace
      apiOverride={createPreviewPolicyDomainApi()}
      blockedReason="仅开发预览"
      capabilities={previewCapabilities}
      previewMode
      storeContext={context}
    />);
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

  it('accepts an empty entity allowlist as zero execution authority', () => {
    const policy = {
      ...buildCreatePolicyInput({ name: '安全空白策略', scope: 'store', priority: '10' }, 'POLICY-EMPTY'),
      storeId: context.storeId, status: 'draft', revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as PolicyRecord;
    const version = buildPolicyVersionInput(policy, {
      version: '1', allowedAdEntityIds: '', maxChangePct: '15', totalImpactBudget: '0', validFrom: '', validUntil: '',
    }, 'POLICY-EMPTY-V1');
    expect(version.rules.allowedAdEntityIds).toEqual([]);
    expect(version.rules.allowedActionTypes).toEqual(['set_keyword_bid']);
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
