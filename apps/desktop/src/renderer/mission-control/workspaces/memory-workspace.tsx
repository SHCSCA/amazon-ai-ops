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
  DownloadSimple,
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

export interface CausalTimelineDownloadPort {
  download(input: { fileName: string; mimeType: string; content: string }): void;
}

const STAGE_COPY: Record<CausalLedgerStage, { label: string; description: string; authority: string }> = {
  FACT: { label: '事实', description: '数据、观察与可复核信号。', authority: '可人工补充' },
  ANALYSIS: { label: '分析', description: '基于事实形成的解释与假设。', authority: '可人工补充' },
  DECISION: { label: '决策', description: '已确认的经营判断与人工决议。', authority: '系统记录，只读' },
  ACTION: { label: '执行', description: '真实业务操作与执行状态。', authority: '系统记录，只读' },
  READBACK: { label: '结果核验', description: '操作前后与刷新后的核验证据。', authority: '系统记录，只读' },
  EFFECT: { label: '经营效果', description: '观察窗口结果与经营影响。', authority: '系统记录，只读' },
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

function diagnosticMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : String(error ?? '').trim();
}

export function memoryOperatorCopy(value: string | null | undefined, fallback = '—'): string {
  const copy = String(value ?? '').trim();
  if (!copy) return fallback;
  return copy
    .replace(/\bPolicy runtime authority\s+(manual_approval|policy_auto):(closed|open|half_open)\b/gi, (_match, mode: string, state: string) => {
      const modeLabel = mode.toLowerCase() === 'policy_auto' ? '策略内自动' : '人工审批';
      const stateLabel = state.toLowerCase() === 'closed' ? '安全门正常' : state.toLowerCase() === 'open' ? '安全门已阻断' : '安全门待复核';
      return `策略运行状态：${modeLabel} · ${stateLabel}`;
    })
    .replace(/\bPolicy runtime authority\b/gi, '策略运行状态')
    .replace(/\b(manual_approval|policy_auto):(closed|open|half_open)\b/gi, (_match, mode: string, state: string) => {
      const modeLabel = mode.toLowerCase() === 'policy_auto' ? '策略内自动' : '人工审批';
      const stateLabel = state.toLowerCase() === 'closed' ? '安全门正常' : state.toLowerCase() === 'open' ? '安全门已阻断' : '安全门待复核';
      return `${modeLabel} · ${stateLabel}`;
    })
    .replace(/\b(?:CAUSAL|MISSION|EXPERIMENT|DECISION|ACTION|READBACK|EFFECT|BATCH|EXEC|OBS|METRIC|KW)(?::|-)[A-Z0-9:_-]+\b/gi, '内部标识已隐藏')
    .replace(/Before\s*\/\s*After\s*\/\s*Reload/gi, '操作前 / 操作后 / 刷新后')
    .replace(/Crux Decision/gi, '关键经营决策')
    .replace(/Main-only/gi, '系统只读')
    .replace(/append-only ledger/gi, '只追加记录')
    .replace(/Mission ID/gi, '运营任务内部标识')
    .replace(/set_keyword_bid/gi, '调整关键词竞价')
    .replace(/\bRenderer\b/gi, '界面')
    .replace(/\bMain\b/gi, '本机安全进程')
    .replace(/([\u3400-\u9fff])\s+Mission\b/gi, '$1运营任务')
    .replace(/\bMission\b/gi, '运营任务')
    .replace(/\bExperiment\b/gi, '经营实验')
    .replace(/\bsequence\b/gi, '记录顺序')
    .replace(/\bcorrection\b/gi, '修正记录')
    .replace(/\bDECISION\b/gi, '决策')
    .replace(/\bACTION\b/gi, '执行')
    .replace(/\bREADBACK\b/gi, '结果核验')
    .replace(/\bEFFECT\b/gi, '经营效果')
    .replace(/\bFACT\b/gi, '事实')
    .replace(/\bANALYSIS\b/gi, '分析')
    .replace(/\bUNKNOWN\b/gi, '结果不确定')
    .replace(/\brevision\b/gi, '版本')
    .replace(/\bdraft\b/gi, '草稿');
}

export function memoryOperatorMessage(error: unknown): string {
  const raw = diagnosticMessage(error);
  if (/置信度/.test(raw)) {
    return '置信度必须在 0–1 之间。请修正后重试。';
  }
  if (/不能为空|请填写/.test(raw)) {
    return '记录内容不完整。请补全必填项后重试。';
  }
  if (/lineage|修正.*缺少|correctsEventId/i.test(raw)) {
    return '未能确认需要修正的原记录，操作已阻断。请重新选择原记录后重试。';
  }
  if (/只能追加|FACT|ANALYSIS|DECISION|ACTION|READBACK|EFFECT/.test(raw)) {
    return '当前阶段不允许人工补充，操作已阻断。请选择“事实”或“分析”后重试。';
  }
  if (/storecontext|store|profile|店铺|站点|币种/i.test(raw)) {
    return '当前店铺信息校验失败，操作已阻断。请重新选择店铺并刷新后重试。';
  }
  if (/capability|authority|renderer|main|api|bridge|window|production/i.test(raw)) {
    return '因果记忆服务暂不可用，操作已阻断。请刷新后重试；若仍失败，请展开诊断详情排查。';
  }
  if (/timeout|timed out|network|连接|超时/i.test(raw)) {
    return '因果记忆请求未完成。请检查网络后重试；若仍失败，请展开诊断详情排查。';
  }
  return '因果记忆操作未完成。请刷新当前店铺后重试；若仍失败，请展开诊断详情排查。';
}

export function buildMemorySearchIndex(
  context: StoreContextEnvelope,
  events: readonly CausalEventRecord[],
): ReadonlyMap<string, string> {
  missionControlContextKey(context);
  const index = new Map<string, string>();
  for (const event of events) {
    if (String(event.storeId) !== String(context.storeId)) {
      throw new Error('因果记忆包含跨店铺记录，索引重建已阻断。');
    }
    index.set(event.id, [
      event.id,
      event.title,
      event.eventType,
      event.entityType,
      event.entityId,
      event.missionId,
      event.signal,
      event.intervention,
      event.expectedEffect,
      event.observedEffect,
      event.status,
    ].filter(Boolean).join('\n').toLowerCase());
  }
  return index;
}

const browserCausalTimelineDownload: CausalTimelineDownloadPort = {
  download({ fileName, mimeType, content }) {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      throw new Error('当前环境不能创建时间线下载。');
    }
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};

export function exportCausalTimeline(
  context: StoreContextEnvelope,
  events: readonly CausalEventRecord[],
  port: CausalTimelineDownloadPort = browserCausalTimelineDownload,
): { fileName: string; recordCount: number } {
  const searchIndex = buildMemorySearchIndex(context, events);
  const records = [...events].sort((left, right) => left.sequence - right.sequence);
  const fileName = `amazon-ai-ops-memory-${context.businessDate}.json`;
  const content = `${JSON.stringify({
    formatVersion: 'amazon-ai-ops-causal-memory-v1',
    scope: {
      marketplace: 'US',
      currency: 'USD',
      businessDate: context.businessDate,
    },
    recordCount: records.length,
    records,
    searchTermsByRecord: Object.fromEntries(searchIndex),
  }, null, 2)}\n`;
  port.download({ fileName, mimeType: 'application/json;charset=utf-8', content });
  return { fileName, recordCount: records.length };
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
    title: target ? `修正：${memoryOperatorCopy(target.title)}` : '',
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
  return <span className="memory-stage-tag" data-stage={stage}>{STAGE_COPY[stage].label}</span>;
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
        <header><div><span>{correction ? '补充更正记录' : '补充经营记忆'}</span><h2 id="memory-editor-title">{correction ? '追加修正事件' : '记录事实或分析'}</h2><p>{correction ? '原记录保持不变，本次内容将作为新的修正记录保存。' : '运营者可补充事实或分析；决策、执行、结果核验和经营效果由系统按业务过程记录。'}</p></div><button aria-label="关闭因果记忆编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></button></header>
        <div className="memory-form">
          <label><span>阶段 *</span><select disabled={correction} onChange={(event) => change('stage', event.target.value as MemoryDraft['stage'])} value={draft.stage}><option value="FACT">事实</option><option value="ANALYSIS">分析</option></select></label>
          <label className="memory-form__wide"><span>标题 *</span><input autoFocus onChange={(event) => change('title', event.target.value)} value={draft.title} /></label>
          <label className="memory-form__wide"><span>信号 / 依据</span><textarea onChange={(event) => change('signal', event.target.value)} rows={4} value={draft.signal} /></label>
          <label className="memory-form__wide"><span>预期效果</span><textarea onChange={(event) => change('expectedEffect', event.target.value)} rows={3} value={draft.expectedEffect} /></label>
          <label><span>置信度（0–1）</span><input inputMode="decimal" onChange={(event) => change('confidence', event.target.value)} value={draft.confidence} /></label>
          <details className="memory-form__wide"><summary>诊断详情</summary><div className="memory-form">
            <label><span>状态 *</span><input onChange={(event) => change('status', event.target.value)} value={draft.status} /></label>
            <label><span>事件类型 *</span><input onChange={(event) => change('eventType', event.target.value)} placeholder="operator_fact" value={draft.eventType} /></label>
            <label><span>Mission ID</span><input disabled={correction} onChange={(event) => change('missionId', event.target.value)} placeholder="MISSION-..." value={draft.missionId} /></label>
            <label><span>对象类型 *</span><input disabled={correction} onChange={(event) => change('entityType', event.target.value)} placeholder="data_batch / experiment" value={draft.entityType} /></label>
            <label><span>对象 ID *</span><input disabled={correction} onChange={(event) => change('entityId', event.target.value)} value={draft.entityId} /></label>
            {correction && <label><span>修正原事件</span><input disabled value={draft.correctsEventId} /></label>}
          </div></details>
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
  const [searchIndex, setSearchIndex] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [selectedId, setSelectedId] = useState('');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'blocked' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
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
      setSearchIndex(new Map());
      setSelectedId('');
      setPhase('blocked');
      const reason = !storeContext ? 'StoreContext missing' : blockedReason;
      setError(!storeContext
        ? '尚未选择可核验的店铺，因果记忆已阻断。请先选择店铺后重试。'
        : memoryOperatorMessage(reason));
      setDiagnosticError(reason);
      return;
    }
    if (!api) {
      setEvents([]);
      setSearchIndex(new Map());
      setSelectedId('');
      setPhase('blocked');
      setError('因果记忆服务暂不可用，操作已阻断。请刷新后重试；若仍失败，请展开诊断详情排查。');
      setDiagnosticError('Causal Memory production window API unavailable; Renderer fallback denied.');
      return;
    }
    setPhase('loading');
    setError(null);
    setDiagnosticError(null);
    try {
      assertMissionAuthorityContext(storeContext);
      const rows = await api.listCausalEvents(storeContext);
      if (currentAuthorityKey.current !== capturedKey || requestSequence.current !== sequence) return;
      rows.forEach((event) => assertCausalEventBelongsToContext(event, storeContext));
      setEvents(rows);
      setSearchIndex(buildMemorySearchIndex(storeContext, rows));
      setSelectedId((current) => rows.some((event) => event.id === current) ? current : rows[0]?.id ?? '');
      setPhase('ready');
    } catch (loadError) {
      if (currentAuthorityKey.current !== capturedKey || requestSequence.current !== sequence) return;
      setEvents([]);
      setSearchIndex(new Map());
      setSelectedId('');
      setPhase('error');
      setError(memoryOperatorMessage(loadError));
      setDiagnosticError(diagnosticMessage(loadError));
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
      && (!needle || searchIndex.get(event.id)?.includes(needle)));
  }, [events, search, searchIndex, stageFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const append = async () => {
    if (!api || !storeContext || !editor || pending || !viewReady) return;
    const correction = Boolean(editor.correctsEventId);
    const exactCapability = correction ? 'memory.timeline.correct' : 'memory.timeline.create';
    if (!actionReady(exactCapability)) {
      setError('当前操作权限尚未就绪，追加已阻断。请刷新后重试；若仍失败，请展开诊断详情排查。');
      setDiagnosticError(`Missing exact capability: ${exactCapability}`);
      return;
    }
    let input: AppendCausalEventInput;
    try {
      input = buildManualCausalEventInput(editor, `CAUSAL-${String(storeContext.storeId)}-${Date.now()}-${++idSequence.current}`);
    } catch (validationError) {
      setError(memoryOperatorMessage(validationError));
      setDiagnosticError(diagnosticMessage(validationError));
      return;
    }
    const capturedKey = missionControlContextKey(storeContext);
    const sequence = ++mutationSequence.current;
    setPending(correction ? 'correct' : 'create');
    setError(null);
    setDiagnosticError(null);
    setFeedback('');
    try {
      const saved = await api.appendManualCausalEvent(storeContext, input);
      if (currentAuthorityKey.current !== capturedKey || mutationSequence.current !== sequence) return;
      assertCausalEventBelongsToContext(saved, storeContext);
      setEvents((current) => {
        const next = [saved, ...current];
        setSearchIndex(buildMemorySearchIndex(storeContext, next));
        return next;
      });
      setSelectedId(saved.id);
      setEditor(null);
      setFeedback(correction ? '修正记录已追加，原记录保持不变。' : `${STAGE_COPY[saved.stage].label}记录已追加到当前店铺因果链。`);
    } catch (appendError) {
      if (currentAuthorityKey.current === capturedKey && mutationSequence.current === sequence) {
        setError(memoryOperatorMessage(appendError));
        setDiagnosticError(diagnosticMessage(appendError));
      }
    } finally {
      if (currentAuthorityKey.current === capturedKey && mutationSequence.current === sequence) setPending(null);
    }
  };

  const stageCounts = Object.fromEntries(CAUSAL_LEDGER_STAGES.map((stage) => [stage, events.filter((event) => event.stage === stage).length])) as Record<CausalLedgerStage, number>;
  const canCorrectSelected = Boolean(selected && RENDERER_WRITABLE_STAGES.includes(selected.stage));

  const rebuildSearchIndex = () => {
    if (!storeContext || !actionReady('memory.timeline.rebuild-index')) {
      setError('当前店铺尚未获准重建因果记忆索引。请刷新后重试。');
      return;
    }
    try {
      setSearchIndex(buildMemorySearchIndex(storeContext, events));
      setError(null);
      setFeedback(`搜索索引已从当前店铺 ${events.length} 条真实记录重建。`);
    } catch (indexError) {
      setError(memoryOperatorMessage(indexError));
      setDiagnosticError(diagnosticMessage(indexError));
    }
  };

  const exportTimeline = () => {
    if (!storeContext || !actionReady('memory.timeline.export')) {
      setError('当前店铺尚未获准导出因果时间线。请刷新后重试。');
      return;
    }
    try {
      const result = exportCausalTimeline(storeContext, events);
      setError(null);
      setFeedback(`已导出当前店铺 ${result.recordCount} 条因果记录。`);
    } catch (exportError) {
      setError(memoryOperatorMessage(exportError));
      setDiagnosticError(diagnosticMessage(exportError));
    }
  };

  return (
    <div className="mission-control-workspace-root memory-workspace" data-canonical-surface="memory" data-capability-state={viewReady ? expectedCapability : 'BLOCKED'} data-preview-mode={previewMode || undefined}>
      <PageFrame
        className="memory-page"
        description="按店铺追溯事实、分析、决策、执行、结果核验与经营效果，并以追加修正保护历史。"
        pageId="memory-timeline"
        title="因果记忆"
        task={<TaskBanner compact description="保留事实、干预、结果核验与经营效果之间的关系；运营者可补充事实或分析。" eyebrow="经营记忆" primaryAction={{ actionId: 'memory.timeline.create', disabled: !actionReady('memory.timeline.create') || busy || !storeContext, disabledReason: memoryOperatorMessage(blockedReason), label: '记录事实 / 分析', onClick: () => setEditor(memoryDraftFor()) }} secondaryActions={onInspectBoundary ? [{ actionId: 'memory-boundary', label: '接入边界', onClick: onInspectBoundary }] : []} status={<span className="memory-authority" data-state={viewReady ? expectedCapability : 'BLOCKED'}>{viewReady ? previewMode ? '开发预览 · US / USD' : '本机数据 · US / USD' : '已阻断'}</span>} title="因果记忆" tone={blocked ? 'blocked' : 'neutral'}>{previewMode && <p className="memory-preview-note">预览数据 · 店铺切换即隔离</p>}</TaskBanner>}
        summary={<SummaryStrip ariaLabel="因果记忆当前店铺范围" items={[
          { id: 'events', label: '记忆记录', value: `${events.length}` },
          { id: 'readback', label: '已回读验证', value: `${stageCounts.READBACK}` },
          { id: 'effects', label: '可复用效果', value: `${stageCounts.EFFECT}` },
          { id: 'store', label: '当前店铺', value: storeContext ? '已选择' : '等待选择', tone: api && viewReady ? 'neutral' : 'blocked' },
        ]} />}
      >
        <section aria-label="因果阶段权限" className="memory-stage-rail">{CAUSAL_LEDGER_STAGES.map((stage, index) => <React.Fragment key={stage}><button aria-label={`${STAGE_COPY[stage].label}，${stageCounts[stage]} 条，${STAGE_COPY[stage].authority}`} aria-pressed={stageFilter === stage} data-active={stageFilter === stage || undefined} data-stage={stage} onClick={() => { setStageFilter(stage); setPage(1); }} title={`${STAGE_COPY[stage].description} ${STAGE_COPY[stage].authority}`} type="button"><StageTag stage={stage} /><strong>{STAGE_COPY[stage].label}</strong><small>{stageCounts[stage]} 条</small><span>{STAGE_COPY[stage].authority}{!RENDERER_WRITABLE_STAGES.includes(stage) && <LockKey size={11} />}</span></button>{index < CAUSAL_LEDGER_STAGES.length - 1 && <ArrowBendDownRight aria-hidden="true" className="memory-stage-arrow" size={16} />}</React.Fragment>)}</section>
        <details className="memory-diagnostic-details"><summary>诊断详情</summary><p>Stages: FACT / ANALYSIS / DECISION / ACTION / READBACK / EFFECT. Renderer may append FACT / ANALYSIS; DECISION / ACTION / READBACK / EFFECT are Main-only 只读. Source is an append-only ledger ordered by sequence. Crux Decision values and internal IDs remain diagnostic-only.</p></details>
        <div className="memory-layout">
          <WorkbenchPanel className="memory-timeline" description="按记录时间读取当前店铺的因果记忆。" footer={filtered.length ? `第 ${safePage}/${pageCount} 页 · ${filtered.length} 条匹配记录` : '当前筛选没有记录。'} title="因果时间线" toolbar={<><button className="workspace-button workspace-button--secondary" onClick={() => { setStageFilter('ALL'); setSearch(''); setPage(1); }} type="button"><Funnel size={15} />全部阶段</button><button className="workspace-button workspace-button--secondary" disabled={!actionReady('memory.timeline.rebuild-index') || busy} onClick={rebuildSearchIndex} type="button"><ArrowClockwise size={15} />重建搜索索引</button><button className="workspace-button workspace-button--secondary" disabled={!actionReady('memory.timeline.export') || busy} onClick={exportTimeline} type="button"><DownloadSimple size={15} />导出时间线</button></>}>
            <div className="memory-search"><input aria-label="搜索因果记忆" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索标题、运营任务、对象或信号" value={search} /><button className="workspace-button workspace-button--primary" disabled={!actionReady('memory.timeline.create') || busy} onClick={() => setEditor(memoryDraftFor())} type="button"><Plus size={15} />追加</button></div>
            {phase === 'loading' && <WorkspaceState description="正在读取当前店铺的因果记录，请稍候。" kind="loading" title="读取因果记忆" />}
            {blocked && <WorkspaceState description="不会加载未经核验的临时数据。" details={error ?? '请确认当前店铺后刷新重试。'} kind="blocked" title="因果记忆已失败关闭" />}
            {blocked && <p>请先确认当前店铺，再刷新重试；若仍失败，请展开下方诊断详情。</p>}
            {phase === 'ready' && !pageRows.length && <WorkspaceState description="可追加第一条事实或分析；其余阶段由系统记录并保持只读。" kind="empty" title="当前筛选没有因果记录" />}
            {phase === 'ready' && Boolean(pageRows.length) && <><div aria-hidden="true" className="memory-list-columns"><span>阶段</span><span>因果记录</span><span>记录时间</span></div><ul aria-label="因果记忆记录" className="memory-event-list">{pageRows.map((event) => <li key={event.id}><button aria-pressed={event.id === selected?.id} data-selected={event.id === selected?.id || undefined} data-stage={event.stage} onClick={() => setSelectedId(event.id)} type="button"><span className="memory-event-sequence">{STAGE_COPY[event.stage].label}</span><span className="memory-event-node" /><div><span><StageTag stage={event.stage} /></span><strong>{memoryOperatorCopy(event.title, '未命名记录')}</strong><p>{memoryOperatorCopy(event.signal || event.intervention || event.observedEffect || event.expectedEffect, '结构化记录已保存')}</p></div><small className="memory-event-meta">{event.createdAt.slice(0, 16).replace('T', ' ')}</small></button></li>)}</ul></>}
            <nav aria-label="因果事件分页" className="memory-pagination"><button aria-label="上一页因果事件" className="workspace-button workspace-button--secondary" disabled={safePage <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><CaretLeft size={15} /></button><span>{safePage} / {pageCount}</span><button aria-label="下一页因果事件" className="workspace-button workspace-button--secondary" disabled={safePage >= pageCount || busy} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><CaretRight size={15} /></button></nav>
          </WorkbenchPanel>

          <aside aria-label="因果记忆事件详情" className="memory-inspector" data-scroll-owner="memory-event-detail">
            {selected ? <>
              <header><div><span>因果记录</span><h2>{memoryOperatorCopy(selected.title, '未命名记录')}</h2><p>{STAGE_COPY[selected.stage].description}</p></div><StageTag stage={selected.stage} /></header>
              <section aria-label="当前事件因果链" className="memory-causal-chain"><article><span><Database size={16} /></span><small>信号 / 事实</small><strong>{memoryOperatorCopy(selected.signal)}</strong></article><ArrowRight aria-hidden="true" size={15} /><article><span><Target size={16} /></span><small>决策 / 干预</small><strong>{memoryOperatorCopy(selected.intervention)}</strong></article><ArrowRight aria-hidden="true" size={15} /><article><span><ArrowClockwise size={16} /></span><small>回读 / 效果</small><strong>{memoryOperatorCopy(selected.observedEffect)}</strong></article></section>
              <dl><div><dt>业务日期</dt><dd>{selected.businessDate}</dd></div><div><dt>记录时间</dt><dd>{selected.createdAt.slice(0, 16).replace('T', ' ')}</dd></div></dl>
              <div className="memory-event-fields">{selected.signal && <article><span>信号</span><p>{memoryOperatorCopy(selected.signal)}</p></article>}{selected.intervention && <article><span>干预</span><p>{memoryOperatorCopy(selected.intervention)}</p></article>}{selected.expectedEffect && <article><span>预期效果</span><p>{memoryOperatorCopy(selected.expectedEffect)}</p></article>}{selected.observedEffect && <article><span>实际效果</span><p>{memoryOperatorCopy(selected.observedEffect)}</p></article>}{selected.confidence !== undefined && <article><span>置信度</span><p>{Math.round(selected.confidence * 100)}%</p></article>}</div>
              {selected.correctsEventId && <p className="memory-correction-link"><ClockCounterClockwise size={15} />这是一条修正记录，原记录保持不变。</p>}
              <section className="memory-authority-card" data-writable={canCorrectSelected || undefined}>{canCorrectSelected ? <NotePencil size={19} /> : <LockKey size={19} />}<div><strong>{canCorrectSelected ? '可追加修正' : '系统历史记录'}</strong><p>{canCorrectSelected ? '原记录不可编辑或删除；修正内容将作为新记录保存。' : `${STAGE_COPY[selected.stage].label}由系统业务过程记录，当前仅可查看。`}</p></div></section>
              <details className="memory-diagnostic-details"><summary>诊断详情</summary><dl><div><dt>sequence</dt><dd>{selected.sequence}</dd></div><div><dt>stage</dt><dd>{selected.stage}</dd></div><div><dt>eventType</dt><dd>{selected.eventType}</dd></div><div><dt>entityType / entityId</dt><dd>{selected.entityType} / {selected.entityId}</dd></div><div><dt>Mission ID</dt><dd>{selected.missionId || 'unbound'}</dd></div><div><dt>sessionGeneration</dt><dd>{selected.sessionGeneration}</dd></div><div><dt>source / actorId</dt><dd>{selected.source} / {selected.actorId}</dd></div>{selected.correctsEventId && <div><dt>correctsEventId / correction</dt><dd>{selected.correctsEventId}</dd></div>}</dl></details>
              <div className="memory-actions"><button className="workspace-button workspace-button--primary" disabled={!canCorrectSelected || !actionReady('memory.timeline.correct') || busy} onClick={() => selected && setEditor(memoryDraftFor(selected))} type="button"><ClockCounterClockwise size={15} />追加修正</button></div>
            </> : phase === 'ready' ? <WorkspaceState description="从左侧选择一条因果记录，查看依据、干预与效果。" kind="empty" title="等待选择记录" /> : null}
          </aside>
        </div>
        <section className="memory-boundary-note"><TreeStructure size={19} /><div><strong>因果记忆保留完整历史</strong><p>历史记录不能编辑或删除。事实有误时追加修正；决策、执行、结果核验与经营效果由对应业务过程写入。</p></div><CheckCircle size={18} /></section>
        {diagnosticError && <details className="memory-diagnostic-details"><summary>诊断详情</summary><pre>{diagnosticError}</pre></details>}
        {(error || feedback) && <p aria-live="polite" className="memory-feedback" data-tone={error ? 'error' : 'success'}>{error || feedback}</p>}
      </PageFrame>
      {editor && <MemoryEditor busy={Boolean(pending)} draft={editor} onCancel={() => setEditor(null)} onChange={setEditor} onSave={() => void append()} />}
    </div>
  );
}
