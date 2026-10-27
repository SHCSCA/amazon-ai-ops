import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowClockwise,
  CheckCircle,
  LockKey,
  PencilSimple,
  Plus,
  Power,
  ShieldCheck,
  StopCircle,
  X,
} from '@phosphor-icons/react';
import {
  missionControlContextKey,
  type CreatePolicyInput,
  type CreatePolicyVersionInput,
  type MissionControlAutonomyProjection,
  type MissionControlCapabilityProjection,
  type PolicyAutonomyMode,
  type PolicyRecord,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, ReasonRequiredDialog, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import {
  assertMissionAuthorityContext,
  assertPolicyBelongsToContext,
  readPolicyDomainWindowApi,
  type AutonomyProjection,
  type PolicyDomainRendererApi,
  type UpdateDraftPolicyVersionInput,
} from './mission-domain-window-api';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { OPERATOR, PAGE_SIZE, TIME_OF_DAY_PATTERN, DAY_OPTIONS, DEFAULT_EXECUTION_DAYS, PolicyDraft, PolicyScopeLevel, PolicyScopeOption, VersionDraft, VersionEditorState, StrategyWizardDraft, POLICY_SCOPE_LABELS, POLICY_STATUS_LABELS, VERSION_STATUS_LABELS, PolicyWorkspaceProps, SAFE_OPERATOR_POLICY_REASONS, PolicyProductProjection, PolicyAdObjectProjection, PolicyScopeProjectionSurface } from './policy-workspace-contracts';
import { message, operatorFacingBlocker, split, capabilityReady, responseMatchesPolicyDetail, policyVersionDetailForSelection, buildPolicyScopeOptions, disambiguateScopeLabels, loadPolicyScopeOptions, formatPolicyScope } from './policy-workspace-model';
import { defaultRules, policyDraft, buildPolicyVersionDraft, bindVersionDraftToScope, parseRequiredInteger, normalizeExecutionDays, validateTimeZone, toggleExecutionDay, formatExecutionDays, formatExecutionWindowSummary, formatPolicyActionBoundary, buildCreatePolicyInput, buildPolicyVersionInput, buildPolicyVersionUpdate } from './policy-workspace-inputs';

export function PolicyDialog({ record, draft, busy, scopeFrozen, scopeOptions, onChange, onClose, onSave }: {
  record: PolicyRecord | null;
  draft: PolicyDraft;
  busy: boolean;
  scopeFrozen: boolean;
  scopeOptions: readonly PolicyScopeOption[];
  onChange: (draft: PolicyDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onClose, dismissDisabled: busy,
  });
  return <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}><section aria-modal="true" className="mission-control-dialog policy-domain-dialog" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog" aria-labelledby="policy-dialog-title"><header><div><span>策略设置 · Amazon 美国站 / USD</span><h2 id="policy-dialog-title">{record ? '编辑策略基本信息' : '新建策略'}</h2><p>{scopeFrozen ? '已有版本，对象范围已冻结；如需改变范围，请新建策略。' : '已启用规则不会被这次修改覆盖。'}</p></div><WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={false} busyLabel="处理中…" aria-label="关闭策略编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></WorkspaceActionButton></header><div className="policy-domain-form"><label><span>对象范围 *</span><select disabled={scopeFrozen} value={draft.scope} onChange={(event) => onChange({ ...draft, scope: event.target.value })}>{scopeOptions.map((option) => <option key={option.value} value={option.value}>{POLICY_SCOPE_LABELS[option.level]} · {option.label}</option>)}</select>{scopeFrozen && <small>已有版本，对象范围已冻结；需要其他范围时请新建策略。</small>}</label><label><span>策略名称 *</span><input data-overlay-initial-focus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label><label><span>优先级 *</span><input min="1" max="100" type="number" value={draft.priority} onChange={(event) => onChange({ ...draft, priority: event.target.value })} /><small>数字越小越优先；同一对象命中多条策略时，系统按数字越小越先匹配。范围为 1–100。</small></label></div><footer><WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={busy} busyLabel="保存中…" className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : '保存策略'}</WorkspaceActionButton></footer></section></div>;
}

export function StrategyWizardDialog({ draft, scopeOptions, busy, onChange, onClose, onSave }: {
  draft: StrategyWizardDraft;
  scopeOptions: readonly PolicyScopeOption[];
  busy: boolean;
  onChange: (draft: StrategyWizardDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onClose, dismissDisabled: busy,
  });
  const optionsForLevel = scopeOptions.filter((option) => option.level === draft.scopeLevel);
  const selectedOption = scopeOptions.find((option) => option.value === draft.scopeValue) ?? optionsForLevel[0];
  const steps = [
    '对象范围',
    '允许动作',
    '变更、预算、次数、冷却与时段限制',
    '中文证据与停止条件',
  ] as const;
  const setStep = (step: 1 | 2 | 3 | 4) => onChange({ ...draft, step });
  const canContinue = draft.step !== 1 || Boolean(draft.policy.name.trim() && selectedOption);
  return <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
    <section aria-labelledby="strategy-wizard-title" aria-modal="true" className="mission-control-dialog policy-domain-dialog policy-domain-dialog--wizard" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
      <header><div><span>Amazon 美国站 · USD</span><h2 id="strategy-wizard-title">新建策略</h2><p>按四步确定可执行边界；V1 只允许调整关键词竞价。</p></div><WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={false} busyLabel="处理中…" aria-label="关闭新建策略" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></WorkspaceActionButton></header>
      <ol aria-label="新建策略步骤" className="policy-wizard-steps">
        {steps.map((label, index) => <li aria-current={draft.step === index + 1 ? 'step' : undefined} data-complete={draft.step > index + 1 || undefined} key={label}><WorkspaceActionButton disabledReason={busy ? '策略正在保存，请等待完成后再操作。' : '请按顺序完成当前步骤，再使用下一步进入后续内容。'} busy={false} busyLabel="处理中…" disabled={busy || index + 1 > draft.step} onClick={() => setStep((index + 1) as 1 | 2 | 3 | 4)} type="button"><span>{index + 1}</span>{label}</WorkspaceActionButton></li>)}
      </ol>
      <div className="policy-wizard-body">
        {draft.step === 1 && <section aria-labelledby="policy-wizard-scope-title" className="policy-wizard-section"><h3 id="policy-wizard-scope-title">1. 对象范围</h3><p>范围始终锁定当前店铺；下列对象只来自当前店铺产品和已导入广告对象。</p><div className="policy-domain-form"><label><span>策略名称 *</span><input data-overlay-initial-focus value={draft.policy.name} onChange={(event) => onChange({ ...draft, policy: { ...draft.policy, name: event.target.value } })} /></label><label><span>范围级别 *</span><select value={draft.scopeLevel} onChange={(event) => { const level = event.target.value as PolicyScopeLevel; const first = scopeOptions.find((option) => option.level === level); onChange({ ...draft, scopeLevel: level, scopeValue: first?.value ?? '' }); }}>{Object.entries(POLICY_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>选择对象 *</span><select disabled={!optionsForLevel.length} value={selectedOption?.value ?? ''} onChange={(event) => onChange({ ...draft, scopeValue: event.target.value })}>{optionsForLevel.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{optionsForLevel.length ? `该范围包含 ${selectedOption?.allowedAdEntityIds.length ?? 0} 个可核验关键词/投放对象。` : '当前店铺没有该级别的可选对象，请先采集并导入广告报表。'}</small></label><label><span>优先级 *</span><input min="1" max="100" type="number" value={draft.policy.priority} onChange={(event) => onChange({ ...draft, policy: { ...draft.policy, priority: event.target.value } })} /><small>数字越小越优先；同一对象命中多条策略时，系统按数字越小越先匹配。范围为 1–100。</small></label></div></section>}
        {draft.step === 2 && <section aria-labelledby="policy-wizard-action-title" className="policy-wizard-section"><h3 id="policy-wizard-action-title">2. 允许动作</h3><p>V1 动作固定，不能扩展到预算、状态、Listing 或其他广告写入。</p><article className="policy-wizard-action-choice"><CheckCircle size={22} /><div><strong>调整关键词竞价</strong><small>仅对上一步范围内可核验的关键词/投放对象生效；对象不足时自动执行保持阻断。</small></div><span>唯一允许动作</span></article></section>}
        {draft.step === 3 && <section aria-labelledby="policy-wizard-limit-title" className="policy-wizard-section"><h3 id="policy-wizard-limit-title">3. 变更、预算、次数、冷却与时段限制</h3><div className="policy-domain-form policy-domain-form--version"><label><span>最大单次变化 *</span><div className="policy-domain-input-unit"><input max="10" min="0.1" step="0.1" type="number" value={draft.version.maxChangePct} onChange={(event) => onChange({ ...draft, version: { ...draft.version, maxChangePct: event.target.value } })} /><b>%</b></div></label><label><span>批次影响预算 *</span><div className="policy-domain-input-unit"><b>$</b><input min="0" step="0.01" type="number" value={draft.version.totalImpactBudget} onChange={(event) => onChange({ ...draft, version: { ...draft.version, totalImpactBudget: event.target.value } })} /></div></label><label><span>每日动作上限 *</span><div className="policy-domain-input-unit"><input min="1" step="1" type="number" value={draft.version.maxDailyActionCount} onChange={(event) => onChange({ ...draft, version: { ...draft.version, maxDailyActionCount: event.target.value } })} /><b>次</b></div></label><label><span>同对象冷却时间 *</span><div className="policy-domain-input-unit"><input min="0" step="1" type="number" value={draft.version.cooldownMinutes} onChange={(event) => onChange({ ...draft, version: { ...draft.version, cooldownMinutes: event.target.value } })} /><b>分钟</b></div></label><fieldset className="policy-domain-boundary"><legend>允许执行时段 *</legend><div className="policy-domain-window-grid"><label><span>时区</span><input value={draft.version.executionTimeZone} onChange={(event) => onChange({ ...draft, version: { ...draft.version, executionTimeZone: event.target.value } })} /></label><label><span>开始</span><input type="time" value={draft.version.executionWindowStart} onChange={(event) => onChange({ ...draft, version: { ...draft.version, executionWindowStart: event.target.value } })} /></label><label><span>结束</span><input type="time" value={draft.version.executionWindowEnd} onChange={(event) => onChange({ ...draft, version: { ...draft.version, executionWindowEnd: event.target.value } })} /></label></div><div className="policy-domain-day-field"><span>执行日（至少一天）</span><div aria-label="策略执行日" className="policy-domain-day-options" role="group">{DAY_OPTIONS.map((option) => <WorkspaceActionButton disabled={busy} disabledReason="策略正在保存，请等待完成后再调整执行日。" aria-label={option.label} aria-pressed={draft.version.executionDaysOfWeek.includes(option.value)} key={option.value} onClick={() => onChange({ ...draft, version: { ...draft.version, executionDaysOfWeek: toggleExecutionDay(draft.version.executionDaysOfWeek, option.value) } })} type="button">{option.shortLabel}</WorkspaceActionButton>)}</div></div></fieldset></div></section>}
        {draft.step === 4 && <section aria-labelledby="policy-wizard-evidence-title" className="policy-wizard-section"><h3 id="policy-wizard-evidence-title">4. 中文证据与停止条件</h3><div className="policy-wizard-review-grid"><article><h4>执行前后必须留存</h4><ul><li>修改前页面截图</li><li>修改后页面截图</li><li>刷新后页面截图</li><li>页面与对象身份核验</li><li>刷新后的数值回读</li></ul></article><article><h4>遇到以下情况立即停止</h4><ul><li>店铺、页面或对象身份变化</li><li>修改前数值与预期不一致</li><li>结果无法确认，转人工对账且不自动重试</li><li>数据过期、影响预算耗尽或紧急停止开启</li></ul></article></div><div className="policy-domain-form"><label><span>生效日期</span><input type="date" value={draft.version.validFrom} onChange={(event) => onChange({ ...draft, version: { ...draft.version, validFrom: event.target.value } })} /></label><label><span>失效日期</span><input type="date" value={draft.version.validUntil} onChange={(event) => onChange({ ...draft, version: { ...draft.version, validUntil: event.target.value } })} /></label></div><p className="policy-wizard-final-note">保存后先形成待检查规则；仍需“检查边界 → 启用策略”，不会直接开启自动执行。</p></section>}
      </div>
      <footer><WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={draft.step === 1 ? onClose : () => setStep((draft.step - 1) as 1 | 2 | 3)} type="button">{draft.step === 1 ? '取消' : '上一步'}</WorkspaceActionButton>{draft.step < 4 ? <WorkspaceActionButton disabledReason={busy ? '策略正在保存，请等待完成后再操作。' : '请填写策略名称并选择当前店铺真实对象，再进入下一步。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" disabled={busy || !canContinue} onClick={() => setStep((draft.step + 1) as 2 | 3 | 4)} type="button">下一步</WorkspaceActionButton> : <WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={busy} busyLabel="创建中…" className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '创建中…' : '创建策略与草稿版本'}</WorkspaceActionButton>}</footer>
    </section>
  </div>;
}

export function VersionDialog({ record, draft, busy, onChange, onClose, onSave }: {
  record: PolicyVersionRecord | null;
  draft: VersionDraft;
  busy: boolean;
  onChange: (draft: VersionDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: true, onDismiss: onClose, dismissDisabled: busy,
  });
  return <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
    <section aria-labelledby="version-dialog-title" aria-modal="true" className="mission-control-dialog policy-domain-dialog policy-domain-dialog--version" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
      <header>
        <div><span>策略规则检查</span><h2 id="version-dialog-title">{record ? '编辑待检查规则' : '创建草稿版本'}</h2><p>启用后规则不可编辑；后续变化必须新建版本。</p></div>
        <WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={false} busyLabel="处理中…" aria-label="关闭版本编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></WorkspaceActionButton>
      </header>
      <div className="policy-domain-form policy-domain-form--version">
        <label><span>版本号 *</span><input aria-describedby="policy-version-fixed" disabled={Boolean(record)} min="1" step="1" type="number" value={draft.version} onChange={(event) => onChange({ ...draft, version: event.target.value })} />{record && <small id="policy-version-fixed">版本号创建后固定；需要新版本时请创建草稿版本。</small>}</label>
        <label><span>最大单次变化 *</span><div className="policy-domain-input-unit"><input max="10" min="0.1" step="0.1" type="number" value={draft.maxChangePct} onChange={(event) => onChange({ ...draft, maxChangePct: event.target.value })} /><b>%</b></div></label>
        <label><span>批次影响预算 *</span><div className="policy-domain-input-unit"><b>$</b><input min="0" step="0.01" type="number" value={draft.totalImpactBudget} onChange={(event) => onChange({ ...draft, totalImpactBudget: event.target.value })} /></div></label>
        <label><span>每日动作上限 *</span><div className="policy-domain-input-unit"><input min="1" step="1" type="number" value={draft.maxDailyActionCount} onChange={(event) => onChange({ ...draft, maxDailyActionCount: event.target.value })} /><b>次</b></div></label>
        <label><span>同对象冷却时间 *</span><div className="policy-domain-input-unit"><input min="0" step="1" type="number" value={draft.cooldownMinutes} onChange={(event) => onChange({ ...draft, cooldownMinutes: event.target.value })} /><b>分钟</b></div></label>
        <div className="policy-domain-form__wide policy-domain-object-summary"><span>可执行对象</span><strong>{split(draft.allowedAdEntityIds).length} 个已核验关键词/投放对象</strong><small>对象由策略范围自动绑定，不可手工输入；没有已核验对象时保持零执行权限。</small></div>
        <fieldset aria-describedby="policy-execution-window-help" className="policy-domain-boundary">
          <legend>V1 执行窗口 *</legend>
          <div className="policy-domain-window-grid">
            <label><span>IANA 时区</span><input placeholder="区域/城市" spellCheck={false} value={draft.executionTimeZone} onChange={(event) => onChange({ ...draft, executionTimeZone: event.target.value })} /></label>
            <label><span>开始时间</span><input step="300" type="time" value={draft.executionWindowStart} onChange={(event) => onChange({ ...draft, executionWindowStart: event.target.value })} /></label>
            <label><span>结束时间</span><input step="300" type="time" value={draft.executionWindowEnd} onChange={(event) => onChange({ ...draft, executionWindowEnd: event.target.value })} /></label>
          </div>
          <div className="policy-domain-day-field">
            <span>执行日（至少一天）</span>
            <div aria-label="策略执行日" className="policy-domain-day-options" role="group">
              {DAY_OPTIONS.map((option) => <WorkspaceActionButton disabled={busy} disabledReason="策略正在保存，请等待完成后再调整执行日。" aria-label={option.label} aria-pressed={draft.executionDaysOfWeek.includes(option.value)} key={option.value} onClick={() => onChange({ ...draft, executionDaysOfWeek: toggleExecutionDay(draft.executionDaysOfWeek, option.value) })} type="button">{option.shortLabel}</WorkspaceActionButton>)}
            </div>
          </div>
          <small id="policy-execution-window-help">按所填时区解释本地时间；结束时间不包含在窗口内。V1 要求开始早于结束，不支持跨午夜。</small>
        </fieldset>
        <label><span>生效日期</span><input type="date" value={draft.validFrom} onChange={(event) => onChange({ ...draft, validFrom: event.target.value })} /></label>
        <label><span>失效日期</span><input type="date" value={draft.validUntil} onChange={(event) => onChange({ ...draft, validUntil: event.target.value })} /></label>
      </div>
      <footer><WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={'策略正在保存，请等待完成后再操作。'} busy={busy} busyLabel="保存中…" className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : '保存草稿版本'}</WorkspaceActionButton></footer>
    </section>
  </div>;
}
