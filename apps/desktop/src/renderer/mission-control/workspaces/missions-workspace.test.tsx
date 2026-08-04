import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { createPreviewMissionDomainApi } from './mission-domain-window-api';
import {
  MissionsWorkspace,
  buildCreateMissionInput,
  buildUpdateMissionInput,
  responseMatchesMissionAuthority,
} from './missions-workspace';

const context = {
  storeId: 'preview-store-shc001',
  browserProfileId: 'preview-profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
} as StoreContextEnvelope;

function capability(action: MissionControlCapabilityAction, state: MissionControlCapabilityProjection['state']): MissionControlCapabilityProjection {
  return {
    capabilityId: `missions.mission.${action}`,
    workspace: 'missions',
    view: 'missions/overview',
    action,
    state,
    detail: `${action} ${state}`,
  };
}

const previewCapabilities = (['view', 'create', 'update', 'pause', 'resume', 'archive'] as const)
  .map((action) => capability(action, 'PROTOTYPE_ONLY'))
  .concat({
    capabilityId: 'missions.checkpoint.create', workspace: 'missions', view: 'missions/facts',
    action: 'create', state: 'PROTOTYPE_ONLY', detail: 'checkpoint preview',
  } as MissionControlCapabilityProjection);

describe('MissionsWorkspace contracts', () => {
  it('renders the prototype flight-plan shell only when the explicit preview adapter is supplied', () => {
    const markup = renderToStaticMarkup(
      <MissionsWorkspace
        apiOverride={createPreviewMissionDomainApi()}
        blockedReason="仅开发预览"
        capabilities={previewCapabilities}
        previewMode
        storeContext={context}
      />,
    );

    expect(markup).toContain('任务中心');
    expect(markup).toContain('MISSION CONTROL');
    expect(markup).toContain('显式内存 adapter');
    expect(markup).toContain('Amazon US · USD');
    expect(markup).toContain('显式 Preview Adapter');
    expect(markup).toContain('新建 Mission');
    expect(markup).toContain('Mission 队列');
    expect(markup).toContain('task-banner--compact');
    expect(markup).toContain('mission-domain-switcher');
    expect(markup).not.toContain('B0GTTJFQTM');
  });

  it('gives facts a distinct evidence-first first screen from overview', () => {
    const factsCapabilities = [
      ...previewCapabilities,
      {
        capabilityId: 'missions.mission.facts.view', workspace: 'missions', view: 'missions/facts',
        action: 'view', state: 'PROTOTYPE_ONLY', detail: 'facts preview',
      } as MissionControlCapabilityProjection,
    ];
    const overview = renderToStaticMarkup(<MissionsWorkspace apiOverride={createPreviewMissionDomainApi()} blockedReason="预览" capabilities={previewCapabilities} previewMode storeContext={context} view="missions/overview" />);
    const facts = renderToStaticMarkup(<MissionsWorkspace apiOverride={createPreviewMissionDomainApi()} blockedReason="预览" capabilities={factsCapabilities} previewMode storeContext={context} view="missions/facts" />);
    expect(overview).toContain('data-default-focus="mission-flight-plan"');
    expect(overview).toContain('验证店铺级 Mission 飞行计划');
    expect(facts).toContain('data-default-focus="evidence-lineage"');
    expect(facts).toContain('Mission 事实链');
    expect(facts).toContain('记录事实检查点');
    expect(facts).toContain('Mission 事实范围');
    expect(facts).not.toContain('aria-label="新建 Mission"');
    expect(facts).not.toContain('aria-label="Mission CRUD"');
    expect(facts).not.toBe(overview);
  });

  it('renders a fail-closed production state when native authority is unavailable', () => {
    const markup = renderToStaticMarkup(
      <MissionsWorkspace
        blockedReason="Main 未返回 Mission Authority"
        capabilities={[capability('view', 'BLOCKED')]}
        previewMode={false}
        storeContext={context}
      />,
    );

    expect(markup).toContain('data-capability-state="BLOCKED"');
    expect(markup).toContain('失败关闭');
    expect(markup).toContain('数据 Authority');
    expect(markup).not.toContain('显式 Preview Adapter');
    expect(markup).not.toContain('稳定智能门锁');
  });

  it('builds immutable authority on create and revision CAS on update', () => {
    const draft = {
      title: '核心词降价验证',
      objective: '7 天内改善 ACOS 并守住订单',
      dataBatchId: 'BATCH-001',
      policyVersionId: 'POLICY-V3',
      productId: 'B0GTTJFQTM',
      priority: 'P1' as const,
      observationStartsOn: '2026-07-22',
      observationEndsOn: '2026-07-29',
      successCriteria: 'ACOS 改善 ≥ 10%；订单下降 < 15%',
      guardrails: '单次变化 ≤ 15%；UNKNOWN 立即停止',
    };
    const create = buildCreateMissionInput(context, draft, 'MISSION-001');
    expect(create).toMatchObject({
      id: 'MISSION-001', dataBatchId: 'BATCH-001', policyVersionId: 'POLICY-V3',
      actorId: 'desktop-operator', productId: 'B0GTTJFQTM', priority: 'P1',
    });
    expect(create.successCriteria).toHaveLength(2);
    expect(create.guardrails).toHaveLength(2);

    const update = buildUpdateMissionInput(context, {
      ...create,
      storeId: context.storeId,
      marketplace: 'US',
      currency: 'USD',
      businessDate: context.businessDate,
      createdSessionGeneration: context.sessionGeneration,
      status: 'active',
      phase: 'decision',
      priority: 'P1',
      revision: 7,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }, { ...draft, title: '核心词降价验证（修订）' });
    expect(update.expectedRevision).toBe(7);
    expect(update.patch.title).toBe('核心词降价验证（修订）');
    expect(update.patch).not.toHaveProperty('dataBatchId');
    expect(update.patch).not.toHaveProperty('policyVersionId');
  });

  it('rejects invalid windows and stale store responses', () => {
    expect(() => buildCreateMissionInput(context, {
      title: '无效窗口', objective: '验证', dataBatchId: 'BATCH-001', policyVersionId: 'POLICY-V3',
      productId: '', priority: 'P2', observationStartsOn: '2026-07-29', observationEndsOn: '2026-07-22',
      successCriteria: '改善', guardrails: '停止',
    }, 'MISSION-002')).toThrow(/结束日期/);
    expect(responseMatchesMissionAuthority('store-a', 'store-a', 4, 4)).toBe(true);
    expect(responseMatchesMissionAuthority('store-b', 'store-a', 4, 4)).toBe(false);
    expect(responseMatchesMissionAuthority('store-a', 'store-a', 5, 4)).toBe(false);
  });
});
