import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rendererRuntimeLog } from '../../runtime-log';
import { WorkspaceActionButton, createWorkspaceActionAdmission } from '../../components/workspace/action-feedback';
import {
  Archive,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Flask,
  NotePencil,
  Pause,
  PencilSimple,
  Play,
  Plus,
  X,
} from '@phosphor-icons/react';
import {
  missionControlContextKey,
  type CausalEventRecord,
  type CreateExperimentInput,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentObservationType,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import { selectEntityDeletePolicy } from '../../components/workspace/entity-delete-policy';
import {
  assertCausalEventBelongsToContext,
  assertExperimentBelongsToContext,
  assertMissionAuthorityContext,
  assertMissionBelongsToContext,
  readExperimentDomainWindowApi,
  readMissionDomainWindowApi,
  type AppendExperimentObservationInput,
  type ExperimentDomainRendererApi,
} from './mission-domain-window-api';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { PAGE_SIZE, OPERATOR, STATUS_LABELS, OBSERVATION_LABELS, ExperimentDraft, ExperimentEditorState, SelectorOption, MissionSelectorOption, AdObjectSelectorOption, ExperimentMissionOptionSource, ExperimentProductOptionSource, ExperimentAdObjectOptionSource, ExperimentSelectorOptions, PRIMARY_METRIC_OPTIONS, ObservationDraft, ExperimentsWorkspaceProps } from './experiment-workspace-contracts';
import { buildExperimentSelectorOptions, experimentMissionScope, bindExperimentDraftToMission, experimentDraftScopeError, experimentCausalEventsForSelection, message, operatorFacingBlocker, list, prettyJson, capabilityReady, ExperimentStatusTag, preferredExperimentId, experimentEvaluationFeedback, experimentRestoreFeedback, experimentEditAvailability, experimentResumeAvailability, experimentEvaluationErrorMessage } from './experiment-workspace-model';
import { parseJson, plusDays, timestamp, structuredGuardrailDraft, buildExperimentDraft, buildCreateExperimentInput, buildUpdateExperimentInput, buildEvaluateExperimentInput } from './experiment-workspace-inputs';
import { SearchableOptionSelect, ExperimentEditor, ObservationEditor } from './experiment-workspace-editors';
import './experiments-workspace.css';

export { buildExperimentSelectorOptions } from './experiment-workspace-model';
export { experimentMissionScope } from './experiment-workspace-model';
export { bindExperimentDraftToMission } from './experiment-workspace-model';
export { experimentDraftScopeError } from './experiment-workspace-model';
export { experimentCausalEventsForSelection } from './experiment-workspace-model';
export type { ExperimentsWorkspaceProps } from './experiment-workspace-contracts';
export { buildExperimentDraft } from './experiment-workspace-inputs';
export { buildCreateExperimentInput } from './experiment-workspace-inputs';
export { buildUpdateExperimentInput } from './experiment-workspace-inputs';
export { preferredExperimentId } from './experiment-workspace-model';
export { buildEvaluateExperimentInput } from './experiment-workspace-inputs';
export { experimentEvaluationFeedback } from './experiment-workspace-model';
export { experimentRestoreFeedback } from './experiment-workspace-model';
export { experimentEditAvailability } from './experiment-workspace-model';
export { experimentResumeAvailability } from './experiment-workspace-model';
export { experimentEvaluationErrorMessage } from './experiment-workspace-model';

export function ExperimentsWorkspace({
  apiOverride,
  blockedReason,
  capabilities,
  onInspectBoundary,
  previewMode,
  storeContext,
}: ExperimentsWorkspaceProps) {
  const api = useMemo(() => apiOverride ?? readExperimentDomainWindowApi(), [apiOverride]);
  const missionApi = useMemo(() => readMissionDomainWindowApi(), []);
  const expectedCapability = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const viewReady = capabilityReady(capabilities, 'experiments.experiment.view', previewMode);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : 'missing';
  const currentAuthorityKey = useRef(authorityKey);
  const authorityEpoch = useRef(0);
  const admission = useRef(createWorkspaceActionAdmission());
  const requestSequence = useRef(0);
  const mutationSequence = useRef(0);
  const detailSequence = useRef(0);
  const idSequence = useRef(0);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [causalEvents, setCausalEvents] = useState<CausalEventRecord[]>([]);
  const [observations, setObservations] = useState<ExperimentObservationRecord[]>([]);
  const [metricSnapshots, setMetricSnapshots] = useState<ExperimentMetricSnapshotRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'blocked' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<ExperimentEditorState | null>(null);
  const [observationEditor, setObservationEditor] = useState<ObservationDraft | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<ExperimentRecord | null>(null);
  const [selectorOptions, setSelectorOptions] = useState<ExperimentSelectorOptions>({ missions: [], products: [], adObjects: [], loading: false });

  if (currentAuthorityKey.current !== authorityKey) {
    authorityEpoch.current += 1;
    currentAuthorityKey.current = authorityKey;
  }
  admission.current.update(authorityKey);
  useEffect(() => () => { authorityEpoch.current += 1; }, []);
  const selected = experiments.find((item) => item.id === selectedId) ?? null;

  const actionReady = (capabilityId: string) => capabilityReady(capabilities, capabilityId, previewMode);
  const navigate = (target: unknown) => {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: target }));
  };

  const load = async () => {
    const sequence = ++requestSequence.current;
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    if (!storeContext || !viewReady) {
      setExperiments([]);
      setCausalEvents([]);
      setSelectedId('');
      setPhase('blocked');
      setError(!storeContext ? '尚未选择店铺，经营实验已失败关闭。' : blockedReason);
      return;
    }
    if (!api) {
      setPhase('blocked');
      setError('经营实验服务未接入；界面不会回退到示例数据。');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      assertMissionAuthorityContext(storeContext);
      const [records, events] = await Promise.all([
        api.listExperiments(storeContext, { includeArchived: true }),
        api.listCausalEvents(storeContext),
      ]);
      if (currentAuthorityKey.current !== capturedKey || authorityEpoch.current !== capturedEpoch || requestSequence.current !== sequence) return;
      records.forEach((record) => assertExperimentBelongsToContext(record, storeContext));
      events.forEach((event) => assertCausalEventBelongsToContext(event, storeContext));
      setExperiments(records);
      setCausalEvents(events);
      setSelectedId((current) => records.some((record) => record.id === current) ? current : preferredExperimentId(records));
      setPhase('ready');
    } catch (loadError) {
      rendererRuntimeLog.error('renderer.experiment_load_failed', { error: loadError });
      if (currentAuthorityKey.current !== capturedKey || authorityEpoch.current !== capturedEpoch || requestSequence.current !== sequence) return;
      setExperiments([]);
      setCausalEvents([]);
      setSelectedId('');
      setPhase('error');
      setError(message(loadError));
    }
  };

  useEffect(() => {
    setPending(null);
    setEditor(null);
    setObservationEditor(null);
    setArchiveConfirm(null);
    setPage(1);
    void load();
    // 店铺权限变化后清除本地选择与未完成操作状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authorityKey, viewReady]);

  useEffect(() => {
    if (!storeContext) { setSelectorOptions({ missions: [], products: [], adObjects: [], loading: false }); return; }
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    setSelectorOptions({ missions: [], products: [], adObjects: [], loading: true });
    const surface = (window as any).electronAPI as {
      listStoreProducts?: (context: StoreContextEnvelope, input: { includeArchived: boolean }) => Promise<ExperimentProductOptionSource[]>;
      listStoreAdObjects?: (context: StoreContextEnvelope, input: { kind: 'target' }) => Promise<ExperimentAdObjectOptionSource[]>;
    } | undefined;
    void Promise.all([
      missionApi?.listMissions(storeContext, { includeArchived: false }) ?? Promise.resolve([]),
      surface?.listStoreProducts?.(storeContext, { includeArchived: false }) ?? Promise.resolve([]),
      surface?.listStoreAdObjects?.(storeContext, { kind: 'target' }) ?? Promise.resolve([]),
    ]).then(([missionRows, productRows, adObjectRows]) => {
      if (currentAuthorityKey.current !== capturedKey || authorityEpoch.current !== capturedEpoch) return;
      missionRows.forEach((mission) => assertMissionBelongsToContext(mission, storeContext));
      if (productRows.some((product) => String(product.storeId) !== String(storeContext.storeId))
        || adObjectRows.some((item) => String(item.storeId) !== String(storeContext.storeId))) {
        throw new Error('对象选择器返回了不属于当前店铺的记录。');
      }
      setSelectorOptions({
        ...buildExperimentSelectorOptions(missionRows, productRows, adObjectRows),
        loading: false,
      });
    }).catch((selectorError) => {
      rendererRuntimeLog.error('renderer.experiment_selectors_failed', { error: selectorError });
      if (currentAuthorityKey.current === capturedKey && authorityEpoch.current === capturedEpoch) {
        setSelectorOptions({ missions: [], products: [], adObjects: [], loading: false });
        setError('当前店铺的运营任务、产品或广告对象读取失败，请刷新后重试。');
      }
    });
  }, [authorityKey, missionApi]);

  useEffect(() => {
    const sequence = ++detailSequence.current;
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    if (!api || !storeContext || !selected || !viewReady) {
      setObservations([]);
      setMetricSnapshots([]);
      return;
    }
    void Promise.all([
      api.listExperimentObservations(storeContext, selected.id),
      api.listExperimentMetricSnapshots(storeContext, selected.id),
    ]).then(([observationRows, metricRows]) => {
      if (currentAuthorityKey.current !== capturedKey || authorityEpoch.current !== capturedEpoch || detailSequence.current !== sequence) return;
      if (observationRows.some((record) => String(record.storeId) !== String(storeContext.storeId)
        || record.experimentId !== selected.id)
        || metricRows.some((record) => String(record.storeId) !== String(storeContext.storeId)
          || record.experimentId !== selected.id)) {
        throw new Error('Main 返回了不属于当前 Experiment 的详情记录。');
      }
      setObservations(observationRows);
      setMetricSnapshots(metricRows);
    }).catch((detailError) => {
      rendererRuntimeLog.error('renderer.experiment_details_failed', { error: detailError });
      if (currentAuthorityKey.current !== capturedKey || authorityEpoch.current !== capturedEpoch || detailSequence.current !== sequence) return;
      setObservations([]);
      setMetricSnapshots([]);
      setError(message(detailError));
    });
  }, [api, authorityKey, selected?.id, storeContext, viewReady]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return experiments.filter((record) => (includeArchived || record.status !== 'archived')
      && (!needle || [record.id, record.missionId, record.name, record.hypothesis, record.productId, record.adEntityId]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))));
  }, [experiments, includeArchived, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const observationIds = new Set(observations.map((record) => record.id));
  const metricIds = new Set(metricSnapshots.map((record) => record.id));
  const selectedEvents = experimentCausalEventsForSelection(
    causalEvents,
    selected?.id,
    observationIds,
    metricIds,
  );
  const correctionTargets = observations;
  const busy = pending !== null;
  const archiveFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: Boolean(archiveConfirm), onDismiss: () => setArchiveConfirm(null), dismissDisabled: busy,
  });
  const blocked = phase === 'blocked' || phase === 'error';

  const runMutation = async <T,>(
    label: string,
    operation: (activeApi: ExperimentDomainRendererApi, context: StoreContextEnvelope) => Promise<T>,
  ): Promise<T | undefined> => {
    if (!api || !storeContext || !viewReady || pending) {
      setError('经营实验写入服务不可用，操作已阻断。');
      return undefined;
    }
    const release = admission.current.tryEnter();
    if (!release) return undefined;
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const capturedEpoch = authorityEpoch.current;
    const sequence = ++mutationSequence.current;
    setPending(label);
    setError(null);
    setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (currentAuthorityKey.current !== capturedKey || authorityEpoch.current !== capturedEpoch || mutationSequence.current !== sequence) return undefined;
      return result;
    } catch (mutationError) {
      rendererRuntimeLog.error('renderer.experiment_operation_failed', { operation: label, error: mutationError });
      if (currentAuthorityKey.current === capturedKey && authorityEpoch.current === capturedEpoch && mutationSequence.current === sequence) {
        setError(label === 'evaluate' ? experimentEvaluationErrorMessage(mutationError) : message(mutationError));
      }
      return undefined;
    } finally {
      release();
      if (currentAuthorityKey.current === capturedKey && authorityEpoch.current === capturedEpoch && mutationSequence.current === sequence) setPending(null);
    }
  };

  const save = async () => {
    if (!editor || !storeContext) return;
    let input: CreateExperimentInput | UpdateExperimentInput;
    try {
      const scopeError = experimentDraftScopeError(editor.draft, selectorOptions);
      if (scopeError) throw new Error(scopeError);
      input = editor.record
        ? buildUpdateExperimentInput(editor.record, editor.draft)
        : buildCreateExperimentInput(editor.draft, `EXPERIMENT-${String(storeContext.storeId)}-${Date.now()}-${++idSequence.current}`);
    } catch (validationError) {
      rendererRuntimeLog.warn('renderer.experiment_validation_failed', { error: validationError });
      setError(message(validationError));
      return;
    }
    const saved = await runMutation('save', (activeApi, context) => editor.record
      ? activeApi.updateExperiment(context, input as UpdateExperimentInput)
      : activeApi.createExperiment(context, input as CreateExperimentInput));
    if (!saved) return;
    assertExperimentBelongsToContext(saved, storeContext);
    setExperiments((current) => current.some((item) => item.id === saved.id)
      ? current.map((item) => item.id === saved.id ? saved : item)
      : [saved, ...current]);
    setSelectedId(saved.id);
    setEditor(null);
    setFeedback(editor.record ? '经营实验已更新。' : '经营实验已创建，当前为待启动状态。');
    void load();
  };

  const transition = async (record: ExperimentRecord, status: Extract<ExperimentStatus, 'running' | 'paused'>, reason: string) => {
    const capabilityId = status === 'running'
      ? record.status === 'draft' ? 'experiments.experiment.start' : 'experiments.experiment.resume'
      : 'experiments.experiment.pause';
    if (!actionReady(capabilityId)) {
      setError(`缺少精确能力 ${capabilityId}，状态转换已阻断。`);
      return;
    }
    const saved = await runMutation(`transition:${status}`, (activeApi, context) => activeApi.transitionExperiment(context, {
      id: record.id, expectedRevision: record.revision, status, actorId: OPERATOR, reason,
    }));
    if (!saved) return;
    setExperiments((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback(status === 'running' ? '经营实验已进入观察窗。' : '经营实验已暂停；变量保持不变。');
    void load();
  };

  const evaluate = async (record: ExperimentRecord) => {
    if (!actionReady('experiments.experiment.complete')) {
      setError('当前店铺缺少经营实验判定能力，操作已阻断。');
      return;
    }
    const saved = await runMutation('evaluate', (activeApi, context) => activeApi.evaluateExperiment(
      context,
      buildEvaluateExperimentInput(record),
    ));
    if (!saved || !storeContext) return;
    assertExperimentBelongsToContext(saved, storeContext);
    setExperiments((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback(experimentEvaluationFeedback(saved));
    void load();
  };

  const archive = async () => {
    if (!archiveConfirm) return;
    const saved = await runMutation('archive', (activeApi, context) => activeApi.archiveExperiment(context, {
      id: archiveConfirm.id, expectedRevision: archiveConfirm.revision, actorId: OPERATOR,
    }));
    if (!saved) return;
    setArchiveConfirm(null);
    setExperiments((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback('经营实验已归档；实验记录与因果事件仍永久保留。');
  };

  const restore = async (record: ExperimentRecord) => {
    const saved = await runMutation('restore', (activeApi, context) => activeApi.restoreExperiment(context, {
      id: record.id, expectedRevision: record.revision, actorId: OPERATOR,
    }));
    if (!saved) return;
    setExperiments((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback(experimentRestoreFeedback(saved));
  };

  const appendObservation = async () => {
    if (!selected || !observationEditor) return;
    if (!observationEditor.title.trim() || !observationEditor.observation.trim()) {
      setError('观察标题与内容不能为空。');
      return;
    }
    if (observationEditor.observationType === 'correction' && !observationEditor.correctsRecordId) {
      setError('修正记录必须选择被修正的原记录。');
      return;
    }
    const input: AppendExperimentObservationInput = {
      id: `OBS-${selected.id}-${Date.now()}-${++idSequence.current}`,
      experimentId: selected.id,
      observationType: observationEditor.observationType,
      title: observationEditor.title.trim(),
      observation: observationEditor.observation.trim(),
      observedAt: new Date(observationEditor.observedAt).toISOString(),
      actorId: OPERATOR,
      ...(observationEditor.observationType === 'correction'
        ? { correctsRecordId: observationEditor.correctsRecordId }
        : {}),
    };
    const saved = await runMutation('observation', (activeApi, context) => activeApi.appendExperimentObservation(context, input));
    if (!saved) return;
    setObservationEditor(null);
    setFeedback(`已追加${OBSERVATION_LABELS[saved.observationType]}记录；既有记录未被覆盖。`);
    void load();
  };

  const openObservation = () => {
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    setObservationEditor({ observationType: 'observation', title: '', observation: '', observedAt: local, correctsRecordId: '' });
  };

  const optionLabel = (options: readonly SelectorOption[], value: string | undefined, fallback: string) => (
    options.find((option) => option.value === value)?.label ?? fallback
  );
  const selectedMissionLabel = optionLabel(selectorOptions.missions, selected?.missionId, '关联运营任务不可用');
  const selectedProductLabel = selected?.productId
    ? optionLabel(selectorOptions.products, selected.productId, '关联产品不可用')
    : '店铺级';
  const selectedAdObjectLabel = selected?.adEntityId
    ? optionLabel(selectorOptions.adObjects, selected.adEntityId, '关联广告对象不可用')
    : '未绑定广告对象';
  const editAvailability = selected ? experimentEditAvailability(selected.status) : { enabled: false as const, reason: '请先选择实验。' };
  const resumeAvailability = selected ? experimentResumeAvailability(selected) : { enabled: false as const, reason: '请先选择实验。' };
  const visibleBlockedReason = operatorFacingBlocker(error ?? blockedReason, '经营实验');
  const actionReason = (capabilityId?: string, detail?: string) => !storeContext
    ? '请先在系统设置中选择当前店铺。' : !api
      ? '经营实验服务尚未接入，请重新打开应用后重试。' : busy
        ? '当前操作尚未结束，请等待完成后重试。' : capabilityId && !actionReady(capabilityId)
          ? '当前店铺尚未接入此操作，请先检查系统设置中的连接与权限。'
          : detail ?? '请核对当前实验状态后重试。';

  return (
    <div className="mission-control-workspace-root experiments-workspace" data-canonical-surface="experiments" data-capability-state={viewReady ? expectedCapability : 'BLOCKED'} data-preview-mode={previewMode || undefined}>
      <i data-legacy-test-copy="Amazon US / USD · 新建 Experiment" hidden />
      <PageFrame
        className="experiments-page"
        description={selected
          ? `${selectedMissionLabel} · ${selectedProductLabel} · ${selectedAdObjectLabel}`
          : '把每次经营干预记录成可证伪假设、单一变量、观察窗口和追加式结果。'}
        pageId="experiments-ledger"
        title="经营实验"
        task={<TaskBanner compact description={selected?.hypothesis ?? '先定义基线、唯一变量和守护栏，再启动观察；实验记录只追加修正，不覆盖历史。'} eyebrow={selected ? '当前经营实验' : '可验证经营干预'} primaryAction={{ actionId: 'experiments.experiment.create', disabled: !actionReady('experiments.experiment.create') || busy || !storeContext, disabledReason: visibleBlockedReason, label: '新建经营实验', onClick: () => storeContext && setEditor({ record: null, draft: buildExperimentDraft(storeContext) }) }} secondaryActions={onInspectBoundary ? [{ actionId: 'experiment-boundary', label: '接入边界', onClick: onInspectBoundary }] : []} status={<span className="experiment-authority" data-state={viewReady ? expectedCapability : 'BLOCKED'}>{viewReady ? previewMode ? '仅开发预览 · 美国站 / USD' : '本机数据 · 美国站 / USD' : '已阻断'}</span>} title={selected?.name ?? '经营实验'} tone={blocked ? 'blocked' : 'neutral'}>{previewMode && <p className="experiment-preview-note">预览数据 · 不写入真实广告</p>}</TaskBanner>}
        summary={<SummaryStrip ariaLabel="经营实验当前权威上下文" items={[
          { id: 'hypothesis', label: '假设 H1', value: selected?.hypothesis ?? '等待选择实验' },
          { id: 'metric', label: '主指标 / 状态', value: selected ? `${selected.primaryMetric} · ${STATUS_LABELS[selected.status]}` : '—' },
          { id: 'window', label: '观察窗口', value: selected ? `${selected.observationStartsAt.slice(0, 10)} → ${selected.observationEndsAt.slice(0, 10)}` : '—' },
          { id: 'ledger', label: '当前店铺因果记录', value: `${causalEvents.length} 条`, tone: api && viewReady ? 'neutral' : 'blocked' },
        ]} />}
      >
        <div className="experiments-layout">
          <WorkbenchPanel className="experiments-queue" description="当前店铺 · 已归档记录默认隐藏" footer={filtered.length ? `第 ${safePage}/${pageCount} 页 · ${filtered.length} 条匹配记录` : '当前筛选没有实验。'} status={<span>{experiments.filter((item) => item.status === 'running').length} 个观察中</span>} title="实验队列">
            <div className="experiments-queue-tools"><input aria-label="搜索经营实验" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索假设、运营任务或产品" value={search} /><label><input checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} type="checkbox" />查看已归档</label></div>
            {phase === 'loading' && <WorkspaceState description="正在读取当前店铺实验台账。" kind="loading" title="读取经营实验" />}
            {blocked && <WorkspaceState description="生产模式不会使用界面临时实验数据。" details={visibleBlockedReason} kind="blocked" title="经营实验已失败关闭" />}
            {phase === 'ready' && !pageRows.length && <WorkspaceState description="新建实验后先进入待启动状态，再显式启动观察。" kind="empty" title="当前店铺没有经营实验" />}
            {phase === 'ready' && Boolean(pageRows.length) && <ul aria-label="经营实验列表" className="experiments-queue-list">{pageRows.map((record) => <li key={record.id}><button aria-pressed={record.id === selected?.id} data-selected={record.id === selected?.id || undefined} onClick={() => setSelectedId(record.id)} type="button"><span><b>{record.primaryMetric}</b><ExperimentStatusTag status={record.status} /></span><strong>{record.name}</strong><small>{optionLabel(selectorOptions.missions, record.missionId, '关联运营任务不可用')}</small></button></li>)}</ul>}
            <nav aria-label="经营实验分页" className="experiments-pagination"><WorkspaceActionButton disabledReason={actionReason(undefined, '已经是第一页。')} busy={false} busyLabel="处理中…" aria-label="上一页经营实验" className="workspace-button workspace-button--secondary" disabled={safePage <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><CaretLeft size={15} /></WorkspaceActionButton><span>{safePage} / {pageCount}</span><WorkspaceActionButton disabledReason={actionReason(undefined, '已经是最后一页。')} busy={false} busyLabel="处理中…" aria-label="下一页经营实验" className="workspace-button workspace-button--secondary" disabled={safePage >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><CaretRight size={15} /></WorkspaceActionButton></nav>
          </WorkbenchPanel>

          <section className="experiment-detail" aria-label="经营实验详情">
            {selected ? <>
              <section className="experiment-detail-header"><div className="experiment-detail-context"><span>当前经营实验</span><strong>{selected.primaryMetric}</strong><ExperimentStatusTag status={selected.status} /></div><div className="experiment-actions" role="group" aria-label="经营实验增删改查与状态动作">
                <WorkspaceActionButton disabledReason={actionReason("experiments.experiment.update", editAvailability.enabled ? undefined : editAvailability.reason)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" disabled={!actionReady('experiments.experiment.update') || busy || !editAvailability.enabled} onClick={() => storeContext && setEditor({ record: selected, draft: bindExperimentDraftToMission(buildExperimentDraft(storeContext, selected), selected.missionId, selectorOptions) })} title={editAvailability.enabled ? undefined : editAvailability.reason} type="button"><PencilSimple size={15} />编辑</WorkspaceActionButton>
                {selected.status === 'draft' && <WorkspaceActionButton disabledReason={actionReason("experiments.experiment.start")} busy={pending === 'transition:running'} busyLabel="启动中…" className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.start') || busy} onClick={() => void transition(selected, 'running', '运营者启动实验观察窗')} type="button"><Play size={15} />启动实验</WorkspaceActionButton>}
                {selected.status === 'running' && <WorkspaceActionButton disabledReason={actionReason("experiments.experiment.pause")} busy={pending === 'transition:paused'} busyLabel="暂停中…" className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.pause') || busy} onClick={() => void transition(selected, 'paused', '运营者暂停实验')} type="button"><Pause size={15} />暂停</WorkspaceActionButton>}
                {selected.status === 'paused' && <WorkspaceActionButton disabledReason={actionReason("experiments.experiment.resume", resumeAvailability.enabled ? undefined : resumeAvailability.reason)} busy={pending === 'transition:running'} busyLabel="恢复中…" className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.resume') || busy || !resumeAvailability.enabled} onClick={() => void transition(selected, 'running', '运营者恢复实验')} title={resumeAvailability.enabled ? undefined : resumeAvailability.reason} type="button"><Play size={15} />恢复</WorkspaceActionButton>}
                {['running', 'paused'].includes(selected.status) && <WorkspaceActionButton disabledReason={actionReason("experiments.experiment.complete")} busy={pending === 'evaluate'} busyLabel="判定中…"  className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.complete') || busy} onClick={() => void evaluate(selected)} type="button"><CheckCircle size={15} />{pending === 'evaluate' ? '判定中...' : '检查并判定'}</WorkspaceActionButton>}
                {selected.status !== 'archived' && <WorkspaceActionButton disabledReason={actionReason("experiments.experiment.archive", '观察中的实验不能归档，请先暂停或等待系统判定。')} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.archive') || busy || selected.status === 'running'} onClick={() => setArchiveConfirm(selected)} type="button"><Archive size={15} />归档</WorkspaceActionButton>}
                {selected.status === 'archived' && <WorkspaceActionButton disabledReason={actionReason("experiments.experiment.restore")} busy={pending === 'restore'} busyLabel="恢复中…" className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.restore') || busy} onClick={() => void restore(selected)} type="button"><ArrowClockwise size={15} />恢复</WorkspaceActionButton>}
              </div></section>
              <dl className="experiment-contract"><div><dt>运营任务</dt><dd>{selectedMissionLabel}</dd></div><div><dt>产品 / 广告对象</dt><dd>{selectedProductLabel} · {selectedAdObjectLabel}</dd></div><div><dt>观察窗口</dt><dd>{selected.observationStartsAt.slice(0, 10)} → {selected.observationEndsAt.slice(0, 10)}</dd></div><div><dt>主指标</dt><dd>{selected.primaryMetric}</dd></div></dl>
              <details className="experiment-diagnostics"><summary>诊断详情</summary><code>experimentId={selected.id}</code><code>missionId={selected.missionId}</code><code>productId={selected.productId || 'none'}</code><code>adEntityId={selected.adEntityId || 'none'}</code><code>revision={selected.revision}</code></details>
              <section className="experiment-ledger"><header><div><h3>观察与因果记录</h3><p>当前实验的观察由只读查询精确归属；修正记录不会猜测其他运营任务的记录。</p></div><WorkspaceActionButton disabledReason={actionReason("experiments.observation.create", '已归档实验不能追加观察，请先恢复实验。')} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" disabled={!actionReady('experiments.observation.create') || busy || selected.status === 'archived'} onClick={openObservation} type="button"><NotePencil size={15} />追加观察</WorkspaceActionButton></header>{selectedEvents.length ? <div className="experiment-ledger-list" role="list">{selectedEvents.map((event) => <article data-stage={event.stage} key={event.id} role="listitem"><span>{event.stage === 'FACT' ? '事实' : event.stage === 'EFFECT' ? '效果' : '分析'}</span><div><strong>{event.title}</strong><p>{event.signal || event.observedEffect || event.intervention || '结构化事件已记录'}</p><small>{event.createdAt.slice(0, 16).replace('T', ' ')}</small><details className="experiment-diagnostics"><summary>诊断详情</summary><code>sequence={event.sequence}</code><code>source={event.source}</code></details></div></article>)}</div> : <WorkspaceState description="追加第一条基线或观察记录；原记录不会被覆盖。" kind="empty" title="暂无实验因果记录" />}</section>
              <div className="experiment-evidence-grid">
                <section><header><div><h3>变量合同</h3><p>基线与唯一变量已结构化保存。</p></div><Flask size={19} /></header><details className="experiment-diagnostics"><summary>诊断详情</summary><div className="experiment-variables"><article><span>基线结构</span><pre>{prettyJson(selected.baseline)}</pre></article><article><span>唯一变量结构</span><pre>{prettyJson(selected.variant)}</pre></article></div></details></section>
                <section><header><div><h3>守护栏</h3><p>触发后暂停并转人工复核。</p></div><CheckCircle size={19} /></header><ul>{selected.guardrailCriteria.map((criterion, index) => <li key={`${criterion}-${index}`}><b>{selected.guardrailMetrics[index] ?? `守护指标 ${index + 1}`}</b><span>{criterion}</span></li>)}</ul></section>
              </div>
              {metricSnapshots.length > 0 && <section className="experiment-metrics"><header><div><h3>只读指标快照</h3><p>由系统绑定已完成数据批次写入；界面无追加权限。</p></div><span>{metricSnapshots.length} 个快照</span></header><div>{metricSnapshots.map((snapshot) => <article key={snapshot.id}><span>{snapshot.metric}</span><strong>{snapshot.currency === 'USD' ? '$' : ''}{snapshot.value.toLocaleString()}</strong><small>{snapshot.observedAt.slice(0, 10)}</small><details className="experiment-diagnostics"><summary>诊断详情</summary><code>dataBatchId={snapshot.dataBatchId}</code></details></article>)}</div></section>}
              {selected.conclusion && <section className="experiment-conclusion"><span>实验结论</span><p>{selected.conclusion}</p></section>}
              <p className="experiment-no-delete">{selectEntityDeletePolicy('experiment').reason}</p>
            </> : phase === 'ready' ? <WorkspaceState description="从左侧选择经营实验，或新建当前店铺的第一个实验。" kind="empty" title="等待选择经营实验" /> : null}
          </section>
        </div>
        {(error || feedback) && <p aria-live="polite" className="experiment-feedback" data-tone={error ? 'error' : 'success'}>{error ? operatorFacingBlocker(error, '经营实验') : feedback}</p>}
        {!previewMode && (!viewReady || error) && <details className="experiment-diagnostics"><summary>诊断详情</summary><code>{error ?? blockedReason}</code></details>}
      </PageFrame>

      {editor && <ExperimentEditor busy={pending === 'save'} editor={editor} onCancel={() => setEditor(null)} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onNavigate={navigate} onSave={() => void save()} options={selectorOptions} />}
      {observationEditor && <ObservationEditor busy={pending === 'observation'} correctionTargets={correctionTargets} draft={observationEditor} onCancel={() => setObservationEditor(null)} onChange={setObservationEditor} onSave={() => void appendObservation()} />}
      {archiveConfirm && <div className="mission-control-dialog-backdrop" ref={archiveFocus.overlayRootRef}><section aria-labelledby="experiment-archive-title" ref={archiveFocus.surfaceRef} tabIndex={-1} aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>归档经营实验</span><h2 id="experiment-archive-title">归档“{archiveConfirm.name}”？</h2><p>实验退出默认队列，但所有观察、修正和因果事件继续保留。</p></div></header><footer><WorkspaceActionButton disabledReason={actionReason(undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setArchiveConfirm(null)} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={actionReason(undefined)} busy={pending === 'archive'} busyLabel="归档中…" className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archive()} type="button">确认归档</WorkspaceActionButton></footer></section></div>}
    </div>
  );
}
