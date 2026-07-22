import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { capabilityForAction } from '../components';
import {
  assertMissionBelongsToContext,
  assertMissionAuthorityContext,
  readMissionDomainWindowApi,
  type MissionDomainRendererApi,
  type MissionLineageProjection,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';
import './missions-workspace.css';

const PAGE_SIZE = 6;
const OPERATOR_ACTOR_ID = 'desktop-operator';

const STATUS_LABELS: Record<MissionLifecycleStatus, string> = {
  draft: '草稿',
  active: 'Agent 运行中',
  paused: '已暂停',
  blocked: '已阻断',
  completed: '已完成',
  archived: '已归档',
};

const PHASE_LABELS: Record<MissionPhase, string> = {
  fact: 'Observe',
  analysis: 'Analyze',
  decision: 'Decide',
  action: 'Act',
  readback: 'Verify',
  effect: 'Effect',
};

const LINK_LABELS: Record<MissionLinkRecord['linkType'], string> = {
  data_batch: '数据批次',
  policy_version: '策略版本',
  decision: 'Crux 决策',
  experiment: '经营实验',
  execution: '执行记录',
  result: '效果结果',
  product: '产品',
  ad_entity: '广告对象',
};

type MissionDraft = {
  title: string;
  objective: string;
  dataBatchId: string;
  policyVersionId: string;
  productId: string;
  priority: MissionPriority;
  observationStartsOn: string;
  observationEndsOn: string;
  successCriteria: string;
  guardrails: string;
};

type MissionEditorState = {
  mission: MissionRecord | null;
  draft: MissionDraft;
};

type CheckpointDraft = {
  stage: AppendMissionCheckpointInput['stage'];
  title: string;
  status: string;
  evidenceCount: string;
};

export type MissionsWorkspaceProps = {
  apiOverride?: MissionDomainRendererApi;
  analysisApiOverride?: AnalysisAuthorityRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
  view?: 'missions/overview' | 'missions/facts';
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Mission 操作未完成；请重新读取当前店铺后再试。';
}

function datePart(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function asTimestamp(date: string): string {
  return new Date(`${date}T07:00:00.000Z`).toISOString();
}

function plusDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function listFromDraft(value: string): string[] {
  return value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
}

function missionDraft(context: StoreContextEnvelope, mission?: MissionRecord | null): MissionDraft {
  return {
    title: mission?.title ?? '',
    objective: mission?.objective ?? '',
    dataBatchId: mission?.dataBatchId ?? `BATCH-${String(context.storeId)}-${context.businessDate.replaceAll('-', '')}`,
    policyVersionId: mission?.policyVersionId ?? `POLICY-${String(context.storeId)}-ACTIVE`,
    productId: mission?.productId ?? '',
    priority: mission?.priority ?? 'P2',
    observationStartsOn: mission ? datePart(mission.observationStartsAt) : context.businessDate,
    observationEndsOn: mission ? datePart(mission.observationEndsAt) : plusDays(context.businessDate, 7),
    successCriteria: mission?.successCriteria.join('；') ?? 'ACOS 改善 ≥ 10%；广告订单下降 < 15%',
    guardrails: mission?.guardrails.join('；') ?? '单次竞价变化 ≤ 15%；UNKNOWN 立即停止并人工对账',
  };
}

export function buildCreateMissionInput(
  context: StoreContextEnvelope,
  draft: MissionDraft,
  id: string,
): CreateMissionInput {
  assertMissionAuthorityContext(context);
  const successCriteria = listFromDraft(draft.successCriteria);
  const guardrails = listFromDraft(draft.guardrails);
  if (!draft.title.trim() || !draft.objective.trim()) throw new Error('请填写 Mission 标题与可衡量的经营目标。');
  if (!draft.dataBatchId.trim() || !draft.policyVersionId.trim()) throw new Error('Mission 必须绑定数据批次与策略版本。');
  if (!successCriteria.length || !guardrails.length) throw new Error('请至少填写一条成功标准和一条守护栏。');
  if (draft.observationStartsOn >= draft.observationEndsOn) throw new Error('观察窗口结束日期必须晚于开始日期。');
  return {
    id,
    dataBatchId: draft.dataBatchId.trim(),
    policyVersionId: draft.policyVersionId.trim(),
    title: draft.title.trim(),
    objective: draft.objective.trim(),
    priority: draft.priority,
    ...(draft.productId.trim() ? { productId: draft.productId.trim() } : {}),
    observationStartsAt: asTimestamp(draft.observationStartsOn),
    observationEndsAt: asTimestamp(draft.observationEndsOn),
    successCriteria,
    guardrails,
    actorId: OPERATOR_ACTOR_ID,
  };
}

export function buildUpdateMissionInput(
  context: StoreContextEnvelope,
  mission: MissionRecord,
  draft: MissionDraft,
): UpdateMissionInput {
  const create = buildCreateMissionInput(context, draft, mission.id);
  return {
    id: mission.id,
    expectedRevision: mission.revision,
    actorId: OPERATOR_ACTOR_ID,
    patch: {
      title: create.title,
      objective: create.objective,
      priority: create.priority,
      productId: create.productId ?? null,
      observationStartsAt: create.observationStartsAt,
      observationEndsAt: create.observationEndsAt,
      successCriteria: create.successCriteria,
      guardrails: create.guardrails,
    },
  };
}

export function responseMatchesMissionAuthority(
  currentAuthorityKey: string,
  capturedAuthorityKey: string,
  currentSequence: number,
  capturedSequence: number,
): boolean {
  return currentAuthorityKey === capturedAuthorityKey && currentSequence === capturedSequence;
}

function capabilityReady(
  capabilities: readonly MissionControlCapabilityProjection[] | undefined,
  view: 'missions/overview' | 'missions/facts',
  action: MissionControlCapabilityAction,
  previewMode: boolean,
): boolean {
  const projection = capabilityForAction(capabilities, action === 'view' ? view : 'missions/overview', action);
  return projection?.state === (previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE');
}

function MissionStatus({ status }: { status: MissionLifecycleStatus }) {
  return <span className="mission-domain-status" data-status={status}>{STATUS_LABELS[status]}</span>;
}

function MissionEditor({
  busy,
  editor,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  editor: MissionEditorState;
  onCancel: () => void;
  onChange: (draft: MissionDraft) => void;
  onSave: () => void;
}) {
  const update = <K extends keyof MissionDraft>(key: K, value: MissionDraft[K]) => {
    onChange({ ...editor.draft, [key]: value });
  };
  return (
    <div className="mission-control-dialog-backdrop">
      <section aria-labelledby="mission-editor-title" aria-modal="true" className="mission-control-dialog mission-domain-editor" role="dialog">
        <header>
          <div>
            <span>MISSION CONTRACT · AMAZON US / USD</span>
            <h2 id="mission-editor-title">{editor.mission ? '编辑 Mission' : '新建 Mission'}</h2>
            <p>Mission 只属于当前店铺；保存时使用 revision 防止覆盖并发变更。</p>
          </div>
          <button aria-label="关闭 Mission 编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="mission-domain-form">
          <label className="mission-domain-form__wide"><span>Mission 标题 *</span><input autoFocus onChange={(event) => update('title', event.target.value)} placeholder="例如：控制核心词浪费并稳定订单" value={editor.draft.title} /></label>
          <label className="mission-domain-form__wide"><span>经营目标 *</span><textarea onChange={(event) => update('objective', event.target.value)} placeholder="写明希望改善的指标、范围和结果" rows={3} value={editor.draft.objective} /></label>
          <label><span>数据批次 *</span><input disabled={Boolean(editor.mission)} onChange={(event) => update('dataBatchId', event.target.value)} value={editor.draft.dataBatchId} /></label>
          <label><span>策略版本 *</span><input disabled={Boolean(editor.mission)} onChange={(event) => update('policyVersionId', event.target.value)} value={editor.draft.policyVersionId} /></label>
          <label><span>关联产品</span><input onChange={(event) => update('productId', event.target.value)} placeholder="留空表示店铺级" value={editor.draft.productId} /></label>
          <label><span>优先级</span><select onChange={(event) => update('priority', event.target.value as MissionPriority)} value={editor.draft.priority}><option value="P0">P0 · 紧急</option><option value="P1">P1 · 高</option><option value="P2">P2 · 中</option><option value="P3">P3 · 低</option></select></label>
          <label><span>观察开始 *</span><input onChange={(event) => update('observationStartsOn', event.target.value)} type="date" value={editor.draft.observationStartsOn} /></label>
          <label><span>观察结束 *</span><input onChange={(event) => update('observationEndsOn', event.target.value)} type="date" value={editor.draft.observationEndsOn} /></label>
          <label className="mission-domain-form__wide"><span>成功标准 *</span><textarea onChange={(event) => update('successCriteria', event.target.value)} rows={2} value={editor.draft.successCriteria} /><small>多条标准用分号或换行分隔</small></label>
          <label className="mission-domain-form__wide"><span>守护栏 *</span><textarea onChange={(event) => update('guardrails', event.target.value)} rows={2} value={editor.draft.guardrails} /><small>必须包含停止或人工接管条件</small></label>
        </div>
        <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</button><button aria-busy={busy || undefined} className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button"><Check aria-hidden="true" size={16} />{busy ? '保存中…' : '保存 Mission'}</button></footer>
      </section>
    </div>
  );
}

function CheckpointEditor({
  busy,
  draft,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  draft: CheckpointDraft;
  onCancel: () => void;
  onChange: (draft: CheckpointDraft) => void;
  onSave: () => void;
}) {
  return (
    <div className="mission-control-dialog-backdrop">
      <section aria-labelledby="checkpoint-editor-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="dialog">
        <header><div><span>APPEND-ONLY CHECKPOINT</span><h2 id="checkpoint-editor-title">记录 Mission 检查点</h2><p>检查点只追加，不覆盖已有因果证据。</p></div></header>
        <div className="mission-domain-checkpoint-form">
          <label><span>阶段</span><select onChange={(event) => onChange({ ...draft, stage: event.target.value as CheckpointDraft['stage'] })} value={draft.stage}>{['FACT', 'ANALYSIS'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select><small>Renderer 只能追加事实与分析；决策、动作和回读由 Main 写入。</small></label>
          <label><span>标题</span><input autoFocus onChange={(event) => onChange({ ...draft, title: event.target.value })} value={draft.title} /></label>
          <label><span>状态</span><select onChange={(event) => onChange({ ...draft, status: event.target.value })} value={draft.status}><option value="completed">已完成</option><option value="active">当前</option><option value="pending">等待</option><option value="blocked">已阻断</option></select></label>
          <label><span>证据数量</span><input min="0" onChange={(event) => onChange({ ...draft, evidenceCount: event.target.value })} type="number" value={draft.evidenceCount} /></label>
        </div>
        <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || !draft.title.trim()} onClick={onSave} type="button">追加检查点</button></footer>
      </section>
    </div>
  );
}

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
  const [lineage, setLineage] = useState<MissionLineageProjection | null>(null);
  const [analysis, setAnalysis] = useState<MissionAnalysisProjection | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error'>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState<MissionEditorState | null>(null);
  const [checkpointEditor, setCheckpointEditor] = useState<CheckpointDraft | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<MissionRecord | null>(null);
  const requestSequence = useRef(0);
  const lineageSequence = useRef(0);
  const analysisSequence = useRef(0);
  const mutationSequence = useRef(0);
  const idSequence = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const currentAuthorityKey = useRef(authorityKey);
  currentAuthorityKey.current = authorityKey;
  const factsView = view === 'missions/facts';
  const viewReady = capabilityReady(capabilities, view, 'view', previewMode);
  const expectedCapability = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const api = apiOverride ?? readMissionDomainWindowApi();
  const analysisApi = analysisApiOverride ?? readAnalysisAuthorityWindowApi();

  const selected = missions.find((mission) => mission.id === selectedId) ?? missions[0] ?? null;
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

  const loadMissions = async (context: StoreContextEnvelope, capturedKey: string) => {
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
      setError('Mission production window API 未接入；Renderer 未回退到示例数据。');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      assertMissionAuthorityContext(context);
      const rows = await api.listMissions(context, { includeArchived });
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, requestSequence.current, capturedSequence)) return;
      rows.forEach((mission) => assertMissionBelongsToContext(mission, context));
      setMissions(rows);
      setSelectedId((current) => rows.some((mission) => mission.id === current)
        ? current
        : rows.find((mission) => mission.status === 'active')?.id ?? rows[0]?.id ?? '');
      setPhase('ready');
      setFeedback(`已读取 ${rows.length} 条当前店铺 Mission。`);
    } catch (loadError) {
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, requestSequence.current, capturedSequence)) return;
      setMissions([]);
      setLineage(null);
      setPhase('error');
      setError(errorMessage(loadError));
    }
  };

  useEffect(() => {
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
    setPending(null);
    if (!storeContext || !authorityKey) {
      setPhase('blocked');
      setError('尚未建立当前店铺 StoreContext；Mission 已失败关闭。');
      return;
    }
    void loadMissions(storeContext, authorityKey);
    // API identity is intentionally stable for a mounted workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorityKey, includeArchived, viewReady]);

  useEffect(() => {
    if (!selected || !storeContext || !api || !viewReady) {
      setLineage(null);
      return;
    }
    const capturedKey = authorityKey;
    const capturedSequence = ++lineageSequence.current;
    void api.getMissionLineage(storeContext, selected.id).then((projection) => {
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, lineageSequence.current, capturedSequence)) return;
      assertMissionBelongsToContext(projection.mission, storeContext);
      if (projection.checkpoints.some((item) => String(item.storeId) !== String(storeContext.storeId) || item.missionId !== selected.id)
        || projection.links.some((item) => String(item.storeId) !== String(storeContext.storeId) || item.missionId !== selected.id)) {
        throw new Error('Mission lineage 返回了跨店铺或错误 Mission 的记录。');
      }
      setLineage(projection);
    }).catch((lineageError) => {
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, lineageSequence.current, capturedSequence)) return;
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
    const capturedSequence = ++analysisSequence.current;
    void analysisApi.getMissionProjection(storeContext, selected.id).then((projection) => {
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      assertAnalysisProjectionBelongsToContext(storeContext, selected.id, projection);
      setAnalysis(projection);
    }).catch((analysisError) => {
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      setAnalysis(null);
      setError(errorMessage(analysisError));
    });
  }, [analysisApi, authorityKey, selected?.id, storeContext, viewReady]);

  const runMutation = async <T,>(label: string, operation: (activeApi: MissionDomainRendererApi, context: StoreContextEnvelope) => Promise<T>): Promise<T | undefined> => {
    if (!api || !storeContext || pending || !viewReady) {
      setError('Mission 写入 Authority 不可用，操作已阻断。');
      return undefined;
    }
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const capturedSequence = ++mutationSequence.current;
    setPending(label);
    setError(null);
    setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, mutationSequence.current, capturedSequence)) return undefined;
      return result;
    } catch (mutationError) {
      if (responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, mutationSequence.current, capturedSequence)) setError(errorMessage(mutationError));
      return undefined;
    } finally {
      if (responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, mutationSequence.current, capturedSequence)) setPending(null);
    }
  };

  const saveMission = async () => {
    if (!editor || !storeContext) return;
    const input = editor.mission
      ? buildUpdateMissionInput(storeContext, editor.mission, editor.draft)
      : buildCreateMissionInput(storeContext, editor.draft, `MISSION-${String(storeContext.storeId)}-${Date.now()}-${++idSequence.current}`);
    const saved = await runMutation('save', (activeApi, context) => editor.mission
      ? activeApi.updateMission(context, input as UpdateMissionInput)
      : activeApi.createMission(context, input as CreateMissionInput));
    if (!saved || typeof saved !== 'object' || !('storeId' in saved)) return;
    const mission = saved as MissionRecord;
    assertMissionBelongsToContext(mission, storeContext);
    setMissions((current) => current.some((item) => item.id === mission.id)
      ? current.map((item) => item.id === mission.id ? mission : item)
      : [mission, ...current]);
    setSelectedId(mission.id);
    setEditor(null);
    setFeedback(editor.mission ? 'Mission 定义已更新。' : 'Mission 已创建并写入当前店铺。');
  };

  const transitionMission = async () => {
    if (!selected) return;
    const nextStatus: Exclude<MissionLifecycleStatus, 'archived'> = selected.status === 'active' ? 'paused' : 'active';
    const saved = await runMutation('transition', (activeApi, context) => activeApi.transitionMission(context, {
      id: selected.id,
      expectedRevision: selected.revision,
      status: nextStatus,
      actorId: OPERATOR_ACTOR_ID,
      reason: nextStatus === 'paused' ? '运营者从任务中心暂停' : '运营者从任务中心恢复',
    }));
    if (!saved) return;
    setMissions((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback(nextStatus === 'paused' ? 'Mission 已暂停；未完成动作保持锁定。' : 'Mission 已恢复，Agent 可继续推进检查点。');
  };

  const archiveMission = async () => {
    const target = archiveConfirm;
    if (!target) return;
    const saved = await runMutation('archive', (activeApi, context) => activeApi.archiveMission(context, {
      id: target.id,
      expectedRevision: target.revision,
      actorId: OPERATOR_ACTOR_ID,
    }));
    if (!saved) return;
    setArchiveConfirm(null);
    setMissions((current) => includeArchived
      ? current.map((item) => item.id === saved.id ? saved : item)
      : current.filter((item) => item.id !== saved.id));
    setFeedback('Mission 已归档；检查点和 lineage 继续保留。');
  };

  const restoreMission = async () => {
    if (!selected) return;
    const saved = await runMutation('restore', (activeApi, context) => activeApi.restoreMission(context, {
      id: selected.id,
      expectedRevision: selected.revision,
      actorId: OPERATOR_ACTOR_ID,
    }));
    if (!saved) return;
    setMissions((current) => current.map((item) => item.id === saved.id ? saved : item));
    setFeedback('Mission 已恢复为暂停状态。');
  };

  const appendCheckpoint = async () => {
    if (!selected || !checkpointEditor) return;
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
    if (!saved) return;
    setLineage((current) => current ? { ...current, checkpoints: [...current.checkpoints, saved] } : current);
    setCheckpointEditor(null);
    setFeedback(`检查点“${saved.title}”已追加到因果链。`);
  };

  const runAnalysis = async () => {
    if (!analysisApi || !storeContext || !selected || pending) {
      setError('真实分析 Authority 不可用，操作已阻断。');
      return;
    }
    const capturedKey = authorityKey;
    const capturedSequence = ++analysisSequence.current;
    setPending('analysis');
    setError(null);
    setFeedback('');
    try {
      const result = await analysisApi.runMissionAnalysis({
        context: storeContext,
        missionId: selected.id,
      });
      const projection = await analysisApi.getMissionProjection(storeContext, selected.id);
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      assertAnalysisProjectionBelongsToContext(storeContext, selected.id, projection);
      setAnalysis(projection);
      const automatic = result.automaticAuthorization;
      setFeedback(automatic
        ? automatic.authorized
          ? `分析完成：8/8 领星证据已封存，策略自动已整批签发 ${automatic.proposalIds.length} 条建议；尚未执行 Ads。`
          : `分析完成：形成 ${result.proposals.length} 条不可变建议，但策略自动授权被阻断：${automatic.blockers.join('；')}`
        : `分析完成：8/8 领星证据已封存，形成 ${result.proposals.length} 条不可变建议快照，等待一次人工整批授权。`);
    } catch (analysisError) {
      if (!responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) return;
      setError(errorMessage(analysisError));
    } finally {
      if (responseMatchesMissionAuthority(currentAuthorityKey.current, capturedKey, analysisSequence.current, capturedSequence)) {
        setPending(null);
      }
    }
  };

  const activeCheckpoints = lineage?.checkpoints ?? [];
  const completedCount = activeCheckpoints.filter((checkpoint) => ['completed', 'done', 'verified', 'success'].includes(checkpoint.status)).length;
  const currentPhaseIndex = selected ? ['fact', 'analysis', 'decision', 'action', 'readback', 'effect'].indexOf(selected.phase) : -1;
  const blocked = phase === 'blocked' || phase === 'error';
  const busy = pending !== null;
  const latestEvidence = analysis?.evidencePackages[0] ?? null;
  const latestActionBatchId = analysis?.actionBatches[0]?.id;
  const latestProposals = latestActionBatchId
    ? analysis?.proposals.filter((proposal) => proposal.actionBatchId === latestActionBatchId) ?? []
    : [];

  return (
    <div className={`mission-control-workspace-root mission-domain-workspace${factsView ? ' mission-domain-workspace--facts' : ''}`} data-canonical-surface="missions" data-capability-state={viewReady ? expectedCapability : 'BLOCKED'} data-default-focus={factsView ? 'evidence-lineage' : 'mission-flight-plan'} data-preview-mode={previewMode || undefined} data-view={view}>
      <p className="sr-only" id="mission-domain-authority-boundary">
        {!viewReady ? blockedReason : !api ? 'Mission production window API 未接入；Renderer 未回退到示例数据。' : `${expectedCapability} Mission Authority 已接入。`}
      </p>
      <PageFrame
        className="mission-domain-page"
        description={factsView ? '聚焦当前 Mission 的广告事实、检查点和数据 lineage。' : '把事实、决策、执行和回读串成一条可审计路径。'}
        pageId={factsView ? 'missions-facts' : 'missions-overview'}
        title={factsView ? 'Mission 事实链' : '任务中心'}
        task={(
          <TaskBanner
            compact
            description={factsView ? '先核验领星数据批次、事实检查点与来源关系；事实不足时不进入决策。' : 'Mission 绑定当前店铺、数据批次、策略版本和观察窗口；任何状态写入都使用 revision CAS。'}
            eyebrow="MISSION CONTROL"
            primaryAction={{
              actionId: factsView ? 'missions.checkpoint.create' : 'missions.mission.create',
              disabled: factsView ? (!selected || !checkpointReady || busy) : (!actionReady('create') || busy),
              disabledReason: !api ? 'Mission production window API 未接入。' : blockedReason,
              label: factsView ? '记录事实检查点' : '新建 Mission',
              onClick: () => factsView
                ? selected && setCheckpointEditor({ stage: 'FACT', title: '', status: 'completed', evidenceCount: '1' })
                : storeContext && setEditor({ mission: null, draft: missionDraft(storeContext) }),
            }}
            secondaryActions={onInspectBoundary ? [{ actionId: 'mission-boundary', label: '查看接入边界', onClick: onInspectBoundary }] : []}
            status={<span className="mission-domain-authority" data-state={viewReady ? expectedCapability : 'BLOCKED'}>{viewReady ? (previewMode ? '仅开发预览' : '生产 Authority') : '已阻断'}</span>}
            title={factsView ? '核验当前 Mission 的事实与来源' : previewMode ? '验证店铺级 Mission 飞行计划' : '推进当前店铺 Mission'}
            tone={blocked ? 'blocked' : 'neutral'}
          >
            {previewMode && <p className="mission-domain-preview-note">显式内存 adapter · Amazon US · USD · 不代表真实执行或回读</p>}
          </TaskBanner>
        )}
        summary={(
          <SummaryStrip
            ariaLabel="Mission 当前权威上下文"
            items={[
              { id: 'store', label: '店铺数据域', value: storeContext ? String(storeContext.storeId) : '等待 Main' },
              { id: 'market', label: '站点 / 币种', value: storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : '等待 Main' },
              { id: 'count', label: factsView ? '事实检查点' : 'Mission', value: phase === 'loading' ? '读取中' : factsView ? `${lineage?.checkpoints.filter((item) => ['FACT', 'ANALYSIS'].includes(item.stage)).length ?? 0} 条` : `${missions.length} 条` },
              { id: 'authority', label: '数据 Authority', value: api && viewReady ? (previewMode ? '显式 Preview Adapter' : 'Main / SQLite') : '失败关闭', tone: api && viewReady ? 'neutral' : 'blocked' },
            ]}
          />
        )}
      >
        <div className="mission-domain-layout">
          <details className="mission-domain-switcher">
            <summary>
              <span>{factsView ? 'Mission 事实范围' : 'Mission 队列'}</span>
              <strong>{selected?.title ?? (phase === 'loading' ? '读取 Mission Authority' : '等待选择 Mission')}</strong>
              <small>{filtered.length} 条 · 第 {safePage}/{pageCount} 页</small>
            </summary>
            <WorkbenchPanel
              className="mission-domain-queue"
              description="选择 Mission 后查看检查点与完整 lineage。"
              footer={filtered.length ? `第 ${safePage}/${pageCount} 页 · ${filtered.length} 条匹配记录` : '当前筛选没有 Mission。'}
              title={factsView ? 'Mission 事实范围' : 'Mission 队列'}
              toolbar={factsView ? undefined : <button aria-label="新建 Mission" className="workspace-button workspace-button--primary" disabled={!actionReady('create') || busy} onClick={() => storeContext && setEditor({ mission: null, draft: missionDraft(storeContext) })} type="button"><Plus aria-hidden="true" size={16} />新建</button>}
            >
              <div className="mission-domain-queue-tools">
                <input aria-label="搜索 Mission" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索标题、目标、产品或 ID" value={search} />
                <label><input checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} type="checkbox" />查看已归档</label>
              </div>
              {phase === 'loading' && <WorkspaceState description="正在从当前 StoreContext 读取 Mission。" kind="loading" title="读取 Mission Authority" />}
              {blocked && <WorkspaceState description="生产模式不会使用 Renderer 临时数据。" details={error ?? blockedReason} kind="blocked" title="Mission 已失败关闭" />}
              {phase === 'ready' && pageRows.length === 0 && <WorkspaceState description="新建 Mission 后，Agent 会先建立事实基线再推进。" kind="empty" title="当前店铺没有 Mission" />}
              {phase === 'ready' && pageRows.length > 0 && (
                <ul className="mission-domain-queue-list" aria-label="Mission 列表">
                  {pageRows.map((mission) => (
                    <li key={mission.id}><button aria-pressed={mission.id === selected?.id} className="mission-domain-queue-item" data-selected={mission.id === selected?.id || undefined} onClick={() => setSelectedId(mission.id)} type="button">
                        <span><b>{mission.priority}</b><MissionStatus status={mission.status} /></span>
                        <strong>{mission.title}</strong>
                        <small>{mission.productId || '店铺级'} · {PHASE_LABELS[mission.phase]} · r{mission.revision}</small>
                      </button></li>
                  ))}
                </ul>
              )}
              <nav aria-label="Mission 分页" className="mission-domain-pagination"><button aria-label="上一页 Mission" className="workspace-button workspace-button--secondary" disabled={safePage <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><CaretLeft size={15} /></button><span>{safePage} / {pageCount}</span><button aria-label="下一页 Mission" className="workspace-button workspace-button--secondary" disabled={safePage >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><CaretRight size={15} /></button></nav>
            </WorkbenchPanel>
          </details>

          <div className="mission-domain-detail">
            {selected ? (
              <>
                <section className="mission-domain-detail-header">
                  <div><span>MISSION · {selected.id}</span><h2>{selected.title}</h2><p>{selected.objective}</p></div>
                  <MissionStatus status={selected.status} />
                  {!factsView && <div className="mission-domain-actions" role="group" aria-label="Mission CRUD">
                    <button className="workspace-button workspace-button--primary" disabled={!analysisApi || busy || selected.status !== 'active'} onClick={() => void runAnalysis()} title={selected.status !== 'active' ? '只有运行中的 Mission 可以形成正式分析批次。' : undefined} type="button"><FlagBanner size={15} />{pending === 'analysis' ? '分析中…' : '运行分析'}</button>
                    <button className="workspace-button workspace-button--primary" disabled={!actionReady('update') || busy || ['archived', 'completed'].includes(selected.status)} onClick={() => storeContext && setEditor({ mission: selected, draft: missionDraft(storeContext, selected) })} type="button"><PencilSimple size={15} />编辑</button>
                    {selected.status !== 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady(selected.status === 'active' ? 'pause' : 'resume') || busy || selected.status === 'completed'} onClick={() => void transitionMission()} type="button">{selected.status === 'active' ? <Pause size={15} /> : <Play size={15} />}{selected.status === 'active' ? '暂停 Agent' : '恢复 Agent'}</button>}
                    {selected.status !== 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('archive') || busy} onClick={() => setArchiveConfirm(selected)} type="button"><Archive size={15} />归档</button>}
                    {selected.status === 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!actionReady('restore') || busy} onClick={() => void restoreMission()} type="button"><ArrowClockwise size={15} />恢复</button>}
                  </div>}
                </section>

                <dl className="mission-domain-contract" aria-label="Mission 执行合同">
                  <div><dt>观察窗口</dt><dd>{datePart(selected.observationStartsAt)} → {datePart(selected.observationEndsAt)}</dd></div>
                  <div><dt>数据批次</dt><dd>{selected.dataBatchId}</dd></div>
                  <div><dt>策略版本</dt><dd>{selected.policyVersionId}</dd></div>
                  <div><dt>检查点进度</dt><dd>{completedCount} / {activeCheckpoints.length}</dd></div>
                </dl>

                <section className="mission-domain-analysis-authority" aria-label="Mission 分析权威">
                  <header><div><span>ANALYSIS AUTHORITY · US / USD</span><h3>真实分析与不可变建议批次</h3><p>范围由 Main 从 Mission 数据批次推导；Renderer 不能提交路径、规则 revision 或授权限额。</p></div><b data-ready={latestEvidence ? 'true' : 'false'}>{latestEvidence ? '已封存' : '等待分析'}</b></header>
                  {latestEvidence ? <>
                    <dl><div><dt>领星报告</dt><dd>{latestEvidence.reportTypes.length}/8</dd></div><div><dt>指标行</dt><dd>{latestEvidence.metricRowCount}</dd></div><div><dt>数据区间</dt><dd>{latestEvidence.dateFrom} → {latestEvidence.dateTo}</dd></div><div><dt>有效至</dt><dd>{latestEvidence.freshUntil.slice(0, 16).replace('T', ' ')}</dd></div></dl>
                    <div className="mission-domain-proposal-strip" role="list">{latestProposals.map((proposal) => <article key={proposal.id} role="listitem" data-authorizable={proposal.authorization.human.eligible || undefined}><div><strong>{proposal.entityName}</strong><small>{proposal.campaignName} / {proposal.adGroupName}</small></div><b>${(proposal.currentBidCents / 100).toFixed(2)} → ${(proposal.proposedBidCents / 100).toFixed(2)}</b><span>{proposal.source === 'rule_ai' ? '规则 + AI 一致' : proposal.source === 'ai' ? '仅 AI / 人工审批' : proposal.source === 'rule_fallback' ? 'AI 降级 / 不可授权' : '规则建议'}</span><em>{proposal.authorization.human.eligible ? '可进入人工审批' : proposal.authorization.human.blockers.join(' · ')}</em></article>)}</div>
                    <footer><code>{latestEvidence.packageHash.slice(0, 12)}</code><span>Rule {latestEvidence.ruleRevision.slice(0, 8)} · {latestEvidence.modelRevision}</span></footer>
                  </> : <WorkspaceState kind="empty" title="尚未形成真实分析批次" description="运行中的 Mission 会封存当前店铺 8 类领星报表、规则与模型 revision，然后创建可追溯 Decision。" />}
                </section>

                <div className="mission-domain-flight-layout">
                  <section className="mission-domain-flight-plan">
                    <header><div><h3>飞行计划</h3><p>每一步都绑定来源、操作者与证据数量。</p></div><button className="workspace-button workspace-button--secondary" disabled={!checkpointReady || busy || selected.status === 'archived'} onClick={() => setCheckpointEditor({ stage: 'FACT', title: '', status: 'completed', evidenceCount: '1' })} type="button"><Plus size={15} />记录检查点</button></header>
                    <div className="mission-domain-checkpoints" role="list" aria-label="Mission 检查点">
                      {activeCheckpoints.length ? activeCheckpoints.map((checkpoint, index) => {
                        const complete = ['completed', 'done', 'verified', 'success'].includes(checkpoint.status);
                        const current = checkpoint.status === 'active';
                        return <article data-state={complete ? 'complete' : current ? 'current' : checkpoint.status === 'blocked' ? 'blocked' : 'waiting'} key={checkpoint.id} role="listitem"><span>{complete ? <CheckCircle size={18} weight="fill" /> : current ? <Clock size={18} /> : <Circle size={18} />}</span><time>{String(index + 1).padStart(2, '0')}</time><div><strong>{checkpoint.title}</strong><small>{checkpoint.stage} · {checkpoint.actorId}</small></div><b>{checkpoint.evidenceCount} 条证据</b></article>;
                      }) : <WorkspaceState description="可追加第一个事实检查点；已有记录不会被覆盖。" kind="empty" title="尚无检查点" />}
                    </div>
                  </section>
                  <aside className="mission-domain-agent-state">
                    <header><FlagBanner size={20} weight="duotone" /><div><h3>Agent 当前状态</h3><p>{STATUS_LABELS[selected.status]}</p></div></header>
                    <div className="mission-domain-stage-list">
                      {(['fact', 'analysis', 'decision', 'action', 'readback', 'effect'] as const).map((item, index) => <div data-state={index < currentPhaseIndex ? 'done' : index === currentPhaseIndex ? 'current' : 'waiting'} key={item}>{index < currentPhaseIndex ? <CheckCircle size={16} weight="fill" /> : <Circle size={16} />}<strong>{PHASE_LABELS[item]}</strong><span>{index < currentPhaseIndex ? '完成' : index === currentPhaseIndex ? '当前' : '待开始'}</span></div>)}
                    </div>
                    <section><h4>成功标准</h4><ul>{selected.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <section><h4>守护栏</h4><ul>{selected.guardrails.map((item) => <li key={item}>{item}</li>)}</ul></section>
                  </aside>
                </div>

                <section className="mission-domain-lineage">
                  <header><div><h3>Mission Lineage</h3><p>从数据批次与策略版本一直追溯到决策、实验、执行和结果。</p></div><LinkSimple size={19} /></header>
                  <div role="list">{lineage?.links.length ? lineage.links.map((link) => <article key={link.id} role="listitem"><span>{LINK_LABELS[link.linkType]}</span><strong>{link.targetId}</strong><small>{link.relation} · {link.actorId}</small></article>) : <p>当前 Mission 尚无 lineage 记录。</p>}</div>
                </section>
              </>
            ) : phase === 'ready' ? <WorkspaceState description="从左侧选择 Mission，或新建当前店铺的第一个 Mission。" kind="empty" title="等待选择 Mission" /> : null}
          </div>
        </div>
        {(error || feedback) && <p aria-live="polite" className="mission-domain-feedback" data-tone={error ? 'error' : 'success'}>{error || feedback}</p>}
      </PageFrame>

      {editor && <MissionEditor busy={pending === 'save'} editor={editor} onCancel={() => setEditor(null)} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onSave={() => void saveMission()} />}
      {checkpointEditor && <CheckpointEditor busy={pending === 'checkpoint'} draft={checkpointEditor} onCancel={() => setCheckpointEditor(null)} onChange={setCheckpointEditor} onSave={() => void appendCheckpoint()} />}
      {archiveConfirm && <div className="mission-control-dialog-backdrop"><section aria-labelledby="mission-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>ARCHIVE MISSION</span><h2 id="mission-archive-title">归档“{archiveConfirm.title}”？</h2><p>Mission 会退出默认队列，但检查点、决策、执行与因果链仍永久保留。</p></div></header><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setArchiveConfirm(null)} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archiveMission()} type="button"><Archive size={15} />确认归档</button></footer></section></div>}
    </div>
  );
}
