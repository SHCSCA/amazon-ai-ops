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
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import {
  assertMissionAuthorityContext,
  assertPolicyBelongsToContext,
  readPolicyDomainWindowApi,
  type AutonomyProjection,
  type PolicyDomainRendererApi,
  type UpdateDraftPolicyVersionInput,
} from './mission-domain-window-api';
import './policy-workspace.css';

const OPERATOR = 'desktop-operator';
const PAGE_SIZE = 6;

type PolicyDraft = { name: string; scope: string; priority: string };
type VersionDraft = {
  version: string;
  allowedAdEntityIds: string;
  maxChangePct: string;
  totalImpactBudget: string;
  validFrom: string;
  validUntil: string;
};

export type PolicyWorkspaceProps = {
  apiOverride?: PolicyDomainRendererApi;
  authoritativeAutonomy?: MissionControlAutonomyProjection | null;
  blockedReason: string;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onInspectBoundary?: () => void;
  previewMode: boolean;
  storeContext: StoreContextEnvelope | null;
  onRefreshAuthority?: () => Promise<void> | void;
};

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'Policy 操作未完成，请刷新后重试。';
}

function split(value: string): string[] {
  return value.split(/[\n,，；;]/).map((item) => item.trim()).filter(Boolean);
}

function capabilityReady(
  rows: readonly MissionControlCapabilityProjection[] | undefined,
  capabilityId: string,
  previewMode: boolean,
): boolean {
  const row = rows?.find((item) => item.capabilityId === capabilityId);
  return row?.state === (previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE');
}

export function responseMatchesPolicyDetail(
  currentAuthorityKey: string,
  capturedAuthorityKey: string,
  currentSelectedId: string,
  capturedSelectedId: string,
  currentSequence: number,
  capturedSequence: number,
): boolean {
  return currentAuthorityKey === capturedAuthorityKey
    && currentSelectedId === capturedSelectedId
    && currentSequence === capturedSequence;
}

function defaultRules(entityIds: string[], maxChangePct: number, impactBudget: number): PolicyVersionRules {
  return {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: entityIds,
    maxChangePct,
    totalImpactBudget: impactBudget,
    requiredEvidence: ['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value'],
    stopConditions: [
      { code: 'identity_drift', detail: '店铺、页面或广告对象身份漂移立即停止。' },
      { code: 'expected_before_mismatch', detail: 'Before 值与预期不一致时拒绝写入。' },
      { code: 'unknown_result', detail: 'UNKNOWN 不自动重试，转人工对账。' },
      { code: 'data_stale', detail: '数据过期时禁止执行。' },
      { code: 'impact_budget_exhausted', detail: '批次影响预算耗尽时停止。' },
      { code: 'kill_switch', detail: '店铺紧急停止开启时拒绝执行。' },
    ],
    killSwitch: false,
  };
}

function policyDraft(record?: PolicyRecord | null): PolicyDraft {
  return { name: record?.name ?? '', scope: record?.scope ?? 'store', priority: String(record?.priority ?? 20) };
}

function versionDraft(record?: PolicyVersionRecord | null): VersionDraft {
  return {
    version: String(record?.version ?? 1),
    allowedAdEntityIds: record?.rules.allowedAdEntityIds.join('\n') ?? '',
    maxChangePct: String(record?.rules.maxChangePct ?? 15),
    totalImpactBudget: String(record?.rules.totalImpactBudget ?? 50),
    validFrom: record?.validFrom?.slice(0, 10) ?? '',
    validUntil: record?.validUntil?.slice(0, 10) ?? '',
  };
}

export function buildCreatePolicyInput(draft: PolicyDraft, id: string): CreatePolicyInput {
  const priority = Number(draft.priority);
  if (!draft.name.trim() || !draft.scope.trim()) throw new Error('请填写策略名称与作用范围。');
  if (!Number.isSafeInteger(priority) || priority < 1 || priority > 100) throw new Error('策略优先级必须是 1–100 的整数。');
  return { id, name: draft.name.trim(), scope: draft.scope.trim(), priority, actorId: OPERATOR };
}

export function buildPolicyVersionInput(
  policy: PolicyRecord,
  draft: VersionDraft,
  id: string,
): CreatePolicyVersionInput {
  const version = Number(draft.version);
  const maxChangePct = Number(draft.maxChangePct);
  const totalImpactBudget = Number(draft.totalImpactBudget);
  const entities = split(draft.allowedAdEntityIds);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('版本号必须是正整数。');
  if (!(maxChangePct > 0 && maxChangePct <= 15)) throw new Error('V1 关键词竞价单次变化必须在 0–15% 内。');
  if (!(totalImpactBudget >= 0)) throw new Error('批次影响预算不能小于 0 USD。');
  if (draft.validFrom && draft.validUntil && draft.validFrom >= draft.validUntil) throw new Error('策略有效期结束日期必须晚于开始日期。');
  return {
    id,
    policyId: policy.id,
    version,
    rules: defaultRules(entities, maxChangePct, totalImpactBudget),
    ...(draft.validFrom ? { validFrom: `${draft.validFrom}T07:00:00.000Z` } : {}),
    ...(draft.validUntil ? { validUntil: `${draft.validUntil}T07:00:00.000Z` } : {}),
    actorId: OPERATOR,
  };
}

export function buildPolicyVersionUpdate(record: PolicyVersionRecord, draft: VersionDraft): UpdateDraftPolicyVersionInput {
  const create = buildPolicyVersionInput(
    { id: record.policyId } as PolicyRecord,
    { ...draft, version: String(record.version) },
    record.id,
  );
  return {
    id: record.id,
    expectedRevision: record.revision,
    rules: create.rules,
    validFrom: create.validFrom ?? null,
    validUntil: create.validUntil ?? null,
    actorId: OPERATOR,
  };
}

function PolicyDialog({ record, draft, busy, onChange, onClose, onSave }: {
  record: PolicyRecord | null;
  draft: PolicyDraft;
  busy: boolean;
  onChange: (draft: PolicyDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return <div className="mission-control-dialog-backdrop"><section aria-modal="true" className="mission-control-dialog policy-domain-dialog" role="dialog" aria-labelledby="policy-dialog-title"><header><div><span>POLICY · AMAZON US / USD</span><h2 id="policy-dialog-title">{record ? '编辑策略' : '新建策略'}</h2><p>策略元数据可通过 CAS 修改；已启用版本内容保持不可变。</p></div><button aria-label="关闭策略编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button></header><div className="policy-domain-form"><label><span>策略名称 *</span><input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label><label><span>作用范围 *</span><select value={draft.scope} onChange={(event) => onChange({ ...draft, scope: event.target.value })}><option value="store">整个店铺</option><option value="product">当前产品范围</option><option value="data">数据质量门</option></select></label><label><span>优先级 *</span><input min="1" max="100" type="number" value={draft.priority} onChange={(event) => onChange({ ...draft, priority: event.target.value })} /></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : record ? '保存策略' : '创建策略'}</button></footer></section></div>;
}

function VersionDialog({ record, draft, busy, onChange, onClose, onSave }: {
  record: PolicyVersionRecord | null;
  draft: VersionDraft;
  busy: boolean;
  onChange: (draft: VersionDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return <div className="mission-control-dialog-backdrop"><section aria-modal="true" className="mission-control-dialog policy-domain-dialog" role="dialog" aria-labelledby="version-dialog-title"><header><div><span>IMMUTABLE POLICY SNAPSHOT</span><h2 id="version-dialog-title">{record ? '编辑草稿版本' : '新建策略版本'}</h2><p>启用后规则不可编辑；后续变化必须新建版本。</p></div><button aria-label="关闭版本编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button></header><div className="policy-domain-form policy-domain-form--version"><label><span>版本号 *</span><input disabled={Boolean(record)} min="1" type="number" value={draft.version} onChange={(event) => onChange({ ...draft, version: event.target.value })} /></label><label><span>最大单次变化 *</span><div className="policy-domain-input-unit"><input max="15" min="0.1" step="0.1" type="number" value={draft.maxChangePct} onChange={(event) => onChange({ ...draft, maxChangePct: event.target.value })} /><b>%</b></div></label><label><span>批次影响预算 *</span><div className="policy-domain-input-unit"><b>$</b><input min="0" step="1" type="number" value={draft.totalImpactBudget} onChange={(event) => onChange({ ...draft, totalImpactBudget: event.target.value })} /></div></label><label className="policy-domain-form__wide"><span>允许广告实体 ID（可空；空=零执行权限）</span><textarea rows={4} value={draft.allowedAdEntityIds} onChange={(event) => onChange({ ...draft, allowedAdEntityIds: event.target.value })} /><small>每行一个稳定关键词广告实体 ID；未知 ID 由 Main 失败关闭。</small></label><label><span>生效日期</span><input type="date" value={draft.validFrom} onChange={(event) => onChange({ ...draft, validFrom: event.target.value })} /></label><label><span>失效日期</span><input type="date" value={draft.validUntil} onChange={(event) => onChange({ ...draft, validUntil: event.target.value })} /></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : '保存草稿版本'}</button></footer></section></div>;
}

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
  const [versionEditor, setVersionEditor] = useState<{ record: PolicyVersionRecord | null; draft: VersionDraft } | null>(null);
  const [clearKillSwitchOpen, setClearKillSwitchOpen] = useState(false);
  const [clearKillSwitchReason, setClearKillSwitchReason] = useState('');
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const mutationSequence = useRef(0);
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const authorityRef = useRef(authorityKey);
  authorityRef.current = authorityKey;
  const api = apiOverride ?? readPolicyDomainWindowApi();
  const expectedState = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const viewReady = capabilityReady(capabilities, 'policy.version.view', previewMode);
  const selected = policies.find((policy) => policy.id === selectedId) ?? policies[0] ?? null;
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

  const load = async (context: StoreContextEnvelope, key: string) => {
    const current = ++sequence.current;
    if (!viewReady || !api) {
      setPhase('blocked');
      setPolicies([]);
      setError(!viewReady ? `策略中心需要 ${expectedState} 能力，当前已失败关闭。` : 'Policy production window API 未接入；Renderer 未回退到示例数据。');
      return;
    }
    setPhase('loading'); setError(''); setFeedback('');
    try {
      assertMissionAuthorityContext(context);
      const [rows, runtimeProjection] = await Promise.all([api.listPolicies(context, { includeArchived }), api.getPolicyRuntime(context)]);
      if (authorityRef.current !== key || sequence.current !== current) return;
      rows.forEach((row) => assertPolicyBelongsToContext(row, context));
      setPolicies(rows);
      setRuntime(runtimeProjection);
      setSelectedId((id) => rows.some((row) => row.id === id) ? id : rows[0]?.id ?? '');
      setPhase('ready');
    } catch (loadError) {
      if (authorityRef.current !== key || sequence.current !== current) return;
      setPhase('error'); setPolicies([]); setVersions([]); setRuntime(null); setError(message(loadError));
    }
  };

  useEffect(() => {
    detailSequence.current += 1;
    mutationSequence.current += 1;
    setPending(null); setSelectedId(''); setVersions([]); setPolicyEditor(null); setVersionEditor(null); setClearKillSwitchOpen(false); setClearKillSwitchReason(''); setPage(1);
    if (storeContext) void load(storeContext, authorityKey); else { setPhase('blocked'); setError('等待 Main 返回当前 StoreContext。'); }
  }, [authorityKey, includeArchived, apiOverride, viewReady]);

  useEffect(() => {
    if (!selected || !storeContext || !api || phase !== 'ready') {
      detailSequence.current += 1;
      setVersions([]); return;
    }
    const capturedKey = authorityKey;
    const capturedId = selected.id;
    const capturedSequence = ++detailSequence.current;
    void api.listPolicyVersions(storeContext, selected.id).then((rows) => {
      if (!responseMatchesPolicyDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) return;
      rows.forEach((row) => assertPolicyBelongsToContext(row, storeContext));
      setVersions(rows);
    }).catch((loadError) => {
      if (responseMatchesPolicyDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) setError(message(loadError));
    });
  }, [selected?.id, authorityKey, api, phase]);

  useEffect(() => {
    if (!authoritativeAutonomy) return;
    setRuntime((current) => current ? { ...current, mode: authoritativeAutonomy.currentMode } : current);
  }, [authoritativeAutonomy?.currentMode]);

  const mutate = async <T,>(key: string, operation: (domain: PolicyDomainRendererApi, context: StoreContextEnvelope) => Promise<T>): Promise<T | null> => {
    if (!api || !storeContext || busy) return null;
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const current = ++mutationSequence.current;
    setPending(key); setError(''); setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (authorityRef.current !== capturedKey || mutationSequence.current !== current) return null;
      return result;
    } catch (mutationError) {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setError(message(mutationError));
      return null;
    } finally {
      if (authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
    }
  };

  const savePolicy = async () => {
    if (!policyEditor || !storeContext) return;
    let input: CreatePolicyInput;
    try { input = buildCreatePolicyInput(policyEditor.draft, policyEditor.record?.id ?? `POLICY-${String(storeContext.storeId)}-${Date.now()}`); }
    catch (validationError) { setError(message(validationError)); return; }
    const saved = policyEditor.record
      ? await mutate('policy-save', (domain, context) => domain.updatePolicy(context, { id: policyEditor.record!.id, expectedRevision: policyEditor.record!.revision, actorId: OPERATOR, patch: { name: input.name, scope: input.scope, priority: input.priority } }))
      : await mutate('policy-save', (domain, context) => domain.createPolicy(context, input));
    if (!saved) return;
    assertPolicyBelongsToContext(saved, storeContext);
    setPolicies((rows) => rows.some((row) => row.id === saved.id) ? rows.map((row) => row.id === saved.id ? saved : row) : [...rows, saved]);
    setSelectedId(saved.id); setPolicyEditor(null); setFeedback(policyEditor.record ? '策略元数据已通过 CAS 更新。' : '策略已创建，请新建草稿版本。');
  };

  const saveVersion = async () => {
    if (!versionEditor || !selected || !storeContext) return;
    try {
      const saved = versionEditor.record
        ? await mutate('version-save', (domain, context) => domain.updateDraftPolicyVersion(context, buildPolicyVersionUpdate(versionEditor.record!, versionEditor.draft)))
        : await mutate('version-save', (domain, context) => domain.createPolicyVersion(context, buildPolicyVersionInput(selected, versionEditor.draft, `POL-${String(storeContext.storeId)}-${selected.id}-V${versionEditor.draft.version}`)));
      if (!saved) return;
      setVersions((rows) => rows.some((row) => row.id === saved.id) ? rows.map((row) => row.id === saved.id ? saved : row) : [saved, ...rows]);
      setVersionEditor(null); setFeedback('策略草稿版本已保存。');
    } catch (validationError) { setError(message(validationError)); }
  };

  const synchronizeShellAuthority = async (capturedKey: string): Promise<boolean> => {
    try {
      await onRefreshAuthority?.();
      return authorityRef.current === capturedKey;
    } catch (refreshError) {
      if (authorityRef.current === capturedKey) setError(`策略已写入，但全局 Authority 刷新失败：${message(refreshError)}`);
      return false;
    }
  };

  const lifecycle = async (action: 'disable' | 'archive' | 'restore') => {
    if (!selected) return;
    const capturedKey = authorityKey;
    const saved = await mutate(`policy-${action}`, (domain, context) => domain[`${action}Policy` as const](context, { id: selected.id, expectedRevision: selected.revision, actorId: OPERATOR, reason: `operator_${action}` }));
    if (!saved) return;
    setPolicies((rows) => rows.map((row) => row.id === saved.id ? saved : row));
    if (action === 'disable' && !await synchronizeShellAuthority(capturedKey)) return;
    setFeedback(action === 'disable' ? '策略已停用；运行时已回到人工审批。' : action === 'archive' ? '策略已归档。' : '策略已恢复为停用状态。');
  };

  const enableVersion = async (version: PolicyVersionRecord) => {
    if (!selected) return;
    const capturedKey = authorityKey;
    const saved = await mutate('version-enable', (domain, context) => domain.enablePolicyVersion(context, { policyId: selected.id, versionId: version.id, expectedPolicyRevision: selected.revision, expectedVersionRevision: version.revision, actorId: OPERATOR }));
    if (!saved || !storeContext) return;
    await load(storeContext, authorityKey);
    if (!await synchronizeShellAuthority(capturedKey)) return;
    setFeedback(`v${saved.version} 已启用并冻结为不可变策略快照。`);
  };

  const setMode = async (mode: PolicyAutonomyMode) => {
    if (!runtime) return;
    const capturedKey = authorityKey;
    const saved = await mutate('runtime-mode', (domain, context) => domain.setAutonomyMode(context, { expectedRevision: runtime.revision, mode, reason: `operator_set_${mode}` }));
    if (!saved) return;
    setRuntime(saved);
    if (!await synchronizeShellAuthority(capturedKey)) return;
    setFeedback(mode === 'policy_auto' ? '已切换为策略内自动；仍受不可变版本、熔断和急停约束。' : '已切换为人工审批。');
  };

  const enableKillSwitch = async () => {
    if (!runtime) return;
    const capturedKey = authorityKey;
    if (!can('policy.kill-switch.enable')) { setError('缺少精确能力 policy.kill-switch.enable，急停已阻断。'); return; }
    const saved = await mutate('kill-switch-enable', (domain, context) => domain.setKillSwitch(context, { expectedRevision: runtime.revision, enabled: true, reason: 'operator_emergency_stop' }));
    if (!saved) return;
    setRuntime(saved);
    if (!await synchronizeShellAuthority(capturedKey)) return;
    setFeedback('店铺级紧急停止已开启；自动模式已降级为人工审批。');
  };

  const clearKillSwitch = async () => {
    if (!runtime || !clearKillSwitchReason.trim()) return;
    const capturedKey = authorityKey;
    if (!can('policy.kill-switch.clear')) { setError('缺少精确能力 policy.kill-switch.clear，解除急停已阻断。'); return; }
    const saved = await mutate('kill-switch-clear', (domain, context) => domain.setKillSwitch(context, {
      expectedRevision: runtime.revision,
      enabled: false,
      reason: clearKillSwitchReason.trim(),
    }));
    if (!saved) return;
    setRuntime(saved);
    setClearKillSwitchOpen(false);
    setClearKillSwitchReason('');
    if (!await synchronizeShellAuthority(capturedKey)) return;
    setFeedback('紧急停止已解除；系统不会自动恢复策略内自动。');
  };

  return <div className="mission-control-workspace-root policy-domain-workspace" data-canonical-surface="policy" data-capability-state={viewReady ? expectedState : 'BLOCKED'} data-preview-mode={previewMode || undefined}>
    <p className="sr-only">{viewReady && api ? 'Policy Authority 已接入。' : `Policy 已失败关闭；${!api ? 'production window API 未接入。' : blockedReason}`}</p>
    <PageFrame className="policy-domain-page" description="策略先于执行判定；策略内自动只在启用版本、阈值、数据新鲜度与单次变更边界内工作。" pageId="policy-rules" title="自动边界与审批策略" task={<TaskBanner compact eyebrow="POLICY AUTHORITY" title="自动边界与审批策略" description="启用版本不可编辑；Renderer 只可切换人工审批/策略内自动和店铺级急停，不能写熔断器或 activeVersion。" primaryAction={{ actionId: 'policy.policy.create', label: '新建策略', disabled: !can('policy.policy.create') || busy, disabledReason: blockedReason, onClick: () => setPolicyEditor({ record: null, draft: policyDraft() }) }} secondaryActions={onInspectBoundary ? [{ actionId: 'policy-boundary', label: '接入边界', onClick: onInspectBoundary }] : []} status={<span className="policy-domain-authority" data-state={viewReady ? expectedState : 'BLOCKED'}>{previewMode ? '仅开发预览' : viewReady ? '生产 Authority' : '已阻断'}</span>}>{previewMode && <p className="policy-domain-preview-note">显式内存 adapter · Amazon US · USD · 不代表真实广告执行授权</p>}</TaskBanner>} summary={<SummaryStrip ariaLabel="Policy Authority 摘要" items={[{ id: 'active', label: '已启用策略', value: `${policies.filter((policy) => policy.status === 'active').length} / ${policies.length}` }, { id: 'versions', label: '不可变策略版本', value: `${versions.filter((version) => version.status === 'enabled').length} 个启用` }, { id: 'runtime', label: '当前执行模式', value: runtime?.mode === 'policy_auto' ? '策略内自动' : '人工审批' }, { id: 'switch', label: '紧急停止', value: runtime?.killSwitch ? '已开启' : '已关闭', tone: runtime?.killSwitch ? 'blocked' : 'neutral' }]} /> }>
      <section aria-label="策略店铺隔离范围" className="policy-domain-scope-notice"><LockKey size={15} /><strong>{storeContext ? String(storeContext.storeId) : '等待 Main'} 独立数据域</strong><span>策略、不可变版本与运行模式仅作用于当前店铺，不跨店铺继承。</span><em>Amazon US · USD</em></section>
      <section className="policy-domain-runtime" aria-label="店铺级策略运行时">
        <div><span>店铺运行模式</span><div className="policy-domain-segmented"><button aria-pressed={runtime?.mode === 'manual_approval'} disabled={!can('policy.runtime.mode.set') || busy || !runtime} onClick={() => void setMode('manual_approval')} type="button">人工审批</button><button aria-pressed={runtime?.mode === 'policy_auto'} disabled={!can('policy.runtime.mode.set') || busy || !runtime || !runtime.canAutoExecute} onClick={() => void setMode('policy_auto')} type="button">策略内自动</button></div></div>
        <div><span>权威运行时</span><strong>{runtime?.activePolicyVersionId ?? '未绑定启用版本'}</strong><small>熔断器 {runtime?.circuitBreakerState ?? '—'} · 只读</small></div>
        {runtime?.killSwitch
          ? <button className="workspace-button workspace-button--primary policy-domain-kill-switch" disabled={!can('policy.kill-switch.clear') || busy} onClick={() => setClearKillSwitchOpen(true)} type="button"><Power size={16} />解除紧急停止</button>
          : <button className="workspace-button workspace-button--secondary policy-domain-kill-switch" disabled={!can('policy.kill-switch.enable') || busy || !runtime} onClick={() => void enableKillSwitch()} type="button"><StopCircle size={16} />开启紧急停止</button>}
      </section>
      <div className="policy-domain-layout">
        <WorkbenchPanel className="policy-domain-list-panel" title="策略边界" description="按优先级读取当前店铺策略。" footer={`第 ${safePage}/${pageCount} 页 · ${filtered.length} 条`} toolbar={<button className="workspace-button workspace-button--primary" disabled={!can('policy.policy.create') || busy} onClick={() => setPolicyEditor({ record: null, draft: policyDraft() })} type="button"><Plus size={15} />新建</button>}>
          <div className="policy-domain-list-tools"><input aria-label="搜索策略" placeholder="搜索名称、范围或 ID" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><label><input checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} type="checkbox" />查看已归档</label></div>
          {phase === 'loading' && <WorkspaceState kind="loading" title="读取 Policy Authority" description="正在读取当前店铺策略、版本和运行时。" />}
          {(phase === 'blocked' || phase === 'error') && <WorkspaceState kind="blocked" title="Policy 已失败关闭" description="生产模式不会使用 Renderer 临时数据。" details={error || blockedReason} />}
          {phase === 'ready' && !pageRows.length && <WorkspaceState kind="empty" title="当前店铺没有策略" description="先创建策略元数据，再建立首个草稿版本。" />}
          <ul className="policy-domain-list">{pageRows.map((policy) => <li key={policy.id}><button aria-pressed={policy.id === selected?.id} data-selected={policy.id === selected?.id || undefined} onClick={() => setSelectedId(policy.id)} type="button"><span><b>P{policy.priority}</b><em data-status={policy.status}>{policy.status}</em></span><strong>{policy.name}</strong><small>{policy.scope} · r{policy.revision}</small></button></li>)}</ul>
          <nav className="policy-domain-pagination" aria-label="策略分页"><button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button><span>{safePage}/{pageCount}</span><button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button></nav>
        </WorkbenchPanel>
        <div className="policy-domain-detail">{selected ? <>
          <section className="policy-domain-detail-head"><div><span>POLICY · {selected.id}</span><h2>{selected.name}</h2><p>{selected.scope} · 优先级 P{selected.priority} · revision {selected.revision}</p></div><em data-status={selected.status}>{selected.status}</em><div className="policy-domain-actions"><button className="workspace-button workspace-button--primary" disabled={!can('policy.policy.update') || busy || selected.status === 'archived'} onClick={() => setPolicyEditor({ record: selected, draft: policyDraft(selected) })} type="button"><PencilSimple size={15} />编辑</button>{selected.status === 'active' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.version.disable') || busy} onClick={() => void lifecycle('disable')} type="button"><Power size={15} />停用</button>}{selected.status !== 'active' && selected.status !== 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.policy.archive') || busy} onClick={() => void lifecycle('archive')} type="button"><Archive size={15} />归档</button>}{selected.status === 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.policy.restore') || busy} onClick={() => void lifecycle('restore')} type="button"><ArrowClockwise size={15} />恢复</button>}</div></section>
          <section className="policy-domain-versions"><header><div><h3>不可变版本</h3><p>只有 draft 可修改；enable 后形成审计快照。</p></div><button className="workspace-button workspace-button--primary" disabled={!can('policy.version.create') || busy || selected.status === 'archived'} onClick={() => setVersionEditor({ record: null, draft: versionDraft({ version: Math.max(0, ...versions.map((item) => item.version)) + 1 } as PolicyVersionRecord) })} type="button"><Plus size={15} />新建版本</button></header><div className="policy-domain-version-list" role="list">{versions.map((version) => <article data-status={version.status} key={version.id} role="listitem"><div><span>{version.status === 'enabled' ? <LockKey size={18} /> : <ShieldCheck size={18} />}</span><div><strong>v{version.version} · {version.id}</strong><small>r{version.revision} · {version.rules.allowedAdEntityIds.length ? `${version.rules.allowedAdEntityIds.length} 个对象` : '0 对象 · 不可自动签发'} · ≤ {version.rules.maxChangePct}% · ${version.rules.totalImpactBudget}</small></div></div><div>{version.status === 'draft' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.version.update') || busy} onClick={() => setVersionEditor({ record: version, draft: versionDraft(version) })} type="button"><PencilSimple size={14} />编辑草稿</button>}{version.status === 'draft' && <button className="workspace-button workspace-button--primary" disabled={!can('policy.version.enable') || busy} onClick={() => void enableVersion(version)} type="button"><CheckCircle size={14} />启用并冻结</button>}{version.status !== 'draft' && <span className="policy-domain-immutable"><LockKey size={14} />内容不可变</span>}</div></article>)}</div></section>
          <section className="policy-domain-safety"><h3>V1 固定安全合同</h3><div><span>允许动作</span><strong>set_keyword_bid</strong></div><div><span>必需证据</span><strong>Before / After / Reload / Page identity / Readback value</strong></div><div><span>UNKNOWN</span><strong>停止，且不自动重试</strong></div><p>界面不会暴露 circuitBreakerState 或 activePolicyVersionId 的通用写入口。</p></section>
        </> : phase === 'ready' ? <WorkspaceState kind="empty" title="等待选择策略" description="从左侧选择策略查看不可变版本。" /> : null}</div>
      </div>
      {(error || feedback) && <p className="policy-domain-feedback" data-tone={error ? 'error' : 'success'} aria-live="polite">{error || feedback}</p>}
    </PageFrame>
    {policyEditor && <PolicyDialog record={policyEditor.record} draft={policyEditor.draft} busy={pending === 'policy-save'} onChange={(draft) => setPolicyEditor((current) => current ? { ...current, draft } : current)} onClose={() => setPolicyEditor(null)} onSave={() => void savePolicy()} />}
    {versionEditor && <VersionDialog record={versionEditor.record} draft={versionEditor.draft} busy={pending === 'version-save'} onChange={(draft) => setVersionEditor((current) => current ? { ...current, draft } : current)} onClose={() => setVersionEditor(null)} onSave={() => void saveVersion()} />}
    {clearKillSwitchOpen && <div className="mission-control-dialog-backdrop"><section aria-labelledby="clear-kill-switch-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>CLEAR EMERGENCY STOP</span><h2 id="clear-kill-switch-title">确认解除店铺级紧急停止</h2><p>解除急停不会自动恢复策略内自动。请记录复核原因后继续。</p></div></header><div className="policy-domain-clear-reason"><label><span>解除原因 *</span><textarea autoFocus onChange={(event) => setClearKillSwitchReason(event.target.value)} rows={4} value={clearKillSwitchReason} /></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => { setClearKillSwitchOpen(false); setClearKillSwitchReason(''); }} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || !clearKillSwitchReason.trim() || !can('policy.kill-switch.clear')} onClick={() => void clearKillSwitch()} type="button">{pending === 'kill-switch-clear' ? '解除中…' : '确认解除'}</button></footer></section></div>}
  </div>;
}
