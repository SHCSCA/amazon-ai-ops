import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  ArrowBendDownRight,
  ArrowRight,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  Database,
  Funnel,
  LockKey,
  NotePencil,
  Plus,
  Target,
  TreeStructure,
  X,
} from '@phosphor-icons/react';
import {
  CAUSAL_LEDGER_STAGES,
  missionControlContextKey,
  type AppendCausalEventInput,
  type CausalEventRecord,
  type CausalLedgerStage,
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import {
  assertCausalEventBelongsToContext,
  assertMissionAuthorityContext,
  readMemoryDomainWindowApi,
  type MemoryDomainRendererApi,
} from './mission-domain-window-api';
import './memory-workspace.css';

const PAGE_SIZE = 10;
const OPERATOR = 'desktop-operator';
const RENDERER_WRITABLE_STAGES: readonly CausalLedgerStage[] = ['FACT', 'ANALYSIS'];

const STAGE_COPY: Record<CausalLedgerStage, { label: string; description: string; authority: string }> = {
  FACT: { label: '事实', description: '数据、观察与可复核信号。', authority: 'Renderer 可追加' },
  ANALYSIS: { label: '分析', description: '基于事实形成的解释与假设。', authority: 'Renderer 可追加' },
  DECISION: { label: '决策', description: '已固化的 Crux Decision 与人工决议。', authority: 'Main-only 只读' },
  ACTION: { label: '动作', description: '真实浏览器写入和执行状态。', authority: 'Main-only 只读' },
  READBACK: { label: '回读', description: 'Before / After / Reload 证据。', authority: 'Main-only 只读' },
  EFFECT: { label: '效果', description: '观察窗口结果与经营影响。', authority: 'Main-only 只读' },
};

export type MemoryDraft = {
  stage: Extract<CausalLedgerStage, 'FACT' | 'ANALYSIS'>;
  eventType: string;
  entityType: string;
  entityId: string;
  missionId: string;
  title: string;
  signal: string;
  expectedEffect: string;
  confidence: string;
  status: string;
  correctsEventId: string;
  correctionLineage: {
    stage: Extract<CausalLedgerStage, 'FACT' | 'ANALYSIS'>;
    entityType: string;
    entityId: string;
    missionId?: string;
  } | null;
};

export type MemoryWorkspaceProps = {
  apiOverride?: MemoryDomainRendererApi;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
};

function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '因果记忆操作未完成，请刷新当前店铺后重试。';
}

function capabilityReady(
  rows: readonly MissionControlCapabilityProjection[] | undefined,
  capabilityId: string,
  previewMode: boolean,
): boolean {
  const projection = rows?.find((item) => item.capabilityId === capabilityId);
  return projection?.state === (previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE');
}

export function memoryDraftFor(target?: CausalEventRecord | null): MemoryDraft {
  const stage = target && RENDERER_WRITABLE_STAGES.includes(target.stage)
    ? target.stage as MemoryDraft['stage']
    : 'FACT';
  return {
    stage,
    eventType: target ? `${target.eventType}_correction` : 'operator_fact',
    entityType: target?.entityType ?? 'operation_note',
    entityId: target?.entityId ?? '',
    missionId: target?.missionId ?? '',
    title: target ? `修正：${target.title}` : '',
    signal: '',
    expectedEffect: '',
    confidence: target?.confidence === undefined ? '' : String(target.confidence),
    status: 'recorded',
    correctsEventId: target?.id ?? '',
    correctionLineage: target && RENDERER_WRITABLE_STAGES.includes(target.stage) ? {
      stage: target.stage as MemoryDraft['stage'],
      entityType: target.entityType,
      entityId: target.entityId,
      ...(target.missionId ? { missionId: target.missionId } : {}),
    } : null,
  };
}

export function buildManualCausalEventInput(draft: MemoryDraft, id: string): AppendCausalEventInput {
  const lineage = draft.correctsEventId ? draft.correctionLineage : null;
  if (draft.correctsEventId && !lineage) {
    throw new Error('修正事件缺少不可变 lineage，已失败关闭。');
  }
  const stage = lineage?.stage ?? draft.stage;
  const entityType = lineage?.entityType ?? draft.entityType;
  const entityId = lineage?.entityId ?? draft.entityId;
  const missionId = lineage?.missionId ?? (lineage ? '' : draft.missionId);
  if (!RENDERER_WRITABLE_STAGES.includes(stage)) {
    throw new Error('Renderer 只能追加 FACT 或 ANALYSIS。');
  }
  if (!draft.eventType.trim() || !entityType.trim() || !entityId.trim() || !draft.title.trim()) {
    throw new Error('请填写事件类型、对象类型、对象 ID 与标题。');
  }
  const confidence = draft.confidence.trim() ? Number(draft.confidence) : undefined;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new Error('置信度必须在 0–1 之间。');
  }
  return {
    id,
    stage,
    eventType: draft.eventType.trim(),
    entityType: entityType.trim(),
    entityId: entityId.trim(),
    ...(missionId?.trim() ? { missionId: missionId.trim() } : {}),
    title: draft.title.trim(),
    ...(draft.signal.trim() ? { signal: draft.signal.trim() } : {}),
    ...(draft.expectedEffect.trim() ? { expectedEffect: draft.expectedEffect.trim() } : {}),
    ...(confidence === undefined ? {} : { confidence }),
    status: draft.status.trim() || 'recorded',
    source: 'mission-domain-ui',
    actorId: OPERATOR,
    ...(draft.correctsEventId ? { correctsEventId: draft.correctsEventId } : {}),
  };
}

function StageTag({ stage }: { stage: CausalLedgerStage }) {
  return <span className="memory-stage-tag" data-stage={stage}>{stage}</span>;
}

export function MemoryEditor({
  busy,
  draft,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  draft: MemoryDraft;
  onCancel: () => void;
  onChange: (draft: MemoryDraft) => void;
  onSave: () => void;
}) {
  const correction = Boolean(draft.correctsEventId);
  const change = <K extends keyof MemoryDraft>(key: K, value: MemoryDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="mission-control-dialog-backdrop">
      <section aria-labelledby="memory-editor-title" aria-modal="true" className="mission-control-dialog memory-editor" role="dialog">
        <header><div><span>{correction ? 'APPEND CORRECTION' : 'APPEND MEMORY'}</span><h2 id="memory-editor-title">{correction ? '追加修正事件' : '记录事实或分析'}</h2><p>{correction ? `原事件 ${draft.correctsEventId} 不会被覆盖。` : 'Renderer 只允许追加 FACT / ANALYSIS；其余阶段由 Main 的业务动作产生。'}</p></div><button aria-label="关闭因果记忆编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></button></header>
        <div className="memory-form">
          <label><span>阶段 *</span><select disabled={correction} onChange={(event) => change('stage', event.target.value as MemoryDraft['stage'])} value={draft.stage}><option value="FACT">FACT · 事实</option><option value="ANALYSIS">ANALYSIS · 分析</option></select></label>
          <label><span>状态 *</span><input onChange={(event) => change('status', event.target.value)} value={draft.status} /></label>
          <label><span>事件类型 *</span><input onChange={(event) => change('eventType', event.target.value)} placeholder="operator_fact" value={draft.eventType} /></label>
          <label><span>Mission ID</span><input disabled={correction} onChange={(event) => change('missionId', event.target.value)} placeholder="MISSION-..." value={draft.missionId} /></label>
          <label><span>对象类型 *</span><input disabled={correction} onChange={(event) => change('entityType', event.target.value)} placeholder="data_batch / experiment" value={draft.entityType} /></label>
          <label><span>对象 ID *</span><input disabled={correction} onChange={(event) => change('entityId', event.target.value)} value={draft.entityId} /></label>
          <label className="memory-form__wide"><span>标题 *</span><input autoFocus onChange={(event) => change('title', event.target.value)} value={draft.title} /></label>
          <label className="memory-form__wide"><span>信号 / 依据</span><textarea onChange={(event) => change('signal', event.target.value)} rows={4} value={draft.signal} /></label>
          <label className="memory-form__wide"><span>预期效果</span><textarea onChange={(event) => change('expectedEffect', event.target.value)} rows={3} value={draft.expectedEffect} /></label>
          <label><span>置信度（0–1）</span><input inputMode="decimal" onChange={(event) => change('confidence', event.target.value)} value={draft.confidence} /></label>
          {correction && <label><span>修正原事件</span><input disabled value={draft.correctsEventId} /></label>}
        </div>
        <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '追加中...' : correction ? '追加修正' : '追加事件'}</button></footer>
      </section>
    </div>
  );
}

export function MemoryWorkspace({
  apiOverride,
  blockedReason,
  capabilities,
  onInspectBoundary,
  previewMode,
  storeContext,
}: MemoryWorkspaceProps) {
  const api = useMemo(() => apiOverride ?? readMemoryDomainWindowApi(), [apiOverride]);
  const expectedCapability = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const viewReady = capabilityReady(capabilities, 'memory.timeline.view', previewMode);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : 'missing';
  const currentAuthorityKey = useRef(authorityKey);
  const requestSequence = useRef(0);
  const mutationSequence = useRef(0);
  const idSequence = useRef(0);
  const [events, setEvents] = useState<CausalEventRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'blocked' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<CausalLedgerStage | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<MemoryDraft | null>(null);

  currentAuthorityKey.current = authorityKey;
  const selected = events.find((event) => event.id === selectedId) ?? null;
  const busy = pending !== null;
  const blocked = phase === 'blocked' || phase === 'error';
  const actionReady = (capabilityId: string) => capabilityReady(capabilities, capabilityId, previewMode);

  const load = async () => {
    const sequence = ++requestSequence.current;
    const capturedKey = authorityKey;
    if (!storeContext || !viewReady) {
      setEvents([]);
      setSelectedId('');
      setPhase('blocked');
      setError(!storeContext ? 'StoreContext 尚未建立，因果记忆已失败关闭。' : blockedReason);
      return;
    }
    if (!api) {
      setEvents([]);
      setSelectedId('');
      setPhase('blocked');
      setError('Causal Memory production window API 未接入；Renderer 不会回退到示例时间线。');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      assertMissionAuthorityContext(storeContext);
      const rows = await api.listCausalEvents(storeContext);
      if (currentAuthorityKey.current !== capturedKey || requestSequence.current !== sequence) return;
      rows.forEach((event) => assertCausalEventBelongsToContext(event, storeContext));
      setEvents(rows);
      setSelectedId((current) => rows.some((event) => event.id === current) ? current : rows[0]?.id ?? '');
      setPhase('ready');
    } catch (loadError) {
      if (currentAuthorityKey.current !== capturedKey || requestSequence.current !== sequence) return;
      setEvents([]);
      setSelectedId('');
      setPhase('error');
      setError(message(loadError));
    }
  };

  useEffect(() => {
    setEditor(null);
    setPage(1);
    setStageFilter('ALL');
    void load();
    // Authority changes intentionally reset local selection and forms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authorityKey, viewReady]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return events.filter((event) => (stageFilter === 'ALL' || event.stage === stageFilter)
      && (!needle || [event.id, event.title, event.eventType, event.entityType, event.entityId, event.missionId, event.signal, event.observedEffect]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))));
  }, [events, search, stageFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const append = async () => {
    if (!api || !storeContext || !editor || pending || !viewReady) return;
    const correction = Boolean(editor.correctsEventId);
    const exactCapability = correction ? 'memory.timeline.correct' : 'memory.timeline.create';
    if (!actionReady(exactCapability)) {
      setError(`缺少精确能力 ${exactCapability}，追加已阻断。`);
      return;
    }
    let input: AppendCausalEventInput;
    try {
      input = buildManualCausalEventInput(editor, `CAUSAL-${String(storeContext.storeId)}-${Date.now()}-${++idSequence.current}`);
    } catch (validationError) {
      setError(message(validationError));
      return;
    }
    const capturedKey = missionControlContextKey(storeContext);
    const sequence = ++mutationSequence.current;
    setPending(correction ? 'correct' : 'create');
    setError(null);
    setFeedback('');
    try {
      const saved = await api.appendManualCausalEvent(storeContext, input);
      if (currentAuthorityKey.current !== capturedKey || mutationSequence.current !== sequence) return;
      assertCausalEventBelongsToContext(saved, storeContext);
      setEvents((current) => [saved, ...current]);
      setSelectedId(saved.id);
      setEditor(null);
      setFeedback(correction ? '修正事件已追加；原事件保持不变。' : `${saved.stage} 事件已追加到当前店铺因果链。`);
    } catch (appendError) {
      if (currentAuthorityKey.current === capturedKey && mutationSequence.current === sequence) setError(message(appendError));
    } finally {
      if (currentAuthorityKey.current === capturedKey && mutationSequence.current === sequence) setPending(null);
    }
  };

  const stageCounts = Object.fromEntries(CAUSAL_LEDGER_STAGES.map((stage) => [stage, events.filter((event) => event.stage === stage).length])) as Record<CausalLedgerStage, number>;
  const canCorrectSelected = Boolean(selected && RENDERER_WRITABLE_STAGES.includes(selected.stage));

  return (
    <div className="mission-control-workspace-root memory-workspace" data-canonical-surface="memory" data-capability-state={viewReady ? expectedCapability : 'BLOCKED'} data-preview-mode={previewMode || undefined}>
      <PageFrame
        className="memory-page"
        description="按店铺追溯 FACT → ANALYSIS → DECISION → ACTION → READBACK → EFFECT，并以追加修正保护历史。"
        pageId="memory-timeline"
        title="因果记忆"
        task={<TaskBanner compact description="保留事实、干预、回读与效果之间的关系；运营者只可追加 FACT / ANALYSIS。" eyebrow="CAUSAL MEMORY" primaryAction={{ actionId: 'memory.timeline.create', disabled: !actionReady('memory.timeline.create') || busy || !storeContext, disabledReason: blockedReason, label: '记录事实 / 分析', onClick: () => setEditor(memoryDraftFor()) }} secondaryActions={onInspectBoundary ? [{ actionId: 'memory-boundary', label: '接入边界', onClick: onInspectBoundary }] : []} status={<span className="memory-authority" data-state={viewReady ? expectedCapability : 'BLOCKED'}>{viewReady ? previewMode ? '显式开发预览 · US / USD' : 'Main / SQLite · US / USD' : '已阻断'}</span>} title="因果记忆" tone={blocked ? 'blocked' : 'neutral'}>{previewMode && <p className="memory-preview-note">内存 adapter · 店铺切换即隔离</p>}</TaskBanner>}
        summary={<SummaryStrip ariaLabel="因果记忆当前权威上下文" items={[
          { id: 'events', label: '记忆记录', value: `${events.length}` },
          { id: 'readback', label: '已回读验证', value: `${stageCounts.READBACK}` },
          { id: 'effects', label: '可复用效果', value: `${stageCounts.EFFECT}` },
          { id: 'store', label: '当前店铺', value: storeContext ? String(storeContext.storeId) : '等待 Main', tone: api && viewReady ? 'neutral' : 'blocked' },
        ]} />}
      >
        <section aria-label="因果阶段权限" className="memory-stage-rail">{CAUSAL_LEDGER_STAGES.map((stage, index) => <React.Fragment key={stage}><button aria-label={`${STAGE_COPY[stage].label}，${stageCounts[stage]} 条，${STAGE_COPY[stage].authority}`} aria-pressed={stageFilter === stage} data-active={stageFilter === stage || undefined} data-stage={stage} onClick={() => { setStageFilter(stage); setPage(1); }} title={`${STAGE_COPY[stage].description} ${STAGE_COPY[stage].authority}`} type="button"><StageTag stage={stage} /><strong>{STAGE_COPY[stage].label}</strong><small>{stageCounts[stage]} 条</small><span>{STAGE_COPY[stage].authority}{!RENDERER_WRITABLE_STAGES.includes(stage) && <LockKey size={11} />}</span></button>{index < CAUSAL_LEDGER_STAGES.length - 1 && <ArrowBendDownRight aria-hidden="true" className="memory-stage-arrow" size={16} />}</React.Fragment>)}</section>
        <div className="memory-layout">
          <WorkbenchPanel className="memory-timeline" description="按 sequence 读取 Main 的 append-only ledger。" footer={filtered.length ? `第 ${safePage}/${pageCount} 页 · ${filtered.length} 条匹配事件` : '当前筛选没有事件。'} title="因果时间线" toolbar={<button className="workspace-button workspace-button--secondary" onClick={() => { setStageFilter('ALL'); setSearch(''); setPage(1); }} type="button"><Funnel size={15} />全部阶段</button>}>
            <div className="memory-search"><input aria-label="搜索因果记忆" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索标题、Mission、对象或信号" value={search} /><button className="workspace-button workspace-button--primary" disabled={!actionReady('memory.timeline.create') || busy} onClick={() => setEditor(memoryDraftFor())} type="button"><Plus size={15} />追加</button></div>
            {phase === 'loading' && <WorkspaceState description="正在从当前 StoreContext 读取因果事件。" kind="loading" title="读取 Causal Ledger" />}
            {blocked && <WorkspaceState description="生产模式不会使用 Renderer 临时时间线。" details={error ?? blockedReason} kind="blocked" title="因果记忆已失败关闭" />}
            {phase === 'ready' && !pageRows.length && <WorkspaceState description="可追加第一条 FACT 或 ANALYSIS；Main-only 阶段保持只读。" kind="empty" title="当前筛选没有因果事件" />}
            {phase === 'ready' && Boolean(pageRows.length) && <><div aria-hidden="true" className="memory-list-columns"><span>序列</span><span>类型 / 因果记录</span><span>时间 / 来源</span></div><ul aria-label="因果记忆事件" className="memory-event-list">{pageRows.map((event) => <li key={event.id}><button aria-pressed={event.id === selected?.id} data-selected={event.id === selected?.id || undefined} data-stage={event.stage} onClick={() => setSelectedId(event.id)} type="button"><span className="memory-event-sequence">#{event.sequence}</span><span className="memory-event-node" /><div><span><StageTag stage={event.stage} /><small>{event.eventType}</small></span><strong>{event.title}</strong><p>{event.signal || event.intervention || event.observedEffect || event.expectedEffect || '结构化事件已记录'}</p></div><small className="memory-event-meta">{event.createdAt.slice(0, 16).replace('T', ' ')}<br />{event.actorId}</small></button></li>)}</ul></>}
            <nav aria-label="因果事件分页" className="memory-pagination"><button aria-label="上一页因果事件" className="workspace-button workspace-button--secondary" disabled={safePage <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><CaretLeft size={15} /></button><span>{safePage} / {pageCount}</span><button aria-label="下一页因果事件" className="workspace-button workspace-button--secondary" disabled={safePage >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><CaretRight size={15} /></button></nav>
          </WorkbenchPanel>

          <aside className="memory-inspector">
            {selected ? <>
              <header><div><span>EVENT · #{selected.sequence}</span><h2>{selected.title}</h2><p>{selected.eventType}</p></div><StageTag stage={selected.stage} /></header>
              <section aria-label="当前事件因果链" className="memory-causal-chain"><article><span><Database size={16} /></span><small>信号 / 事实</small><strong>{selected.signal || '—'}</strong></article><ArrowRight aria-hidden="true" size={15} /><article><span><Target size={16} /></span><small>决策 / 干预</small><strong>{selected.intervention || '—'}</strong></article><ArrowRight aria-hidden="true" size={15} /><article><span><ArrowClockwise size={16} /></span><small>回读 / 效果</small><strong>{selected.observedEffect || '—'}</strong></article></section>
              <dl><div><dt>对象</dt><dd>{selected.entityType} / {selected.entityId}</dd></div><div><dt>Mission</dt><dd>{selected.missionId || '未绑定'}</dd></div><div><dt>业务日期</dt><dd>{selected.businessDate}</dd></div><div><dt>会话代次</dt><dd>{selected.sessionGeneration}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>操作者</dt><dd>{selected.actorId}</dd></div></dl>
              <div className="memory-event-fields">{selected.signal && <article><span>SIGNAL</span><p>{selected.signal}</p></article>}{selected.intervention && <article><span>INTERVENTION</span><p>{selected.intervention}</p></article>}{selected.expectedEffect && <article><span>EXPECTED EFFECT</span><p>{selected.expectedEffect}</p></article>}{selected.observedEffect && <article><span>OBSERVED EFFECT</span><p>{selected.observedEffect}</p></article>}{selected.confidence !== undefined && <article><span>CONFIDENCE</span><p>{Math.round(selected.confidence * 100)}%</p></article>}</div>
              {selected.correctsEventId && <p className="memory-correction-link"><ClockCounterClockwise size={15} />修正事件：{selected.correctsEventId}</p>}
              <section className="memory-authority-card" data-writable={canCorrectSelected || undefined}>{canCorrectSelected ? <NotePencil size={19} /> : <LockKey size={19} />}<div><strong>{canCorrectSelected ? '可追加修正' : 'Main-only 历史'}</strong><p>{canCorrectSelected ? '原事件不可编辑或删除；修正将建立 correctsEventId。' : `${selected.stage} 由 Main 的业务动作产生，Renderer 只读。`}</p></div></section>
              <div className="memory-actions"><button className="workspace-button workspace-button--primary" disabled={!canCorrectSelected || !actionReady('memory.timeline.correct') || busy} onClick={() => selected && setEditor(memoryDraftFor(selected))} type="button"><ClockCounterClockwise size={15} />追加修正</button></div>
            </> : phase === 'ready' ? <WorkspaceState description="从左侧选择一个因果事件查看完整来源和写入边界。" kind="empty" title="等待选择事件" /> : null}
          </aside>
        </div>
        <section className="memory-boundary-note"><TreeStructure size={19} /><div><strong>因果记忆不是可编辑日志</strong><p>没有“编辑”或“删除”。事实错误用 correction 追加；DECISION / ACTION / READBACK / EFFECT 由对应 Main 权威动作写入。</p></div><CheckCircle size={18} /></section>
        {(error || feedback) && <p aria-live="polite" className="memory-feedback" data-tone={error ? 'error' : 'success'}>{error || feedback}</p>}
      </PageFrame>
      {editor && <MemoryEditor busy={Boolean(pending)} draft={editor} onCancel={() => setEditor(null)} onChange={setEditor} onSave={() => void append()} />}
    </div>
  );
}
