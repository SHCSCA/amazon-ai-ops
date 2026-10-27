import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
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

export function SearchableOptionSelect({ disabled, label, options, required, value, onChange }: {
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

export function ExperimentEditor({
  busy,
  editor,
  options,
  onCancel,
  onChange,
  onNavigate,
  onSave,
}: {
  busy: boolean;
  editor: ExperimentEditorState;
  options: ExperimentSelectorOptions;
  onCancel: () => void;
  onChange: (draft: ExperimentDraft) => void;
  onNavigate: (target: unknown) => void;
  onSave: () => void;
}) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onCancel, dismissDisabled: busy,
  });
  const change = <K extends keyof ExperimentDraft>(key: K, value: ExperimentDraft[K]) => {
    onChange({ ...editor.draft, [key]: value });
  };
  const missionScope = experimentMissionScope(options, editor.draft.missionId);
  const scopeError = experimentDraftScopeError(editor.draft, options);
  const changeMission = (missionId: string) => {
    onChange(bindExperimentDraftToMission(editor.draft, missionId, options));
  };
  return (
    <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
      <section aria-labelledby="experiment-editor-title" aria-modal="true" className="mission-control-dialog experiment-editor" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
        <header>
          <div><span>经营实验 · Amazon 美国站 / USD</span><h2 id="experiment-editor-title">{editor.record ? '编辑经营实验' : '新建经营实验'}</h2><p>一次实验只允许一个主要变量；运营任务和对象只来自当前店铺。</p></div>
          <WorkspaceActionButton disabledReason={'正在保存当前记录，请等待完成后再操作。'} busy={false} busyLabel="处理中…" aria-label="关闭实验编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></WorkspaceActionButton>
        </header>
        <div className="experiment-form">
          {!options.loading && (!options.missions.length || !options.products.length || !options.adObjects.length || (editor.draft.missionId && (!missionScope.products.length || !missionScope.adObjects.length))) && <div aria-label="经营实验前置条件" className="experiment-dependency-gate" role="status">
            {!options.missions.length && <p><span>当前店铺没有可用运营任务，经营实验必须先绑定运营任务。</span><button onClick={() => onNavigate({ workspace: 'missions', subview: 'overview' })} type="button">先创建运营任务</button></p>}
            {!options.products.length && <p><span>当前店铺没有可选产品；需要按产品范围经营时，请先添加产品。经营实验必须绑定当前店铺产品。</span><button onClick={() => onNavigate('product-management')} type="button">先添加产品</button></p>}
            {!options.adObjects.length && <p><span>当前店铺没有可选广告对象；需要对象级实验时，请先采集并导入广告对象。经营实验必须绑定可回读的广告对象。</span><button onClick={() => onNavigate('data-collection')} type="button">先采集广告对象</button></p>}
            {Boolean(editor.draft.missionId && options.products.length && !missionScope.products.length) && <p><span>运营任务绑定的产品当前不可用，经营实验不能改绑其他产品。</span><button onClick={() => onNavigate({ workspace: 'missions', subview: 'overview' })} type="button">修复运营任务产品</button></p>}
            {Boolean(editor.draft.missionId && missionScope.products.length && options.adObjects.length && !missionScope.adObjects.length) && <p><span>运营任务绑定产品下没有可稳定回读的广告对象。</span><button onClick={() => onNavigate('data-collection')} type="button">采集该产品广告对象</button></p>}
          </div>}
          <SearchableOptionSelect disabled={Boolean(editor.record) || options.loading} label="运营任务" onChange={changeMission} options={options.missions} required value={editor.draft.missionId} />
          <SearchableOptionSelect disabled={options.loading} label="主指标" onChange={(value) => change('primaryMetric', value)} options={PRIMARY_METRIC_OPTIONS} required value={editor.draft.primaryMetric} />
          <label className="experiment-form__wide"><span>实验名称 *</span><input data-overlay-initial-focus onChange={(event) => change('name', event.target.value)} placeholder="例如：核心词竞价 -12% 小步实验" value={editor.draft.name} /></label>
          <label className="experiment-form__wide"><span>可证伪假设 *</span><textarea onChange={(event) => change('hypothesis', event.target.value)} rows={3} value={editor.draft.hypothesis} /></label>
          <SearchableOptionSelect disabled label="产品（由运营任务自动绑定）" onChange={(value) => change('productId', value)} options={missionScope.products} required value={editor.draft.productId} />
          <SearchableOptionSelect disabled={options.loading || !missionScope.productId} label="广告对象（活动 > 广告组 > 关键词/投放）" onChange={(value) => change('adEntityId', value)} options={missionScope.adObjects} required value={editor.draft.adEntityId} />
          <label><span>开始日期 *</span><input onChange={(event) => change('observationStartsOn', event.target.value)} type="date" value={editor.draft.observationStartsOn} /></label>
          <label><span>结束日期 *</span><input onChange={(event) => change('observationEndsOn', event.target.value)} type="date" value={editor.draft.observationEndsOn} /></label>
          <fieldset className="experiment-form__wide experiment-guardrail-builder"><legend>守护条件 *</legend><label><span>指标</span><select onChange={(event) => change('guardrailMetrics', event.target.value)} value={editor.draft.guardrailMetrics}>{PRIMARY_METRIC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>比较符</span><select onChange={(event) => change('guardrailComparator', event.target.value as ExperimentDraft['guardrailComparator'])} value={editor.draft.guardrailComparator}><option value="<">小于</option><option value="<=">小于或等于</option><option value=">">大于</option><option value=">=">大于或等于</option></select></label><label><span>基线比例阈值</span><div className="experiment-threshold"><input min="0" onChange={(event) => change('guardrailThreshold', event.target.value)} step="0.1" type="number" value={editor.draft.guardrailThreshold} /><b>%</b></div></label><small>阈值按“结果 ÷ 基线 × 100%”判定；95 表示结果必须至少保留基线的 95%。</small></fieldset>
          <details className="experiment-form__wide experiment-diagnostics"><summary>诊断详情</summary><div className="experiment-diagnostic-grid"><label><span>基线结构</span><textarea className="experiment-json" onChange={(event) => change('baselineJson', event.target.value)} rows={6} value={editor.draft.baselineJson} /></label><label><span>唯一变量结构</span><textarea className="experiment-json" onChange={(event) => change('variantJson', event.target.value)} rows={6} value={editor.draft.variantJson} /></label></div></details>
        </div>
        <footer><WorkspaceActionButton disabledReason={'正在保存当前记录，请等待完成后再操作。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={busy ? '正在保存当前记录，请等待完成后再操作。' : options.loading ? '正在读取当前店铺对象，请稍候。' : scopeError ?? (!editor.draft.primaryMetric ? '请选择主要指标后再保存。' : '请先补齐实验前置条件。')} busy={busy} busyLabel="保存中…" className="workspace-button workspace-button--primary" disabled={busy || options.loading || !editor.draft.primaryMetric || Boolean(scopeError)} onClick={onSave} title={scopeError ?? undefined} type="button">{busy ? '保存中...' : '保存经营实验'}</WorkspaceActionButton></footer>
      </section>
    </div>
  );
}

export function ObservationEditor({
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
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onCancel, dismissDisabled: busy,
  });
  const change = <K extends keyof ObservationDraft>(key: K, value: ObservationDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
      <section aria-labelledby="observation-editor-title" aria-modal="true" className="mission-control-dialog experiment-observation-editor" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
        <header><div><span>只追加的观察记录</span><h2 id="observation-editor-title">追加实验观察</h2><p>既有记录不可覆盖；错误内容必须追加修正并指向原记录。</p></div><WorkspaceActionButton disabledReason={'正在保存当前记录，请等待完成后再操作。'} busy={false} busyLabel="处理中…" aria-label="关闭观察编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onCancel} type="button"><X size={18} /></WorkspaceActionButton></header>
        <div className="experiment-form">
          <label><span>记录类型 *</span><select onChange={(event) => change('observationType', event.target.value as ExperimentObservationType)} value={draft.observationType}>{(Object.keys(OBSERVATION_LABELS) as ExperimentObservationType[]).map((type) => <option key={type} value={type}>{OBSERVATION_LABELS[type]}</option>)}</select></label>
          <label><span>观察时间 *</span><input onChange={(event) => change('observedAt', event.target.value)} type="datetime-local" value={draft.observedAt} /></label>
          {draft.observationType === 'correction' && <label className="experiment-form__wide"><span>被修正记录 *</span><select onChange={(event) => change('correctsRecordId', event.target.value)} value={draft.correctsRecordId}><option value="">请选择原记录</option>{correctionTargets.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}</select></label>}
          <label className="experiment-form__wide"><span>标题 *</span><input data-overlay-initial-focus onChange={(event) => change('title', event.target.value)} value={draft.title} /></label>
          <label className="experiment-form__wide"><span>观察内容 *</span><textarea onChange={(event) => change('observation', event.target.value)} rows={5} value={draft.observation} /></label>
        </div>
        <footer><WorkspaceActionButton disabledReason={'正在保存当前记录，请等待完成后再操作。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={onCancel} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={'正在保存当前记录，请等待完成后再操作。'} busy={busy} busyLabel="追加中…" className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '追加中...' : '追加到因果链'}</WorkspaceActionButton></footer>
      </section>
    </div>
  );
}
