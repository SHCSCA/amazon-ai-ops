import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  Browser,
  CheckCircle,
  Circle,
  DotsThree,
  Funnel,
  Hand,
  Hourglass,
  IdentificationCard,
  Pause,
  Play,
  ShieldWarning,
  SkipForward,
  StopCircle,
  Warning,
} from '@phosphor-icons/react';
import {
  missionControlContextKey,
  type AdExecutionBatchProjection,
  type AdExecutionEvidenceSlot,
  type AdExecutionProgressEvent,
  type AdExecutionStatus,
  type AnalysisProposalSnapshotRecord,
  type DecisionRecord,
  type MissionAnalysisProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { WorkspaceState } from '../../components/workspace';
import {
  assertExecutionProjectionBelongsToContext,
  createPreviewExecutionAuthorityApi,
  readExecutionAuthorityWindowApi,
  type ExecutionAuthorityRendererApi,
} from './execution-authority-window-api';
import {
  readMissionDomainWindowApi,
  readDecisionDomainWindowApi,
  type DecisionDomainRendererApi,
  type MissionDomainRendererApi,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';
import './execution-workspace.css';

export interface ExecutionSelectionAuthorityApi {
  listMissions(context: StoreContextEnvelope): Promise<readonly MissionRecord[]>;
  listDecisions(context: StoreContextEnvelope, missionId: string): Promise<readonly DecisionRecord[]>;
  listGrants(context: StoreContextEnvelope, missionId: string): Promise<readonly MissionGrantRecord[]>;
  listGrantEvents(context: StoreContextEnvelope, missionId: string): Promise<readonly MissionGrantEventRecord[]>;
  getMissionProjection(context: StoreContextEnvelope, missionId: string): Promise<MissionAnalysisProjection>;
}

export type ExecutionWorkspaceProps = {
  apiOverride?: ExecutionAuthorityRendererApi;
  blockedReason: string;
  onInspectBoundary?: () => void;
  previewEnabled: boolean;
  selectionApiOverride?: ExecutionSelectionAuthorityApi;
  storeContext: StoreContextEnvelope | null;
};

export interface ExecutionGrantSelection {
  grant: MissionGrantRecord;
  entities: readonly AnalysisProposalSnapshotRecord[];
}

type BrowserSessionState = 'unchecked' | 'resolving' | 'ready' | 'blocked';
type LoadPhase = 'loading' | 'ready' | 'blocked' | 'error';
type ExecutionDetailTab = 'action' | 'compare' | 'readback' | 'evidence' | 'experiment';
type ExecutionBrowserTab = 'home' | 'ads' | 'search';

const TERMINAL = new Set<AdExecutionStatus>(['succeeded', 'blocked', 'unknown', 'cancelled']);
const STATUS_LABELS: Record<AdExecutionStatus, string> = {
  queued: '排队',
  preflight: '预检',
  intent_written: 'Intent 已持久化',
  submitted: '已提交',
  verifying: '回读中',
  succeeded: '成功',
  blocked: '已阻断',
  unknown: 'UNKNOWN',
  cancelled: '已取消',
};

const STEP_DEFINITIONS = [
  { id: 'queue', label: '排队', detail: '绑定 MissionGrant 与完整批次' },
  { id: 'preflight', label: '预检', detail: '重查店铺、会话、身份与 before 值' },
  { id: 'intent', label: 'Intent', detail: '点击前持久化一次性保存意图' },
  { id: 'submitted', label: '提交', detail: '可见浏览器串行执行，绝不并发' },
  { id: 'after', label: 'After', detail: '保存后立即捕获同对象证据' },
  { id: 'reload', label: 'Reload', detail: '刷新后重新读取并核对目标值' },
] as const;

const BUSINESS_PLAN_STEPS = [
  { id: 'scope', title: '身份与店铺范围确认', detail: '当前店铺与 Ads 身份已绑定' },
  { id: 'report', title: '广告报表下载完成', detail: '当前 Mission 的事实批次已冻结' },
  { id: 'import', title: '数据导入并校验', detail: 'US / USD 口径与 revision 已通过' },
  { id: 'analysis', title: 'AI 完成量化诊断', detail: '结构化建议与证据包已生成' },
  { id: 'grant', title: '生成已授权调整动作', detail: '只允许关键词降价且单次不超过 10%' },
  { id: 'act', title: 'Act · 调整广告出价', detail: '可见浏览器串行执行' },
  { id: 'readback', title: '验证与回读', detail: 'before / after / reload 同对象核验' },
] as const;

const DETAIL_TABS: ReadonlyArray<{ id: ExecutionDetailTab; label: string }> = [
  { id: 'action', label: '动作详情' },
  { id: 'compare', label: '前后对比' },
  { id: 'readback', label: '回读验证' },
  { id: 'evidence', label: '证据与归档' },
  { id: 'experiment', label: '关联实验' },
];

const REQUIRED_EXECUTION_EVIDENCE = [
  'page_identity',
  'before_screenshot',
  'after_screenshot',
  'reload_screenshot',
  'readback_value',
] as const;

function readExecutionSelectionAuthorityApi(): ExecutionSelectionAuthorityApi | null {
  const missions = readMissionDomainWindowApi();
  const decisions = readDecisionDomainWindowApi();
  const analysis = readAnalysisAuthorityWindowApi();
  if (!missions || !decisions || !analysis) return null;
  return createExecutionSelectionAuthorityApi(missions, decisions, analysis);
}

function createExecutionSelectionAuthorityApi(
  missions: Pick<MissionDomainRendererApi, 'listMissions'>,
  decisions: Pick<DecisionDomainRendererApi, 'listDecisions' | 'listHumanGrants' | 'listHumanGrantEvents'>,
  analysis: Pick<AnalysisAuthorityRendererApi, 'getMissionProjection'>,
): ExecutionSelectionAuthorityApi {
  return Object.freeze({
    listMissions: (context: StoreContextEnvelope) => missions.listMissions(context, { includeArchived: false }),
    listDecisions: (context: StoreContextEnvelope, missionId: string) => decisions.listDecisions(context, { missionId }),
    listGrants: (context: StoreContextEnvelope, missionId: string) => decisions.listHumanGrants(context, missionId),
    listGrantEvents: (context: StoreContextEnvelope, missionId: string) => decisions.listHumanGrantEvents(context, missionId),
    getMissionProjection: (context: StoreContextEnvelope, missionId: string) => analysis.getMissionProjection(context, missionId),
  });
}

export function selectableExecutionMissions(
  context: StoreContextEnvelope,
  missions: readonly MissionRecord[],
): MissionRecord[] {
  missionControlContextKey(context);
  return missions.filter((mission) => (
    String(mission.storeId) === String(context.storeId)
    && mission.marketplace === 'US'
    && mission.currency === 'USD'
    && mission.status === 'active'
  ));
}

export function buildExecutableGrantSelections(input: {
  context: StoreContextEnvelope;
  mission: MissionRecord;
  grants: readonly MissionGrantRecord[];
  events: readonly MissionGrantEventRecord[];
  decisions: readonly DecisionRecord[];
  projection: MissionAnalysisProjection;
  now: string;
}): ExecutionGrantSelection[] {
  const { context, mission, grants, events, decisions, projection } = input;
  missionControlContextKey(context);
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error('执行选择器需要合法的当前时间。');
  if (String(mission.storeId) !== String(context.storeId)
    || mission.marketplace !== 'US'
    || mission.currency !== 'USD'
    || mission.status !== 'active') return [];

  const decisionById = new Map(decisions
    .filter((decision) => String(decision.storeId) === String(context.storeId)
      && decision.missionId === mission.id
      && decision.status === 'approved'
      && decision.actionType === 'set_keyword_bid')
    .map((decision) => [decision.id, decision]));
  const decisionIdByProposalId = new Map(projection.decisionLinks
    .filter((link) => String(link.storeId) === String(context.storeId))
    .map((link) => [link.proposalId, link.decisionId]));
  const terminalGrantIds = new Set(events
    .filter((event) => String(event.storeId) === String(context.storeId)
      && event.eventType !== 'issued')
    .map((event) => event.grantId));

  return grants.flatMap((grant): ExecutionGrantSelection[] => {
    const grantIsLive = String(grant.storeId) === String(context.storeId)
      && grant.marketplace === 'US'
      && grant.currency === 'USD'
      && grant.missionId === mission.id
      && grant.missionRevision === mission.revision
      && grant.createdSessionGeneration === context.sessionGeneration
      && Date.parse(grant.expiresAt) > now
      && !terminalGrantIds.has(grant.id)
      && grant.allowedActionTypes.includes('set_keyword_bid')
      && grant.maxChangePct > 0
      && grant.maxChangePct <= 10
      && grant.allowedAdEntityIds.length > 0
      && grant.allowedAdEntityIds.length <= 10
      && grant.decisionIds.length > 0
      && grant.decisionIds.length <= 10
      && grant.decisionIds.every((decisionId) => decisionById.has(decisionId))
      && REQUIRED_EXECUTION_EVIDENCE.every((required) => grant.requiredEvidence.includes(required));
    if (!grantIsLive) return [];

    const entities = projection.proposals.filter((proposal) => {
      const decisionId = decisionIdByProposalId.get(proposal.id);
      const decision = decisionId ? decisionById.get(decisionId) : undefined;
      return String(proposal.storeId) === String(context.storeId)
        && proposal.marketplace === 'US'
        && proposal.currency === 'USD'
        && proposal.missionId === mission.id
        && proposal.missionRevision === grant.missionRevision
        && proposal.actionRevision === grant.actionRevision
        && proposal.policyVersionId === grant.policyVersionId
        && proposal.policyRevision === grant.policyRevision
        && proposal.actionType === 'set_keyword_bid'
        && proposal.entityType === 'keyword'
        && Boolean(proposal.adEntityId)
        && grant.allowedAdEntityIds.includes(proposal.adEntityId!)
        && Boolean(decisionId && grant.decisionIds.includes(decisionId))
        && decision?.adEntityId === proposal.adEntityId
        && Date.parse(proposal.validUntil) > now
        && proposal.proposedBidCents < proposal.currentBidCents
        && proposal.changePct < 0
        && Math.abs(proposal.changePct) <= Math.min(10, grant.maxChangePct);
    });
    const eligibleEntityIds = new Set(entities.map((proposal) => proposal.adEntityId));
    const eligibleDecisionIds = new Set(entities.map((proposal) => decisionIdByProposalId.get(proposal.id)));
    if (entities.length > 10
      || entities.length !== grant.allowedAdEntityIds.length
      || eligibleEntityIds.size !== grant.allowedAdEntityIds.length
      || eligibleDecisionIds.size !== grant.decisionIds.length
      || !grant.allowedAdEntityIds.every((entityId) => eligibleEntityIds.has(entityId))
      || !grant.decisionIds.every((decisionId) => eligibleDecisionIds.has(decisionId))) return [];
    return [{ grant, entities }];
  }).sort((left, right) => right.grant.issuedAt.localeCompare(left.grant.issuedAt));
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '执行 Authority 操作未完成，请核对当前店铺与可见浏览器。';
}

function money(cents: number): string {
  return `USD ${(cents / 100).toFixed(2)}`;
}

function shortId(value: string, max = 22): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function formatTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString('zh-CN', { hour12: false });
}

function grantIssuer(
  projection: AdExecutionBatchProjection,
  explicit?: 'human' | 'policy',
): '人工签发' | '策略签发' | '人工 / 策略签发待核验' {
  if (explicit === 'policy') return '策略签发';
  if (explicit === 'human') return '人工签发';
  const actors = projection.jobs.flatMap((job) => job.events.map((event) => event.actorId.toLowerCase()));
  if (projection.batch.grantId.toLowerCase().includes('policy') || actors.some((actor) => actor.includes('policy'))) {
    return '策略签发';
  }
  if (projection.batch.grantId.toLowerCase().includes('human')
    || actors.some((actor) => /operator|human/.test(actor))) return '人工签发';
  return '人工 / 策略签发待核验';
}

function hasCanonicalIdentity(projection: AdExecutionBatchProjection): boolean {
  return projection.jobs.length > 0 && projection.jobs.every((job) => (
    Boolean(job.canonicalKeywordId)
    && Boolean(job.identity.adsAccountId)
    && Boolean(job.identity.campaignId)
    && Boolean(job.identity.adGroupId)
    && Boolean(job.identity.keywordId)
  ));
}

function stepState(
  projection: AdExecutionBatchProjection,
  index: number,
): 'pending' | 'active' | 'done' | 'error' {
  const job = projection.jobs[0];
  if (!job) return 'pending';
  if (job.status === 'unknown' || job.status === 'blocked') {
    const evidenceCount = new Set(job.evidence.map((item) => item.slot)).size;
    const stoppedAt = job.status === 'unknown' ? Math.max(3, 3 + evidenceCount) : Math.max(1, 2 + evidenceCount);
    return index < stoppedAt ? 'done' : index === stoppedAt ? 'error' : 'pending';
  }
  if (job.status === 'cancelled') return index === 0 ? 'error' : 'pending';
  if (job.status === 'succeeded') return 'done';
  const rank: Record<Exclude<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>, number> = {
    queued: 0,
    preflight: 1,
    intent_written: 2,
    submitted: 3,
    verifying: job.evidence.some((item) => item.slot === 'after') ? 5 : 4,
  };
  const active = rank[job.status];
  return index < active ? 'done' : index === active ? 'active' : 'pending';
}

export function preferredExecutionBatchId(rows: readonly AdExecutionBatchProjection[]): string {
  return rows.find((row) => !TERMINAL.has(row.batch.status))?.batch.id
    ?? rows[0]?.batch.id
    ?? '';
}

function confirmStop(): boolean {
  return typeof window !== 'undefined'
    && window.confirm('确认终止当前队列？只有 intent 写入前的动作可以安全取消；审计记录会继续保留。');
}

function evidenceFor(
  projection: AdExecutionBatchProjection,
  slot: AdExecutionEvidenceSlot,
) {
  return projection.jobs.flatMap((job) => job.evidence).find((evidence) => evidence.slot === slot);
}

function PreviewBanner({ onInspectBoundary }: { onInspectBoundary?: () => void }) {
  return (
    <div className="execution-preview-banner" role="note">
      <strong>仅开发预览</strong>
      <span>内存 mock · Amazon US / USD · 只演示降价且单次不超过 10% · 不调用真实 API、不写入 Ads</span>
      {onInspectBoundary && <button onClick={onInspectBoundary} type="button">查看接入边界</button>}
    </div>
  );
}

export function ExecutionWorkspace({
  apiOverride,
  blockedReason,
  onInspectBoundary,
  previewEnabled,
  selectionApiOverride,
  storeContext,
}: ExecutionWorkspaceProps) {
  const previewApiRef = useRef<ExecutionAuthorityRendererApi>();
  if (previewEnabled && !previewApiRef.current) previewApiRef.current = createPreviewExecutionAuthorityApi();
  const api = useMemo(
    () => apiOverride ?? (previewEnabled ? previewApiRef.current ?? null : readExecutionAuthorityWindowApi()),
    [apiOverride, previewEnabled],
  );
  const selectionApi = useMemo(
    () => selectionApiOverride ?? (previewEnabled ? null : readExecutionSelectionAuthorityApi()),
    [previewEnabled, selectionApiOverride],
  );
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : 'missing';
  const authorityKeyRef = useRef(authorityKey);
  const requestSequence = useRef(0);
  const missionRequestSequence = useRef(0);
  const grantRequestSequence = useRef(0);
  const [phase, setPhase] = useState<LoadPhase>(() => (!storeContext || !api) ? 'blocked' : 'loading');
  const [batches, setBatches] = useState<AdExecutionBatchProjection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState(previewEnabled ? 'preview-mission:keyword-efficiency' : '');
  const [grantSelections, setGrantSelections] = useState<ExecutionGrantSelection[]>([]);
  const [selectionPhase, setSelectionPhase] = useState<LoadPhase>(previewEnabled ? 'ready' : 'loading');
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [grantId, setGrantId] = useState(previewEnabled ? 'preview-grant-human' : '');
  const [adEntityId, setAdEntityId] = useState(previewEnabled ? 'preview-ad-entity-keyword-1' : '');
  const [resolvedEntityIds, setResolvedEntityIds] = useState<Set<string>>(() => new Set());
  const [browserSession, setBrowserSession] = useState<BrowserSessionState>(previewEnabled ? 'ready' : 'unchecked');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => !api && !previewEnabled
    ? 'Execution production window API 未接入；Renderer 不会回退到预览数据。'
    : null);
  const [feedback, setFeedback] = useState('');
  const [progressEvents, setProgressEvents] = useState<AdExecutionProgressEvent[]>([]);
  const [reconciliation, setReconciliation] = useState(false);
  const [issuerByGrantId, setIssuerByGrantId] = useState<Record<string, 'human' | 'policy'>>({});
  const [authorityOpen, setAuthorityOpen] = useState(false);
  const [browserTab, setBrowserTab] = useState<ExecutionBrowserTab>('ads');
  const [detailTab, setDetailTab] = useState<ExecutionDetailTab>('action');
  const [queueFilter, setQueueFilter] = useState('all');
  const [keywordSearch, setKeywordSearch] = useState('');

  authorityKeyRef.current = authorityKey;
  const selected = batches.find((projection) => projection.batch.id === selectedId) ?? null;
  const selectedMission = missions.find((mission) => mission.id === selectedMissionId) ?? null;
  const selectedGrantSelection = grantSelections.find((selection) => selection.grant.id === grantId) ?? null;
  const selectableEntities = selectedGrantSelection?.entities ?? [];
  const allSelectedEntitiesResolved = previewEnabled
    ? Boolean(adEntityId && resolvedEntityIds.has(adEntityId))
    : selectableEntities.length > 0
      && selectableEntities.every((proposal) => proposal.adEntityId && resolvedEntityIds.has(proposal.adEntityId));
  const running = batches.some((projection) => !TERMINAL.has(projection.batch.status)
    && !['queued', 'preflight'].includes(projection.batch.status));

  const load = async (keepSelection = true) => {
    const sequence = ++requestSequence.current;
    const capturedKey = authorityKey;
    if (!storeContext) {
      setBatches([]);
      setSelectedId('');
      setPhase('blocked');
      setError('StoreContext 尚未建立，实时执行已失败关闭。');
      return;
    }
    if (!api) {
      setBatches([]);
      setSelectedId('');
      setPhase('blocked');
      setError('Execution production window API 未接入；Renderer 不会回退到预览数据。');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      const rows = [...await api.listBatches(storeContext)];
      if (authorityKeyRef.current !== capturedKey || requestSequence.current !== sequence) return;
      rows.forEach((projection) => assertExecutionProjectionBelongsToContext(storeContext, projection));
      const issuers: Record<string, 'human' | 'policy'> = {};
      if (selectionApi) {
        const missionIds = [...new Set(rows.map((projection) => projection.batch.missionId))];
        const grantsByMission = await Promise.allSettled(
          missionIds.map((missionId) => selectionApi.listGrants(storeContext, missionId)),
        );
        grantsByMission.forEach((result) => {
          if (result.status !== 'fulfilled') return;
          result.value.forEach((grant) => { issuers[grant.id] = grant.issuer.type; });
        });
      }
      if (authorityKeyRef.current !== capturedKey || requestSequence.current !== sequence) return;
      setIssuerByGrantId(issuers);
      setBatches(rows);
      setSelectedId((current) => keepSelection && rows.some((row) => row.batch.id === current)
        ? current
        : preferredExecutionBatchId(rows));
      setPhase('ready');
    } catch (loadError) {
      if (authorityKeyRef.current !== capturedKey || requestSequence.current !== sequence) return;
      setBatches([]);
      setSelectedId('');
      setPhase('error');
      setError(errorMessage(loadError));
    }
  };

  useEffect(() => {
    setMissions([]);
    setSelectedMissionId(previewEnabled ? 'preview-mission:keyword-efficiency' : '');
    setGrantSelections([]);
    setGrantId(previewEnabled ? 'preview-grant-human' : '');
    setAdEntityId(previewEnabled ? 'preview-ad-entity-keyword-1' : '');
    setResolvedEntityIds(new Set());
    setSelectionError(null);
    setSelectionPhase(previewEnabled ? 'ready' : 'loading');
    setBrowserSession(previewEnabled ? 'ready' : 'unchecked');
    setProgressEvents([]);
    setIssuerByGrantId({});
    setReconciliation(false);
    setAuthorityOpen(false);
    setBrowserTab('ads');
    setDetailTab('action');
    setQueueFilter('all');
    setKeywordSearch('');
    void load(false);
    if (previewEnabled) return;
    const sequence = ++missionRequestSequence.current;
    const capturedKey = authorityKey;
    if (!storeContext || !selectionApi) {
      setSelectionPhase('blocked');
      setSelectionError(!storeContext
        ? 'StoreContext 尚未建立，不能读取 Mission Authority。'
        : 'Mission / Grant / Analysis 选择 API 未完整接入；不能创建真实队列。');
      return;
    }
    void selectionApi.listMissions(storeContext).then((records) => {
      if (authorityKeyRef.current !== capturedKey || missionRequestSequence.current !== sequence) return;
      const eligible = selectableExecutionMissions(storeContext, records);
      setMissions(eligible);
      setSelectedMissionId(eligible[0]?.id ?? '');
      setSelectionPhase('ready');
      if (!eligible.length) setSelectionError('当前店铺没有 active 的 US/USD Mission，不能创建执行队列。');
    }).catch((selectionLoadError) => {
      if (authorityKeyRef.current !== capturedKey || missionRequestSequence.current !== sequence) return;
      setMissions([]);
      setSelectedMissionId('');
      setSelectionPhase('error');
      setSelectionError(errorMessage(selectionLoadError));
    });
    // A changed authority key invalidates all Renderer-local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authorityKey, previewEnabled, selectionApi]);

  useEffect(() => {
    if (previewEnabled || !storeContext || !selectionApi || !selectedMission
      || String(selectedMission.storeId) !== String(storeContext.storeId)) return;
    const sequence = ++grantRequestSequence.current;
    const capturedKey = authorityKey;
    setGrantSelections([]);
    setGrantId('');
    setAdEntityId('');
    setResolvedEntityIds(new Set());
    setSelectionPhase('loading');
    setSelectionError(null);
    void Promise.all([
      selectionApi.listGrants(storeContext, selectedMission.id),
      selectionApi.listGrantEvents(storeContext, selectedMission.id),
      selectionApi.listDecisions(storeContext, selectedMission.id),
      selectionApi.getMissionProjection(storeContext, selectedMission.id),
    ]).then(([grants, events, decisions, projection]) => {
      if (authorityKeyRef.current !== capturedKey || grantRequestSequence.current !== sequence) return;
      assertAnalysisProjectionBelongsToContext(storeContext, selectedMission.id, projection);
      const selections = buildExecutableGrantSelections({
        context: storeContext,
        mission: selectedMission,
        grants,
        events,
        decisions,
        projection,
        now: new Date().toISOString(),
      });
      setGrantSelections(selections);
      const first = selections[0];
      setGrantId(first?.grant.id ?? '');
      setAdEntityId(first?.entities[0]?.adEntityId ?? '');
      setIssuerByGrantId((current) => ({
        ...current,
        ...Object.fromEntries(selections.map((selection) => [selection.grant.id, selection.grant.issuer.type])),
      }));
      setSelectionPhase('ready');
      if (!selections.length) {
        setSelectionError('该 Mission 没有同时满足当前会话、有效期、已批准决定、≤10% 降价与证据要求的 Grant。');
      }
    }).catch((selectionLoadError) => {
      if (authorityKeyRef.current !== capturedKey || grantRequestSequence.current !== sequence) return;
      setGrantSelections([]);
      setGrantId('');
      setAdEntityId('');
      setSelectionPhase('error');
      setSelectionError(errorMessage(selectionLoadError));
    });
  }, [authorityKey, previewEnabled, selectedMission, selectionApi, storeContext]);

  useEffect(() => {
    if (!api || !storeContext) return undefined;
    const currentStoreId = String(storeContext.storeId);
    return api.onProgress((event) => {
      if (String(event.storeId) !== currentStoreId) return;
      setProgressEvents((events) => [event, ...events].slice(0, 80));
      if (event.phase === 'identity' && event.status === 'ready') {
        setBrowserSession('ready');
      }
      if (event.phase === 'terminal' || event.phase === 'readback' || event.phase === 'submit') {
        void load(true);
      }
    });
    // load has stable authority guards even though its closure changes per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authorityKey]);

  const replaceProjection = (projection: AdExecutionBatchProjection) => {
    if (!storeContext) return;
    assertExecutionProjectionBelongsToContext(storeContext, projection);
    setBatches((rows) => {
      const index = rows.findIndex((row) => row.batch.id === projection.batch.id);
      if (index < 0) return [projection, ...rows];
      return rows.map((row) => row.batch.id === projection.batch.id ? projection : row);
    });
    setSelectedId(projection.batch.id);
  };

  const mutate = async (name: string, action: () => Promise<void>) => {
    if (pending) return;
    setPending(name);
    setError(null);
    setFeedback('');
    try {
      await action();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setPending(null);
    }
  };

  const resolveIdentity = () => mutate('identity', async () => {
    if (!api || !storeContext || !grantId.trim() || !adEntityId.trim()) {
      throw new Error('请选择当前 Mission 的有效 Grant 与已决定广告对象。');
    }
    if (!previewEnabled) {
      const currentGrant = grantSelections.find((selection) => selection.grant.id === grantId);
      if (!currentGrant?.entities.some((proposal) => proposal.adEntityId === adEntityId)) {
        throw new Error('当前广告对象不属于所选 Grant 的已批准完整批次。');
      }
    }
    setBrowserSession('resolving');
    await api.resolveIdentity({ context: storeContext, grantId: grantId.trim(), adEntityId: adEntityId.trim() });
    const nextResolved = new Set(resolvedEntityIds).add(adEntityId.trim());
    setResolvedEntityIds(nextResolved);
    const nextEntity = selectableEntities.find((proposal) => proposal.adEntityId && !nextResolved.has(proposal.adEntityId));
    if (nextEntity?.adEntityId) setAdEntityId(nextEntity.adEntityId);
    setBrowserSession('ready');
    setFeedback('当前对象的可见 Ads 页身份已解析；如 Grant 含多个动作，请逐一解析后再建队列。');
  });

  const createBatch = () => mutate('create', async () => {
    if (!api || !storeContext || !grantId.trim()) throw new Error('请选择已有 MissionGrant。');
    if (!allSelectedEntitiesResolved) throw new Error('请先解析该 Grant 完整批次中每个对象的当前 Ads 页身份。');
    const result = await api.createBatch({ context: storeContext, grantId: grantId.trim() });
    replaceProjection(result.projection);
    if (previewEnabled && grantId.includes('policy')) {
      const observed = await api.startBatch({ context: storeContext, batchId: result.projection.batch.id });
      replaceProjection(observed);
      setFeedback('仅开发预览：策略签发批次已由内存 Main 自动推进；Renderer 仅观察并可人工接管。');
      return;
    }
    setFeedback(result.created ? '已从不可变 MissionGrant 创建完整串行批次。' : '已返回该 Grant 的现有幂等批次。');
  });

  const inspectBrowser = () => mutate('takeover', async () => {
    if (!api || !storeContext || !selected) throw new Error('请先选择一个执行批次。');
    await api.takeOverVisibleBrowser({ context: storeContext, batchId: selected.batch.id });
    setBrowserSession('ready');
    setFeedback(previewEnabled ? '仅开发预览：已切换内存浏览器演示。' : '当前店铺的可见 Ads 浏览器已置前并完成会话检查。');
  });

  const startBatch = () => mutate('start', async () => {
    if (!api || !storeContext || !selected) throw new Error('请先选择一个执行批次。');
    if (!hasCanonicalIdentity(selected) || browserSession !== 'ready') {
      throw new Error('稳定关键词身份与当前可见浏览器会话必须同时就绪。');
    }
    const projection = await api.startBatch({ context: storeContext, batchId: selected.batch.id });
    replaceProjection(projection);
    setFeedback(projection.batch.status === 'unknown'
      ? '结果为 UNKNOWN：串行队列已停止，不会自动重试。'
      : '串行执行已返回最新 Authority 投影。');
  });

  const cancelBatch = () => mutate('cancel', async () => {
    if (!api || !storeContext || !selected) throw new Error('请先选择一个执行批次。');
    if (!confirmStop()) return;
    const projection = await api.cancelBatch({
      context: storeContext,
      batchId: selected.batch.id,
      reason: 'operator_confirmed_stop_before_intent',
    });
    replaceProjection(projection);
    setFeedback('队列已在 intent 前终止；审计记录继续保留。');
  });

  const selectedUnknown = selected?.batch.status === 'unknown'
    || selected?.jobs.some((job) => job.status === 'unknown');
  const selectedIssuer = selected ? grantIssuer(selected, issuerByGrantId[selected.batch.grantId]) : null;
  const canCancel = Boolean(selected)
    && selected!.jobs.every((job) => ['queued', 'preflight'].includes(job.status));
  const canStart = Boolean(selected)
    && !running
    && selectedIssuer !== '策略签发'
    && !selectedUnknown
    && hasCanonicalIdentity(selected!)
    && browserSession === 'ready'
    && selected!.jobs.some((job) => ['queued', 'preflight'].includes(job.status));

  if (phase === 'blocked' && !previewEnabled) {
    return (
      <div className="execution-workspace" data-canonical-surface="execution" data-capability-state="BLOCKED">
        <h1 className="execution-page-title">实时执行</h1>
        <WorkspaceState
          description="生产 Renderer 不会把预览队列或本地假状态冒充真实 Ads 执行。"
          details={`execution/live.view BLOCKED · 已阻断 · ${error ?? blockedReason} · execution.queue.start`}
          kind="blocked"
          title="实时执行 Authority 未就绪"
        />
      </div>
    );
  }

  const durableEvents = selected?.jobs.flatMap((job) => job.events.map((event) => ({
    id: event.id,
    at: event.createdAt,
    message: `${event.eventType} · ${event.detail ?? event.toStatus}`,
    status: event.toStatus,
  }))) ?? [];
  const consoleRows = [
    ...progressEvents.map((event, index) => ({
      id: `progress:${event.occurredAt}:${index}`,
      at: event.occurredAt,
      message: `${event.phase} · ${event.message}`,
      status: event.status,
    })),
    ...durableEvents,
  ].slice(0, 80);
  const selectedJob = selected?.jobs[0] ?? null;
  const missionTitle = selectedMission?.title
    ?? (previewEnabled ? 'Prime Day 后 7 日利润守护' : '等待选择可执行 Mission');
  const missionSubtitle = selectedJob
    ? `关键词出价调整 · ${shortId(selectedJob.adEntityId, 42)}`
    : '关键词出价调整 · Amazon US / USD';
  const planCompleted = selected?.batch.status === 'succeeded' ? 7 : grantId ? 5 : 0;
  const keywordNeedle = keywordSearch.trim().toLowerCase();
  const visibleSelectedJobs = selected?.jobs.filter((job) => (
    (!keywordNeedle
      || job.adEntityId.toLowerCase().includes(keywordNeedle)
      || job.identity.campaignId.toLowerCase().includes(keywordNeedle)
      || job.identity.adGroupId.toLowerCase().includes(keywordNeedle))
    && (queueFilter === 'all'
      || (queueFilter === 'policy' && Math.abs(job.changePct) <= 10)
      || (queueFilter === 'approval' && Math.abs(job.changePct) > 10))
  )) ?? [];
  const visibleSelectableEntities = selectableEntities.filter((proposal) => (
    (!keywordNeedle
      || proposal.entityName.toLowerCase().includes(keywordNeedle)
      || proposal.campaignName.toLowerCase().includes(keywordNeedle)
      || proposal.adGroupName.toLowerCase().includes(keywordNeedle))
    && (queueFilter === 'all'
      || (queueFilter === 'policy' && Math.abs(proposal.changePct) <= 10)
      || (queueFilter === 'approval' && Math.abs(proposal.changePct) > 10))
  ));
  const selectedProposalId = selectableEntities.find((proposal) => proposal.adEntityId === adEntityId)?.id ?? '';

  return (
    <div
      className="execution-workspace execution-workspace--mission"
      data-canonical-surface="execution"
      data-capability-state={previewEnabled
        ? 'PROTOTYPE_ONLY'
        : phase === 'ready' && selectionPhase === 'ready' && selectionApi
          ? 'PRODUCTION_NATIVE'
          : 'BLOCKED'}
      data-store-actions-locked={running || undefined}
      data-reconciliation-active={reconciliation || undefined}
      data-mutations-disabled={previewEnabled || undefined}
    >
      <h1 className="execution-page-title">实时执行</h1>
      <header className="execution-mission-header">
        <div>
          <span>EXECUTION · {shortId((selected?.batch.id ?? selectedMissionId) || 'WAITING', 34)}</span>
          <h2>{missionTitle}</h2>
          <p>{missionSubtitle}</p>
        </div>
        <div className="execution-mission-actions" role="group" aria-label="Mission 执行控制">
          <button aria-pressed={authorityOpen} className="execution-button execution-button--secondary" onClick={() => setAuthorityOpen((value) => !value)} type="button"><IdentificationCard size={16} />执行来源</button>
          <button className="execution-button execution-button--secondary" disabled={!selected || Boolean(pending)} onClick={inspectBrowser} type="button"><Hand size={16} />{pending === 'takeover' ? '置前中…' : '接管浏览器'}</button>
          <button className="execution-button execution-button--secondary" disabled={!canCancel || Boolean(pending)} onClick={cancelBatch} type="button"><SkipForward size={16} />跳过此对象</button>
          <button aria-label="更多执行选项" className="execution-icon-button" onClick={() => setAuthorityOpen(true)} type="button"><DotsThree size={20} weight="bold" /></button>
        </div>
      </header>

      <section className="execution-contract-strip" aria-label="执行合同">
        <div><span>任务 ID</span><strong>{shortId((selected?.batch.id ?? selectedMissionId) || '等待选择', 32)}</strong></div>
        <div><span>执行模式</span><strong>{selectedIssuer ?? (grantId.includes('policy') ? '策略签发' : grantId ? '人工签发' : '等待授权')}</strong></div>
        <div><span>风险等级</span><strong>低风险 · 降幅 ≤ 10%</strong></div>
        <div><span>安全状态</span><strong data-tone={grantId ? 'safe' : 'waiting'}><ShieldWarning size={14} weight="fill" />{grantId ? '策略边界 已通过' : '等待 MissionGrant'}</strong></div>
      </section>

      {previewEnabled && <PreviewBanner onInspectBoundary={onInspectBoundary} />}

      <div className="execution-boundary-alert" role="status">
        <Warning size={17} weight="fill" />
        <strong>{previewEnabled ? '1 个对象超出策略内自动边界，已隔离转人工审批' : selectedUnknown ? '当前批次进入 UNKNOWN，已停止且禁止自动重试' : '越界对象不会进入当前串行批次'}</strong>
        <button onClick={() => setAuthorityOpen(true)} type="button">查看执行来源与边界</button>
      </div>

      <section className="execution-authority-bar" aria-label="执行 Authority 与队列创建" hidden={!authorityOpen}>
        <div className="execution-authority-copy">
          <span>MISSIONGRANT → SERIAL EXECUTION</span>
          <strong>从已有授权创建真实串行队列</strong>
          <small>Renderer 只提交 context 与已有 grant / batch / adEntity ID；目标值、稳定 Ads IDs、选择器和证据路径始终由 Main 重建。</small>
        </div>
        <div className="execution-authority-form">
          <label>
            <span>当前 Mission</span>
            {previewEnabled ? (
              <select aria-label="开发预览 Mission" disabled value={selectedMissionId}>
                <option value="preview-mission:keyword-efficiency">Prime Day 后利润守护 · 仅开发预览</option>
              </select>
            ) : (
              <select aria-label="当前 Mission" disabled={running || Boolean(pending) || selectionPhase === 'loading'} onChange={(event) => {
                setSelectedMissionId(event.target.value);
                setGrantSelections([]);
                setGrantId('');
                setAdEntityId('');
                setResolvedEntityIds(new Set());
              }} value={selectedMissionId}>
                <option value="">{selectionPhase === 'loading' ? '正在读取 Mission…' : '请选择 active Mission'}</option>
                {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title} · {mission.productId ?? '全店'} · r{mission.revision}</option>)}
              </select>
            )}
          </label>
          <label>
            <span>有效 MissionGrant</span>
            {previewEnabled ? (
              <select aria-label="有效 MissionGrant" disabled={running || Boolean(pending)} onChange={(event) => {
                setGrantId(event.target.value);
                setResolvedEntityIds(new Set());
              }} value={grantId}>
                <option value="preview-grant-human">人工签发 · 正常回读 · 1 个动作</option>
                <option value="preview-grant-policy">策略签发 · 自动推进 · 1 个动作</option>
                <option value="preview-grant-unknown-human">人工签发 · UNKNOWN 演示 · 1 个动作</option>
              </select>
            ) : (
              <select aria-label="有效 MissionGrant" disabled={running || Boolean(pending) || !selectedMissionId || selectionPhase === 'loading'} onChange={(event) => {
                const nextGrantId = event.target.value;
                const next = grantSelections.find((selection) => selection.grant.id === nextGrantId);
                setGrantId(nextGrantId);
                setAdEntityId(next?.entities[0]?.adEntityId ?? '');
                setResolvedEntityIds(new Set());
              }} value={grantId}>
                <option value="">{selectionPhase === 'loading' ? '正在核验 Grant…' : '请选择尚可执行的 Grant'}</option>
                {grantSelections.map(({ grant, entities }) => <option key={grant.id} value={grant.id}>{grant.issuer.type === 'policy' ? '策略签发' : '人工签发'} · {entities.length} 个降价动作 · 到期 {grant.expiresAt.slice(5, 16).replace('T', ' ')}</option>)}
              </select>
            )}
          </label>
          <label>
            <span>已决定广告对象</span>
            {previewEnabled ? (
              <select aria-label="已决定广告对象" disabled={running || Boolean(pending)} value={adEntityId} onChange={(event) => {
                setAdEntityId(event.target.value);
                setResolvedEntityIds(new Set());
              }}>
                <option value="preview-ad-entity-keyword-1">smart lock exact · US Exact Core · USD 1.20 → 1.08</option>
              </select>
            ) : (
              <select aria-label="已决定广告对象" disabled={running || Boolean(pending) || !selectedGrantSelection} onChange={(event) => setAdEntityId(event.target.value)} value={adEntityId}>
                <option value="">请选择 Grant 内的广告对象</option>
                {selectableEntities.map((proposal) => <option key={proposal.id} value={proposal.adEntityId}>{proposal.entityName} · {proposal.campaignName} / {proposal.adGroupName} · {money(proposal.currentBidCents)} → {money(proposal.proposedBidCents)} ({proposal.changePct.toFixed(1)}%)</option>)}
              </select>
            )}
          </label>
          <button className="execution-button execution-button--secondary" disabled={running || Boolean(pending) || !grantId || !adEntityId || resolvedEntityIds.has(adEntityId)} onClick={resolveIdentity} type="button"><IdentificationCard size={16} />{pending === 'identity' ? '解析中…' : resolvedEntityIds.has(adEntityId) ? '当前对象身份已解析' : '解析当前 Ads 页身份'}</button>
          <button className="execution-button execution-button--primary" disabled={running || Boolean(pending) || !allSelectedEntitiesResolved} onClick={createBatch} type="button">{pending === 'create' ? '建队列中…' : '从完整 Grant 建队列'}</button>
          <div className="execution-selection-ids" aria-label="Authority 只读标识">
            <span>Mission <code>{selectedMissionId || '—'}</code></span>
            <span>Grant <code>{grantId || '—'}</code></span>
            <span>Entity <code>{adEntityId || '—'}</code></span>
            <b>{previewEnabled ? '仅开发预览 mock' : `${resolvedEntityIds.size}/${selectableEntities.length} 个对象身份已解析`}</b>
          </div>
          {!previewEnabled && selectionError && <p className="execution-selection-state" data-tone="blocked">{selectionError}</p>}
        </div>
      </section>

      {(error || feedback) && <div aria-live="polite" className="execution-feedback" data-tone={error ? 'danger' : 'success'} role="status">{error ?? feedback}</div>}

      <div className="execution-cockpit execution-cockpit--prototype">
        <aside className="execution-plan" aria-label="执行计划">
          <header><div><strong>执行计划（{planCompleted} / 7）</strong><small>每一步都可以暂停与人工接管</small></div></header>
          <ol>
            {BUSINESS_PLAN_STEPS.map((step, index) => {
              const isAction = index === 5;
              const isReadback = index === 6;
              const state = index < 5
                ? (grantId ? 'done' : 'pending')
                : isAction
                  ? (selectedUnknown ? 'error' : selected?.batch.status === 'succeeded' ? 'done' : selected ? 'active' : 'pending')
                  : isReadback && selected?.batch.status === 'succeeded'
                    ? 'done'
                    : isReadback && selected?.batch.status === 'verifying'
                      ? 'active'
                      : 'pending';
              return <li data-state={state} key={step.id}>
                <span>{state === 'done' ? <CheckCircle size={17} weight="fill" /> : state === 'error' ? <Warning size={17} weight="fill" /> : state === 'active' ? <Hourglass size={17} /> : <Circle size={17} />}</span>
                <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                <em>{state === 'done' ? '完成' : state === 'active' ? '进行中' : state === 'error' ? '停止' : '等待'}</em>
              </li>;
            })}
          </ol>
          <section className="execution-current-object">
            <span>当前对象 {selectedJob ? `${selectedJob.ordinal} / ${selected?.jobs.length}` : '—'}</span>
            <strong>{selectedJob ? shortId(selectedJob.adEntityId, 34) : '等待创建真实执行队列'}</strong>
            <small>{selectedJob ? `${money(selectedJob.expectedBidCents)} → ${money(selectedJob.targetBidCents)}` : '从已有 MissionGrant 开始，不支持手填 ID'}</small>
          </section>
          <section className="execution-queue" aria-label="真实执行队列">
            <header><div><span>EXECUTION QUEUE</span><strong>串行批次</strong></div><b>{batches.length}</b></header>
            <div className="execution-queue__list" role="listbox" aria-label="选择执行批次">
              {batches.map((projection) => (
                <button aria-selected={projection.batch.id === selectedId} data-status={projection.batch.status} key={projection.batch.id} onClick={() => { setSelectedId(projection.batch.id); setReconciliation(false); }} role="option" type="button">
                  <span><b>{shortId(projection.batch.id)}</b><em>{STATUS_LABELS[projection.batch.status]}</em></span>
                  <small>{projection.jobs.length} 个动作 · {grantIssuer(projection, issuerByGrantId[projection.batch.grantId])}</small>
                </button>
              ))}
              {phase === 'loading' && <p>正在读取当前店铺执行 Authority…</p>}
              {phase !== 'loading' && batches.length === 0 && <p>暂无批次。先解析当前 Ads 页身份，再从已有 MissionGrant 建队列。</p>}
            </div>
          </section>
        </aside>

        <section className="execution-live-stage">
          <section className="execution-visible-browser" aria-label="当前店铺可见浏览器">
            <header>
              <div><Browser size={18} weight="duotone" /><span><strong>{previewEnabled ? '领星可见 Ads 浏览器预览 · 关键词' : '领星可见 Ads 浏览器 · 关键词'}</strong><small>{previewEnabled ? `仅开发预览，不连接领星、不写入 Ads · ${storeContext ? String(storeContext.storeId) : '未建立'}` : `当前店铺 ${storeContext ? String(storeContext.storeId) : '未建立'}`}</small></span></div>
              <div className="execution-browser-header-actions"><b data-session={browserSession}>{browserSession === 'ready' ? '会话可用' : browserSession === 'resolving' ? '身份解析中' : browserSession === 'blocked' ? '会话阻断' : '待检查'}</b><button aria-label="刷新当前执行投影" onClick={() => void load(true)} type="button"><ArrowClockwise size={15} /></button></div>
            </header>
            <div className="execution-browser-tabs" role="tablist" aria-label="领星页面标签">
              {([{ id: 'home', label: '首页' }, { id: 'ads', label: '广告管理' }, { id: 'search', label: '搜索词报告' }] as const).map((tab) => <button aria-selected={browserTab === tab.id} key={tab.id} onClick={() => setBrowserTab(tab.id)} role="tab" type="button">{tab.label}</button>)}
              <button aria-label="新建领星标签" className="execution-browser-new-tab" disabled={previewEnabled} type="button">＋</button>
            </div>
            <div className="execution-browser-chrome"><i /><i /><i /><span><ShieldWarning size={13} />{previewEnabled ? 'preview://visible-ads-session · 不会访问真实页面' : 'Main 管理的当前店铺可见 Ads 页面 · URL/路径不暴露给 Renderer'}</span></div>

            {browserTab === 'ads' ? <div className="execution-browser-workbench" role="tabpanel" aria-label="广告管理">
              <nav aria-label="领星广告管理导航">
                {['概览', '广告活动', '广告组', '关键词', '搜索词报告', '商品投放', '否定关键词', '广告设置'].map((item) => <button aria-current={item === '关键词' ? 'page' : undefined} key={item} type="button">{item}</button>)}
              </nav>
              <div className="execution-browser-table-stage">
                <header><div><strong>关键词</strong><span>当前表格是 Main Authority 的受控动作投影。</span></div></header>
                <div className="execution-browser-filters">
                  <label><span>队列筛选</span><select aria-label="队列筛选" onChange={(event) => setQueueFilter(event.target.value)} value={queueFilter}><option value="all">全部调整对象</option><option value="policy">策略内动作</option><option value="approval">需人工审批</option></select></label>
                  <label><span>搜索调整对象</span><input aria-label="搜索调整对象" onChange={(event) => setKeywordSearch(event.target.value)} placeholder="搜索关键词或广告对象" value={keywordSearch} /></label>
                  <button className="execution-button execution-button--secondary" onClick={() => setFeedback(`已按当前条件筛选 ${visibleSelectedJobs.length || visibleSelectableEntities.length || (previewEnabled ? 2 : 0)} 个对象。`)} type="button"><Funnel size={15} />应用筛选</button>
                  <span>更新时间 刚刚</span>
                </div>
                <div className="execution-object-grid">
                  <table aria-label="选中批次广告动作" className="execution-keyword-table">
                    <thead><tr><th>当前对象</th><th>对象 / 搜索词</th><th>动作维度</th><th>状态</th><th>花费 (USD)</th><th>销售额 (USD)</th><th>ACOS</th><th>当前出价 (USD)</th><th>建议出价 (USD)</th><th>变更幅度</th><th>操作</th></tr></thead>
                    <tbody>
                      {visibleSelectedJobs.map((job) => <tr data-status={job.status} key={job.id}><td><input aria-label="选择当前执行对象" checked={job.id === selectedJob?.id} readOnly type="radio" /></td><td><strong>{shortId(job.adEntityId, 26)}</strong><small>{shortId(job.identity.campaignId, 24)}</small></td><td>关键词竞价</td><td>{STATUS_LABELS[job.status]}</td><td>—</td><td>—</td><td>—</td><td><input aria-label="当前出价" readOnly value={(job.expectedBidCents / 100).toFixed(2)} /></td><td><input aria-label="建议出价" readOnly value={(job.targetBidCents / 100).toFixed(2)} /></td><td>{job.changePct.toFixed(1)}%</td><td><button disabled type="button">{STATUS_LABELS[job.status]}</button></td></tr>)}
                      {!selected && visibleSelectableEntities.map((proposal) => <tr key={proposal.id}><td><input aria-label={`选择 ${proposal.entityName}`} checked={proposal.id === selectedProposalId} readOnly type="radio" /></td><td><strong>{proposal.entityName}</strong><small>{proposal.campaignName}</small></td><td>关键词竞价</td><td>已授权</td><td>—</td><td>—</td><td>—</td><td><input aria-label="当前出价" readOnly value={(proposal.currentBidCents / 100).toFixed(2)} /></td><td><input aria-label="建议出价" readOnly value={(proposal.proposedBidCents / 100).toFixed(2)} /></td><td>{proposal.changePct.toFixed(1)}%</td><td><button onClick={() => setAdEntityId(proposal.adEntityId ?? '')} type="button">选择对象</button></td></tr>)}
                      {previewEnabled && !selected && queueFilter !== 'approval' && (!keywordNeedle || 'smart lock exact'.includes(keywordNeedle)) && <tr><td><input aria-label="选择 smart lock exact" checked readOnly type="radio" /></td><td><strong>smart lock exact</strong><small>US Exact Core</small></td><td>精准匹配</td><td>已授权</td><td>86.40</td><td>492.00</td><td>17.6%</td><td><input aria-label="当前出价" readOnly value="1.20" /></td><td><input aria-label="建议出价" readOnly value="1.08" /></td><td>-10.0%</td><td><button disabled={!resolvedEntityIds.has(adEntityId)} onClick={createBatch} type="button">应用 $1.08</button></td></tr>}
                      {previewEnabled && !selected && queueFilter !== 'policy' && (!keywordNeedle || 'fingerprint door lock'.includes(keywordNeedle)) && <tr data-status="approval"><td><input aria-label="选择 fingerprint door lock" readOnly type="radio" /></td><td><strong>fingerprint door lock</strong><small>US Broad Discovery</small></td><td>广泛匹配</td><td>越界隔离</td><td>61.20</td><td>144.00</td><td>42.5%</td><td><input aria-label="当前出价" readOnly value="1.10" /></td><td><input aria-label="建议出价" readOnly value="0.88" /></td><td>-20.0%</td><td><button disabled type="button">转人工审批</button></td></tr>}
                    </tbody>
                  </table>
                </div>
                <footer>共 {visibleSelectedJobs.length || visibleSelectableEntities.length || (previewEnabled ? 2 : 0)} 条 <button disabled type="button">上一页</button><button aria-current="page" type="button">1</button><button disabled type="button">下一页</button></footer>
              </div>
            </div> : <div className="execution-browser-empty" role="tabpanel"><Browser size={30} weight="duotone" /><strong>{browserTab === 'home' ? '领星首页' : '搜索词报告'}</strong><p>{previewEnabled ? '仅开发预览：此标签用于验证页面切换，不读取领星数据。' : '当前标签由 Main 管理的可见浏览器提供。'}</p></div>}
          </section>

          <section className="execution-serial-steps" aria-label="串行执行步骤">
            <header><div><span>SERIAL STATE MACHINE</span><strong>排队 → 预检 → intent → 提交 → after → reload</strong></div>{running && <b><Circle size={11} weight="fill" />店铺写入动作已锁定</b>}</header>
            <ol>{STEP_DEFINITIONS.map((step, index) => { const state = selected ? stepState(selected, index) : 'pending'; return <li data-state={state} key={step.id}><span>{state === 'done' ? <CheckCircle size={17} weight="fill" /> : state === 'error' ? <Warning size={17} weight="fill" /> : <b>{index + 1}</b>}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div><em>{state === 'done' ? '完成' : state === 'active' ? '进行中' : state === 'error' ? '停止' : '等待'}</em></li>; })}</ol>
          </section>
        </section>
      </div>

      <section className="execution-inspector execution-inspector--tabs" aria-label="动作详情与三段回读">
        <div className="execution-detail-tabs" role="tablist" aria-label="执行详情">
          {DETAIL_TABS.map((tab) => <button aria-selected={detailTab === tab.id} key={tab.id} onClick={() => setDetailTab(tab.id)} role="tab" type="button">{tab.label}</button>)}
        </div>
        <div className="execution-detail-panel" role="tabpanel">
          {detailTab === 'action' && <div className="execution-action-panel">
            <dl className="execution-action-facts">
              <div><dt>目标对象</dt><dd>{selectedJob ? shortId(selectedJob.adEntityId, 34) : 'smart lock exact'}</dd></div>
              <div><dt>所属广告组</dt><dd>{selectedJob ? shortId(selectedJob.identity.adGroupId, 34) : 'US Exact Core'}</dd></div>
              <div><dt>动作类型</dt><dd>关键词出价调整</dd></div>
              <div><dt>当前状态</dt><dd>{selectedJob ? STATUS_LABELS[selectedJob.status] : '等待建队列'}</dd></div>
              <div><dt>当前出价</dt><dd>{selectedJob ? money(selectedJob.expectedBidCents) : 'USD 1.20'}</dd></div>
              <div><dt>建议出价</dt><dd>{selectedJob ? money(selectedJob.targetBidCents) : 'USD 1.08'}</dd></div>
              <div><dt>变更幅度</dt><dd>{selectedJob ? `${selectedJob.changePct.toFixed(1)}%` : '-10.0%'}</dd></div>
              <div><dt>执行模式</dt><dd>{selectedIssuer ?? '人工签发'}</dd></div>
            </dl>
            <div className="execution-action-reason"><section><h3>调整原因</h3><p>近 7 日 CPC 上扬但转化率稳定，温和降价用于修复 ACOS，并避免破坏曝光。</p></section><section><h3>风险校验</h3><p>US / USD、当前 Session、完整 MissionGrant、只降价与 10% 上限必须同时通过。</p></section></div>
            {selectedUnknown ? <section className="execution-unknown" role="alert"><Warning size={22} weight="fill" /><strong>UNKNOWN · 队列已停止</strong><p>外部结果无法确认，禁止自动重试。仅允许人工接管当前可见浏览器并进入 append-only 对账。</p><button className="execution-button execution-button--danger" disabled={Boolean(pending)} onClick={inspectBrowser} type="button"><Hand size={16} />人工接管</button><button className="execution-button execution-button--secondary" onClick={() => setReconciliation(true)} type="button">进入对账</button></section> : <div className="execution-controls" role="group" aria-label="执行控制"><button className="execution-button execution-button--secondary" disabled={!selected || Boolean(pending)} onClick={inspectBrowser} type="button"><Browser size={16} />检查 / 接管浏览器</button><button className="execution-button execution-button--primary" disabled={!canStart || Boolean(pending)} onClick={startBatch} type="button"><Play size={16} />{selectedIssuer === '策略签发' ? '策略队列由 Main 自动推进' : pending === 'start' ? '串行执行中…' : '开始串行执行'}</button><button className="execution-button execution-button--danger" disabled={!canCancel || Boolean(pending)} onClick={cancelBatch} type="button"><StopCircle size={16} />终止队列</button></div>}
          </div>}
          {detailTab === 'compare' && <section className="execution-evidence"><h3>before / after / reload</h3>{(['before', 'after', 'reload'] as const).map((slot) => { const evidence = selected ? evidenceFor(selected, slot) : undefined; return <article data-state={evidence ? 'ready' : 'pending'} key={slot}><span>{evidence ? <CheckCircle size={17} weight="fill" /> : <Circle size={17} />}</span><div><strong>{slot}</strong><small>{evidence ? `${money(evidence.observedBidCents)} · ${formatTime(evidence.capturedAt)}` : slot === 'before' ? 'intent 前捕获' : slot === 'after' ? '提交后捕获' : '刷新后同对象核验'}</small>{evidence && <code>{evidence.contentSha256.slice(0, 12)}…</code>}</div></article>; })}</section>}
          {detailTab === 'readback' && <div className="execution-readback-panel"><ShieldWarning size={24} weight="duotone" /><strong>{selected?.batch.status === 'succeeded' ? '三段回读已验证' : selectedUnknown ? 'UNKNOWN · 等待人工对账' : '等待真实执行后回读'}</strong><p>after 与 reload 必须独立证明同一 canonical 关键词和目标值；任何不确定性都停止队列且不自动重试。</p><button className="execution-button execution-button--secondary" disabled={!selected} onClick={() => setReconciliation(true)} type="button">打开回读对账</button></div>}
          {detailTab === 'evidence' && <div className="execution-archive-panel"><h3>证据与归档</h3><p>批次、Grant 终态、causal event、before / after / reload 截图与内容哈希均为 append-only。</p><dl><div><dt>批次</dt><dd>{selected?.batch.id ?? '待生成'}</dd></div><div><dt>Grant</dt><dd>{(selected?.batch.grantId ?? grantId) || '待选择'}</dd></div><div><dt>事件数</dt><dd>{consoleRows.length}</dd></div><div><dt>归档状态</dt><dd>{selected?.batch.status === 'succeeded' ? '可归档' : '等待终态'}</dd></div></dl></div>}
          {detailTab === 'experiment' && <div className="execution-experiment-panel"><span>关联实验</span><strong>核心词竞价弹性 · 7 日</strong><dl><div><dt>假设</dt><dd>竞价下降不超过 10% 可降低 CPC，同时守住订单量。</dd></div><div><dt>观察窗口</dt><dd>7 个美国业务日</dd></div><div><dt>守护栏</dt><dd>转化率、订单量、目标 ACOS 与数据新鲜度</dd></div></dl><button className="execution-button execution-button--secondary" type="button">实验详情</button></div>}
        </div>
        <p className="execution-safety-note"><Pause size={15} />取消仅在 intent 前开放；intent 后必须完成回读或进入 UNKNOWN 人工对账。</p>
      </section>

      <section className="execution-console" aria-label="append-only 执行事件控制台">
        <header><div><span>EVENT CONSOLE</span><strong>{reconciliation ? 'UNKNOWN 人工对账视图' : 'Authority 事件流'}</strong></div><b>append-only · {consoleRows.length} 条</b></header>
        <div className="execution-console__body" role="log" aria-live="polite">{consoleRows.map((row) => <div data-status={row.status} key={row.id}><time>{formatTime(row.at)}</time><span>{row.message}</span></div>)}{consoleRows.length === 0 && <p>等待 Main Authority 事件。这里不允许编辑或删除审计记录。</p>}</div>
      </section>
    </div>
  );
}
