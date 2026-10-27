import { MissionActionButton } from './mission-action-feedback';
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
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import {
  STATUS_LABELS,
} from './mission-workspace-model';
import {
  type MissionDependencies,
  type MissionEditorState,
  type MissionDraft,
  type CheckpointDraft,
} from './mission-workspace-contracts';

export function MissionStatus({ status }: { status: MissionLifecycleStatus }) {
  return <span className="mission-domain-status" data-status={status}>{STATUS_LABELS[status]}</span>;
}

export function MissionEditor({
  busy,
  dependencies,
  editor,
  onCancel,
  onChange,
  onNavigate,
  onSave,
}: {
  busy: boolean;
  dependencies: MissionDependencies;
  editor: MissionEditorState;
  onCancel: () => void;
  onChange: (draft: MissionDraft) => void;
  onNavigate: (target: unknown) => void;
  onSave: () => void;
}) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onCancel, dismissDisabled: busy,
  });
  const update = <K extends keyof MissionDraft>(key: K, value: MissionDraft[K]) => {
    onChange({ ...editor.draft, [key]: value });
  };
  const lockId = React.useId();
  const batchReason = editor.mission ? '已创建任务的数据批次固定；变更经营范围请新建任务。' : dependencies.loading ? '正在读取当前店铺数据批次，请等待完成。' : '当前店铺没有已完成数据批次，请先采集并导入报表。';
  const policyReason = editor.mission ? '已创建任务的策略版本固定；变更策略请新建任务。' : dependencies.loading ? '正在读取当前店铺策略，请等待完成。' : '当前店铺没有已启用策略，请先启用策略。';
  const productReason = dependencies.loading ? '正在读取当前店铺产品，请等待完成。' : '当前店铺没有可用产品，请先添加产品。';
  return (
    <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
      <section aria-labelledby="mission-editor-title" aria-modal="true" className="mission-control-dialog mission-domain-editor" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
        <header>
          <div>
            <span>运营任务 · Amazon 美国站 / USD</span>
            <h2 id="mission-editor-title">{editor.mission ? '编辑运营任务' : '新建运营任务'}</h2>
            <p>数据批次、策略版本和产品只从当前店铺真实记录中选择。</p>
          </div>
          <MissionActionButton disabledReason={'正在保存当前记录，完成后可关闭。'} aria-label="关闭运营任务编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X aria-hidden="true" size={18} /></MissionActionButton>
        </header>
        <div className="mission-domain-dependency-gates" aria-label="运营任务创建条件">
          {!dependencies.batches.length && <p><span>当前店铺没有已完成数据批次。</span><button onClick={() => onNavigate('data-collection')} type="button">先采集</button></p>}
          {!dependencies.policyVersions.length && <p><span>当前店铺没有已启用策略版本。</span><button onClick={() => onNavigate({ workspace: 'policy', subview: 'rules' })} type="button">先启用策略</button></p>}
          {!dependencies.products.length && <p><span>当前店铺没有可用产品。</span><button onClick={() => onNavigate('product-management')} type="button">先添加产品</button></p>}
        </div>
        {busy && <p className="muted-line" id={`${lockId}-busy`}>正在保存当前任务，字段暂时锁定；完成或失败后可继续编辑。</p>}
        <fieldset className="mission-domain-form" disabled={busy} aria-describedby={busy ? `${lockId}-busy` : undefined} style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="mission-domain-form__wide"><span>任务标题 *</span><input data-overlay-initial-focus onChange={(event) => update('title', event.target.value)} placeholder="例如：控制核心词浪费并稳定订单" value={editor.draft.title} /></label>
          <label className="mission-domain-form__wide"><span>经营目标 *</span><textarea onChange={(event) => update('objective', event.target.value)} placeholder="写明希望改善的指标、范围和结果" rows={3} value={editor.draft.objective} /></label>
          <label><span>已完成数据批次 *</span><select aria-label="已完成数据批次 *" aria-describedby={editor.mission || dependencies.loading || !dependencies.batches.length ? `${lockId}-batch` : undefined} disabled={Boolean(editor.mission) || dependencies.loading || !dependencies.batches.length} onChange={(event) => update('dataBatchId', event.target.value)} value={editor.draft.dataBatchId}><option value="">请选择已完成批次</option>{dependencies.batches.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{(editor.mission || dependencies.loading || !dependencies.batches.length) && <small id={`${lockId}-batch`}>{batchReason}</small>}</label>
          <label><span>已启用策略 *</span><select aria-label="已启用策略 *" aria-describedby={editor.mission || dependencies.loading || !dependencies.policyVersions.length ? `${lockId}-policy` : undefined} disabled={Boolean(editor.mission) || dependencies.loading || !dependencies.policyVersions.length} onChange={(event) => update('policyVersionId', event.target.value)} value={editor.draft.policyVersionId}><option value="">请选择已启用策略</option>{dependencies.policyVersions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{(editor.mission || dependencies.loading || !dependencies.policyVersions.length) && <small id={`${lockId}-policy`}>{policyReason}</small>}</label>
          <label><span>关联产品 *</span><select aria-label="关联产品 *" aria-describedby={dependencies.loading || !dependencies.products.length ? `${lockId}-product` : undefined} disabled={dependencies.loading || !dependencies.products.length} onChange={(event) => update('productId', event.target.value)} value={editor.draft.productId}><option value="">请选择当前店铺产品</option>{dependencies.products.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{(dependencies.loading || !dependencies.products.length) && <small id={`${lockId}-product`}>{productReason}</small>}</label>
          <label><span>优先级</span><select onChange={(event) => update('priority', event.target.value as MissionPriority)} value={editor.draft.priority}><option value="P0">P0 · 紧急</option><option value="P1">P1 · 高</option><option value="P2">P2 · 中</option><option value="P3">P3 · 低</option></select></label>
          <label><span>观察开始 *</span><input onChange={(event) => update('observationStartsOn', event.target.value)} type="date" value={editor.draft.observationStartsOn} /></label>
          <label><span>观察结束 *</span><input onChange={(event) => update('observationEndsOn', event.target.value)} type="date" value={editor.draft.observationEndsOn} /></label>
          <label className="mission-domain-form__wide"><span>成功标准 *</span><textarea onChange={(event) => update('successCriteria', event.target.value)} rows={2} value={editor.draft.successCriteria} /><small>多条标准用分号或换行分隔</small></label>
          <label className="mission-domain-form__wide"><span>守护栏 *</span><textarea onChange={(event) => update('guardrails', event.target.value)} rows={2} value={editor.draft.guardrails} /><small>必须包含停止或人工接管条件</small></label>
        </fieldset>
        <footer><MissionActionButton disabledReason={'正在保存当前记录，完成后可关闭。'} className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</MissionActionButton><MissionActionButton disabledReason={busy ? '正在保存运营任务，请等待结果。' : dependencies.loading ? '正在读取当前店铺的产品、报表和策略。' : !dependencies.batches.length || !editor.draft.dataBatchId ? '请先完成并选择当前店铺的八类报表导入。' : !dependencies.policyVersions.length || !editor.draft.policyVersionId ? '请先启用并选择当前店铺策略。' : '请先添加并选择当前店铺产品。'} busy={busy} busyLabel="保存中…" aria-busy={busy || undefined} className="workspace-button workspace-button--primary" disabled={busy || dependencies.loading || !dependencies.batches.length || !dependencies.policyVersions.length || !dependencies.products.length || !editor.draft.dataBatchId || !editor.draft.policyVersionId || !editor.draft.productId} onClick={onSave} type="button"><Check aria-hidden="true" size={16} />{busy ? '保存中…' : '保存运营任务'}</MissionActionButton></footer>
      </section>
    </div>
  );
}

export function CheckpointEditor({
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
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onCancel, dismissDisabled: busy,
  });
  const lockId = React.useId();
  return (
    <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
      <section aria-labelledby="checkpoint-editor-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
        <header><div><span>只追加的任务检查点</span><h2 id="checkpoint-editor-title">记录运营任务检查点</h2><p>检查点只追加，不覆盖已有因果证据。</p></div></header>
        {busy && <p className="muted-line" id={lockId}>正在追加当前任务记录，字段暂时锁定；完成或失败后可继续编辑。</p>}
        <fieldset className="mission-domain-checkpoint-form" disabled={busy} aria-describedby={busy ? lockId : undefined} style={{ border: 0, padding: 0, margin: 0 }}>
          <label><span>阶段</span><select onChange={(event) => onChange({ ...draft, stage: event.target.value as CheckpointDraft['stage'] })} value={draft.stage}><option value="FACT">事实</option><option value="ANALYSIS">分析</option></select><small>界面只能追加事实与分析；决策、动作和回读由系统写入。</small></label>
          <label><span>标题</span><input data-overlay-initial-focus onChange={(event) => onChange({ ...draft, title: event.target.value })} value={draft.title} /></label>
          <label><span>状态</span><select onChange={(event) => onChange({ ...draft, status: event.target.value })} value={draft.status}><option value="completed">已完成</option><option value="active">当前</option><option value="pending">等待</option><option value="blocked">已阻断</option></select></label>
          <label><span>证据数量</span><input min="0" onChange={(event) => onChange({ ...draft, evidenceCount: event.target.value })} type="number" value={draft.evidenceCount} /></label>
        </fieldset>
        <footer><MissionActionButton disabledReason={'正在保存当前记录，完成后可关闭。'} className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</MissionActionButton><MissionActionButton disabledReason={busy ? '正在追加记录，请等待结果。' : '请先填写检查点标题。'} busy={busy} busyLabel="保存中…" className="workspace-button workspace-button--primary" disabled={busy || !draft.title.trim()} onClick={onSave} type="button">追加检查点</MissionActionButton></footer>
      </section>
    </div>
  );
}
