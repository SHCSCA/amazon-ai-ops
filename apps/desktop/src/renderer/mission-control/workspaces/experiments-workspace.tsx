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
  assertMissionBelongsToContext,
  readExperimentDomainWindowApi,
  readMissionDomainWindowApi,
  type AppendExperimentObservationInput,
  type ExperimentDomainRendererApi,
} from './mission-domain-window-api';
import './experiments-workspace.css';

const PAGE_SIZE = 6;
const OPERATOR = 'desktop-operator';

const STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: '待启动',
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
  guardrailComparator?: '<' | '<=' | '>' | '>=';
  guardrailThreshold?: string;
  productId: string;
  adEntityId: string;
  baselineJson: string;
  variantJson: string;
  observationStartsOn: string;
  observationEndsOn: string;
  conclusion: string;
};

type ExperimentEditorState = { record: ExperimentRecord | null; draft: ExperimentDraft };
type SelectorOption = { value: string; label: string };
type ExperimentMissionOptionSource = { id: string; title: string; status: string };
type ExperimentProductOptionSource = { id: number | string; asin: string; title?: string; storeId?: string | number };
type ExperimentAdObjectOptionSource = {
  kind: 'campaign' | 'ad_group' | 'target' | 'search_term';
  entityId?: string;
  resolved?: boolean;
  nonExecutable?: boolean;
  name: string;
  campaignName?: string;
  adGroupName?: string;
  storeId?: string | number;
};
type ExperimentSelectorOptions = {
  missions: SelectorOption[];
  products: SelectorOption[];
  adObjects: SelectorOption[];
  loading: boolean;
};

const PRIMARY_METRIC_OPTIONS: SelectorOption[] = [
  { value: 'ACOS', label: '广告投入产出比（ACOS）' },
  { value: 'TACOS', label: '整体广告销售占比（TACOS）' },
  { value: 'CVR', label: '转化率（CVR）' },
  { value: '广告订单', label: '广告订单' },
  { value: '花费', label: '广告花费' },
];

export function buildExperimentSelectorOptions(
  missions: readonly ExperimentMissionOptionSource[],
  products: readonly ExperimentProductOptionSource[],
  adObjects: readonly ExperimentAdObjectOptionSource[],
): Omit<ExperimentSelectorOptions, 'loading'> {
  return {
    missions: missions
      .filter((mission) => mission.status !== 'archived')
      .map((mission) => ({ value: mission.id, label: mission.title })),
    products: products.map((product) => ({
      value: String(product.id),
      label: `${product.title?.trim() || '未命名产品'} · ${product.asin}`,
    })),
    adObjects: adObjects
      .filter((item) => item.kind === 'target' && item.entityId && item.resolved && !item.nonExecutable)
      .map((item) => ({
        value: item.entityId!,
        label: [
          item.campaignName?.trim() || '未命名活动',
          item.adGroupName?.trim() || '未命名广告组',
          item.name.trim() || '未命名关键词/投放',
        ].join(' > '),
      })),
  };
}

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
    : '经营实验操作未完成，请刷新当前店铺后重试。';
}

function operatorFacingBlocker(reason: string | null | undefined, subject: string): string {
  const value = reason?.trim();
  if (!value || /Mission|Experiment|Decision|Authority|Renderer|Main|StoreContext|UNKNOWN|\brevision\b|\bdraft\b|set_keyword_bid|PRODUCTION_NATIVE|PROTOTYPE_ONLY|\bBLOCKED\b/.test(value)) {
    return `${subject}当前不可用。请确认当前店铺连接与本机服务后重试。`;
  }
  return value;
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

function structuredGuardrailDraft(record?: ExperimentRecord | null): Pick<ExperimentDraft, 'guardrailMetrics' | 'guardrailCriteria' | 'guardrailComparator' | 'guardrailThreshold'> {
  const metric = record?.guardrailMetrics[0] ?? '广告订单';
  const criterion = record?.guardrailCriteria[0] ?? '广告订单 < 15%';
  const symbolic = criterion.match(/(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/);
  const written = criterion.match(/(不低于|不高于|高于|低于)[^\d-]*(-?\d+(?:\.\d+)?)\s*%?\s*$/);
  const comparator = symbolic?.[1]
    ?? (written?.[1] === '不低于' ? '>=' : written?.[1] === '不高于' ? '<=' : written?.[1] === '高于' ? '>' : written?.[1] === '低于' ? '<' : '<');
  const threshold = symbolic?.[2] ?? written?.[2] ?? '15';
  return {
    guardrailMetrics: metric,
    guardrailCriteria: criterion,
    guardrailComparator: comparator as ExperimentDraft['guardrailComparator'],
    guardrailThreshold: threshold,
  };
}

export function buildExperimentDraft(context: StoreContextEnvelope, record?: ExperimentRecord | null): ExperimentDraft {
  return {
    missionId: record?.missionId ?? '',
    name: record?.name ?? '',
    hypothesis: record?.hypothesis ?? '',
    primaryMetric: record?.primaryMetric ?? 'ACOS',
    ...structuredGuardrailDraft(record),
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
  const structuredGuardrail = Boolean(draft.guardrailComparator && draft.guardrailThreshold?.trim());
  const guardrailMetrics = structuredGuardrail ? [draft.guardrailMetrics.trim()] : list(draft.guardrailMetrics);
  const guardrailCriteria = structuredGuardrail
    ? [`${draft.guardrailMetrics.trim()} ${draft.guardrailComparator} ${draft.guardrailThreshold!.trim()}%`]
    : list(draft.guardrailCriteria);
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

function SearchableOptionSelect({ disabled, label, options, required, value, onChange }: {
  disabled?: boolean;
  label: string;
  options: readonly SelectorOption[];
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  const filtered = options.filter((option) => !normalized || option.label.toLocaleLowerCase('zh-CN').includes(normalized));
  return <label className="experiment-searchable-select"><span>{label}{required ? ' *' : ''}</span><input aria-label={`搜索${label}`} disabled={disabled} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} type="search" value={query} /><select aria-label={label} disabled={disabled || !options.length} onChange={(event) => onChange(event.target.value)} value={value}><option value="">{options.length ? `请选择${label}` : `当前店铺没有可选${label}`}</option>{filtered.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function ExperimentEditor({
  busy,
  editor,
  options,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  editor: ExperimentEditorState;
  options: ExperimentSelectorOptions;
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
          <div><span>经营实验 · Amazon 美国站 / USD</span><h2 id="experiment-editor-title">{editor.record ? '编辑经营实验' : '新建经营实验'}</h2><p>一次实验只允许一个主要变量；运营任务和对象只来自当前店铺。</p></div>
          <button aria-label="关闭实验编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></button>
        </header>
        <div className="experiment-form">
          <SearchableOptionSelect disabled={Boolean(editor.record) || options.loading} label="运营任务" onChange={(value) => change('missionId', value)} options={options.missions} required value={editor.draft.missionId} />
          <SearchableOptionSelect disabled={options.loading} label="主指标" onChange={(value) => change('primaryMetric', value)} options={PRIMARY_METRIC_OPTIONS} required value={editor.draft.primaryMetric} />
          <label className="experiment-form__wide"><span>实验名称 *</span><input autoFocus onChange={(event) => change('name', event.target.value)} placeholder="例如：核心词竞价 -12% 小步实验" value={editor.draft.name} /></label>
          <label className="experiment-form__wide"><span>可证伪假设 *</span><textarea onChange={(event) => change('hypothesis', event.target.value)} rows={3} value={editor.draft.hypothesis} /></label>
          <SearchableOptionSelect disabled={options.loading} label="产品" onChange={(value) => change('productId', value)} options={options.products} value={editor.draft.productId} />
          <SearchableOptionSelect disabled={options.loading} label="广告对象（活动 > 广告组 > 关键词/投放）" onChange={(value) => change('adEntityId', value)} options={options.adObjects} value={editor.draft.adEntityId} />
          <label><span>开始日期 *</span><input onChange={(event) => change('observationStartsOn', event.target.value)} type="date" value={editor.draft.observationStartsOn} /></label>
          <label><span>结束日期 *</span><input onChange={(event) => change('observationEndsOn', event.target.value)} type="date" value={editor.draft.observationEndsOn} /></label>
          <fieldset className="experiment-form__wide experiment-guardrail-builder"><legend>守护条件 *</legend><label><span>指标</span><select onChange={(event) => change('guardrailMetrics', event.target.value)} value={editor.draft.guardrailMetrics}>{PRIMARY_METRIC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>比较符</span><select onChange={(event) => change('guardrailComparator', event.target.value as ExperimentDraft['guardrailComparator'])} value={editor.draft.guardrailComparator}><option value="<">小于</option><option value="<=">小于或等于</option><option value=">">大于</option><option value=">=">大于或等于</option></select></label><label><span>阈值</span><div className="experiment-threshold"><input min="0" onChange={(event) => change('guardrailThreshold', event.target.value)} step="0.1" type="number" value={editor.draft.guardrailThreshold} /><b>%</b></div></label></fieldset>
          <details className="experiment-form__wide experiment-diagnostics"><summary>诊断详情</summary><div className="experiment-diagnostic-grid"><label><span>基线结构</span><textarea className="experiment-json" onChange={(event) => change('baselineJson', event.target.value)} rows={6} value={editor.draft.baselineJson} /></label><label><span>唯一变量结构</span><textarea className="experiment-json" onChange={(event) => change('variantJson', event.target.value)} rows={6} value={editor.draft.variantJson} /></label></div></details>
          {editor.record && <label className="experiment-form__wide"><span>实验结论</span><textarea onChange={(event) => change('conclusion', event.target.value)} rows={3} value={editor.draft.conclusion} /></label>}
        </div>
        <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || options.loading || !editor.draft.missionId || !editor.draft.primaryMetric} onClick={onSave} type="button">{busy ? '保存中...' : '保存经营实验'}</button></footer>
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
        <header><div><span>只追加的观察记录</span><h2 id="observation-editor-title">追加实验观察</h2><p>既有记录不可覆盖；错误内容必须追加修正并指向原记录。</p></div><button aria-label="关闭观察编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></button></header>
        <div className="experiment-form">
          <label><span>记录类型 *</span><select onChange={(event) => change('observationType', event.target.value as ExperimentObservationType)} value={draft.observationType}>{(Object.keys(OBSERVATION_LABELS) as ExperimentObservationType[]).map((type) => <option key={type} value={type}>{OBSERVATION_LABELS[type]}</option>)}</select></label>
          <label><span>观察时间 *</span><input onChange={(event) => change('observedAt', event.target.value)} type="datetime-local" value={draft.observedAt} /></label>
          {draft.observationType === 'correction' && <label className="experiment-form__wide"><span>被修正记录 *</span><select onChange={(event) => change('correctsRecordId', event.target.value)} value={draft.correctsRecordId}><option value="">请选择原记录</option>{correctionTargets.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}</select></label>}
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
  const missionApi = useMemo(() => readMissionDomainWindowApi(), []);
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
  const [selectorOptions, setSelectorOptions] = useState<ExperimentSelectorOptions>({ missions: [], products: [], adObjects: [], loading: false });

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
    if (!storeContext) { setSelectorOptions({ missions: [], products: [], adObjects: [], loading: false }); return; }
    const capturedKey = authorityKey;
    setSelectorOptions({ missions: [], products: [], adObjects: [], loading: true });
    const surface = (window as any).electronAPI as {
      listStoreProducts?: (context: StoreContextEnvelope, input: { includeArchived: boolean }) => Promise<ExperimentProductOptionSource[]>;
      listStoreAdObjects?: (context: StoreContextEnvelope, input: Record<string, never>) => Promise<ExperimentAdObjectOptionSource[]>;
    } | undefined;
    void Promise.all([
      missionApi?.listMissions(storeContext, { includeArchived: false }) ?? Promise.resolve([]),
      surface?.listStoreProducts?.(storeContext, { includeArchived: false }) ?? Promise.resolve([]),
      surface?.listStoreAdObjects?.(storeContext, {}) ?? Promise.resolve([]),
    ]).then(([missionRows, productRows, adObjectRows]) => {
      if (currentAuthorityKey.current !== capturedKey) return;
      missionRows.forEach((mission) => assertMissionBelongsToContext(mission, storeContext));
      if (productRows.some((product) => String(product.storeId) !== String(storeContext.storeId))
        || adObjectRows.some((item) => String(item.storeId) !== String(storeContext.storeId))) {
        throw new Error('对象选择器返回了不属于当前店铺的记录。');
      }
      setSelectorOptions({
        ...buildExperimentSelectorOptions(missionRows, productRows, adObjectRows),
        loading: false,
      });
    }).catch(() => {
      if (currentAuthorityKey.current === capturedKey) {
        setSelectorOptions({ missions: [], products: [], adObjects: [], loading: false });
        setError('当前店铺的运营任务、产品或广告对象读取失败，请刷新后重试。');
      }
    });
  }, [authorityKey, missionApi]);

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
      setError('经营实验写入服务不可用，操作已阻断。');
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
    setFeedback(editor.record ? '经营实验已更新。' : '经营实验已创建，当前为待启动状态。');
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
    setFeedback(status === 'running' ? '经营实验已进入观察窗。' : status === 'paused' ? '经营实验已暂停；变量保持不变。' : '经营实验已完成并追加效果记录。');
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
    setFeedback('经营实验已恢复为暂停状态。');
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
  const visibleBlockedReason = operatorFacingBlocker(error ?? blockedReason, '经营实验');

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
        task={<TaskBanner compact description={selected?.hypothesis ?? '先定义基线、唯一变量和守护栏，再启动观察；实验记录只追加修正，不覆盖历史。'} eyebrow={selected ? '当前经营实验' : '可验证经营干预'} primaryAction={{ actionId: 'experiments.experiment.create', disabled: !actionReady('experiments.experiment.create') || busy || !storeContext, disabledReason: visibleBlockedReason, label: '新建经营实验', onClick: () => storeContext && setEditor({ record: null, draft: buildExperimentDraft(storeContext) }) }} secondaryActions={onInspectBoundary ? [{ actionId: 'experiment-boundary', label: '接入边界', onClick: onInspectBoundary }] : []} status={<span className="experiment-authority" data-state={viewReady ? expectedCapability : 'BLOCKED'}>{viewReady ? previewMode ? '开发预览 · 美国站 / USD' : '本机数据 · 美国站 / USD' : '已阻断'}</span>} title={selected?.name ?? '经营实验'} tone={blocked ? 'blocked' : 'neutral'}>{previewMode && <p className="experiment-preview-note">预览数据 · 不写入真实广告</p>}</TaskBanner>}
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
            <nav aria-label="经营实验分页" className="experiments-pagination"><button aria-label="上一页经营实验" className="workspace-button workspace-button--secondary" disabled={safePage <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><CaretLeft size={15} /></button><span>{safePage} / {pageCount}</span><button aria-label="下一页经营实验" className="workspace-button workspace-button--secondary" disabled={safePage >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><CaretRight size={15} /></button></nav>
          </WorkbenchPanel>

          <main className="experiment-detail">
            {selected ? <>
              <section className="experiment-detail-header"><div className="experiment-detail-context"><span>当前经营实验</span><strong>{selected.primaryMetric}</strong><ExperimentStatusTag status={selected.status} /></div><div className="experiment-actions" role="group" aria-label="经营实验增删改查与状态动作">
                <button className="workspace-button workspace-button--primary" disabled={!actionReady('experiments.experiment.update') || busy || !['draft', 'paused'].includes(selected.status)} onClick={() => storeContext && setEditor({ record: selected, draft: buildExperimentDraft(storeContext, selected) })} type="button"><PencilSimple size={15} />编辑</button>
                {selected.status === 'draft' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.start') || busy} onClick={() => void transition(selected, 'running', '运营者启动实验观察窗')} type="button"><Play size={15} />启动实验</button>}
                {selected.status === 'running' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.pause') || busy} onClick={() => void transition(selected, 'paused', '运营者暂停实验')} type="button"><Pause size={15} />暂停</button>}
                {selected.status === 'paused' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.resume') || busy} onClick={() => void transition(selected, 'running', '运营者恢复实验')} type="button"><Play size={15} />恢复</button>}
                {['running', 'paused'].includes(selected.status) && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.complete') || busy} onClick={() => { setCompleteConfirm(selected); setCompletion(selected.conclusion ?? ''); }} type="button"><StopCircle size={15} />完成</button>}
                {selected.status !== 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.archive') || busy || selected.status === 'running'} onClick={() => setArchiveConfirm(selected)} type="button"><Archive size={15} />归档</button>}
                {selected.status === 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('experiments.experiment.restore') || busy} onClick={() => void restore(selected)} type="button"><ArrowClockwise size={15} />恢复</button>}
              </div></section>
              <dl className="experiment-contract"><div><dt>运营任务</dt><dd>{selectedMissionLabel}</dd></div><div><dt>产品 / 广告对象</dt><dd>{selectedProductLabel} · {selectedAdObjectLabel}</dd></div><div><dt>观察窗口</dt><dd>{selected.observationStartsAt.slice(0, 10)} → {selected.observationEndsAt.slice(0, 10)}</dd></div><div><dt>主指标</dt><dd>{selected.primaryMetric}</dd></div></dl>
              <details className="experiment-diagnostics"><summary>诊断详情</summary><code>experimentId={selected.id}</code><code>missionId={selected.missionId}</code><code>productId={selected.productId || 'none'}</code><code>adEntityId={selected.adEntityId || 'none'}</code><code>revision={selected.revision}</code></details>
              <section className="experiment-ledger"><header><div><h3>观察与因果记录</h3><p>当前实验的观察由只读查询精确归属；修正记录不会猜测其他运营任务的记录。</p></div><button className="workspace-button workspace-button--primary" disabled={!actionReady('experiments.observation.create') || busy || selected.status === 'archived'} onClick={openObservation} type="button"><NotePencil size={15} />追加观察</button></header>{selectedEvents.length ? <div className="experiment-ledger-list" role="list">{selectedEvents.map((event) => <article data-stage={event.stage} key={event.id} role="listitem"><span>{event.stage === 'FACT' ? '事实' : event.stage === 'EFFECT' ? '效果' : '分析'}</span><div><strong>{event.title}</strong><p>{event.signal || event.observedEffect || event.intervention || '结构化事件已记录'}</p><small>{event.createdAt.slice(0, 16).replace('T', ' ')}</small><details className="experiment-diagnostics"><summary>诊断详情</summary><code>sequence={event.sequence}</code><code>source={event.source}</code></details></div></article>)}</div> : <WorkspaceState description="追加第一条基线或观察记录；原记录不会被覆盖。" kind="empty" title="暂无实验因果记录" />}</section>
              <div className="experiment-evidence-grid">
                <section><header><div><h3>变量合同</h3><p>基线与唯一变量已结构化保存。</p></div><Flask size={19} /></header><details className="experiment-diagnostics"><summary>诊断详情</summary><div className="experiment-variables"><article><span>基线结构</span><pre>{prettyJson(selected.baseline)}</pre></article><article><span>唯一变量结构</span><pre>{prettyJson(selected.variant)}</pre></article></div></details></section>
                <section><header><div><h3>守护栏</h3><p>触发后暂停并转人工复核。</p></div><CheckCircle size={19} /></header><ul>{selected.guardrailCriteria.map((criterion, index) => <li key={`${criterion}-${index}`}><b>{selected.guardrailMetrics[index] ?? `守护指标 ${index + 1}`}</b><span>{criterion}</span></li>)}</ul></section>
              </div>
              {metricSnapshots.length > 0 && <section className="experiment-metrics"><header><div><h3>只读指标快照</h3><p>由系统绑定已完成数据批次写入；界面无追加权限。</p></div><span>{metricSnapshots.length} 个快照</span></header><div>{metricSnapshots.map((snapshot) => <article key={snapshot.id}><span>{snapshot.metric}</span><strong>{snapshot.currency === 'USD' ? '$' : ''}{snapshot.value.toLocaleString()}</strong><small>{snapshot.observedAt.slice(0, 10)}</small><details className="experiment-diagnostics"><summary>诊断详情</summary><code>dataBatchId={snapshot.dataBatchId}</code></details></article>)}</div></section>}
              {selected.conclusion && <section className="experiment-conclusion"><span>实验结论</span><p>{selected.conclusion}</p></section>}
              <p className="experiment-no-delete">实验不提供物理删除：归档后仍保留假设、版本、观察与修正链。</p>
            </> : phase === 'ready' ? <WorkspaceState description="从左侧选择经营实验，或新建当前店铺的第一个实验。" kind="empty" title="等待选择经营实验" /> : null}
          </main>
        </div>
        {(error || feedback) && <p aria-live="polite" className="experiment-feedback" data-tone={error ? 'error' : 'success'}>{error ? operatorFacingBlocker(error, '经营实验') : feedback}</p>}
        {!previewMode && (!viewReady || error) && <details className="experiment-diagnostics"><summary>诊断详情</summary><code>{error ?? blockedReason}</code></details>}
      </PageFrame>

      {editor && <ExperimentEditor busy={pending === 'save'} editor={editor} onCancel={() => setEditor(null)} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onSave={() => void save()} options={selectorOptions} />}
      {observationEditor && <ObservationEditor busy={pending === 'observation'} correctionTargets={correctionTargets} draft={observationEditor} onCancel={() => setObservationEditor(null)} onChange={setObservationEditor} onSave={() => void appendObservation()} />}
      {archiveConfirm && <div className="mission-control-dialog-backdrop"><section aria-labelledby="experiment-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>归档经营实验</span><h2 id="experiment-archive-title">归档“{archiveConfirm.name}”？</h2><p>实验退出默认队列，但所有观察、修正和因果事件继续保留。</p></div></header><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setArchiveConfirm(null)} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archive()} type="button">确认归档</button></footer></section></div>}
      {completeConfirm && <div className="mission-control-dialog-backdrop"><section aria-labelledby="experiment-complete-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm experiment-complete-dialog" role="dialog"><header><div><span>完成经营实验</span><h2 id="experiment-complete-title">完成“{completeConfirm.name}”</h2><p>结论会作为效果记录追加到因果链，完成后不可再编辑。</p></div></header><label><span>实验结论 *</span><textarea autoFocus onChange={(event) => setCompletion(event.target.value)} rows={4} value={completion} /></label><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setCompleteConfirm(null)} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || !completion.trim()} onClick={() => void transition(completeConfirm, 'completed', completion.trim())} type="button">确认完成</button></footer></section></div>}
    </div>
  );
}
