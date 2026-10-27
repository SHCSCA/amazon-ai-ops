import { readStyleComposition } from '../../styles/css-source.test-support';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  CausalEventRecord,
  MissionCheckpointRecord,
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { createPreviewMissionDomainApi } from './mission-domain-window-api';
import { createPreviewAnalysisAuthorityApi } from './analysis-authority-window-api';
import {
  MissionsWorkspace,
  MissionAnalysisRunHistory,
  boundAdsObjectsForMission,
  buildCreateMissionInput,
  buildUpdateMissionInput,
  buildMissionProductOptions,
  extractKnownAnalysisFailureCodes,
  latestEvidencePackageForMission,
  missionAnalysisBlockerLabel,
  missionAnalysisRunReceipts,
  missionDefinitionEditBlocker,
  missionFlightPlanCapabilitySummary,
  missionFlightPlanRows,
  missionGuardrailLabel,
  missionLineageLinkLabel,
  missionPathFailureText,
  latestMissionAnalysisResult,
  missionRecommendationSummaryLabel,
  missionRestoreFeedback,
  missionTransitionActionLabel,
  previousStepEvidenceLabel,
  projectMissionAnalysisRun,
  refreshMissionAnalysisReceipt,
  refreshMissionAnalysisFailureReceipt,
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

function analysisRunEvent(
  input: Pick<CausalEventRecord, 'eventType' | 'entityId' | 'sequence' | 'status' | 'title' | 'createdAt'>
    & Partial<CausalEventRecord>,
): CausalEventRecord {
  return {
    id: `event-${input.entityId}-${input.eventType}`,
    storeId: context.storeId,
    stage: 'ANALYSIS',
    entityType: 'analysis_run',
    missionId: 'MISSION-001',
    signal: undefined,
    source: 'analysis-authority',
    actorId: 'analysis-agent',
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    ...input,
  };
}

describe('MissionsWorkspace contracts', () => {
  it('always projects a six-stage flight plan and overlays persisted checkpoints instead of showing an empty manual plan', () => {
    const checkpoints = [{
      id: 'checkpoint-analysis',
      storeId: context.storeId,
      missionId: 'MISSION-001',
      stage: 'ANALYSIS',
      title: '分析完成，形成 4 条可复核建议',
      status: 'completed',
      evidenceCount: 4,
      actorId: 'analysis-agent',
      createdAt: '2026-08-28T01:00:00.000Z',
    }] as MissionCheckpointRecord[];

    expect(missionFlightPlanRows('decision', 'active', checkpoints)).toEqual([
      expect.objectContaining({ phase: 'fact', label: '核验事实', state: 'done' }),
      expect.objectContaining({ phase: 'analysis', label: '分析', state: 'done', evidenceCount: 4, latestCheckpointTitle: '分析完成，形成 4 条可复核建议' }),
      expect.objectContaining({ phase: 'decision', label: '决策', state: 'current' }),
      expect.objectContaining({ phase: 'action', label: '执行', state: 'waiting' }),
      expect.objectContaining({ phase: 'readback', label: '回读', state: 'waiting' }),
      expect.objectContaining({ phase: 'effect', label: '评估效果', state: 'waiting' }),
    ]);
    expect(missionFlightPlanRows('fact', 'active', [])).toHaveLength(6);
    expect(missionFlightPlanRows('fact', 'blocked', [])[0]).toMatchObject({ state: 'blocked' });
  });

  it('does not present draft, paused, archived or completed missions as currently running', () => {
    expect(missionFlightPlanRows('fact', 'draft', [])[0]).toMatchObject({
      state: 'draft',
      statusLabel: '任务待启动',
    });
    expect(missionFlightPlanRows('decision', 'paused', [])[2]).toMatchObject({
      state: 'paused',
      statusLabel: '任务已暂停',
    });
    expect(missionFlightPlanRows('readback', 'archived', [])[4]).toMatchObject({
      state: 'archived',
      statusLabel: '任务已归档',
    });
    expect(missionFlightPlanRows('effect', 'completed', []).some((row) => row.state === 'current')).toBe(false);
    expect(missionFlightPlanRows('analysis', 'blocked', [])[1]).toMatchObject({
      state: 'blocked',
      statusLabel: '阶段已阻断',
    });
    expect(missionFlightPlanRows('analysis', 'active', [])[1]).toMatchObject({
      state: 'current',
      statusLabel: '当前阶段',
    });
  });

  it('labels an operator checkpoint as manual context without letting it advance the system phase', () => {
    const manualEffectCheckpoint = {
      id: 'checkpoint-manual-effect-note',
      storeId: context.storeId,
      missionId: 'MISSION-001',
      stage: 'EFFECT',
      title: '人工记录：广告订单暂未下降',
      status: 'completed',
      evidenceCount: 2,
      actorId: 'operator',
      createdAt: '2026-08-28T02:00:00.000Z',
    } as MissionCheckpointRecord;

    const rows = missionFlightPlanRows('fact', 'active', [manualEffectCheckpoint]);

    expect(rows[0]).toMatchObject({ state: 'current', statusLabel: '当前阶段' });
    expect(rows[5]).toMatchObject({
      state: 'waiting',
      statusLabel: '等待系统事件',
      latestCheckpointTitle: '人工记录：广告订单暂未下降',
      latestCheckpointSourceLabel: '人工补充',
    });
  });

  it('describes only connected automatic stages and requires an experiment result for effect closure', () => {
    const summary = missionFlightPlanCapabilitySummary();
    const effect = missionFlightPlanRows('readback', 'active', [])[5];

    expect(summary).toBe('事实、分析、决策、执行与回读会在对应系统事件落账后更新；效果阶段须由关联经营实验完成指标判定后闭环。人工补充记录只作上下文，不改变阶段状态。');
    expect(summary).not.toContain('六阶段自动推进');
    expect(effect.description).toBe('观察窗结束并导入新报表后，由关联经营实验判定指标；结果完成关联后才形成效果闭环与因果记忆。');
  });

  it('uses operator-facing Chinese labels for every task source link', () => {
    expect(missionLineageLinkLabel('data_batch')).toBe('数据批次');
    expect(missionLineageLinkLabel('policy_version')).toBe('策略版本');
    expect(missionLineageLinkLabel('decision')).toBe('经营决策');
    expect(missionLineageLinkLabel('experiment')).toBe('经营实验');
    expect(missionLineageLinkLabel('execution')).toBe('执行记录');
    expect(missionLineageLinkLabel('result')).toBe('效果结果');
    expect(missionLineageLinkLabel('product')).toBe('产品');
    expect(missionLineageLinkLabel('ad_entity')).toBe('广告对象');
  });

  it('releases fixed dialog backdrops from the workspace container at compact desktop size', () => {
    const css = readStyleComposition(new URL('../../styles/mission-control-shell.css', import.meta.url));
    expect(css).toMatch(/\.mission-control-workspace-root:has\(\.mission-control-dialog-backdrop\)\s*\{[^}]*container-type:\s*normal;/s);
  });

  it('uses only current-store completed batches, enabled rules and existing products', () => {
    const source = readFileSync(new URL('./missions-workspace.tsx', import.meta.url), 'utf8');
    const inputs = readFileSync(new URL('./mission-workspace-inputs.ts', import.meta.url), 'utf8');
    const editors = readFileSync(new URL('./mission-workspace-editors.tsx', import.meta.url), 'utf8');
    expect(source).toContain("from './mission-workspace-editors'");
    const start = inputs.indexOf('function missionDraft');
    expect(start).toBeGreaterThanOrEqual(0);
    const defaults = inputs.slice(start, inputs.indexOf('export function buildCreateMissionInput'));
    expect(defaults).not.toContain('BATCH-');
    expect(defaults).not.toContain('-ACTIVE');
    expect(source).toContain('getBusinessBatchOptions');
    expect(source).toContain('getOperationScope(storeContext)');
    expect(source).not.toContain('getOperationScope?.()');
    expect(source).toContain('listPolicyVersions');
    expect(source).toContain('listStoreProducts');
    expect(editors).toContain('先采集');
    expect(editors).toContain('先启用策略');
    expect(editors).toContain('先添加产品');
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

  it('explains why full Mission editing is unavailable after the decision phase', () => {
    expect(missionDefinitionEditBlocker({ phase: 'analysis' })).toBeNull();
    expect(missionDefinitionEditBlocker({ phase: 'analysis' }, true)).toContain('经营定义已锁定');
    expect(missionDefinitionEditBlocker({ phase: 'decision' })).toContain('经营定义已锁定');
    expect(missionDefinitionEditBlocker({ phase: 'readback' })).toContain('重新创建');
    const source = readFileSync(new URL('./missions-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain("Boolean(definitionEditBlocker)");
    expect(source).toContain('mission-domain-definition-lock');
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
    expect(missionAnalysisBlockerLabel('MISSING_STABLE_AD_ENTITY')).toBe('MISSING_STABLE_AD_ENTITY · 缺少可稳定回读的广告对象，请先从当前 Ads 页面识别并绑定后重试');
    expect(missionAnalysisBlockerLabel('CHANGE_LIMIT_EXCEEDED')).toBe('CHANGE_LIMIT_EXCEEDED · 建议变化超过策略上限，请刷新数据或调整为策略允许范围后再试');
    expect(missionAnalysisBlockerLabel('POLICY_PRIORITY_MISMATCH')).toBe('POLICY_PRIORITY_MISMATCH · 当前建议未命中数字最小的优先策略，请重新运行分析后再授权');
    expect(extractKnownAnalysisFailureCodes('blocked CHANGE_LIMIT_EXCEEDED for bid')).toEqual(['CHANGE_LIMIT_EXCEEDED']);
    expect(missionPathFailureText(new Error('Mission analysis blocked: CHANGE_LIMIT_EXCEEDED'))).toContain('CHANGE_LIMIT_EXCEEDED');
    expect(missionPathFailureText(new Error('失败'))).not.toBe('失败');
  });

  it('binds Ads objects and analysis status to the selected Mission evidence package', async () => {
    const missionApi = createPreviewMissionDomainApi();
    const analysisApi = createPreviewAnalysisAuthorityApi();
    const mission = (await missionApi.listMissions(context, { includeArchived: false }))[0];
    const projection = await analysisApi.getMissionProjection(context, mission.id);
    const evidence = latestEvidencePackageForMission(projection.evidencePackages, mission.id, String(context.storeId));
    const proposals = projection.proposals.filter((proposal) => proposal.evidencePackageId === evidence?.id);
    expect(boundAdsObjectsForMission(mission.id, String(context.storeId), evidence, proposals).every((item) => item.status === '待核验')).toBe(true);
    expect(projectMissionAnalysisRun({ mission, storeId: String(context.storeId), pendingAnalysis: true, analysisError: null, evidence, proposals }).status).toBe('running');
    expect(previousStepEvidenceLabel(mission, null, evidence)).toBe('尚无上一步证据');
  });

  it('reports the restored task status returned by Main without downgrading a completed effect chain', () => {
    expect(missionRestoreFeedback({ status: 'completed', phase: 'effect' })).toContain('完成状态、效果阶段与证据链保持不变');
    expect(missionRestoreFeedback({ status: 'paused', phase: 'analysis' })).toBe('运营任务已恢复为暂停状态。');
  });

  it('refreshes the analysis projection, task phase and flight-plan lineage as one completion receipt', async () => {
    const missionApi = createPreviewMissionDomainApi();
    const analysisApi = createPreviewAnalysisAuthorityApi();
    const seededMissions = await missionApi.listMissions(context, { includeArchived: false });
    const currentMission = seededMissions.find((item) => item.status === 'active')!;
    const mission = await missionApi.transitionMission(context, {
      id: currentMission.id,
      expectedRevision: currentMission.revision,
      status: 'active',
      phase: 'decision',
      reason: '分析完成',
      actorId: 'analysis-agent',
    });
    await missionApi.appendMissionCheckpoint(context, {
      id: `CHECKPOINT-${mission.id}-ANALYSIS-COMPLETE`,
      missionId: mission.id,
      stage: 'ANALYSIS',
      title: '分析完成，形成可复核建议',
      status: 'completed',
      evidenceCount: 2,
      actorId: 'analysis-agent',
    });

    const receipt = await refreshMissionAnalysisReceipt({
      analysisApi,
      context,
      includeArchived: false,
      missionApi,
      missionId: mission.id,
    });

    expect(receipt.analysis.evidencePackages).not.toHaveLength(0);
    expect(receipt.missions.find((item) => item.id === mission.id)).toMatchObject({ phase: 'decision' });
    expect(receipt.lineage.mission.id).toBe(mission.id);
    expect(receipt.lineage.causalEvents).toEqual(expect.any(Array));
    expect(receipt.lineage.checkpoints).toContainEqual(expect.objectContaining({
      stage: 'ANALYSIS',
      title: '分析完成，形成可复核建议',
    }));
  });

  it('distinguishes newly created, refreshed and reused recommendations in the completion receipt', () => {
    expect(missionRecommendationSummaryLabel({
      candidates: 6,
      created: 2,
      refreshed: 1,
      reused: 3,
    })).toBe('本次识别 6 条候选：新建 2 条、刷新 1 条、复用已有 3 条。');
  });

  it('projects a persisted successful analysis run into one operator receipt', () => {
    const receipts = missionAnalysisRunReceipts([
      analysisRunEvent({
        eventType: 'analysis_run_started',
        entityId: 'analysis-run-1',
        sequence: 10,
        status: 'running',
        title: '分析已开始',
        createdAt: '2026-08-28T01:00:00.000Z',
      }),
      analysisRunEvent({
        eventType: 'analysis_run_completed',
        entityId: 'analysis-run-1',
        sequence: 11,
        status: 'completed',
        title: '分析已完成',
        signal: '形成 4 条可复核建议；规则与 AI 一致。',
        createdAt: '2026-08-28T01:01:00.000Z',
      }),
    ], context.sessionGeneration);

    expect(receipts).toEqual([expect.objectContaining({
      id: 'analysis-run-1',
      status: 'completed',
      statusLabel: '已完成',
      startedAt: '2026-08-28T01:00:00.000Z',
      finishedAt: '2026-08-28T01:01:00.000Z',
      detail: '形成 4 条可复核建议；规则与 AI 一致。',
      nextStep: '前往决策中心复核本次建议。',
    })]);
  });

  it('projects a persisted failed analysis run with its recovery action', () => {
    const receipts = missionAnalysisRunReceipts([
      analysisRunEvent({
        eventType: 'analysis_run_started',
        entityId: 'analysis-run-failed',
        sequence: 20,
        status: 'running',
        title: '分析已开始',
        createdAt: '2026-08-28T02:00:00.000Z',
      }),
      analysisRunEvent({
        eventType: 'analysis_run_failed',
        entityId: 'analysis-run-failed',
        sequence: 21,
        status: 'failed',
        title: '分析未完成',
        signal: '请检查 AI 与策略配置后重试。',
        createdAt: '2026-08-28T02:01:00.000Z',
      }),
    ], context.sessionGeneration);

    expect(receipts).toEqual([expect.objectContaining({
      id: 'analysis-run-failed',
      status: 'failed',
      statusLabel: '失败',
      detail: '请检查 AI 与策略配置后重试。',
      nextStep: '按失败原因处理后重新运行分析。',
    })]);
  });

  it('derives an interrupted receipt from an orphaned run in an older session', () => {
    const receipts = missionAnalysisRunReceipts([
      analysisRunEvent({
        eventType: 'analysis_run_started',
        entityId: 'analysis-run-interrupted',
        sequence: 30,
        status: 'running',
        title: '分析已开始',
        sessionGeneration: context.sessionGeneration - 1,
        createdAt: '2026-08-28T03:00:00.000Z',
      }),
    ], context.sessionGeneration);

    expect(receipts).toEqual([expect.objectContaining({
      id: 'analysis-run-interrupted',
      status: 'interrupted',
      statusLabel: '已中断',
      detail: '上次分析没有完成回执。',
      nextStep: '刷新当前店铺后重新运行分析。',
    })]);
  });

  it('renders persisted analysis history as an operator table without exposing run ids', () => {
    const markup = renderToStaticMarkup(<MissionAnalysisRunHistory receipts={[{
      id: 'analysis-run-internal-1',
      status: 'completed',
      statusLabel: '已完成',
      startedAt: '2026-08-28T01:00:00.000Z',
      finishedAt: '2026-08-28T01:01:00.000Z',
      detail: '形成 4 条可复核建议。',
      nextStep: '前往决策中心复核本次建议。',
    }]} />);

    expect(markup).toContain('<table');
    expect(ordinaryText(markup)).toContain('分析运行记录 已完成 形成 4 条可复核建议。 前往决策中心复核本次建议。');
    expect(ordinaryText(markup)).not.toContain('analysis-run-internal-1');
    expect(markup).toContain('runId=analysis-run-internal-1');
  });

  it('binds displayed evidence and proposals to the same latest successful action batch', async () => {
    const missionApi = createPreviewMissionDomainApi();
    const analysisApi = createPreviewAnalysisAuthorityApi();
    const mission = (await missionApi.listMissions(context, { includeArchived: false }))[0];
    const projection = await analysisApi.getMissionProjection(context, mission.id);
    const latestBatch = projection.actionBatches[0];
    const boundEvidence = projection.evidencePackages.find((item) => item.id === latestBatch.evidencePackageId)!;
    const orphanEvidence = {
      ...boundEvidence,
      id: 'evidence-from-newer-failed-attempt',
      packageHash: 'f'.repeat(64),
    };

    const result = latestMissionAnalysisResult({
      ...projection,
      evidencePackages: [orphanEvidence, ...projection.evidencePackages],
    });

    expect(result.actionBatch?.id).toBe(latestBatch.id);
    expect(result.evidence?.id).toBe(latestBatch.evidencePackageId);
    expect(result.evidence?.id).not.toBe(orphanEvidence.id);
    expect(result.proposals.every((proposal) => proposal.actionBatchId === latestBatch.id)).toBe(true);
  });

  it('does not display an older analysis batch after the Mission revision changes', async () => {
    const missionApi = createPreviewMissionDomainApi();
    const analysisApi = createPreviewAnalysisAuthorityApi();
    const mission = (await missionApi.listMissions(context, { includeArchived: false }))[0];
    const projection = await analysisApi.getMissionProjection(context, mission.id);
    const latestBatch = projection.actionBatches[0];

    const result = latestMissionAnalysisResult(projection, latestBatch.missionRevision + 1);

    expect(result).toEqual({
      actionBatch: null,
      evidence: null,
      proposals: [],
      stale: true,
    });
  });

  it('reloads the persisted failed run receipt without requiring a page refresh', async () => {
    const missionApi = createPreviewMissionDomainApi();
    const mission = (await missionApi.listMissions(context, { includeArchived: false }))[0];
    const baseLineage = await missionApi.getMissionLineage(context, mission.id);
    const failedEvent = analysisRunEvent({
      eventType: 'analysis_run_failed',
      entityId: 'analysis-run-failed-refresh',
      missionId: mission.id,
      sequence: 41,
      status: 'failed',
      title: '分析未完成',
      signal: '请检查 AI 与策略配置后重试。',
      createdAt: '2026-08-28T04:01:00.000Z',
    });

    const refreshed = await refreshMissionAnalysisFailureReceipt({
      context,
      missionApi: {
        getMissionLineage: async () => ({
          ...baseLineage,
          causalEvents: [failedEvent],
        }),
      },
      missionId: mission.id,
    });

    expect(refreshed.causalEvents).toContainEqual(failedEvent);
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
