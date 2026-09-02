import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  missionControlContextKey,
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
  type ReviseDecisionInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
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
import './decisions-workspace.css';

const OPERATOR = 'desktop-operator';
const PAGE_SIZE = 6;

export type DecisionWorkspaceView = 'decisions/recommendations' | 'decisions/approval' | 'decisions/decided';

export type DecisionsWorkspaceProps = {
  apiOverride?: DecisionDomainRendererApi;
  analysisApiOverride?: AnalysisAuthorityRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
  view: DecisionWorkspaceView;
};

type DiscoveredRecommendationTarget = {
  recommendationId: number;
  recommendationRevision: number;
  pageIdentity: {
    adsAccountId: string;
    campaignId: string;
    adGroupId: string;
    keywordId: string;
    bidCents: number;
  };
  writableTarget: BindRecommendationWritableTargetRequest['binding']['writableTarget'];
};

type RecommendationTargetBindingRendererApi = {
  getOperationScope(context: StoreContextEnvelope): Promise<Record<string, unknown>>;
  executionAuthority: {
    discoverRecommendationTarget(input: {
      context: StoreContextEnvelope;
      recommendationId: number;
    }): Promise<DiscoveredRecommendationTarget>;
  };
  bindRecommendationWritableTarget(
    input: BindRecommendationWritableTargetRequest,
  ): Promise<BindRecommendationWritableTargetResult>;
};

function readRecommendationTargetBindingWindowApi(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): RecommendationTargetBindingRendererApi | null {
  const candidate = target as Partial<RecommendationTargetBindingRendererApi> | null;
  if (!candidate
    || typeof candidate.getOperationScope !== 'function'
    || typeof candidate.bindRecommendationWritableTarget !== 'function'
    || typeof candidate.executionAuthority?.discoverRecommendationTarget !== 'function') return null;
  return candidate as RecommendationTargetBindingRendererApi;
}

export function proposalHasVerifiedAdsAuthority(proposal: AnalysisProposalSnapshotRecord): boolean {
  return Boolean(
    proposal.adEntityAuthorityId
    && proposal.adEntityId
    && Number.isInteger(proposal.adEntityRevision)
    && Number(proposal.adEntityRevision) > 0,
  );
}

export function proposalIsSafeTargetVerificationCandidate(
  proposal: AnalysisProposalSnapshotRecord,
): boolean {
  const current = Number(proposal.currentBidCents);
  const proposed = Number(proposal.proposedBidCents);
  if (proposal.actionType !== 'set_keyword_bid'
    || proposal.entityType !== 'keyword'
    || !Number.isInteger(current)
    || !Number.isInteger(proposed)
    || current <= 0
    || proposed <= 0
    || proposed >= current) return false;
  return ((current - proposed) / current) * 100 <= 10.000001;
}

export function AnalysisProposalAuthorityStatus({
  busy,
  onVerify,
  proposal,
}: {
  busy: boolean;
  onVerify?: () => void;
  proposal: AnalysisProposalSnapshotRecord;
}) {
  if (proposalHasVerifiedAdsAuthority(proposal)) {
    return <small className="decision-domain-proposal-authority" data-verified>对象版本已校验</small>;
  }
  return <span className="decision-domain-proposal-authority" data-verified="false">
    <small>Ads 对象待核验</small>
    {onVerify && <button
      className="workspace-button workspace-button--secondary"
      disabled={busy}
      onClick={onVerify}
      type="button"
    >{busy ? '核验中…' : '核验 Ads 对象'}</button>}
  </span>;
}

export type DecisionDraft = {
  title: string;
  missionId: string;
  dataBatchId: string;
  policyVersionId: string;
  policyRevision: string;
  actionRevision: string;
  rationale: string;
  recommendation: string;
  facts: string;
  alternatives: string;
  expectedEffect: string;
  validUntil: string;
  actionType: string;
  adEntityId: string;
  productId: string;
  currentValue: string;
  recommendedValue: string;
  confidence: string;
  status: Extract<DecisionStatus, 'proposed' | 'needs_approval' | 'blocked'>;
};

const STATUS_LABELS: Record<DecisionStatus, string> = {
  proposed: '待复核',
  needs_approval: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  blocked: '已阻断',
  superseded: '已替代',
  executed: '已执行',
  verified: '已回读',
};

const VIEW_COPY: Record<DecisionWorkspaceView, { title: string; description: string; task: string; taskDescription: string }> = {
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

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '经营决策操作未完成，请刷新后重试。';
}

function split(value: string): string[] {
  return value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
}

function plusDays(date: string, days: number): string {
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

const AUTHORIZATION_STATUS_PRIORITY: Partial<Record<DecisionStatus, number>> = {
  needs_approval: 0,
  proposed: 1,
  approved: 2,
};

/**
 * Batch authorization is scoped by Mission, not by the Decision detail row that
 * happens to be selected. Keep policy-auto candidates ahead of already-approved
 * manual candidates while preserving repository order inside each status.
 */
export function authorizationMissionIds(rows: readonly DecisionRecord[]): string[] {
  const candidates = rows
    .map((record, index) => ({ record, index, priority: AUTHORIZATION_STATUS_PRIORITY[record.status] }))
    .filter((item): item is typeof item & { priority: number } => item.priority !== undefined)
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
  return [...new Set(candidates.map(({ record }) => record.missionId).filter(Boolean))];
}

export type AnalysisActionBatchOption = {
  id: string;
  proposalCount: number;
  latestCreatedAt: string;
};

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
    const fact = rawFact.trim();
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
      ? <ul>{projection.operatorFacts.map((fact) => <li key={fact}><CheckCircle size={15} weight="fill" />{fact}</li>)}</ul>
      : <p>未记录可核验事实。</p>}
    {projection.diagnosticFacts.length > 0 && <details><summary>诊断详情</summary>{projection.diagnosticFacts.map((fact) => <code key={fact}>{fact}</code>)}</details>}
  </>;
}

export function decisionListScopeLabel(record: Pick<DecisionRecord, 'productId' | 'actionType'>): string {
  const scope = record.productId ? '指定产品' : '店铺级';
  const action = record.actionType === 'set_keyword_bid' ? '调整关键词竞价' : '其他受控动作';
  return `${scope} · ${action}`;
}

const DECISION_INTERNAL_OPERATOR_COPY = /(?:^|[^A-Za-z0-9])(?:Main|StoreContext|Authority|Renderer|Profile|MissionGrant|Mission|Decision|Experiment|UNKNOWN|revision|draft|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|DECISION|ACTION|READBACK|EFFECT|adapter)(?:$|[^A-Za-z0-9])/i;

export function decisionOperatorCopy(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  return !normalized || DECISION_INTERNAL_OPERATOR_COPY.test(normalized) ? fallback : normalized;
}

function decisionHistoryEventLabel(eventType: string): string {
  if (eventType === 'created') return '已创建';
  if (eventType === 'revised') return '已修订';
  if (eventType === 'resolved') return '已决议';
  return '决策记录已更新';
}

function grantTerminalDisplayLabel(eventType?: string): string {
  if (eventType === 'revoked') return '已撤销';
  if (eventType === 'consumed') return '已消费';
  if (eventType === 'expired') return '已过期';
  return '有效';
}

function proposalAuthorizationLabel(proposal: AnalysisProposalSnapshotRecord): string {
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

function decisionDraft(context: StoreContextEnvelope, record?: DecisionRecord | null): DecisionDraft {
  return {
    title: record?.title ?? '',
    missionId: record?.missionId ?? '',
    dataBatchId: record?.dataBatchId ?? '',
    policyVersionId: record?.policyVersionId ?? '',
    policyRevision: String(record?.policyRevision ?? 1),
    actionRevision: String(record?.actionRevision ?? 1),
    rationale: record?.rationale ?? '',
    recommendation: record?.recommendation ?? '',
    facts: record?.facts.join('；') ?? '',
    alternatives: record?.alternatives.join('；') ?? '',
    expectedEffect: record?.expectedEffect ?? '',
    validUntil: record?.validUntil?.slice(0, 10) ?? plusDays(context.businessDate, 7),
    actionType: record?.actionType ?? 'set_keyword_bid',
    adEntityId: record?.adEntityId ?? '',
    productId: record?.productId ?? '',
    currentValue: record?.currentValue === undefined ? '' : String(record.currentValue),
    recommendedValue: record?.recommendedValue === undefined ? '' : String(record.recommendedValue),
    confidence: String(record?.confidence ?? 0.8),
    status: ['proposed', 'needs_approval', 'blocked'].includes(record?.status ?? '') ? record!.status as DecisionDraft['status'] : 'proposed',
  };
}

export function buildCreateDecisionInput(draft: DecisionDraft, id: string): CreateDecisionInput {
  const facts = split(draft.facts);
  const alternatives = split(draft.alternatives);
  const confidence = Number(draft.confidence);
  const policyRevision = Number(draft.policyRevision);
  const actionRevision = Number(draft.actionRevision);
  if (!draft.title.trim() || !draft.missionId.trim() || !draft.dataBatchId.trim() || !draft.policyVersionId.trim()) throw new Error('请填写标题并绑定运营任务、数据批次与策略版本。');
  if (!draft.rationale.trim() || !draft.recommendation.trim() || !facts.length) throw new Error('请填写理由、推荐动作与至少一条可核验事实。');
  if (!Number.isSafeInteger(policyRevision) || policyRevision < 1 || !Number.isSafeInteger(actionRevision) || actionRevision < 1) throw new Error('策略与动作版本号必须是正整数。');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('置信度必须在 0–1 之间。');
  return {
    id,
    missionId: draft.missionId.trim(),
    dataBatchId: draft.dataBatchId.trim(),
    policyVersionId: draft.policyVersionId.trim(),
    policyRevision,
    actionRevision,
    title: draft.title.trim(),
    rationale: draft.rationale.trim(),
    recommendation: draft.recommendation.trim(),
    facts,
    alternatives,
    ...(draft.expectedEffect.trim() ? { expectedEffect: draft.expectedEffect.trim() } : {}),
    ...(draft.validUntil ? { validUntil: `${draft.validUntil}T07:00:00.000Z` } : {}),
    actionType: draft.actionType.trim() || 'set_keyword_bid',
    ...(draft.adEntityId.trim() ? { adEntityId: draft.adEntityId.trim() } : {}),
    ...(draft.productId.trim() ? { productId: draft.productId.trim() } : {}),
    ...(draft.currentValue.trim() ? { currentValue: Number(draft.currentValue) } : {}),
    ...(draft.recommendedValue.trim() ? { recommendedValue: Number(draft.recommendedValue) } : {}),
    confidence,
    status: draft.status,
    actorId: OPERATOR,
  };
}

export function buildReviseDecisionInput(record: DecisionRecord, draft: DecisionDraft): ReviseDecisionInput {
  const create = buildCreateDecisionInput(draft, record.id);
  return {
    id: record.id,
    expectedRevision: record.revision,
    title: create.title,
    rationale: create.rationale,
    recommendation: create.recommendation,
    facts: create.facts,
    alternatives: create.alternatives,
    expectedEffect: create.expectedEffect ?? null,
    validUntil: create.validUntil ?? null,
    currentValue: create.currentValue,
    recommendedValue: create.recommendedValue,
    confidence: create.confidence,
    status: create.status,
    actorId: OPERATOR,
  };
}

export function DecisionDialog({ record, draft, busy, onChange, onClose, onSave }: { record: DecisionRecord | null; draft: DecisionDraft; busy: boolean; onChange: (draft: DecisionDraft) => void; onClose: () => void; onSave: () => void }) {
  const update = <K extends keyof DecisionDraft>(key: K, value: DecisionDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="mission-control-dialog-backdrop">
      <section aria-labelledby="decision-dialog-title" aria-modal="true" className="mission-control-dialog decision-domain-dialog" role="dialog">
        <header>
          <div>
            <span>经营决策 · US / USD</span>
            <h2 id="decision-dialog-title">{record ? '修订经营决策' : '新建经营决策'}</h2>
            <p>关联运营任务、数据批次和策略版本在创建后保持冻结。</p>
          </div>
          <button aria-label="关闭经营决策编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="decision-domain-form">
          <label className="decision-domain-form__wide"><span>决策标题 *</span><input autoFocus value={draft.title} onChange={(event) => update('title', event.target.value)} /></label>
          <label className="decision-domain-form__wide"><span>决策理由 *</span><textarea rows={3} value={draft.rationale} onChange={(event) => update('rationale', event.target.value)} /></label>
          <label className="decision-domain-form__wide"><span>推荐动作 *</span><textarea rows={2} value={draft.recommendation} onChange={(event) => update('recommendation', event.target.value)} /></label>
          <label className="decision-domain-form__wide"><span>可核验事实 *</span><textarea rows={3} value={draft.facts} onChange={(event) => update('facts', event.target.value)} /><small>用分号或换行分隔。</small></label>
          <label className="decision-domain-form__wide"><span>备选方案</span><textarea rows={2} value={draft.alternatives} onChange={(event) => update('alternatives', event.target.value)} /></label>
          <label><span>当前值 / 推荐值</span><div className="decision-domain-pair"><input type="number" step="0.01" value={draft.currentValue} onChange={(event) => update('currentValue', event.target.value)} /><input type="number" step="0.01" value={draft.recommendedValue} onChange={(event) => update('recommendedValue', event.target.value)} /></div></label>
          <label><span>置信度 / 状态</span><div className="decision-domain-pair"><input min="0" max="1" step="0.01" type="number" value={draft.confidence} onChange={(event) => update('confidence', event.target.value)} /><select value={draft.status} onChange={(event) => update('status', event.target.value as DecisionDraft['status'])}><option value="proposed">待复核</option><option value="needs_approval">待审批</option><option value="blocked">已阻断</option></select></div></label>
          <label><span>有效期</span><input type="date" value={draft.validUntil} onChange={(event) => update('validUntil', event.target.value)} /></label>
          <label><span>预期效果</span><input value={draft.expectedEffect} onChange={(event) => update('expectedEffect', event.target.value)} /></label>
          <details className="decision-domain-form__wide">
            <summary>诊断详情</summary>
            <div className="decision-domain-form">
              <label><span>运营任务标识 *</span><input disabled={Boolean(record)} value={draft.missionId} onChange={(event) => update('missionId', event.target.value)} /></label>
              <label><span>数据批次标识 *</span><input disabled={Boolean(record)} value={draft.dataBatchId} onChange={(event) => update('dataBatchId', event.target.value)} /></label>
              <label><span>策略版本标识 *</span><input disabled={Boolean(record)} value={draft.policyVersionId} onChange={(event) => update('policyVersionId', event.target.value)} /></label>
              <label><span>策略 / 动作版本号</span><div className="decision-domain-pair"><input disabled={Boolean(record)} min="1" type="number" value={draft.policyRevision} onChange={(event) => update('policyRevision', event.target.value)} /><input disabled={Boolean(record)} min="1" type="number" value={draft.actionRevision} onChange={(event) => update('actionRevision', event.target.value)} /></div></label>
              <label><span>广告对象标识</span><input disabled={Boolean(record)} value={draft.adEntityId} onChange={(event) => update('adEntityId', event.target.value)} /></label>
              <label><span>产品标识</span><input disabled={Boolean(record)} value={draft.productId} onChange={(event) => update('productId', event.target.value)} /></label>
              <label><span>内部动作值</span><input readOnly value={draft.actionType} /></label>
            </div>
          </details>
        </div>
        <footer>
          <button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</button>
          <button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : '保存经营决策'}</button>
        </footer>
      </section>
    </div>
  );
}

export function DecisionsWorkspace({ apiOverride, analysisApiOverride, blockedReason, capabilities, onInspectBoundary, previewMode, storeContext, view }: DecisionsWorkspaceProps) {
  const copy = VIEW_COPY[view];
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<DecisionHistoryRecord[]>([]);
  const [grants, setGrants] = useState<MissionGrantRecord[]>([]);
  const [grantEvents, setGrantEvents] = useState<MissionGrantEventRecord[]>([]);
  const [analysis, setAnalysis] = useState<MissionAnalysisProjection | null>(null);
  const [authorizationAnalysis, setAuthorizationAnalysis] = useState<MissionAnalysisProjection | null>(null);
  const [authorizationMissionId, setAuthorizationMissionId] = useState('');
  const [authorizationBatchId, setAuthorizationBatchId] = useState('');
  const [authorizationAnalysisLoading, setAuthorizationAnalysisLoading] = useState(false);
  const [authorizationAnalysisError, setAuthorizationAnalysisError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error'>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState<{ record: DecisionRecord | null; draft: DecisionDraft } | null>(null);
  const [resolution, setResolution] = useState<HumanDecisionResolutionInput['status'] | null>(null);
  const [resolutionReason, setResolutionReason] = useState('');
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const analysisSequence = useRef(0);
  const authorizationAnalysisSequence = useRef(0);
  const mutationSequence = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const authorityRef = useRef(authorityKey); authorityRef.current = authorityKey;
  const api = apiOverride ?? readDecisionDomainWindowApi();
  const analysisApi = analysisApiOverride ?? readAnalysisAuthorityWindowApi();
  const targetBindingApi = previewMode || typeof window === 'undefined'
    ? null
    : readRecommendationTargetBindingWindowApi((window as unknown as { electronAPI?: unknown }).electronAPI);
  const expectedState = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const viewId = view === 'decisions/recommendations' ? 'decisions.recommendations.view' : view === 'decisions/approval' ? 'decisions.approval.view' : 'decisions.decided.view';
  const viewReady = decisionCapabilityReady(capabilities, viewId, view, previewMode);
  const can = (id: string) => Boolean(api && storeContext && viewReady && decisionCapabilityReady(capabilities, id, view, previewMode));
  const filtered = useMemo(() => {
    const allowed = view === 'decisions/recommendations'
      ? new Set<DecisionStatus>(['proposed', 'blocked'])
      : view === 'decisions/approval'
        ? new Set<DecisionStatus>(['needs_approval'])
        : new Set<DecisionStatus>(['approved', 'rejected', 'blocked', 'superseded', 'executed', 'verified']);
    const normalized = query.trim().toLowerCase();
    return decisions.filter((item) => allowed.has(item.status) && (!normalized || `${item.id} ${item.title} ${item.recommendation} ${item.productId ?? ''}`.toLowerCase().includes(normalized)));
  }, [decisions, query, view]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = filtered.find((item) => item.id === selectedId)
    ?? filtered.find((item) => item.id === preferredDecisionId(view, filtered))
    ?? null;
  const selectedRef = useRef(selected?.id ?? '');
  selectedRef.current = selected?.id ?? '';
  const selectedMissionRef = useRef(selected?.missionId ?? '');
  selectedMissionRef.current = selected?.missionId ?? '';
  const authorizationMissionRef = useRef(authorizationMissionId);
  authorizationMissionRef.current = authorizationMissionId;
  const authorizationMissions = useMemo(() => authorizationMissionIds(decisions.filter((item) => (
    storeContext && String(item.storeId) === String(storeContext.storeId)
  ))), [decisions, storeContext?.storeId]);
  const authorizationBatches = useMemo(
    () => analysisActionBatchOptions(authorizationAnalysis),
    [authorizationAnalysis],
  );
  const busy = pending !== null;
  const terminalGrantEvent = (grant: MissionGrantRecord) => grantEvents.find((event) => (
    event.grantId === grant.id && event.eventType !== 'issued'
  )) ?? (Date.parse(grant.expiresAt) <= Date.now() ? {
    id: `derived-expired:${grant.id}`, storeId: grant.storeId, grantId: grant.id,
    eventType: 'expired' as const, actorId: 'clock', createdAt: grant.expiresAt,
  } : undefined);

  const load = async (context: StoreContextEnvelope, key: string) => {
    const current = ++sequence.current;
    if (!viewReady || !api) { setPhase('blocked'); setDecisions([]); setError(!viewReady ? `${copy.title}未获得生产能力，当前已失败关闭。` : '生产经营决策服务未接入；界面不会回退到示例数据。'); return; }
    setPhase('loading'); setError(''); setFeedback('');
    try {
      assertMissionAuthorityContext(context);
      const result = await api.listDecisions(context);
      if (authorityRef.current !== key || sequence.current !== current) return;
      result.forEach((item) => assertDecisionBelongsToContext(item, context));
      setDecisions(result); setSelectedId((id) => result.some((item) => item.id === id) ? id : ''); setPhase('ready');
    } catch (loadError) { if (authorityRef.current === key && sequence.current === current) { setPhase('error'); setDecisions([]); setError(message(loadError)); } }
  };

  useEffect(() => {
    detailSequence.current += 1;
    analysisSequence.current += 1;
    authorizationAnalysisSequence.current += 1;
    mutationSequence.current += 1;
    setPending(null); setQuery(''); setPage(1); setEditor(null); setResolution(null); setGrantEvents([]); setAnalysis(null);
    setAuthorizationAnalysis(null); setAuthorizationMissionId(''); setAuthorizationBatchId('');
    setAuthorizationAnalysisLoading(false); setAuthorizationAnalysisError('');
    if (storeContext) void load(storeContext, authorityKey); else { setPhase('blocked'); setError('等待本机安全进程确认当前店铺范围。'); }
  }, [authorityKey, apiOverride, viewReady]);

  useEffect(() => { setSelectedId((id) => filtered.some((item) => item.id === id) ? id : preferredDecisionId(view, filtered)); }, [view, filtered]);

  useEffect(() => {
    if (view !== 'decisions/decided') {
      setAuthorizationMissionId('');
      return;
    }
    setAuthorizationMissionId((current) => (
      authorizationMissions.includes(current) ? current : authorizationMissions[0] ?? ''
    ));
  }, [authorizationMissions, view]);

  useEffect(() => {
    if (authorizationBatches.some((batch) => batch.id === authorizationBatchId)) return;
    setAuthorizationBatchId(authorizationBatches[0]?.id ?? '');
  }, [authorizationBatchId, authorizationBatches]);

  useEffect(() => {
    if (!selected || !storeContext || !api || phase !== 'ready') {
      detailSequence.current += 1;
      setHistory([]); setGrants([]); setGrantEvents([]); return;
    }
    const capturedKey = authorityKey; const capturedId = selected.id;
    const capturedSequence = ++detailSequence.current;
    void Promise.all([
      api.getDecisionHistory(storeContext, selected.id),
      api.listHumanGrants(storeContext, selected.missionId),
      api.listHumanGrantEvents(storeContext, selected.missionId),
    ]).then(([historyRows, grantRows, eventRows]) => {
      if (!responseMatchesDecisionDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) return;
      if (grantRows.some((grant) => String(grant.storeId) !== String(storeContext.storeId) || grant.missionId !== selected.missionId)
        || eventRows.some((event) => String(event.storeId) !== String(storeContext.storeId))) {
        throw new Error('本机安全进程返回了不属于当前运营任务的授权记录。');
      }
      setHistory(historyRows);
      setGrants(grantRows);
      setGrantEvents(eventRows);
    }).catch((loadError) => {
      if (responseMatchesDecisionDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) setError(message(loadError));
    });
  }, [selected?.id, authorityKey, api, phase]);

  useEffect(() => {
    if (!selected || !storeContext || !analysisApi || phase !== 'ready') {
      analysisSequence.current += 1;
      setAnalysis(null);
      return;
    }
    const capturedKey = authorityKey;
    const capturedMissionId = selected.missionId;
    const current = ++analysisSequence.current;
    void analysisApi.getMissionProjection(storeContext, selected.missionId).then((projection) => {
      if (authorityRef.current !== capturedKey || selectedMissionRef.current !== capturedMissionId || analysisSequence.current !== current) return;
      assertAnalysisProjectionBelongsToContext(storeContext, capturedMissionId, projection);
      setAnalysis(projection);
    }).catch((loadError) => {
      if (authorityRef.current === capturedKey && selectedMissionRef.current === capturedMissionId && analysisSequence.current === current) {
        setAnalysis(null);
        setError(message(loadError));
      }
    });
  }, [analysisApi, authorityKey, phase, selected?.missionId, storeContext]);

  useEffect(() => {
    if (view !== 'decisions/decided' || !authorizationMissionId || !authorizationMissions.includes(authorizationMissionId)
      || !storeContext || !analysisApi || phase !== 'ready') {
      authorizationAnalysisSequence.current += 1;
      setAuthorizationAnalysis(null);
      setAuthorizationBatchId('');
      setAuthorizationAnalysisLoading(false);
      setAuthorizationAnalysisError('');
      return;
    }
    const capturedKey = authorityKey;
    const capturedMissionId = authorizationMissionId;
    const current = ++authorizationAnalysisSequence.current;
    setAuthorizationAnalysis(null);
    setAuthorizationBatchId('');
    setAuthorizationAnalysisLoading(true);
    setAuthorizationAnalysisError('');
    void analysisApi.getMissionProjection(storeContext, capturedMissionId).then((projection) => {
      if (authorityRef.current !== capturedKey || authorizationMissionRef.current !== capturedMissionId
        || authorizationAnalysisSequence.current !== current) return;
      assertAnalysisProjectionBelongsToContext(storeContext, capturedMissionId, projection);
      setAuthorizationAnalysis(projection);
    }).catch((loadError) => {
      if (authorityRef.current === capturedKey && authorizationMissionRef.current === capturedMissionId
        && authorizationAnalysisSequence.current === current) {
        setAuthorizationAnalysis(null);
        setAuthorizationAnalysisError(message(loadError));
      }
    }).finally(() => {
      if (authorityRef.current === capturedKey && authorizationMissionRef.current === capturedMissionId
        && authorizationAnalysisSequence.current === current) setAuthorizationAnalysisLoading(false);
    });
  }, [analysisApi, authorityKey, authorizationMissionId, authorizationMissions, phase, storeContext, view]);

  const mutate = async <T,>(key: string, operation: (domain: DecisionDomainRendererApi, context: StoreContextEnvelope) => Promise<T>): Promise<T | null> => {
    if (!api || !storeContext || busy) return null;
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const current = ++mutationSequence.current;
    setPending(key); setError(''); setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return null;
      return result;
    } catch (mutationError) {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setError(message(mutationError));
      return null;
    } finally {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
    }
  };

  const saveDecision = async () => {
    if (!editor || !storeContext) return;
    try {
      const saved = editor.record
        ? await mutate('decision-save', (domain, context) => domain.reviseDecision(context, buildReviseDecisionInput(editor.record!, editor.draft)))
        : await mutate('decision-save', (domain, context) => domain.createDecision(context, buildCreateDecisionInput(editor.draft, `DECISION-${String(storeContext.storeId)}-${Date.now()}`)));
      if (!saved) return; assertDecisionBelongsToContext(saved, storeContext);
      setDecisions((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
      setEditor(null); setFeedback(editor.record ? '经营决策已通过版本校验修订。' : '经营决策已创建。');
    } catch (validationError) { setError(message(validationError)); }
  };

  const resolveDecision = async () => {
    if (view !== 'decisions/approval') { setError('人工决议只能在审批工作台执行。'); return; }
    if (!selected || !resolution || !resolutionReason.trim()) { setError('人工决议必须填写原因。'); return; }
    const saved = await mutate('resolve', (domain, context) => domain.resolveDecisionHuman(context, { id: selected.id, expectedRevision: selected.revision, status: resolution, reason: resolutionReason.trim(), actorId: OPERATOR }));
    if (!saved) return;
    setDecisions((items) => items.map((item) => item.id === saved.id ? saved : item)); setResolution(null); setResolutionReason(''); setFeedback(`经营决策已${STATUS_LABELS[saved.status]}；这不代表真实 Ads 已执行。`);
  };

  const revokeGrant = async (grant: MissionGrantRecord) => {
    if (view !== 'decisions/decided') { setError('人工授权只能在已决策工作台撤销。'); return; }
    const event = await mutate('grant-revoke', (domain, context) => domain.revokeHumanGrant(context, { id: `GRANT-EVENT-${grant.id}-${Date.now()}`, grantId: grant.id, reason: 'operator_revoked_batch_authority', actorId: OPERATOR }));
    if (!event) return;
    if (selectedMissionRef.current === grant.missionId) setGrantEvents((events) => [event, ...events]);
    setFeedback('人工授权已撤销，原记录保留在审计链。');
  };

  const authorizationProposals = authorizationBatchId
    ? authorizationAnalysis?.proposals.filter((proposal) => proposal.actionBatchId === authorizationBatchId) ?? []
    : [];
  const canAuthorizeAnalysisBatch = Boolean(analysisApi)
    && can('decisions.grants.issue');
  const selectedProposalLink = selected
    ? analysis?.decisionLinks.find((link) => link.decisionId === selected.id)
    : undefined;
  const selectedProposal = selectedProposalLink
    ? analysis?.proposals.find((proposal) => proposal.id === selectedProposalLink.proposalId)
    : undefined;

  const verifySelectedProposalTarget = async () => {
    if (!selectedProposal || !selected || !storeContext || !analysisApi || !api || !targetBindingApi || busy) {
      setError('当前建议无法核验 Ads 对象；请确认店铺与 Ads 已连接后重试。');
      return;
    }
    if (proposalHasVerifiedAdsAuthority(selectedProposal)) {
      setFeedback('当前建议的 Ads 对象版本已经核验，无需重复操作。');
      return;
    }
    const capturedKey = authorityKey;
    const current = ++mutationSequence.current;
    setPending('target-verify'); setError(''); setFeedback('');
    try {
      const operationScope = await targetBindingApi.getOperationScope(storeContext);
      const text = (value: unknown) => String(value ?? '').trim();
      let safetyProposal = proposalIsSafeTargetVerificationCandidate(selectedProposal)
        ? selectedProposal
        : undefined;
      if (!safetyProposal) {
        const prepared = await analysisApi.runMissionAnalysis({
          context: storeContext,
          missionId: selected.missionId,
          dateFrom: text(operationScope.dateFrom),
          dateTo: text(operationScope.dateTo),
        });
        safetyProposal = prepared.proposals.find((proposal) => (
          proposal.entityName.trim().toLowerCase() === selectedProposal.entityName.trim().toLowerCase()
          && proposal.currentBidCents === selectedProposal.currentBidCents
          && proposalIsSafeTargetVerificationCandidate(proposal)
        ));
      }
      if (!safetyProposal) {
        throw new Error('重新分析后没有生成单次降幅不超过 10% 的安全建议，未核验 Ads 对象。');
      }
      const discovery = await targetBindingApi.executionAuthority.discoverRecommendationTarget({
        context: storeContext,
        recommendationId: safetyProposal.legacyRecommendationId,
      });
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      if (discovery.recommendationId !== safetyProposal.legacyRecommendationId
        || discovery.writableTarget.entityType !== 'keyword'
        || discovery.writableTarget.entityId !== discovery.pageIdentity.keywordId
        || discovery.pageIdentity.bidCents !== safetyProposal.currentBidCents
        || !Number.isInteger(discovery.recommendationRevision)
        || discovery.recommendationRevision <= 0) {
        throw new Error('当前 Ads 页面与建议中的店铺、关键词或竞价不一致，未保存核验结果。');
      }
      await targetBindingApi.bindRecommendationWritableTarget({
        recommendationId: discovery.recommendationId,
        expectedRevision: discovery.recommendationRevision,
        scope: {
          dateFrom: text(operationScope.dateFrom),
          dateTo: text(operationScope.dateTo),
          storeName: text(operationScope.storeName),
          marketplaceCode: text(operationScope.marketplaceCode),
          asin: text(operationScope.asin),
          batchId: safetyProposal.dataBatchId,
        },
        binding: {
          boundBy: OPERATOR,
          note: '已通过当前店铺可见 Ads 页面唯一核验对象和当前竞价。',
          writableTarget: discovery.writableTarget,
        },
      });
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      const rerun = await analysisApi.runMissionAnalysis({
        context: storeContext,
        missionId: selected.missionId,
        dateFrom: text(operationScope.dateFrom),
        dateTo: text(operationScope.dateTo),
      });
      const verified = rerun.proposals.find((proposal) => (
        proposal.legacyRecommendationId === discovery.recommendationId
        && proposalHasVerifiedAdsAuthority(proposal)
      ));
      if (!verified) {
        throw new Error('对象核验已保存，但重新分析没有生成对应的安全建议；请刷新后检查，不要重复核验。');
      }
      const [projection, refreshedDecisions] = await Promise.all([
        analysisApi.getMissionProjection(storeContext, selected.missionId),
        api.listDecisions(storeContext),
      ]);
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      assertAnalysisProjectionBelongsToContext(storeContext, selected.missionId, projection);
      refreshedDecisions.forEach((item) => assertDecisionBelongsToContext(item, storeContext));
      setAnalysis(projection);
      setDecisions(refreshedDecisions);
      setSelectedId((id) => refreshedDecisions.some((item) => item.id === id) ? id : preferredDecisionId(view, refreshedDecisions));
      setFeedback(`Ads 对象已核验；新分析批次已生成，当前值 $${(verified.currentBidCents / 100).toFixed(2)}，建议值 $${(verified.proposedBidCents / 100).toFixed(2)}。尚未批准或执行。`);
    } catch (verificationError) {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setError(message(verificationError));
    } finally {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
    }
  };

  const authorizeSelectedBatch = async () => {
    if (view !== 'decisions/decided' || !canAuthorizeAnalysisBatch || !analysisApi || !api || !storeContext
      || !authorizationMissionId || !authorizationBatchId || authorizationProposals.length === 0 || pending) {
      setError('当前没有可整批授权的真实分析建议。');
      return;
    }
    const capturedKey = authorityKey;
    const current = ++mutationSequence.current;
    setPending('analysis-authorize'); setError(''); setFeedback('');
    try {
      const request = buildAnalysisBatchAuthorizationRequest(
        storeContext,
        authorizationMissionId,
        authorizationBatchId,
        authorizationAnalysis,
      );
      const result = await analysisApi.authorizeProposalBatch(request);
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      if (!result.authorized || !result.grant) {
        setError(result.blockers.map((blocker) => blocker.code).join('；') || '整批授权未通过 Main 权威校验。');
        return;
      }
      if (selectedMissionRef.current === authorizationMissionId) {
        setGrants((items) => items.some((grant) => grant.id === result.grant!.id) ? items : [result.grant!, ...items]);
      }
      let refreshWarning = '';
      try {
        const refreshed = await api.listDecisions(storeContext);
        if (authorityRef.current === capturedKey && mutationSequence.current === current) {
          refreshed.forEach((item) => assertDecisionBelongsToContext(item, storeContext));
          setDecisions(refreshed);
        }
      } catch {
        refreshWarning = ' 经营决策列表刷新失败，请手动刷新；不要重复授权。';
      }
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      setFeedback(`${result.mode === 'policy_auto' ? '策略自动' : '人工审批'}已签发同一执行授权：${result.proposalIds.length} 条建议整批授权，尚未执行 Ads。${refreshWarning}`);
    } catch (authorizationError) {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setError(message(authorizationError));
    } finally {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
    }
  };

  const actionVisibility = selected ? decisionActionVisibility(view, selected.status) : null;
  const visibleFeedback = decisionOperatorCopy(
    error || feedback,
    error
      ? '当前经营决策操作未完成，请刷新当前店铺后重试。'
      : '经营决策状态已更新，请刷新列表确认。',
  );
  const visibleBlockedReason = decisionOperatorCopy(
    error || blockedReason,
    '当前经营决策不可用，请确认店铺连接后刷新重试。',
  );
  const visibleAuthorizationAnalysisError = decisionOperatorCopy(
    authorizationAnalysisError,
    '分析建议读取失败，请重新选择运营任务后重试。',
  );
  return <div className="mission-control-workspace-root decision-domain-workspace" data-canonical-surface="decisions" data-capability-state={viewReady ? expectedState : 'BLOCKED'} data-preview-mode={previewMode || undefined} data-view={view}>
    <p className="sr-only">{viewReady && api ? `${copy.title}经营决策服务已接入。` : `${copy.title}已失败关闭；${!api ? '生产决策服务未接入。' : visibleBlockedReason}`}</p>
    <PageFrame className="decision-domain-page" pageId={view.replace('/', '-')} title="建议与审批" description={copy.description} task={<TaskBanner compact eyebrow={previewMode ? '开发预览 · 经营决策' : '经营决策'} title={copy.task} description={previewMode ? copy.taskDescription : `${copy.taskDescription} 建议必须绑定当前运营任务。`} primaryAction={{ actionId: 'decisions.recommendations.create', label: '新建经营决策', disabled: view !== 'decisions/recommendations' || !can('decisions.recommendations.create') || busy, disabledReason: visibleBlockedReason, onClick: () => storeContext && setEditor({ record: null, draft: decisionDraft(storeContext) }) }} secondaryActions={onInspectBoundary ? [{ actionId: 'decision-boundary', label: '查看接入边界', onClick: onInspectBoundary }] : []} status={<span className="decision-domain-authority" data-state={viewReady ? expectedState : 'BLOCKED'}>{previewMode ? '仅开发预览' : viewReady ? '生产服务已接入' : '已阻断'}</span>}>{previewMode && <p className="decision-domain-preview-note">仅开发预览 · Amazon 美国站 · USD · 批准不代表执行</p>}</TaskBanner>} summary={<SummaryStrip ariaLabel="经营决策当前范围" items={[{ id: 'store', label: '当前店铺', value: storeContext ? '已选择' : '等待选择' }, { id: 'view', label: '当前队列', value: copy.title }, { id: 'count', label: '匹配经营决策', value: `${filtered.length} 条` }, { id: 'currency', label: '站点 / 币种', value: 'US / USD' }]} />}>
      <div className="decision-domain-layout">
        <WorkbenchPanel className="decision-domain-list-panel" title={copy.title} description="视图默认按决策状态分流。" footer={`第 ${safePage}/${pageCount} 页 · ${filtered.length} 条`} toolbar={<button className="workspace-button workspace-button--primary" disabled={view !== 'decisions/recommendations' || !can('decisions.recommendations.create') || busy} onClick={() => storeContext && setEditor({ record: null, draft: decisionDraft(storeContext) })} type="button"><Plus size={15} />新建</button>}>
          {view === 'decisions/decided' && (
            <section className="decision-domain-batch-authority decision-domain-analysis-batch" aria-label="分析建议整批授权">
              <header>
                <div>
                  <strong>整批授权一次</strong>
                  <small>{previewMode
                    ? '先选运营任务；系统只展示它的最新不可变动作批次，无需选中某条已决策记录。本机安全进程校验后，人工审批与策略自动签发同一种执行授权。'
                    : '先选运营任务；系统只展示它的最新不可变动作批次，无需选中某条已决策记录。本机安全进程校验后，人工审批与策略自动签发同一种执行授权。'}</small>
                </div>
                <button className="workspace-button workspace-button--primary" disabled={!canAuthorizeAnalysisBatch || authorizationProposals.length === 0 || busy || authorizationAnalysisLoading} onClick={() => void authorizeSelectedBatch()} type="button"><ShieldCheck size={14} />{pending === 'analysis-authorize' ? '授权校验中…' : `授权 ${authorizationProposals.length} 条`}</button>
              </header>
              <div className="decision-domain-analysis-scope">
                <label>
                  <span>授权运营任务</span>
                  <select aria-label="选择授权运营任务" disabled={busy || authorizationMissions.length === 0} value={authorizationMissionId} onChange={(event) => setAuthorizationMissionId(event.target.value)}>
                    <option value="">{authorizationMissions.length ? '请选择运营任务' : '暂无可授权运营任务'}</option>
                    {authorizationMissions.map((missionId, index) => <option key={missionId} value={missionId}>运营任务 {index + 1}</option>)}
                  </select>
                </label>
                <label>
                  <span>最新动作批次</span>
                  <select aria-label="选择最新动作批次" disabled={busy || authorizationAnalysisLoading || authorizationBatches.length === 0} value={authorizationBatchId} onChange={(event) => setAuthorizationBatchId(event.target.value)}>
                    <option value="">{authorizationAnalysisLoading ? '正在读取动作批次…' : authorizationBatches.length ? '等待最新批次' : '暂无动作批次'}</option>
                    {authorizationBatches.map((batch) => <option key={batch.id} value={batch.id}>最新动作批次 · {batch.proposalCount} 条</option>)}
                  </select>
                </label>
              </div>
              {authorizationAnalysisError ? <p className="decision-domain-analysis-error">{visibleAuthorizationAnalysisError}</p> : authorizationAnalysisLoading ? <p>正在读取所选运营任务的分析建议…</p> : authorizationProposals.length ? <div className="decision-domain-analysis-proposals">{authorizationProposals.map((proposal) => <article key={proposal.id}><span><b>{proposal.entityName}</b><small>{proposal.source === 'rule_ai' ? '规则 + AI 一致' : '单一分析来源'}</small><AnalysisProposalAuthorityStatus busy={busy} proposal={proposal} /></span><strong>${(proposal.currentBidCents / 100).toFixed(2)} → ${(proposal.proposedBidCents / 100).toFixed(2)}</strong><em data-eligible={(proposal.authorization.human.eligible || proposal.authorization.policy.eligible) || undefined}>{proposalAuthorizationLabel(proposal)}</em><details><summary>诊断详情</summary><code>{proposal.id}</code><code>{proposal.adEntityRevision ?? '—'}</code></details></article>)}</div> : <p>请选择包含分析建议的运营任务；策略内自动可以直接校验待审批或待复核经营决策。</p>}
              <details><summary>诊断详情</summary><code>{authorizationMissionId || '—'}</code><code>{authorizationBatchId || '—'}</code></details>
            </section>
          )}
          <input className="decision-domain-search" aria-label="搜索经营决策" placeholder="搜索标题、动作或产品" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          {phase === 'loading' && <WorkspaceState kind="loading" title="读取经营决策" description="正在读取当前店铺决策与历史。" />}
          {(phase === 'blocked' || phase === 'error') && <WorkspaceState kind="blocked" title="经营决策已失败关闭" description="生产模式不会使用界面临时数据。" details={visibleBlockedReason} />}
          {phase === 'ready' && !rows.length && <WorkspaceState kind="empty" title={`${copy.title}暂无记录`} description="切换其他经营决策视图或创建新建议。" />}
          <ul className="decision-domain-list" aria-label={`${copy.title}列表`}>{rows.map((item) => <li key={item.id}><button aria-pressed={item.id === selected?.id} data-selected={item.id === selected?.id || undefined} onClick={() => setSelectedId(item.id)} type="button"><span><em data-status={item.status}>{STATUS_LABELS[item.status]}</em><time>{decisionRevisionDisplayLabel(item.revision)}</time></span><strong>{item.title}</strong><small>{decisionListScopeLabel(item)}</small><b>置信度 {Math.round(item.confidence * 100)}%</b></button></li>)}</ul>
          <nav className="decision-domain-pagination" aria-label="经营决策分页"><button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button><span>{safePage}/{pageCount}</span><button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button></nav>
        </WorkbenchPanel>
        <div className="decision-domain-detail">{selected ? <>
          <section className="decision-domain-detail-head">
            <div>
              <span>经营决策</span>
              <h2>{selected.title}</h2>
              <p>已绑定运营任务、数据批次与策略版本</p>
              <details><summary>诊断详情</summary><code>{selected.id}</code><code>{selected.missionId}</code><code>{selected.dataBatchId}</code><code>{selected.revision}</code></details>
            </div>
            <em data-status={selected.status}>{STATUS_LABELS[selected.status]}</em>
            <div className="decision-domain-actions">{actionVisibility?.revise && <button className="workspace-button workspace-button--primary" disabled={!can('decisions.recommendations.update') || busy} onClick={() => storeContext && setEditor({ record: selected, draft: decisionDraft(storeContext, selected) })} type="button"><PencilSimple size={15} />修订</button>}{actionVisibility?.resolve && <><button className="workspace-button workspace-button--primary" disabled={!can('decisions.approval.approve') || busy} onClick={() => setResolution('approved')} type="button"><Check size={15} />批准</button><button className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('rejected')} type="button"><ThumbsDown size={15} />拒绝</button><button className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('blocked')} type="button"><Prohibit size={15} />阻断</button><button className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('superseded')} type="button"><ArrowRight size={15} />标记被替代</button></>}</div>
          </section>
          <section className="decision-domain-recommendation">
            <div><FileText size={20} weight="duotone" /><div><span>推荐动作</span><strong>{selected.recommendation}</strong><p>{selected.rationale}</p>{selectedProposal && <div className="decision-domain-proposal-source"><small>{selectedProposal.source === 'rule_ai' ? '规则 + AI 一致' : '单一分析来源'} · 证据已锁定</small><AnalysisProposalAuthorityStatus busy={pending === 'target-verify'} onVerify={targetBindingApi ? () => void verifySelectedProposalTarget() : undefined} proposal={selectedProposal} /></div>}</div></div>
            <dl><div><dt>当前值</dt><dd>{formatDecisionMoney(selected.currentValue, selectedProposal?.currentBidCents)}</dd></div><div><dt>推荐值</dt><dd>{formatDecisionMoney(selected.recommendedValue, selectedProposal?.proposedBidCents)}</dd></div><div><dt>策略快照</dt><dd>已锁定策略版本</dd></div><div><dt>有效期</dt><dd>{selected.validUntil?.slice(0, 10) ?? '未设置'}</dd></div></dl>
            <details><summary>诊断详情</summary><code>{selected.policyVersionId}</code><code>{selected.policyRevision}</code>{selectedProposal && <><code>{selectedProposal.evidencePackageHash}</code><code>{selectedProposal.adEntityRevision ?? '—'}</code></>}</details>
          </section>
          <div className="decision-domain-evidence-grid"><section><h3>可核验事实</h3><DecisionEvidenceFacts facts={selected.facts} /></section><section><h3>备选方案</h3>{selected.alternatives.length ? <ol>{selected.alternatives.map((alternative) => <li key={alternative}>{alternative}</li>)}</ol> : <p>未记录备选方案。</p>}<strong>预期效果</strong><p>{selected.expectedEffect ?? '未记录'}</p></section></div>
          <section className="decision-domain-history">
            <header><div><h3>决策历史</h3><p>每次修订与人工决议都保留快照。</p></div><ClockCounterClockwise size={19} /></header>
            <div>{history.map((item) => <article key={item.id}><span>{decisionHistoryEventLabel(item.eventType)}</span><strong>版本快照已保留</strong><small>{item.reason ?? item.createdAt}</small><details><summary>诊断详情</summary><code>{item.id}</code><code>{item.eventType}</code><code>{item.decisionRevision}</code><code>{item.actorId}</code></details></article>)}</div>
          </section>
          <section className="decision-domain-grants">
            <header><div><h3>执行授权</h3><p>人工审批与策略自动共用同一不可变授权模型；终态从持久化授权事件派生。</p></div><ShieldCheck size={19} /></header>
            {grants.length ? <div>{grants.map((grant) => { const terminal = terminalGrantEvent(grant); return <article data-revoked={terminal?.eventType === 'revoked' || undefined} data-terminal={terminal?.eventType} key={grant.id}><div><strong>执行授权</strong><small>{grant.issuer.type === 'policy' ? '策略自动' : '人工审批'} · {grant.allowedAdEntityIds.length} 个对象 · ≤ {grant.maxChangePct}% · ${grant.totalImpactBudget} · {grantTerminalDisplayLabel(terminal?.eventType)}</small><details><summary>诊断详情</summary><code>{grant.id}</code><code>{grant.allowedAdEntityIds.join(',')}</code><code>{terminal?.eventType ?? 'issued'}</code></details></div>{view === 'decisions/decided' && grant.issuer.type === 'human' && <button className="workspace-button workspace-button--secondary" disabled={!can('decisions.grants.revoke') || busy || Boolean(terminal)} onClick={() => void revokeGrant(grant)} type="button">{terminal ? grantTerminalDisplayLabel(terminal.eventType) : '撤销人工授权'}</button>}</article>; })}</div> : <p>当前运营任务没有授权。</p>}
          </section>
        </> : phase === 'ready' ? <WorkspaceState kind="empty" title={`等待选择${copy.title}`} description="从左侧选择经营决策，查看事实、审批历史与授权边界。" /> : null}</div>
      </div>
      {(error || feedback) && <p className="decision-domain-feedback" data-tone={error ? 'error' : 'success'} aria-live="polite">{visibleFeedback}</p>}
    </PageFrame>
    {editor && <DecisionDialog record={editor.record} draft={editor.draft} busy={pending === 'decision-save'} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onClose={() => setEditor(null)} onSave={() => void saveDecision()} />}
    {view === 'decisions/approval' && resolution && selected && <div className="mission-control-dialog-backdrop"><section aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="dialog" aria-labelledby="resolve-title"><header><div><span>人工经营决策</span><h2 id="resolve-title">{STATUS_LABELS[resolution]}“{selected.title}”</h2><p>状态写入使用版本校验；批准不代表 Ads 已执行。</p></div></header><div className="decision-domain-resolution"><label><span>决议原因 *</span><textarea autoFocus rows={4} value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} /></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setResolution(null)} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || !resolutionReason.trim()} onClick={() => void resolveDecision()} type="button">确认{STATUS_LABELS[resolution]}</button></footer><details><summary>诊断详情</summary><code>{selected.id}</code><code>{selected.revision}</code></details></section></div>}
  </div>;
}
