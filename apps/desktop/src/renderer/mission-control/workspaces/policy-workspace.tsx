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
const TIME_OF_DAY_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAY_OPTIONS = [
  { value: 1, shortLabel: '一', label: '周一' },
  { value: 2, shortLabel: '二', label: '周二' },
  { value: 3, shortLabel: '三', label: '周三' },
  { value: 4, shortLabel: '四', label: '周四' },
  { value: 5, shortLabel: '五', label: '周五' },
  { value: 6, shortLabel: '六', label: '周六' },
  { value: 0, shortLabel: '日', label: '周日' },
] as const;
const DEFAULT_EXECUTION_DAYS = [1, 2, 3, 4, 5];

type PolicyDraft = { name: string; scope: string; priority: string };
type PolicyScopeLevel = 'store' | 'product' | 'campaign' | 'ad_group' | 'keyword';
type PolicyScopeOption = {
  value: string;
  level: PolicyScopeLevel;
  label: string;
  allowedAdEntityIds: string[];
};
type VersionDraft = {
  version: string;
  allowedAdEntityIds: string;
  maxChangePct: string;
  totalImpactBudget: string;
  maxDailyActionCount: string;
  cooldownMinutes: string;
  executionTimeZone: string;
  executionDaysOfWeek: number[];
  executionWindowStart: string;
  executionWindowEnd: string;
  validFrom: string;
  validUntil: string;
};
type VersionEditorState = {
  policyId: string;
  record: PolicyVersionRecord | null;
  draft: VersionDraft;
};
type StrategyWizardDraft = {
  step: 1 | 2 | 3 | 4;
  policy: PolicyDraft;
  scopeLevel: PolicyScopeLevel;
  scopeValue: string;
  version: VersionDraft;
};

const POLICY_SCOPE_LABELS: Record<PolicyScopeLevel, string> = {
  store: '整个店铺',
  product: '所选产品',
  campaign: '广告活动',
  ad_group: '广告组',
  keyword: '关键词',
};

const POLICY_STATUS_LABELS: Record<PolicyRecord['status'], string> = {
  draft: '待配置',
  active: '已启用',
  disabled: '已停用',
  archived: '已归档',
};

const VERSION_STATUS_LABELS: Record<PolicyVersionRecord['status'], string> = {
  draft: '待检查',
  enabled: '已启用',
  retired: '已停用',
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
  return error instanceof Error && error.message.trim() ? error.message : '策略操作未完成，请刷新后重试。';
}

const SAFE_OPERATOR_POLICY_REASONS = [
  /^策略操作未完成，请刷新后重试。$/,
  /^当前店铺的产品或广告对象读取服务尚未就绪。$/,
  /^当前店铺产品和广告对象尚未读取完成；请先重新读取对象。$/,
  /^所选对象已不可用，请返回第一步重新选择。$/,
  /^当前策略范围已无法从本店真实对象中核验；请新建策略并重新选择对象范围。$/,
  /^策略已切换，旧版本编辑已关闭。下一步：请在当前策略重新选择待检查版本。$/,
  /^版本与当前策略归属不一致，本次结果已丢弃。下一步：请重新读取当前策略版本。$/,
  /^版本与当前策略归属不一致，已阻断启用。下一步：请重新读取当前策略版本。$/,
  /^请填写策略名称与作用范围。$/,
  /^策略优先级必须是 1–100 的整数。$/,
  /^版本号必须是正整数。$/,
  /^V1 关键词竞价单次变化必须在 0–10% 内。$/,
  /^批次影响预算不能小于 0 USD。$/,
  /^每日动作上限必须是(?:正整数| 1–10000 的整数)。$/,
  /^同对象冷却时间必须是(?:非负整数| 0–525600 的整数)。$/,
  /^执行窗口至少选择一个执行日。$/,
  /^执行窗口星期必须是 0–6 的整数。$/,
  /^执行窗口星期不能重复。$/,
  /^执行时区必须填写有效的 IANA 时区。$/,
  /^执行窗口时间必须使用 HH:mm 24 小时格式。$/,
  /^V1 执行窗口结束时间必须晚于开始时间，且不能跨午夜。$/,
  /^策略有效期结束日期必须晚于开始日期。$/,
] as const;

export function operatorFacingBlocker(reason: string | null | undefined, subject: string): string {
  const value = reason?.trim();
  if (value && SAFE_OPERATOR_POLICY_REASONS.some((pattern) => pattern.test(value))) return value;
  return `${subject}当前不可用。原因：无法确认当前店铺的策略权限或服务状态。下一步：请确认当前店铺连接与本机服务后重试。`;
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

export function policyVersionDetailForSelection(
  selectedPolicyId: string,
  versions: readonly PolicyVersionRecord[],
  versionEditor: VersionEditorState | null,
): { versions: PolicyVersionRecord[]; versionEditor: VersionEditorState | null } {
  if (!selectedPolicyId) return { versions: [], versionEditor: null };
  const selectedVersions = versions.filter((version) => version.policyId === selectedPolicyId);
  const selectedEditor = versionEditor?.policyId === selectedPolicyId
    && (!versionEditor.record || versionEditor.record.policyId === selectedPolicyId)
    ? versionEditor
    : null;
  return { versions: selectedVersions, versionEditor: selectedEditor };
}

function defaultRules(
  entityIds: string[],
  maxChangePct: number,
  impactBudget: number,
  maxDailyActionCount: number,
  cooldownMinutes: number,
  executionWindow: PolicyVersionRules['executionWindow'],
): PolicyVersionRules {
  return {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: entityIds,
    maxChangePct,
    totalImpactBudget: impactBudget,
    maxDailyActionCount,
    cooldownMinutes,
    executionWindow,
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

type PolicyProductProjection = { asin: string; title?: string };
type PolicyAdObjectProjection = {
  kind: 'campaign' | 'ad_group' | 'target' | 'search_term';
  objectKey: string;
  entityId?: string;
  adsAccountId?: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  objectRevision?: number;
  resolved?: boolean;
  nonExecutable?: boolean;
  name: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
};

type PolicyScopeProjectionSurface = {
  listStoreProducts?: (
    context: StoreContextEnvelope,
    input: { includeArchived: boolean },
  ) => Promise<PolicyProductProjection[]>;
  listStoreAdObjects?: (
    context: StoreContextEnvelope,
    input: { kind: 'campaign' | 'ad_group' | 'target' },
  ) => Promise<PolicyAdObjectProjection[]>;
};

export function buildPolicyScopeOptions(
  storeLabel: string,
  products: readonly PolicyProductProjection[],
  adObjects: readonly PolicyAdObjectProjection[],
): PolicyScopeOption[] {
  const executableKeywords = adObjects.filter((item) => (
    item.kind === 'target' && item.resolved && !item.nonExecutable && Boolean(item.entityId)
  ));
  const canonicalKeywords = executableKeywords.filter((item) => (
    Boolean(item.adsAccountId)
    && Boolean(item.campaignId)
    && Boolean(item.adGroupId)
    && Boolean(item.keywordId)
    && Number.isInteger(item.objectRevision)
    && Number(item.objectRevision) >= 1
  ));
  const keywordIds = (rows: readonly PolicyAdObjectProjection[]) => Array.from(new Set(
    rows.map((item) => item.entityId).filter((id): id is string => Boolean(id)),
  ));
  const options: PolicyScopeOption[] = [{
    value: 'store',
    level: 'store',
    label: storeLabel || '当前店铺',
    allowedAdEntityIds: keywordIds(executableKeywords),
  }];
  products.forEach((product) => options.push({
    value: `product:${product.asin}`,
    level: 'product',
    label: `${product.title?.trim() || '未命名产品'} · ${product.asin}`,
    allowedAdEntityIds: keywordIds(executableKeywords.filter((item) => item.asin === product.asin)),
  }));
  const campaignOptions = new Map<string, PolicyAdObjectProjection[]>();
  const adGroupOptions = new Map<string, PolicyAdObjectProjection[]>();
  canonicalKeywords.forEach((item) => {
    const accountToken = encodeURIComponent(item.adsAccountId!);
    const campaignToken = encodeURIComponent(item.campaignId!);
    const groupToken = encodeURIComponent(item.adGroupId!);
    const campaignValue = `campaign:${accountToken}/${campaignToken}`;
    const adGroupValue = `ad_group:${accountToken}/${campaignToken}/${groupToken}`;
    campaignOptions.set(campaignValue, [...(campaignOptions.get(campaignValue) ?? []), item]);
    adGroupOptions.set(adGroupValue, [...(adGroupOptions.get(adGroupValue) ?? []), item]);
  });
  const campaignEntries = [...campaignOptions.entries()];
  const campaignLabels = disambiguateScopeLabels(campaignEntries.map(([, rows]) => (
    rows[0]?.campaignName?.trim() || '未命名广告活动'
  )));
  campaignEntries.forEach(([value, rows], index) => options.push({
    value,
    level: 'campaign',
    label: campaignLabels[index],
    allowedAdEntityIds: keywordIds(rows),
  }));
  const adGroupEntries = [...adGroupOptions.entries()];
  const adGroupLabels = disambiguateScopeLabels(adGroupEntries.map(([, rows]) => [
    rows[0]?.campaignName?.trim() || '未命名广告活动',
    rows[0]?.adGroupName?.trim() || '未命名广告组',
  ].join(' > ')));
  adGroupEntries.forEach(([value, rows], index) => options.push({
    value,
    level: 'ad_group',
    label: adGroupLabels[index],
    allowedAdEntityIds: keywordIds(rows),
  }));
  executableKeywords.forEach((item) => options.push({
    value: `keyword:${item.entityId}`,
    level: 'keyword',
    label: [item.campaignName, item.adGroupName, item.name].filter(Boolean).join(' > ') || '未命名关键词/投放',
    allowedAdEntityIds: [item.entityId!],
  }));
  return options;
}

function disambiguateScopeLabels(labels: readonly string[]): string[] {
  const normalized = labels.map((label) => label.trim().toLocaleLowerCase());
  const totals = new Map<string, number>();
  normalized.forEach((label) => totals.set(label, (totals.get(label) ?? 0) + 1));
  const positions = new Map<string, number>();
  return labels.map((label, index) => {
    const key = normalized[index];
    const total = totals.get(key) ?? 1;
    if (total === 1) return label;
    const position = (positions.get(key) ?? 0) + 1;
    positions.set(key, position);
    return `${label}（同名对象 ${position}/${total}）`;
  });
}

export async function loadPolicyScopeOptions(
  surface: PolicyScopeProjectionSurface | undefined,
  context: StoreContextEnvelope,
  storeLabel = '当前店铺',
): Promise<PolicyScopeOption[]> {
  if (!surface?.listStoreProducts || !surface.listStoreAdObjects) {
    throw new Error('当前店铺的产品或广告对象读取服务尚未就绪。');
  }
  const listAdObjects = (kind: 'campaign' | 'ad_group' | 'target') => (
    surface.listStoreAdObjects!(context, { kind })
  );
  const [products, campaigns, adGroups, targets] = await Promise.all([
    surface.listStoreProducts(context, { includeArchived: false }),
    listAdObjects('campaign'),
    listAdObjects('ad_group'),
    listAdObjects('target'),
  ]);
  return buildPolicyScopeOptions(storeLabel, products, [...campaigns, ...adGroups, ...targets]);
}

function formatPolicyScope(scope: string, options: readonly PolicyScopeOption[]): string {
  const match = options.find((option) => option.value === scope);
  if (match) return `${POLICY_SCOPE_LABELS[match.level]} · ${match.label}`;
  const [level] = scope.split(':');
  return POLICY_SCOPE_LABELS[level as PolicyScopeLevel] ?? '当前店铺范围';
}

export function buildPolicyVersionDraft(record: PolicyVersionRecord | null | undefined, defaultTimeZone: string): VersionDraft {
  return {
    version: String(record?.version ?? 1),
    allowedAdEntityIds: record?.rules.allowedAdEntityIds.join('\n') ?? '',
    maxChangePct: String(record?.rules.maxChangePct ?? 10),
    totalImpactBudget: String(record?.rules.totalImpactBudget ?? 50),
    maxDailyActionCount: String(record?.rules.maxDailyActionCount ?? 25),
    cooldownMinutes: String(record?.rules.cooldownMinutes ?? 30),
    executionTimeZone: record?.rules.executionWindow?.timeZone ?? defaultTimeZone,
    executionDaysOfWeek: [...(record?.rules.executionWindow?.daysOfWeek ?? DEFAULT_EXECUTION_DAYS)],
    executionWindowStart: record?.rules.executionWindow?.start ?? '08:00',
    executionWindowEnd: record?.rules.executionWindow?.end ?? '18:00',
    validFrom: record?.validFrom?.slice(0, 10) ?? '',
    validUntil: record?.validUntil?.slice(0, 10) ?? '',
  };
}

export function bindVersionDraftToScope(
  draft: VersionDraft,
  scopeOption: PolicyScopeOption | undefined,
): VersionDraft {
  return {
    ...draft,
    allowedAdEntityIds: scopeOption?.allowedAdEntityIds.join('\n') ?? '',
  };
}

function parseRequiredInteger(value: string, label: string, minimum: number, maximum: number): number {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`${label}必须是${minimum === 0 ? '非负' : '正'}整数。`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}必须是 ${minimum}–${maximum} 的整数。`);
  }
  return parsed;
}

function normalizeExecutionDays(days: readonly number[]): number[] {
  if (!Array.isArray(days) || days.length === 0) throw new Error('执行窗口至少选择一个执行日。');
  if (days.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) {
    throw new Error('执行窗口星期必须是 0–6 的整数。');
  }
  if (new Set(days).size !== days.length) throw new Error('执行窗口星期不能重复。');
  return DAY_OPTIONS.map((option) => option.value).filter((day) => days.includes(day));
}

function validateTimeZone(value: string): string {
  const timeZone = value.trim();
  if (!timeZone) throw new Error('执行时区必须填写有效的 IANA 时区。');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    throw new Error('执行时区必须填写有效的 IANA 时区。');
  }
  return timeZone;
}

function toggleExecutionDay(days: readonly number[], day: number): number[] {
  const next = new Set(days);
  if (next.has(day)) next.delete(day);
  else next.add(day);
  return DAY_OPTIONS.map((option) => option.value).filter((value) => next.has(value));
}

function formatExecutionDays(days: readonly number[]): string {
  const selected = DAY_OPTIONS.filter((option) => days.includes(option.value));
  if (selected.length === DAY_OPTIONS.length) return '每天';
  if (selected.length === 5 && selected.every((option, index) => option.value === DEFAULT_EXECUTION_DAYS[index])) return '周一至周五';
  return selected.map((option) => option.label).join('、') || '未选择日期';
}

export function formatExecutionWindowSummary(rules: PolicyVersionRules): string {
  const window = rules.executionWindow;
  const dailyLimit = Number.isSafeInteger(rules.maxDailyActionCount) ? `${rules.maxDailyActionCount} 次/日` : '每日上限未配置';
  const cooldown = Number.isSafeInteger(rules.cooldownMinutes) ? `冷却 ${rules.cooldownMinutes} 分钟` : '冷却未配置';
  if (!window) return `${dailyLimit} · ${cooldown} · 执行窗口未配置`;
  return `${dailyLimit} · ${cooldown} · ${formatExecutionDays(window.daysOfWeek)} ${window.start}–${window.end} · ${window.timeZone}`;
}

export function formatPolicyActionBoundary(rules: PolicyVersionRules): string {
  return `单次高于 0% 且不超过 ${rules.maxChangePct}% · 批次 0–${rules.totalImpactBudget} USD · ${formatExecutionWindowSummary(rules)}`;
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
  const maxDailyActionCount = parseRequiredInteger(draft.maxDailyActionCount, '每日动作上限', 1, 10_000);
  const cooldownMinutes = parseRequiredInteger(draft.cooldownMinutes, '同对象冷却时间', 0, 525_600);
  const timeZone = validateTimeZone(draft.executionTimeZone);
  const daysOfWeek = normalizeExecutionDays(draft.executionDaysOfWeek);
  const start = draft.executionWindowStart.trim();
  const end = draft.executionWindowEnd.trim();
  const entities = split(draft.allowedAdEntityIds);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('版本号必须是正整数。');
  if (!(maxChangePct > 0 && maxChangePct <= 10)) throw new Error('V1 关键词竞价单次变化必须在 0–10% 内。');
  if (!Number.isFinite(totalImpactBudget) || totalImpactBudget < 0) throw new Error('批次影响预算不能小于 0 USD。');
  if (!TIME_OF_DAY_PATTERN.test(start) || !TIME_OF_DAY_PATTERN.test(end)) throw new Error('执行窗口时间必须使用 HH:mm 24 小时格式。');
  if (start >= end) throw new Error('V1 执行窗口结束时间必须晚于开始时间，且不能跨午夜。');
  if (draft.validFrom && draft.validUntil && draft.validFrom >= draft.validUntil) throw new Error('策略有效期结束日期必须晚于开始日期。');
  return {
    id,
    policyId: policy.id,
    version,
    rules: defaultRules(entities, maxChangePct, totalImpactBudget, maxDailyActionCount, cooldownMinutes, {
      timeZone,
      daysOfWeek,
      start,
      end,
    }),
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
  return <div className="mission-control-dialog-backdrop"><section aria-modal="true" className="mission-control-dialog policy-domain-dialog" role="dialog" aria-labelledby="policy-dialog-title"><header><div><span>策略设置 · Amazon 美国站 / USD</span><h2 id="policy-dialog-title">{record ? '编辑策略基本信息' : '新建策略'}</h2><p>{scopeFrozen ? '已有版本，对象范围已冻结；如需改变范围，请新建策略。' : '已启用规则不会被这次修改覆盖。'}</p></div><button aria-label="关闭策略编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button></header><div className="policy-domain-form"><label><span>对象范围 *</span><select disabled={scopeFrozen} value={draft.scope} onChange={(event) => onChange({ ...draft, scope: event.target.value })}>{scopeOptions.map((option) => <option key={option.value} value={option.value}>{POLICY_SCOPE_LABELS[option.level]} · {option.label}</option>)}</select>{scopeFrozen && <small>已有版本，对象范围已冻结；需要其他范围时请新建策略。</small>}</label><label><span>策略名称 *</span><input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label><label><span>优先级 *</span><input min="1" max="100" type="number" value={draft.priority} onChange={(event) => onChange({ ...draft, priority: event.target.value })} /><small>数字越小越优先；同一对象命中多条策略时，系统按数字越小越先匹配。范围为 1–100。</small></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : '保存策略'}</button></footer></section></div>;
}

export function StrategyWizardDialog({ draft, scopeOptions, busy, onChange, onClose, onSave }: {
  draft: StrategyWizardDraft;
  scopeOptions: readonly PolicyScopeOption[];
  busy: boolean;
  onChange: (draft: StrategyWizardDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
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
  return <div className="mission-control-dialog-backdrop">
    <section aria-labelledby="strategy-wizard-title" aria-modal="true" className="mission-control-dialog policy-domain-dialog policy-domain-dialog--wizard" role="dialog">
      <header><div><span>Amazon 美国站 · USD</span><h2 id="strategy-wizard-title">新建策略</h2><p>按四步确定可执行边界；V1 只允许调整关键词竞价。</p></div><button aria-label="关闭新建策略" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button></header>
      <ol aria-label="新建策略步骤" className="policy-wizard-steps">
        {steps.map((label, index) => <li aria-current={draft.step === index + 1 ? 'step' : undefined} data-complete={draft.step > index + 1 || undefined} key={label}><button disabled={busy || index + 1 > draft.step} onClick={() => setStep((index + 1) as 1 | 2 | 3 | 4)} type="button"><span>{index + 1}</span>{label}</button></li>)}
      </ol>
      <div className="policy-wizard-body">
        {draft.step === 1 && <section aria-labelledby="policy-wizard-scope-title" className="policy-wizard-section"><h3 id="policy-wizard-scope-title">1. 对象范围</h3><p>范围始终锁定当前店铺；下列对象只来自当前店铺产品和已导入广告对象。</p><div className="policy-domain-form"><label><span>策略名称 *</span><input autoFocus value={draft.policy.name} onChange={(event) => onChange({ ...draft, policy: { ...draft.policy, name: event.target.value } })} /></label><label><span>范围级别 *</span><select value={draft.scopeLevel} onChange={(event) => { const level = event.target.value as PolicyScopeLevel; const first = scopeOptions.find((option) => option.level === level); onChange({ ...draft, scopeLevel: level, scopeValue: first?.value ?? '' }); }}>{Object.entries(POLICY_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>选择对象 *</span><select disabled={!optionsForLevel.length} value={selectedOption?.value ?? ''} onChange={(event) => onChange({ ...draft, scopeValue: event.target.value })}>{optionsForLevel.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{optionsForLevel.length ? `该范围包含 ${selectedOption?.allowedAdEntityIds.length ?? 0} 个可核验关键词/投放对象。` : '当前店铺没有该级别的可选对象，请先采集并导入广告报表。'}</small></label><label><span>优先级 *</span><input min="1" max="100" type="number" value={draft.policy.priority} onChange={(event) => onChange({ ...draft, policy: { ...draft.policy, priority: event.target.value } })} /><small>数字越小越优先；同一对象命中多条策略时，系统按数字越小越先匹配。范围为 1–100。</small></label></div></section>}
        {draft.step === 2 && <section aria-labelledby="policy-wizard-action-title" className="policy-wizard-section"><h3 id="policy-wizard-action-title">2. 允许动作</h3><p>V1 动作固定，不能扩展到预算、状态、Listing 或其他广告写入。</p><article className="policy-wizard-action-choice"><CheckCircle size={22} /><div><strong>调整关键词竞价</strong><small>仅对上一步范围内可核验的关键词/投放对象生效；对象不足时自动执行保持阻断。</small></div><span>唯一允许动作</span></article></section>}
        {draft.step === 3 && <section aria-labelledby="policy-wizard-limit-title" className="policy-wizard-section"><h3 id="policy-wizard-limit-title">3. 变更、预算、次数、冷却与时段限制</h3><div className="policy-domain-form policy-domain-form--version"><label><span>最大单次变化 *</span><div className="policy-domain-input-unit"><input max="10" min="0.1" step="0.1" type="number" value={draft.version.maxChangePct} onChange={(event) => onChange({ ...draft, version: { ...draft.version, maxChangePct: event.target.value } })} /><b>%</b></div></label><label><span>批次影响预算 *</span><div className="policy-domain-input-unit"><b>$</b><input min="0" step="1" type="number" value={draft.version.totalImpactBudget} onChange={(event) => onChange({ ...draft, version: { ...draft.version, totalImpactBudget: event.target.value } })} /></div></label><label><span>每日动作上限 *</span><div className="policy-domain-input-unit"><input min="1" step="1" type="number" value={draft.version.maxDailyActionCount} onChange={(event) => onChange({ ...draft, version: { ...draft.version, maxDailyActionCount: event.target.value } })} /><b>次</b></div></label><label><span>同对象冷却时间 *</span><div className="policy-domain-input-unit"><input min="0" step="1" type="number" value={draft.version.cooldownMinutes} onChange={(event) => onChange({ ...draft, version: { ...draft.version, cooldownMinutes: event.target.value } })} /><b>分钟</b></div></label><fieldset className="policy-domain-boundary"><legend>允许执行时段 *</legend><div className="policy-domain-window-grid"><label><span>时区</span><input value={draft.version.executionTimeZone} onChange={(event) => onChange({ ...draft, version: { ...draft.version, executionTimeZone: event.target.value } })} /></label><label><span>开始</span><input type="time" value={draft.version.executionWindowStart} onChange={(event) => onChange({ ...draft, version: { ...draft.version, executionWindowStart: event.target.value } })} /></label><label><span>结束</span><input type="time" value={draft.version.executionWindowEnd} onChange={(event) => onChange({ ...draft, version: { ...draft.version, executionWindowEnd: event.target.value } })} /></label></div><div className="policy-domain-day-field"><span>执行日（至少一天）</span><div aria-label="策略执行日" className="policy-domain-day-options" role="group">{DAY_OPTIONS.map((option) => <button aria-label={option.label} aria-pressed={draft.version.executionDaysOfWeek.includes(option.value)} key={option.value} onClick={() => onChange({ ...draft, version: { ...draft.version, executionDaysOfWeek: toggleExecutionDay(draft.version.executionDaysOfWeek, option.value) } })} type="button">{option.shortLabel}</button>)}</div></div></fieldset></div></section>}
        {draft.step === 4 && <section aria-labelledby="policy-wizard-evidence-title" className="policy-wizard-section"><h3 id="policy-wizard-evidence-title">4. 中文证据与停止条件</h3><div className="policy-wizard-review-grid"><article><h4>执行前后必须留存</h4><ul><li>修改前页面截图</li><li>修改后页面截图</li><li>刷新后页面截图</li><li>页面与对象身份核验</li><li>刷新后的数值回读</li></ul></article><article><h4>遇到以下情况立即停止</h4><ul><li>店铺、页面或对象身份变化</li><li>修改前数值与预期不一致</li><li>结果无法确认，转人工对账且不自动重试</li><li>数据过期、影响预算耗尽或紧急停止开启</li></ul></article></div><div className="policy-domain-form"><label><span>生效日期</span><input type="date" value={draft.version.validFrom} onChange={(event) => onChange({ ...draft, version: { ...draft.version, validFrom: event.target.value } })} /></label><label><span>失效日期</span><input type="date" value={draft.version.validUntil} onChange={(event) => onChange({ ...draft, version: { ...draft.version, validUntil: event.target.value } })} /></label></div><p className="policy-wizard-final-note">保存后先形成待检查规则；仍需“检查边界 → 启用策略”，不会直接开启自动执行。</p></section>}
      </div>
      <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={draft.step === 1 ? onClose : () => setStep((draft.step - 1) as 1 | 2 | 3)} type="button">{draft.step === 1 ? '取消' : '上一步'}</button>{draft.step < 4 ? <button className="workspace-button workspace-button--primary" disabled={busy || !canContinue} onClick={() => setStep((draft.step + 1) as 2 | 3 | 4)} type="button">下一步</button> : <button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '创建中…' : '创建策略与草稿版本'}</button>}</footer>
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
  return <div className="mission-control-dialog-backdrop">
    <section aria-labelledby="version-dialog-title" aria-modal="true" className="mission-control-dialog policy-domain-dialog policy-domain-dialog--version" role="dialog">
      <header>
        <div><span>策略规则检查</span><h2 id="version-dialog-title">{record ? '编辑待检查规则' : '创建草稿版本'}</h2><p>启用后规则不可编辑；后续变化必须新建版本。</p></div>
        <button aria-label="关闭版本编辑器" className="mission-control-dialog__close" disabled={busy} onClick={onClose} type="button"><X size={18} /></button>
      </header>
      <div className="policy-domain-form policy-domain-form--version">
        <label><span>版本号 *</span><input disabled={Boolean(record)} min="1" step="1" type="number" value={draft.version} onChange={(event) => onChange({ ...draft, version: event.target.value })} /></label>
        <label><span>最大单次变化 *</span><div className="policy-domain-input-unit"><input max="10" min="0.1" step="0.1" type="number" value={draft.maxChangePct} onChange={(event) => onChange({ ...draft, maxChangePct: event.target.value })} /><b>%</b></div></label>
        <label><span>批次影响预算 *</span><div className="policy-domain-input-unit"><b>$</b><input min="0" step="1" type="number" value={draft.totalImpactBudget} onChange={(event) => onChange({ ...draft, totalImpactBudget: event.target.value })} /></div></label>
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
              {DAY_OPTIONS.map((option) => <button aria-label={option.label} aria-pressed={draft.executionDaysOfWeek.includes(option.value)} key={option.value} onClick={() => onChange({ ...draft, executionDaysOfWeek: toggleExecutionDay(draft.executionDaysOfWeek, option.value) })} type="button">{option.shortLabel}</button>)}
            </div>
          </div>
          <small id="policy-execution-window-help">按所填时区解释本地时间；结束时间不包含在窗口内。V1 要求开始早于结束，不支持跨午夜。</small>
        </fieldset>
        <label><span>生效日期</span><input type="date" value={draft.validFrom} onChange={(event) => onChange({ ...draft, validFrom: event.target.value })} /></label>
        <label><span>失效日期</span><input type="date" value={draft.validUntil} onChange={(event) => onChange({ ...draft, validUntil: event.target.value })} /></label>
      </div>
      <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={onClose} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy} onClick={onSave} type="button">{busy ? '保存中…' : '保存草稿版本'}</button></footer>
    </section>
  </div>;
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
  const [strategyWizard, setStrategyWizard] = useState<StrategyWizardDraft | null>(null);
  const [versionEditor, setVersionEditor] = useState<VersionEditorState | null>(null);
  const [scopeOptions, setScopeOptions] = useState<PolicyScopeOption[]>([]);
  const [scopeOptionsPhase, setScopeOptionsPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [scopeOptionsError, setScopeOptionsError] = useState('');
  const [scopeReloadToken, setScopeReloadToken] = useState(0);
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
    setPending(null); setSelectedId(''); setVersions([]); setPolicyEditor(null); setStrategyWizard(null); setVersionEditor(null); setClearKillSwitchOpen(false); setClearKillSwitchReason(''); setPage(1);
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
    setScopeOptions([]);
    setScopeOptionsPhase('loading');
    setScopeOptionsError('');
    const surface = (window as any).electronAPI as PolicyScopeProjectionSurface | undefined;
    void loadPolicyScopeOptions(surface, storeContext).then((options) => {
      if (authorityRef.current !== capturedKey) return;
      setScopeOptions(options);
      setScopeOptionsPhase('ready');
    }).catch((scopeLoadError) => {
      if (authorityRef.current !== capturedKey) return;
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
    const capturedId = selected.id;
    const capturedSequence = ++detailSequence.current;
    void api.listPolicyVersions(storeContext, selected.id).then((rows) => {
      if (!responseMatchesPolicyDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) return;
      rows.forEach((row) => assertPolicyBelongsToContext(row, storeContext));
      const selectedRows = policyVersionDetailForSelection(capturedId, rows, null).versions;
      if (selectedRows.length !== rows.length) throw new Error('当前策略版本归属校验失败。');
      setVersions(selectedRows);
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
    const scopeSafeDraft = policyEditor.record && selectedVersions.length > 0
      ? { ...policyEditor.draft, scope: policyEditor.record.scope }
      : policyEditor.draft;
    try { input = buildCreatePolicyInput(scopeSafeDraft, policyEditor.record?.id ?? `POLICY-${String(storeContext.storeId)}-${Date.now()}`); }
    catch (validationError) { setError(message(validationError)); return; }
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
    } catch (validationError) {
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
    if (version.policyId !== selected.id) {
      setVersions(selectedVersions);
      setVersionEditor(null);
      setError('版本与当前策略归属不一致，已阻断启用。下一步：请重新读取当前策略版本。');
      return;
    }
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
        <div><span>店铺运行模式</span><div className="policy-domain-segmented"><button aria-pressed={runtime?.mode === 'manual_approval'} disabled={!can('policy.runtime.mode.set') || busy || !runtime} onClick={() => void setMode('manual_approval')} type="button">人工审批</button><button aria-pressed={runtime?.mode === 'policy_auto'} disabled={!can('policy.runtime.mode.set') || busy || !runtime || !runtime.canAutoExecute} onClick={() => void setMode('policy_auto')} type="button">策略内自动</button></div><details className="policy-domain-auto-conditions"><summary>查看启用条件</summary><ul><li>已有启用策略版本</li><li>对象身份已核验且 Ads 身份已确认</li><li>变化、预算、次数、冷却和时段均在边界内</li><li>紧急停止关闭且执行安全门正常</li></ul></details></div>
        <div><span>当前规则状态</span><strong>{runtime?.activePolicyVersionId ? '已绑定启用规则' : '尚无启用规则'}</strong><small>{runtime?.canAutoExecute ? '满足策略规则前置条件' : '保持人工审批或阻断'}</small><details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>activePolicyVersionId={runtime?.activePolicyVersionId ?? 'none'}</code><code>circuitBreakerState={runtime?.circuitBreakerState ?? 'none'}</code><p>不能写熔断器或 activeVersion。</p></details></div>
        {runtime?.killSwitch
          ? <button className="workspace-button workspace-button--primary policy-domain-kill-switch" disabled={!can('policy.kill-switch.clear') || busy} onClick={() => setClearKillSwitchOpen(true)} type="button"><Power size={16} />解除紧急停止</button>
          : <button className="workspace-button workspace-button--secondary policy-domain-kill-switch" disabled={!can('policy.kill-switch.enable') || busy || !runtime} onClick={() => void enableKillSwitch()} type="button"><StopCircle size={16} />开启紧急停止</button>}
      </section>
      <div className="policy-domain-layout">
        <WorkbenchPanel className="policy-domain-list-panel" title="策略边界" description="数字越小越优先；只读取当前店铺策略。" footer={`第 ${safePage}/${pageCount} 页 · ${filtered.length} 条`} toolbar={<button className="workspace-button workspace-button--primary" disabled={!can('policy.policy.create') || busy || !scopeOptionsReady} onClick={openStrategyWizard} type="button"><Plus size={15} />新建</button>}>
          <div className="policy-domain-list-tools"><input aria-label="搜索策略" placeholder="搜索名称或范围" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><label><input checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} type="checkbox" />查看已归档</label></div>
          {phase === 'loading' && <WorkspaceState kind="loading" title="读取策略" description="正在读取当前店铺策略、版本和运行模式。" />}
          {(phase === 'blocked' || phase === 'error') && <WorkspaceState kind="blocked" title="策略已失败关闭" description="生产模式不会使用界面临时数据。" details={visibleBlockedReason} />}
          {phase === 'ready' && !pageRows.length && <WorkspaceState kind="empty" title="当前店铺没有策略" description="点击“新建”按四步创建首个待检查策略。" />}
          <ul className="policy-domain-list">{pageRows.map((policy) => <li key={policy.id}><button aria-pressed={policy.id === selected?.id} data-selected={policy.id === selected?.id || undefined} onClick={() => selectPolicy(policy.id)} type="button"><span><b>优先级 {policy.priority}</b><em data-status={policy.status}>{POLICY_STATUS_LABELS[policy.status]}</em></span><strong>{policy.name}</strong><small>{formatPolicyScope(policy.scope, scopeOptions)}</small></button></li>)}</ul>
          <nav className="policy-domain-pagination" aria-label="策略分页"><button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button><span>{safePage}/{pageCount}</span><button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button></nav>
        </WorkbenchPanel>
        <div className="policy-domain-detail">{selected ? <>
          <section className="policy-domain-detail-head"><div><span>当前策略</span><h2>{selected.name}</h2><p>{formatPolicyScope(selected.scope, scopeOptions)} · 优先级 {selected.priority}（数字越小越优先）</p></div><em data-status={selected.status}>{POLICY_STATUS_LABELS[selected.status]}</em><div className="policy-domain-actions"><button className="workspace-button workspace-button--primary" disabled={!can('policy.policy.update') || busy || selected.status === 'archived' || !scopeOptionsReady} onClick={() => setPolicyEditor({ record: selected, draft: policyDraft(selected) })} type="button"><PencilSimple size={15} />编辑</button>{selected.status === 'active' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.version.disable') || busy} onClick={() => void lifecycle('disable')} type="button"><Power size={15} />停用</button>}{selected.status !== 'active' && selected.status !== 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.policy.archive') || busy} onClick={() => void lifecycle('archive')} type="button"><Archive size={15} />归档</button>}{selected.status === 'archived' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.policy.restore') || busy} onClick={() => void lifecycle('restore')} type="button"><ArrowClockwise size={15} />恢复</button>}<details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>policyId={selected.id}</code><code>revision={selected.revision}</code><code>status={selected.status}</code></details></div></section>
          {!enabledVersion && <section aria-label="策略启用路径" className="policy-domain-enable-path"><h3>从待检查到启用</h3><p>当前没有启用版本，按顺序完成以下三步。</p><ol><li data-complete={Boolean(draftVersion) || undefined}><span>1</span><div><strong>创建草稿版本</strong><small>填写允许对象与安全边界。</small></div><button className="workspace-button workspace-button--secondary" disabled={!can('policy.version.create') || busy || Boolean(draftVersion) || !selectedScopeOption} onClick={() => setVersionEditor({ policyId: selected.id, record: null, draft: createVersionDraft() })} type="button">{draftVersion ? '已创建' : '创建'}</button></li><li data-complete={Boolean(draftVersion) || undefined}><span>2</span><div><strong>检查边界</strong><small>核对对象、上下限、时段、证据与停止条件。</small></div><button className="workspace-button workspace-button--secondary" disabled={!draftVersion || busy || !selectedScopeOption} onClick={() => draftVersion && setVersionEditor({ policyId: selected.id, record: draftVersion, draft: editVersionDraft(draftVersion) })} type="button">检查</button></li><li><span>3</span><div><strong>启用策略</strong><small>启用后规则冻结；不会自动切换运行模式。</small></div><button className="workspace-button workspace-button--primary" disabled={!draftVersion || !can('policy.version.enable') || busy || !selectedScopeOption} onClick={() => draftVersion && void enableVersion(draftVersion)} type="button">启用</button></li></ol></section>}
          <section className="policy-domain-versions"><header><div><h3>不可变版本</h3><p>只有待检查规则可修改；启用后形成审计快照。</p></div><button className="workspace-button workspace-button--primary" disabled={!can('policy.version.create') || busy || selected.status === 'archived' || !selectedScopeOption} onClick={() => setVersionEditor({ policyId: selected.id, record: null, draft: createVersionDraft() })} type="button"><Plus size={15} />创建草稿版本</button></header><div className="policy-domain-version-list" role="list">{selectedVersions.map((version) => <article data-status={version.status} key={version.id} role="listitem"><div><span>{version.status === 'enabled' ? <LockKey size={18} /> : <ShieldCheck size={18} />}</span><div><strong>版本 {version.version} · {VERSION_STATUS_LABELS[version.status]}</strong><small>{version.rules.allowedAdEntityIds.length ? `${version.rules.allowedAdEntityIds.length} 个对象` : '0 个对象 · 自动执行保持阻断'} · 单次 ≤ {version.rules.maxChangePct}% · 批次预算 ${version.rules.totalImpactBudget} USD</small><small className="policy-domain-version-boundary">{formatExecutionWindowSummary(version.rules)}</small></div></div><div>{version.status === 'draft' && <button className="workspace-button workspace-button--secondary" disabled={!can('policy.version.update') || busy || !selectedScopeOption} onClick={() => setVersionEditor({ policyId: selected.id, record: version, draft: editVersionDraft(version) })} type="button"><PencilSimple size={14} />检查并编辑</button>}{version.status === 'draft' && <button className="workspace-button workspace-button--primary" disabled={!can('policy.version.enable') || busy || !selectedScopeOption} onClick={() => void enableVersion(version)} type="button"><CheckCircle size={14} />启用策略</button>}{version.status !== 'draft' && <span className="policy-domain-immutable"><LockKey size={14} />内容不可变</span>}<details className="policy-domain-diagnostics"><summary>诊断详情</summary><code>versionId={version.id}</code><code>revision={version.revision}</code><code>status={version.status}</code></details></div></article>)}</div></section>
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
    {clearKillSwitchOpen && <div className="mission-control-dialog-backdrop"><section aria-labelledby="clear-kill-switch-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>解除紧急停止</span><h2 id="clear-kill-switch-title">确认解除店铺级紧急停止</h2><p>解除急停不会自动恢复策略内自动。请记录复核原因后继续。</p></div></header><div className="policy-domain-clear-reason"><label><span>解除原因 *</span><textarea autoFocus onChange={(event) => setClearKillSwitchReason(event.target.value)} rows={4} value={clearKillSwitchReason} /></label></div><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => { setClearKillSwitchOpen(false); setClearKillSwitchReason(''); }} type="button">取消</button><button className="workspace-button workspace-button--primary" disabled={busy || !clearKillSwitchReason.trim() || !can('policy.kill-switch.clear')} onClick={() => void clearKillSwitch()} type="button">{pending === 'kill-switch-clear' ? '解除中…' : '确认解除'}</button></footer></section></div>}
  </div>;
}
