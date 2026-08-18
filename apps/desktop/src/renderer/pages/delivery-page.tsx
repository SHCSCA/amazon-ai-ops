import React, { useEffect, useMemo, useState } from 'react';
import type { OperatorTaskAction } from '../components/operator-task-panel';
import { ProgressiveDetails } from '../components/progressive-details';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { buildDeliveryReadinessMatrix, buildDeliveryReadinessMatrixInput } from '../delivery-readiness-matrix';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import { READBACK_REPAIR_INTENT_EVENT, READBACK_REPAIR_INTENT_STORAGE_KEY, type ReadbackRepairIntent } from '../readback-repair-intent';
import { useScopeStore } from '../scope-store';
import type { AiDiagnosisRunView, AppRoute, BusinessDataPipeline, BusinessEvidenceArtifact, DeliveryEvidenceStatusView, DeliveryReadinessGate, DeliveryReadinessView, OperationScope, RecommendationView, RendererArtifactId } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { notifyWorkflowInvalidated } from '../workflow-invalidation';
import type { WorkflowEventTarget } from '../workflow-invalidation';

const DEFAULT_SCOPE: OperationScope = {
  dateFrom: '2026-06-01',
  dateTo: '2026-06-12',
  storeName: 'FT-US-US',
  marketplaceCode: 'US',
  currency: 'USD' as const,
};

const DELIVERY_BUNDLE_PATH = 'output/delivery-bundles';

export function deliveryReadbackVerifierPassed(value: unknown): boolean {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return result.ready === true && result.status === 'PASS';
}

export async function runDeliveryWorkflowMutation<T>(
  action: 'refresh' | 'create-readback' | 'verify-readback',
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
): Promise<T> {
  const source = action === 'refresh'
    ? 'delivery-refreshed'
    : action === 'create-readback'
      ? 'readback-created'
      : 'readback-verified';
  const result = await task();
  if (action !== 'verify-readback' || deliveryReadbackVerifierPassed(result)) {
    notifyWorkflowInvalidated(source, target);
  }
  return result;
}

type DeliveryTone = 'ready' | 'pending' | 'blocked' | 'warning';

export interface DeliveryPreviewState {
  detail: string;
  headline: '仅开发预览已走通' | '仅开发预览场景未走通';
  scenarioId: string;
  tone: 'warning';
}

interface DeliveryItem {
  title: string;
  tone: DeliveryTone;
  summary: string;
  actions: string[];
  evidence?: string[];
}

interface DataReconciliationExportResult {
  jsonPath?: string;
  markdownPath?: string;
  canonicalSource?: string;
  canonical?: {
    rows?: number;
    spend?: number;
    orders?: number;
    sales?: number;
    clicks?: number;
    impressions?: number;
    currency?: string;
  };
  blockers?: string[];
}

function api(): Record<string, any> {
  return ((window as any).electronAPI || {}) as Record<string, any>;
}

interface FinalReadinessRefreshResult {
  success?: boolean;
  evidenceManifestPath?: string;
  finalReadinessPath?: string;
  readiness?: DeliveryReadinessView;
}

interface ReadbackSessionResult {
  sessionDir?: string;
  sourceCandidatePath?: string;
  passEvidencePath?: string;
  checklistPath?: string;
  locatorGuidePath?: string;
  sessionInputPath?: string;
  sessionInputGuidePath?: string;
}

interface ReadbackSessionCheckResult {
  sessionDir?: string;
  ready?: boolean;
  captureReady?: boolean;
  checks?: Array<{ label?: string; passed?: boolean; details?: string }>;
  issues?: string[];
  unresolvedFields?: string[];
  captureMissingFields?: Array<{ field?: string; label?: string; group?: string }>;
  captureIssues?: string[];
}

interface ReadbackSessionFillResult {
  sessionDir?: string;
  jsonPath?: string;
  markdownPath?: string;
  status?: string;
  readyForVerifier?: boolean;
  issues?: string[];
}

interface ReadbackEvidenceVerifyResult {
  status?: string;
  ok?: boolean;
  verified?: boolean;
  ready?: boolean;
  issues?: string[];
  blockers?: string[];
  checks?: Array<{ label?: string; passed?: boolean; details?: string }>;
}

export type DeliveryActionKey =
  | 'create-readback'
  | 'export-bundle'
  | 'export-reconciliation'
  | 'fill-readback-session'
  | 'refresh-final'
  | 'refresh-final-with-readback'
  | 'verify-readback-evidence'
  | 'verify-readback-session';

interface DeliveryActionButtonInput {
  action: DeliveryActionKey;
  activeAction: DeliveryActionKey | null;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  idleLabel: string;
}

export interface DeliveryActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function deliveryActionButtonView(input: DeliveryActionButtonInput): DeliveryActionButtonView {
  const isActive = input.activeAction === input.action;
  return {
    ariaBusy: isActive ? true : undefined,
    className: [input.baseClassName, isActive ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activeAction),
    label: isActive ? input.busyLabel : input.idleLabel,
    showSpinner: isActive,
  };
}

interface DeliveryOpenPathButtonInput {
  activePathKey: string | null;
  baseClassName?: string;
  busyLabel?: string;
  disabled?: boolean;
  idleLabel: string;
  pathKey: string;
}

export function deliveryOpenPathButtonView(input: DeliveryOpenPathButtonInput): DeliveryActionButtonView {
  const isActive = input.activePathKey === input.pathKey;
  return {
    ariaBusy: isActive ? true : undefined,
    className: [input.baseClassName || 'secondary-button', isActive ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activePathKey),
    label: isActive ? (input.busyLabel || '打开中...') : input.idleLabel,
    showSpinner: isActive,
  };
}

interface DeliveryCopySummaryActionInput {
  copying: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function deliveryCopySummaryActionView(input: DeliveryCopySummaryActionInput): OperatorTaskAction {
  return {
    label: '复制摘要',
    onClick: input.onClick,
    busy: input.copying,
    busyLabel: '复制中...',
    disabled: Boolean(input.copying || input.disabled),
  };
}

function deliveryActionBusyLabel(action: DeliveryActionKey): string {
  const labels: Record<DeliveryActionKey, string> = {
    'create-readback': '创建中...',
    'export-bundle': '导出中...',
    'export-reconciliation': '导出中...',
    'fill-readback-session': '生成中...',
    'refresh-final': '刷新中...',
    'refresh-final-with-readback': '刷新中...',
    'verify-readback-evidence': '校验中...',
    'verify-readback-session': '检查中...',
  };
  return labels[action];
}

function deliveryPathActionKey(label: string, targetPath: string): string {
  return `${label}:${String(targetPath || 'missing')}`;
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readbackSessionStatusCopy(result: ReadbackSessionCheckResult | null): { className: string; title: string; detail: string } {
  if (!result) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包尚未检查',
      detail: '请先创建并检查回读工作包。',
    };
  }
  if (!result.ready) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包结构仍需补齐',
      detail: (result.issues || []).slice(0, 3).join('；') || '目录、清单、定位单或输出路径缺失。',
    };
  }
  if (!result.captureReady) {
    const missing = formatCaptureMissing(result.captureMissingFields, result.unresolvedFields);
    return {
      className: 'readback-session-check-blocked',
      title: '结构通过，现场证据待填写',
      detail: missing ? `还需填写：${missing}` : deliveryTextForDisplay((result.captureIssues || []).slice(0, 2).join('；') || 'session-input.json 尚未完成现场证据填写。'),
    };
  }
  return {
    className: 'readback-session-check-ready',
    title: '结构与现场证据均已通过',
    detail: '填写文件已补齐，可生成回读证据并进入本地校验。',
  };
}

function deliveryCaptureFieldLabelForDisplay(value: unknown): string {
  return deliveryTextForDisplay(String(value || ''))
    .replace(/执行前\s*Ads UI live bid/gi, '现场出价')
    .replace(/执行后\s*Ads UI live bid/gi, '现场出价')
    .replace(/Ads UI live bid/gi, '现场出价');
}

function formatCaptureMissing(
  missingFields?: Array<{ field?: string; label?: string; group?: string }>,
  fallbackFields?: string[],
): string {
  if (Array.isArray(missingFields) && missingFields.length > 0) {
    return missingFields
      .slice(0, 8)
      .map((item) => [item.group, deliveryCaptureFieldLabelForDisplay(item.label || item.field)].filter(Boolean).join('/'))
      .filter(Boolean)
      .join('、');
  }
  return (fallbackFields || []).slice(0, 8).map(deliveryCaptureFieldLabelForDisplay).join('、');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

function aiAvailableFromSettings(settings: Record<string, unknown> | null | undefined): boolean {
  if (!settings) return false;
  const keyConfigured = readBoolean(settings.aiKeyConfigured ?? settings.ai_key_configured)
    || Boolean(readString(settings.aiApiKey ?? settings.ai_api_key));
  if (!keyConfigured) return false;
  const baseUrl = readString(settings.aiBaseUrl ?? settings.ai_base_url) || 'https://api.deepseek.com';
  const model = readString(settings.aiModel ?? settings.ai_model) || 'deepseek-v4-flash';
  return normalizeBaseUrl(settings.aiLastTestBaseUrl ?? settings.ai_last_test_base_url) === normalizeBaseUrl(baseUrl)
    && readString(settings.aiLastTestModel ?? settings.ai_last_test_model) === model
    && readString(settings.aiLastTestStatus ?? settings.ai_last_test_status) === 'available';
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function summarizeScope(data: BusinessDataPipeline | null, fallbackScope: OperationScope): string {
  const scope = data?.scope || fallbackScope;
  return `${scope.storeName} / ${scope.marketplaceCode} / ${scope.dateFrom} - ${scope.dateTo} / USD`;
}

function statusLabel(tone: DeliveryTone): string {
  const labels: Record<DeliveryTone, string> = {
    ready: '已完成',
    pending: '待处理',
    blocked: '需补齐',
    warning: '需复核',
  };
  return labels[tone];
}

function readinessStatus(readiness: DeliveryReadinessView | null): string {
  return readiness?.appReady && readiness?.manifestDriven ? '可交付' : '未就绪';
}

export function deliveryPreviewState(
  readiness: DeliveryReadinessView | null,
  evidenceStatus: DeliveryEvidenceStatusView | null | undefined,
): DeliveryPreviewState | null {
  const preview = evidenceStatus?.preview;
  if (!readiness?.previewOnly && !preview?.previewOnly) return null;
  const workflowComplete = Boolean(readiness?.previewReady && preview?.workflowComplete);
  return {
    detail: '此状态只验证开发 fixture 的页面流程，不可视为 APP_READY，也不能满足真实导出或验收 gate。',
    headline: workflowComplete ? '仅开发预览已走通' : '仅开发预览场景未走通',
    scenarioId: preview?.scenarioId || readiness?.previewScenarioId || 'unknown',
    tone: 'warning',
  };
}

export function DeliveryPreviewNotice({ state }: { state: DeliveryPreviewState | null }) {
  if (!state) return null;
  return (
    <div className="delivery-summary-data-line delivery-preview-notice" role="status" aria-live="polite">
      <StatusPill tone={state.tone}>仅开发预览</StatusPill>
      <strong>{state.headline}</strong>
      <small>{state.detail} 当前场景：{state.scenarioId}</small>
    </div>
  );
}

export function deliverySummaryStatusLabel(input: {
  deliveryReady: boolean;
  previewOnly: boolean;
}): string {
  if (input.deliveryReady) return '可以交付';
  return input.previewOnly ? '开发预览' : '当前阻断';
}

type DeliveryCollectionArtifact = Pick<BusinessEvidenceArtifact, 'artifactId' | 'displayName' | 'kind' | 'label'>;

function collectionFolderArtifact(data: BusinessDataPipeline | null): DeliveryCollectionArtifact | null {
  const artifactId = data?.collection?.fileAudit?.downloadArtifactId
    || data?.collection?.latestBatch?.downloadArtifactId;
  if (artifactId) {
    const displayName = data?.collection?.fileAudit?.downloadDisplayName
      || data?.collection?.latestBatch?.downloadDisplayName
      || '原始报表目录';
    return { artifactId, displayName, kind: 'folder', label: '原始报表目录' };
  }
  return (data?.collection?.evidenceArtifacts || []).find((item) => item.kind === 'folder') || null;
}

function collectionManifestArtifact(data: BusinessDataPipeline | null): DeliveryCollectionArtifact | null {
  const artifactId = data?.collection?.fileAudit?.manifestArtifactId
    || data?.collection?.latestBatch?.manifestArtifactId;
  if (artifactId) {
    const displayName = data?.collection?.fileAudit?.manifestDisplayName
      || data?.collection?.latestBatch?.manifestDisplayName
      || '采集清单';
    return { artifactId, displayName, kind: 'audit', label: '采集清单' };
  }
  return (data?.collection?.evidenceArtifacts || []).find((item) => item.kind === 'audit') || null;
}

export function deliveryTextForDisplay(text: string): string {
  return text
    .replace(/appReady=false，不能声明可交付。/gi, '最终验收未通过，不能声明可交付。')
    .replace(/manifestDriven=false，不能声明可交付。/gi, '最终验收汇总不是本次验收来源，不能声明可交付。')
    .replace(/Current candidate is missing before\/after\/reload readback proof\./gi, '当前候选动作缺少执行前、执行后和刷新回读证明。')
    .replace(/最终就绪\s+manifest/gi, '最终验收汇总')
    .replace(/READY\s+交付包/g, '可交付包')
    .replace(/before\s*\/\s*after\s*\/\s*readback/gi, '执行前/执行后/回读')
    .replace(/before\s*\/\s*after\s+readback/gi, '执行前/执行后回读')
    .replace(/before\s*\/\s*after/gi, '执行前/执行后')
    .replace(/\bsession-input\.json\b/gi, '填写文件')
    .replace(/\bfinal readiness gate\b/gi, '最终验收项')
    .replace(/\bfinal readiness\b/gi, '最终验收')
    .replace(/\bverifier\b/gi, '本地校验')
    .replace(/\bmanifest\b/gi, '最终验收汇总')
    .replace(/\bhash\b/gi, '校验码')
    .replace(/\breadback\b/gi, '回读')
    .replace(/APP_READY/g, '可交付状态')
    .replace(/APP_NEEDS_WORK/g, '未就绪状态')
    .replace(/\bREADY\b/g, '可交付');
}

function deliveryTextsForDisplay(items: string[] | undefined): string[] {
  return (items || []).map((item) => deliveryTextForDisplay(item));
}

function uniqueDisplayTexts(items: Array<string | undefined>): string[] {
  return Array.from(new Set(items.map((item) => deliveryTextForDisplay(String(item || '').trim())).filter(Boolean)));
}

export function packageEvidenceSummary(packageEvidence: DeliveryEvidenceStatusView['package'] | null | undefined): string {
  if (!packageEvidence?.installerAvailable) return '安装包未记录';
  const packageLocation = packageEvidence.portablePath || packageEvidence.installerPath || '安装包路径不可用';
  const hash = packageEvidence.sha256 ? ` / SHA-256 ${packageEvidence.sha256.slice(0, 12)}...` : ' / SHA-256 未记录';
  return `${packageLocation}${hash}`;
}

export function canExportDeliveryBundle(
  readiness: DeliveryReadinessView | null,
  packageEvidence: DeliveryEvidenceStatusView['package'] | null | undefined,
): boolean {
  const portablePath = String(packageEvidence?.portablePath || '').trim();
  const portableSha256 = String(packageEvidence?.sha256 || '').trim();
  return Boolean(
    readiness?.available
    && readiness.exists === true
    && readiness.status === 'APP_READY'
    && readiness.appReady
    && readiness.manifestDriven
    && readiness.previewOnly !== true
    && Array.isArray(readiness.gates)
    && readiness.gates.length > 0
    && readiness.gates.every((gate) => gate.ok === true)
    && Array.isArray(readiness.failures)
    && readiness.failures.length === 0
    && packageEvidence?.installerAvailable === true
    && portablePath
    && /^[A-F0-9]{64}$/i.test(portableSha256)
  );
}

function compactDeliveryPath(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return '';
  if (normalized.length <= 78) return normalized;
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || normalized;
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  const root = /^[A-Za-z]:$/.test(parts[0] || '') ? parts[0] : parts[0] ? `/${parts[0]}` : '';
  return [root, '...', parent, fileName].filter(Boolean).join('/');
}

function directoryFromPath(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function packageEvidenceBrief(packageEvidence: DeliveryEvidenceStatusView['package'] | null | undefined): string {
  if (!packageEvidence?.installerAvailable) return '安装包未记录';
  const packageLocation = packageEvidence.portablePath || packageEvidence.installerPath || '';
  const pathLabel = packageLocation ? compactDeliveryPath(packageLocation) : '安装包路径不可用';
  const hash = packageEvidence.sha256 ? ` / SHA-256 ${packageEvidence.sha256.slice(0, 12)}...` : ' / SHA-256 未记录';
  return `${pathLabel}${hash}`;
}

function stripPrimaryTechnicalDetails(text: string): string {
  return deliveryTextForDisplay(text)
    .replace(/[A-Za-z]:[\\/][^；。\n]+/g, '证据路径见详情')
    .replace(/\boutput[\\/][^；。\n]+/gi, '证据路径见详情')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactDeliveryMessage(text: string): string {
  return stripPrimaryTechnicalDetails(text)
    .replace(/：证据路径见详情/g, '，路径见详情')
    .replace(/: 证据路径见详情/g, '，路径见详情');
}

function reconciliationSourceLabel(source?: string): string {
  if (source === 'canonical_advertised_product') return '推广商品报表口径';
  if (source === 'canonical_ad_group') return '广告组报表口径';
  if (source === 'canonical_user_search_term') return '用户搜索词权威口径';
  if (source === 'canonical_search_term') return '搜索词总盘口径';
  return source || '未记录';
}

type EvidenceGovernanceFact = {
  label: string;
  value: string;
  tone: DeliveryTone;
};

export function buildEvidenceGovernanceFacts(input: {
  finalManifestPath: string;
  finalReadinessRefresh: FinalReadinessRefreshResult | null;
  packageSummary: string;
  readiness: DeliveryReadinessView | null;
}): EvidenceGovernanceFact[] {
  const readiness = input.readiness;
  const authoritative = Boolean(readiness?.appReady && readiness?.manifestDriven);
  const manifestPath = input.finalReadinessRefresh?.evidenceManifestPath || input.finalManifestPath;
  const finalReadinessPath = input.finalReadinessRefresh?.finalReadinessPath || input.finalManifestPath;
  const packageRecorded = input.packageSummary && !input.packageSummary.includes('未记录') && !input.packageSummary.includes('不可用');

  return [
    {
      label: '权威来源',
      value: readiness?.manifestDriven ? '最终验收汇总驱动' : '不是权威验收',
      tone: readiness?.manifestDriven ? 'ready' : 'blocked',
    },
    {
      label: '最终验收',
      value: finalReadinessPath ? compactDeliveryPath(finalReadinessPath) : '尚未生成',
      tone: finalReadinessPath ? (authoritative ? 'ready' : 'warning') : 'blocked',
    },
    {
      label: '证据清单',
      value: manifestPath ? compactDeliveryPath(manifestPath) : '等待选择证据',
      tone: manifestPath ? 'ready' : 'warning',
    },
    {
      label: '安装包索引',
      value: packageRecorded ? '已记录并绑定' : '未绑定当前包',
      tone: packageRecorded ? 'ready' : 'blocked',
    },
  ];
}

function evidenceGovernanceSummary(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) {
    return '交付判断以最终验收汇总为准，README 和用户指南只是摘要说明。';
  }
  if (readiness?.manifestDriven === false) {
    return '当前最终验收不是由最终验收汇总驱动，不能作为可交付声明来源。';
  }
  return '先生成最终验收汇总，再导出交付包并运行可交付安全检查。';
}

function evidenceGovernanceRules(readiness: DeliveryReadinessView | null): string[] {
  const rules = [
    '真实领星报表才算数据来源；截图、HTML、审计 JSON 只能作为辅助证据。',
    '界面检查和文档状态不能替代最终验收汇总。',
    '安装版和免安装版校验码必须来自当前包索引。',
  ];
  if (!readiness?.manifestDriven) {
    rules.unshift('当前页面不能仅凭最新文件或 README 文案声明可交付状态。');
  }
  return rules;
}

function evidenceGovernanceTone(readiness: DeliveryReadinessView | null): DeliveryTone {
  if (readiness?.appReady && readiness?.manifestDriven) return 'ready';
  if (readiness?.manifestDriven === false) return 'blocked';
  return 'warning';
}

type DeliveryOverviewFact = {
  label: string;
  value: string;
};

export function buildDeliveryOverviewFacts(input: {
  scopeSummary: string;
  realFileCount: number;
  importedRows: number;
  readinessStatusText: string;
  gateSummaryText: string;
  packageSummaryText: string;
}): DeliveryOverviewFact[] {
  const packageRecorded = input.packageSummaryText && !input.packageSummaryText.includes('未记录') && !input.packageSummaryText.includes('不可用');
  return [
    { label: '运营范围', value: input.scopeSummary },
    { label: '真实数据', value: `${input.realFileCount} 个文件 / ${input.importedRows} 行` },
    { label: '最终验收', value: `${input.readinessStatusText} / ${input.gateSummaryText}` },
    { label: '安装包', value: packageRecorded ? '已记录' : '未记录' },
  ];
}

export function readinessBlockerTexts(readiness: DeliveryReadinessView | null): string[] {
  if (!readiness) return [];
  const failedGateMessages = (readiness.gates || [])
    .filter((gate) => !gate.ok)
    .map((gate) => gate.message || `${gate.name} 未通过。`);
  return uniqueDisplayTexts([
    ...(readiness.actionItems || []),
    ...(readiness.missing || []),
    ...(readiness.recommendationReviewReasons || []),
    ...(readiness.reviewBlockers || []),
    ...(readiness.deliveryReviewReasons || []),
    ...(readiness.finalReadinessBlockers || []),
    ...failedGateMessages,
  ]);
}

export function buildManifestActions(readiness: DeliveryReadinessView | null): string[] {
  if (!readiness?.available) return [deliveryTextForDisplay(readiness?.message || '最终验收汇总尚未生成')];
  if (!readiness.manifestDriven) return [deliveryTextForDisplay('重新生成最终验收汇总，并用该汇总运行最终验收。')];
  if (readiness.appReady) {
    const passedMessages = readiness.gates
      .filter((gate) => gate.ok && gate.message)
      .map((gate) => deliveryTextForDisplay(gate.message as string));
    return [deliveryTextForDisplay('最终验收汇总已通过；仍需保留证据包和安装包校验码。'), ...passedMessages];
  }
  const blockers = readinessBlockerTexts(readiness);
  return blockers.length > 0 ? blockers : [deliveryTextForDisplay('补齐未通过的 final readiness gate 后重新验收。')];
}

function gateStatusLabel(gate: DeliveryReadinessGate): string {
  if (gate.ok) return '通过';
  return gate.status === 'blocked' ? '阻断' : '未通过';
}

function gateMessageForDisplay(gate: DeliveryReadinessGate, manifestReady: boolean): string {
  const raw = gate.message || '无附加说明';
  return manifestReady ? deliveryTextForDisplay(raw) : deliveryTextForDisplay(raw);
}

export function findReadbackBlockerGate(readiness: DeliveryReadinessView | null): DeliveryReadinessGate | null {
  const gates = readiness?.gates || [];
  return gates.find((gate) => {
    if (gate.ok) return false;
    const haystack = `${gate.name || ''} ${gate.message || ''} ${gate.evidencePath || ''}`.toLowerCase();
    return haystack.includes('readback') || haystack.includes('回读') || haystack.includes('广告执行');
  }) || null;
}

export function readbackBlockerSummary(gate: DeliveryReadinessGate | null): string {
  if (!gate) return '当前没有检测到广告回读 gate 阻断。';
  const message = deliveryTextForDisplay(gate.message || '真实广告回读证据未通过。');
  const evidence = gate.evidencePath ? `候选证据：${gate.evidencePath}` : '候选证据路径未绑定。';
  return `${message} ${evidence}`;
}

export function buildDeliveryReadbackRepairIntent(gate: DeliveryReadinessGate | null): ReadbackRepairIntent {
  return {
    source: 'delivery',
    step: 'evidence',
    candidatePath: gate?.evidencePath || undefined,
    missingFields: ['执行前截图', '执行后截图', '回读证据', '回读值', '回读时间'],
    summary: readbackBlockerSummary(gate),
    createdAt: new Date().toISOString(),
  };
}

function primaryMissingItems(
  readiness: DeliveryReadinessView | null,
  matrix: ReturnType<typeof buildDeliveryReadinessMatrix>,
): string[] {
  const matrixGaps = matrix.items
    .filter((item) => item.tone !== 'ready')
    .map((item) => `${item.label}：${item.detail}`);
  return uniqueDisplayTexts([
    ...matrixGaps,
    ...readinessBlockerTexts(readiness),
  ].map(stripPrimaryTechnicalDetails)).slice(0, 3);
}

export function buildDeliveryItems(
  data: BusinessDataPipeline | null,
  readiness: DeliveryReadinessView | null,
  evidenceStatus?: DeliveryEvidenceStatusView | null,
): DeliveryItem[] {
  const collection = data?.collection;
  const quant = data?.quant;
  const files = collection?.realReportFiles || [];
  const options = collection?.reportOptions || [];
  const missingReports = options.filter((item) => !item.realFileAvailable);
  const importedRows = readNumber(collection?.fileAudit?.importedRowCount, readNumber(quant?.importedRows, 0));
  const diagnostics = quant?.diagnostics || [];
  const collectionBlockers = collection?.blockers || [];
  const quantBlockers = quant?.blockers || [];
  const readinessBlockers = readinessBlockerTexts(readiness);
  const hasRealFiles = files.length > 0;
  const hasMetrics = Boolean(quant?.hasImportedMetrics) && importedRows > 0;
  const finalReady = Boolean(readiness?.appReady && readiness?.manifestDriven);
  const packageEvidence = evidenceStatus?.package;
  const packageReady = Boolean(finalReady && packageEvidence?.installerAvailable);

  return [
    {
      title: '原始广告报表',
      tone: hasRealFiles && missingReports.length === 0 ? 'ready' : hasRealFiles ? 'warning' : 'blocked',
      summary: hasRealFiles ? `当前范围可见 ${files.length} 个原始广告报表文件。` : '当前范围没有可用于交付的 .xlsx/.xls/.csv 原始广告报表。',
      actions: missingReports.length > 0
        ? missingReports.map((item) => `下载并导入${item.label}。`)
        : hasRealFiles
          ? ['在交付包中保留原始报表工件标识和导入记录。']
          : ['先从领星下载真实广告报表，再进入量化和交付验收。'],
      evidence: files.map((file) => `${file.displayName}: ${file.artifactDisplayName || file.fileName || '工件名称不可用'}（${file.importedRows} 行）`),
    },
    {
      title: '广告指标入库',
      tone: hasMetrics ? 'ready' : 'blocked',
      summary: hasMetrics ? `当前范围已有 ${importedRows} 行广告指标。` : '当前范围缺少已导入广告指标。',
      actions: hasMetrics ? ['对账原始报表与本地数据库导入行数。'] : ['导入已下载的原始广告报表到本地指标库。'],
      evidence: [
        `花费：${readNumber(quant?.totalSpend).toFixed(2)} USD`,
        `销售额：${readNumber(quant?.totalSales).toFixed(2)} USD`,
        `订单：${readNumber(quant?.totalOrders)}`,
        `点击：${readNumber(quant?.totalClicks)}`,
      ],
    },
    {
      title: '广告表现',
      tone: diagnostics.length > 0 ? 'warning' : 'blocked',
      summary: diagnostics.length > 0 ? `已有 ${diagnostics.length} 条广告表现诊断需要业务复核。` : '还没有可交付的实体级广告表现诊断。',
      actions: diagnostics.length > 0 ? ['先复核高风险行，再生成或审批优化建议。'] : ['真实文件和导入指标齐备后查看广告表现。'],
      evidence: diagnostics.slice(0, 3).map((item) => `${item.campaignName || '广告活动'} / ${item.objectName || '对象'}：ACOS ${percent(readNumber(item.acos))}`),
    },
    {
      title: 'AI 业务证据',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受 AI 相关证据。' : '最终验收汇总尚未证明真实 AI 连接、广告 AI 解释和 Listing AI 草案。',
      actions: finalReady ? ['保留脱敏 AI 证据路径。'] : ['保存脱敏 Provider 配置，完成连接测试，并附加广告解释与 Listing 草案证据。'],
    },
    {
      title: '优化建议证据',
      tone: finalReady ? 'ready' : hasMetrics ? 'pending' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受优化建议证据。' : hasMetrics ? '已有指标，但仍需绑定当前来源文件的建议证据。' : '缺少真实指标时不能生成交付级建议。',
      actions: ['只从当前范围数据批次生成建议，并保留来源文件证据。'],
    },
    {
      title: '审批与回读',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受审批和回读证据。' : '仍需真实广告动作的审批、执行前/执行后和回读证明。',
      actions: ['记录审批人、范围、执行前值、执行后值、截图和回读值。'],
    },
    {
      title: '关键词机会',
      tone: finalReady ? 'ready' : hasMetrics ? 'pending' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受关键词机会证据。' : hasMetrics ? '可生成关键词机会，但交付证据尚未聚合。' : '关键词机会需要已导入广告指标。',
      actions: ['按 ASIN、广告活动、广告组、对象类型和关键词去重生成机会。'],
    },
    {
      title: 'Listing 草案证据',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收汇总已接受 Listing AI 草案证据。' : '当前最终就绪状态缺少 Listing AI 草案证据。',
      actions: ['从领星读取 Listing，生成本地 AI 草案，并保留导出路径。'],
    },
    {
      title: '安装包',
      tone: packageReady ? 'ready' : finalReady ? 'pending' : 'blocked',
      summary: packageReady
        ? '最终验收汇总已通过，安装包/校验码已记录。'
        : finalReady
          ? '最终验收汇总已通过，但安装包/校验码还未记录。'
          : '最终验收汇总未通过前不能声明安装包可交付。',
      actions: packageReady
        ? ['复核安装包路径、免安装包和 SHA-256 校验码是否与本次交付一致。']
        : ['最终节点生成免安装包，并记录路径和 SHA-256 校验码。'],
      evidence: packageReady
        ? [
            packageEvidence?.installerPath ? `安装包：${packageEvidence.installerPath}` : '',
            packageEvidence?.portablePath ? `免安装版：${packageEvidence.portablePath}` : '',
            packageEvidence?.sha256 ? `SHA-256：${packageEvidence.sha256}` : '',
            packageEvidence?.latestBuiltAt ? `生成时间：${packageEvidence.latestBuiltAt}` : '',
          ].filter(Boolean)
        : [],
    },
    {
      title: '当前阻塞项',
      tone: finalReady ? 'ready' : 'blocked',
      summary: finalReady ? '最终验收项已通过。' : '当前范围仍有需要处理的交付阻塞项。',
      actions: [
        ...readinessBlockers,
        ...deliveryTextsForDisplay(collectionBlockers),
        ...deliveryTextsForDisplay(quantBlockers),
      ],
    },
  ];
}

export function DeliveryPage() {
  const scope = useScopeStore((state) => state.scope);
  const storeAuthority = useMissionControlStoreContext();
  const [data, setData] = useState<BusinessDataPipeline | null>(null);
  const [readiness, setReadiness] = useState<DeliveryReadinessView | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataReconciliation, setDataReconciliation] = useState<DataReconciliationExportResult | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiDiagnosisRuns, setAiDiagnosisRuns] = useState<AiDiagnosisRunView[]>([]);
  const [pendingRecommendations, setPendingRecommendations] = useState<RecommendationView[]>([]);
  const [needsReviewRecommendations, setNeedsReviewRecommendations] = useState<RecommendationView[]>([]);
  const [approvedRecommendations, setApprovedRecommendations] = useState<RecommendationView[]>([]);
  const [deliveryEvidenceStatus, setDeliveryEvidenceStatus] = useState<DeliveryEvidenceStatusView | null>(null);
  const [finalReadinessRefresh, setFinalReadinessRefresh] = useState<FinalReadinessRefreshResult | null>(null);
  const [readbackSession, setReadbackSession] = useState<ReadbackSessionResult | null>(null);
  const [readbackSessionCheck, setReadbackSessionCheck] = useState<ReadbackSessionCheckResult | null>(null);
  const [readbackSessionFill, setReadbackSessionFill] = useState<ReadbackSessionFillResult | null>(null);
  const [readbackEvidenceVerify, setReadbackEvidenceVerify] = useState<ReadbackEvidenceVerifyResult | null>(null);
  const [exportedBundlePath, setExportedBundlePath] = useState('');
  const [deliveryActionBusy, setDeliveryActionBusy] = useState<DeliveryActionKey | null>(null);
  const [openingPathKey, setOpeningPathKey] = useState<string | null>(null);
  const [copySummaryBusy, setCopySummaryBusy] = useState(false);

  const apiSurface = useMemo(() => api(), []);
  const canOpenPath = typeof apiSurface.openReportPath === 'function';
  const canOpenArtifact = typeof apiSurface.openReportArtifact === 'function';
  const items = useMemo(() => buildDeliveryItems(data, readiness, deliveryEvidenceStatus), [data, deliveryEvidenceStatus, readiness]);
  const reportFolderArtifact = collectionFolderArtifact(data);
  const reportManifestArtifact = collectionManifestArtifact(data);
  const finalManifestPath = readiness?.path || '';
  const realFiles = data?.collection?.realReportFiles || [];
  const reportDownloadLabel = reportFolderArtifact?.displayName || '目录工件不可用';
  const collectionManifestLabel = reportManifestArtifact?.displayName || '清单工件不可用';
  const quant = data?.quant;
  const importedRows = readNumber(data?.collection?.fileAudit?.importedRowCount, readNumber(quant?.importedRows));
  const manifestReady = readiness?.appReady && readiness?.manifestDriven;
  const deliveryReady = canExportDeliveryBundle(readiness, deliveryEvidenceStatus?.package);
  const previewState = useMemo(
    () => deliveryPreviewState(readiness, deliveryEvidenceStatus),
    [deliveryEvidenceStatus, readiness],
  );
  const packageSummary = packageEvidenceSummary(deliveryEvidenceStatus?.package);
  const evidenceGovernanceFacts = buildEvidenceGovernanceFacts({
    finalManifestPath,
    finalReadinessRefresh,
    packageSummary,
    readiness,
  });
  const evidenceGovernanceStatus = evidenceGovernanceTone(readiness);
  const gateSummaryText = readiness?.gatesSummary ? `${readiness.gatesSummary.passed}/${readiness.gatesSummary.total} 通过` : '未生成';
  const deliveryOverviewFacts = buildDeliveryOverviewFacts({
    scopeSummary: summarizeScope(data, scope),
    realFileCount: realFiles.length,
    importedRows,
    readinessStatusText: deliveryReady ? '可以交付' : '还不能交付',
    gateSummaryText,
    packageSummaryText: packageSummary,
  });
  const readbackBlockerGate = useMemo(() => findReadbackBlockerGate(readiness), [readiness]);
  const readbackCandidatePath = readbackBlockerGate?.evidencePath || '';
  const deliveryMatrix = useMemo(() => buildDeliveryReadinessMatrix(buildDeliveryReadinessMatrixInput({
    data,
    readiness,
    evidenceStatus: deliveryEvidenceStatus,
    aiAvailable,
    aiDiagnosisRuns,
    pendingRecommendations,
    needsReviewRecommendations,
    approvedRecommendations,
  })), [aiAvailable, aiDiagnosisRuns, approvedRecommendations, data, deliveryEvidenceStatus, needsReviewRecommendations, pendingRecommendations, readiness]);
  const topDeliveryGap = deliveryMatrix.items.find((item) => item.tone !== 'ready') || null;
  const deliveryTaskTitle = deliveryReady ? '可以交付' : '还不能交付';
  const deliveryDataFact = deliveryOverviewFacts.find((fact) => fact.label === '真实数据');
  const missingItems = primaryMissingItems(readiness, deliveryMatrix);
  const packageBrief = packageEvidenceBrief(deliveryEvidenceStatus?.package);
  const packagePath = deliveryEvidenceStatus?.package?.portablePath || deliveryEvidenceStatus?.package?.installerPath || '';
  const packageDirectory = directoryFromPath(packagePath);
  const deliveryBundleOpenPath = exportedBundlePath || DELIVERY_BUNDLE_PATH;
  const deliveryTaskDetail = deliveryReady
    ? '最终验收已通过，安装包证据已记录；可以导出交付包。'
    : missingItems[0] || '当前还不能声明可交付；先补齐最关键缺口，再刷新最终验收。';
  const deliveryPrimaryAction = (() => {
    if (deliveryReady) {
      return { kind: 'export', label: '导出交付包', onClick: exportBundle };
    }
    if (topDeliveryGap?.key === 'data') {
      return { kind: 'navigate', label: topDeliveryGap.nextAction || '去数据采集', onClick: () => navigate(topDeliveryGap.route) };
    }
    if (topDeliveryGap?.key === 'readback') {
      return readbackBlockerGate
        ? { kind: 'repair-readback', label: '直达回读补证', onClick: requestReadbackRepair }
        : { kind: 'navigate-readback', label: '去结果核对', onClick: () => navigate('readback') };
    }
    if (topDeliveryGap?.key === 'package') {
      return { kind: 'refresh', label: '刷新最终验收', onClick: refreshFinalReadinessManifest };
    }
    if (topDeliveryGap) {
      return { kind: 'navigate', label: topDeliveryGap.nextAction, onClick: () => navigate(topDeliveryGap.route) };
    }
    return { kind: 'refresh', label: '刷新最终验收', onClick: refreshFinalReadinessManifest };
  })();
  const secondaryTaskActions = [
    ...(deliveryPrimaryAction.kind === 'refresh' ? [] : [{
      label: '刷新最终验收',
      onClick: refreshFinalReadinessManifest,
      busy: deliveryActionBusy === 'refresh-final',
      busyLabel: deliveryActionBusyLabel('refresh-final'),
      disabled: Boolean(deliveryActionBusy && deliveryActionBusy !== 'refresh-final'),
    }]),
    deliveryCopySummaryActionView({
      copying: copySummaryBusy,
      disabled: Boolean(deliveryActionBusy),
      onClick: copySummary,
    }),
  ].slice(0, 2);
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const notes: string[] = [];
      let loadedData: BusinessDataPipeline | null = null;
      try {
        if (typeof apiSurface.getBusinessUiDataPipeline === 'function') {
          const nextData = await apiSurface.getBusinessUiDataPipeline(scope);
          loadedData = nextData || null;
          if (mounted) setData(nextData);
        } else {
          notes.push('数据管道能力未连接，交付页只显示最终验收状态。');
        }
        if (typeof apiSurface.getDeliveryReadiness === 'function') {
          const nextReadiness = await apiSurface.getDeliveryReadiness();
          if (mounted) setReadiness(nextReadiness);
        } else {
          notes.push('最终验收能力未连接。');
          if (mounted) {
            setReadiness({
              available: false,
              path: null,
              exists: false,
              status: 'APP_NEEDS_WORK',
              appReady: false,
              manifestDriven: false,
              gates: [],
              gatesSummary: { total: 0, passed: 0, failed: 0 },
              missing: ['最终验收能力未连接'],
              actionItems: ['接入 getDeliveryReadiness API 后重新读取最终验收汇总。'],
              message: '最终验收能力未连接。',
            });
          }
        }
        if (typeof apiSurface.getSettings === 'function') {
          const settings = await apiSurface.getSettings();
          if (mounted) setAiAvailable(aiAvailableFromSettings(settings));
        } else if (mounted) {
          setAiAvailable(false);
        }
        const effectiveBatchId = scope.batchId || loadedData?.collection?.latestBatch?.id;
        if (typeof apiSurface.listAiDiagnosisRuns === 'function') {
          const runs = await apiSurface.listAiDiagnosisRuns({
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin,
            batchId: effectiveBatchId,
            limit: 5,
          });
          if (mounted) setAiDiagnosisRuns(Array.isArray(runs) ? runs : []);
        } else if (mounted) {
          setAiDiagnosisRuns([]);
        }
        if (typeof apiSurface.getRecommendations === 'function') {
          const commonFilter = {
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin,
            batchId: effectiveBatchId,
            limit: 20,
          };
          const [pending, needsReview, approved] = await Promise.all([
            apiSurface.getRecommendations({ ...commonFilter, status: 'pending' }),
            apiSurface.getRecommendations({ ...commonFilter, status: 'needs_review' }),
            apiSurface.getRecommendations({ ...commonFilter, status: 'approved' }),
          ]);
          if (mounted) {
            setPendingRecommendations(Array.isArray(pending) ? pending : []);
            setNeedsReviewRecommendations(Array.isArray(needsReview) ? needsReview : []);
            setApprovedRecommendations(Array.isArray(approved) ? approved : []);
          }
        } else if (mounted) {
          setPendingRecommendations([]);
          setNeedsReviewRecommendations([]);
          setApprovedRecommendations([]);
        }
        if (typeof apiSurface.getDeliveryEvidenceStatus === 'function') {
          const nextEvidenceStatus = await apiSurface.getDeliveryEvidenceStatus({
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin,
            batchId: effectiveBatchId,
          });
          if (mounted) setDeliveryEvidenceStatus(nextEvidenceStatus || null);
        } else if (mounted) {
          setDeliveryEvidenceStatus(null);
        }
      } catch (caught) {
        notes.push(toUserFacingError(caught, '读取交付状态失败。'));
      } finally {
        if (mounted) {
          setMessage(notes.join(' '));
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [apiSurface, scope.asin, scope.batchId, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  async function openPath(targetPath: string, label: string) {
    if (openingPathKey) return;
    if (!targetPath) {
      setMessage(`${label}不可用：最终验收汇总尚未生成。`);
      return;
    }
    if (!canOpenPath) {
      setMessage(`${label}不可用：openReportPath 未接入。`);
      return;
    }
    const pathKey = deliveryPathActionKey(label, targetPath);
    setOpeningPathKey(pathKey);
    setMessage(`${label}打开中...`);
    try {
      await apiSurface.openReportPath(targetPath);
      setMessage(`${label}已请求打开，路径见详情。`);
    } catch (caught) {
      setMessage(compactDeliveryMessage(toUserFacingError(caught, `${label}打开失败。`)));
    } finally {
      setOpeningPathKey(null);
    }
  }

  async function openArtifact(artifactId: RendererArtifactId | '', label: string) {
    if (openingPathKey) return;
    if (!artifactId) {
      setMessage(`${label}不可用：当前没有已登记的文件或目录工件。`);
      return;
    }
    if (!canOpenArtifact) {
      setMessage(`${label}不可用：不透明工件打开能力未接入。`);
      return;
    }
    const artifactKey = deliveryPathActionKey(label, `artifact:${artifactId}`);
    setOpeningPathKey(artifactKey);
    setMessage(`${label}打开中...`);
    try {
      const storeContext = storeAuthority.authoritativeContext;
      if (!storeContext) throw new Error('当前店铺权威不可用。');
      await apiSurface.openReportArtifact(artifactId, { ...storeContext });
      setMessage(`${label}已请求打开。`);
    } catch (caught) {
      setMessage(compactDeliveryMessage(toUserFacingError(caught, `${label}打开失败。`)));
    } finally {
      setOpeningPathKey(null);
    }
  }

  async function runDeliveryAction(action: DeliveryActionKey, task: () => Promise<void>) {
    if (deliveryActionBusy) return;
    setDeliveryActionBusy(action);
    try {
      await task();
    } finally {
      setDeliveryActionBusy(null);
    }
  }

  async function exportBundle() {
    if (!deliveryReady) {
      setMessage('交付包未导出：最终验收、非预览门禁或当前免安装包校验码尚未全部通过。');
      return;
    }
    if (typeof apiSurface.exportDeliveryBundle !== 'function') {
      setMessage('导出交付包能力未连接。请先生成最终验收汇总，再运行交付包导出。');
      return;
    }
    await runDeliveryAction('export-bundle', async () => {
      try {
        const result = await apiSurface.exportDeliveryBundle(scope);
        if (result?.success) {
          if (result.dataReconciliation) {
            setDataReconciliation(result.dataReconciliation);
          }
          setExportedBundlePath(result.bundleDir || result.manifestPath || DELIVERY_BUNDLE_PATH);
          const reconciliationSuffix = result.dataReconciliation?.jsonPath || result.dataReconciliation?.markdownPath
            ? '；已包含当前范围数据口径核对'
            : '';
          setMessage(`交付包已导出${reconciliationSuffix}。`);
        } else {
          setMessage(compactDeliveryMessage(result?.message || '交付包未导出：请先补齐最终就绪证据。'));
        }
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '交付包导出失败。')));
      }
    });
  }

  async function refreshFinalReadinessManifest() {
    if (typeof apiSurface.refreshFinalReadiness !== 'function') {
      setMessage('刷新最终验收能力未连接。');
      return;
    }
    await runDeliveryAction('refresh-final', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('refresh', () => apiSurface.refreshFinalReadiness());
        setFinalReadinessRefresh(result || null);
        if (result?.readiness) {
          setReadiness(result.readiness);
        }
        setMessage(result?.readiness?.appReady
          ? '最终验收已刷新并通过。'
          : '最终验收已刷新，仍未就绪。');
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '刷新最终验收失败。')));
      }
    });
  }

  async function createReadbackWorkPackage() {
    if (!readbackCandidatePath) {
      setMessage('无法创建回读工作包：当前最终验收没有绑定广告回读候选证据路径。');
      return;
    }
    if (typeof apiSurface.prepareAdReadbackSession !== 'function') {
      setMessage('无法创建回读工作包：本地回读准备能力未连接。');
      return;
    }
    await runDeliveryAction('create-readback', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('create-readback', () => apiSurface.prepareAdReadbackSession({ sourcePath: readbackCandidatePath }));
        setReadbackSession(result || null);
        setReadbackSessionCheck(null);
        setReadbackSessionFill(null);
        setReadbackEvidenceVerify(null);
        setMessage('回读工作包已创建，路径见详情。');
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '创建回读工作包失败。')));
      }
    });
  }

  function requestReadbackRepair() {
    const intent = buildDeliveryReadbackRepairIntent(readbackBlockerGate);
    try {
      window.sessionStorage?.setItem(READBACK_REPAIR_INTENT_STORAGE_KEY, JSON.stringify(intent));
    } catch {
      // Session storage is best-effort; the runtime event still covers same-page consumers.
    }
    window.dispatchEvent(new CustomEvent<ReadbackRepairIntent>(READBACK_REPAIR_INTENT_EVENT, { detail: intent }));
    navigate('readback');
  }

  async function verifyReadbackWorkPackage() {
    const sessionDir = readbackSession?.sessionDir || '';
    if (!sessionDir) {
      setMessage('无法检查回读工作包：请先创建工作包。');
      return;
    }
    if (typeof apiSurface.verifyAdReadbackSession !== 'function') {
      setMessage('无法检查回读工作包：本地工作包检查能力未连接。');
      return;
    }
    await runDeliveryAction('verify-readback-session', async () => {
      try {
        const result = await apiSurface.verifyAdReadbackSession({ sessionDir });
        setReadbackSessionCheck(result || null);
        if (result?.ready && result?.captureReady) {
          setMessage('回读工作包结构和现场证据均已通过。');
        } else if (result?.ready) {
          setMessage(`回读工作包结构已通过，但现场证据仍待填写：${formatCaptureMissing(result?.captureMissingFields, result?.unresolvedFields)}`);
        } else {
          setMessage(compactDeliveryMessage(`回读工作包仍需补齐：${(result?.issues || []).slice(0, 2).join('；')}`));
        }
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '检查回读工作包失败。')));
      }
    });
  }

  async function fillReadbackWorkPackage() {
    const sessionDir = readbackSession?.sessionDir || '';
    if (!sessionDir) {
      setMessage('无法生成回读证据：请先创建工作包。');
      return;
    }
    if (typeof apiSurface.fillAdReadbackSession !== 'function') {
      setMessage('无法生成回读证据：本地证据生成能力未连接。');
      return;
    }
    await runDeliveryAction('fill-readback-session', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('create-readback', () => apiSurface.fillAdReadbackSession({ sessionDir }));
        setReadbackSessionFill(result || null);
        setMessage(result?.readyForVerifier
          ? '回读证据已生成，可进入校验。'
          : compactDeliveryMessage(`回读证据未生成通过：${(result?.issues || []).slice(0, 2).join('；')}`));
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '生成回读证据失败。')));
      }
    });
  }

  async function verifyGeneratedReadbackEvidence() {
    const evidencePath = readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath || '';
    if (!evidencePath) {
      setMessage('无法校验回读证据：请先生成回读证据。');
      return;
    }
    if (typeof apiSurface.verifyAdReadbackEvidence !== 'function') {
      setMessage('无法校验回读证据：本地回读校验能力未连接。');
      return;
    }
    await runDeliveryAction('verify-readback-evidence', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('verify-readback', () => apiSurface.verifyAdReadbackEvidence({ evidencePath }));
        setReadbackEvidenceVerify(result || null);
        const passed = deliveryReadbackVerifierPassed(result);
        setMessage(passed
          ? '回读证据校验通过。'
          : compactDeliveryMessage(`回读证据仍未通过：${(result?.issues || result?.blockers || []).slice(0, 2).join('；')}`));
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '校验回读证据失败。')));
      }
    });
  }

  async function refreshFinalReadinessWithReadback() {
    const evidencePath = readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath || '';
    if (!evidencePath) {
      setMessage('无法用回读证据刷新最终验收：请先生成回读证据。');
      return;
    }
    if (typeof apiSurface.refreshFinalReadiness !== 'function') {
      setMessage('刷新最终验收能力未连接。');
      return;
    }
    await runDeliveryAction('refresh-final-with-readback', async () => {
      try {
        const result = await runDeliveryWorkflowMutation<any>('refresh', () => apiSurface.refreshFinalReadiness({ adReadbackPath: evidencePath }));
        setFinalReadinessRefresh(result || null);
        if (result?.readiness) {
          setReadiness(result.readiness);
        }
        setMessage(result?.readiness?.appReady
          ? '已使用回读证据刷新并通过最终验收。'
          : '已使用回读证据刷新最终验收，仍未就绪。');
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '使用回读证据刷新最终验收失败。')));
      }
    });
  }

  async function exportDataReconciliation() {
    if (typeof apiSurface.exportDataReconciliation !== 'function') {
      setMessage('数据口径核对导出能力未连接。');
      return;
    }
    await runDeliveryAction('export-reconciliation', async () => {
      try {
        const result = await apiSurface.exportDataReconciliation(scope);
        setDataReconciliation(result || null);
        if (result?.jsonPath || result?.markdownPath) {
          setMessage('数据口径核对报告已导出，路径见详情。');
        } else {
          setMessage('数据口径核对报告已生成，但未返回文件路径。');
        }
      } catch (caught) {
        setMessage(compactDeliveryMessage(toUserFacingError(caught, '数据口径核对报告导出失败。')));
      }
    });
  }

  async function copySummary() {
    if (copySummaryBusy) return;
    const summary = [
      `交付状态：${deliveryTaskTitle}`,
      `范围：${summarizeScope(data, scope)}`,
      '最终验收通过且安装包证据已记录时，才可声明可以交付。',
      `真实报表文件：${realFiles.length}`,
      `真实报表目录工件：${reportDownloadLabel}`,
      `真实报表清单工件：${collectionManifestLabel}`,
      ...realFiles.slice(0, 8).map((file) => `原始文件：${file.displayName || file.reportType} / ${file.artifactDisplayName || file.fileName || '工件名称不可用'}`),
      `导入指标行数：${importedRows}`,
      `最终验收汇总：${finalManifestPath || '最终验收汇总尚未生成'}`,
      `安装包：${packageSummary}`,
    ].join('\n');
    setCopySummaryBusy(true);
    setMessage('正在复制交付摘要...');
    try {
      await navigator.clipboard.writeText(summary);
      setMessage('交付摘要已复制。');
    } catch (caught) {
      setMessage(toUserFacingError(caught, '复制交付摘要失败。'));
    } finally {
      setCopySummaryBusy(false);
    }
  }

  const exportBundleButton = deliveryActionButtonView({
    action: 'export-bundle',
    activeAction: deliveryActionBusy,
    baseClassName: `secondary-button delivery-export-button${deliveryReady ? '' : ' delivery-export-blocked'}`,
    busyLabel: deliveryActionBusyLabel('export-bundle'),
    disabled: !deliveryReady,
    idleLabel: '导出交付包',
  });
  const exportReconciliationButton = deliveryActionButtonView({
    action: 'export-reconciliation',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('export-reconciliation'),
    idleLabel: '导出数据口径核对',
  });
  const createReadbackButton = deliveryActionButtonView({
    action: 'create-readback',
    activeAction: deliveryActionBusy,
    baseClassName: 'primary-button',
    busyLabel: deliveryActionBusyLabel('create-readback'),
    disabled: !readbackCandidatePath,
    idleLabel: '创建回读工作包',
  });
  const verifyReadbackSessionButton = deliveryActionButtonView({
    action: 'verify-readback-session',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('verify-readback-session'),
    disabled: !readbackSession?.sessionDir,
    idleLabel: '检查工作包',
  });
  const fillReadbackSessionButton = deliveryActionButtonView({
    action: 'fill-readback-session',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('fill-readback-session'),
    disabled: !readbackSession?.sessionDir,
    idleLabel: '生成回读证据',
  });
  const verifyReadbackEvidenceButton = deliveryActionButtonView({
    action: 'verify-readback-evidence',
    activeAction: deliveryActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: deliveryActionBusyLabel('verify-readback-evidence'),
    disabled: !(readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath),
    idleLabel: '校验回读证据',
  });
  const refreshWithReadbackButton = deliveryActionButtonView({
    action: 'refresh-final-with-readback',
    activeAction: deliveryActionBusy,
    baseClassName: 'primary-button',
    busyLabel: deliveryActionBusyLabel('refresh-final-with-readback'),
    disabled: !(readbackSessionFill?.jsonPath || readbackSession?.passEvidencePath),
    idleLabel: '用回读证据刷新最终验收',
  });
  const deliveryPrimaryButtonBase = deliveryPrimaryAction.kind === 'export'
    ? {
      ...exportBundleButton,
      className: exportBundleButton.className.replace('secondary-button', 'primary-button'),
    }
    : deliveryPrimaryAction.kind === 'refresh'
      ? deliveryActionButtonView({
        action: 'refresh-final',
        activeAction: deliveryActionBusy,
        baseClassName: 'primary-button',
        busyLabel: deliveryActionBusyLabel('refresh-final'),
        idleLabel: deliveryPrimaryAction.label,
      })
      : {
        ariaBusy: undefined,
        className: 'primary-button',
        disabled: Boolean(deliveryActionBusy),
        label: deliveryPrimaryAction.label,
        showSpinner: false,
      };
  const deliveryPrimaryButton = {
    ...deliveryPrimaryButtonBase,
    disabled: Boolean(deliveryPrimaryButtonBase.disabled || copySummaryBusy),
  };

  function renderOpenPathButton(input: {
    className?: string;
    disabled?: boolean;
    idleLabel: string;
    messageLabel?: string;
    targetPath: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = deliveryOpenPathButtonView({
      activePathKey: openingPathKey,
      baseClassName: input.className,
      disabled: input.disabled,
      idleLabel: input.idleLabel,
      pathKey: deliveryPathActionKey(messageLabel, input.targetPath),
    });
    return (
      <button
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        onClick={() => openPath(input.targetPath, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </button>
    );
  }

  function renderOpenArtifactButton(input: {
    artifactId?: RendererArtifactId;
    className?: string;
    idleLabel: string;
    messageLabel?: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const artifactId = input.artifactId || '';
    const view = deliveryOpenPathButtonView({
      activePathKey: openingPathKey,
      baseClassName: input.className,
      disabled: !artifactId || !canOpenArtifact,
      idleLabel: input.idleLabel,
      pathKey: deliveryPathActionKey(messageLabel, `artifact:${artifactId}`),
    });
    return (
      <button
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        onClick={() => openArtifact(artifactId, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </button>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="系统"
        title={PAGE_HEADER_TITLES.delivery}
        description="判断当前范围能不能交付、最关键阻塞是什么、交付包在哪里，以及可复制给运营的交付摘要。"
      />

      <div className="business-stack delivery-prototype-stack">
        <Panel className="delivery-summary-workbench" title="交付摘要" tone={deliveryReady ? 'success' : missingItems.length ? 'warning' : 'default'}>
          <DeliveryPreviewNotice state={previewState} />
          <div className="delivery-summary-hero" aria-label="交付验收结论">
            <div className="delivery-summary-conclusion">
              <div className="delivery-summary-status-row">
                <StatusPill tone={deliveryReady ? 'ready' : missingItems.length ? 'warning' : 'pending'}>
                  {deliverySummaryStatusLabel({ deliveryReady, previewOnly: Boolean(previewState) })}
                </StatusPill>
                <span>{gateSummaryText}</span>
              </div>
              <strong>{deliveryTaskTitle}</strong>
              <p>{deliveryTaskDetail}</p>
            </div>
            <div className="delivery-summary-side">
              <div>
                <span>最终验收</span>
                <strong>{readinessStatus(readiness)}</strong>
                <small>{readiness?.path ? '最终验收汇总已生成' : '等待生成'}</small>
              </div>
              <div>
                <span>交付包</span>
                <strong>{deliveryReady ? '可导出' : '阻断'}</strong>
                <small>{packageBrief}</small>
              </div>
              <div>
                <span>缺口</span>
                <strong>{missingItems.length || 0}</strong>
                <small>{missingItems[0] || '无主要缺口'}</small>
              </div>
            </div>
          </div>
          {deliveryDataFact && (
            <div className="delivery-summary-data-line">
              <span>{deliveryDataFact.label}</span>
              <strong>{deliveryDataFact.value}</strong>
              <small>最终能否交付仍以最终验收汇总和安装包证据为准。</small>
            </div>
          )}
          {deliveryReady ? (
            <p className="muted-line">交付包摘要：{packageBrief}</p>
          ) : (
            <ul className="delivery-action-list delivery-primary-missing-list">
              {(missingItems.length ? missingItems : ['刷新最终验收后查看当前最关键缺口。']).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <div className="action-row delivery-prototype-actions">
            <button
              aria-busy={deliveryPrimaryButton.ariaBusy}
              className={deliveryPrimaryButton.className}
              data-action-priority="primary"
              disabled={deliveryPrimaryButton.disabled}
              onClick={deliveryPrimaryAction.onClick}
              type="button"
            >
              {deliveryPrimaryButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              <span>{deliveryPrimaryButton.label}</span>
            </button>
          </div>
          {secondaryTaskActions.length > 0 && (
            <div className="action-row delivery-prototype-actions">
              {secondaryTaskActions.map((action) => (
                <button
                  aria-busy={action.busy || undefined}
                  className={action.busy ? 'secondary-button button-loading' : 'secondary-button'}
                  disabled={action.disabled}
                  key={action.label}
                  onClick={action.onClick}
                  type="button"
                >
                  {action.busy && <span className="button-spinner" aria-hidden="true" />}
                  <span>{action.busy ? action.busyLabel || action.label : action.label}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="business-stack delivery-details-stack">
        <ProgressiveDetails title="交付判断依据与证据治理">
          <Panel title="交付判断依据" tone={evidenceGovernanceStatus === 'ready' ? 'success' : evidenceGovernanceStatus === 'blocked' ? 'blocked' : 'warning'}>
            <div className="evidence-governance-card">
              <div className="evidence-governance-headline">
                <StatusPill tone={evidenceGovernanceStatus === 'ready' ? 'ready' : evidenceGovernanceStatus === 'blocked' ? 'blocked' : 'warning'}>
                  {evidenceGovernanceStatus === 'ready' ? '权威证据已绑定' : evidenceGovernanceStatus === 'blocked' ? '证据治理阻断' : '证据需复核'}
                </StatusPill>
                <p>{evidenceGovernanceSummary(readiness)}</p>
              </div>
              <div className="delivery-meta-grid evidence-governance-grid">
                {evidenceGovernanceFacts.map((fact) => (
                  <div key={fact.label}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </div>
                ))}
              </div>
              <ul className="delivery-action-list evidence-governance-rules">
                {evidenceGovernanceRules(readiness).map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="文件位置与支持入口">
          <div className="delivery-action-row">
            {renderOpenPathButton({ idleLabel: '打开交付包', targetPath: deliveryBundleOpenPath })}
            {renderOpenArtifactButton({ artifactId: reportFolderArtifact?.artifactId, idleLabel: '打开证据目录' })}
            {renderOpenArtifactButton({ artifactId: reportManifestArtifact?.artifactId, idleLabel: '打开采集清单' })}
            {renderOpenPathButton({ disabled: !packageDirectory, idleLabel: '打开安装包目录', targetPath: packageDirectory })}
            {renderOpenPathButton({ idleLabel: '打开最终验收汇总', targetPath: finalManifestPath })}
            <button aria-busy={exportReconciliationButton.ariaBusy} className={exportReconciliationButton.className} disabled={exportReconciliationButton.disabled} onClick={exportDataReconciliation} type="button">
              {exportReconciliationButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              <span>{exportReconciliationButton.label}</span>
            </button>
          </div>
          <div className="delivery-meta-grid">
            <div>
              <span>运营范围</span>
              <strong>{summarizeScope(data, scope)}</strong>
            </div>
            <div>
              <span>真实文件目录</span>
              <strong>{reportDownloadLabel}</strong>
            </div>
            <div>
              <span>采集清单</span>
              <strong>{collectionManifestLabel}</strong>
            </div>
            <div>
              <span>最终验收汇总</span>
              <strong>{finalManifestPath || deliveryTextForDisplay(readiness?.message || '') || '最终验收汇总尚未生成'}</strong>
            </div>
            <div>
              <span>安装包路径与校验码</span>
              <strong>{packageSummary}</strong>
            </div>
            <div>
              <span>交付包目标</span>
              <strong>{deliveryBundleOpenPath}</strong>
            </div>
          </div>
        </ProgressiveDetails>

        {finalReadinessRefresh && (
          <ProgressiveDetails title="最终验收刷新结果">
            <div className="delivery-meta-grid">
              <div>
                <span>证据汇总</span>
                <strong>{finalReadinessRefresh.evidenceManifestPath || '-'}</strong>
              </div>
              <div>
                <span>最终验收</span>
                <strong>{finalReadinessRefresh.finalReadinessPath || '-'}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{readinessStatus(finalReadinessRefresh.readiness || null)}</strong>
              </div>
              <div>
                <span>验收项</span>
                <strong>{finalReadinessRefresh.readiness?.gatesSummary ? `${finalReadinessRefresh.readiness.gatesSummary.passed}/${finalReadinessRefresh.readiness.gatesSummary.total} 通过` : '-'}</strong>
              </div>
            </div>
            <p className={finalReadinessRefresh.readiness?.appReady ? 'muted-line' : 'blocked-line'}>
              {finalReadinessRefresh.readiness?.appReady
                ? '最终验收已通过；导出可交付包前仍需确认 README 交付状态和安装包校验码。'
                : '最终验收已生成诊断文件，但仍有验收项未通过，不能声明可交付。'}
            </p>
          </ProgressiveDetails>
        )}

        {readbackBlockerGate && (
          <ProgressiveDetails title="广告回读补证">
            <div className="delivery-readiness-row">
              <div>
                <StatusPill tone="blocked">阻断</StatusPill>
                <p className="delivery-readiness-copy">最终验收当前卡在真实广告回读。需要为这个候选动作补齐审批、执行前/执行后截图和刷新回读证据。</p>
                <p className="blocked-line">{readbackBlockerSummary(readbackBlockerGate)}</p>
              </div>
              <div className="delivery-action-row">
                {deliveryPrimaryAction.kind !== 'create-readback' && (
                  <button aria-busy={createReadbackButton.ariaBusy} className={createReadbackButton.className} disabled={createReadbackButton.disabled} onClick={createReadbackWorkPackage} type="button">
                    {createReadbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{createReadbackButton.label}</span>
                  </button>
                )}
                {renderOpenPathButton({ disabled: !readbackCandidatePath, idleLabel: '打开候选证据', messageLabel: '打开回读候选证据', targetPath: readbackCandidatePath })}
                <button className="secondary-button" onClick={requestReadbackRepair} type="button">
                  直达补执行证据
                </button>
              </div>
            </div>
            {readbackSession && (
              <Panel title="回读工作包路径">
                <div className="delivery-meta-grid">
                  <div>
                    <span>工作包目录</span>
                    <strong>{readbackSession.sessionDir || '-'}</strong>
                  </div>
                  <div>
                    <span>待填写文件</span>
                    <strong>{readbackSession.sessionInputPath || '-'}</strong>
                  </div>
                  <div>
                    <span>填写说明</span>
                    <strong>{readbackSession.sessionInputGuidePath || '-'}</strong>
                  </div>
                  <div>
                    <span>操作清单</span>
                    <strong>{readbackSession.checklistPath || '-'}</strong>
                  </div>
                  <div>
                    <span>广告后台定位单</span>
                    <strong>{readbackSession.locatorGuidePath || '-'}</strong>
                  </div>
                  <div>
                    <span>最终证据输出</span>
                    <strong>{readbackSession.passEvidencePath || '-'}</strong>
                  </div>
                </div>
              </Panel>
            )}
            {readbackSession?.sessionDir && (
              <div className="delivery-action-row">
                {renderOpenPathButton({ idleLabel: '打开回读工作包', targetPath: readbackSession.sessionDir || '' })}
                {renderOpenPathButton({ idleLabel: '打开操作清单', targetPath: readbackSession.checklistPath || '' })}
                {renderOpenPathButton({ idleLabel: '打开广告后台定位单', targetPath: readbackSession.locatorGuidePath || '' })}
                {renderOpenPathButton({ idleLabel: '打开待填写文件', targetPath: readbackSession.sessionInputPath || '' })}
                {renderOpenPathButton({ idleLabel: '打开填写说明', targetPath: readbackSession.sessionInputGuidePath || '' })}
                <button aria-busy={verifyReadbackSessionButton.ariaBusy} className={verifyReadbackSessionButton.className} disabled={verifyReadbackSessionButton.disabled} onClick={verifyReadbackWorkPackage} type="button">
                  {verifyReadbackSessionButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{verifyReadbackSessionButton.label}</span>
                </button>
                <button aria-busy={fillReadbackSessionButton.ariaBusy} className={fillReadbackSessionButton.className} disabled={fillReadbackSessionButton.disabled} onClick={fillReadbackWorkPackage} type="button">
                  {fillReadbackSessionButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{fillReadbackSessionButton.label}</span>
                </button>
                <button aria-busy={verifyReadbackEvidenceButton.ariaBusy} className={verifyReadbackEvidenceButton.className} disabled={verifyReadbackEvidenceButton.disabled} onClick={verifyGeneratedReadbackEvidence} type="button">
                  {verifyReadbackEvidenceButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{verifyReadbackEvidenceButton.label}</span>
                </button>
                <button aria-busy={refreshWithReadbackButton.ariaBusy} className={refreshWithReadbackButton.className} disabled={refreshWithReadbackButton.disabled} onClick={refreshFinalReadinessWithReadback} type="button">
                  {refreshWithReadbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                  <span>{refreshWithReadbackButton.label}</span>
                </button>
              </div>
            )}
            {readbackSessionCheck && (
              <div className={`readback-session-check ${readbackSessionStatusCopy(readbackSessionCheck).className}`}>
                <strong>工作包检查：{readbackSessionStatusCopy(readbackSessionCheck).title}</strong>
                <span>{readbackSessionStatusCopy(readbackSessionCheck).detail}</span>
                {readbackSessionCheck.ready && !readbackSessionCheck.captureReady && (
                  <p className="muted-line">这只证明目录、清单、定位单和输出路径可用；最终仍必须填写现场审批、执行前/执行后、执行和回读字段。</p>
                )}
              </div>
            )}
            {readbackSessionFill && (
              <div className={`readback-session-check ${readbackSessionFill.readyForVerifier ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                <strong>回读证据生成：{readbackSessionFill.readyForVerifier ? '可校验' : '未通过'}</strong>
                <span>{readbackSessionFill.readyForVerifier ? (readbackSessionFill.jsonPath || '-') : (readbackSessionFill.issues || []).slice(0, 3).join('；')}</span>
              </div>
            )}
            {readbackEvidenceVerify && (
              <div className={`readback-session-check ${(readbackEvidenceVerify.ok || readbackEvidenceVerify.verified || readbackEvidenceVerify.ready || readbackEvidenceVerify.status === 'PASS') ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                <strong>回读证据校验：{(readbackEvidenceVerify.ok || readbackEvidenceVerify.verified || readbackEvidenceVerify.ready || readbackEvidenceVerify.status === 'PASS') ? '通过' : '未通过'}</strong>
                <span>{(readbackEvidenceVerify.issues || readbackEvidenceVerify.blockers || []).slice(0, 3).join('；') || '校验结果已返回。'}</span>
              </div>
            )}
          </ProgressiveDetails>
        )}

        <ProgressiveDetails title={`业务闭环矩阵：已闭合 ${deliveryMatrix.readyCount}/${deliveryMatrix.totalCount}`}>
          <div className="delivery-readiness-row">
            <div>
              <StatusPill tone={deliveryMatrix.status === 'ready' ? 'ready' : deliveryMatrix.status === 'blocked' ? 'blocked' : 'warning'}>
                {deliveryMatrix.status === 'ready' ? '证据闭环' : deliveryMatrix.status === 'blocked' ? '当前范围阻断' : '仍需补齐'}
              </StatusPill>
              <p className="delivery-readiness-copy">{deliveryMatrix.headline}</p>
              <p className="muted-line">矩阵只说明当前日期、店铺、站点和批次的业务环节；最终是否可交付仍以最终验收汇总为准。</p>
            </div>
            <div className="delivery-action-row">
              <button className="primary-button" onClick={() => navigate(deliveryMatrix.status === 'blocked' ? 'data-collection' : 'delivery')} type="button">
                {deliveryMatrix.primaryNextAction}
              </button>
            </div>
          </div>
          <div className="context-summary-grid">
            {deliveryMatrix.items.map((item) => (
              <button className="context-action-card" key={item.key} onClick={() => navigate(item.route)} type="button">
                <span>{item.label}</span>
                <strong>{item.statusLabel}</strong>
                <p>{item.detail}</p>
                <StatusPill tone={item.tone}>{item.nextAction}</StatusPill>
              </button>
            ))}
          </div>
        </ProgressiveDetails>

        {dataReconciliation && (
          <ProgressiveDetails title="数据口径导出结果">
            <div className="delivery-meta-grid">
              <div>
                <span>权威口径</span>
                <strong>{reconciliationSourceLabel(dataReconciliation.canonicalSource)}</strong>
              </div>
              <div>
                <span>DB 汇总</span>
                <strong>
                  {dataReconciliation.canonical?.rows ?? 0} 行 / {Number(dataReconciliation.canonical?.spend || 0).toFixed(2)} USD / {dataReconciliation.canonical?.orders ?? 0} 单
                </strong>
              </div>
              <div>
                <span>报告数据文件</span>
                <strong>{dataReconciliation.jsonPath || '-'}</strong>
              </div>
              <div>
                <span>报告说明文件</span>
                <strong>{dataReconciliation.markdownPath || '-'}</strong>
              </div>
            </div>
            {Boolean(dataReconciliation.blockers?.length) && (
              <ul className="delivery-action-list">
                {dataReconciliation.blockers?.slice(0, 6).map((item) => (
                  <li key={item}>{deliveryTextForDisplay(item)}</li>
                ))}
              </ul>
            )}
            <div className="delivery-action-row">
              {renderOpenPathButton({ disabled: !dataReconciliation.markdownPath, idleLabel: '打开说明文件', messageLabel: '打开数据口径核对说明文件', targetPath: dataReconciliation.markdownPath || '' })}
              {renderOpenPathButton({ disabled: !dataReconciliation.jsonPath, idleLabel: '打开数据文件', messageLabel: '打开数据口径核对数据文件', targetPath: dataReconciliation.jsonPath || '' })}
            </div>
          </ProgressiveDetails>
        )}

        <ProgressiveDetails title="最终证据清单">
          <p className="muted-line">这里列出最终验收汇总采用的证据文件。当前范围的数据卡片只说明本地数据状态，不能替代这些验收项。</p>
          {readiness?.gates?.length ? (
            <div className="delivery-gate-list">
              {readiness.gates.map((gate) => (
                <div className="delivery-gate-row" key={`${gate.name}-${gate.evidencePath || 'missing'}`}>
                  <div>
                    <strong>{gate.name}</strong>
                    <span>{gateMessageForDisplay(gate, Boolean(manifestReady))}</span>
                  </div>
                  <StatusPill tone={gate.ok ? 'ready' : 'blocked'}>{gateStatusLabel(gate)}</StatusPill>
                  <code>{gate.evidencePath || '未绑定证据路径'}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="blocked-line">尚未读取到最终验收项。需要先生成最终验收汇总。</p>
          )}
        </ProgressiveDetails>

        <ProgressiveDetails title="完整业务证据项">
          <div className="delivery-section-grid">
            {items.map((item) => (
              <Panel key={item.title} title={item.title} tone={item.tone === 'ready' ? 'success' : item.tone === 'blocked' ? 'blocked' : item.tone === 'warning' ? 'warning' : 'default'}>
                <div className="delivery-card-header">
                  <StatusPill tone={item.tone}>{statusLabel(item.tone)}</StatusPill>
                </div>
                <p>{item.summary}</p>
                <ul className="delivery-action-list">
                  {item.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
                {item.evidence && item.evidence.length > 0 && (
                  <div className="delivery-evidence-list">
                    {item.evidence.map((entry) => (
                      <span key={entry}>{entry}</span>
                    ))}
                  </div>
                )}
              </Panel>
            ))}
          </div>
        </ProgressiveDetails>

        <ProgressiveDetails title="技术支持细节">
          <div className="details-content">
            <p>数据管道生成时间：{data?.generatedAt || (loading ? '读取中...' : '不可用')}</p>
            <p>最终验收生成时间：{readiness?.generatedAt || '不可用'}</p>
            <p>最终验收检查时间：{readiness?.checkedAt || '不可用'}</p>
            <p>验收项汇总：{readiness?.gatesSummary ? `${readiness.gatesSummary.passed}/${readiness.gatesSummary.total} 通过` : '不可用'}</p>
            <p>证据目录工件：{reportDownloadLabel}</p>
            <p>采集清单工件：{collectionManifestLabel}</p>
            <p>交付包目标：{DELIVERY_BUNDLE_PATH}</p>
          </div>
        </ProgressiveDetails>

        {message && <Panel title="交付消息">{message}</Panel>}
      </div>
    </div>
  );
}
