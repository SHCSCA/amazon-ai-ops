import { sanitizeCausalExportText } from '@amazon-ai-ops/shared-types';
import { toUserFacingError } from '../../user-facing-error';
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

export function message(error: unknown): string {
  return toUserFacingError(error, '策略操作未完成，请刷新后重试。');
}

export function operatorFacingBlocker(reason: string | null | undefined, subject: string): string {
  const value = reason ? sanitizeCausalExportText(reason).trim() : '';
  if (value && SAFE_OPERATOR_POLICY_REASONS.some((pattern) => pattern.test(value))) return value;
  return `${subject}当前不可用。原因：无法确认当前店铺的策略权限或服务状态。下一步：请确认当前店铺连接与本机服务后重试。`;
}

export function split(value: string): string[] {
  return value.split(/[\n,，；;]/).map((item) => item.trim()).filter(Boolean);
}

export function capabilityReady(
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

export function disambiguateScopeLabels(labels: readonly string[]): string[] {
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

export function formatPolicyScope(scope: string, options: readonly PolicyScopeOption[]): string {
  const match = options.find((option) => option.value === scope);
  if (match) return `${POLICY_SCOPE_LABELS[match.level]} · ${match.label}`;
  const [level] = scope.split(':');
  return POLICY_SCOPE_LABELS[level as PolicyScopeLevel] ?? '当前店铺范围';
}
