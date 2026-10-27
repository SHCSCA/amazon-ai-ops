import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  StopCircle,
  Warning,
} from '@phosphor-icons/react';
import {
  AD_EXECUTION_RECONCILIATION_COPY,
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
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { WorkspaceState } from '../../components/workspace';
import { ReadbackGateIndicator } from './execution-workspace-gate-indicator';
import { selectExecutionReadbackGate } from './execution-workspace-gate';
import {
  assertExecutionProjectionBelongsToContext,
  createPreviewExecutionAuthorityApi,
  readExecutionAuthorityWindowApi,
  type ExecutionAuthorityRendererApi,
} from './execution-authority-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';
import './execution-workspace.css';
import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import { useCanonicalWorkspaceOperation } from './use-canonical-workspace-operation';
import { rendererRuntimeLog } from '../../runtime-log';
import { ExecutionReadbackComparison } from './execution-readback-comparison';
import { type ExecutionWorkspaceProps, type LoadPhase, type ExecutionGrantSelection, type BrowserSessionState, type ExecutionBrowserTab, type ExecutionDetailTab, type ExecutionMutationTicket } from './execution-workspace-contracts';
import { executionCapabilityReady, EXECUTION_CAPABILITY_IDS, preferredExecutionJobId, missionForExecutionBatch, TERMINAL, preferredExecutionBatchId, executionUserFacingError, executionProgressBelongsToSelection, executionMutationCanCommit, confirmStop, grantIssuer, money, UNKNOWN_DIAGNOSTIC_DETAIL, BUSINESS_PLAN_STEPS, STATUS_LABELS, formatTime, STEP_DEFINITIONS, DETAIL_TABS, EVIDENCE_SLOT_LABELS } from './execution-workspace-model';
import { readExecutionSelectionAuthorityApi, executionMissionsForContext, selectableExecutionMissions, buildExecutableGrantSelections } from './execution-workspace-selection';
import { hasCanonicalIdentity, stepState, evidenceForExecutionJob } from './execution-workspace-evidence';
import { PreviewBanner } from './execution-workspace-preview';
import { ExecutionBrowserNavigationNotice, ExecutionBrowserSidebar, ExecutionBrowserTabs } from './execution-browser-navigation';

export function ExecutionWorkspace({
  apiOverride,
  blockedReason,
  capabilities = [],
  onInspectBoundary,
  previewEnabled,
  selectionApiOverride,
  storeContext,
}: ExecutionWorkspaceProps) {
  const authority = useCanonicalWorkspaceOperation(storeContext, capabilities, 'execution/queue');
  const viewCapabilityReady = authority.ready && executionCapabilityReady(capabilities, EXECUTION_CAPABILITY_IDS.view, previewEnabled);
  const startCapabilityReady = executionCapabilityReady(capabilities, EXECUTION_CAPABILITY_IDS.start, previewEnabled);
  const takeoverCapabilityReady = executionCapabilityReady(capabilities, EXECUTION_CAPABILITY_IDS.takeover, previewEnabled);
  const cancelCapabilityReady = executionCapabilityReady(capabilities, EXECUTION_CAPABILITY_IDS.cancel, previewEnabled);
  const reconcileCapabilityProjected = executionCapabilityReady(capabilities, EXECUTION_CAPABILITY_IDS.reconcileUnknown, previewEnabled);
  const previewApiRef = useRef<ExecutionAuthorityRendererApi>();
  if (previewEnabled && !previewApiRef.current) previewApiRef.current = createPreviewExecutionAuthorityApi();
  const authorityApi = useMemo(
    () => apiOverride ?? (previewEnabled ? previewApiRef.current ?? null : readExecutionAuthorityWindowApi()),
    [apiOverride, previewEnabled],
  );
  const api = viewCapabilityReady ? authorityApi : null;

  const selectionAuthorityApi = useMemo(
    () => selectionApiOverride ?? (previewEnabled ? null : readExecutionSelectionAuthorityApi()),
    [previewEnabled, selectionApiOverride],
  );
  const selectionApi = viewCapabilityReady ? selectionAuthorityApi : null;
  const authorityKey = authority.key;
  const operation = authority.operation;
  const authorityKeyRef = useRef(authorityKey);
  const requestSequence = useRef(0);
  const missionRequestSequence = useRef(0);
  const grantRequestSequence = useRef(0);
  const mutationSequence = useRef(0);
  const mutationAuthorityKeyRef = useRef(authorityKey);
  const browserReadyGrantIdRef = useRef(previewEnabled ? 'preview-grant-human' : '');
  const [phase, setPhase] = useState<LoadPhase>(() => (!storeContext || !api) ? 'blocked' : 'loading');
  const [batchRows, setBatches] = useState<AdExecutionBatchProjection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
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
  const [actionOrigin, setActionOrigin] = useState('');
  const [error, setError] = useState<string | null>(() => !viewCapabilityReady
    ? `${EXECUTION_CAPABILITY_IDS.view} BLOCKED；Renderer 不会调用 Execution API。`
    : !api && !previewEnabled
      ? 'Execution production window API 未接入；Renderer 不会回退到预览数据。'
      : null);
  const [feedback, setFeedback] = useState('');
  const [progressEvents, setProgressEvents] = useState<AdExecutionProgressEvent[]>([]);
  const [issuerByGrantId, setIssuerByGrantId] = useState<Record<string, 'human' | 'policy'>>({});
  const [authorityOpen, setAuthorityOpen] = useState(false);
  const [browserTab, setBrowserTab] = useState<ExecutionBrowserTab>('ads');
  const browserNavigationReasonId = useId();
  const authorityPanelId = useId();
  const [detailTab, setDetailTab] = useState<ExecutionDetailTab>('action');
  const [queueFilter, setQueueFilter] = useState('all');
  const [keywordSearch, setKeywordSearch] = useState('');

  authorityKeyRef.current = authorityKey;
  if (mutationAuthorityKeyRef.current !== authorityKey) {
    mutationAuthorityKeyRef.current = authorityKey;
    mutationSequence.current += 1;
    requestSequence.current++; missionRequestSequence.current++; grantRequestSequence.current++;
  }
  const [publishedKey, setPublishedKey] = useState('');
  const batches = publishedKey === authority.projectionKey ? batchRows : [];
  const selected = batches.find((projection) => projection.batch.id === selectedId) ?? null;
  const progressSelectionRef = useRef<{
    context: StoreContextEnvelope | null;
    grantId: string;
    selected: AdExecutionBatchProjection | null;
  }>({ context: storeContext, grantId, selected });
  progressSelectionRef.current = { context: storeContext, grantId, selected };
  const effectiveSelectedJobId = preferredExecutionJobId(selected, selectedJobId);
  const selectedJob = selected?.jobs.find((job) => job.id === effectiveSelectedJobId) ?? null;
  const readbackGate = selectExecutionReadbackGate(selected, selectedJob?.id ?? null, grantId ?? null);
  const verifiedReadback = !previewEnabled && readbackGate.eligible;
  const executionReadbackBlockers = previewEnabled ? ['仅开发预览，未取得真实执行核验结论'] : readbackGate.blockers;
  const selectedBatchMission = missionForExecutionBatch(missions, selected);
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
    const isCurrent = operation.capture();
    const sequence = ++requestSequence.current;
    const capturedKey = authorityKey;
    if (!storeContext) {
      setBatches([]);
      setSelectedId('');
      setSelectedJobId('');
      setPhase('blocked');
      setError('尚未选择可执行店铺，实时执行已安全关闭。');
      return;
    }
    if (!api) {
      setBatches([]);
      setSelectedId('');
      setSelectedJobId('');
      setPhase('blocked');
      setError(!viewCapabilityReady
        ? `${EXECUTION_CAPABILITY_IDS.view} BLOCKED；Renderer 不会调用 Execution API。`
        : 'Execution production window API 未接入；Renderer 不会回退到预览数据。');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      const rows = [...await api.listBatches(storeContext)];
      if (!isCurrent() || authorityKeyRef.current !== capturedKey || requestSequence.current !== sequence) return;
      rows.forEach((projection) => assertExecutionProjectionBelongsToContext(storeContext, projection));
      const issuers: Record<string, 'human' | 'policy'> = {};
      if (selectionApi) {
        const missionIds = [...new Set(rows.map((projection) => projection.batch.missionId))];
        const grantsByMission = await Promise.allSettled(
          missionIds.map((missionId) => selectionApi.listGrants(storeContext, missionId)),
        );
        grantsByMission.forEach((result) => {
          if (result.status !== 'fulfilled') { rendererRuntimeLog.warn('execution.grant_source_unavailable', { error: result.reason }); return; }
          result.value.forEach((grant) => { issuers[grant.id] = grant.issuer.type; });
        });
      }
      if (!isCurrent() || authorityKeyRef.current !== capturedKey || requestSequence.current !== sequence) return;
      setIssuerByGrantId(issuers);
      setPublishedKey(authority.projectionKey);
      setBatches(rows);
      setSelectedId((current) => keepSelection && rows.some((row) => row.batch.id === current)
        ? current
        : preferredExecutionBatchId(rows));
      setPhase('ready');
    } catch (loadError) {
      rendererRuntimeLog.error('execution.workspace_failed', { error: loadError });
      if (!isCurrent() || authorityKeyRef.current !== capturedKey || requestSequence.current !== sequence) return;
      setBatches([]);
      setSelectedId('');
      setSelectedJobId('');
      setPhase('error');
      setError(executionUserFacingError(loadError));
    }
  };

  useEffect(() => {
    setMissions([]);
    setSelectedJobId('');
    setSelectedMissionId(previewEnabled ? 'preview-mission:keyword-efficiency' : '');
    setGrantSelections([]);
    setGrantId(previewEnabled ? 'preview-grant-human' : '');
    setAdEntityId(previewEnabled ? 'preview-ad-entity-keyword-1' : '');
    setResolvedEntityIds(new Set());
    setPending(null);
    setFeedback('');
    setSelectionError(null);
    setSelectionPhase(previewEnabled ? 'ready' : 'loading');
    browserReadyGrantIdRef.current = previewEnabled ? 'preview-grant-human' : '';
    setBrowserSession(previewEnabled ? 'ready' : 'unchecked');
    setProgressEvents([]);
    setIssuerByGrantId({});
    setAuthorityOpen(false);
    setBrowserTab('ads');
    setDetailTab('action');
    setQueueFilter('all');
    setKeywordSearch('');
    void load(false);
    if (previewEnabled) return;
    const isCurrent = operation.capture();
    const sequence = ++missionRequestSequence.current;
    const capturedKey = authorityKey;
    if (!storeContext || !selectionApi) {
      setSelectionPhase('blocked');
      setSelectionError(!storeContext
        ? '尚未选择可执行店铺，不能读取运营任务与执行授权。'
        : '运营任务、执行授权或分析结果尚未就绪，不能创建真实队列。');
      return;
    }
    void selectionApi.listMissions(storeContext).then((records) => {
      if (!isCurrent() || authorityKeyRef.current !== capturedKey || missionRequestSequence.current !== sequence) return;
      const scoped = executionMissionsForContext(storeContext, records);
      const eligible = selectableExecutionMissions(storeContext, scoped);
      setMissions(scoped);
      setSelectedMissionId(eligible[0]?.id ?? '');
      setSelectionPhase('ready');
      if (!eligible.length) setSelectionError('当前店铺没有可执行的美国站运营任务，不能创建执行队列。');
    }).catch((selectionLoadError) => {
      rendererRuntimeLog.error('execution.mission_selection_failed', { error: selectionLoadError });
      if (!isCurrent() || authorityKeyRef.current !== capturedKey || missionRequestSequence.current !== sequence) return;
      setMissions([]);
      setSelectedMissionId('');
      setSelectionPhase('error');
      setSelectionError(executionUserFacingError(selectionLoadError));
    });
    // A changed authority key invalidates all Renderer-local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authorityKey, previewEnabled, selectionApi]);

  useEffect(() => {
    if (previewEnabled || !storeContext || !selectionApi || !selectedMission
      || String(selectedMission.storeId) !== String(storeContext.storeId)) return;
    const isCurrent = operation.capture();
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
      if (!isCurrent() || authorityKeyRef.current !== capturedKey || grantRequestSequence.current !== sequence) return;
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
        setSelectionError('该运营任务没有同时满足当前会话、有效期、已批准调整、≤10% 降价与证据要求的执行授权。');
      }
    }).catch((selectionLoadError) => {
      rendererRuntimeLog.error('execution.grant_selection_failed', { error: selectionLoadError });
      if (!isCurrent() || authorityKeyRef.current !== capturedKey || grantRequestSequence.current !== sequence) return;
      setGrantSelections([]);
      setGrantId('');
      setAdEntityId('');
      setSelectionPhase('error');
      setSelectionError(executionUserFacingError(selectionLoadError));
    });
  }, [authorityKey, previewEnabled, selectedMission, selectionApi, storeContext]);

  useEffect(() => {
    setProgressEvents([]);
    const expectedGrantId = selected?.batch.grantId ?? grantId.trim();
    if (previewEnabled) {
      browserReadyGrantIdRef.current = expectedGrantId || 'preview-grant-human';
      setBrowserSession('ready');
      return;
    }
    if (!expectedGrantId || browserReadyGrantIdRef.current !== expectedGrantId) {
      setBrowserSession('unchecked');
    }
  }, [grantId, previewEnabled, selected?.batch.grantId, selected?.batch.id]);

  useEffect(() => {
    if (!api || !storeContext) return undefined;
    const isCurrent = operation.capture();
    return api.onProgress((event) => {
      if (!isCurrent()) return;
      const currentSelection = progressSelectionRef.current;
      if (!executionProgressBelongsToSelection(
        event,
        currentSelection.context,
        currentSelection.selected,
        currentSelection.grantId,
      )) return;
      setProgressEvents((events) => [event, ...events].slice(0, 80));
      if (event.phase === 'identity' && event.status === 'ready') {
        browserReadyGrantIdRef.current = event.batchId;
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

  const mutate = async (
    name: string,
    action: (commitMutation: (commit: () => void) => boolean) => Promise<void>,
    origin = name,
  ) => {
    if (pending) return;
    const operationTicket = operation.begin();
    if (!operationTicket) return;
    const ticket: ExecutionMutationTicket = {
      authorityKey,
      sequence: ++mutationSequence.current,
    };
    const commitMutation = (commit: () => void) => {
      if (!operationTicket.isCurrent() || !executionMutationCanCommit(ticket, authorityKeyRef.current, mutationSequence.current)) return false;
      commit();
      return true;
    };
    setPending(name);
    setActionOrigin(origin);
    setError(null);
    setFeedback('');
    try {
      await action(commitMutation);
    } catch (mutationError) {
      rendererRuntimeLog.error('execution.workspace_failed', { error: mutationError });
      commitMutation(() => setError(executionUserFacingError(mutationError)));
    } finally {
      commitMutation(() => setPending(null));
      operationTicket.finish();
    }
  };

  const refresh = async () => {
    const ticket = operation.begin();
    if (!ticket) return;
    setPending('refresh');
    try { await load(true); }
    finally { if (ticket.isCurrent()) setPending(null); ticket.finish(); }
  };

  const resolveIdentity = () => mutate('identity', async (commitMutation) => {
    if (!startCapabilityReady) throw new Error('当前店铺未获准执行，广告对象身份核验已阻断。');
    if (!api || !storeContext || !grantId.trim() || !adEntityId.trim()) {
      throw new Error('请选择当前运营任务的有效执行授权与已批准广告对象。');
    }
    if (!previewEnabled) {
      const currentGrant = grantSelections.find((selection) => selection.grant.id === grantId);
      if (!currentGrant?.entities.some((proposal) => proposal.adEntityId === adEntityId)) {
        throw new Error('当前广告对象不属于所选执行授权的已批准完整批次。');
      }
    }
    const requestedGrantId = grantId.trim();
    browserReadyGrantIdRef.current = '';
    setBrowserSession('resolving');
    await api.resolveIdentity({ context: storeContext, grantId: requestedGrantId, adEntityId: adEntityId.trim() });
    commitMutation(() => {
      const nextResolved = new Set(resolvedEntityIds).add(adEntityId.trim());
      setResolvedEntityIds(nextResolved);
      const nextEntity = selectableEntities.find((proposal) => proposal.adEntityId && !nextResolved.has(proposal.adEntityId));
      if (nextEntity?.adEntityId) setAdEntityId(nextEntity.adEntityId);
      browserReadyGrantIdRef.current = requestedGrantId;
      setBrowserSession('ready');
      setFeedback('当前对象的可见广告页面身份已核验；如授权包含多个动作，请逐一核验后再建队列。');
    });
  });

  const createBatch = () => mutate('create', async (commitMutation) => {
    if (!startCapabilityReady) throw new Error('当前店铺未获准执行，不会创建执行批次。');
    if (!api || !storeContext || !grantId.trim()) throw new Error('请选择已有执行授权。');
    if (!allSelectedEntitiesResolved) throw new Error('请先核验该授权完整批次中每个对象的当前广告页面身份。');
    const result = await api.createBatch({ context: storeContext, grantId: grantId.trim() });
    if (!commitMutation(() => replaceProjection(result.projection))) return;
    if (previewEnabled && grantId.includes('policy')) {
      const observed = await api.startBatch({ context: storeContext, batchId: result.projection.batch.id });
      commitMutation(() => {
        replaceProjection(observed);
        setFeedback('仅开发预览：策略签发批次已在本机演示环境自动推进；仍可随时人工接管。');
      });
      return;
    }
    commitMutation(() => setFeedback(
      result.created ? '已从有效执行授权创建完整串行批次。' : '已返回该执行授权的现有批次。',
    ));
  });

  const inspectBrowser = (origin: string) => mutate('takeover', async (commitMutation) => {
    if (!takeoverCapabilityReady) throw new Error('当前店铺未获准接管浏览器。');
    if (!api || !storeContext || !selected) throw new Error('请先选择一个执行批次。');
    await api.takeOverVisibleBrowser({ context: storeContext, batchId: selected.batch.id });
    commitMutation(() => {
      browserReadyGrantIdRef.current = selected.batch.grantId;
      setBrowserSession('ready');
      setFeedback(previewEnabled ? '仅开发预览：已切换本机浏览器演示。' : '当前店铺的可见广告页面已置前并完成会话检查。');
    });
  }, origin);

  const startBatch = () => mutate('start', async (commitMutation) => {
    if (!startCapabilityReady) throw new Error('当前店铺未获准执行，不会启动执行批次。');
    if (!api || !storeContext || !selected) throw new Error('请先选择一个执行批次。');
    if (!hasCanonicalIdentity(selected)
      || browserSession !== 'ready'
      || browserReadyGrantIdRef.current !== selected.batch.grantId) {
      throw new Error('稳定关键词身份与当前可见浏览器会话必须同时就绪。');
    }
    const projection = await api.startBatch({ context: storeContext, batchId: selected.batch.id });
    commitMutation(() => {
      replaceProjection(projection);
      setFeedback(projection.batch.status === 'unknown'
        ? '结果不确定：串行队列已停止，不会自动重试。'
        : '串行执行已更新为最新状态。');
    });
  });

  const cancelBatch = (origin: string) => mutate('cancel', async (commitMutation) => {
    if (!cancelCapabilityReady) throw new Error('当前店铺未获准取消执行批次。');
    if (!api || !storeContext || !selected) throw new Error('请先选择一个执行批次。');
    if (!confirmStop()) return;
    const projection = await api.cancelBatch({
      context: storeContext,
      batchId: selected.batch.id,
      reason: 'operator_confirmed_stop_before_intent',
    });
    commitMutation(() => {
      replaceProjection(projection);
      setFeedback('未提交批次已在执行意图写入前整体取消；审计记录继续保留。');
    });
  }, origin);

  const reconcileUnknown = (origin: string) => mutate('reconcile-unknown', async (commitMutation) => {
    if (!reconcileCapabilityProjected) throw new Error('当前店铺未获准进行结果不确定对账。');
    if (!api || !storeContext || !selected || !selectedUnknown) {
      throw new Error('请先选择一个结果不确定的执行批次。');
    }
    const result = await api.reconcileUnknownBatch({ context: storeContext, batchId: selected.batch.id });
    if (!commitMutation(() => setFeedback(result.detail))) return;
    await load(true);
  }, origin);

  const selectedUnknown = selected?.batch.status === 'unknown'
    || selected?.jobs.some((job) => job.status === 'unknown');
  const selectedIssuer = selected ? grantIssuer(selected, issuerByGrantId[selected.batch.grantId]) : null;
  const canReconcileUnknown = reconcileCapabilityProjected && Boolean(api) && !selected?.reconciliation;
  const reconciliationCopy = selected?.reconciliation
    ? selected.reconciliation.outcome ? AD_EXECUTION_RECONCILIATION_COPY[selected.reconciliation.outcome] : '只读对账正在进行；两个观察位置已保留，请等待原请求完成。'
    : '外部结果无法确认，队列已停止。可人工接管当前浏览器，或进行一次只读双次对账。';
  const canTakeover = takeoverCapabilityReady && Boolean(selected);
  const canCancel = cancelCapabilityReady && Boolean(selected)
    && selected!.jobs.every((job) => ['queued', 'preflight'].includes(job.status));
  const canStart = startCapabilityReady && Boolean(selected)
    && !running
    && selectedIssuer !== '策略签发'
    && !selectedUnknown
    && hasCanonicalIdentity(selected!)
    && browserSession === 'ready'
    && browserReadyGrantIdRef.current === selected!.batch.grantId
    && selected!.jobs.some((job) => ['queued', 'preflight'].includes(job.status));

  if (!viewCapabilityReady || (phase === 'blocked' && !previewEnabled)) {
    return (
      <div className="execution-workspace" data-canonical-surface="execution" data-capability-state="BLOCKED">
        <h1 className="execution-page-title">实时执行</h1>
        <WorkspaceState
          description="当前无法建立真实广告执行通道；系统不会回退到预览数据，也不会把本地假状态当成执行成功。"
          details="请先完成当前店铺连接、审批授权和可见浏览器检查，再返回此页重试。"
          kind="blocked"
          title="实时执行尚未就绪"
        />
        <details>
          <summary>诊断详情</summary>
          <code>实时执行 Authority 未就绪</code>
          <code>Renderer 不会调用 Execution API</code>
          <code>execution/live.view BLOCKED</code>
          <code>execution.queue.start 已阻断</code>
        </details>
      </div>
    );
  }

  const durableEvents = selected?.jobs.flatMap((job) => job.events.map((event) => ({
    id: event.id,
    at: event.createdAt,
    message: `${event.eventType} · ${event.detail ?? event.toStatus}`,
    status: event.toStatus,
  }))) ?? [];
  const scopedProgressEvents = progressEvents.filter((event) => executionProgressBelongsToSelection(
    event,
    storeContext,
    selected,
    grantId,
  ));
  const consoleRows = [
    ...scopedProgressEvents.map((event, index) => ({
      id: `progress:${event.occurredAt}:${index}`,
      at: event.occurredAt,
      message: `${event.phase} · ${event.message}`,
      status: event.status,
    })),
    ...durableEvents,
  ].slice(0, 80);
  const missionTitle = selected
    ? selectedBatchMission?.title ?? '当前批次的运营任务记录不可用'
    : selectedMission?.title ?? (previewEnabled ? 'Prime Day 后 7 日利润守护' : '等待选择可执行运营任务');
  const missionSubtitle = selectedJob
    ? `关键词出价调整 · 当前查看第 ${selectedJob.ordinal} 个广告对象`
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
  const connectionPrerequisiteBlocked = Boolean(error && (
    error.includes('“系统设置”重新连接当前店铺')
    || error.includes('店铺连接未完成')
    || error.includes('浏览器会话未就绪')
  ));

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
      data-mutations-disabled={previewEnabled || undefined}
    >
      <h1 className="execution-page-title">实时执行</h1>
      <header className="execution-mission-header">
        <div>
          <span>{previewEnabled ? '开发预览 · 等待执行' : selected ? '真实执行 · 已选择串行批次' : '真实执行 · 等待选择'}</span>
          <h2>{missionTitle}</h2>
          <p>{missionSubtitle}</p>
        </div>
        <div className="execution-mission-actions" role="group" aria-label="运营任务执行控制">
          <button aria-expanded={authorityOpen} aria-controls={authorityPanelId} className="execution-button execution-button--secondary" onClick={() => setAuthorityOpen((value) => !value)} type="button"><IdentificationCard size={16} />执行来源</button>
          <WorkspaceActionButton className="execution-button execution-button--secondary" disabled={!canTakeover || Boolean(pending)} onClick={() => void inspectBrowser('header')} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : !selected ? '请先选择当前店铺的执行批次。' : '当前店铺未开放浏览器接管，请核对连接及权限后重试。'} busy={pending === 'takeover' && actionOrigin === 'header'} busyLabel="接管中…"><Hand size={16} />{pending === 'takeover' && actionOrigin === 'header' ? '置前中…' : '接管浏览器'}</WorkspaceActionButton>
          <WorkspaceActionButton className="execution-button execution-button--secondary" disabled={!canCancel || Boolean(pending)} onClick={() => void cancelBatch('header')} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : !selected ? '请先选择执行批次。' : '只有尚未写入执行意图的完整批次可以取消；已提交或不确定结果请走只读核对。'} busy={pending === 'cancel' && actionOrigin === 'header'} busyLabel="取消中…"><StopCircle size={16} />取消未提交批次</WorkspaceActionButton>
          <button aria-label="更多执行选项" className="execution-icon-button" onClick={() => setAuthorityOpen(true)} type="button"><DotsThree size={20} weight="bold" /></button>
        </div>
      </header>

      <section className="execution-contract-strip" aria-label="执行合同">
        <div><span>运营任务</span><strong>{selected ? selectedBatchMission?.title ?? '当前批次的运营任务记录不可用' : selectedMission?.title ?? '等待选择'}</strong></div>
        <div><span>执行模式</span><strong>{selectedIssuer ?? (grantId.includes('policy') ? '策略签发' : grantId ? '人工签发' : '等待授权')}</strong></div>
        <div><span>变更范围</span><strong>{selectedJob ? `${selectedJob.changePct.toFixed(1)}% · ${money(selectedJob.expectedBidCents)} → ${money(selectedJob.targetBidCents)}` : '等待选择真实执行对象'}</strong></div>
        <div><span>安全状态</span><strong data-tone={grantId ? 'safe' : 'waiting'}><ShieldWarning size={14} weight="fill" />{grantId ? '策略边界 已通过' : '等待执行授权'}</strong></div>
      </section>

      {previewEnabled && <PreviewBanner onInspectBoundary={onInspectBoundary} />}

      <div className="execution-boundary-alert" role="status">
        <Warning size={17} weight="fill" />
        <strong>{previewEnabled ? '仅开发预览不会提交广告调整，也不会展示伪造业务结果' : selectedUnknown ? '当前批次结果不确定，已停止且禁止自动重试' : '越界对象不会进入当前串行批次'}</strong>
        <button data-action-priority="primary" onClick={() => setAuthorityOpen(true)} type="button">查看执行来源与边界</button>
      </div>

      <section className="execution-authority-bar" id={authorityPanelId} aria-label="执行来源与队列创建" hidden={!authorityOpen}><p id="execution-selection-guidance">{pending ? '当前执行操作进行中，选择器暂时锁定，请等待完成。' : running ? '串行队列运行中，不能切换其运营任务、授权或对象。' : selectionPhase === 'loading' ? '正在读取当前任务及授权，请稍候。' : '依次选择当前运营任务、有效执行授权和其中的广告对象；已核验对象无需重复核验。'}</p>
        <div className="execution-authority-copy">
          <span>执行授权 → 串行执行</span>
          <strong>从已有授权创建真实串行队列</strong>
          <small>界面只提交当前店铺范围与已有授权；目标值、广告对象身份、页面定位和证据路径始终由本机安全进程重新核验。</small>
        </div>
        <div className="execution-authority-form">
          <label>
            <span>当前运营任务</span>
            {previewEnabled ? (
              <select aria-describedby="execution-selection-guidance" aria-label="开发预览运营任务" disabled value={selectedMissionId}>
                <option value="preview-mission:keyword-efficiency">仅开发预览任务 · 无真实任务数据</option>
              </select>
            ) : (
              <select aria-describedby="execution-selection-guidance" aria-label="当前运营任务" disabled={running || Boolean(pending) || selectionPhase === 'loading'} onChange={(event) => {
                setSelectedMissionId(event.target.value);
                setGrantSelections([]);
                setGrantId('');
                setAdEntityId('');
                setResolvedEntityIds(new Set());
              }} value={selectedMissionId}>
                <option value="">{selectionPhase === 'loading' ? '正在读取运营任务…' : '请选择可执行的运营任务'}</option>
                {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title} · {mission.productId ? '指定产品' : '全店'}</option>)}
              </select>
            )}
          </label>
          <label>
            <span>有效执行授权</span>
            {previewEnabled ? (
              <select aria-describedby="execution-selection-guidance" aria-label="有效执行授权" disabled={running || Boolean(pending)} onChange={(event) => {
                setGrantId(event.target.value);
                setResolvedEntityIds(new Set());
              }} value={grantId}>
                <option value="preview-grant-human">人工签发 · 正常回读 · 1 个动作</option>
                <option value="preview-grant-policy">策略签发 · 自动推进 · 1 个动作</option>
                <option value="preview-grant-unknown-human">人工签发 · 结果不确定演示 · 1 个动作</option>
              </select>
            ) : (
              <select aria-describedby="execution-selection-guidance" aria-label="有效执行授权" disabled={running || Boolean(pending) || !selectedMissionId || selectionPhase === 'loading'} onChange={(event) => {
                const nextGrantId = event.target.value;
                const next = grantSelections.find((selection) => selection.grant.id === nextGrantId);
                setGrantId(nextGrantId);
                setAdEntityId(next?.entities[0]?.adEntityId ?? '');
                setResolvedEntityIds(new Set());
              }} value={grantId}>
                <option value="">{selectionPhase === 'loading' ? '正在核验执行授权…' : '请选择尚可执行的授权'}</option>
                {grantSelections.map(({ grant, entities }) => <option key={grant.id} value={grant.id}>{grant.issuer.type === 'policy' ? '策略签发' : '人工签发'} · {entities.length} 个降价动作 · 到期 {grant.expiresAt.slice(5, 16).replace('T', ' ')}</option>)}
              </select>
            )}
          </label>
          <label>
            <span>已决定广告对象</span>
            {previewEnabled ? (
              <select aria-describedby="execution-selection-guidance" aria-label="已决定广告对象" disabled={running || Boolean(pending)} value={adEntityId} onChange={(event) => {
                setAdEntityId(event.target.value);
                setResolvedEntityIds(new Set());
              }}>
                <option value="preview-ad-entity-keyword-1">仅开发预览对象 · 无真实广告数据</option>
              </select>
            ) : (
              <select aria-describedby="execution-selection-guidance" aria-label="已决定广告对象" disabled={running || Boolean(pending) || !selectedGrantSelection} onChange={(event) => setAdEntityId(event.target.value)} value={adEntityId}>
                <option value="">请选择授权内的广告对象</option>
                {selectableEntities.map((proposal) => <option key={proposal.id} value={proposal.adEntityId}>{proposal.entityName} · {proposal.campaignName} / {proposal.adGroupName} · {money(proposal.currentBidCents)} → {money(proposal.proposedBidCents)} ({proposal.changePct.toFixed(1)}%)</option>)}
              </select>
            )}
          </label>
          <WorkspaceActionButton className="execution-button execution-button--secondary" disabled={!startCapabilityReady || running || Boolean(pending) || !grantId || !adEntityId || resolvedEntityIds.has(adEntityId)} onClick={resolveIdentity} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : running ? '当前串行队列仍在执行，请等待其终结。' : resolvedEntityIds.has(adEntityId) ? '当前对象身份已核验，无需重复核验。' : '请先选择有效执行授权及其中的广告对象，并确认当前店铺执行权限。'} busy={pending === 'identity'} busyLabel="核验中…"><IdentificationCard size={16} />{pending === 'identity' ? '核验中…' : resolvedEntityIds.has(adEntityId) ? '当前对象身份已核验' : '核验当前广告对象'}</WorkspaceActionButton>
          <WorkspaceActionButton className="execution-button execution-button--primary" disabled={!startCapabilityReady || running || Boolean(pending) || !allSelectedEntitiesResolved} onClick={createBatch} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : running ? '当前串行队列仍在执行，请等待其终结。' : '请先逐一核验完整授权中每个广告对象的当前身份，核验齐全后再创建队列。'} busy={pending === 'create'} busyLabel="建队列中…">{pending === 'create' ? '建队列中…' : '从完整授权建队列'}</WorkspaceActionButton>
          <details>
            <summary>诊断详情</summary>
            <div className="execution-selection-ids" aria-label="Authority 只读标识">
              <span>Mission <code>{(selected?.batch.missionId ?? selectedMissionId) || '—'}</code></span>
              <span>Grant <code>{grantId || '—'}</code></span>
              <span>Entity <code>{adEntityId || '—'}</code></span>
              <b>{previewEnabled ? '仅开发预览 mock' : `${resolvedEntityIds.size}/${selectableEntities.length} 个对象身份已解析`}</b>
              {previewEnabled && <><code>before / after / reload</code><code>{UNKNOWN_DIAGNOSTIC_DETAIL}</code></>}
            </div>
          </details>
          {!previewEnabled && selectionError && <p className="execution-selection-state" data-tone="blocked">{selectionError}</p>}
        </div>
      </section>

      {(error || feedback) && (
        <div
          aria-live="polite"
          className="execution-feedback"
          data-tone={connectionPrerequisiteBlocked ? 'warning' : error ? 'danger' : 'success'}
          role="status"
        >
          <span>{error ?? feedback}</span>
          {connectionPrerequisiteBlocked && (
            <button
              className="execution-button execution-button--secondary"
              onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'settings' }))}
              type="button"
            >
              去连接店铺
            </button>
          )}
        </div>
      )}

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
              return <li data-state={state} data-verified={verifiedReadback ? "true" : undefined} key={step.id}>
                <span>{state === 'done' ? <CheckCircle size={17} weight="fill" /> : state === 'error' ? <Warning size={17} weight="fill" /> : state === 'active' ? <Hourglass size={17} /> : <Circle size={17} />}</span>
                <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                <em>{state === 'done' ? '完成' : state === 'active' ? '进行中' : state === 'error' ? '停止' : '等待'}</em>
              </li>;
            })}
          </ol>
          <section className="execution-current-object">
            <span>当前对象 {selectedJob ? `${selectedJob.ordinal} / ${selected?.jobs.length}` : '—'}</span>
            <strong>{selectedJob ? `已授权广告对象 ${selectedJob.ordinal}` : '等待创建真实执行队列'}</strong>
            <small>{selectedJob ? `${money(selectedJob.expectedBidCents)} → ${money(selectedJob.targetBidCents)}` : '从已有执行授权开始，无需手填内部标识'}</small>
          </section>
          <section className="execution-queue" aria-label="真实执行队列">
            <header><div><span>真实执行队列</span><strong>串行批次</strong></div><b>{batches.length}</b></header>
            <div className="execution-queue__list" role="listbox" aria-label="选择执行批次">
              {batches.map((projection, index) => (
                <button aria-selected={projection.batch.id === selectedId} data-status={projection.batch.status} key={projection.batch.id} onClick={() => {
                  setSelectedId(projection.batch.id);
                  setSelectedJobId(preferredExecutionJobId(projection));
                }} role="option" type="button">
                  <span><b>{missionForExecutionBatch(missions, projection)?.title ?? `运营任务记录不可用 · 批次 ${index + 1}`}</b><em>{STATUS_LABELS[projection.batch.status]}</em></span>
                  <small>{projection.jobs.length} 个动作 · {grantIssuer(projection, issuerByGrantId[projection.batch.grantId])}</small>
                </button>
              ))}
              {phase === 'loading' && <p>正在读取当前店铺执行队列…</p>}
              {phase !== 'loading' && batches.length === 0 && <p>暂无批次。先核验当前广告对象，再从已有执行授权建队列。</p>}
            </div>
          </section>
        </aside>

        <section className="execution-live-stage">
          <section className="execution-visible-browser" aria-label="当前店铺可见浏览器">
            <header>
              <div><Browser size={18} weight="duotone" /><span><strong>{previewEnabled ? '领星可见广告页面预览 · 关键词' : '领星可见广告页面 · 关键词'}</strong><small>{previewEnabled ? '仅开发预览，不连接领星、不提交广告调整' : storeContext ? '当前店铺会话' : '尚未建立店铺会话'}</small></span></div>
              <div className="execution-browser-header-actions"><b data-session={browserSession}>{browserSession === 'ready' ? '会话可用' : browserSession === 'resolving' ? '身份解析中' : browserSession === 'blocked' ? '会话阻断' : '待检查'}</b><WorkspaceActionButton aria-label="刷新当前执行投影" disabled={!storeContext || !api || operation.busy} disabledReason={operation.busy ? '当前执行操作进行中，请等待完成后刷新。' : '请先选择店铺并确认执行服务连接后刷新。'} busy={pending === 'refresh' && operation.busy} busyLabel="刷新中…" onClick={() => void refresh()} type="button"><ArrowClockwise size={15} /></WorkspaceActionButton></div>
            </header>
            <ExecutionBrowserTabs browserTab={browserTab} onTabChange={setBrowserTab} previewEnabled={previewEnabled} reasonId={browserNavigationReasonId} />
            <ExecutionBrowserNavigationNotice previewEnabled={previewEnabled} reasonId={browserNavigationReasonId} />
            <div className="execution-browser-chrome"><i /><i /><i /><span><ShieldWarning size={13} />{previewEnabled ? '本地预览画面 · 不会访问真实页面' : '本机安全进程管理的当前店铺可见广告页面 · 页面地址和路径不会显示在普通界面'}</span>{previewEnabled && <details><summary>诊断详情</summary><code>preview://visible-ads-session</code></details>}</div>

            {browserTab === 'ads' ? <div className="execution-browser-workbench" role="tabpanel" aria-label="广告管理">
              <ExecutionBrowserSidebar reasonId={browserNavigationReasonId} />
              <div className="execution-browser-table-stage">
                <header><div><strong>关键词</strong><span>当前表格只展示真实执行服务核验后的受控动作。</span></div></header>
                <div className="execution-browser-filters">
                  <label><span>队列筛选</span><select aria-describedby="execution-selection-guidance" aria-label="队列筛选" onChange={(event) => setQueueFilter(event.target.value)} value={queueFilter}><option value="all">全部调整对象</option><option value="policy">策略内动作</option><option value="approval">需人工审批</option></select></label>
                  <label><span>搜索调整对象</span><input aria-label="搜索调整对象" onChange={(event) => setKeywordSearch(event.target.value)} placeholder="搜索关键词或广告对象" value={keywordSearch} /></label>
                  <button className="execution-button execution-button--secondary" onClick={() => setFeedback(`已按当前条件筛选 ${visibleSelectedJobs.length || visibleSelectableEntities.length} 个对象。`)} type="button"><Funnel size={15} />应用筛选</button>
                  <span>{selected ? `更新时间 ${formatTime(selected.batch.updatedAt)}` : '暂无批次更新时间'}</span>
                </div>
                <div className="execution-object-grid">
                  <table aria-label="选中批次广告动作" className="execution-keyword-table">
                    <thead><tr><th>当前对象</th><th>对象 / 搜索词</th><th>动作维度</th><th>状态</th><th>花费 (USD)</th><th>销售额 (USD)</th><th>ACOS</th><th>当前出价 (USD)</th><th>建议出价 (USD)</th><th>变更幅度</th><th>操作</th></tr></thead>
                    <tbody>
                      {visibleSelectedJobs.map((job) => <tr data-status={job.status} key={job.id}><td><input aria-label={`查看第 ${job.ordinal} 个执行对象`} checked={job.id === selectedJob?.id} name="selected-execution-job" onChange={() => setSelectedJobId(job.id)} type="radio" value={job.id} /></td><td><strong>已授权广告对象 {job.ordinal}</strong><small>{selectedBatchMission?.title ?? '当前批次的运营任务记录不可用'}</small><details><summary>诊断详情</summary><code>{job.adEntityId}</code><code>{job.identity.campaignId}</code></details></td><td>关键词竞价</td><td>{STATUS_LABELS[job.status]}</td><td>—</td><td>—</td><td>—</td><td><input aria-label="当前出价" readOnly value={(job.expectedBidCents / 100).toFixed(2)} /></td><td><input aria-label="建议出价" readOnly value={(job.targetBidCents / 100).toFixed(2)} /></td><td>{job.changePct.toFixed(1)}%</td><td><WorkspaceActionButton disabled type="button" disabledReason={'真实页面在已打开的广告浏览器中操作；请在该浏览器切换页面。'}>{STATUS_LABELS[job.status]}</WorkspaceActionButton></td></tr>)}
                      {!selected && visibleSelectableEntities.map((proposal) => <tr key={proposal.id}><td><input aria-label={`选择 ${proposal.entityName}`} checked={proposal.id === selectedProposalId} readOnly type="radio" /></td><td><strong>{proposal.entityName}</strong><small>{proposal.campaignName}</small></td><td>关键词竞价</td><td>已授权</td><td>—</td><td>—</td><td>—</td><td><input aria-label="当前出价" readOnly value={(proposal.currentBidCents / 100).toFixed(2)} /></td><td><input aria-label="建议出价" readOnly value={(proposal.proposedBidCents / 100).toFixed(2)} /></td><td>{proposal.changePct.toFixed(1)}%</td><td><button onClick={() => setAdEntityId(proposal.adEntityId ?? '')} type="button">选择对象</button></td></tr>)}
                      {!selected && visibleSelectableEntities.length === 0 && <tr><td colSpan={11}>当前没有可展示的真实执行对象。请先选择运营任务和有效执行授权。</td></tr>}
                    </tbody>
                  </table>
                </div>
                <footer>共 {visibleSelectedJobs.length || visibleSelectableEntities.length} 条 <WorkspaceActionButton disabled type="button" disabledReason={'真实页面在已打开的广告浏览器中操作；请在该浏览器切换页面。'}>上一页</WorkspaceActionButton><WorkspaceActionButton aria-current="page" disabled type="button" disabledReason={'真实页面在已打开的广告浏览器中操作；请在该浏览器切换页面。'}>1</WorkspaceActionButton><WorkspaceActionButton disabled type="button" disabledReason={'真实页面在已打开的广告浏览器中操作；请在该浏览器切换页面。'}>下一页</WorkspaceActionButton></footer>
              </div>
            </div> : <div className="execution-browser-empty" role="tabpanel"><Browser size={30} weight="duotone" /><strong>{browserTab === 'home' ? '领星首页' : '搜索词报告'}</strong><p>{previewEnabled ? '仅开发预览：此标签用于验证页面切换，不读取领星数据。' : '当前标签由本机安全进程管理的可见浏览器提供。'}</p></div>}
          </section>

          <section className="execution-serial-steps" aria-label="串行执行步骤">
            <header><div><span>串行执行状态</span><strong>排队 → 预检 → 写入意图 → 提交 → 保存后核验 → 刷新回读</strong></div>{running && <b><Circle size={11} weight="fill" />店铺写入动作已锁定</b>}<details><summary>诊断详情</summary><code>SERIAL STATE MACHINE</code><code>queue → preflight → intent → submit → after → reload</code></details></header>
            <ol>{STEP_DEFINITIONS.map((step, index) => { const state = selectedJob ? stepState(selected!, index, selectedJob.id) : 'pending'; return <li data-state={state} data-verified={verifiedReadback ? "true" : undefined} key={step.id}><span>{state === 'done' ? <CheckCircle size={17} weight="fill" /> : state === 'error' ? <Warning size={17} weight="fill" /> : <b>{index + 1}</b>}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div><em>{state === 'done' ? '完成' : state === 'active' ? '进行中' : state === 'error' ? '停止' : '等待'}</em></li>; })}</ol>
          </section>
        </section>
      </div>

      <section className="execution-inspector execution-inspector--tabs" aria-label="动作详情与三段回读">
        {selected && selectedJob && (
          <ReadbackGateIndicator
            blockers={executionReadbackBlockers}
          />
        )}
        <div className="execution-detail-tabs" role="tablist" aria-label="执行详情">
          {DETAIL_TABS.map((tab) => <button aria-selected={detailTab === tab.id} key={tab.id} onClick={() => setDetailTab(tab.id)} role="tab" type="button">{tab.label}</button>)}
        </div>
        <div className="execution-detail-panel" role="tabpanel">
          {detailTab === 'action' && <div className="execution-action-panel">
            <dl className="execution-action-facts">
              <div><dt>目标对象</dt><dd>{selectedJob ? `已授权广告对象 ${selectedJob.ordinal}` : '尚未选择真实执行对象'}</dd></div>
              <div><dt>所属运营任务</dt><dd>{selectedBatchMission?.title ?? '当前批次的运营任务记录不可用'}</dd></div>
              <div><dt>动作类型</dt><dd>关键词出价调整</dd></div>
              <div><dt>当前状态</dt><dd>{selectedJob ? STATUS_LABELS[selectedJob.status] : '等待建队列'}</dd></div>
              <div><dt>当前出价</dt><dd>{selectedJob ? money(selectedJob.expectedBidCents) : '—'}</dd></div>
              <div><dt>建议出价</dt><dd>{selectedJob ? money(selectedJob.targetBidCents) : '—'}</dd></div>
              <div><dt>变更幅度</dt><dd>{selectedJob ? `${selectedJob.changePct.toFixed(1)}%` : '—'}</dd></div>
              <div><dt>执行模式</dt><dd>{selectedIssuer ?? '等待执行授权'}</dd></div>
            </dl>
            <div className="execution-action-reason"><section><h3>调整原因</h3><p>{selectedBatchMission?.objective || '当前批次未提供可核验的运营任务目标。'}</p></section><section><h3>停止与守护条件</h3><p>{selectedBatchMission?.guardrails.length ? selectedBatchMission.guardrails.join('；') : '当前批次未提供可核验的任务守护条件。'}</p></section></div>
            {selectedUnknown ? <section className="execution-unknown" role="alert"><Warning size={22} weight="fill" /><strong>结果不确定 · 队列已停止</strong><p>{reconciliationCopy}</p><WorkspaceActionButton className="execution-button execution-button--danger" disabled={!canTakeover || Boolean(pending)} onClick={() => void inspectBrowser('unknown')} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : !selected ? '请先选择当前店铺的执行批次。' : '当前店铺未开放浏览器接管，请核对连接及权限后重试。'} busy={pending === 'takeover' && actionOrigin === 'unknown'} busyLabel="接管中…"><Hand size={16} />人工接管</WorkspaceActionButton><WorkspaceActionButton className="execution-button execution-button--secondary" disabled={!canReconcileUnknown || Boolean(pending)} onClick={() => void reconcileUnknown('unknown')} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : !selectedUnknown ? '只读双次对账仅用于结果不确定的批次。' : selected?.reconciliation ? '该批次的只读对账已记录，请查看现有结果，不能重复发起。' : '当前店铺未开放只读对账，请核对权限后重试。'} busy={pending === 'reconcile-unknown' && actionOrigin === 'unknown'} busyLabel="只读对账中…">执行只读双次对账</WorkspaceActionButton><details><summary>诊断详情</summary><code>{UNKNOWN_DIAGNOSTIC_DETAIL}</code></details></section> : <div className="execution-controls" role="group" aria-label="执行控制"><WorkspaceActionButton className="execution-button execution-button--secondary" disabled={!canTakeover || Boolean(pending)} onClick={() => void inspectBrowser('controls')} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : !selected ? '请先选择当前店铺的执行批次。' : '当前店铺未开放浏览器接管，请核对连接及权限后重试。'} busy={pending === 'takeover' && actionOrigin === 'controls'} busyLabel="接管中…"><Browser size={16} />检查 / 接管浏览器</WorkspaceActionButton><WorkspaceActionButton className="execution-button execution-button--primary" disabled={!canStart || Boolean(pending)} onClick={startBatch} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : selectedIssuer === '策略签发' ? '策略签发队列由当前启用策略自动推进，可在此查看和接管。' : selectedUnknown ? '结果不确定时禁止重复保存，请走只读对账或人工接管。' : '请先选择未提交批次，完成稳定对象身份及当前可见浏览器会话核验。'} busy={pending === 'start'} busyLabel="串行执行中…"><Play size={16} />{selectedIssuer === '策略签发' ? '策略队列由本机安全进程自动推进' : pending === 'start' ? '串行执行中…' : '开始串行执行'}</WorkspaceActionButton><WorkspaceActionButton className="execution-button execution-button--danger" disabled={!canCancel || Boolean(pending)} onClick={() => void cancelBatch('controls')} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : !selected ? '请先选择执行批次。' : '只有尚未写入执行意图的完整批次可以取消；已提交或不确定结果请走只读核对。'} busy={pending === 'cancel' && actionOrigin === 'controls'} busyLabel="取消中…"><StopCircle size={16} />取消未提交批次</WorkspaceActionButton></div>}
          </div>}
          {detailTab === 'compare' && <ExecutionReadbackComparison projection={selected} jobId={selectedJob?.id ?? null} previewOnly={previewEnabled} />}
          {detailTab === 'readback' && <div className="execution-readback-panel"><ShieldWarning size={24} weight="duotone" /><strong>{verifiedReadback ? '三段回读已验证' : selectedUnknown ? selected?.reconciliation ? '结果不确定 · 对账记录已保存' : '结果不确定 · 可进行一次只读双次对账' : '等待真实执行后回读'}</strong><p>{selectedUnknown ? reconciliationCopy : '提交后与刷新后的证据必须独立证明同一标准化关键词和目标值；任何不确定性都停止队列且不自动重试。'}</p><WorkspaceActionButton className="execution-button execution-button--secondary" disabled={!selectedUnknown || !canReconcileUnknown || Boolean(pending)} onClick={() => void reconcileUnknown('readback')} type="button" disabledReason={pending ? '当前执行操作进行中，请等待完成。' : !selectedUnknown ? '只读双次对账仅用于结果不确定的批次。' : selected?.reconciliation ? '该批次的只读对账已记录，请查看现有结果，不能重复发起。' : '当前店铺未开放只读对账，请核对权限后重试。'} busy={pending === 'reconcile-unknown' && actionOrigin === 'readback'} busyLabel="只读对账中…">执行只读双次对账</WorkspaceActionButton><details><summary>诊断详情</summary><code>{UNKNOWN_DIAGNOSTIC_DETAIL}</code></details></div>}
          {detailTab === 'evidence' && <div className="execution-archive-panel"><h3>证据与归档</h3><p>串行批次、执行授权终态、因果事件以及变更前 / 提交后 / 刷新后截图和内容哈希均只允许追加。</p><dl><div><dt>批次</dt><dd>{selected ? '已生成' : '待生成'}</dd></div><div><dt>执行授权</dt><dd>{selected?.batch.grantId || grantId ? '已选择' : '待选择'}</dd></div><div><dt>事件数</dt><dd>{consoleRows.length}</dd></div><div><dt>归档状态</dt><dd>{selected?.batch.status === 'succeeded' ? '可归档' : '等待终态'}</dd></div></dl><details><summary>诊断详情</summary><code>{selected?.batch.id ?? '—'}</code><code>{(selected?.batch.grantId ?? grantId) || '—'}</code></details></div>}
          {detailTab === 'experiment' && <div className="execution-experiment-panel"><span>关联经营实验</span><strong>当前批次没有可核验的关联经营实验</strong><p>执行批次投影未提供经营实验关联，因此这里不会用示例名称、假设或观察窗口冒充真实数据。</p>{selectedBatchMission && <dl><div><dt>关联运营任务</dt><dd>{selectedBatchMission.title}</dd></div><div><dt>任务观察期</dt><dd>{selectedBatchMission.observationStartsAt.slice(0, 10)} 至 {selectedBatchMission.observationEndsAt.slice(0, 10)}</dd></div></dl>}</div>}
        </div>
        <p className="execution-safety-note"><Pause size={15} />取消仅在提交前开放；提交后必须完成回读或转入结果不确定的人工对账。</p>
      </section>

      <section className="execution-console" aria-label="只追加执行事件记录">
        <header><div><span>执行事件记录</span><strong>真实执行事件流</strong></div><b>只追加审计事件 · {consoleRows.length} 条</b></header>
        <details>
          <summary>诊断详情</summary>
          <code>EVENT CONSOLE · Authority · append-only</code>
          <div className="execution-console__body" role="log" aria-live="polite">{consoleRows.map((row) => <div data-status={row.status} key={row.id}><time>{formatTime(row.at)}</time><span>{row.message}</span></div>)}{consoleRows.length === 0 && <p>{previewEnabled ? '等待 Main Authority 事件。这里不允许编辑或删除审计记录。' : '等待真实执行事件。这里不允许编辑或删除审计记录。'}</p>}</div>
        </details>
      </section>
    </div>
  );
}
export { type ExecutionSelectionAuthorityApi, type ExecutionWorkspaceProps, type ExecutionGrantSelection, type ExecutionMutationTicket } from './execution-workspace-contracts';
export { EXECUTION_CAPABILITY_IDS, executionCapabilityReady, executionProgressBelongsToSelection, executionMutationCanCommit, executionUserFacingError, preferredExecutionBatchId, preferredExecutionJobId, missionForExecutionBatch } from './execution-workspace-model';
export { selectableExecutionMissions, executionMissionsForContext, buildExecutableGrantSelections } from './execution-workspace-selection';
export { evidenceForExecutionJob } from './execution-workspace-evidence';
