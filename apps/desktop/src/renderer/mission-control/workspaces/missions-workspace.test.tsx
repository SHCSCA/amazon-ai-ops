import React from 'react';
import { readFileSync } from 'node:fs';
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
  buildMissionProductOptions,
  missionAnalysisBlockerLabel,
  missionGuardrailLabel,
  missionTransitionActionLabel,
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

function ordinaryText(markup: string): string {
  return markup
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    .replace(/<i\b[^>]*hidden=""[^>]*>[\s\S]*?<\/i>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('MissionsWorkspace contracts', () => {
  it('releases fixed dialog backdrops from the workspace container at compact desktop size', () => {
    const css = readFileSync(new URL('../../styles/mission-control-shell.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.mission-control-workspace-root:has\(\.mission-control-dialog-backdrop\)\s*\{[^}]*container-type:\s*normal;/s);
  });

  it('uses only current-store completed batches, enabled rules and existing products', () => {
    const source = readFileSync(new URL('./missions-workspace.tsx', import.meta.url), 'utf8');
    const defaults = source.slice(source.indexOf('function missionDraft'), source.indexOf('export function buildCreateMissionInput'));
    expect(defaults).not.toContain('BATCH-');
    expect(defaults).not.toContain('-ACTIVE');
    expect(source).toContain('getBusinessBatchOptions');
    expect(source).toContain('getOperationScope(storeContext)');
    expect(source).not.toContain('getOperationScope?.()');
    expect(source).toContain('listPolicyVersions');
    expect(source).toContain('listStoreProducts');
    expect(source).toContain('先采集');
    expect(source).toContain('先启用策略');
    expect(source).toContain('先添加产品');
  });

  it('submits the current-store product ASIN instead of its local database row id', () => {
    expect(buildMissionProductOptions([
      { id: 17, asin: 'B0GTTJFQTM', title: '主推产品' },
    ])).toEqual([
      { value: 'B0GTTJFQTM', label: '主推产品 · B0GTTJFQTM' },
    ]);
  });

  it('labels a newly created draft task as start instead of resume', () => {
    expect(missionTransitionActionLabel('draft')).toBe('启动任务');
    expect(missionTransitionActionLabel('active')).toBe('暂停任务');
    expect(missionTransitionActionLabel('paused')).toBe('恢复任务');
  });

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
    expect(markup).toContain('仅开发预览');
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
    expect(markup).toContain('已阻断');
    expect(markup).toContain('数据来源');
    expect(markup).not.toContain('显式内存 adapter');
    expect(markup).not.toContain('稳定智能门锁');
  });

  it('keeps production ordinary copy operator-facing when the blocker contains internal terms', () => {
    const markup = renderToStaticMarkup(
      <MissionsWorkspace
        blockedReason="Main 未返回 Mission Authority；UNKNOWN revision draft set_keyword_bid"
        capabilities={[capability('view', 'BLOCKED')]}
        previewMode={false}
        storeContext={context}
      />,
    );
    const text = ordinaryText(markup);
    expect(text).toContain('运营任务');
    expect(text).not.toMatch(/Mission|Experiment|Decision|Authority|Renderer|Main|UNKNOWN|\brevision\b|\bdraft\b|set_keyword_bid/);
  });

  it('translates stored technical guardrails before they reach ordinary UI', () => {
    const label = missionGuardrailLabel('UNKNOWN 立即停止；Main 按 revision 阻断 set_keyword_bid');
    expect(label).toContain('结果不确定');
    expect(label).toContain('本机安全进程');
    expect(label).toContain('版本');
    expect(label).toContain('调整关键词竞价');
    expect(label).not.toMatch(/UNKNOWN|Main|\brevision\b|set_keyword_bid/);
  });

  it('sanitizes analysis authorization blockers before ordinary feedback', () => {
    const label = missionAnalysisBlockerLabel('POLICY_AUTHORITY_REVISION_MISMATCH Main StoreContext');
    expect(label).toContain('策略自动授权');
    expect(label).toContain('重试');
    expect(label).not.toMatch(/Main|StoreContext|Authority|revision|POLICY_/i);
    expect(missionAnalysisBlockerLabel('证据尚未满足自动授权条件')).toBe('证据尚未满足自动授权条件');
    expect(missionAnalysisBlockerLabel('MISSING_STABLE_AD_ENTITY')).toBe('缺少可稳定回读的广告对象，请先从当前 Ads 页面识别并绑定后重试');
    expect(missionAnalysisBlockerLabel('CHANGE_LIMIT_EXCEEDED')).toBe('建议变化超过策略上限，请刷新数据或调整为策略允许范围后再试');
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

  it('rejects creation without an existing current-store product', () => {
    expect(() => buildCreateMissionInput(context, {
      title: '缺少产品', objective: '验证产品归属门', dataBatchId: 'BATCH-001', policyVersionId: 'POLICY-V3',
      productId: '', priority: 'P2', observationStartsOn: '2026-07-22', observationEndsOn: '2026-07-29',
      successCriteria: '改善', guardrails: '停止',
    }, 'MISSION-003')).toThrow(/产品/);
  });
});
