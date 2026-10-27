import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  missionControlContextKey,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type CausalEventRecord,
  type MissionAnalysisProjection,
  type AppendMissionCheckpointInput,
  type CreateMissionInput,
  type MissionCheckpointRecord,
  type MissionControlCapabilityAction,
  type MissionControlCapabilityProjection,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionPhase,
  type MissionPriority,
  type MissionRecord,
  type PolicyRecord,
  type PolicyVersionRecord,
  type StoreContextEnvelope,
  type UpdateMissionInput,
} from '@amazon-ai-ops/shared-types';
import {
  assertMissionBelongsToContext,
  assertMissionAuthorityContext,
  readMissionDomainWindowApi,
  readPolicyDomainWindowApi,
  type MissionDomainRendererApi,
  type MissionLineageProjection,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';
import {
  operatorFacingBlocker,
  PHASE_LABELS,
} from './mission-workspace-model';
import {
  type BoundMissionAdsObject,
  type MissionAnalysisRunView,
  type MissionAnalysisRunStatus,
  type MissionAnalysisRunReceipt,
} from './mission-workspace-contracts';

export const ANALYSIS_BLOCKER_TRANSLATIONS: Record<string, string> = {
  UNSUPPORTED_ACTION: '当前动作类型不受支持',
  MISSING_STABLE_AD_ENTITY: '缺少可稳定回读的广告对象，请先从当前 Ads 页面识别并绑定后重试',
  STALE_AD_ENTITY_REVISION: '广告对象身份版本已变化，请重新核验后重试',
  EVIDENCE_STALE: '分析证据已过期，请重新运行分析',
  EVIDENCE_BATCH_MISMATCH: '证据包与本任务数据批次不一致',
  RULE_REVISION_MISMATCH: '规则版本已变化，请重新运行分析',
  POLICY_REVISION_MISMATCH: '策略版本已变化，请重新运行分析',
  AI_RULE_CONFLICT: '规则与 AI 结论不一致，需人工复核',
  REVIEW_REQUIRED: '需要人工复核后才能授权',
  RULE_FALLBACK_NOT_AUTHORIZABLE: 'AI 降级结果不可授权',
  AI_ONLY_NOT_POLICY_AUTHORIZABLE: '仅 AI 建议不可由策略自动授权',
  POLICY_REQUIRES_RULE_AI_ALIGNMENT: '策略要求规则与 AI 一致',
  CHANGE_LIMIT_EXCEEDED: '建议变化超过策略上限，请刷新数据或调整为策略允许范围后再试',
  POLICY_PRIORITY_MISMATCH: '当前建议未命中数字最小的优先策略，请重新运行分析后再授权',
  POLICY_ENTITY_NOT_ALLOWED: '策略不允许该广告对象',
  POLICY_ACTION_NOT_ALLOWED: '策略不允许该动作',
  POLICY_RUNTIME_BLOCKED: '策略运行时已阻断自动授权',
};

export const KNOWN_ANALYSIS_BLOCKER_CODES = Object.keys(ANALYSIS_BLOCKER_TRANSLATIONS);

export const MISSION_PHASE_ORDER: readonly MissionPhase[] = ['fact', 'analysis', 'decision', 'action', 'readback', 'effect'];

export function extractKnownAnalysisFailureCodes(value: string): string[] {
  const text = String(value || '');
  return KNOWN_ANALYSIS_BLOCKER_CODES.filter((code) => text === code || text.includes(code));
}

export function missionAnalysisBlockerLabel(value: string): string {
  const original = String(value || '').trim();
  if (!original) return '';
  const code = extractKnownAnalysisFailureCodes(original)[0];
  return code
    ? `${code} · ${ANALYSIS_BLOCKER_TRANSLATIONS[code] ?? code}`
    : operatorFacingBlocker(original, '策略自动授权');
}

export function missionPathFailureText(error: unknown, fallbackSubject = '运营任务'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? '';
  const codes = extractKnownAnalysisFailureCodes(firstLine);
  if (codes.length) return codes.map((code) => missionAnalysisBlockerLabel(code)).join('；');
  if (/analysis blocked|evidence package|importRunId|Ads 对象|CHANGE_|MISSING_STABLE|核验/i.test(firstLine)) return firstLine;
  if (!firstLine || /^(失败[。.]?)$/.test(firstLine)) return `${fallbackSubject}未完成；请查看原始失败代码后重试。`;
  return operatorFacingBlocker(firstLine, fallbackSubject);
}

export function latestEvidencePackageForMission(
  packages: readonly AnalysisEvidencePackageRecord[] | undefined,
  missionId: string,
  storeId: string,
): AnalysisEvidencePackageRecord | null {
  const rows = (packages ?? []).filter((row) => row.missionId === missionId && String(row.storeId) === String(storeId));
  return rows.length ? [...rows].sort((left, right) => right.sealedAt.localeCompare(left.sealedAt))[0] ?? null : null;
}

export function boundAdsObjectsForMission(
  missionId: string,
  storeId: string,
  evidence: AnalysisEvidencePackageRecord | null,
  proposals: readonly AnalysisProposalSnapshotRecord[],
): BoundMissionAdsObject[] {
  if (!evidence || evidence.missionId !== missionId || String(evidence.storeId) !== String(storeId) || !evidence.importRunId.trim()) return [];
  return proposals
    .filter((proposal) => proposal.missionId === missionId
      && String(proposal.storeId) === String(storeId)
      && proposal.evidencePackageId === evidence.id
      && Boolean(proposal.entityName.trim() || proposal.adEntityId))
    .map((proposal) => ({
      key: proposal.adEntityId || proposal.id,
      entityName: proposal.entityName,
      campaignName: proposal.campaignName,
      adGroupName: proposal.adGroupName,
      importRunId: evidence.importRunId,
      evidencePackageId: evidence.id,
      status: '待核验' as const,
    }));
}

export function projectMissionAnalysisRun(input: {
  mission: MissionRecord;
  storeId: string;
  pendingAnalysis: boolean;
  analysisError: string | null;
  evidence: AnalysisEvidencePackageRecord | null;
  proposals: readonly AnalysisProposalSnapshotRecord[];
}): MissionAnalysisRunView {
  const evidence = input.evidence && input.evidence.missionId === input.mission.id && String(input.evidence.storeId) === String(input.storeId)
    ? input.evidence
    : null;
  const proposals = input.proposals.filter((row) => row.missionId === input.mission.id
    && String(row.storeId) === String(input.storeId)
    && (!evidence || row.evidencePackageId === evidence.id));
  const failureCodes = [...new Set([
    ...extractKnownAnalysisFailureCodes(input.analysisError ?? ''),
    ...proposals.flatMap((row) => [...row.authorization.human.blockers, ...row.authorization.policy.blockers]),
  ].filter(Boolean))];
  const status: MissionAnalysisRunStatus = input.pendingAnalysis ? 'running' : input.analysisError ? 'retryable' : evidence ? 'completed' : 'idle';
  return {
    status,
    statusLabel: status === 'running' ? '运行中' : status === 'completed' ? '已完成' : status === 'retryable' ? '可重试' : '未运行',
    phase: input.mission.phase,
    phaseLabel: PHASE_LABELS[input.mission.phase],
    dataBatchId: evidence?.dataBatchId || input.mission.dataBatchId,
    dateFrom: evidence?.dateFrom ?? '',
    dateTo: evidence?.dateTo ?? '',
    importRunId: evidence?.importRunId ?? '',
    evidencePackageId: evidence?.id ?? '',
    proposalCount: proposals.length,
    failureCodes,
    failureText: failureCodes.map((code) => missionAnalysisBlockerLabel(code)).join('；'),
  };
}

export function previousStepEvidenceLabel(
  mission: MissionRecord,
  lineage: MissionLineageProjection | null,
  evidence: AnalysisEvidencePackageRecord | null,
): string {
  const factCount = lineage?.checkpoints.filter((item) => item.stage === 'FACT' && item.missionId === mission.id).length ?? 0;
  if (mission.phase === 'analysis') return factCount ? `事实检查点 ${factCount} 条` : '尚无上一步证据';
  if (MISSION_PHASE_ORDER.indexOf(mission.phase) > MISSION_PHASE_ORDER.indexOf('analysis') && evidence?.missionId === mission.id) return `分析证据 ${evidence.dateFrom} → ${evidence.dateTo}`;
  return factCount ? `事实检查点 ${factCount} 条` : '尚无上一步证据';
}

export function missionRecommendationSummaryLabel(summary: {
  candidates: number;
  created: number;
  refreshed: number;
  reused: number;
}): string {
  return `本次识别 ${summary.candidates} 条候选：新建 ${summary.created} 条、刷新 ${summary.refreshed} 条、复用已有 ${summary.reused} 条。`;
}

export function missionAnalysisRunReceipts(
  events: readonly CausalEventRecord[],
  currentSessionGeneration: number,
): MissionAnalysisRunReceipt[] {
  const byRun = new Map<string, CausalEventRecord[]>();
  const relevantEvents = events.filter((event) => event.entityType === 'analysis_run'
    && ['analysis_run_started', 'analysis_run_completed', 'analysis_run_failed'].includes(event.eventType));
  const latestStartedSequence = relevantEvents
    .filter((event) => event.eventType === 'analysis_run_started')
    .reduce((latest, event) => Math.max(latest, event.sequence), -1);
  relevantEvents.forEach((event) => {
      const grouped = byRun.get(event.entityId) ?? [];
      grouped.push(event);
      byRun.set(event.entityId, grouped);
    });
  return [...byRun.entries()].flatMap<MissionAnalysisRunReceipt>(([id, grouped]) => {
    const ordered = [...grouped].sort((left, right) => left.sequence - right.sequence);
    const started = ordered.find((event) => event.eventType === 'analysis_run_started');
    const terminal = [...ordered].reverse().find((event) => (
      event.eventType === 'analysis_run_completed' || event.eventType === 'analysis_run_failed'
    ));
    if (!started) return [];
    if (!terminal) {
      const running = started.sessionGeneration === currentSessionGeneration
        && started.sequence === latestStartedSequence;
      return [{
        id,
        status: running ? 'running' as const : 'interrupted' as const,
        statusLabel: running ? '分析中' : '已中断',
        startedAt: started.createdAt,
        detail: running
          ? (started.signal ?? '本次分析正在进行。')
          : '上次分析没有完成回执。',
        nextStep: running
          ? '等待本次分析完成；可继续查看其他任务。'
          : '刷新当前店铺后重新运行分析。',
      }];
    }
    if (terminal.eventType === 'analysis_run_failed') {
      return [{
        id,
        status: 'failed' as const,
        statusLabel: '失败',
        startedAt: started.createdAt,
        finishedAt: terminal.createdAt,
        detail: terminal.signal ?? '分析未完成；请刷新当前店铺后重试。',
        nextStep: '按失败原因处理后重新运行分析。',
      }];
    }
    return [{
      id,
      status: 'completed' as const,
      statusLabel: '已完成',
      startedAt: started.createdAt,
      finishedAt: terminal.createdAt,
      detail: terminal.signal ?? '分析已完成，结果已绑定当前任务。',
      nextStep: '前往决策中心复核本次建议。',
    }];
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function analysisRunTime(timestamp: string | undefined): string {
  return timestamp ? timestamp.slice(0, 16).replace('T', ' ') : '尚未结束';
}

export function MissionAnalysisRunHistory({
  receipts,
}: {
  receipts: readonly MissionAnalysisRunReceipt[];
}) {
  return (
    <section className="mission-domain-analysis-runs" aria-label="分析运行记录">
      <h4>分析运行记录</h4>
      {receipts.length ? (
        <div className="mission-domain-analysis-runs__table">
          <table aria-label="当前运营任务分析运行记录">
            <tbody>
              {receipts.slice(0, 5).map((receipt) => (
                <tr data-status={receipt.status} key={receipt.id}>
                  <th scope="row"><span>{receipt.statusLabel}</span></th>
                  <td data-label="结果"><p>{receipt.detail}</p></td>
                  <td data-label="下一步"><p>{receipt.nextStep}</p></td>
                  <td data-label="时间"><small>开始 {analysisRunTime(receipt.startedAt)}</small><small>结束 {analysisRunTime(receipt.finishedAt)}</small></td>
                  <td className="mission-domain-analysis-runs__diagnostics"><details className="mission-domain-diagnostics"><summary>诊断详情</summary><code>runId={receipt.id}</code></details></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>尚无分析运行记录；点击“运行分析”后会保留开始、完成或失败回执。</p>}
    </section>
  );
}

export function latestMissionAnalysisResult(
  projection: MissionAnalysisProjection,
  currentMissionRevision?: number,
): {
  actionBatch: MissionAnalysisProjection['actionBatches'][number] | null;
  evidence: MissionAnalysisProjection['evidencePackages'][number] | null;
  proposals: MissionAnalysisProjection['proposals'][number][];
  stale: boolean;
} {
  const actionBatch = projection.actionBatches[0] ?? null;
  if (!actionBatch) return { actionBatch: null, evidence: null, proposals: [], stale: false };
  if (currentMissionRevision !== undefined && actionBatch.missionRevision !== currentMissionRevision) {
    return { actionBatch: null, evidence: null, proposals: [], stale: true };
  }
  return {
    actionBatch,
    evidence: projection.evidencePackages.find((item) => item.id === actionBatch.evidencePackageId) ?? null,
    proposals: projection.proposals.filter((proposal) => proposal.actionBatchId === actionBatch.id),
    stale: false,
  };
}

export function missionGuardrailLabel(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '结果不确定时立即停止并人工核对';
  return normalized
    .replace(/\bUNKNOWN\b/gi, '结果不确定')
    .replace(/\bMain\b/gi, '本机安全进程')
    .replace(/\bStoreContext\b/gi, '当前店铺范围')
    .replace(/\bMission\b/gi, '运营任务')
    .replace(/\bExperiment\b/gi, '经营实验')
    .replace(/\bDecision\b/gi, '经营决策')
    .replace(/\bAuthority\b/gi, '授权')
    .replace(/\bRenderer\b/gi, '界面')
    .replace(/\brevision\b/gi, '版本')
    .replace(/\bdraft\b/gi, '草稿')
    .replace(/\bset_keyword_bid\b/gi, '调整关键词竞价')
    .replace(/\bPRODUCTION_NATIVE\b/g, '生产能力')
    .replace(/\bPROTOTYPE_ONLY\b/g, '开发预览能力')
    .replace(/\bBLOCKED\b/g, '已阻断')
    .replace(/\s+/g, ' ');
}

export function datePart(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export function asTimestamp(date: string): string {
  return new Date(`${date}T07:00:00.000Z`).toISOString();
}

export async function refreshMissionAnalysisReceipt({
  analysisApi,
  context,
  includeArchived,
  missionApi,
  missionId,
}: {
  analysisApi: Pick<AnalysisAuthorityRendererApi, 'getMissionProjection'>;
  context: StoreContextEnvelope;
  includeArchived: boolean;
  missionApi: Pick<MissionDomainRendererApi, 'getMissionLineage' | 'listMissions'>;
  missionId: string;
}): Promise<{
  analysis: MissionAnalysisProjection;
  lineage: MissionLineageProjection;
  missions: MissionRecord[];
}> {
  assertMissionAuthorityContext(context);
  const [analysis, missions, lineage] = await Promise.all([
    analysisApi.getMissionProjection(context, missionId),
    missionApi.listMissions(context, { includeArchived }),
    missionApi.getMissionLineage(context, missionId),
  ]);
  assertAnalysisProjectionBelongsToContext(context, missionId, analysis);
  missions.forEach((mission) => assertMissionBelongsToContext(mission, context));
  if (!missions.some((mission) => mission.id === missionId)) {
    throw new Error('分析完成，但当前店铺任务列表未返回对应运营任务。');
  }
  assertMissionBelongsToContext(lineage.mission, context);
  if (lineage.mission.id !== missionId
    || lineage.checkpoints.some((item) => String(item.storeId) !== String(context.storeId) || item.missionId !== missionId)
    || lineage.links.some((item) => String(item.storeId) !== String(context.storeId) || item.missionId !== missionId)
    || (lineage.causalEvents ?? []).some((item) => String(item.storeId) !== String(context.storeId) || item.missionId !== missionId)) {
    throw new Error('分析完成，但任务进度来源链与当前店铺或运营任务不一致。');
  }
  return { analysis, lineage, missions };
}

export async function refreshMissionAnalysisFailureReceipt({
  context,
  missionApi,
  missionId,
}: {
  context: StoreContextEnvelope;
  missionApi: Pick<MissionDomainRendererApi, 'getMissionLineage'>;
  missionId: string;
}): Promise<MissionLineageProjection> {
  assertMissionAuthorityContext(context);
  const lineage = await missionApi.getMissionLineage(context, missionId);
  assertMissionBelongsToContext(lineage.mission, context);
  if (lineage.mission.id !== missionId
    || lineage.checkpoints.some((item) => String(item.storeId) !== String(context.storeId) || item.missionId !== missionId)
    || lineage.links.some((item) => String(item.storeId) !== String(context.storeId) || item.missionId !== missionId)
    || (lineage.causalEvents ?? []).some((item) => String(item.storeId) !== String(context.storeId) || item.missionId !== missionId)) {
    throw new Error('分析失败回执与当前店铺或运营任务不一致。');
  }
  return lineage;
}
