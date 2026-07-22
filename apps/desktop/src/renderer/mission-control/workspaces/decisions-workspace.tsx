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
  type CreateDecisionInput,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type MissionControlCapabilityProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import {
  assertDecisionBelongsToContext,
  assertMissionBelongsToContext,
  assertMissionAuthorityContext,
  readDecisionDomainWindowApi,
  readMissionDomainWindowApi,
  type CreateHumanMissionGrantInput,
  type DecisionDomainRendererApi,
  type HumanDecisionResolutionInput,
  type MissionDomainRendererApi,
} from './mission-domain-window-api';
import './decisions-workspace.css';

const OPERATOR = 'desktop-operator';
const PAGE_SIZE = 6;

export type DecisionWorkspaceView = 'decisions/recommendations' | 'decisions/approval' | 'decisions/decided';

export type DecisionsWorkspaceProps = {
  apiOverride?: DecisionDomainRendererApi;
  missionApiOverride?: MissionDomainRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
  view: DecisionWorkspaceView;
};

type DecisionDraft = {
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

type GrantDraft = {
  missionRevision: string;
  allowedAdEntityIds: string;
  maxChangePct: string;
  totalImpactBudget: string;
  expiresOn: string;
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
  'decisions/approval': { title: '人工审批', description: '逐条确认边界；批准只形成 Decision 状态，不代表已写入 Amazon Ads。', task: '处理等待人工决议的 Crux Decision', taskDescription: '批准、拒绝、阻断或替代都必须记录原因，并形成 append-only history。' },
  'decisions/decided': { title: '已决策', description: '回看已批准、拒绝、阻断与替代的历史决策和人工授权。', task: '复核已决策记录与授权边界', taskDescription: '已决策内容不可覆盖；如经营事实变化，应创建新的 Decision 修订链。' },
};

export function decisionActionVisibility(view: DecisionWorkspaceView, status: DecisionStatus): {
  revise: boolean;
  resolve: boolean;
  batchGrant: boolean;
} {
  return {
    revise: view === 'decisions/recommendations' && (status === 'proposed' || status === 'blocked'),
    resolve: view === 'decisions/approval' && status === 'needs_approval',
    batchGrant: view === 'decisions/decided' && status === 'approved',
  };
}

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'Decision 操作未完成，请刷新后重试。';
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
  if (!draft.title.trim() || !draft.missionId.trim() || !draft.dataBatchId.trim() || !draft.policyVersionId.trim()) throw new Error('请填写标题并绑定 Mission、数据批次与策略版本。');
  if (!draft.rationale.trim() || !draft.recommendation.trim() || !facts.length) throw new Error('请填写理由、推荐动作与至少一条可核验事实。');
  if (!Number.isSafeInteger(policyRevision) || policyRevision < 1 || !Number.isSafeInteger(actionRevision) || actionRevision < 1) throw new Error('策略与动作 revision 必须是正整数。');
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

export function buildHumanGrantInput(decisions: readonly DecisionRecord[], draft: GrantDraft, id: string): CreateHumanMissionGrantInput {
  const decision = decisions[0];
  const missionRevision = Number(draft.missionRevision);
  const maxChangePct = Number(draft.maxChangePct);
  const totalImpactBudget = Number(draft.totalImpactBudget);
  const entities = split(draft.allowedAdEntityIds);
  if (!decision || !decisions.length) throw new Error('请至少选择一条已批准 Decision。');
  if (decisions.some((item) => item.status !== 'approved')) throw new Error('批次授权只能包含已批准 Decision。');
  if (decisions.some((item) => item.missionId !== decision.missionId || item.dataBatchId !== decision.dataBatchId)) throw new Error('批次 Decision 必须属于同一 Mission 与数据批次。');
  if (decisions.some((item) => item.policyVersionId !== decision.policyVersionId || item.policyRevision !== decision.policyRevision)) throw new Error('批次 Decision 必须绑定同一不可变策略快照。');
  if (decisions.some((item) => item.actionRevision !== decision.actionRevision)) throw new Error('批次 Decision 必须具有相同 action revision。');
  const expectedEntities = decisions.map((item) => item.adEntityId).filter((item): item is string => Boolean(item));
  if (expectedEntities.length !== decisions.length) throw new Error('每条批次 Decision 必须绑定稳定广告实体 ID。');
  if (!Number.isSafeInteger(missionRevision) || missionRevision < 1) throw new Error('Mission revision 必须是正整数。');
  if (new Set(entities).size !== entities.length || entities.length !== expectedEntities.length || entities.some((item) => !expectedEntities.includes(item))) throw new Error('广告实体 allowlist 必须与所选 Decision 集合精确一致。');
  if (!(maxChangePct > 0 && maxChangePct <= 15)) throw new Error('关键词竞价变化上限必须在 0–15% 内。');
  if (!(totalImpactBudget >= 0)) throw new Error('批次影响预算不能小于 0 USD。');
  return {
    id,
    missionId: decision.missionId,
    missionRevision,
    decisionIds: decisions.map((item) => item.id),
    actionRevision: decision.actionRevision,
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: entities,
    maxChangePct,
    totalImpactBudget,
    expiresAt: `${draft.expiresOn}T07:00:00.000Z`,
    policyVersionId: decision.policyVersionId,
    policyRevision: decision.policyRevision,
    requiredEvidence: ['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value'],
    stopConditions: [
      { code: 'identity_drift', detail: '身份漂移立即停止。' },
      { code: 'expected_before_mismatch', detail: 'Before 不一致立即停止。' },
      { code: 'unknown_result', detail: 'UNKNOWN 不自动重试。' },
      { code: 'data_stale', detail: '数据过期时停止。' },
      { code: 'impact_budget_exhausted', detail: '影响预算耗尽时停止。' },
      { code: 'kill_switch', detail: '紧急停止开启时拒绝执行。' },
    ],
    actorId: OPERATOR,
  };
}

function DecisionDialog({ record, draft, busy, onChange, onClose, onSave }: { record: DecisionRecord | null; draft: DecisionDraft; busy: boolean; onChange: (draft: DecisionDraft) => void; onClose: () => void; onSave: () => void }) {
  const update = <K extends keyof DecisionDraft>(key: K, value: DecisionDraft[K]) => onChange({ ...draft, [key]: value });
  return <div className="mission-control-dialog-backdrop"><section aria-modal="true" className="mission-control-dialog decision-domain-dialog" role="dialog" aria-labelledby="decision-dialog-title"><header><div><span>CRUX DECISION · US / USD</span><h2 id="decision-dialog-title">{record ? '修订 Decision' : '新建 Decision'}</h2><p>关联 Mission、数据批次和策略版本在创建后保持冻结。</p></div><button aria-label="关闭 Decision 编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button></header><div className="decision-domain-form"><label className="decision-domain-form__wide"><span>决策标题 *</span><input autoFocus value={draft.title} onChange={(event) => update('title', event.target.value)} /></label><label><span>Mission ID *</span><input disabled={Boolean(record)} value={draft.missionId} onChange={(event) => update('missionId', event.target.value)} /></label><label><span>数据批次 *</span><input disabled={Boolean(record)} value={draft.dataBatchId} onChange={(event) => update('dataBatchId', event.target.value)} /></label><label><span>策略版本 *</span><input disabled={Boolean(record)} value={draft.policyVersionId} onChange={(event) => update('policyVersionId', event.target.value)} /></label><label><span>Policy / Action revision</span><div className="decision-domain-pair"><input disabled={Boolean(record)} min="1" type="number" value={draft.policyRevision} onChange={(event) => update('policyRevision', event.target.value)} /><input disabled={Boolean(record)} min="1" type="number" value={draft.actionRevision} onChange={(event) => update('actionRevision', event.target.value)} /></div></label><label className="decision-domain-form__wide"><span>决策理由 *</span><textarea rows={3} value={draft.rationale} onChange={(event) => update('rationale', event.target.value)} /></label><label className="decision-domain-form__wide"><span>推荐动作 *</span><textarea rows={2} value={draft.recommendation} onChange={(event) => update('recommendation', event.target.value)} /></label><label className="decision-domain-form__wide"><span>可核验事实 *</span><textarea rows={3} value={draft.facts} onChange={(event) => update('facts', event.target.value)} /><small>用分号或换行分隔。</small></label><label className="decision-domain-form__wide"><span>备选方案</span><textarea rows={2} value={draft.alternatives} onChange={(event) => update('alternatives', event.target.value)} /></label><label><span>广告实体 ID</span><input disabled={Boolean(record)} value={draft.adEntityId} onChange={(event) => update('adEntityId', event.target.value)} /></label><label><span>产品 ID</span><input disabled={Boolean(record)} value={draft.productId} onChange={(event) => update('productId', event.target.value)} /></label><label><span>当前值 / 推荐值</span><div className="decision-domain-pair"><input type="number" step="0.01" value={draft.currentValue} onChange={(event) => update('currentValue', event.target.value)} /><input type="number" step="0.01" value={draft.recommendedValue} onChange={(event) => update('recommendedValue', event.target.value)} /></div></label><label><span>置信度 / 状态</span><div className="decision-domain-pair"><input min="0" max="1" step="0.01" type="number" value={draft.confidence} onChange={(event) => update('confidence', event.target.value)} /><select value={draft.status} onChange={(event) => update('status', event.target.value as DecisionDraft['status'])}><option value="proposed">待复核</option><option value="needs_approval">待审批</option><option value="blocked">已阻断</option></select></div></label><label><span>有效期</span><input type="date" value={draft.validUntil} onChange={(event) => update('validUntil', event.target.value)} /></label><label><span>预期效果</span><input value={draft.expectedEffect} onChange={(event) => update('expectedEffect', event.target.value)} /></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : '保存 Decision'}</button></footer></section></div>;
}

function GrantDialog({ decisions, draft, busy, previewMode, onChange, onClose, onSave }: { decisions: readonly DecisionRecord[]; draft: GrantDraft; busy: boolean; previewMode: boolean; onChange: (draft: GrantDraft) => void; onClose: () => void; onSave: () => void }) {
  const first = decisions[0];
  return <div className="mission-control-dialog-backdrop"><section aria-modal="true" className="mission-control-dialog decision-domain-dialog decision-domain-grant-dialog" role="dialog" aria-labelledby="grant-dialog-title"><header><div><span>HUMAN MISSION GRANT</span><h2 id="grant-dialog-title">整批授权一次 · {decisions.length} 条 Decision</h2><p>只授权同一 Mission/数据批次/策略快照/action revision 的关键词竞价动作；不能生成 Policy grant。</p></div><button aria-label="关闭授权编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button></header><div className="decision-domain-form"><label><span>Mission revision（Main 权威）</span><input disabled value={draft.missionRevision} /></label><label><span>Action revision</span><input disabled value={first?.actionRevision ?? ''} /></label><div className="decision-domain-selected-decisions"><strong>批次 Decision</strong><p>{decisions.map((item) => item.id).join(' · ')}</p></div><label className="decision-domain-form__wide"><span>允许的广告实体 ID *</span><textarea rows={4} value={draft.allowedAdEntityIds} onChange={(event) => onChange({ ...draft, allowedAdEntityIds: event.target.value })} /><small>必须与所选 Decision 的稳定实体集合精确一致；不会扩大到其他对象。</small></label><label><span>最大变化</span><input max="15" min="0.1" step="0.1" type="number" value={draft.maxChangePct} onChange={(event) => onChange({ ...draft, maxChangePct: event.target.value })} /></label><label><span>总影响预算 (USD)</span><input min="0" type="number" value={draft.totalImpactBudget} onChange={(event) => onChange({ ...draft, totalImpactBudget: event.target.value })} /></label><label><span>授权有效期</span><input type="date" value={draft.expiresOn} onChange={(event) => onChange({ ...draft, expiresOn: event.target.value })} /></label><div className="decision-domain-grant-contract"><ShieldCheck size={18} /><p>要求 Before / After / Reload / Page identity / Readback value；UNKNOWN 停止且不自动重试。</p></div>{previewMode && <div className="decision-domain-preview-grant"><Prohibit size={17} /><p>仅开发预览：此授权写入内存 adapter，不授权或执行真实 Amazon Ads。</p></div>}</div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '授权中…' : '确认整批授权一次'}</button></footer></section></div>;
}

export function DecisionsWorkspace({ apiOverride, missionApiOverride, blockedReason, capabilities, onInspectBoundary, previewMode, storeContext, view }: DecisionsWorkspaceProps) {
  const copy = VIEW_COPY[view];
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<DecisionHistoryRecord[]>([]);
  const [grants, setGrants] = useState<MissionGrantRecord[]>([]);
  const [grantEvents, setGrantEvents] = useState<MissionGrantEventRecord[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error'>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState<{ record: DecisionRecord | null; draft: DecisionDraft } | null>(null);
  const [resolution, setResolution] = useState<HumanDecisionResolutionInput['status'] | null>(null);
  const [resolutionReason, setResolutionReason] = useState('');
  const [grantEditor, setGrantEditor] = useState<GrantDraft | null>(null);
  const [grantDecisionIds, setGrantDecisionIds] = useState<Set<string>>(() => new Set());
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const mutationSequence = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const authorityRef = useRef(authorityKey); authorityRef.current = authorityKey;
  const api = apiOverride ?? readDecisionDomainWindowApi();
  const missionApi = missionApiOverride ?? readMissionDomainWindowApi();
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
  const approvedDecisions = decisions.filter((item) => item.status === 'approved');
  const selectedGrantDecisions = approvedDecisions.filter((item) => grantDecisionIds.has(item.id));
  const busy = pending !== null;
  const batchAnchor = selectedGrantDecisions[0] ?? null;
  const grantCompatible = (item: DecisionRecord) => !batchAnchor
    || (item.missionId === batchAnchor.missionId
      && item.dataBatchId === batchAnchor.dataBatchId
      && item.policyVersionId === batchAnchor.policyVersionId
      && item.policyRevision === batchAnchor.policyRevision
      && item.actionRevision === batchAnchor.actionRevision);
  const toggleGrantDecision = (item: DecisionRecord, checked: boolean) => setGrantDecisionIds((ids) => {
    const next = new Set(ids);
    if (checked) next.add(item.id); else next.delete(item.id);
    return next;
  });
  const terminalGrantEvent = (grant: MissionGrantRecord) => grantEvents.find((event) => (
    event.grantId === grant.id && event.eventType !== 'issued'
  )) ?? (Date.parse(grant.expiresAt) <= Date.now() ? {
    id: `derived-expired:${grant.id}`, storeId: grant.storeId, grantId: grant.id,
    eventType: 'expired' as const, actorId: 'clock', createdAt: grant.expiresAt,
  } : undefined);

  const load = async (context: StoreContextEnvelope, key: string) => {
    const current = ++sequence.current;
    if (!viewReady || !api) { setPhase('blocked'); setDecisions([]); setError(!viewReady ? `${copy.title}需要 ${expectedState} 能力，当前已失败关闭。` : 'Decision production window API 未接入；Renderer 未回退到示例数据。'); return; }
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
    mutationSequence.current += 1;
    setPending(null); setQuery(''); setPage(1); setEditor(null); setResolution(null); setGrantEditor(null); setGrantDecisionIds(new Set()); setGrantEvents([]);
    if (storeContext) void load(storeContext, authorityKey); else { setPhase('blocked'); setError('等待 Main 返回当前 StoreContext。'); }
  }, [authorityKey, apiOverride, viewReady]);

  useEffect(() => { setSelectedId((id) => filtered.some((item) => item.id === id) ? id : preferredDecisionId(view, filtered)); }, [view, filtered]);

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
        throw new Error('Main 返回了不属于当前 Mission 的授权记录。');
      }
      setHistory(historyRows);
      setGrants(grantRows.filter((grant) => grant.issuer.type === 'human'));
      setGrantEvents(eventRows);
    }).catch((loadError) => {
      if (responseMatchesDecisionDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) setError(message(loadError));
    });
  }, [selected?.id, authorityKey, api, phase]);

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
      setEditor(null); setFeedback(editor.record ? 'Decision 已通过 revision CAS 修订。' : 'Decision 已创建。');
    } catch (validationError) { setError(message(validationError)); }
  };

  const resolveDecision = async () => {
    if (view !== 'decisions/approval') { setError('人工决议只能在审批工作台执行。'); return; }
    if (!selected || !resolution || !resolutionReason.trim()) { setError('人工决议必须填写原因。'); return; }
    const saved = await mutate('resolve', (domain, context) => domain.resolveDecisionHuman(context, { id: selected.id, expectedRevision: selected.revision, status: resolution, reason: resolutionReason.trim(), actorId: OPERATOR }));
    if (!saved) return;
    setDecisions((items) => items.map((item) => item.id === saved.id ? saved : item)); setResolution(null); setResolutionReason(''); setFeedback(`Decision 已${STATUS_LABELS[saved.status]}；这不代表真实 Ads 已执行。`);
  };

  const prepareGrant = async () => {
    if (view !== 'decisions/decided') { setError('人工批次授权只能在已决策工作台执行。'); return; }
    if (!selectedGrantDecisions.length || !storeContext || !missionApi || busy) return;
    const missionIds = new Set(selectedGrantDecisions.map((item) => item.missionId));
    if (missionIds.size !== 1) {
      setError('批次授权必须只包含同一 Mission 的 Decision。');
      return;
    }
    const missionId = selectedGrantDecisions[0].missionId;
    const capturedKey = missionControlContextKey(storeContext);
    const current = ++mutationSequence.current;
    setPending('grant-prepare'); setError(''); setFeedback('');
    try {
      const mission = await missionApi.getMission(storeContext, missionId);
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      if (!mission) throw new Error('Main 未返回批次所属 Mission，授权已失败关闭。');
      assertMissionBelongsToContext(mission, storeContext);
      if (mission.id !== missionId || mission.status === 'archived' || mission.status === 'completed') {
        throw new Error('批次所属 Mission 不可授权；请刷新 Decision 后重试。');
      }
      setGrantEditor({
        missionRevision: String(mission.revision),
        allowedAdEntityIds: selectedGrantDecisions.map((item) => item.adEntityId).filter(Boolean).join('\n'),
        maxChangePct: '15', totalImpactBudget: '50', expiresOn: plusDays(storeContext.businessDate, 1),
      });
    } catch (grantError) {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setError(message(grantError));
    } finally {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
    }
  };

  const issueGrant = async () => {
    if (view !== 'decisions/decided') { setError('人工批次授权只能在已决策工作台执行。'); return; }
    if (!selectedGrantDecisions.length || !grantEditor) return;
    if (new Set(selectedGrantDecisions.map((item) => item.missionId)).size !== 1) {
      setError('批次授权必须只包含同一 Mission 的 Decision。');
      return;
    }
    const grantMissionId = selectedGrantDecisions[0].missionId;
    try {
      const saved = await mutate('grant-issue', (domain, context) => domain.issueHumanGrant(context, buildHumanGrantInput(selectedGrantDecisions, grantEditor, `GRANT-${selectedGrantDecisions[0].missionId}-${Date.now()}`)));
      if (!saved) return;
      if (selectedMissionRef.current === grantMissionId) setGrants((items) => [saved, ...items]);
      setGrantEditor(null); setGrantDecisionIds(new Set()); setFeedback(previewMode ? '仅开发预览：人工批次授权已写入内存，不授权或执行真实 Ads。' : `人工 MissionGrant 已为 ${saved.decisionIds.length} 条 Decision 签发；仍需逐动作校验与真实回读。`);
    } catch (validationError) { setError(message(validationError)); }
  };

  const revokeGrant = async (grant: MissionGrantRecord) => {
    if (view !== 'decisions/decided') { setError('人工授权只能在已决策工作台撤销。'); return; }
    const event = await mutate('grant-revoke', (domain, context) => domain.revokeHumanGrant(context, { id: `GRANT-EVENT-${grant.id}-${Date.now()}`, grantId: grant.id, reason: 'operator_revoked_batch_authority', actorId: OPERATOR }));
    if (!event) return;
    if (selectedMissionRef.current === grant.missionId) setGrantEvents((events) => [event, ...events]);
    setFeedback('人工授权已撤销，原记录保留在审计链。');
  };

  const actionVisibility = selected ? decisionActionVisibility(view, selected.status) : null;
  return <div className="mission-control-workspace-root decision-domain-workspace" data-canonical-surface="decisions" data-capability-state={viewReady ? expectedState : 'BLOCKED'} data-preview-mode={previewMode || undefined} data-view={view}>
    <p className="sr-only">{viewReady && api ? `${copy.title} Decision Authority 已接入。` : `${copy.title}已失败关闭；${!api ? 'production window API 未接入。' : blockedReason}`}</p>
    <PageFrame className="decision-domain-page" pageId={view.replace('/', '-')} title={copy.title} description={copy.description} task={<TaskBanner compact eyebrow="CRUX DECISIONS" title={copy.task} description={copy.taskDescription} primaryAction={{ actionId: 'decisions.recommendations.create', label: '新建 Decision', disabled: view !== 'decisions/recommendations' || !can('decisions.recommendations.create') || busy, disabledReason: blockedReason, onClick: () => storeContext && setEditor({ record: null, draft: decisionDraft(storeContext) }) }} secondaryActions={onInspectBoundary ? [{ actionId: 'decision-boundary', label: '查看接入边界', onClick: onInspectBoundary }] : []} status={<span className="decision-domain-authority" data-state={viewReady ? expectedState : 'BLOCKED'}>{previewMode ? '仅开发预览' : viewReady ? '生产 Authority' : '已阻断'}</span>}>{previewMode && <p className="decision-domain-preview-note">显式内存 adapter · Amazon US · USD · 批准不代表执行</p>}</TaskBanner>} summary={<SummaryStrip ariaLabel="Decision 当前范围" items={[{ id: 'store', label: '店铺数据域', value: storeContext ? String(storeContext.storeId) : '等待 Main' }, { id: 'view', label: '当前队列', value: copy.title }, { id: 'count', label: '匹配 Decision', value: `${filtered.length} 条` }, { id: 'currency', label: '站点 / 币种', value: 'US / USD' }]} />}>
      <div className="decision-domain-layout">
        <WorkbenchPanel className="decision-domain-list-panel" title={copy.title} description="视图默认按决策状态分流。" footer={`第 ${safePage}/${pageCount} 页 · ${filtered.length} 条`} toolbar={<button className="workspace-button workspace-button--primary" disabled={view !== 'decisions/recommendations' || !can('decisions.recommendations.create') || busy} onClick={() => storeContext && setEditor({ record: null, draft: decisionDraft(storeContext) })} type="button"><Plus size={15} />新建</button>}>
          {view === 'decisions/decided' && <section className="decision-domain-batch-authority" aria-label="批次人工授权选择"><header><div><strong>整批授权一次</strong><small>选择同一 Mission、数据批次、策略快照与 action revision 的已批准 Decision。</small></div><button className="workspace-button workspace-button--primary" disabled={!selectedGrantDecisions.length || !can('decisions.grants.issue') || !missionApi || busy} title={!can('decisions.grants.issue') ? '稳定广告实体注册表完成前，真实批次授权保持 BLOCKED。' : undefined} onClick={() => void prepareGrant()} type="button"><ShieldCheck size={14} />{pending === 'grant-prepare' ? '读取 Mission…' : `授权 ${selectedGrantDecisions.length} 条`}</button></header><div>{approvedDecisions.map((item) => <label data-disabled={!grantCompatible(item) || undefined} key={item.id}><input checked={grantDecisionIds.has(item.id)} disabled={!grantCompatible(item)} onChange={(event) => toggleGrantDecision(item, event.target.checked)} type="checkbox" /><span><b>{item.title}</b><small>{item.missionId} · a{item.actionRevision} · {item.adEntityId ?? '缺少稳定实体'}</small></span></label>)}</div>{!approvedDecisions.length && <p>当前店铺没有可进入批次授权的 approved Decision。</p>}</section>}
          <input className="decision-domain-search" aria-label="搜索 Decision" placeholder="搜索标题、动作、产品或 ID" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          {phase === 'loading' && <WorkspaceState kind="loading" title="读取 Decision Authority" description="正在读取当前店铺决策与历史。" />}
          {(phase === 'blocked' || phase === 'error') && <WorkspaceState kind="blocked" title="Decision 已失败关闭" description="生产模式不会使用 Renderer 临时数据。" details={error || blockedReason} />}
          {phase === 'ready' && !rows.length && <WorkspaceState kind="empty" title={`${copy.title}暂无记录`} description="切换其他 Decision 视图或创建新建议。" />}
          <ul className="decision-domain-list" aria-label={`${copy.title}列表`}>{rows.map((item) => <li key={item.id}><button aria-pressed={item.id === selected?.id} data-selected={item.id === selected?.id || undefined} onClick={() => setSelectedId(item.id)} type="button"><span><em data-status={item.status}>{STATUS_LABELS[item.status]}</em><time>r{item.revision}</time></span><strong>{item.title}</strong><small>{item.productId ?? '店铺级'} · {item.actionType}</small><b>置信度 {Math.round(item.confidence * 100)}%</b></button></li>)}</ul>
          <nav className="decision-domain-pagination" aria-label="Decision 分页"><button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button><span>{safePage}/{pageCount}</span><button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button></nav>
        </WorkbenchPanel>
        <div className="decision-domain-detail">{selected ? <>
          <section className="decision-domain-detail-head"><div><span>DECISION · {selected.id}</span><h2>{selected.title}</h2><p>{selected.missionId} · {selected.dataBatchId} · r{selected.revision}</p></div><em data-status={selected.status}>{STATUS_LABELS[selected.status]}</em><div className="decision-domain-actions">{actionVisibility?.revise && <button className="workspace-button workspace-button--primary" disabled={!can('decisions.recommendations.update') || busy} onClick={() => storeContext && setEditor({ record: selected, draft: decisionDraft(storeContext, selected) })} type="button"><PencilSimple size={15} />修订</button>}{actionVisibility?.resolve && <><button className="workspace-button workspace-button--primary" disabled={!can('decisions.approval.approve') || busy} onClick={() => setResolution('approved')} type="button"><Check size={15} />批准</button><button className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('rejected')} type="button"><ThumbsDown size={15} />拒绝</button><button className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('blocked')} type="button"><Prohibit size={15} />阻断</button><button className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('superseded')} type="button"><ArrowRight size={15} />标记被替代</button></>}{actionVisibility?.batchGrant && <button className="workspace-button workspace-button--secondary" disabled={busy || !grantCompatible(selected)} onClick={() => toggleGrantDecision(selected, !grantDecisionIds.has(selected.id))} type="button"><ShieldCheck size={15} />{grantDecisionIds.has(selected.id) ? '移出授权批次' : '加入授权批次'}</button>}</div></section>
          <section className="decision-domain-recommendation"><div><FileText size={20} weight="duotone" /><div><span>推荐动作</span><strong>{selected.recommendation}</strong><p>{selected.rationale}</p></div></div><dl><div><dt>当前值</dt><dd>{selected.currentValue === undefined ? '—' : `$${String(selected.currentValue)}`}</dd></div><div><dt>推荐值</dt><dd>{selected.recommendedValue === undefined ? '—' : `$${String(selected.recommendedValue)}`}</dd></div><div><dt>策略快照</dt><dd>{selected.policyVersionId} · r{selected.policyRevision}</dd></div><div><dt>有效期</dt><dd>{selected.validUntil?.slice(0, 10) ?? '未设置'}</dd></div></dl></section>
          <div className="decision-domain-evidence-grid"><section><h3>可核验事实</h3><ul>{selected.facts.map((fact) => <li key={fact}><CheckCircle size={15} weight="fill" />{fact}</li>)}</ul></section><section><h3>备选方案</h3>{selected.alternatives.length ? <ol>{selected.alternatives.map((alternative) => <li key={alternative}>{alternative}</li>)}</ol> : <p>未记录备选方案。</p>}<strong>预期效果</strong><p>{selected.expectedEffect ?? '未记录'}</p></section></div>
          <section className="decision-domain-history"><header><div><h3>Decision History</h3><p>每次修订与人工决议都保留快照。</p></div><ClockCounterClockwise size={19} /></header><div>{history.map((item) => <article key={item.id}><span>{item.eventType}</span><strong>r{item.decisionRevision} · {item.actorId}</strong><small>{item.reason ?? item.createdAt}</small></article>)}</div></section>
          <section className="decision-domain-grants"><header><div><h3>Human MissionGrant</h3><p>仅列出当前 Mission 的人工批次授权；终态从持久化 grant events 派生。</p></div><ShieldCheck size={19} /></header>{grants.length ? <div>{grants.map((grant) => { const terminal = terminalGrantEvent(grant); return <article data-revoked={terminal?.eventType === 'revoked' || undefined} data-terminal={terminal?.eventType} key={grant.id}><div><strong>{grant.id}</strong><small>{grant.allowedAdEntityIds.length} 个对象 · ≤ {grant.maxChangePct}% · ${grant.totalImpactBudget} · {terminal ? `已${terminal.eventType}` : '有效'}</small></div>{view === 'decisions/decided' && <button className="workspace-button workspace-button--secondary" disabled={!can('decisions.grants.revoke') || busy || Boolean(terminal)} onClick={() => void revokeGrant(grant)} type="button">{terminal ? terminal.eventType === 'revoked' ? '已撤销' : terminal.eventType === 'consumed' ? '已消费' : '已过期' : '撤销人工授权'}</button>}</article>; })}</div> : <p>当前 Mission 没有人工授权。</p>}</section>
        </> : phase === 'ready' ? <WorkspaceState kind="empty" title={`等待选择${copy.title}`} description="从左侧选择 Decision 查看事实、审批历史与授权边界。" /> : null}</div>
      </div>
      {(error || feedback) && <p className="decision-domain-feedback" data-tone={error ? 'error' : 'success'} aria-live="polite">{error || feedback}</p>}
    </PageFrame>
    {editor && <DecisionDialog record={editor.record} draft={editor.draft} busy={pending === 'decision-save'} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onClose={() => setEditor(null)} onSave={() => void saveDecision()} />}
    {view === 'decisions/approval' && resolution && selected && <div className="mission-control-dialog-backdrop"><section aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="dialog" aria-labelledby="resolve-title"><header><div><span>HUMAN DECISION</span><h2 id="resolve-title">{STATUS_LABELS[resolution]}“{selected.title}”</h2><p>状态写入使用 revision CAS；批准不代表 Ads 已执行。</p></div></header><div className="decision-domain-resolution"><label><span>决议原因 *</span><textarea autoFocus rows={4} value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} /></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setResolution(null)} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || !resolutionReason.trim()} onClick={() => void resolveDecision()} type="button">确认{STATUS_LABELS[resolution]}</button></footer></section></div>}
    {grantEditor && selectedGrantDecisions.length > 0 && <GrantDialog decisions={selectedGrantDecisions} draft={grantEditor} busy={pending === 'grant-issue'} previewMode={previewMode} onChange={setGrantEditor} onClose={() => setGrantEditor(null)} onSave={() => void issueGrant()} />}
  </div>;
}
