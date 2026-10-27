import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeCausalExportText } from '@amazon-ai-ops/shared-types';
import { toUserFacingError } from '../../user-facing-error';
import {
  ArrowRight,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  FileText,
  PencilSimple,
  Plus,
  Prohibit,
  ShieldCheck,
  ThumbsDown,
  X,
} from '@phosphor-icons/react';
import {
  canonicalizeAmazonAsin,
  missionControlContextKey,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type BindRecommendationWritableTargetRequest,
  type BindRecommendationWritableTargetResult,
  type CreateDecisionInput,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type MissionControlCapabilityProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionAnalysisProjection,
  type RunMissionAnalysisRequest,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  assertDecisionBelongsToContext,
  assertMissionAuthorityContext,
  readDecisionDomainWindowApi,
  type DecisionDomainRendererApi,
  type HumanDecisionResolutionInput,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';
import { type DecisionWorkspaceView, type AnalysisActionBatchOption } from './decision-workspace-contracts';

export const OPERATOR = 'desktop-operator';

export const PAGE_SIZE = 6;

export const STATUS_LABELS: Record<DecisionStatus, string> = {
  proposed: '待复核',
  needs_approval: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  blocked: '已阻断',
  superseded: '已替代',
  executed: '已执行',
  verified: '已回读',
};

export const VIEW_COPY: Record<DecisionWorkspaceView, { title: string; description: string; task: string; taskDescription: string }> = {
  'decisions/recommendations': { title: 'AI 建议', description: '查看由事实与策略版本生成的建议；建议本身不代表已获执行授权。', task: '先把建议修订成可核验决策', taskDescription: '补齐事实、替代方案、预期效果与有效期，再送入人工审批。' },
  'decisions/approval': { title: '人工审批', description: '逐条确认边界；批准只形成经营决策状态，不代表已写入 Amazon Ads。', task: '处理等待人工决议的经营决策', taskDescription: '批准、拒绝、阻断或替代都必须记录原因，并形成只追加的历史。' },
  'decisions/decided': { title: '已决策', description: '回看已批准、拒绝、阻断与替代的历史决策和人工授权。', task: '复核已决策记录与授权边界', taskDescription: '已决策内容不可覆盖；如经营事实变化，应创建新的经营决策版本链。' },
};

export function decisionActionVisibility(view: DecisionWorkspaceView, status: DecisionStatus): {
  revise: boolean;
  resolve: boolean;
} {
  return {
    revise: view === 'decisions/recommendations' && (status === 'proposed' || status === 'blocked'),
    resolve: view === 'decisions/approval' && status === 'needs_approval',
  };
}

export function message(error: unknown): string {
  const fallback = '经营决策操作未完成，请刷新后重试。';
  return decisionOperatorCopy(toUserFacingError(error, fallback), fallback);
}

export function split(value: string): string[] {
  return value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
}

export function plusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function decisionCapabilityReady(
  rows: readonly MissionControlCapabilityProjection[] | undefined,
  id: string,
  view: DecisionWorkspaceView,
  previewMode: boolean,
): boolean {
  const row = rows?.find((item) => item.capabilityId === id && item.view === view);
  return row?.state === (previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE');
}

export function preferredDecisionId(view: DecisionWorkspaceView, rows: readonly DecisionRecord[]): string {
  const preferredStatus = view === 'decisions/recommendations'
    ? 'proposed'
    : view === 'decisions/approval'
      ? 'needs_approval'
      : 'approved';
  return rows.find((item) => item.status === preferredStatus)?.id ?? rows[0]?.id ?? '';
}

export function preferredDecisionIdAfterTargetVerification(
  currentDecisionId: string,
  verifiedProposalId: string,
  projection: MissionAnalysisProjection,
  decisions: readonly DecisionRecord[],
  view: DecisionWorkspaceView,
): string {
  const linkedDecisionId = projection.decisionLinks.find((link) => (
    link.proposalId === verifiedProposalId
    && decisions.some((decision) => decision.id === link.decisionId)
  ))?.decisionId;
  if (linkedDecisionId) return linkedDecisionId;
  return decisions.some((decision) => decision.id === currentDecisionId)
    ? currentDecisionId
    : preferredDecisionId(view, decisions);
}

export const AUTHORIZATION_STATUS_PRIORITY: Partial<Record<DecisionStatus, number>> = {
  needs_approval: 0,
  proposed: 1,
  approved: 2,
};

export function authorizationMissionIds(rows: readonly DecisionRecord[]): string[] {
  const candidates = rows
    .map((record, index) => ({ record, index, priority: AUTHORIZATION_STATUS_PRIORITY[record.status] }))
    .filter((item): item is typeof item & { priority: number } => item.priority !== undefined)
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
  return [...new Set(candidates.map(({ record }) => record.missionId).filter(Boolean))];
}

export function analysisActionBatchOptions(
  projection: MissionAnalysisProjection | null,
): AnalysisActionBatchOption[] {
  if (!projection) return [];
  const latest = [...projection.actionBatches].sort((left, right) => (
    right.actionRevision - left.actionRevision
    || right.createdAt.localeCompare(left.createdAt)
    || right.id.localeCompare(left.id)
  ))[0];
  if (!latest) return [];
  return [{
    id: latest.id,
    proposalCount: projection.proposals.filter((proposal) => proposal.actionBatchId === latest.id).length,
    latestCreatedAt: latest.createdAt,
  }];
}

export function buildAnalysisBatchAuthorizationRequest(
  context: StoreContextEnvelope,
  missionId: string,
  actionBatchId: string,
  projection: MissionAnalysisProjection | null,
): AuthorizeAnalysisProposalBatchRequest {
  assertMissionAuthorityContext(context);
  if (!missionId.trim() || !actionBatchId.trim() || !projection) {
    throw new Error('请选择已加载的 Mission 与动作批次。');
  }
  assertAnalysisProjectionBelongsToContext(context, missionId, projection);
  const proposals = projection.proposals.filter((proposal) => proposal.actionBatchId === actionBatchId);
  if (proposals.length === 0) throw new Error('所选动作批次没有可授权建议。');
  if (proposals.some((proposal) => (
    String(proposal.storeId) !== String(context.storeId) || proposal.missionId !== missionId
  ))) {
    throw new Error('动作批次包含跨店铺或错误 Mission 的建议。');
  }
  return {
    context,
    missionId,
    proposalIds: proposals.map((proposal) => proposal.id),
  };
}

export function formatDecisionMoney(value: unknown, linkedProposalCents?: number): string {
  if (linkedProposalCents !== undefined && Number.isFinite(linkedProposalCents)) {
    return `$${(linkedProposalCents / 100).toFixed(2)}`;
  }
  return typeof value !== 'number' || !Number.isFinite(value) ? '—' : `$${value.toFixed(2)}`;
}

export function decisionRevisionDisplayLabel(revision: number): string {
  void revision;
  return '版本已校验';
}

export function decisionFactProjection(facts: readonly string[]): {
  diagnosticFacts: string[];
  operatorFacts: string[];
} {
  const diagnosticFacts: string[] = [];
  const operatorFacts: string[] = [];
  const appendOperatorFact = (fact: string) => {
    if (!operatorFacts.includes(fact)) operatorFacts.push(fact);
  };

  for (const rawFact of facts) {
    const fact = sanitizeCausalExportText(rawFact.trim());
    if (!fact) continue;
    if (/^evidence-package:/i.test(fact)) {
      diagnosticFacts.push(fact);
      appendOperatorFact('证据包已锁定');
      continue;
    }
    if (/^(?:rule|model)-revision:/i.test(fact)) {
      diagnosticFacts.push(fact);
      appendOperatorFact('规则与模型版本已校验');
      continue;
    }
    if (/^proposal-source:/i.test(fact)) {
      diagnosticFacts.push(fact);
      appendOperatorFact(/:rule_ai$/i.test(fact) ? '规则与 AI 分析一致' : '分析来源已记录，需人工复核');
      continue;
    }
    appendOperatorFact(fact);
  }

  return { diagnosticFacts, operatorFacts };
}

export function DecisionEvidenceFacts({ facts }: { facts: readonly string[] }): React.ReactElement {
  const projection = decisionFactProjection(facts);
  return <>
    {projection.operatorFacts.length
      ? <ul data-evidence-status="attached">{projection.operatorFacts.map((fact) => <li key={fact}><FileText size={15} />{fact}</li>)}</ul>
      : <p>未记录可核验事实。</p>}
    {projection.diagnosticFacts.length > 0 && <details><summary>诊断详情</summary>{projection.diagnosticFacts.map((fact) => <code key={fact}>{fact}</code>)}</details>}
  </>;
}

export function decisionListScopeLabel(record: Pick<DecisionRecord, 'productId' | 'actionType'>): string {
  const scope = record.productId ? '指定产品' : '店铺级';
  const action = record.actionType === 'set_keyword_bid' ? '调整关键词竞价' : '其他受控动作';
  return `${scope} · ${action}`;
}

export const DECISION_INTERNAL_OPERATOR_COPY = /(?:^|[^A-Za-z0-9])(?:Main|StoreContext|Authority|Renderer|Profile|MissionGrant|Mission|Decision|Experiment|UNKNOWN|revision|draft|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|DECISION|ACTION|READBACK|EFFECT|adapter)(?:$|[^A-Za-z0-9])/i;

export function decisionOperatorCopy(value: unknown, fallback: string): string {
  const normalized = sanitizeCausalExportText(String(value ?? '').trim()).replace(/\s+/g, ' ');
  return !normalized || DECISION_INTERNAL_OPERATOR_COPY.test(normalized) ? sanitizeCausalExportText(fallback) : normalized;
}

export function targetVerificationOperatorError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  if (/Mission changed while its analysis was running|analysis date range does not match|scope must equal the Mission data-batch date range/i.test(detail)) {
    return '核验 Ads 对象时，运营任务或数据批次已变化；请刷新当前店铺，重新运行分析后再核验。';
  }
  return decisionOperatorCopy(
    detail,
    'Ads 对象核验未完成；请刷新当前店铺，确认数据批次与 Ads 连接后再重试。',
  );
}

export function decisionHistoryEventLabel(eventType: string): string {
  if (eventType === 'created') return '已创建';
  if (eventType === 'revised') return '已修订';
  if (eventType === 'resolved') return '已决议';
  return '决策记录已更新';
}

export function grantTerminalDisplayLabel(eventType?: string): string {
  if (eventType === 'historical') return '历史授权，仅供查阅';
  if (eventType === 'invalidated') return '剩余授权已失效';
  if (eventType === 'revoked') return '已撤销';
  if (eventType === 'consumed') return '已消费';
  if (eventType === 'expired') return '已过期';
  return '有效';
}

export function proposalAuthorizationLabel(proposal: AnalysisProposalSnapshotRecord): string {
  const blockerLabel = (value: string, subject: string) => decisionOperatorCopy(
    value,
    `${subject}条件未满足，请核对当前店铺证据后重试`,
  );
  const human = proposal.authorization.human.eligible
    ? '人工可授权'
    : `人工阻断：${[...new Set(proposal.authorization.human.blockers.map((item) => blockerLabel(item, '人工授权')))].join(' · ')}`;
  const policy = proposal.authorization.policy.eligible
    ? '策略内自动可授权'
    : `策略阻断：${[...new Set(proposal.authorization.policy.blockers.map((item) => blockerLabel(item, '策略授权')))].join(' · ')}`;
  return `${human} · ${policy}`;
}

export function responseMatchesDecisionDetail(
  currentAuthorityKey: string,
  capturedAuthorityKey: string,
  currentSelectedId: string,
  capturedSelectedId: string,
  currentSequence: number,
  capturedSequence: number,
): boolean {
  return currentAuthorityKey === capturedAuthorityKey
    && currentSelectedId === capturedSelectedId
    && currentSequence === capturedSequence;
}
