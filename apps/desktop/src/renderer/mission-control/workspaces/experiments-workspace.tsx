import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  StopCircle,
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
import {
  assertCausalEventBelongsToContext,
  assertExperimentBelongsToContext,
  assertMissionAuthorityContext,
  readExperimentDomainWindowApi,
  type AppendExperimentObservationInput,
  type ExperimentDomainRendererApi,
} from './mission-domain-window-api';
import './experiments-workspace.css';

const PAGE_SIZE = 6;
const OPERATOR = 'desktop-operator';

const STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: '草稿',
  running: '观察中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

const OBSERVATION_LABELS: Record<ExperimentObservationType, string> = {
  baseline: '基线',
  observation: '观察',
  result: '结果',
  correction: '修正',
};

type ExperimentDraft = {
  missionId: string;
  name: string;
  hypothesis: string;
  primaryMetric: string;
  guardrailMetrics: string;
  guardrailCriteria: string;
  productId: string;
  adEntityId: string;
  baselineJson: string;
  variantJson: string;
  observationStartsOn: string;
  observationEndsOn: string;
  conclusion: string;
};

type ExperimentEditorState = { record: ExperimentRecord | null; draft: ExperimentDraft };

type ObservationDraft = {
  observationType: ExperimentObservationType;
  title: string;
  observation: string;
  observedAt: string;
  correctsRecordId: string;
};

export type ExperimentsWorkspaceProps = {
  apiOverride?: ExperimentDomainRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
};

function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Experiment 操作未完成，请刷新当前店铺后重试。';
}

function list(value: string): string[] {
  return value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} 必须是合法 JSON。`);
  }
}

function plusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function timestamp(date: string): string {
  return `${date}T07:00:00.000Z`;
}

function draftFor(context: StoreContextEnvelope, record?: ExperimentRecord | null): ExperimentDraft {
  return {
    missionId: record?.missionId ?? '',
    name: record?.name ?? '',
    hypothesis: record?.hypothesis ?? '',
    primaryMetric: record?.primaryMetric ?? 'ACOS',
    guardrailMetrics: record?.guardrailMetrics.join('；') ?? '广告订单；CVR；花费',
    guardrailCriteria: record?.guardrailCriteria.join('；') ?? '广告订单下降 < 15%；CVR 不低于基线 90%',
    productId: record?.productId ?? '',
    adEntityId: record?.adEntityId ?? '',
    baselineJson: prettyJson(record?.baseline ?? { bidUsd: 1.2, windowDays: 7 }),
    variantJson: prettyJson(record?.variant ?? { bidUsd: 1.06, onlyVariable: 'keyword_bid' }),
    observationStartsOn: record?.observationStartsAt.slice(0, 10) ?? context.businessDate,
    observationEndsOn: record?.observationEndsAt.slice(0, 10) ?? plusDays(context.businessDate, 7),
    conclusion: record?.conclusion ?? '',
  };
}

export function buildCreateExperimentInput(draft: ExperimentDraft, id: string): CreateExperimentInput {
  const guardrailMetrics = list(draft.guardrailMetrics);
  const guardrailCriteria = list(draft.guardrailCriteria);
  if (!draft.missionId.trim() || !draft.name.trim() || !draft.hypothesis.trim()) {
    throw new Error('请绑定 Mission，并填写实验名称与可证伪假设。');
  }
  if (!draft.primaryMetric.trim() || !guardrailMetrics.length || !guardrailCriteria.length) {
    throw new Error('请填写主指标、守护指标与守护标准。');
  }
  if (draft.observationStartsOn >= draft.observationEndsOn) {
    throw new Error('观察窗口结束日期必须晚于开始日期。');
  }
  return {
    id,
    missionId: draft.missionId.trim(),
    name: draft.name.trim(),
    hypothesis: draft.hypothesis.trim(),
    primaryMetric: draft.primaryMetric.trim(),
    guardrailMetrics,
    guardrailCriteria,
    ...(draft.productId.trim() ? { productId: draft.productId.trim() } : {}),
    ...(draft.adEntityId.trim() ? { adEntityId: draft.adEntityId.trim() } : {}),
    baseline: parseJson(draft.baselineJson, '基线'),
    variant: parseJson(draft.variantJson, '实验变量'),
    observationStartsAt: timestamp(draft.observationStartsOn),
    observationEndsAt: timestamp(draft.observationEndsOn),
  };
}

export function buildUpdateExperimentInput(record: ExperimentRecord, draft: ExperimentDraft): UpdateExperimentInput {
  const create = buildCreateExperimentInput(draft, record.id);
  return {
    id: record.id,
    expectedRevision: record.revision,
    actorId: OPERATOR,
    patch: {
      name: create.name,
      hypothesis: create.hypothesis,
      primaryMetric: create.primaryMetric,
      guardrailMetrics: create.guardrailMetrics,
      guardrailCriteria: create.guardrailCriteria,
      productId: create.productId ?? null,
      adEntityId: create.adEntityId ?? null,
      baseline: create.baseline,
      variant: create.variant,
      observationStartsAt: create.observationStartsAt,
      observationEndsAt: create.observationEndsAt,
      conclusion: draft.conclusion.trim() || null,
    },
  };
}

function capabilityReady(
  rows: readonly MissionControlCapabilityProjection[] | undefined,
  capabilityId: string,
  previewMode: boolean,
): boolean {
  const projection = rows?.find((item) => item.capabilityId === capabilityId);
  return projection?.state === (previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE');
}

function ExperimentStatusTag({ status }: { status: ExperimentStatus }) {
  return <span className="experiment-status" data-status={status}>{STATUS_LABELS[status]}</span>;
}

export function preferredExperimentId(records: readonly Pick<ExperimentRecord, 'id' | 'status'>[]): string {
  return records.find((record) => record.status === 'running')?.id
    ?? records.find((record) => record.status !== 'archived')?.id
    ?? records[0]?.id
    ?? '';
}

function ExperimentEditor({
  busy,
  editor,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  editor: ExperimentEditorState;
  onCancel: () => void;
  onChange: (draft: ExperimentDraft) => void;
  onSave: () => void;
}) {
  const change = <K extends keyof ExperimentDraft>(key: K, value: ExperimentDraft[K]) => {
    onChange({ ...editor.draft, [key]: value });
  };
  return (
    <div className="mission-control-dialog-backdrop">
      <section aria-labelledby="experiment-editor-title" aria-modal="true" className="mission-control-dialog experiment-editor" role="dialog">
        <header>
          <div><span>CAUSAL EXPERIMENT · AMAZON US / USD</span><h2 id="experiment-editor-title">{editor.record ? '编辑 Experiment' : '新建 Experiment'}</h2><p>一次实验只允许一个主要变量，并使用 revision 防止覆盖并发修改。</p></div>
          <button aria-label="关闭实验编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></button>
        </header>
        <div className="experiment-form">
          <label><span>Mission ID *</span><input disabled={Boolean(editor.record)} onChange={(event) => change('missionId', event.target.value)} placeholder="MISSION-..." value={editor.draft.missionId} /></label>
          <label><span>主指标 *</span><input onChange={(event) => change('primaryMetric', event.target.value)} placeholder="ACOS" value={editor.draft.primaryMetric} /></label>
          <label className="experiment-form__wide"><span>实验名称 *</span><input autoFocus onChange={(event) => change('name', event.target.value)} placeholder="例如：核心词竞价 -12% 小步实验" value={editor.draft.name} /></label>
          <label className="experiment-form__wide"><span>可证伪假设 *</span><textarea onChange={(event) => change('hypothesis', event.target.value)} rows={3} value={editor.draft.hypothesis} /></label>
          <label><span>产品 ID</span><input onChange={(event) => change('productId', event.target.value)} placeholder="ASIN / SKU" value={editor.draft.productId} /></label>
          <label><span>广告实体 ID</span><input onChange={(event) => change('adEntityId', event.target.value)} placeholder="Keyword ID" value={editor.draft.adEntityId} /></label>
          <label><span>开始日期 *</span><input onChange={(event) => change('observationStartsOn', event.target.value)} type="date" value={editor.draft.observationStartsOn} /></label>
          <label><span>结束日期 *</span><input onChange={(event) => change('observationEndsOn', event.target.value)} type="date" value={editor.draft.observationEndsOn} /></label>
          <label className="experiment-form__wide"><span>守护指标 *</span><input onChange={(event) => change('guardrailMetrics', event.target.value)} value={editor.draft.guardrailMetrics} /></label>
          <label className="experiment-form__wide"><span>守护标准 *</span><input onChange={(event) => change('guardrailCriteria', event.target.value)} value={editor.draft.guardrailCriteria} /></label>
          <label><span>基线 JSON *</span><textarea className="experiment-json" onChange={(event) => change('baselineJson', event.target.value)} rows={6} value={editor.draft.baselineJson} /></label>
          <label><span>唯一变量 JSON *</span><textarea className="experiment-json" onChange={(event) => change('variantJson', event.target.value)} rows={6} value={editor.draft.variantJson} /></label>
          {editor.record && <label className="experiment-form__wide"><span>实验结论</span><textarea onChange={(event) => change('conclusion', event.target.value)} rows={3} value={editor.draft.conclusion} /></label>}
        </div>
        <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中...' : '保存 Experiment'}</button></footer>
      </section>
    </div>
  );
}

function ObservationEditor({
  busy,
  correctionTargets,
  draft,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  correctionTargets: readonly ExperimentObservationRecord[];
  draft: ObservationDraft;
  onCancel: () => void;
  onChange: (draft: ObservationDraft) => void;
  onSave: () => void;
}) {
  const change = <K extends keyof ObservationDraft>(key: K, value: ObservationDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="mission-control-dialog-backdrop">
      <section aria-labelledby="observation-editor-title" aria-modal="true" className="mission-control-dialog experiment-observation-editor" role="dialog">
        <header><div><span>APPEND-ONLY RECORD</span><h2 id="observation-editor-title">追加实验观察</h2><p>既有记录不可覆盖；错误内容必须追加 correction 并指向原记录。</p></div><button aria-label="关闭观察编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></button></header>
        <div className="experiment-form">
          <label><span>记录类型 *</span><select onChange={(event) => change('observationType', event.target.value as ExperimentObservationType)} value={draft.observationType}>{(Object.keys(OBSERVATION_LABELS) as ExperimentObservationType[]).map((type) => <option key={type} value={type}>{OBSERVATION_LABELS[type]}</option>)}</select></label>
          <label><span>观察时间 *</span><input onChange={(event) => change('observedAt', event.target.value)} type="datetime-local" value={draft.observedAt} /></label>
          {draft.observationType === 'correction' && <label className="experiment-form__wide"><span>被修正记录 *</span><select onChange={(event) => change('correctsRecordId', event.target.value)} value={draft.correctsRecordId}><option value="">请选择原记录</option>{correctionTargets.map((record) => <option key={record.id} value={record.id}>{record.id} · {record.title}</option>)}</select></label>}
          <label className="experiment-form__wide"><span>标题 *</span><input autoFocus onChange={(event) => change('title', event.target.value)} value={draft.title} /></label>
          <label className="experiment-form__wide"><span>观察内容 *</span><textarea onChange={(event) => change('observation', event.target.value)} rows={5} value={draft.observation} /></label>
        </div>
        <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '追加中...' : '追加到因果链'}</button></footer>
      </section>
    </div>
  );
}

export function ExperimentsWorkspace({
  apiOverride,
  blockedReason,
  capabilities,
  onInspectBoundary,
  previewMode,
  storeContext,
}: ExperimentsWorkspaceProps) {
  const api = useMemo(() => apiOverride ?? readExperimentDomainWindowApi(), [apiOverride]);
  const expectedCapability = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const viewReady = capabilityReady(capabilities, 'experiments.experiment.view', previewMode);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : 'missing';
  const currentAuthorityKey = useRef(authorityKey);
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
  const [completeConfirm, setCompleteConfirm] = useState<ExperimentRecord | null>(null);
  const [completion, setCompletion] = useState('');

  currentAuthorityKey.current = authorityKey;
  const selected = experiments.find((item) => item.id === selectedId) ?? null;

  const actionReady = (capabilityId: string) => capabilityReady(capabilities, capabilityId, previewMode);

  const load = async () => {
    const sequence = ++requestSequence.current;
    const capturedKey = authorityKey;
    if (!storeContext || !viewReady) {
      setExperiments([]);
      setCausalEvents([]);
      setSelectedId('');
      setPhase('blocked');
      setError(!storeContext ? 'StoreContext 尚未建立，Experiment 已失败关闭。' : blockedReason);
      return;
    }
    if (!api) {
      setPhase('blocked');
      setError('Experiment production window API 未接入；Renderer 不会回退到示例数据。');
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
      if (currentAuthorityKey.current !== capturedKey || requestSequence.current !== sequence) return;
      records.forEach((record) => assertExperimentBelongsToContext(record, storeContext));
      events.forEach((event) => assertCausalEventBelongsToContext(event, storeContext));
      setExperiments(records);
      setCausalEvents(events);
      setSelectedId((current) => records.some((record) => record.id === current) ? current : preferredExperimentId(records));
      setPhase('ready');
    } catch (loadError) {
      if (currentAuthorityKey.current !== capturedKey || requestSequence.current !== sequence) return;
      setExperiments([]);
      setCausalEvents([]);
      setSelectedId('');
      setPhase('error');
      setError(message(loadError));
    }
  };

  useEffect(() => {
    setEditor(null);
    setObservationEditor(null);
    setArchiveConfirm(null);
    setCompleteConfirm(null);
    setPage(1);
    void load();
    // Authority changes intentionally reset all local selection and dialogs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authorityKey, viewReady]);

  useEffect(() => {
    const sequence = ++detailSequence.current;
    const capturedKey = authorityKey;
    if (!api || !storeContext || !selected || !viewReady) {
      setObservations([]);
      setMetricSnapshots([]);
      return;
    }
    void Promise.all([
      api.listExperimentObservations(storeContext, selected.id),
      api.listExperimentMetricSnapshots(storeContext, selected.id),
    ]).then(([observationRows, metricRows]) => {
      if (currentAuthorityKey.current !== capturedKey || detailSequence.current !== sequence) return;
      if (observationRows.some((record) => String(record.storeId) !== String(storeContext.storeId)
        || record.experimentId !== selected.id)
        || metricRows.some((record) => String(record.storeId) !== String(storeContext.storeId)
          || record.experimentId !== selected.id)) {
        throw new Error('Main 返回了不属于当前 Experiment 的详情记录。');
      }
      setObservations(observationRows);
      setMetricSnapshots(metricRows);
    }).catch((detailError) => {
      if (currentAuthorityKey.current !== capturedKey || detailSequence.current !== sequence) return;
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
  const selectedEvents = causalEvents.filter((event) => event.entityId === selected?.id
    || (event.entityType === 'experiment_record' && observationIds.has(event.entityId))
    || (event.entityType === 'experiment_metric' && metricIds.has(event.entityId)));
  const correctionTargets = observations;
  const busy = pending !== null;
  const blocked = phase === 'blocked' || phase === 'error';

  const runMutation = async <T,>(
    label: string,
    operation: (activeApi: ExperimentDomainRendererApi, context: StoreContextEnvelope) => Promise<T>,
  ): Promise<T | undefined> => {
    if (!api || !storeContext || !viewReady || pending) {
      setError('Experiment 写入 Authority 不可用，操作已阻断。');
      return undefined;
    }
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const sequence = ++mutationSequence.current;
    setPending(label);
    setError(null);
    setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (currentAuthorityKey.current !== capturedKey || mutationSequence.current !== sequence) return undefined;
      return result;
    } catch (mutationError) {
      if (currentAuthorityKey.current === capturedKey && mutationSequence.current === sequence) setError(message(mutationError));
      return undefined;
    } finally {
      if (currentAuthorityKey.current === capturedKey && mutationSequence.current === sequence) setPending(null);
    }
  };

  const save = async () => {
    if (!editor || !storeContext) return;
    let input: CreateExperimentInput | UpdateExperimentInput;
    try {
      input = editor.record
        ? buildUpdateExperimentInput(editor.record, editor.draft)
        : buildCreateExperimentInput(editor.draft, `EXPERIMENT-${String(storeContext.storeId)}-${Date.now()}-${++idSequence.current}`);
    } catch (validationError) {
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
    setFeedback(editor.record ? 'Experiment 已按 revision 更新。' : 'Experiment 已创建为草稿。');
    void load();
  };

  const transition = async (record: ExperimentRecord, status: Exclude<ExperimentStatus, 'archived'>, reason: string) => {
    const capabilityId = status === 'running'
      ? record.status === 'draft' ? 'experiments.experiment.start' : 'experiments.experiment.resume'
      : status === 'paused' ? 'experiments.experiment.pause' : 'experiments.experiment.complete';
    if (!actionReady(capabilityId)) {
      setError(`缺少精确能力 ${capabilityId}，状态转换已阻断。`);
      return;
    }
    const saved = await runMutation(`transition:${status}`, (activeApi, context) => activeApi.transitionExperiment(context, {
      id: record.id, expectedRevision: record.revision, status, actorId: OPERATOR, reason,
    }));
    if (!saved) return;
    setExperiments((current) => current.map((item) => item.id === saved.id ? saved : item));
    setCompleteConfirm(null);
    setCompletion('');
    setFeedback(status === 'running' ? 'Experiment 已进入观察窗。' : status === 'paused' ? 'Experiment 已暂停；变量保持不变。' : 'Experiment 已完成并追加 EFFECT。');
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
    setFeedback('Experiment 已归档；实验记录与因果事件仍永久保留。');
  };

  const restore = async (record: ExperimentRecord) => {
    const saved = await runMutation('restore', (activeApi, context) => activeApi.restoreExperiment(context, {
      id: record.id, expectedRevision: record.revision, actorId: OPERATOR,
    }));
    if (!saved) return;
    setExperiments((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback('Experiment 已恢复为暂停状态。');
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

  return (
    <div className="mission-control-workspace-root experiments-workspace" data-canonical-surface="experiments" data-capability-state={viewReady ? expectedCapability : 'BLOCKED'} data-preview-mode={previewMode || undefined}>
      <PageFrame
        className="experiments-page"
        description={selected
          ? `${selected.missionId} · ${selected.productId || '店铺级'} · ${selected.adEntityId || '未绑定广告对象'}`
          : '把每次经营干预记录成可证伪假设、单一变量、观察窗口和追加式结果。'}
        pageId="experiments-ledger"
        title="经营实验"
        task={<TaskBanner compact description={selected?.hypothesis ?? '先定义基线、唯一变量和守护栏，再启动观察；实验记录只追加修正，不覆盖历史。'} eyebrow={selected ? `EXPERIMENT · ${selected.id}` : 'CAUSAL EXPERIMENT'} primaryAction={{ actionId: 'experiments.experiment.create', disabled: !actionReady('experiments.experiment.create') || busy || !storeContext, disabledReason: blockedReason, label: '新建 Experiment', onClick: () => storeContext && setEditor({ record: null, draft: draftFor(storeContext) }) }} secondaryActions={onInspectBoundary ? [{ actionId: 'experiment-boundary', label: '接入边界', onClick: onInspectBoundary }] : []} status={<span className="experiment-authority" data-state={viewReady ? expectedCapability : 'BLOCKED'}>{viewReady ? previewMode ? '显式开发预览 · Amazon US / USD' : 'Main / SQLite · Amazon US / USD' : '已阻断'}</span>} title={selected?.name ?? '经营实验'} tone={blocked ? 'blocked' : 'neutral'}>{previewMode && <p className="experiment-preview-note">内存 adapter · 不写入真实广告</p>}</TaskBanner>}
        summary={<SummaryStrip ariaLabel="经营实验当前权威上下文" items={[
          { id: 'hypothesis', label: '假设 H1', value: selected?.hypothesis ?? '等待选择实验' },
          { id: 'metric', label: '主指标 / 状态', value: selected ? `${selected.primaryMetric} · ${STATUS_LABELS[selected.status]}` : '—' },
          { id: 'window', label: '观察窗口', value: selected ? `${selected.observationStartsAt.slice(0, 10)} → ${selected.observationEndsAt.slice(0, 10)}` : '—' },
          { id: 'ledger', label: '店铺因果记录', value: `${causalEvents.length} 条 · ${storeContext ? String(storeContext.storeId) : '等待 Main'}`, tone: api && viewReady ? 'neutral' : 'blocked' },
        ]} />}
      >
        <div className="experiments-layout">
          <WorkbenchPanel className="experiments-queue" description="当前店铺 · 已归档记录默认隐藏" footer={filtered.length ? `第 ${safePage}/${pageCount} 页 · ${filtered.length} 条匹配记录` : '当前筛选没有实验。'} status={<span>{experiments.filter((item) => item.status === 'running').length} 个观察中</span>} title="实验队列">
            <div className="experiments-queue-tools"><input aria-label="搜索 Experiment" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索假设、Mission、产品或 ID" value={search} /><label><input checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} type="checkbox" />查看已归档</label></div>
            {phase === 'loading' && <WorkspaceState description="正在从当前 StoreContext 读取实验台账。" kind="loading" title="读取 Experiment Authority" />}
            {blocked && <WorkspaceState description="生产模式不会使用 Renderer 临时实验数据。" details={error ?? blockedReason} kind="blocked" title="Experiment 已失败关闭" />}
            {phase === 'ready' && !pageRows.length && <WorkspaceState description="新建实验后先形成草稿，再由精确能力启动观察。" kind="empty" title="当前店铺没有 Experiment" />}
            {phase === 'ready' && Boolean(pageRows.length) && <ul aria-label="Experiment 列表" className="experiments-queue-list">{pageRows.map((record) => <li key={record.id}><button aria-pressed={record.id === selected?.id} data-selected={record.id === selected?.id || undefined} onClick={() => setSelectedId(record.id)} type="button"><span><b>{record.primaryMetric}</b><ExperimentStatusTag status={record.status} /></span><strong>{record.name}</strong><small>{record.missionId} · r{record.revision}</small></button></li>)}</ul>}
            <nav aria-label="Experiment 分页" className="experiments-pagination"><button aria-label="上一页 Experiment" className="workspace-button workspace-button--secondary" disabled={safePage <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><CaretLeft size={15} /></button><span>{safePage} / {pageCount}</span><button aria-label="下一页 Experiment" className="workspace-button workspace-button--secondary" disabled={safePage >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><CaretRight size={15} /></button></nav>
          </WorkbenchPanel>

          <main className="experiment-detail">
            {selected ? <>
              <section className="experiment-detail-header"><div className="experiment-detail-context"><span>EXPERIMENT · {selected.id}</span><strong>{selected.primaryMetric}</strong><ExperimentStatusTag status={selected.status} /></div><div className="experiment-actions" role="group" aria-label="Experiment CRUD 与状态动作">
                <button className="workspace-button workspace-button--primary" disabled={!actionReady('experiments.experiment.update') || busy || !['draft', 'paused'].includes(selected.status)} onClick={() => storeContext && setEditor({ record: selected, draft: draftFor(storeContext, selected) })} type="button"><PencilSimple size={15} />编辑</button>
                {selected.status === 'draft' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.start') || busy} onClick={() => void transition(selected, 'running', '运营者启动实验观察窗')} type="button"><Play size={15} />启动实验</button>}
                {selected.status === 'running' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.pause') || busy} onClick={() => void transition(selected, 'paused', '运营者暂停实验')} type="button"><Pause size={15} />暂停</button>}
                {selected.status === 'paused' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.resume') || busy} onClick={() => void transition(selected, 'running', '运营者恢复实验')} type="button"><Play size={15} />恢复</button>}
                {['running', 'paused'].includes(selected.status) && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.complete') || busy} onClick={() => { setCompleteConfirm(selected); setCompletion(selected.conclusion ?? ''); }} type="button"><StopCircle size={15} />完成</button>}
                {selected.status !== 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.archive') || busy || selected.status === 'running'} onClick={() => setArchiveConfirm(selected)} type="button"><Archive size={15} />归档</button>}
                {selected.status === 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.restore') || busy} onClick={() => void restore(selected)} type="button"><ArrowClockwise size={15} />恢复</button>}
              </div></section>
              <dl className="experiment-contract"><div><dt>Mission</dt><dd>{selected.missionId}</dd></div><div><dt>产品 / 广告对象</dt><dd>{selected.productId || '店铺级'} · {selected.adEntityId || '未绑定'}</dd></div><div><dt>观察窗口</dt><dd>{selected.observationStartsAt.slice(0, 10)} → {selected.observationEndsAt.slice(0, 10)}</dd></div><div><dt>主指标</dt><dd>{selected.primaryMetric}</dd></div></dl>
              <section className="experiment-ledger"><header><div><h3>观察与因果记录</h3><p>当前 Experiment 的 observation 由只读查询精确归属；correction 不会猜测同 Mission 记录。</p></div><button className="workspace-button workspace-button--primary" disabled={!actionReady('experiments.observation.create') || busy || selected.status === 'archived'} onClick={openObservation} type="button"><NotePencil size={15} />追加观察</button></header>{selectedEvents.length ? <div className="experiment-ledger-list" role="list">{selectedEvents.map((event) => <article data-stage={event.stage} key={event.id} role="listitem"><span>{event.stage}</span><div><strong>{event.title}</strong><p>{event.signal || event.observedEffect || event.intervention || '结构化事件已记录'}</p><small>#{event.sequence} · {event.source} · {event.createdAt.slice(0, 16).replace('T', ' ')}</small></div></article>)}</div> : <WorkspaceState description="追加第一条基线或观察记录；原记录不会被覆盖。" kind="empty" title="暂无实验因果记录" />}</section>
              <div className="experiment-evidence-grid">
                <section><header><div><h3>变量合同</h3><p>基线与唯一变量以结构化 JSON 入库。</p></div><Flask size={19} /></header><div className="experiment-variables"><article><span>BASELINE</span><pre>{prettyJson(selected.baseline)}</pre></article><article><span>VARIANT · ONLY ONE</span><pre>{prettyJson(selected.variant)}</pre></article></div></section>
                <section><header><div><h3>守护栏</h3><p>触发后暂停并转人工复核。</p></div><CheckCircle size={19} /></header><ul>{selected.guardrailCriteria.map((criterion, index) => <li key={`${criterion}-${index}`}><b>{selected.guardrailMetrics[index] ?? `守护指标 ${index + 1}`}</b><span>{criterion}</span></li>)}</ul></section>
              </div>
              {metricSnapshots.length > 0 && <section className="experiment-metrics"><header><div><h3>只读指标快照</h3><p>由 Main 绑定已完成数据批次写入；Renderer 无追加权限。</p></div><span>{metricSnapshots.length} SNAPSHOTS</span></header><div>{metricSnapshots.map((snapshot) => <article key={snapshot.id}><span>{snapshot.metric}</span><strong>{snapshot.currency === 'USD' ? '$' : ''}{snapshot.value.toLocaleString()}</strong><small>{snapshot.observedAt.slice(0, 10)} · {snapshot.dataBatchId}</small></article>)}</div></section>}
              {selected.conclusion && <section className="experiment-conclusion"><span>EFFECT CONCLUSION</span><p>{selected.conclusion}</p></section>}
              <p className="experiment-no-delete">实验不提供物理删除：归档后仍保留假设、版本、观察与修正链。</p>
            </> : phase === 'ready' ? <WorkspaceState description="从左侧选择 Experiment，或新建当前店铺的第一个实验。" kind="empty" title="等待选择 Experiment" /> : null}
          </main>
        </div>
        {(error || feedback) && <p aria-live="polite" className="experiment-feedback" data-tone={error ? 'error' : 'success'}>{error || feedback}</p>}
      </PageFrame>

      {editor && <ExperimentEditor busy={pending === 'save'} editor={editor} onCancel={() => setEditor(null)} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onSave={() => void save()} />}
      {observationEditor && <ObservationEditor busy={pending === 'observation'} correctionTargets={correctionTargets} draft={observationEditor} onCancel={() => setObservationEditor(null)} onChange={setObservationEditor} onSave={() => void appendObservation()} />}
      {archiveConfirm && <div className="mission-control-dialog-backdrop"><section aria-labelledby="experiment-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>ARCHIVE EXPERIMENT</span><h2 id="experiment-archive-title">归档“{archiveConfirm.name}”？</h2><p>实验退出默认队列，但所有观察、修正和因果事件继续保留。</p></div></header><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setArchiveConfirm(null)} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archive()} type="button">确认归档</button></footer></section></div>}
      {completeConfirm && <div className="mission-control-dialog-backdrop"><section aria-labelledby="experiment-complete-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm experiment-complete-dialog" role="dialog"><header><div><span>COMPLETE EXPERIMENT</span><h2 id="experiment-complete-title">完成“{completeConfirm.name}”</h2><p>结论会作为 EFFECT 追加到因果链，完成后不可再编辑。</p></div></header><label><span>实验结论 *</span><textarea autoFocus onChange={(event) => setCompletion(event.target.value)} rows={4} value={completion} /></label><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setCompleteConfirm(null)} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || !completion.trim()} onClick={() => void transition(completeConfirm, 'completed', completion.trim())} type="button">确认完成</button></footer></section></div>}
    </div>
  );
}
