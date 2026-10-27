import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rendererRuntimeLog } from '../../runtime-log';
import { WorkspaceActionButton, createWorkspaceActionAdmission } from '../../components/workspace/action-feedback';
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
import { PolicyDialog, StrategyWizardDialog, VersionDialog } from './policy-workspace-editors';
import './policy-workspace.css';

export type { PolicyWorkspaceProps } from './policy-workspace-contracts';
export { operatorFacingBlocker } from './policy-workspace-model';
export { responseMatchesPolicyDetail } from './policy-workspace-model';
export { policyVersionDetailForSelection } from './policy-workspace-model';
export { buildPolicyScopeOptions } from './policy-workspace-model';
export { loadPolicyScopeOptions } from './policy-workspace-model';
export { buildPolicyVersionDraft } from './policy-workspace-inputs';
export { bindVersionDraftToScope } from './policy-workspace-inputs';
export { formatExecutionWindowSummary } from './policy-workspace-inputs';
export { formatPolicyActionBoundary } from './policy-workspace-inputs';
export { buildCreatePolicyInput } from './policy-workspace-inputs';
export { buildPolicyVersionInput } from './policy-workspace-inputs';
export { buildPolicyVersionUpdate } from './policy-workspace-inputs';
export { PolicyDialog } from './policy-workspace-editors';
export { StrategyWizardDialog } from './policy-workspace-editors';
export { VersionDialog } from './policy-workspace-editors';

export function PolicyWorkspace({ apiOverride, authoritativeAutonomy, blockedReason, capabilities, onInspectBoundary, onRefreshAuthority, previewMode, storeContext }: PolicyWorkspaceProps) {
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [versions, setVersions] = useState<PolicyVersionRecord[]>([]);
  const [runtime, setRuntime] = useState<AutonomyProjection | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error'>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [policyEditor, setPolicyEditor] = useState<{ record: PolicyRecord | null; draft: PolicyDraft } | null>(null);
  const [strategyWizard, setStrategyWizard] = useState<StrategyWizardDraft | null>(null);
  const [versionEditor, setVersionEditor] = useState<VersionEditorState | null>(null);
  const [scopeOptions, setScopeOptions] = useState<PolicyScopeOption[]>([]);
  const [scopeOptionsPhase, setScopeOptionsPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [scopeOptionsError, setScopeOptionsError] = useState('');
  const [scopeReloadToken, setScopeReloadToken] = useState(0);
  const [clearKillSwitchOpen, setClearKillSwitchOpen] = useState(false);
  const [modeChangeConfirm, setModeChangeConfirm] = useState<{ mode: PolicyAutonomyMode } | null>(null);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const mutationSequence = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const authorityRef = useRef(authorityKey);
  const authorityEpoch = useRef(0);
  const admission = useRef(createWorkspaceActionAdmission());
  if (authorityRef.current !== authorityKey) { authorityEpoch.current += 1; authorityRef.current = authorityKey; }
  admission.current.update(authorityKey);
  useEffect(() => () => { authorityEpoch.current += 1; }, []);
  const api = useMemo(() => apiOverride ?? readPolicyDomainWindowApi(), [apiOverride]);
  const expectedState = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const viewReady = capabilityReady(capabilities, 'policy.version.view', previewMode);
  const selected = policies.find((policy) => policy.id === selectedId) ?? policies[0] ?? null;
  const selectedVersionDetail = policyVersionDetailForSelection(selected?.id ?? '', versions, versionEditor);
  const selectedVersions = selectedVersionDetail.versions;
  const selectedVersionEditor = selectedVersionDetail.versionEditor;
  const selectedScopeOption = selected ? scopeOptions.find((option) => option.value === selected.scope) : undefined;
  const selectedRef = useRef(selected?.id ?? '');
  selectedRef.current = selected?.id ?? '';
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return policies.filter((policy) => !normalized || `${policy.id} ${policy.name} ${policy.scope}`.toLowerCase().includes(normalized));
  }, [policies, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const can = (id: string) => Boolean(api && storeContext && viewReady && capabilityReady(capabilities, id, previewMode));
  const busy = pending !== null;
  const visibleBlockedReason = operatorFacingBlocker(error || blockedReason, '策略');
  const scopeOptionsReady = scopeOptionsPhase === 'ready';
  const scopeOptionsBlockedReason = scopeOptionsPhase === 'loading'
    ? '正在读取当前店铺产品和广告对象，请稍候。'
    : scopeOptionsPhase === 'error'
      ? '无法读取当前店铺产品和广告对象；请确认采集与导入完成后重新读取。'
      : visibleBlockedReason;

  const selectPolicy = (policyId: string) => {
    if (policyId === selected?.id) return;
    detailSequence.current += 1;
    setVersions([]);
    setVersionEditor(null);
    setSelectedId(policyId);
  };

  const actionReason = (capabilityId?: string, detail?: string) => !storeContext ? '请先选择当前店铺。'
    : !api || !viewReady ? '当前策略服务尚未接入，请检查系统设置与店铺连接。'
      : busy ? '当前策略操作尚未完成，请稍候。' : capabilityId && !can(capabilityId)
        ? '当前店铺尚未接入此操作，请检查连接与权限。' : detail ?? '请核对当前策略状态与对象范围。';

  const openStrategyWizard = () => {
    const storeOption = scopeOptions.find((option) => option.level === 'store');
    if (!scopeOptionsReady || !storeOption) {
      setError('当前店铺产品和广告对象尚未读取完成；请先重新读取对象。');
      return;
    }
    setStrategyWizard({
      step: 1,
      policy: policyDraft(),
      scopeLevel: 'store',
      scopeValue: storeOption.value,
      version: buildPolicyVersionDraft(null, storeContext?.businessTimezone ?? 'America/Los_Angeles'),
    });
  };

  const load = async (context: StoreContextEnvelope, key: string) => {
    const current = ++sequence.current;
    const capturedEpoch = authorityEpoch.current;
    if (!viewReady || !api) {
      setPhase('blocked');
      setPolicies([]);
      setError(!viewReady ? '策略中心缺少生产能力，当前已失败关闭。' : '策略服务未接入；界面不会回退到示例数据。');
      return;
    }
    setPhase('loading'); setError(''); setFeedback('');
    try {
      assertMissionAuthorityContext(context);
      const [rows, runtimeProjection] = await Promise.all([api.listPolicies(context, { includeArchived }), api.getPolicyRuntime(context)]);
      if (authorityRef.current !== key || authorityEpoch.current !== capturedEpoch || sequence.current !== current) return;
      rows.forEach((row) => assertPolicyBelongsToContext(row, context));
      setPolicies(rows);
      setRuntime(runtimeProjection);
      setSelectedId((id) => rows.some((row) => row.id === id) ? id : rows[0]?.id ?? '');
      setPhase('ready');
    } catch (loadError) { rendererRuntimeLog.error('renderer.policy_load_failed', { error: loadError });
      if (authorityRef.current !== key || sequence.current !== current) return;
      setPhase('error'); setPolicies([]); setVersions([]); setRuntime(null); setError(message(loadError));
    }
  };

  useEffect(() => {
    detailSequence.current += 1;
    mutationSequence.current += 1;
    setPending(null); setSelectedId(''); setVersions([]); setPolicyEditor(null); setStrategyWizard(null); setVersionEditor(null); setClearKillSwitchOpen(false); setPage(1);
    if (storeContext) void load(storeContext, authorityKey); else { setPhase('blocked'); setError('等待 Main 返回当前 StoreContext。'); }
  }, [authorityKey, includeArchived, apiOverride, viewReady]);

  useEffect(() => {
    if (!storeContext) {
      setScopeOptions([]);
      setScopeOptionsPhase('idle');
      setScopeOptionsError('');
      return;
    }
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    setScopeOptions([]);
    setScopeOptionsPhase('loading');
    setScopeOptionsError('');
    const surface = (window as any).electronAPI as PolicyScopeProjectionSurface | undefined;
    void loadPolicyScopeOptions(surface, storeContext).then((options) => {
      if (authorityRef.current !== capturedKey || authorityEpoch.current !== capturedEpoch) return;
      setScopeOptions(options);
      setScopeOptionsPhase('ready');
    }).catch((scopeLoadError) => {
      rendererRuntimeLog.error('renderer.policy_scope_load_failed', { error: scopeLoadError });
      if (authorityRef.current !== capturedKey || authorityEpoch.current !== capturedEpoch) return;
      setScopeOptions([]);
      setScopeOptionsPhase('error');
      setScopeOptionsError(message(scopeLoadError));
    });
  }, [authorityKey, scopeReloadToken]);

  useEffect(() => {
    setVersions([]);
    setVersionEditor(null);
    if (!selected || !storeContext || !api || phase !== 'ready') {
      detailSequence.current += 1;
      return;
    }
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    const capturedId = selected.id;
    const capturedSequence = ++detailSequence.current;
    void api.listPolicyVersions(storeContext, selected.id).then((rows) => {
      if (authorityEpoch.current !== capturedEpoch || !responseMatchesPolicyDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) return;
      rows.forEach((row) => assertPolicyBelongsToContext(row, storeContext));
      const selectedRows = policyVersionDetailForSelection(capturedId, rows, null).versions;
      if (selectedRows.length !== rows.length) throw new Error('当前策略版本归属校验失败。');
      setVersions(selectedRows);
    }).catch((loadError) => {
      rendererRuntimeLog.error('renderer.policy_version_load_failed', { error: loadError });
      if (authorityEpoch.current === capturedEpoch && responseMatchesPolicyDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) setError(message(loadError));
    });
  }, [selected?.id, authorityKey, api, phase]);

  useEffect(() => {
    if (!authoritativeAutonomy) return;
    setRuntime((current) => current ? { ...current, mode: authoritativeAutonomy.currentMode } : current);
  }, [authoritativeAutonomy?.currentMode]);

  const mutate = async <T,>(key: string, operation: (domain: PolicyDomainRendererApi, context: StoreContextEnvelope) => Promise<T>): Promise<T | null> => {
    if (!api || !storeContext || busy) return null;
    const release = admission.current.tryEnter();
    if (!release) return null;
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const capturedEpoch = authorityEpoch.current;
    const current = ++mutationSequence.current;
    setPending(key); setError(''); setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (authorityRef.current !== capturedKey || authorityEpoch.current !== capturedEpoch || mutationSequence.current !== current) return null;
      return result;
    } catch (mutationError) {
      rendererRuntimeLog.error('renderer.policy_operation_failed', { operation: key, error: mutationError });
      if (authorityRef.current === capturedKey && authorityEpoch.current === capturedEpoch && mutationSequence.current === current) setError(message(mutationError));
      return null;
    } finally {
      release();
      if (authorityRef.current === capturedKey && authorityEpoch.current === capturedEpoch && mutationSequence.current === current) setPending(null);
    }
  };

  const savePolicy = async () => {
    if (!policyEditor || !storeContext) return;
    let input: CreatePolicyInput;
    const scopeSafeDraft = policyEditor.record && selectedVersions.length > 0
      ? { ...policyEditor.draft, scope: policyEditor.record.scope }
      : policyEditor.draft;
    try { input = buildCreatePolicyInput(scopeSafeDraft, policyEditor.record?.id ?? `POLICY-${String(storeContext.storeId)}-${Date.now()}`); }
    catch (validationError) { rendererRuntimeLog.error('renderer.policy_validation_failed', { error: validationError }); setError(message(validationError)); return; }
    const saved = policyEditor.record
      ? await mutate('policy-save', (domain, context) => domain.updatePolicy(context, { id: policyEditor.record!.id, expectedRevision: policyEditor.record!.revision, actorId: OPERATOR, patch: { name: input.name, scope: input.scope, priority: input.priority } }))
      : await mutate('policy-save', (domain, context) => domain.createPolicy(context, input));
    if (!saved) return;
    assertPolicyBelongsToContext(saved, storeContext);
    setPolicies((rows) => rows.some((row) => row.id === saved.id) ? rows.map((row) => row.id === saved.id ? saved : row) : [...rows, saved]);
    selectPolicy(saved.id); setPolicyEditor(null); setFeedback(policyEditor.record ? '策略元数据已通过 CAS 更新。' : '策略已创建，请新建草稿版本。');
  };

  const saveStrategy = async () => {
    if (!strategyWizard || !storeContext) return;
    const option = scopeOptions.find((item) => item.value === strategyWizard.scopeValue);
    if (!option) { setError('所选对象已不可用，请返回第一步重新选择。'); return; }
    const policyId = `POLICY-${String(storeContext.storeId)}-${Date.now()}`;
    let policyInput: CreatePolicyInput;
    let versionInput: CreatePolicyVersionInput;
    try {
      policyInput = buildCreatePolicyInput({
        ...strategyWizard.policy,
        scope: option.value,
      }, policyId);
      versionInput = buildPolicyVersionInput(
        { id: policyId } as PolicyRecord,
        bindVersionDraftToScope(strategyWizard.version, option),
        `POL-${String(storeContext.storeId)}-${policyId}-V1`,
      );
    } catch (validationError) { rendererRuntimeLog.error('renderer.policy_validation_failed', { error: validationError });
      setError(message(validationError));
      return;
    }
    const savedPolicy = await mutate('strategy-create', (domain, context) => domain.createPolicy(context, policyInput));
    if (!savedPolicy) return;
    assertPolicyBelongsToContext(savedPolicy, storeContext);
    setPolicies((rows) => [...rows, savedPolicy].sort((left, right) => left.priority - right.priority));
    selectPolicy(savedPolicy.id);
    const savedVersion = await mutate('strategy-create', (domain, context) => domain.createPolicyVersion(context, {
      ...versionInput,
      policyId: savedPolicy.id,
    }));
    setStrategyWizard(null);
    if (!savedVersion) {
      setFeedback('策略已创建，但草稿版本未保存；请在策略详情中点击“创建草稿版本”继续。');
      return;
    }
    assertPolicyBelongsToContext(savedVersion, storeContext);
    setVersions([savedVersion]);
    setFeedback('策略与待检查规则已创建；请检查边界后再启用策略。');
  };

  const saveVersion = async () => {
    if (!versionEditor || !selected || !storeContext) return;
    if (!selectedVersionEditor) {
      setVersions(selectedVersions);
      setVersionEditor(null);
      setError('策略已切换，旧版本编辑已关闭。下一步：请在当前策略重新选择待检查版本。');
      return;
    }
    if (!selectedScopeOption) {
      setError('当前策略范围已无法从本店真实对象中核验；请新建策略并重新选择对象范围。');
      return;
    }
    const scopeBoundDraft = bindVersionDraftToScope(selectedVersionEditor.draft, selectedScopeOption);
    try {
      const saved = selectedVersionEditor.record
        ? await mutate('version-save', (domain, context) => domain.updateDraftPolicyVersion(context, buildPolicyVersionUpdate(selectedVersionEditor.record!, scopeBoundDraft)))
        : await mutate('version-save', (domain, context) => domain.createPolicyVersion(context, buildPolicyVersionInput(selected, scopeBoundDraft, `POL-${String(storeContext.storeId)}-${selected.id}-V${scopeBoundDraft.version}`)));
      if (!saved) return;
      if (saved.policyId !== selected.id) {
        setVersions([]);
        setVersionEditor(null);
        setError('版本与当前策略归属不一致，本次结果已丢弃。下一步：请重新读取当前策略版本。');
        return;
      }
      setVersions((rows) => rows.some((row) => row.id === saved.id) ? rows.map((row) => row.id === saved.id ? saved : row) : [saved, ...rows]);
      setVersionEditor(null); setFeedback('策略草稿版本已保存。');
    } catch (validationError) { rendererRuntimeLog.error('renderer.policy_validation_failed', { error: validationError }); setError(message(validationError)); }
  };

  const synchronizeShellAuthority = async (capturedKey: string, capturedEpoch: number): Promise<boolean> => {
    try {
      const refreshed = await onRefreshAuthority?.();
      if (refreshed === false) {
        if (authorityRef.current === capturedKey && authorityEpoch.current === capturedEpoch) setError('策略已写入，但全局状态刷新未完成，请重新读取当前店铺状态。');
        return false;
      }
      return authorityRef.current === capturedKey && authorityEpoch.current === capturedEpoch;
    } catch (refreshError) { rendererRuntimeLog.error('renderer.policy_authority_refresh_failed', { error: refreshError });
      if (authorityRef.current === capturedKey && authorityEpoch.current === capturedEpoch) setError(`策略已写入，但全局 Authority 刷新失败：${message(refreshError)}`);
      return false;
    }
  };

  const lifecycle = async (action: 'disable' | 'archive' | 'restore') => {
    if (!selected) return;
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    const saved = await mutate(`policy-${action}`, (domain, context) => domain[`${action}Policy` as const](context, { id: selected.id, expectedRevision: selected.revision, actorId: OPERATOR, reason: `operator_${action}` }));
    if (!saved) return;
    setPolicies((rows) => rows.map((row) => row.id === saved.id ? saved : row));
    if (action === 'disable' && !await synchronizeShellAuthority(capturedKey, capturedEpoch)) return;
    setFeedback(action === 'disable' ? '策略已停用；运行时已回到人工审批。' : action === 'archive' ? '策略已归档。' : '策略已恢复为停用状态。');
  };

  const enableVersion = async (version: PolicyVersionRecord) => {
    if (!selected) return;
    if (version.policyId !== selected.id) {
      setVersions(selectedVersions);
      setVersionEditor(null);
      setError('版本与当前策略归属不一致，已阻断启用。下一步：请重新读取当前策略版本。');
      return;
    }
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    const saved = await mutate('version-enable', (domain, context) => domain.enablePolicyVersion(context, { policyId: selected.id, versionId: version.id, expectedPolicyRevision: selected.revision, expectedVersionRevision: version.revision, actorId: OPERATOR }));
    if (!saved || !storeContext) return;
    await load(storeContext, authorityKey);
    if (!await synchronizeShellAuthority(capturedKey, capturedEpoch)) return;
    setFeedback(`v${saved.version} 已启用并冻结为不可变策略快照。`);
  };

  const setMode = async (mode: PolicyAutonomyMode, reason: string) => {
    if (!runtime) return;
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    const saved = await mutate('runtime-mode', (domain, context) => domain.setAutonomyMode(context, { expectedRevision: runtime.revision, mode, reason }));
    if (!saved) return;
    setRuntime(saved);
    if (!await synchronizeShellAuthority(capturedKey, capturedEpoch)) return;
    const reasonPrefix = reason ? `[${reason}] ` : '';
    setFeedback(`${reasonPrefix}${mode === 'policy_auto' ? '已切换为策略内自动；仍受不可变版本、熔断和急停约束。' : '已切换为人工审批。'}`);
  };

  const enableKillSwitch = async () => {
    if (!runtime) return;
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    if (!can('policy.kill-switch.enable')) { setError('缺少精确能力 policy.kill-switch.enable，急停已阻断。'); return; }
    const saved = await mutate('kill-switch-enable', (domain, context) => domain.setKillSwitch(context, { expectedRevision: runtime.revision, enabled: true, reason: 'operator_emergency_stop' }));
    if (!saved) return;
    setRuntime(saved);
    if (!await synchronizeShellAuthority(capturedKey, capturedEpoch)) return;
    setFeedback('店铺级紧急停止已开启；自动模式已降级为人工审批。');
  };

  const clearKillSwitch = async (reasonFromDialog: string) => {
    const trimmedReason = reasonFromDialog.trim();
    if (!runtime || !trimmedReason) return;
    const capturedKey = authorityKey;
    const capturedEpoch = authorityEpoch.current;
    if (!can('policy.kill-switch.clear')) { setError('缺少精确能力 policy.kill-switch.clear，解除急停已阻断。'); return; }
    const saved = await mutate('kill-switch-clear', (domain, context) => domain.setKillSwitch(context, {
      expectedRevision: runtime.revision,
      enabled: false,
      reason: trimmedReason,
    }));
    if (!saved) return;
    setRuntime(saved);
    setClearKillSwitchOpen(false);
    if (!await synchronizeShellAuthority(capturedKey, capturedEpoch)) return;
    setFeedback('紧急停止已解除；系统不会自动恢复策略内自动。');
  };

  const enabledVersion = selectedVersions.find((version) => version.status === 'enabled') ?? null;
  const draftVersion = selectedVersions.find((version) => version.status === 'draft') ?? null;
  const displayedVersion = enabledVersion ?? draftVersion ?? selectedVersions[0] ?? null;
  const createVersionDraft = () => bindVersionDraftToScope({
    ...buildPolicyVersionDraft(null, storeContext?.businessTimezone ?? 'America/Los_Angeles'),
    version: String(Math.max(0, ...selectedVersions.map((item) => item.version)) + 1),
  }, selectedScopeOption);
  const editVersionDraft = (version: PolicyVersionRecord) => bindVersionDraftToScope(
    buildPolicyVersionDraft(version, storeContext?.businessTimezone ?? 'America/Los_Angeles'),
    selectedScopeOption,
  );

  return <div className="mission-control-workspace-root policy-domain-workspace" data-canonical-surface="policy" data-capability-state={viewReady ? expectedState : 'BLOCKED'} data-preview-mode={previewMode || undefined}>
    <p className="sr-only">{viewReady && api ? '策略服务已接入。' : `策略已失败关闭；${!api ? '生产策略服务未接入。' : visibleBlockedReason}`}</p>
    <PageFrame className="policy-domain-page" description="策略先于执行判定；策略内自动只在启用版本、阈值、数据新鲜度与单次变更边界内工作。" pageId="policy-rules" title="策略与风控" task={<TaskBanner compact eyebrow="策略运行边界" title="自动边界与审批策略" description="先选对象和唯一允许动作，再限制变化、预算、次数、冷却、时段、证据与停止条件。" primaryAction={{ actionId: 'policy.policy.create', label: '新建策略', disabled: !can('policy.policy.create') || busy || !scopeOptionsReady, disabledReason: scopeOptionsBlockedReason, onClick: openStrategyWizard }} secondaryActions={onInspectBoundary ? [{ actionId: 'policy-boundary', label: '接入边界', onClick: onInspectBoundary }] : []} status={<span className="policy-domain-authority" data-state={viewReady && scopeOptionsPhase !== 'error' ? expectedState : 'BLOCKED'}>{previewMode ? '仅开发预览' : viewReady && scopeOptionsPhase !== 'error' ? '生产可用' : '已阻断'}</span>}>{previewMode && <p className="policy-domain-preview-note">仅开发预览 · 预览数据 · Amazon 美国站 · USD · 不代表真实广告执行授权</p>}</TaskBanner>} summary={<SummaryStrip ariaLabel="策略运行摘要" items={[{ id: 'active', label: '已启用策略', value: `${policies.filter((policy) => policy.status === 'active').length} / ${policies.length}` }, { id: 'versions', label: '不可变策略版本', value: `${selectedVersions.filter((version) => version.status === 'enabled').length} 个启用` }, { id: 'runtime', label: '当前执行模式', value: runtime?.mode === 'policy_auto' ? '策略内自动' : '人工审批' }, { id: 'switch', label: '紧急停止', value: runtime?.killSwitch ? '已开启' : '已关闭', tone: runtime?.killSwitch ? 'blocked' : 'neutral' }]} /> }>
      <section aria-label="策略店铺隔离范围" className="policy-domain-scope-notice"><LockKey size={15} /><strong>{storeContext ? '当前店铺已隔离' : '等待选择店铺'}</strong><span>策略、不可变版本与运行模式仅作用于当前店铺，不跨店铺继承。</span><em>Amazon US · USD</em></section>
      {scopeOptionsPhase !== 'ready' && <section aria-live="polite" className="policy-domain-scope-notice" data-state={scopeOptionsPhase} role={scopeOptionsPhase === 'error' ? 'alert' : 'status'}><ArrowClockwise size={15} /><strong>{scopeOptionsPhase === 'error' ? '策略对象读取失败' : '正在读取策略对象'}</strong><span>{scopeOptionsPhase === 'error' ? '无法确认真实产品与广告对象，创建、编辑和启用已阻断。请确认采集与导入完成后重试。' : '正在读取当前店铺产品、广告活动、广告组和关键词。'}</span>{scopeOptionsPhase === 'error' && <button className="workspace-button workspace-button--secondary" onClick={() => setScopeReloadToken((value) => value + 1)} type="button">重新读取对象</button>}<details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>{scopeOptionsError || 'scope-authority-loading'}</code></details></section>}
      <section className="policy-domain-runtime" aria-label="店铺级策略运行时">
        <div><span>店铺运行模式</span><div className="policy-domain-segmented"><WorkspaceActionButton disabledReason={actionReason("policy.runtime.mode.set", !runtime ? '尚未读取当前运行模式，请刷新策略。' : undefined)} busy={false} busyLabel="处理中…" aria-pressed={runtime?.mode === 'manual_approval'} disabled={!can('policy.runtime.mode.set') || busy || !runtime} onClick={() => setModeChangeConfirm({ mode: 'manual_approval' })} type="button">人工审批</WorkspaceActionButton><WorkspaceActionButton disabledReason={actionReason("policy.runtime.mode.set", !runtime ? '尚未读取当前运行模式，请刷新策略。' : !runtime?.canAutoExecute ? '自动执行条件尚未满足，请展开启用条件并逐项处理。' : undefined)} busy={false} busyLabel="处理中…" aria-pressed={runtime?.mode === 'policy_auto'} disabled={!can('policy.runtime.mode.set') || busy || !runtime || !runtime.canAutoExecute} onClick={() => setModeChangeConfirm({ mode: 'policy_auto' })} type="button">策略内自动</WorkspaceActionButton></div><details className="policy-domain-auto-conditions"><summary>查看启用条件</summary><ul><li>已有启用策略版本</li><li>对象身份已核验且 Ads 身份已确认</li><li>变化、预算、次数、冷却和时段均在边界内</li><li>紧急停止关闭且执行安全门正常</li></ul></details></div>
        <div><span>当前规则状态</span><strong>{runtime?.activePolicyVersionId ? '已绑定启用规则' : '尚无启用规则'}</strong><small>{runtime?.canAutoExecute ? '满足策略规则前置条件' : '保持人工审批或阻断'}</small><details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>activePolicyVersionId={runtime?.activePolicyVersionId ?? 'none'}</code><code>circuitBreakerState={runtime?.circuitBreakerState ?? 'none'}</code><p>不能写熔断器或 activeVersion。</p></details></div>
        {runtime?.killSwitch
          ? <WorkspaceActionButton disabledReason={actionReason("policy.kill-switch.clear",  undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary policy-domain-kill-switch" disabled={!can('policy.kill-switch.clear') || busy} onClick={() => setClearKillSwitchOpen(true)} type="button"><Power size={16} />解除紧急停止</WorkspaceActionButton>
          : <WorkspaceActionButton disabledReason={actionReason("policy.kill-switch.enable", !runtime ? '尚未读取当前运行模式，请刷新策略。' : undefined)} busy={pending === 'kill-switch-enable'} busyLabel="急停中…" className="workspace-button workspace-button--secondary policy-domain-kill-switch" disabled={!can('policy.kill-switch.enable') || busy || !runtime} onClick={() => void enableKillSwitch()} type="button"><StopCircle size={16} />开启紧急停止</WorkspaceActionButton>}
      </section>
      <div className="policy-domain-layout">
        <WorkbenchPanel className="policy-domain-list-panel" title="策略边界" description="数字越小越优先；只读取当前店铺策略。" footer={`第 ${safePage}/${pageCount} 页 · ${filtered.length} 条`} toolbar={<WorkspaceActionButton disabledReason={actionReason("policy.policy.create", !scopeOptionsReady ? scopeOptionsBlockedReason : undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" disabled={!can('policy.policy.create') || busy || !scopeOptionsReady} onClick={openStrategyWizard} type="button"><Plus size={15} />新建</WorkspaceActionButton>}>
          <div className="policy-domain-list-tools"><input aria-label="搜索策略" placeholder="搜索名称或范围" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><label><input checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} type="checkbox" />查看已归档</label></div>
          {phase === 'loading' && <WorkspaceState kind="loading" title="读取策略" description="正在读取当前店铺策略、版本和运行模式。" />}
          {(phase === 'blocked' || phase === 'error') && <WorkspaceState kind="blocked" title="策略已失败关闭" description="生产模式不会使用界面临时数据。" details={visibleBlockedReason} />}
          {phase === 'ready' && !pageRows.length && <WorkspaceState kind="empty" title="当前店铺没有策略" description="点击“新建”按四步创建首个待检查策略。" />}
          <ul className="policy-domain-list">{pageRows.map((policy) => <li key={policy.id}><button aria-pressed={policy.id === selected?.id} data-selected={policy.id === selected?.id || undefined} onClick={() => selectPolicy(policy.id)} type="button"><span><b>优先级 {policy.priority}</b><em data-status={policy.status}>{POLICY_STATUS_LABELS[policy.status]}</em></span><strong>{policy.name}</strong><small>{formatPolicyScope(policy.scope, scopeOptions)}</small></button></li>)}</ul>
          <nav className="policy-domain-pagination" aria-label="策略分页"><WorkspaceActionButton disabledReason={actionReason(undefined, safePage <= 1 ? '已经是第一页。' : undefined)} busy={false} busyLabel="处理中…" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</WorkspaceActionButton><span>{safePage}/{pageCount}</span><WorkspaceActionButton disabledReason={actionReason(undefined, safePage >= pageCount ? '已经是最后一页。' : undefined)} busy={false} busyLabel="处理中…" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</WorkspaceActionButton></nav>
        </WorkbenchPanel>
        <div className="policy-domain-detail">{selected ? <>
          <section className="policy-domain-detail-head"><div><span>当前策略</span><h2>{selected.name}</h2><p>{formatPolicyScope(selected.scope, scopeOptions)} · 优先级 {selected.priority}（数字越小越优先）</p></div><em data-status={selected.status}>{POLICY_STATUS_LABELS[selected.status]}</em><div className="policy-domain-actions"><WorkspaceActionButton disabledReason={actionReason("policy.policy.update", !scopeOptionsReady ? scopeOptionsBlockedReason : selected.status === 'archived' ? '已归档策略不可编辑，请先恢复或新建策略。' : undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" disabled={!can('policy.policy.update') || busy || selected.status === 'archived' || !scopeOptionsReady} onClick={() => setPolicyEditor({ record: selected, draft: policyDraft(selected) })} type="button"><PencilSimple size={15} />编辑</WorkspaceActionButton>{selected.status === 'active' && <WorkspaceActionButton disabledReason={actionReason("policy.version.disable",  undefined)} busy={pending === 'policy-disable'} busyLabel="停用中…" className="workspace-button workspace-button--secondary" disabled={!can('policy.version.disable') || busy} onClick={() => void lifecycle('disable')} type="button"><Power size={15} />停用</WorkspaceActionButton>}{selected.status !== 'active' && selected.status !== 'archived' && <WorkspaceActionButton disabledReason={actionReason("policy.policy.archive",  undefined)} busy={pending === 'policy-archive'} busyLabel="归档中…" className="workspace-button workspace-button--secondary" disabled={!can('policy.policy.archive') || busy} onClick={() => void lifecycle('archive')} type="button"><Archive size={15} />归档</WorkspaceActionButton>}{selected.status === 'archived' && <WorkspaceActionButton disabledReason={actionReason("policy.policy.restore",  undefined)} busy={pending === 'policy-restore'} busyLabel="恢复中…" className="workspace-button workspace-button--secondary" disabled={!can('policy.policy.restore') || busy} onClick={() => void lifecycle('restore')} type="button"><ArrowClockwise size={15} />恢复</WorkspaceActionButton>}<details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>policyId={selected.id}</code><code>revision={selected.revision}</code><code>status={selected.status}</code></details></div></section>
          {!enabledVersion && <section aria-label="策略启用路径" className="policy-domain-enable-path"><h3>从待检查到启用</h3><p>当前没有启用版本，按顺序完成以下三步。</p><ol><li data-complete={Boolean(draftVersion) || undefined}><span>1</span><div><strong>创建草稿版本</strong><small>填写允许对象与安全边界。</small></div><WorkspaceActionButton disabledReason={actionReason("policy.version.create", !selectedScopeOption ? '当前策略范围无法从本店真实对象中核验，请重新采集或新建策略。' : draftVersion ? '草稿已存在，请使用检查或编辑入口。' : undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={!can('policy.version.create') || busy || Boolean(draftVersion) || !selectedScopeOption} onClick={() => setVersionEditor({ policyId: selected.id, record: null, draft: createVersionDraft() })} type="button">{draftVersion ? '已创建' : '创建'}</WorkspaceActionButton></li><li data-complete={Boolean(draftVersion) || undefined}><span>2</span><div><strong>检查边界</strong><small>核对对象、上下限、时段、证据与停止条件。</small></div><WorkspaceActionButton disabledReason={actionReason(undefined, !selectedScopeOption ? '当前策略范围无法从本店真实对象中核验，请重新采集或新建策略。' : !draftVersion ? '请先创建草稿版本，再检查与启用。' : undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={!draftVersion || busy || !selectedScopeOption} onClick={() => draftVersion && setVersionEditor({ policyId: selected.id, record: draftVersion, draft: editVersionDraft(draftVersion) })} type="button">检查</WorkspaceActionButton></li><li><span>3</span><div><strong>启用策略</strong><small>启用后规则冻结；不会自动切换运行模式。</small></div><WorkspaceActionButton disabledReason={actionReason("policy.version.enable", !selectedScopeOption ? '当前策略范围无法从本店真实对象中核验，请重新采集或新建策略。' : !draftVersion ? '请先创建草稿版本，再检查与启用。' : undefined)} busy={pending === 'version-enable'} busyLabel="启用中…" className="workspace-button workspace-button--primary" disabled={!draftVersion || !can('policy.version.enable') || busy || !selectedScopeOption} onClick={() => draftVersion && void enableVersion(draftVersion)} type="button">启用</WorkspaceActionButton></li></ol></section>}
          <section className="policy-domain-versions"><header><div><h3>不可变版本</h3><p>只有待检查规则可修改；启用后形成审计快照。</p></div><WorkspaceActionButton disabledReason={actionReason("policy.version.create", selected.status === 'archived' ? '已归档策略不可编辑，请先恢复或新建策略。' : !selectedScopeOption ? '当前策略范围无法从本店真实对象中核验，请重新采集或新建策略。' : undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" disabled={!can('policy.version.create') || busy || selected.status === 'archived' || !selectedScopeOption} onClick={() => setVersionEditor({ policyId: selected.id, record: null, draft: createVersionDraft() })} type="button"><Plus size={15} />创建草稿版本</WorkspaceActionButton></header><div className="policy-domain-version-list" role="list">{selectedVersions.map((version) => <article data-status={version.status} key={version.id} role="listitem"><div><span>{version.status === 'enabled' ? <LockKey size={18} /> : <ShieldCheck size={18} />}</span><div><strong>版本 {version.version} · {VERSION_STATUS_LABELS[version.status]}</strong><small>{version.rules.allowedAdEntityIds.length ? `${version.rules.allowedAdEntityIds.length} 个对象` : '0 个对象 · 自动执行保持阻断'} · 单次 ≤ {version.rules.maxChangePct}% · 批次预算 ${version.rules.totalImpactBudget} USD</small><small className="policy-domain-version-boundary">{formatExecutionWindowSummary(version.rules)}</small></div></div><div>{version.status === 'draft' && <WorkspaceActionButton disabledReason={actionReason("policy.version.update", !selectedScopeOption ? '当前策略范围无法从本店真实对象中核验，请重新采集或新建策略。' : undefined)} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={!can('policy.version.update') || busy || !selectedScopeOption} onClick={() => setVersionEditor({ policyId: selected.id, record: version, draft: editVersionDraft(version) })} type="button"><PencilSimple size={14} />检查并编辑</WorkspaceActionButton>}{version.status === 'draft' && <WorkspaceActionButton disabledReason={actionReason("policy.version.enable", !selectedScopeOption ? '当前策略范围无法从本店真实对象中核验，请重新采集或新建策略。' : undefined)} busy={pending === 'version-enable'} busyLabel="启用中…" className="workspace-button workspace-button--primary" disabled={!can('policy.version.enable') || busy || !selectedScopeOption} onClick={() => void enableVersion(version)} type="button"><CheckCircle size={14} />启用策略</WorkspaceActionButton>}{version.status !== 'draft' && <span className="policy-domain-immutable"><LockKey size={14} />内容不可变</span>}<details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>versionId={version.id}</code><code>revision={version.revision}</code><code>status={version.status}</code></details></div></article>)}</div></section>
          <section className="policy-domain-action-card"><h3>运行动作卡</h3>{displayedVersion ? <div className="policy-action-card-grid"><div><span>将改什么</span><strong>调整关键词竞价</strong></div><div><span>对象</span><strong>{formatPolicyScope(selected.scope, scopeOptions)} · {displayedVersion.rules.allowedAdEntityIds.length} 个可核验对象</strong></div><div><span>上下限</span><strong>{formatPolicyActionBoundary(displayedVersion.rules)}</strong></div><div><span>证据</span><strong>修改前、修改后、刷新后截图 + 身份与数值回读</strong></div><div><span>审批方式</span><strong>{runtime?.mode === 'policy_auto' ? '策略内自动（仍受全部安全门约束）' : '人工审批'}</strong></div></div> : <p>创建待检查规则后，这里会完整显示将改什么、对象、上下限、证据和审批方式。</p>}</section>
          <section className="policy-domain-safety"><h3>V1 固定安全合同</h3><div><span>允许动作</span><strong>调整关键词竞价</strong></div><div><span>必需证据</span><strong>修改前 / 修改后 / 刷新后截图、页面身份、数值回读</strong></div><div><span>结果无法确认</span><strong>停止并转人工对账，不自动重试</strong></div><p>广告身份、对象身份、审批或回读任一不成立，真实写入保持为 0。</p></section>
        </> : phase === 'ready' ? <WorkspaceState kind="empty" title="等待选择策略" description="从左侧选择策略查看不可变版本。" /> : null}</div>
      </div>
      {(error || feedback) && <p className="policy-domain-feedback" data-tone={error ? 'error' : 'success'} aria-live="polite">{error ? operatorFacingBlocker(error, '策略') : feedback}</p>}
      {!previewMode && (!viewReady || error) && <details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>{error || blockedReason}</code></details>}
    </PageFrame>
    {policyEditor && <PolicyDialog record={policyEditor.record} draft={policyEditor.draft} busy={pending === 'policy-save'} scopeFrozen={selectedVersions.length > 0} scopeOptions={scopeOptions} onChange={(draft) => setPolicyEditor((current) => current ? { ...current, draft } : current)} onClose={() => setPolicyEditor(null)} onSave={() => void savePolicy()} />}
    {strategyWizard && <StrategyWizardDialog draft={strategyWizard} scopeOptions={scopeOptions} busy={pending === 'strategy-create'} onChange={setStrategyWizard} onClose={() => setStrategyWizard(null)} onSave={() => void saveStrategy()} />}
    {selectedVersionEditor && <VersionDialog record={selectedVersionEditor.record} draft={selectedVersionEditor.draft} busy={pending === 'version-save'} onChange={(draft) => setVersionEditor((current) => current ? { ...current, draft } : current)} onClose={() => setVersionEditor(null)} onSave={() => void saveVersion()} />}
    <ReasonRequiredDialog
      open={clearKillSwitchOpen}
      eyebrow="解除紧急停止"
      title="确认解除店铺级紧急停止"
      description="解除急停不会自动恢复策略内自动。请记录复核原因后继续。"
      tone="danger"
      confirmLabel="确认解除"
      reasonLabel="解除原因 *"
      busy={pending === 'kill-switch-clear'}
      reasonMinLength={1}
      isConfirmDisabled={() => !can('policy.kill-switch.clear')}
      diagnosticDetails={<><code>storeId={storeContext?.storeId ?? 'none'}</code><code>runtime.revision={runtime?.revision ?? 'none'}</code></>}
      onConfirm={(reason) => void clearKillSwitch(reason)}
      onClose={() => setClearKillSwitchOpen(false)}
    />
    {modeChangeConfirm && (
      <ReasonRequiredDialog
        eyebrow="模式切换"
        open
        title={`切换为${modeChangeConfirm.mode === 'policy_auto' ? '策略内自动' : '人工审批'}？`}
        description="切换执行模式影响整店的 AI 自动执行边界。请说明这次操作的业务依据。"
        tone="primary"
        confirmLabel={`确认切换为${modeChangeConfirm.mode === 'policy_auto' ? '策略内自动' : '人工审批'}`}
        reasonLabel="切换原因 *"
        reasonMinLength={2}
        reasonPlaceholder="例如：策略版本已发布，启用自动执行；或当前活动已结束，暂停 AI 自动调整"
        isConfirmDisabled={() => !can('policy.runtime.mode.set')}
        diagnosticDetails={<><code>storeId={storeContext?.storeId ?? 'none'}</code><code>runtime.revision={runtime?.revision ?? 'none'}</code></>}
        onClose={() => setModeChangeConfirm(null)}
        onConfirm={(reason) => {
          const mode = modeChangeConfirm.mode;
          setModeChangeConfirm(null);
          void setMode(mode, reason);
        }}
      />
    )}
  </div>;
}
