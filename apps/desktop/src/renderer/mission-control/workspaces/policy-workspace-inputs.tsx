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

export function defaultRules(
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

export function policyDraft(record?: PolicyRecord | null): PolicyDraft {
  return { name: record?.name ?? '', scope: record?.scope ?? 'store', priority: String(record?.priority ?? 20) };
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

export function parseRequiredInteger(value: string, label: string, minimum: number, maximum: number): number {
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

export function normalizeExecutionDays(days: readonly number[]): number[] {
  if (!Array.isArray(days) || days.length === 0) throw new Error('执行窗口至少选择一个执行日。');
  if (days.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) {
    throw new Error('执行窗口星期必须是 0–6 的整数。');
  }
  if (new Set(days).size !== days.length) throw new Error('执行窗口星期不能重复。');
  return DAY_OPTIONS.map((option) => option.value).filter((day) => days.includes(day));
}

export function validateTimeZone(value: string): string {
  const timeZone = value.trim();
  if (!timeZone) throw new Error('执行时区必须填写有效的 IANA 时区。');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    throw new Error('执行时区必须填写有效的 IANA 时区。');
  }
  return timeZone;
}

export function toggleExecutionDay(days: readonly number[], day: number): number[] {
  const next = new Set(days);
  if (next.has(day)) next.delete(day);
  else next.add(day);
  return DAY_OPTIONS.map((option) => option.value).filter((value) => next.has(value));
}

export function formatExecutionDays(days: readonly number[]): string {
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
