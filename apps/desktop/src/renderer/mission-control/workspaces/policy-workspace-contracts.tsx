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


export const OPERATOR = 'desktop-operator';

export const PAGE_SIZE = 6;

export const TIME_OF_DAY_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const DAY_OPTIONS = [
  { value: 1, shortLabel: '一', label: '周一' },
  { value: 2, shortLabel: '二', label: '周二' },
  { value: 3, shortLabel: '三', label: '周三' },
  { value: 4, shortLabel: '四', label: '周四' },
  { value: 5, shortLabel: '五', label: '周五' },
  { value: 6, shortLabel: '六', label: '周六' },
  { value: 0, shortLabel: '日', label: '周日' },
] as const;

export const DEFAULT_EXECUTION_DAYS = [1, 2, 3, 4, 5];

export type PolicyDraft = { name: string; scope: string; priority: string };

export type PolicyScopeLevel = 'store' | 'product' | 'campaign' | 'ad_group' | 'keyword';

export type PolicyScopeOption = {
  value: string;
  level: PolicyScopeLevel;
  label: string;
  allowedAdEntityIds: string[];
};

export type VersionDraft = {
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

export type VersionEditorState = {
  policyId: string;
  record: PolicyVersionRecord | null;
  draft: VersionDraft;
};

export type StrategyWizardDraft = {
  step: 1 | 2 | 3 | 4;
  policy: PolicyDraft;
  scopeLevel: PolicyScopeLevel;
  scopeValue: string;
  version: VersionDraft;
};

export const POLICY_SCOPE_LABELS: Record<PolicyScopeLevel, string> = {
  store: '整个店铺',
  product: '所选产品',
  campaign: '广告活动',
  ad_group: '广告组',
  keyword: '关键词',
};

export const POLICY_STATUS_LABELS: Record<PolicyRecord['status'], string> = {
  draft: '待配置',
  active: '已启用',
  disabled: '已停用',
  archived: '已归档',
};

export const VERSION_STATUS_LABELS: Record<PolicyVersionRecord['status'], string> = {
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
  onRefreshAuthority?: () => Promise<void | boolean> | void | boolean;
};

export const SAFE_OPERATOR_POLICY_REASONS = [
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

export type PolicyProductProjection = { asin: string; title?: string };

export type PolicyAdObjectProjection = {
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

export type PolicyScopeProjectionSurface = {
  listStoreProducts?: (
    context: StoreContextEnvelope,
    input: { includeArchived: boolean },
  ) => Promise<PolicyProductProjection[]>;
  listStoreAdObjects?: (
    context: StoreContextEnvelope,
    input: { kind: 'campaign' | 'ad_group' | 'target' },
  ) => Promise<PolicyAdObjectProjection[]>;
};
