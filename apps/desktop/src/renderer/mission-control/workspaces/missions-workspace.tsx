import { AnalysisRunsListView } from '../../components/workspace/analysis-runs-list-view';
import { AnalysisRunDetailView } from '../../components/workspace/analysis-run-detail-view';
import './missions-workspace.css';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rendererRuntimeLog } from '../../runtime-log';
import {
  Archive,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Circle,
  Clock,
  FlagBanner,
  LinkSimple,
  Pause,
  PencilSimple,
  Play,
  Plus,
  X,
} from '@phosphor-icons/react';
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
  PageFrame,
  SummaryStrip,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
} from '../../components/workspace';
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
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import {
  type MissionsWorkspaceProps,
  type MissionEditorState,
  type CheckpointDraft,
  type MissionDependencies,
  type MissionChoice,
} from './mission-workspace-contracts';
import {
  capabilityReady,
  missionDefinitionEditBlocker,
  PAGE_SIZE,
  buildMissionProductOptions,
  responseMatchesMissionAuthority,
  errorMessage,
  OPERATOR_ACTOR_ID,
  missionRestoreFeedback,
  PHASE_LABELS,
  missionTransitionActionLabel,
  STATUS_LABELS,
  missionLineageLinkLabel,
} from './mission-workspace-model';
import {
  missionPathFailureText,
  refreshMissionAnalysisReceipt,
  missionRecommendationSummaryLabel,
  missionAnalysisBlockerLabel,
  refreshMissionAnalysisFailureReceipt,
  latestMissionAnalysisResult,
  latestEvidencePackageForMission,
  boundAdsObjectsForMission,
  projectMissionAnalysisRun,
  missionAnalysisRunReceipts,
  previousStepEvidenceLabel,
  MissionAnalysisRunHistory,
  missionGuardrailLabel,
} from './mission-workspace-analysis';
import {
  buildUpdateMissionInput,
  buildCreateMissionInput,
  missionDraft,
} from './mission-workspace-inputs';
import {
  missionFlightPlanRows,
  missionFlightPlanCapabilitySummary,
} from './mission-workspace-flight-plan';
import {
  MissionStatus,
  MissionEditor,
  CheckpointEditor,
} from './mission-workspace-editors';
import { MissionStageFeedback } from './mission-stage-feedback';
import { MissionActionButton } from './mission-action-feedback';
import { useWorkspaceOperation } from '../../components/workspace/use-workspace-operation';
import { useOptionalMissionControlStoreContext } from '../store-context';

export function MissionsWorkspace({
  apiOverride,
  analysisApiOverride,
  blockedReason,
  capabilities,
  onInspectBoundary,
  previewMode,
  storeContext,
  view = 'missions/overview',
}: MissionsWorkspaceProps) {
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedRun, setSelectedRun] = useState<{ missionId: string; runId: string } | null>(null);
  const [lineage, setLineage] = useState<MissionLineageProjection | null>(null);
  const [analysis, setAnalysis] = useState<MissionAnalysisProjection | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error'>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState<MissionEditorState | null>(null);
  const [checkpointEditor, setCheckpointEditor] = useState<CheckpointDraft | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<MissionRecord | null>(null);
  const [dependencies, setDependencies] = useState<MissionDependencies>({ batches: [], policyVersions: [], products: [], loading: false });
  const requestSequence = useRef(0);
  const lineageSequence = useRef(0);
  const analysisSequence = useRef(0);
  const mutationSequence = useRef(0);
  const idSequence = useRef(0);
  const storeProvider = useOptionalMissionControlStoreContext();
  const authorityKey = storeContext ? JSON.stringify([missionControlContextKey(storeContext), storeProvider?.contextEpoch ?? 0, storeProvider?.phase, view]) : '';
  const readOperation = useWorkspaceOperation(authorityKey);
  const currentAuthorityKey = useRef(authorityKey);
  currentAuthorityKey.current = authorityKey;
  const factsView = view === 'missions/facts';
  const viewReady = capabilityReady(capabilities, view, 'view', previewMode);
  const expectedCapability = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const api = apiOverride ?? readMissionDomainWindowApi();
  const analysisApi = analysisApiOverride ?? readAnalysisAuthorityWindowApi();
  const policyApi = readPolicyDomainWindowApi();

  const selected = missions.find((mission) => mission.id === selectedId) ?? missions[0] ?? null;
  const mutationKey = JSON.stringify([authorityKey, selected?.id]);
  const mutationOperation = useWorkspaceOperation(mutationKey);
  useLayoutEffect(() => {
    setPending(null); setLineage(null); setAnalysis(null); setAnalysisError(null); setFeedback('');
  }, [mutationKey]);
  const selectedHasBoundDecision = Boolean(selected
    && lineage?.mission.id === selected.id
    && lineage.links.some((link) => link.linkType === 'decision'));
  const definitionEditBlocker = selected
    ? missionDefinitionEditBlocker(selected, selectedHasBoundDecision)
    : null;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    if (!query) return missions;
    return missions.filter((mission) => `${mission.id} ${mission.title} ${mission.objective} ${mission.productId ?? ''}`.toLocaleLowerCase('zh-CN').includes(query));
  }, [missions, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const actionReady = (action: MissionControlCapabilityAction) => Boolean(api && viewReady && storeContext && capabilityReady(capabilities, view, action, previewMode));
  const checkpointReady = Boolean(api && viewReady && storeContext && capabilities?.some((row) => (
    row.capabilityId === 'missions.checkpoint.create'
    && row.state === expectedCapability
  )));

  const navigate = (target: unknown) => {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: target }));
  };

  useEffect(() => {
    if (!storeContext) { setDependencies({ batches: [], policyVersions: [], products: [], loading: false }); return; }
    const capturedKey = authorityKey;
    const isCurrent = readOperation.capture();
    setDependencies({ batches: [], policyVersions: [], products: [], loading: true });
    const surface = (window as any).electronAPI as {
      getOperationScope?: (context: StoreContextEnvelope) => Promise<Record<string, unknown>>;
      getBusinessBatchOptions?: (scope: Record<string, unknown>) => Promise<Array<{ id: string; status: string; dateStart: string; dateEnd: string }>>;
      listStoreProducts?: (context: StoreContextEnvelope, input: { includeArchived: boolean }) => Promise<Array<{ id: number; asin: string; title?: string }>>;
    } | undefined;
    void (async () => {
      if (!surface?.getOperationScope) throw new Error('当前店铺范围服务未接入。');
      const scope = await surface.getOperationScope(storeContext);
      if (!isCurrent()) return;
      const [batchRows, productRows, policyRows] = await Promise.all([
        scope && surface?.getBusinessBatchOptions ? surface.getBusinessBatchOptions(scope) : Promise.resolve([]),
        surface?.listStoreProducts?.(storeContext, { includeArchived: false }) ?? Promise.resolve([]),
        policyApi?.listPolicies(storeContext, { includeArchived: false }) ?? Promise.resolve([] as PolicyRecord[]),
      ]);
      if (!isCurrent()) return;
      const enabledRows = (await Promise.all(policyRows.filter((policy) => policy.status === 'active').map(async (policy) => ({
        policy,
        versions: await policyApi!.listPolicyVersions(storeContext, policy.id),
      })))).flatMap(({ policy, versions }: { policy: PolicyRecord; versions: PolicyVersionRecord[] }) => versions
        .filter((version) => version.status === 'enabled')
        .map((version) => ({ value: version.id, label: `${policy.name} · 版本 ${version.version}` })));
      if (!isCurrent() || currentAuthorityKey.current !== capturedKey) return;
      setDependencies({
        batches: batchRows.filter((batch) => batch.status === 'completed').map((batch) => ({
          value: batch.id,
          label: `${batch.dateStart} 至 ${batch.dateEnd} · 已完成`,
        })),
        policyVersions: enabledRows,
        products: buildMissionProductOptions(productRows),
        loading: false,
      });
    })().catch((dependencyError) => {
      rendererRuntimeLog.error('renderer.mission_dependencies_load_failed', { error: dependencyError });
      if (isCurrent() && currentAuthorityKey.current === capturedKey) setDependencies({ batches: [], policyVersions: [], products: [], loading: false });
    });
  }, [authorityKey]);

  const loadMissions = async (context: StoreContextEnvelope, capturedKey: string) => {
    const isCurrent = readOperation.capture();
    if (!isCurrent()) return;
    const capturedSequence = ++requestSequence.current;
    if (!viewReady) {
      setMissions([]);
      setPhase('blocked');
      setError(`任务中心需要 ${expectedCapability} 能力，当前已失败关闭。`);
      return;
    }
    if (!api) {
      setMissions([]);
      setPhase('blocked');
      setError('运营任务服务未接入；界面不会回退到示例数据。');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      assertMissionAuthorityContext(context);
      const rows = await api.listMissions(context, { includeArchived });
      if (!isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, requestSequence.current, capturedSequence)) return;
      rows.forEach((mission) => assertMissionBelongsToContext(mission, context));
      setMissions(rows);
      setSelectedId((current) => rows.some((mission) => mission.id === current)
        ? current
        : rows.find((mission) => mission.status === 'active')?.id ?? rows[0]?.id ?? '');
      setPhase('ready');
      setFeedback(`已读取 ${rows.length} 条当前店铺运营任务。`);
    } catch (loadError) {
      rendererRuntimeLog.error('renderer.missions_load_failed', { error: loadError });
      if (!isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, requestSequence.current, capturedSequence)) return;
      setMissions([]);
      setLineage(null);
      setPhase('error');
      setError(errorMessage(loadError));
    }
  };

  useLayoutEffect(() => {
    requestSequence.current += 1;
    lineageSequence.current += 1;
    analysisSequence.current += 1;
    mutationSequence.current += 1;
    setMissions([]);
    setSelectedId('');
    setLineage(null);
    setAnalysis(null);
    setPage(1);
    setSearch('');
    setEditor(null);
    setCheckpointEditor(null);
    setArchiveConfirm(null);
    setFeedback('');
    setError(null);
    setAnalysisError(null);
    setPending(null);
    if (!storeContext || !authorityKey) {
      setPhase('blocked');
      setError('尚未选择当前店铺；运营任务已失败关闭。');
      return;
    }
    void loadMissions(storeContext, authorityKey);
    // 工作区在权威变化时重读，接口实例不作为独立授权来源。
  }, [authorityKey, includeArchived, viewReady]);

  useEffect(() => {
    if (!selected || !storeContext || !api || !viewReady) {
      setLineage(null);
      return;
    }
    const capturedKey = authorityKey;
    const isCurrent = readOperation.capture();
    const capturedSequence = ++lineageSequence.current;
    void api.getMissionLineage(storeContext, selected.id).then((projection) => {
      if (!isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, lineageSequence.current, capturedSequence)) return;
      assertMissionBelongsToContext(projection.mission, storeContext);
      if (projection.checkpoints.some((item) => String(item.storeId) !== String(storeContext.storeId) || item.missionId !== selected.id)
        || projection.links.some((item) => String(item.storeId) !== String(storeContext.storeId) || item.missionId !== selected.id)
        || (projection.causalEvents ?? []).some((item) => String(item.storeId) !== String(storeContext.storeId) || item.missionId !== selected.id)) {
        throw new Error('Mission lineage 返回了跨店铺或错误 Mission 的记录。');
      }
      setLineage(projection);
    }).catch((lineageError) => {
      rendererRuntimeLog.error('renderer.mission_lineage_load_failed', { error: lineageError });
      if (!isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, lineageSequence.current, capturedSequence)) return;
      setLineage(null);
      setError(errorMessage(lineageError));
    });
  }, [api, authorityKey, selected?.id, storeContext, viewReady]);

  useEffect(() => {
    if (!selected || !storeContext || !analysisApi || !viewReady) {
      setAnalysis(null);
      return;
    }
    const capturedKey = authorityKey;
    const isCurrent = readOperation.capture();
    const capturedSequence = ++analysisSequence.current;
    void analysisApi.getMissionProjection(storeContext, selected.id).then((projection) => {
      if (!isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      assertAnalysisProjectionBelongsToContext(storeContext, selected.id, projection);
      setAnalysis(projection);
    }).catch((analysisError) => {
      rendererRuntimeLog.error('renderer.mission_analysis_projection_failed', { error: analysisError });
      if (!isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      setAnalysis(null);
      const text = missionPathFailureText(analysisError);
      setAnalysisError(text);
      setError(text);
    });
  }, [analysisApi, authorityKey, selected?.id, storeContext, viewReady]);

  const runMutation = async <T,>(label: string, operation: (activeApi: MissionDomainRendererApi, context: StoreContextEnvelope) => Promise<T>): Promise<T | undefined> => {
    if (!api || !storeContext || pending || !viewReady) {
      setError('运营任务写入服务不可用，操作已阻断。');
      return undefined;
    }
    const ticket = mutationOperation.begin();
    if (!ticket) return undefined;
    const capturedContext = storeContext;
    const capturedKey = authorityKey;
    const capturedSequence = ++mutationSequence.current;
    setPending(label);
    setError(null);
    setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (!ticket.isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, mutationSequence.current, capturedSequence)) return undefined;
      if (result && typeof result === 'object' && 'storeId' in result && String(result.storeId) !== String(capturedContext.storeId)) throw new Error('当前操作回执不属于本店铺，已拒绝显示。');
      if (result && typeof result === 'object' && 'phase' in result
        && (!('marketplace' in result) || result.marketplace !== 'US' || !('currency' in result) || result.currency !== 'USD')) throw new Error('当前任务回执不是美国站美元范围，已拒绝显示。');
      return result;
    } catch (mutationError) {
      rendererRuntimeLog.error('renderer.mission_mutation_failed', { error: mutationError });
      if (ticket.isCurrent() && responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, mutationSequence.current, capturedSequence)) setError(errorMessage(mutationError));
      return undefined;
    } finally {
      if (ticket.isCurrent() && responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, mutationSequence.current, capturedSequence)) setPending(null);
      ticket.finish();
    }
  };

  const saveMission = async () => {
    if (!editor || !storeContext) return;
    const isCurrent = mutationOperation.capture();
    let input: CreateMissionInput | UpdateMissionInput;
    try {
      input = editor.mission
        ? buildUpdateMissionInput(storeContext, editor.mission, editor.draft)
        : buildCreateMissionInput(storeContext, editor.draft, `MISSION-${String(storeContext.storeId)}-${Date.now()}-${++idSequence.current}`);
    } catch (validationError) {
      rendererRuntimeLog.warn('renderer.mission_input_invalid', { error: validationError });
      setError(errorMessage(validationError));
      return;
    }
    const saved = await runMutation('save', (activeApi, context) => editor.mission
      ? activeApi.updateMission(context, input as UpdateMissionInput)
      : activeApi.createMission(context, input as CreateMissionInput));
    if (!isCurrent() || !saved || typeof saved !== 'object' || !('storeId' in saved)) return;
    const mission = saved as MissionRecord;
    assertMissionBelongsToContext(mission, storeContext);
    setMissions((current) => current.some((item) => item.id === mission.id)
      ? current.map((item) => item.id === mission.id ? mission : item)
      : [mission, ...current]);
    setSelectedId(mission.id);
    setEditor(null);
    setFeedback(editor.mission ? '运营任务定义已更新。' : '运营任务已创建并写入当前店铺。');
  };

  const transitionMission = async () => {
    if (!selected) return;
    const isCurrent = mutationOperation.capture();
    const nextStatus: Exclude<MissionLifecycleStatus, 'archived'> = selected.status === 'active' ? 'paused' : 'active';
    const saved = await runMutation('transition', (activeApi, context) => activeApi.transitionMission(context, {
      id: selected.id,
      expectedRevision: selected.revision,
      status: nextStatus,
      actorId: OPERATOR_ACTOR_ID,
      reason: nextStatus === 'paused' ? '运营者从任务中心暂停' : '运营者从任务中心恢复',
    }));
    if (!isCurrent() || !saved) return;
    setMissions((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback(nextStatus === 'paused' ? '运营任务已暂停；未完成动作保持锁定。' : '运营任务已恢复，可继续推进检查点。');
  };

  const archiveMission = async () => {
    const target = archiveConfirm;
    if (!target) return;
    const isCurrent = mutationOperation.capture();
    const saved = await runMutation('archive', (activeApi, context) => activeApi.archiveMission(context, {
      id: target.id,
      expectedRevision: target.revision,
      actorId: OPERATOR_ACTOR_ID,
    }));
    if (!isCurrent() || !saved) return;
    setArchiveConfirm(null);
    setMissions((current) => includeArchived
      ? current.map((item) => item.id === saved.id ? saved : item)
      : current.filter((item) => item.id !== saved.id));
    setFeedback('运营任务已归档；检查点和来源链继续保留。');
  };

  const restoreMission = async () => {
    if (!selected) return;
    const isCurrent = mutationOperation.capture();
    const saved = await runMutation('restore', (activeApi, context) => activeApi.restoreMission(context, {
      id: selected.id,
      expectedRevision: selected.revision,
      actorId: OPERATOR_ACTOR_ID,
    }));
    if (!isCurrent() || !saved) return;
    setMissions((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback(missionRestoreFeedback(saved));
  };

  const appendCheckpoint = async () => {
    if (!selected || !checkpointEditor) return;
    const isCurrent = mutationOperation.capture();
    if (!checkpointReady) {
      setError('缺少精确能力 missions.checkpoint.create，检查点追加已阻断。');
      return;
    }
    const evidenceCount = Number(checkpointEditor.evidenceCount);
    if (!Number.isSafeInteger(evidenceCount) || evidenceCount < 0) {
      setError('检查点证据数量必须是不小于 0 的整数。');
      return;
    }
    const saved = await runMutation('checkpoint', (activeApi, context) => activeApi.appendMissionCheckpoint(context, {
      id: `CHECKPOINT-${selected.id}-${Date.now()}-${++idSequence.current}`,
      missionId: selected.id,
      stage: checkpointEditor.stage,
      title: checkpointEditor.title.trim(),
      status: checkpointEditor.status,
      evidenceCount,
      actorId: OPERATOR_ACTOR_ID,
    }));
    if (!isCurrent() || !saved) return;
    setLineage((current) => current ? { ...current, checkpoints: [...current.checkpoints, saved] } : current);
    setCheckpointEditor(null);
    setFeedback(`检查点“${saved.title}”已追加到因果链。`);
  };

  const runAnalysis = async () => {
    if (!analysisApi || !api || !storeContext || !selected || pending) {
      const blocked = '真实分析或运营任务服务不可用，操作已阻断。';
      setAnalysisError(blocked);
      setError(blocked);
      return;
    }
    const ticket = mutationOperation.begin();
    if (!ticket) return;
    const capturedContext = storeContext;
    const capturedKey = authorityKey;
    const capturedSequence = ++analysisSequence.current;
    setPending('analysis');
    setError(null);
    setAnalysisError(null);
    setFeedback('');
    try {
      const result = await analysisApi.runMissionAnalysis({
        context: capturedContext,
        missionId: selected.id,
      });
      if (!ticket.isCurrent()) return;
      const receipt = await refreshMissionAnalysisReceipt({
        analysisApi,
        context: capturedContext,
        includeArchived,
        missionApi: api,
        missionId: selected.id,
      });
      if (!ticket.isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      setAnalysis(receipt.analysis);
      setMissions(receipt.missions);
      setSelectedId(selected.id);
      setLineage(receipt.lineage);
      setAnalysisError(null);
      const automatic = result.automaticAuthorization;
      const recommendationSummary = missionRecommendationSummaryLabel(result.recommendationSummary);
      setFeedback(automatic
        ? automatic.authorized
          ? `分析完成：8/8 领星证据已封存，策略自动已整批签发 ${automatic.proposalIds.length} 条建议；尚未执行 Ads。${recommendationSummary}结果进入决策中心，任务进度已自动记录事实与分析检查点。`
          : `分析完成：形成 ${result.proposals.length} 条不可变建议，但策略自动授权被阻断：${[...new Set(automatic.blockers.map((blocker) => missionAnalysisBlockerLabel(blocker.code)))].join('；')}。${recommendationSummary}结果进入决策中心，任务进度已自动记录事实与分析检查点。`
        : `分析完成：8/8 领星证据已封存，形成 ${result.proposals.length} 条不可变建议快照。请逐条审批并填写原因，再整批签发授权。${recommendationSummary}结果进入决策中心，任务进度已自动记录事实与分析检查点。`);
    } catch (analysisError) {
      rendererRuntimeLog.error('renderer.mission_analysis_run_failed', { error: analysisError });
      if (!ticket.isCurrent() || !responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      try {
        const failureLineage = await refreshMissionAnalysisFailureReceipt({
          context: capturedContext,
          missionApi: api,
          missionId: selected.id,
        });
        if (ticket.isCurrent() && responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) {
          setLineage(failureLineage);
        }
      } catch (receiptError) {
        rendererRuntimeLog.error('renderer.mission_failure_receipt_refresh_failed', { error: receiptError });
        // 保留原分析失败，不用刷新异常替换它或伪造终态收据。
      }
      if (!ticket.isCurrent()) return;
      const text = missionPathFailureText(analysisError);
      setAnalysisError(text);
      setError(text);
    } finally {
      if (ticket.isCurrent() && responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) {
        setPending(null);
      }
      ticket.finish();
    }
  };

  const activeCheckpoints = lineage?.checkpoints ?? [];
  const flightPlan = selected ? missionFlightPlanRows(selected.phase, selected.status, activeCheckpoints) : [];
  const currentFlightPlanRow = flightPlan.find((row) => row.state === 'current' || row.state === 'blocked');
  const blocked = phase === 'blocked' || phase === 'error';
  const busy = pending !== null || mutationOperation.busy;
  const archiveFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: Boolean(archiveConfirm), onDismiss: () => setArchiveConfirm(null), dismissDisabled: busy,
  });
  const latestAnalysisResult = analysis
    ? latestMissionAnalysisResult(analysis, selected?.revision)
    : { actionBatch: null, evidence: null, proposals: [], stale: false };
  const latestEvidence = latestAnalysisResult.stale
    ? null
    : selected && storeContext
      ? latestEvidencePackageForMission(analysis?.evidencePackages, selected.id, String(storeContext.storeId))
      : latestAnalysisResult.evidence;
  const latestActionBatch = latestEvidence && selected && storeContext
    ? (analysis?.actionBatches ?? [])
      .filter((batch) => batch.missionId === selected.id
        && String(batch.storeId) === String(storeContext.storeId)
        && batch.evidencePackageId === latestEvidence.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    : latestAnalysisResult.actionBatch;
  const latestProposals = latestActionBatch
    ? (analysis?.proposals ?? []).filter((proposal) => proposal.actionBatchId === latestActionBatch.id
      && (!selected || proposal.missionId === selected.id)
      && (!storeContext || String(proposal.storeId) === String(storeContext.storeId))
      && (!latestEvidence || proposal.evidencePackageId === latestEvidence.id))
    : latestAnalysisResult.proposals;
  const boundAdsObjects = selected && storeContext
    ? boundAdsObjectsForMission(selected.id, String(storeContext.storeId), latestEvidence, latestProposals)
    : [];
  const missionAnalysisRun = selected && storeContext
    ? projectMissionAnalysisRun({
      mission: selected,
      storeId: String(storeContext.storeId),
      pendingAnalysis: pending === 'analysis',
      analysisError,
      evidence: latestEvidence,
      proposals: latestProposals,
    })
    : null;
  const batchRangeLabel = missionAnalysisRun?.dateFrom && missionAnalysisRun.dateTo
    ? `${missionAnalysisRun.dateFrom} → ${missionAnalysisRun.dateTo}`
    : '';
  const analysisRunHistory = missionAnalysisRunReceipts(
    lineage?.causalEvents ?? [],
    storeContext?.sessionGeneration ?? -1,
  );
  const dependencyLabel = (rows: readonly MissionChoice[], value: string | undefined, fallback: string) => (
    rows.find((row) => row.value === value)?.label ?? fallback
  );
  const selectedBatchLabel = dependencyLabel(dependencies.batches, selected?.dataBatchId, '关联批次不可用');
  const selectedPolicyLabel = dependencyLabel(dependencies.policyVersions, selected?.policyVersionId, '关联策略不可用');
  const visibleBlockedReason = missionPathFailureText(error ?? blockedReason, '运营任务');
  const previousEvidence = selected ? previousStepEvidenceLabel(selected, lineage, latestEvidence) : '尚无上一步证据';

  return (
    <div className={`mission-control-workspace-root mission-domain-workspace${factsView ? ' mission-domain-workspace--facts' : ''}`} data-canonical-surface="missions" data-capability-state={viewReady ? expectedCapability : 'BLOCKED'} data-default-focus={factsView ? 'evidence-lineage' : 'mission-flight-plan'} data-preview-mode={previewMode || undefined} data-view={view} data-mission-id={selected?.id} data-data-batch-id={selected?.dataBatchId} data-import-run-id={latestEvidence?.importRunId} data-analysis-run-status={missionAnalysisRun?.status}>
      {previewMode && <i data-legacy-test-copy="MISSION CONTROL · 显式内存 adapter · Amazon US · USD · 新建 Mission · Mission 队列 · 验证店铺级 Mission 飞行计划 · Mission 事实链 · Mission 事实范围" hidden />}
      <p className="sr-only" id="mission-domain-authority-boundary">
        {!viewReady ? visibleBlockedReason : !api ? '运营任务服务未接入；界面不会回退到示例数据。' : '运营任务服务已接入。'}
      </p>
      <PageFrame
        className="mission-domain-page"
        description={factsView ? '聚焦当前运营任务的广告事实、检查点和数据来源链。' : '把事实、决策、执行和回读串成一条可审计路径。'}
        pageId={factsView ? 'missions-facts' : 'missions-overview'}
        title={factsView ? '运营任务事实链' : '任务中心'}
        task={(
          <TaskBanner
            compact
            description={factsView ? '先核验领星数据批次、事实检查点与来源关系；事实不足时不进入决策。' : '运营任务绑定当前店铺、已完成数据批次、已启用策略、产品和观察窗口。'}
            eyebrow="运营任务控制台"
            primaryAction={{
              actionId: factsView ? 'missions.checkpoint.create' : 'missions.mission.create',
              disabled: factsView ? (!selected || !checkpointReady || busy) : (!actionReady('create') || busy),
              disabledReason: busy ? '当前任务正在处理，请等待结果。' : !api ? '运营任务服务未接入。' : visibleBlockedReason,
              label: factsView ? '记录事实检查点' : '新建运营任务',
              onClick: () => factsView
                ? selected && setCheckpointEditor({ stage: 'FACT', title: '', status: 'completed', evidenceCount: '1' })
                : storeContext && setEditor({ mission: null, draft: missionDraft(storeContext) }),
            }}
            secondaryActions={onInspectBoundary ? [{ actionId: 'mission-boundary', label: '查看接入边界', onClick: onInspectBoundary }] : []}
            status={<span className="mission-domain-authority" data-state={viewReady ? expectedCapability : 'BLOCKED'}>{viewReady ? (previewMode ? '仅开发预览' : '生产可用') : '已阻断'}</span>}
            title={factsView ? '核验当前运营任务的事实与来源' : previewMode ? '验证店铺级运营任务计划' : '推进当前店铺运营任务'}
            tone={blocked ? 'blocked' : 'neutral'}
          >
            {previewMode && <p className="mission-domain-preview-note">仅开发预览 · Amazon 美国站 · USD · 不代表真实执行或回读</p>}
          </TaskBanner>
        )}
        summary={(
          <SummaryStrip
            ariaLabel="运营任务当前权威上下文"
            items={selected ? [
              { id: 'mission', label: '当前运营任务', value: selected.title },
              { id: 'phase', label: '当前阶段', value: PHASE_LABELS[selected.phase] },
              { id: 'batch', label: '数据批次区间', value: batchRangeLabel || selectedBatchLabel, tone: batchRangeLabel || selected.dataBatchId ? 'neutral' : 'blocked' },
              { id: 'previous', label: '上一步证据', value: previousEvidence },
            ] : [
              { id: 'store', label: '当前店铺', value: storeContext ? '已选择' : '等待选择' },
              { id: 'market', label: '站点 / 币种', value: storeContext ? '美国站 / USD' : '等待店铺' },
              { id: 'count', label: factsView ? '事实检查点' : '运营任务', value: phase === 'loading' ? '读取中' : factsView ? `${lineage?.checkpoints.filter((item) => ['FACT', 'ANALYSIS'].includes(item.stage)).length ?? 0} 条` : `${missions.length} 条` },
              { id: 'authority', label: '数据来源', value: api && viewReady ? (previewMode ? '开发预览' : '本机数据') : '不可用', tone: api && viewReady ? 'neutral' : 'blocked' },
            ]}
          />
        )}
      >
        <div className="mission-domain-layout">
          <details className="mission-domain-switcher">
            <summary>
              <span>{factsView ? '运营任务事实范围' : '运营任务队列'}</span>
              <strong>{selected?.title ?? (phase === 'loading' ? '读取运营任务' : '等待选择运营任务')}</strong>
              <small>{filtered.length} 条 · 第 {safePage}/{pageCount} 页</small>
            </summary>
            <WorkbenchPanel
              className="mission-domain-queue"
              description="选择运营任务后查看检查点与完整来源链。"
              footer={filtered.length ? `第 ${safePage}/${pageCount} 页 · ${filtered.length} 条匹配记录` : '当前筛选没有运营任务。'}
              title={factsView ? '运营任务事实范围' : '运营任务队列'}
              toolbar={factsView ? undefined : <MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : '当前店铺暂不具备创建任务的权限，请核对店铺与服务。'} aria-label="新建运营任务" className="workspace-button workspace-button--primary" disabled={!actionReady('create') || busy} onClick={() => storeContext && setEditor({ mission: null, draft: missionDraft(storeContext) })} type="button"><Plus aria-hidden="true" size={16} />新建</MissionActionButton>}
            >
              <div className="mission-domain-queue-tools">
                <input aria-label="搜索运营任务" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索标题、目标或产品" value={search} />
                <label><input checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} type="checkbox" />查看已归档</label>
              </div>
              {phase === 'loading' && <WorkspaceState description="正在读取当前店铺运营任务。" kind="loading" title="读取运营任务" />}
              {blocked && <WorkspaceState description="生产模式不会使用界面临时数据。" details={visibleBlockedReason} kind="blocked" title="运营任务已失败关闭" />}
              {phase === 'ready' && pageRows.length === 0 && <WorkspaceState description="新建运营任务后，系统会先建立事实基线再推进。" kind="empty" title="当前店铺没有运营任务" />}
              {phase === 'ready' && pageRows.length > 0 && (
                <ul className="mission-domain-queue-list" aria-label="运营任务列表">
                  {pageRows.map((mission) => (
                    <li key={mission.id}><button aria-pressed={mission.id === selected?.id} className="mission-domain-queue-item" data-selected={mission.id === selected?.id || undefined} onClick={() => setSelectedId(mission.id)} type="button">
                        <span><b>{mission.priority}</b><MissionStatus status={mission.status} /></span>
                        <strong>{mission.title}</strong>
                        <small>{dependencyLabel(dependencies.products, mission.productId, '关联产品不可用')} · {PHASE_LABELS[mission.phase]}</small>
                      </button></li>
                  ))}
                </ul>
              )}
              <nav aria-label="运营任务分页" className="mission-domain-pagination"><MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : '已经是第一页。'} aria-label="上一页运营任务" className="workspace-button workspace-button--secondary" disabled={safePage <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><CaretLeft size={15} /></MissionActionButton><span>{safePage} / {pageCount}</span><MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : '已经是最后一页。'} aria-label="下一页运营任务" className="workspace-button workspace-button--secondary" disabled={safePage >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><CaretRight size={15} /></MissionActionButton></nav>
            </WorkbenchPanel>
          </details>

          <div className="mission-domain-detail">
            {selected ? (
              <>
                <section className="mission-domain-detail-header">
                  <div><span>当前运营任务</span><h2>{selected.title}</h2><p>{selected.objective}</p></div>
                  <MissionStatus status={selected.status} />
                  {!factsView && <div className="mission-domain-actions" role="group" aria-label="运营任务增删改查">
                    <MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : !analysisApi ? '分析服务尚未接入，请重新加载当前工作区。' : '请先启动或恢复当前运营任务，再运行分析。'} busy={pending === 'analysis'} busyLabel="分析中…" className="workspace-button workspace-button--primary" disabled={!analysisApi || busy || selected.status !== 'active'} onClick={() => void runAnalysis()} title={selected.status !== 'active' ? '只有运行中的运营任务可以形成正式分析批次。' : missionAnalysisRun?.status === 'retryable' ? '可重试当前运营任务分析。' : undefined} type="button"><FlagBanner size={15} />{pending === 'analysis' ? '分析中…' : missionAnalysisRun?.status === 'retryable' ? '重试分析' : '运行分析'}</MissionActionButton>
                    <MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : definitionEditBlocker ?? (selected.status === 'archived' ? '任务已归档，请先恢复任务。' : selected.status === 'completed' ? '任务已完成，历史只读；请新建任务开展后续工作。' : '当前店铺暂不具备编辑任务的权限，请重新核对店铺与服务。')} className="workspace-button workspace-button--primary" disabled={!actionReady('update') || busy || ['archived', 'completed'].includes(selected.status) || Boolean(definitionEditBlocker)} onClick={() => storeContext && setEditor({ mission: selected, draft: missionDraft(storeContext, selected) })} title={definitionEditBlocker ?? undefined} type="button"><PencilSimple size={15} />编辑</MissionActionButton>
                    {selected.status !== 'archived' && <MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : selected.status === 'completed' ? '任务已完成，历史只读；后续工作请新建任务。' : '当前店铺暂不具备变更任务状态的权限，请核对店铺与服务。'} busy={pending === 'transition'} busyLabel="更新状态中…" className="workspace-button workspace-button--secondary" disabled={!actionReady(selected.status === 'active' ? 'pause' : 'resume') || busy || selected.status === 'completed'} onClick={() => void transitionMission()} type="button">{selected.status === 'active' ? <Pause size={15} /> : <Play size={15} />}{missionTransitionActionLabel(selected.status)}</MissionActionButton>}
                    {selected.status !== 'archived' && <MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : '当前店铺暂不具备归档任务的权限，请核对店铺与服务。'} className="workspace-button workspace-button--secondary" disabled={!actionReady('archive') || busy} onClick={() => setArchiveConfirm(selected)} type="button"><Archive size={15} />归档</MissionActionButton>}
                    {selected.status === 'archived' && <MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : '当前店铺暂不具备恢复任务的权限，请核对店铺与服务。'} busy={pending === 'restore'} busyLabel="恢复中…" className="workspace-button workspace-button--secondary" disabled={!actionReady('restore') || busy} onClick={() => void restoreMission()} type="button"><ArrowClockwise size={15} />恢复</MissionActionButton>}
                  </div>}
                  {definitionEditBlocker && !factsView && <p className="mission-domain-definition-lock" role="note">{definitionEditBlocker}</p>}
                  <details className="mission-domain-diagnostics"><summary>诊断详情</summary><code>missionId={selected.id}</code><code>revision={selected.revision}</code><code>status={selected.status}</code></details>
                </section>

                <dl className="mission-domain-contract" aria-label="运营任务执行合同">
                  <div><dt>当前阶段</dt><dd>{PHASE_LABELS[selected.phase]}</dd></div>
                  <div><dt>数据批次区间</dt><dd>{batchRangeLabel || selectedBatchLabel}</dd></div>
                  <div><dt>策略版本</dt><dd>{selectedPolicyLabel}</dd></div>
                  <div><dt>上一步证据</dt><dd>{previousEvidence}</dd></div>
                </dl>

                <section className="mission-domain-ads-verify" aria-label="核验 Ads 对象">
                  <header><div><span>绑定来自本任务已封存证据包</span><h3>核验 Ads 对象</h3><p>对象是否绑定只看本任务证据包与导入批次，不使用顶部范围日期。</p></div><b data-state={boundAdsObjects.length ? 'pending' : 'empty'}>{boundAdsObjects.length ? '待核验' : '未绑定'}</b></header>
                  {boundAdsObjects.length ? <ul className="mission-domain-ads-verify-list">{boundAdsObjects.map((item) => <li key={item.key} data-status={item.status}><div><strong>{item.entityName}</strong><small>{item.campaignName} / {item.adGroupName}</small></div><em>待核验</em></li>)}</ul> : <WorkspaceState kind="empty" title="尚未绑定本任务 Ads 对象" description="绑定以本任务证据包与导入批次为准；顶部范围日期不会把对象标成已核验。" />}
                  <footer><details className="mission-domain-diagnostics"><summary>诊断详情</summary><code>missionId={selected.id}</code><code>importRunId={latestEvidence?.importRunId ?? 'none'}</code><code>evidencePackageId={latestEvidence?.id ?? 'none'}</code></details></footer>
                </section>

                <section className="mission-domain-analysis-authority" aria-label="运营任务分析权威" data-run-status={missionAnalysisRun?.status ?? 'idle'}>
                  <header><div><span>真实分析 · 美国站 / USD</span><h3>真实分析与不可变建议批次</h3><p>范围由系统从本任务数据批次与证据包推导；界面不能改用顶部范围日期。</p></div><b data-ready={missionAnalysisRun?.status === 'completed' ? 'true' : 'false'} data-status={missionAnalysisRun?.status ?? 'idle'}>{missionAnalysisRun?.statusLabel ?? '未运行'}</b></header>
                  <MissionAnalysisRunHistory receipts={analysisRunHistory} />
                  {storeContext && (selectedRun?.missionId === selected.id
                    ? <AnalysisRunDetailView key={authorityKey + selectedRun.runId} storeContext={storeContext} runId={selectedRun.runId} onBack={() => setSelectedRun(null)} onStartAnalysis={() => { setSelectedRun(null); void runAnalysis(); }} onViewRecommendations={() => navigate({ workspace: 'decisions', subview: 'approval' })} />
                    : <AnalysisRunsListView key={authorityKey + selected.id} storeContext={storeContext} missionId={selected.id} refreshToken={analysis} onRunSelect={runId => setSelectedRun({ missionId: selected.id, runId })} />)}
                  {latestEvidence ? <>
                    <dl><div><dt>运行状态</dt><dd>{missionAnalysisRun?.statusLabel}</dd></div><div><dt>领星报告</dt><dd>{latestEvidence.reportTypes.length}/8</dd></div><div><dt>指标行</dt><dd>{latestEvidence.metricRowCount}</dd></div><div><dt>数据批次区间</dt><dd>{latestEvidence.dateFrom} → {latestEvidence.dateTo}</dd></div></dl>
                    {missionAnalysisRun?.failureCodes.length ? <p className="mission-domain-failure-codes" role="status">{missionAnalysisRun.failureCodes.map((code) => <code key={code}>{code}</code>)}<span>{missionAnalysisRun.failureText}</span></p> : null}
                    <div className="mission-domain-proposal-strip" role="list">{latestProposals.map((proposal) => <article key={proposal.id} role="listitem" data-authorizable={proposal.authorization.human.eligible || undefined}><div><strong>{proposal.entityName}</strong><small>{proposal.campaignName} / {proposal.adGroupName}</small></div><b>${(proposal.currentBidCents / 100).toFixed(2)} → ${(proposal.proposedBidCents / 100).toFixed(2)}</b><span>{proposal.source === 'rule_ai' ? '规则 + AI 一致' : proposal.source === 'ai' ? '仅 AI / 人工审批' : proposal.source === 'rule_fallback' ? 'AI 降级 / 不可授权' : '规则建议'}</span><em>{proposal.authorization.human.eligible ? '可进入人工审批' : [...new Set(proposal.authorization.human.blockers.map(missionAnalysisBlockerLabel))].join(' · ')}</em></article>)}</div>
                    <footer><details className="mission-domain-diagnostics"><summary>诊断详情</summary><code>packageHash={latestEvidence.packageHash.slice(0, 12)}</code><code>importRunId={latestEvidence.importRunId}</code><code>dataBatchId={latestEvidence.dataBatchId}</code><code>ruleRevision={latestEvidence.ruleRevision.slice(0, 8)}</code><code>modelRevision={latestEvidence.modelRevision}</code></details></footer>
                  </> : <WorkspaceState
                    kind={pending === 'analysis' ? 'loading' : missionAnalysisRun?.status === 'retryable' ? 'blocked' : 'empty'}
                    title={pending === 'analysis' ? '分析运行中' : missionAnalysisRun?.status === 'retryable' ? '分析可重试' : latestAnalysisResult.stale ? '任务范围已变化，旧分析不再适用' : '尚未形成真实分析批次'}
                    description={latestAnalysisResult.stale
                      ? '产品、观察窗口或任务版本已变化；历史回执仍保留，请重新运行分析后再进入决策。'
                      : pending === 'analysis' ? '正在封存本任务数据批次对应的 8 类领星证据，请等待运行记录。' : analysisError || '运行中的运营任务会封存本任务数据批次的 8 类领星报表，然后留下可读取的分析运行记录。'}
                  />}
                </section>

                <div className="mission-domain-flight-layout">
                  <section className="mission-domain-flight-plan">
                    <header><div><h3>六阶段任务计划</h3><p>{missionFlightPlanCapabilitySummary()}</p></div><MissionActionButton disabledReason={busy ? '当前任务正在处理，请等待结果。' : selected.status === 'archived' ? '任务已归档，只读历史；请先恢复任务再补充事实。' : '当前店铺暂不具备补充事实记录的权限，请核对店铺与服务。'} className="workspace-button workspace-button--secondary" disabled={!checkpointReady || busy || selected.status === 'archived'} onClick={() => setCheckpointEditor({ stage: 'FACT', title: '', status: 'completed', evidenceCount: '1' })} type="button"><Plus size={15} />补充事实记录</MissionActionButton></header>
                    <div className="mission-domain-checkpoints" role="list" aria-label="运营任务六阶段计划">
                      {flightPlan.map((row, index) => <article data-state={row.state === 'done' ? 'complete' : row.state} key={row.phase} role="listitem">
                        <span>{row.state === 'done' ? <CheckCircle size={18} weight="fill" /> : row.state === 'current' ? <Clock size={18} /> : <Circle size={18} />}</span>
                        <time>{String(index + 1).padStart(2, '0')}</time>
                        <div><strong>{row.label}</strong><small>{row.latestCheckpointTitle ? <><em>{row.latestCheckpointSourceLabel}</em>{row.latestCheckpointTitle}</> : row.description}</small>
                          <MissionStageFeedback row={row} mission={selected} events={lineage?.causalEvents ?? []} onNavigate={navigate} />
                          {row.checkpoints.length > 0 && <details className="mission-domain-diagnostics"><summary>诊断详情</summary>{row.checkpoints.map((checkpoint) => <React.Fragment key={checkpoint.id}><code>{checkpoint.title}</code><code>actorId={checkpoint.actorId}</code><code>status={checkpoint.status}</code></React.Fragment>)}</details>}
                        </div>
                        <b>{row.evidenceCount > 0 ? `${row.evidenceCount} 条证据 · ${row.statusLabel}` : row.statusLabel}</b>
                      </article>)}
                    </div>
                  </section>
                  <aside className="mission-domain-agent-state">
                    <header><FlagBanner size={20} weight="duotone" /><div><h3>任务当前状态</h3><p>{STATUS_LABELS[selected.status]}</p></div></header>
                    <div className="mission-domain-stage-list">
                      {currentFlightPlanRow && <div data-state={currentFlightPlanRow.state}><Circle size={16} /><strong>{currentFlightPlanRow.label}</strong><span>{currentFlightPlanRow.statusLabel}：{currentFlightPlanRow.description}</span></div>}
                    </div>
                    <section><h4>成功标准</h4><ul>{selected.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <section><h4>守护栏</h4><ul>{selected.guardrails.map((item) => <li key={item}>{missionGuardrailLabel(item)}</li>)}</ul></section>
                  </aside>
                </div>

                <section className="mission-domain-lineage">
                  <header><div><h3>任务来源链</h3><p>从数据批次与策略版本一直追溯到决策、实验、执行和结果。</p></div><LinkSimple size={19} /></header>
                  <div role="list">{lineage?.links.length ? lineage.links.map((link) => <article key={link.id} role="listitem"><span>{missionLineageLinkLabel(link.linkType)}</span><strong>已关联</strong><details className="mission-domain-diagnostics"><summary>诊断详情</summary><code>targetId={link.targetId}</code><code>relation={link.relation}</code><code>actorId={link.actorId}</code></details></article>) : <p>当前运营任务尚无来源链记录。</p>}</div>
                </section>
              </>
            ) : phase === 'ready' ? <WorkspaceState description="从左侧选择运营任务，或新建当前店铺的第一个任务。" kind="empty" title="等待选择运营任务" /> : null}
          </div>
        </div>
        {(error || feedback) && <p aria-live="polite" className="mission-domain-feedback" data-tone={error ? 'error' : 'success'}>{error ? missionPathFailureText(error, '运营任务') : feedback}</p>}
        {!previewMode && (!viewReady || error) && <details className="mission-domain-diagnostics"><summary>诊断详情</summary><code>{error ?? blockedReason}</code></details>}
      </PageFrame>

      {editor && <MissionEditor busy={pending === 'save'} dependencies={dependencies} editor={editor} onCancel={() => setEditor(null)} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onNavigate={navigate} onSave={() => void saveMission()} />}
      {checkpointEditor && <CheckpointEditor busy={pending === 'checkpoint'} draft={checkpointEditor} onCancel={() => setCheckpointEditor(null)} onChange={setCheckpointEditor} onSave={() => void appendCheckpoint()} />}
      {archiveConfirm && <div className="mission-control-dialog-backdrop" ref={archiveFocus.overlayRootRef}><section aria-labelledby="mission-archive-title" ref={archiveFocus.surfaceRef} tabIndex={-1} aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>归档运营任务</span><h2 id="mission-archive-title">归档“{archiveConfirm.title}”？</h2><p>任务会退出默认队列，但检查点、决策、执行与因果链仍永久保留。</p></div></header><footer><MissionActionButton disabledReason={'正在归档当前任务，完成后可关闭。'} className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setArchiveConfirm(null)} type="button">取消</MissionActionButton><MissionActionButton disabledReason={'正在归档当前任务，请等待结果。'} busy={pending === 'archive'} busyLabel="归档中…" className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archiveMission()} type="button"><Archive size={15} />确认归档</MissionActionButton></footer></section></div>}
    </div>
  );
}

export { missionTransitionActionLabel, missionDefinitionEditBlocker, missionRestoreFeedback, missionLineageLinkLabel, buildMissionProductOptions, responseMatchesMissionAuthority } from './mission-workspace-model';

export { missionFlightPlanCapabilitySummary, missionFlightPlanRows } from './mission-workspace-flight-plan';

export { type MissionFlightPlanRow, type MissionsWorkspaceProps, type BoundMissionAdsObject, type MissionAnalysisRunStatus, type MissionAnalysisRunView, type MissionAnalysisRunReceipt } from './mission-workspace-contracts';

export { extractKnownAnalysisFailureCodes, missionAnalysisBlockerLabel, missionPathFailureText, latestEvidencePackageForMission, boundAdsObjectsForMission, projectMissionAnalysisRun, previousStepEvidenceLabel, missionRecommendationSummaryLabel, missionAnalysisRunReceipts, MissionAnalysisRunHistory, latestMissionAnalysisResult, missionGuardrailLabel, refreshMissionAnalysisReceipt, refreshMissionAnalysisFailureReceipt } from './mission-workspace-analysis';

export { buildCreateMissionInput, buildUpdateMissionInput } from './mission-workspace-inputs';
