import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { StatusPill } from '../components/ui';
import {
  PageFrame,
  ResponsiveInspector,
  TaskBanner,
  WorkbenchPanel,
} from '../components/workspace';
import {
  parseReadbackRepairIntent,
  READBACK_REPAIR_INTENT_EVENT,
  READBACK_REPAIR_INTENT_STORAGE_KEY,
  readbackRepairIntentMessage,
  readbackRepairIntentStep,
  readbackRepairPanelClass,
  type ReadbackRepairIntent,
} from '../readback-repair-intent';
import { firstIncompleteReadbackStep, readbackWizardSteps, type ReadbackWizardStepId } from '../readback-wizard';
import {
  buildReadbackQueryKey,
  canPublishReadbackResult,
  readbackAuthorityForMode,
  readbackGlobalBusyView,
  readbackRepairBlockersForMissing,
  readbackRepairActions,
  resolveReadbackScreenshotRepairAction,
  resolveReadbackExportRoute,
  runCurrentReadbackFinalVerification,
  runReadbackFinalVerificationWorkflow,
  type ReadbackAuthority,
  type ReadbackRepairAction,
  type ReadbackRequestSnapshot,
  type ReadbackWorkspaceActionKey,
} from './readback-workspace-model';
import type { RecommendationView } from '../types';
import { toReadbackUserFacingError } from '../user-facing-error';
import { notifyWorkflowInvalidated } from '../workflow-invalidation';
import type { WorkflowEventTarget } from '../workflow-invalidation';

type AiThresholdSuggestions = NonNullable<NonNullable<RecommendationView['evidence']>['aiThresholdSuggestions']>;

export function readbackVerifierPassed(value: unknown): boolean {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return result.ready === true && result.status === 'PASS';
}

export async function runReadbackWorkflowMutation<T>(
  action: 'create' | 'verify',
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
  shouldPublish: () => boolean = () => true,
): Promise<T> {
  const result = await task();
  if (!shouldPublish()) return result;
  if (action === 'create') notifyWorkflowInvalidated('readback-created', target);
  if (action === 'verify' && readbackVerifierPassed(result)) {
    notifyWorkflowInvalidated('readback-verified', target);
  }
  return result;
}
export type ReadbackCaptureSlot = 'approval' | 'before' | 'after' | 'readback';
export type ReadbackContractStatus = 'ready' | 'pending' | 'blocked';
export interface ReadbackContractCheck {
  key: 'time-order' | 'value-change' | 'readback-match' | 'lower-bid-direction' | 'evidence-distinct';
  title: string;
  status: ReadbackContractStatus;
  detail: string;
}

export function readbackStepTabId(stepId: ReadbackWizardStepId): string {
  return `readback-step-tab-${stepId}`;
}

export function readbackStepPanelId(stepId: ReadbackWizardStepId): string {
  return `readback-step-panel-${stepId}`;
}

export function readbackStepPanelProps(stepId: ReadbackWizardStepId) {
  return {
    'aria-labelledby': readbackStepTabId(stepId),
    className: 'readback-step-panel',
    id: readbackStepPanelId(stepId),
    role: 'tabpanel' as const,
    tabIndex: 0,
  };
}

export function readbackStepTabTitle(title: string): string {
  return title.replace(/^\d+\.\s*/, '');
}

export function readbackStepFromKeyboard(currentStepId: ReadbackWizardStepId, key: string): ReadbackWizardStepId | null {
  const stepIds = readbackWizardSteps.map((step) => step.id);
  const currentIndex = stepIds.indexOf(currentStepId);
  if (currentIndex < 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return stepIds[(currentIndex + 1) % stepIds.length];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return stepIds[(currentIndex - 1 + stepIds.length) % stepIds.length];
  if (key === 'Home') return stepIds[0];
  if (key === 'End') return stepIds[stepIds.length - 1];
  return null;
}

export type ReadbackActionKey =
  | 'export-evidence'
  | 'fill-session'
  | 'prepare-session'
  | 'verify-evidence'
  | 'verify-session';

export type ReadbackCopyCommandKey = 'fill' | 'long-fill' | 'prepare' | 'verify';

interface ReadbackActionButtonInput {
  action: ReadbackActionKey;
  activeAction: ReadbackActionKey | null;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  label: string;
}

export interface ReadbackActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function readbackActionButtonView(input: ReadbackActionButtonInput): ReadbackActionButtonView {
  const active = input.activeAction === input.action;
  return {
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activeAction),
    label: active ? input.busyLabel : input.label,
    showSpinner: active,
  };
}

interface ReadbackCopyCommandButtonInput {
  activeCommand: ReadbackCopyCommandKey | null;
  command: ReadbackCopyCommandKey;
  disabled?: boolean;
  label: string;
}

export function readbackCopyCommandButtonView(input: ReadbackCopyCommandButtonInput): ReadbackActionButtonView {
  const active = input.activeCommand === input.command;
  return {
    ariaBusy: active ? true : undefined,
    className: ['secondary-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activeCommand),
    label: active ? '复制中...' : input.label,
    showSpinner: active,
  };
}

export function readbackPathActionKey(label: string, targetPath?: string): string {
  return targetPath ? `${label}:${targetPath}` : '';
}

export function readbackOpenPathButtonView(input: {
  activePathKey: string | null;
  baseClassName?: string;
  disabled?: boolean;
  idleLabel: string;
  pathKey: string;
}): ReadbackActionButtonView {
  const active = Boolean(input.activePathKey && input.activePathKey === input.pathKey);
  return {
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName || 'secondary-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activePathKey || !input.pathKey),
    label: active ? '打开中...' : input.idleLabel,
    showSpinner: active,
  };
}

function readbackActionBusyLabel(action: ReadbackActionKey): string {
  const labels: Record<ReadbackActionKey, string> = {
    'export-evidence': '导出中...',
    'fill-session': '生成中...',
    'prepare-session': '创建中...',
    'verify-evidence': '校验中...',
    'verify-session': '检查中...',
  };
  return labels[action];
}

function readbackActionButtonContent(view: ReadbackActionButtonView) {
  if (!view.showSpinner) return view.label;
  return (
    <span className="button-content">
      <span aria-hidden="true" className="button-spinner" />
      <span>{view.label}</span>
    </span>
  );
}

function ReadbackFieldCell({
  children,
  className = '',
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={['readback-field-cell', className].filter(Boolean).join(' ')}>
      <span className="readback-field-cell-label">{label}</span>
      {children}
    </label>
  );
}

const CAPTURE_SLOT_LABELS: Record<ReadbackCaptureSlot, { title: string; detail: string }> = {
  approval: { title: '审批凭证', detail: '粘贴审批截图、工单或聊天凭证' },
  before: { title: '执行前截图', detail: '粘贴修改前 Ads UI 行截图' },
  after: { title: '执行后截图', detail: '粘贴修改完成后的 Ads UI 行截图' },
  readback: { title: '回读截图', detail: '粘贴刷新/重新打开后的回读截图' },
};

function formatCaptureMissing(sessionCheck: Record<string, any>): string {
  const missingFields = sessionCheck.captureMissingFields;
  if (Array.isArray(missingFields) && missingFields.length > 0) {
    return missingFields
      .slice(0, 8)
      .map((item) => [item.group, captureFieldLabelForDisplay(item.label || item.field)].filter(Boolean).join('/'))
      .filter(Boolean)
      .join('、');
  }
  return Array.isArray(sessionCheck.unresolvedFields)
    ? sessionCheck.unresolvedFields.slice(0, 8).map(captureFieldLabelForDisplay).join('、')
    : '';
}

function captureFieldLabelForDisplay(value: unknown): string {
  return String(value || '')
    .replace(/执行前\s*Ads UI live bid/gi, '现场出价')
    .replace(/执行后\s*Ads UI live bid/gi, '现场出价')
    .replace(/Ads UI live bid/gi, '现场出价')
    .replace(/session-input\.json/gi, '填写文件')
    .replace(/\breadback\b/gi, '回读');
}

export function sessionCheckCopy(sessionCheck: Record<string, any> | null): { className: string; title: string; detail: string } {
  if (!sessionCheck) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包尚未检查',
      detail: '请先创建回读工作包。',
    };
  }
  if (!sessionCheck.ready) {
    return {
      className: 'readback-session-check-blocked',
      title: '工作包结构检查未通过',
      detail: '先修复目录、清单、定位单或输出路径问题，再进行真实广告后台采集。',
    };
  }
  if (!sessionCheck.captureReady) {
    const missing = formatCaptureMissing(sessionCheck);
    return {
      className: 'readback-session-check-blocked',
      title: '工作包结构通过，现场证据待填写',
      detail: missing ? `还需填写：${missing}` : '填写文件尚未完成现场审批、执行前、执行后、执行和回读字段。',
    };
  }
  return {
    className: 'readback-session-check-ready',
    title: '工作包结构和现场证据均已通过',
    detail: '可以生成回读证据；最终可交付仍以本地校验和最终验收汇总为准。',
  };
}

export interface ReadbackFormState {
  recommendationId: string;
  recommendationRevision: number;
  storeName: string;
  marketplaceCode: string;
  portfolioName: string;
  asin: string;
  campaignName: string;
  adGroupName: string;
  entityType: string;
  entityName: string;
  actionType: string;
  currentValue: string;
  recommendedValue: string;
  sourceBatchId: string;
  sourceMetricDate: string;
  sourceRow: string;
  sourceFiles: string;
  sourceExplanationSource: string;
  sourceAiModel: string;
  decisionAgreement: string;
  decisionSource: string;
  decisionReasons: string[];
  decisionRiskWarnings: string[];
  aiStrategySource: string;
  aiLifecycleStage: string;
  aiStrategySummary: string;
  aiStrategyFallbackReason: string;
  aiActionFallbackReason: string;
  aiMainProblems: string[];
  aiThresholdSuggestions: AiThresholdSuggestions;
  aiStrategyRiskWarnings: string[];
  quantStatus: string;
  quantLifecycleStage: string;
  quantReasons: string[];
  quantThresholds: Record<string, number>;
  quantReviewRequired: boolean;
  operationEventCount: number;
  productContextCount: number;
  productStage: string;
  productTargetAcos: string;
  productTargetTacos: string;
  productTargetNetMargin: string;
  productMinPrice: string;
  approverName: string;
  approvalNote: string;
  approvalArtifactPath: string;
  approvalConfirmedAt: string;
  executedBy: string;
  executionId: string;
  executionExecutedAt: string;
  beforeValue: string;
  beforeCapturedAt: string;
  beforeScreenshotPath: string;
  afterValue: string;
  afterCapturedAt: string;
  afterScreenshotPath: string;
  readbackActualValue: string;
  readbackReadAt: string;
  readbackEvidencePath: string;
  liveBidSourceNote: string;
  riskRationale: string;
  operatorConfirmed: boolean;
  realWriteApproved: boolean;
  allowedByPolicy: boolean;
  executionSuccess: boolean;
  executionVerified: boolean;
  readbackVerified: boolean;
}

export const EMPTY_FORM: ReadbackFormState = {
  recommendationId: '',
  recommendationRevision: 0,
  storeName: '',
  marketplaceCode: '',
  portfolioName: '',
  asin: '',
  campaignName: '',
  adGroupName: '',
  entityType: 'target',
  entityName: '',
  actionType: 'lower_bid',
  currentValue: '',
  recommendedValue: '',
  sourceBatchId: '',
  sourceMetricDate: '',
  sourceRow: '',
  sourceFiles: '',
  sourceExplanationSource: '',
  sourceAiModel: '',
  decisionAgreement: '',
  decisionSource: '',
  decisionReasons: [],
  decisionRiskWarnings: [],
  aiStrategySource: '',
  aiLifecycleStage: '',
  aiStrategySummary: '',
  aiStrategyFallbackReason: '',
  aiActionFallbackReason: '',
  aiMainProblems: [],
  aiThresholdSuggestions: {},
  aiStrategyRiskWarnings: [],
  quantStatus: '',
  quantLifecycleStage: '',
  quantReasons: [],
  quantThresholds: {},
  quantReviewRequired: false,
  operationEventCount: 0,
  productContextCount: 0,
  productStage: '',
  productTargetAcos: '',
  productTargetTacos: '',
  productTargetNetMargin: '',
  productMinPrice: '',
  approverName: '',
  approvalNote: '',
  approvalArtifactPath: '',
  approvalConfirmedAt: '',
  executedBy: '',
  executionId: '',
  executionExecutedAt: '',
  beforeValue: '',
  beforeCapturedAt: '',
  beforeScreenshotPath: '',
  afterValue: '',
  afterCapturedAt: '',
  afterScreenshotPath: '',
  readbackActualValue: '',
  readbackReadAt: '',
  readbackEvidencePath: '',
  liveBidSourceNote: '',
  riskRationale: '低风险动作；不增加预算、不提高出价、不创建活动、不扩大流量。',
  operatorConfirmed: false,
  realWriteApproved: false,
  allowedByPolicy: false,
  executionSuccess: false,
  executionVerified: false,
  readbackVerified: false,
};

export function decisionAgreementLabel(value?: string): string {
  const labels: Record<string, string> = {
    aligned: '规则+AI 一致',
    rule_only: '规则独立建议',
    ai_only: 'AI 独立洞察',
    conflict: '规则/AI 冲突',
  };
  return labels[String(value || '').trim()] || String(value || '-');
}

export function decisionSourceLabel(value?: string): string {
  const labels: Record<string, string> = {
    rule_ai: '规则+AI 合并',
    rule: '规则',
    ai: 'AI',
  };
  return labels[String(value || '').trim()] || String(value || '-');
}

function readbackErrorMessage(caught: unknown, fallback: string): string {
  console.error('[readback-workspace]', fallback, caught);
  return toReadbackUserFacingError(caught, fallback);
}

export function captureSlotPatch(slot: ReadbackCaptureSlot, filePath: string, savedAt: string): Partial<ReadbackFormState> {
  if (slot === 'approval') {
    return { approvalArtifactPath: filePath, approvalConfirmedAt: savedAt };
  }
  if (slot === 'before') {
    return { beforeScreenshotPath: filePath, beforeCapturedAt: savedAt };
  }
  if (slot === 'after') {
    return { afterScreenshotPath: filePath, afterCapturedAt: savedAt };
  }
  return { readbackEvidencePath: filePath, readbackReadAt: savedAt };
}

export function nextEvidenceCaptureSlot(form: ReadbackFormState): Exclude<ReadbackCaptureSlot, 'approval'> {
  if (!form.beforeScreenshotPath.trim()) return 'before';
  if (!form.afterScreenshotPath.trim()) return 'after';
  return 'readback';
}

function captureFileList(source?: DataTransfer | null): File[] {
  if (!source) return [];
  const files = Array.from(source.files || []);
  const itemFiles = Array.from(source.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((item): item is File => Boolean(item));
  return [...files, ...itemFiles].filter((file, index, all) =>
    all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index);
}

function firstImageFile(files: File[]): File | null {
  return files.find((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)) || null;
}

function captureFileName(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || '截图文件';
}

function captureFileExtension(value: string): string {
  const fileName = captureFileName(value);
  const match = fileName.match(/\.([a-z0-9]+)$/i);
  return (match?.[1] || 'IMG').toUpperCase().slice(0, 4);
}

export function readbackCaptureTargetView(
  slot: ReadbackCaptureSlot,
  input: { value?: string; saving?: boolean; dragging?: boolean; previewUrl?: string } = {},
) {
  const copy = CAPTURE_SLOT_LABELS[slot];
  const className = [
    'readback-capture-target',
    input.value ? 'readback-capture-filled' : '',
    input.saving ? 'readback-capture-saving' : '',
    input.dragging && !input.saving ? 'readback-capture-dragging' : '',
  ].filter(Boolean).join(' ');
  if (input.saving) {
    return {
      className,
      title: '正在存证...',
      detail: copy.detail,
      helper: '正在写入本地证据目录...',
    };
  }
  if (input.dragging) {
    return {
      className,
      title: '松开即可存证',
      detail: copy.detail,
      helper: '已识别拖入截图，松开鼠标后写入本地证据目录。',
    };
  }
  if (input.value) {
    return {
      className,
      title: `${copy.title}已安全固定`,
      detail: copy.detail,
      helper: input.value,
      preview: {
        alt: `${copy.title}缩略预览`,
        badge: '证据已安全固定',
        extension: captureFileExtension(input.value),
        fileName: captureFileName(input.value),
        path: input.value,
        src: input.previewUrl,
      },
    };
  }
  return {
    className,
    title: copy.title,
    detail: copy.detail,
    helper: '点击此区域后 Ctrl+V，或拖入图片文件',
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取截图失败'));
    reader.readAsDataURL(file);
  });
}

function objectName(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '';
}

export function formFromRecommendation(rec: RecommendationView, scope: { storeName: string; marketplaceCode: string }, batchId?: string): ReadbackFormState {
  const evidence = rec.evidence || {};
  const approvalSourceRow = evidence.approvalDecision?.sourceRow;
  const sourceRow = approvalSourceRow != null ? approvalSourceRow : evidence.sourceRow;
  return {
    ...EMPTY_FORM,
    recommendationId: String(rec.id),
    recommendationRevision: rec.revision,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    portfolioName: evidence.portfolioName || '',
    asin: evidence.asin || '',
    campaignName: evidence.campaignName || '',
    adGroupName: evidence.adGroupName || '',
    entityType: rec.entityType || evidence.matchType || '',
    entityName: objectName(rec),
    actionType: rec.actionType,
    currentValue: rec.currentValue || '',
    recommendedValue: rec.recommendedValue || '',
    sourceBatchId: evidence.approvalDecision?.sourceBatchId || evidence.approvalDecision?.batchId || evidence.batchId || batchId || '',
    sourceMetricDate: evidence.date || '',
    sourceRow: sourceRow != null ? String(sourceRow) : '',
    sourceFiles: (evidence.sourceFiles || []).join('\n'),
    sourceExplanationSource: evidence.explanationSource || '',
    sourceAiModel: evidence.aiModel || '',
    decisionAgreement: evidence.decisionAgreement || '',
    decisionSource: evidence.decisionSource || '',
    decisionReasons: evidence.decisionReasons || [],
    decisionRiskWarnings: evidence.decisionRiskWarnings || [],
    aiStrategySource: evidence.aiStrategySource || '',
    aiLifecycleStage: evidence.aiLifecycleStage || '',
    aiStrategySummary: evidence.aiStrategySummary || '',
    aiStrategyFallbackReason: evidence.aiStrategyFallbackReason || '',
    aiActionFallbackReason: evidence.aiActionFallbackReason || '',
    aiMainProblems: evidence.aiMainProblems || [],
    aiThresholdSuggestions: evidence.aiThresholdSuggestions || {},
    aiStrategyRiskWarnings: evidence.aiStrategyRiskWarnings || [],
    quantStatus: evidence.quantStatus || '',
    quantLifecycleStage: evidence.quantLifecycleStage || '',
    quantReasons: evidence.quantReasons || [],
    quantThresholds: evidence.quantThresholds || {},
    quantReviewRequired: evidence.quantReviewRequired === true,
    operationEventCount: evidence.operationEventCount || 0,
    productContextCount: evidence.productContextCount || 0,
    productStage: evidence.productStage || '',
    productTargetAcos: evidence.productTargetAcos != null ? String(evidence.productTargetAcos) : '',
    productTargetTacos: evidence.productTargetTacos != null ? String(evidence.productTargetTacos) : '',
    productTargetNetMargin: evidence.productTargetNetMargin != null ? String(evidence.productTargetNetMargin) : '',
    productMinPrice: evidence.productMinPrice != null ? String(evidence.productMinPrice) : '',
    approverName: evidence.approvalDecision?.approvedBy || '',
    approvalNote: evidence.approvalDecision?.note || '',
    approvalConfirmedAt: evidence.approvalDecision?.decidedAt || '',
  };
}

function executableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || /[%％]/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/^\$/, '').replace(/\s*usd$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function valuesMatch(left: string, right: string): boolean {
  const leftNumber = executableNumber(left);
  const rightNumber = executableNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return Math.abs(leftNumber - rightNumber) < 0.0001;
  }
  return left.trim() === right.trim();
}

function normalizePathForCompare(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

function sourceFileLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function isSpreadsheetReportPath(value: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(value.trim().split(/[?#]/)[0]);
}

export function requiredMissing(form: ReadbackFormState, currentBatchId?: string): string[] {
  const missing: string[] = [];
  const requireText = (value: string, label: string) => {
    if (!value.trim()) missing.push(label);
  };
  const requirePositiveNumber = (value: string, label: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) missing.push(label);
  };
  const requireFlag = (ok: boolean, label: string) => {
    if (!ok) missing.push(label);
  };
  requireText(form.storeName, '店铺');
  requireText(form.marketplaceCode, '站点');
  requireText(form.asin, 'ASIN');
  requireText(form.campaignName, '广告活动');
  requireText(form.adGroupName, '广告组');
  requireText(form.entityType, '对象类型');
  requireText(form.entityName, '对象名称');
  requireText(form.actionType, '动作类型');
  requireText(form.currentValue, '来源当前值');
  requireText(form.recommendedValue, '来源建议值');
  requireText(form.sourceBatchId, '来源批次');
  requireText(form.sourceMetricDate, '指标日期');
  requirePositiveNumber(form.sourceRow, '来源行号');
  requireText(form.sourceFiles, '推荐来源文件');
  const sourceFiles = sourceFileLines(form.sourceFiles);
  if (sourceFiles.length === 1 && !isSpreadsheetReportPath(sourceFiles[0])) {
    missing.push('推荐来源文件必须是真实报表');
  } else if (sourceFiles.length > 1 && !sourceFiles.every(isSpreadsheetReportPath)) {
    missing.push('推荐来源文件必须全部是真实报表');
  }
  requireText(form.approverName, '审批人');
  requireText(form.approvalArtifactPath, '审批凭证');
  requireText(form.approvalConfirmedAt, '审批时间');
  requireText(form.executedBy, '执行人');
  requireText(form.executionId, '执行编号');
  requireText(form.executionExecutedAt, '执行时间');
  requireText(form.beforeValue, '执行前值');
  requireText(form.beforeCapturedAt, '执行前时间');
  requireText(form.afterValue, '执行后值');
  requireText(form.afterCapturedAt, '执行后时间');
  requireText(form.readbackActualValue, '回读值');
  requireText(form.readbackReadAt, '回读时间');
  requireText(form.beforeScreenshotPath, '执行前截图');
  requireText(form.afterScreenshotPath, '执行后截图');
  requireText(form.readbackEvidencePath, '回读证据');
  requireText(form.liveBidSourceNote, '现场行证明');
  requireFlag(form.operatorConfirmed, '审批人确认范围');
  requireFlag(form.realWriteApproved, '外部审批允许');
  requireFlag(form.allowedByPolicy, '低风险策略允许');
  requireFlag(form.executionSuccess, '执行成功确认');
  requireFlag(form.executionVerified, '执行核验');
  requireFlag(form.readbackVerified, '回读核验');
  if (form.beforeValue && form.afterValue && valuesMatch(form.beforeValue, form.afterValue)) missing.push('执行前值和执行后值不能相同');
  if (form.afterValue && form.readbackActualValue && !valuesMatch(form.afterValue, form.readbackActualValue)) missing.push('回读值必须等于执行后值');
  if (form.actionType === 'lower_bid' && form.beforeValue && form.afterValue) {
    const beforeNumber = executableNumber(form.beforeValue);
    const afterNumber = executableNumber(form.afterValue);
    if (beforeNumber === null || afterNumber === null || afterNumber >= beforeNumber) {
      missing.push('降价动作必须证明执行后值低于执行前值');
    }
  }
  const evidencePaths = [form.beforeScreenshotPath, form.afterScreenshotPath, form.readbackEvidencePath]
    .filter((value) => value.trim())
    .map(normalizePathForCompare);
  if (evidencePaths.length === 3 && new Set(evidencePaths).size !== 3) {
    missing.push('执行前、执行后和回读证据文件不能复用');
  }
  const timestamps = [
    ['审批时间', form.approvalConfirmedAt],
    ['执行前时间', form.beforeCapturedAt],
    ['执行时间', form.executionExecutedAt],
    ['执行后时间', form.afterCapturedAt],
    ['回读时间', form.readbackReadAt],
  ] as const;
  const parsedTimestamps = timestamps.map(([label, value]) => ({ label, value, ms: Date.parse(value) }));
  for (const item of parsedTimestamps) {
    if (item.value.trim() && Number.isNaN(item.ms)) missing.push(`${item.label}不是可解析时间`);
  }
  if (parsedTimestamps.every((item) => item.value.trim() && Number.isFinite(item.ms))) {
    for (let index = 1; index < parsedTimestamps.length; index += 1) {
      if (parsedTimestamps[index].ms < parsedTimestamps[index - 1].ms) {
        missing.push('时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读');
        break;
      }
    }
  }
  if (currentBatchId && form.sourceBatchId.trim() && form.sourceBatchId.trim() !== currentBatchId) {
    missing.push('来源批次必须等于当前批次');
  }
  return missing;
}

export function groupMissing(items: string[]) {
  const target = ['店铺', '站点', 'ASIN', '广告活动', '广告组', '对象类型', '对象名称', '动作类型'];
  const source = ['来源当前值', '来源建议值', '来源批次', '指标日期', '来源行号', '推荐来源文件', '推荐来源文件必须是真实报表', '推荐来源文件必须全部是真实报表', '来源批次必须等于当前批次'];
  const proof = ['审批人', '审批凭证', '审批时间', '执行人', '执行编号', '执行时间', '执行前值', '执行前时间', '执行后值', '执行后时间', '回读值', '回读时间', '执行前截图', '执行后截图', '回读证据', '现场行证明', '降价动作必须证明执行后值低于执行前值', '执行前、执行后和回读证据文件不能复用'];
  const confirmation = ['审批人确认范围', '外部审批允许', '低风险策略允许', '执行成功确认', '执行核验', '回读核验', '执行前值和执行后值不能相同', '回读值必须等于执行后值', '审批时间不是可解析时间', '执行前时间不是可解析时间', '执行时间不是可解析时间', '执行后时间不是可解析时间', '回读时间不是可解析时间', '时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读'];
  return [
    { title: '执行对象', items: items.filter((item) => target.includes(item)) },
    { title: '建议来源', items: items.filter((item) => source.includes(item)) },
    { title: '证据文件和值', items: items.filter((item) => proof.includes(item)) },
    { title: '审批与核验', items: items.filter((item) => confirmation.includes(item)) },
  ].filter((group) => group.items.length > 0);
}

export function readbackPrecheckCopy(missing: string[]) {
  if (missing.length) {
    return {
      statusLabel: `未满足 ${missing.length} 项`,
      chipLabel: '',
      exportButtonLabel: '导出缺口草稿',
      helperText: '缺项状态下只能导出本地草稿，方便定位缺口；不能作为最终执行完成证据。',
    };
  }
  return {
    statusLabel: '字段已填写，待导出校验',
    chipLabel: '执行前、执行后和回读值已填写；导出时会校验本地文件存在。',
      exportButtonLabel: '导出回读证据',
      helperText: '字段已填写时仍需导出证据文件和说明文件，并由后端校验截图、真实报表和回读证据文件是否存在。',
  };
}

export function readbackContractChecks(form: ReadbackFormState): ReadbackContractCheck[] {
  const timeFields = [
    { label: '审批时间', value: form.approvalConfirmedAt },
    { label: '执行前时间', value: form.beforeCapturedAt },
    { label: '执行动作时间', value: form.executionExecutedAt },
    { label: '执行后时间', value: form.afterCapturedAt },
    { label: '回读时间', value: form.readbackReadAt },
  ];
  const missingTimes = timeFields.filter((field) => !field.value.trim()).map((field) => field.label);
  const invalidTimes = timeFields
    .filter((field) => field.value.trim() && Number.isNaN(Date.parse(field.value)))
    .map((field) => field.label);
  let timeStatus: ReadbackContractStatus = 'ready';
  let timeDetail = '审批、执行前、执行动作、执行后和回读时间顺序已满足。';
  if (missingTimes.length > 0) {
    timeStatus = 'pending';
    timeDetail = `待填写：${missingTimes.join('、')}。`;
  } else if (invalidTimes.length > 0) {
    timeStatus = 'blocked';
    timeDetail = `${invalidTimes.join('、')}不是可解析 ISO 时间。`;
  } else {
    const parsed = timeFields.map((field) => ({ ...field, ms: Date.parse(field.value) }));
    const brokenIndex = parsed.findIndex((field, index) => index > 0 && field.ms < parsed[index - 1].ms);
    if (brokenIndex > 0) {
      timeStatus = 'blocked';
      timeDetail = `${parsed[brokenIndex - 1].label}晚于${parsed[brokenIndex].label}；必须满足审批≤执行前≤执行动作≤执行后≤回读。`;
    }
  }

  let valueChangeStatus: ReadbackContractStatus = 'ready';
  let valueChangeDetail = '执行前值和执行后值已变化，可证明现场发生了真实修改。';
  if (!form.beforeValue.trim() || !form.afterValue.trim()) {
    valueChangeStatus = 'pending';
    valueChangeDetail = '待填写执行前值和执行后值。';
  } else if (valuesMatch(form.beforeValue, form.afterValue)) {
    valueChangeStatus = 'blocked';
    valueChangeDetail = '执行前值和执行后值相同，不能证明真实修改。';
  }

  let readbackMatchStatus: ReadbackContractStatus = 'ready';
  let readbackMatchDetail = '回读值与执行后值一致。';
  if (!form.afterValue.trim() || !form.readbackActualValue.trim()) {
    readbackMatchStatus = 'pending';
    readbackMatchDetail = '待填写执行后值和真实 ERP 回读值。';
  } else if (!valuesMatch(form.afterValue, form.readbackActualValue)) {
    readbackMatchStatus = 'blocked';
    readbackMatchDetail = '真实 ERP 回读值必须等于执行后值。';
  }

  let directionStatus: ReadbackContractStatus = 'ready';
  let directionDetail = form.actionType === 'lower_bid'
    ? '降价动作已证明执行后值低于执行前值。'
    : '当前动作不适用降价方向校验；仍需满足值变化和回读一致。';
  if (form.actionType === 'lower_bid') {
    const beforeNumber = executableNumber(form.beforeValue);
    const afterNumber = executableNumber(form.afterValue);
    if (!form.beforeValue.trim() || !form.afterValue.trim()) {
      directionStatus = 'pending';
      directionDetail = '待填写执行前值和执行后值后校验降价方向。';
    } else if (beforeNumber === null || afterNumber === null) {
      directionStatus = 'blocked';
      directionDetail = '降价动作的执行前值和执行后值必须能解析为数字。';
    } else if (afterNumber >= beforeNumber) {
      directionStatus = 'blocked';
      directionDetail = '降价动作必须证明执行后值低于执行前值。';
    }
  }

  const evidenceFields = [
    { label: '执行前截图', value: form.beforeScreenshotPath },
    { label: '执行后截图', value: form.afterScreenshotPath },
    { label: '回读证据', value: form.readbackEvidencePath },
  ];
  const missingEvidence = evidenceFields.filter((field) => !field.value.trim()).map((field) => field.label);
  let evidenceStatus: ReadbackContractStatus = 'ready';
  let evidenceDetail = '执行前、执行后和回读证据路径互不复用。';
  if (missingEvidence.length > 0) {
    evidenceStatus = 'pending';
    evidenceDetail = `待补：${missingEvidence.join('、')}。`;
  } else {
    const normalized = evidenceFields.map((field) => normalizePathForCompare(field.value));
    if (new Set(normalized).size !== normalized.length) {
      evidenceStatus = 'blocked';
      evidenceDetail = '执行前、执行后和回读证据文件不能复用。';
    }
  }

  return [
    { key: 'time-order', title: '时间顺序', status: timeStatus, detail: timeDetail },
    { key: 'value-change', title: '前后值变化', status: valueChangeStatus, detail: valueChangeDetail },
    { key: 'readback-match', title: '回读值一致', status: readbackMatchStatus, detail: readbackMatchDetail },
    { key: 'lower-bid-direction', title: '动作方向', status: directionStatus, detail: directionDetail },
    { key: 'evidence-distinct', title: '截图不复用', status: evidenceStatus, detail: evidenceDetail },
  ];
}

function readbackContractStatusLabel(status: ReadbackContractStatus): string {
  if (status === 'ready') return '通过';
  if (status === 'blocked') return '阻断';
  return '待填写';
}

function ReadbackContractStrip({ checks }: { checks: ReadbackContractCheck[] }) {
  const blockedCount = checks.filter((check) => check.status === 'blocked').length;
  const pendingCount = checks.filter((check) => check.status === 'pending').length;
  const summary = blockedCount > 0
    ? `阻断 ${blockedCount} 项`
    : pendingCount > 0
      ? `待填写 ${pendingCount} 项`
      : '合同通过';

  return (
    <div className="readback-contract-panel" role="status" aria-live="polite">
      <div className="readback-contract-heading">
        <span>时间和值安全合同</span>
        <strong>{summary}</strong>
      </div>
      <div className="readback-contract-grid">
        {checks.map((check) => (
          <div className={`readback-contract-card readback-contract-${check.status}`} key={check.key}>
            <span>{readbackContractStatusLabel(check.status)}</span>
            <strong>{check.title}</strong>
            <small>{check.detail}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function readbackPreviewFormFromRecommendation(
  rec: RecommendationView,
  scope: { storeName: string; marketplaceCode: string },
  batchId: string | undefined,
  complete: boolean,
): ReadbackFormState {
  const base = formFromRecommendation(rec, scope, batchId);
  const approvalTime = base.approvalConfirmedAt || '2026-06-24T10:00:00.000Z';
  return {
    ...base,
    approverName: base.approverName || '预览审批人',
    approvalNote: base.approvalNote || '仅开发预览的只读审批记录。',
    approvalArtifactPath: 'D:/preview/readback/approval.png',
    approvalConfirmedAt: approvalTime,
    operatorConfirmed: true,
    realWriteApproved: true,
    allowedByPolicy: true,
    executedBy: '预览操作员',
    executionId: 'preview-manual-001',
    executionExecutedAt: '2026-06-24T10:05:00.000Z',
    beforeValue: rec.currentValue || '1.20',
    beforeCapturedAt: '2026-06-24T10:03:00.000Z',
    beforeScreenshotPath: complete ? 'D:/preview/readback/before.png' : '',
    afterValue: rec.recommendedValue || '1.08',
    afterCapturedAt: '2026-06-24T10:06:00.000Z',
    afterScreenshotPath: complete ? 'D:/preview/readback/after.png' : '',
    readbackActualValue: complete ? (rec.recommendedValue || '1.08') : '',
    readbackReadAt: '2026-06-24T10:10:00.000Z',
    readbackEvidencePath: complete ? 'D:/preview/readback/readback.png' : '',
    liveBidSourceNote: '仅开发预览的 Ads UI 行级回读说明。',
    riskRationale: rec.reason || '仅开发预览的受控低风险动作。',
    executionSuccess: true,
    executionVerified: true,
    readbackVerified: complete,
  };
}

function psQuote(value: string): string {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function defaultPassEvidencePath(sourcePath: string): string {
  if (!sourcePath.trim()) return 'output\\codex-evidence\\real-ad-execution-readback-pass.json';
  return sourcePath.replace(/\.json$/i, '-pass.json');
}

function defaultSessionDir(sourcePath: string): string {
  if (!sourcePath.trim()) return 'output\\codex-evidence\\ad-readback-session';
  return sourcePath.replace(/\.json$/i, '-session');
}

export function buildFillAdReadbackCommand(form: ReadbackFormState, sourcePath: string, outPath = defaultPassEvidencePath(sourcePath)): string {
  const args = [
    ['--source', sourcePath],
    ['--out', outPath],
    ['--approver-name', form.approverName],
    ['--approval-artifact', form.approvalArtifactPath],
    ['--approval-confirmed-at', form.approvalConfirmedAt],
    ['--before-value', form.beforeValue],
    ['--before-captured-at', form.beforeCapturedAt],
    ['--before-screenshot', form.beforeScreenshotPath],
    ['--live-bid-source-note', form.liveBidSourceNote],
    ['--after-value', form.afterValue],
    ['--after-captured-at', form.afterCapturedAt],
    ['--after-screenshot', form.afterScreenshotPath],
    ['--executed-at', form.executionExecutedAt],
    ['--executed-by', form.executedBy],
    ['--execution-id', form.executionId],
    ['--readback-read-at', form.readbackReadAt],
    ['--readback-evidence', form.readbackEvidencePath],
    ['--readback-actual-value', form.readbackActualValue],
    ['--risk-rationale', form.riskRationale],
  ].filter(([, value]) => String(value || '').trim());
  return `pnpm run fill:ad-readback -- ${args.map(([key, value]) => `${key} ${psQuote(String(value))}`).join(' ')}`;
}

export function buildPrepareAdReadbackSessionCommand(sourcePath: string, sessionDir = defaultSessionDir(sourcePath)): string {
  return `pnpm run prepare:ad-readback-session -- --source ${psQuote(sourcePath)} --out ${psQuote(sessionDir)}`;
}

export function buildVerifyAdReadbackSessionCommand(sourcePath: string, sessionDir = defaultSessionDir(sourcePath)): string {
  return `pnpm run verify:ad-readback-session -- ${psQuote(sessionDir)}`;
}

export function buildFillAdReadbackSessionCommand(sourcePath: string, sessionDir = defaultSessionDir(sourcePath)): string {
  return `pnpm run fill:ad-readback-session -- --session ${psQuote(sessionDir)}`;
}

export function readbackSessionWorkflow(sourcePath?: string) {
  const sessionDir = sourcePath ? defaultSessionDir(sourcePath) : '导出回读证据后自动生成';
  return {
    sessionDir,
    steps: [
      '创建单动作工作包，得到操作清单、填写文件和截图目录。',
      '按操作清单在广告后台确认同一店铺、站点、广告活动、广告组、ASIN、对象和动作。',
      '把审批凭证放入审批目录，把执行前截图放入执行前截图目录。',
      '人工完成一次低风险动作后，把执行后截图放入执行后截图目录。',
      '刷新广告后台回读真实值，把回读截图放入回读截图目录。',
      '填写现场信息后生成可进入最终验收的回读证据。',
    ],
    warning: '检查工作包只证明目录和文件结构安全，不等于最终验收通过；最终仍以生成后的回读证据校验和最终验收汇总为准。',
  };
}

export function readbackSessionSummary(sourcePath?: string): string {
  if (!sourcePath?.trim()) return '先导出回读证据，再创建工作包。';
  return '创建工作包后，按清单补审批、执行前、执行后和回读截图。';
}

function readbackRepairRelatedBlockers(label: string): string[] {
  if (label === '执行前值' || label === '执行后值') {
    return ['执行前值和执行后值不能相同', '降价动作必须证明执行后值低于执行前值'];
  }
  if (label === '回读值' || label === '执行后值') {
    return ['回读值必须等于执行后值'];
  }
  if (label === '执行前截图' || label === '执行后截图' || label === '回读证据') {
    return ['执行前、执行后和回读证据文件不能复用'];
  }
  if (label === '审批时间' || label === '执行前时间' || label === '执行时间' || label === '执行后时间' || label === '回读时间') {
    return [`${label}不是可解析时间`, '时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读'];
  }
  return [];
}

export function readbackRepairFieldClass(label: string, missing: string[], active: boolean, pulsing: boolean): string {
  if (!active) return '';
  const needsAttention = missing.includes(label)
    || readbackRepairRelatedBlockers(label).some((blocker) => missing.includes(blocker));
  if (!needsAttention) return '';
  return [
    'readback-repair-field-active',
    pulsing ? 'readback-repair-field-pulse' : '',
  ].filter(Boolean).join(' ');
}

function ReadbackCaptureTarget({
  slot,
  value,
  saving,
  previewUrl,
  onCapture,
  repairClassName = '',
  disabled = false,
  id,
}: {
  slot: ReadbackCaptureSlot;
  value?: string;
  saving?: boolean;
  previewUrl?: string;
  onCapture: (slot: ReadbackCaptureSlot, files: File[]) => void;
  repairClassName?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const view = readbackCaptureTargetView(slot, { value, saving, dragging, previewUrl });
  const clearDragging = () => setDragging(false);
  const markDragging = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!saving && !disabled) setDragging(true);
  };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    clearDragging();
    if (disabled) return;
    onCapture(slot, captureFileList(event.dataTransfer));
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = captureFileList(event.clipboardData);
    if (!files.length || disabled) return;
    event.preventDefault();
    onCapture(slot, files);
  };
  return (
    <div
      aria-label={`${CAPTURE_SLOT_LABELS[slot].title}拖拽或粘贴存证`}
      aria-disabled={disabled || undefined}
      aria-live="polite"
      className={[view.className, repairClassName].filter(Boolean).join(' ')}
      data-capture-slot={slot}
      onDragEnter={markDragging}
      onDragLeave={clearDragging}
      onDragOver={markDragging}
      onDrop={handleDrop}
      onPaste={handlePaste}
      role="button"
      id={id}
      tabIndex={disabled ? -1 : 0}
    >
      <strong>{view.title}</strong>
      <span>{view.detail}</span>
      {'preview' in view && view.preview ? (
        <div className="readback-capture-fixed-preview">
          <div className="readback-capture-thumbnail" aria-label={view.preview.alt}>
            {view.preview.src ? (
              <img alt={view.preview.alt} src={view.preview.src} />
            ) : (
              <span aria-hidden="true">{view.preview.extension}</span>
            )}
          </div>
          <div className="readback-capture-fixed-meta">
            <span className="readback-capture-fixed-badge">{view.preview.badge}</span>
            <small className="readback-capture-file-name" title={view.preview.path}>{view.preview.fileName}</small>
          </div>
        </div>
      ) : (
        <small>{view.helper}</small>
      )}
    </div>
  );
}

export interface ReadbackPageProps {
  authority?: ReadbackAuthority;
  previewScenarioId?: string;
}

export function ReadbackPage({
  authority = readbackAuthorityForMode('production'),
  previewScenarioId,
}: ReadbackPageProps = {}) {
  const { data, scope } = useBusinessDataPipeline();
  const [approvedRows, setApprovedRows] = useState<RecommendationView[]>([]);
  const [form, setForm] = useState<ReadbackFormState>(EMPTY_FORM);
  const [exportResult, setExportResult] = useState<{
    jsonPath?: string;
    markdownPath?: string;
    sha256?: string;
    status?: string;
    readyForVerifier?: boolean;
    nextAction?: 'verify' | 'prepare';
  } | null>(null);
  const [sessionResult, setSessionResult] = useState<Record<string, any> | null>(null);
  const [sessionCheck, setSessionCheck] = useState<Record<string, any> | null>(null);
  const [sessionFillResult, setSessionFillResult] = useState<Record<string, any> | null>(null);
  const [sessionVerifyResult, setSessionVerifyResult] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<ReadbackWizardStepId>('target-source');
  const [repairIntent, setRepairIntent] = useState<ReadbackRepairIntent | null>(null);
  const [repairPulse, setRepairPulse] = useState(false);
  const [capturePreviews, setCapturePreviews] = useState<Partial<Record<ReadbackCaptureSlot, string>>>({});
  const [activeAction, setActiveAction] = useState<ReadbackWorkspaceActionKey | null>(null);
  const [activeCaptureSlot, setActiveCaptureSlot] = useState<ReadbackCaptureSlot | null>(null);
  const [activeCopyCommand, setActiveCopyCommand] = useState<ReadbackCopyCommandKey | null>(null);
  const [activePathKey, setActivePathKey] = useState<string | null>(null);
  const [technicalInspectorOpen, setTechnicalInspectorOpen] = useState(false);
  const activeActionRef = useRef<ReadbackWorkspaceActionKey | null>(null);
  const readbackActionBusy = activeAction as ReadbackActionKey | null;
  const copyCommandBusy = activeAction === 'copy-command' ? activeCopyCommand : null;
  const pathOpenKey = activeAction === 'open-path' ? activePathKey : null;
  const captureSavingSlot = activeAction === 'capture-evidence' ? activeCaptureSlot : null;
  const rowsRequestIdRef = useRef(0);
  const captureRequestIdRef = useRef(0);
  const exportRequestIdRef = useRef(0);
  const finalRequestIdRef = useRef(0);
  const sessionRequestIdRef = useRef(0);
  const verifyRequestIdRef = useRef(0);
  const formEpochRef = useRef(0);
  const activeRowsRequestRef = useRef<ReadbackRequestSnapshot | null>(null);
  const activeCaptureRequestRef = useRef<ReadbackRequestSnapshot | null>(null);
  const activeExportRequestRef = useRef<ReadbackRequestSnapshot | null>(null);
  const activeFinalRequestRef = useRef<ReadbackRequestSnapshot | null>(null);
  const activeSessionRequestRef = useRef<ReadbackRequestSnapshot | null>(null);
  const activeVerifyRequestRef = useRef<ReadbackRequestSnapshot | null>(null);
  const stepTabRefs = useRef<Partial<Record<ReadbackWizardStepId, HTMLButtonElement | null>>>({});
  const focusStepTab = (stepId: ReadbackWizardStepId) => {
    const focusTab = () => stepTabRefs.current[stepId]?.focus();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusTab);
      return;
    }
    focusTab();
  };
  const activateReadbackStep = (stepId: ReadbackWizardStepId, focusTab = false) => {
    setActiveStep(stepId);
    if (focusTab) focusStepTab(stepId);
  };
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const queryKey = useMemo(() => buildReadbackQueryKey({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);
  const missing = useMemo(() => requiredMissing(form, currentBatchId), [currentBatchId, form]);
  const sourceBatchMatches = Boolean(form.sourceBatchId && currentBatchId && form.sourceBatchId === currentBatchId);
  const missingGroups = useMemo(() => groupMissing(missing), [missing]);
  const precheckCopy = useMemo(() => readbackPrecheckCopy(missing), [missing]);
  const contractChecks = useMemo(() => readbackContractChecks(form), [form]);
  const sessionWorkflow = useMemo(() => readbackSessionWorkflow(exportResult?.jsonPath), [exportResult?.jsonPath]);
  const exportRoute = useMemo(() => resolveReadbackExportRoute(exportResult), [exportResult]);
  const finalVerificationPassed = readbackVerifierPassed(sessionVerifyResult);
  const completedViaWorkPackage = finalVerificationPassed
    && exportRoute.kind === 'prepare-session'
    && Boolean(sessionFillResult?.jsonPath);
  const readbackStepSummaries = useMemo(() => {
    const missingSet = new Set(missing);
    return readbackWizardSteps.map((step) => {
      const missingCount = finalVerificationPassed
        ? 0
        : step.fields.filter((field) => missingSet.has(field)).length;
      return {
        ...step,
        missingCount,
        status: missingCount ? 'blocked' : 'ready',
        detail: finalVerificationPassed ? '最终核对通过' : missingCount ? `缺 ${missingCount} 项` : '已满足',
      };
    });
  }, [finalVerificationPassed, missing]);
  const activeStepSummary = readbackStepSummaries.find((step) => step.id === activeStep) || readbackStepSummaries[0];
  const activeStepIndex = Math.max(0, readbackWizardSteps.findIndex((step) => step.id === activeStep));
  const readbackStepRailStyle = {
    '--readback-active-step': activeStepIndex,
    '--readback-step-count': readbackWizardSteps.length,
  } as React.CSSProperties;
  const activeMissingCount = activeStepSummary?.missingCount || 0;
  const capturedEvidenceCount = [
    form.approvalArtifactPath,
    form.beforeScreenshotPath,
    form.afterScreenshotPath,
    form.readbackEvidencePath,
  ].filter((value) => value.trim()).length;
  const activeStepDetail = finalVerificationPassed
    ? '最终证据已核对通过；批准记录、报表批次与现场证据保持一致。'
    : activeMissingCount
      ? `当前步骤还有 ${activeMissingCount} 项待补；所有安全缺口仍由本地校验决定。`
      : activeStep === 'verify-export'
        ? '当前步骤已满足；请运行最终校验，核对批准记录、报表批次与现场证据。'
        : '当前步骤已满足；继续下一步前仍保留最终导出校验。';
  const sourceFieldCount = [
    form.storeName,
    form.marketplaceCode,
    form.asin,
    form.campaignName,
    form.adGroupName,
    form.entityType,
    form.entityName,
    form.actionType,
    form.currentValue,
    form.recommendedValue,
    form.sourceBatchId,
    form.sourceMetricDate,
    form.sourceRow,
    form.sourceFiles,
  ].filter((value) => value.trim()).length;
  const firstScreenshotRepairSlot: ReadbackCaptureSlot | null = !form.approvalArtifactPath.trim()
    ? 'approval'
    : !form.beforeScreenshotPath.trim()
      ? 'before'
      : !form.afterScreenshotPath.trim()
        ? 'after'
        : !form.readbackEvidencePath.trim()
          ? 'readback'
          : missing.some((item) => item.includes('证据文件不能复用')) ? 'before' : null;
  const sourceFilesCount = sourceFileLines(form.sourceFiles).length;
  const repairIntentStep = readbackRepairIntentStep(repairIntent);
  const exportOpenPath = exportResult?.jsonPath || exportResult?.markdownPath || '';
  const openExportButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: authority.previewOnly || !exportOpenPath || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开导出文件',
    pathKey: readbackPathActionKey('打开导出文件', exportOpenPath),
  });
  const openSessionPacketButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: authority.previewOnly || !sessionResult?.sessionDir || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开工作包',
    pathKey: readbackPathActionKey('打开工作包', sessionResult?.sessionDir),
  });
  const openSessionInputFileButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: authority.previewOnly || !sessionResult?.sessionInputPath || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开填写文件',
    pathKey: readbackPathActionKey('打开填写文件', sessionResult?.sessionInputPath),
  });
  const openSessionInputGuideButton = readbackOpenPathButtonView({
    activePathKey: pathOpenKey,
    disabled: authority.previewOnly || !sessionResult?.sessionInputGuidePath || Boolean(activeAction && activeAction !== 'open-path'),
    idleLabel: '打开填写说明',
    pathKey: readbackPathActionKey('打开填写说明', sessionResult?.sessionInputGuidePath),
  });

  function update(patch: Partial<ReadbackFormState>, options: { preserveSession?: boolean } = {}) {
    formEpochRef.current += 1;
    activeExportRequestRef.current = {
      kind: 'export',
      requestId: ++exportRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeCaptureRequestRef.current = {
      kind: 'capture',
      requestId: ++captureRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeFinalRequestRef.current = {
      kind: 'final',
      requestId: ++finalRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeVerifyRequestRef.current = {
      kind: 'verify',
      requestId: ++verifyRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeSessionRequestRef.current = {
      kind: 'session',
      requestId: ++sessionRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    setForm((current) => ({ ...current, ...patch }));
    setExportResult(null);
    if (!options.preserveSession) {
      setSessionResult(null);
      setSessionCheck(null);
      setSessionFillResult(null);
      setSessionVerifyResult(null);
    }
  }
  const repairFieldClass = (label: string, baseClassName = '') => [
    baseClassName,
    readbackRepairFieldClass(label, missing, Boolean(repairIntent), repairPulse),
  ].filter(Boolean).join(' ');

  useEffect(() => {
    let clearPulseTimer: number | null = null;
    function applyIntent(intent: ReadbackRepairIntent | null) {
      if (!intent) return;
      setRepairIntent(intent);
      setActiveStep(readbackRepairIntentStep(intent));
      setRepairPulse(true);
      setMessage(readbackRepairIntentMessage(intent));
      if (clearPulseTimer) window.clearTimeout(clearPulseTimer);
      clearPulseTimer = window.setTimeout(() => setRepairPulse(false), 150);
    }
    function handleRepairIntent(event: Event) {
      applyIntent((event as CustomEvent<ReadbackRepairIntent>).detail || null);
    }
    window.addEventListener(READBACK_REPAIR_INTENT_EVENT, handleRepairIntent);
    try {
      const storedIntent = parseReadbackRepairIntent(window.sessionStorage?.getItem(READBACK_REPAIR_INTENT_STORAGE_KEY));
      if (storedIntent) {
        window.sessionStorage?.removeItem(READBACK_REPAIR_INTENT_STORAGE_KEY);
        applyIntent(storedIntent);
      }
    } catch {
      // Repair intent is a convenience handoff; the readback page remains usable without it.
    }
    return () => {
      window.removeEventListener(READBACK_REPAIR_INTENT_EVENT, handleRepairIntent);
      if (clearPulseTimer) window.clearTimeout(clearPulseTimer);
    };
  }, []);

  async function captureEvidence(slot: ReadbackCaptureSlot, files: File[]) {
    if (!authority.capabilities.captureEvidence) {
      setCopyNotice('仅开发预览为只读布局，不能写入截图证据。');
      return;
    }
    const file = firstImageFile(files);
    if (!file) {
      setCopyNotice('请粘贴或拖入 PNG/JPG/WebP 截图。');
      return;
    }
    const api = (window as any).electronAPI;
    if (!api?.saveReadbackCapture) {
      setCopyNotice('当前运行环境不支持截图存证。');
      return;
    }
    await runWorkspaceAction('capture-evidence', async () => {
      const request: ReadbackRequestSnapshot = {
        kind: 'capture',
        requestId: ++captureRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeCaptureRequestRef.current = request;
      setActiveCaptureSlot(slot);
      setCopyNotice(`${CAPTURE_SLOT_LABELS[slot].title}正在存证...`);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (!activeCaptureRequestRef.current || !canPublishReadbackResult(request, activeCaptureRequestRef.current)) return;
        const result = await api.saveReadbackCapture({
          slot,
          dataUrl,
          fileName: file.name,
          sessionDir: sessionResult?.sessionDir,
        });
        if (!activeCaptureRequestRef.current || !canPublishReadbackResult(request, activeCaptureRequestRef.current)) return;
        update(captureSlotPatch(slot, result.filePath, result.savedAt), { preserveSession: true });
        setCapturePreviews((current) => ({ ...current, [slot]: dataUrl }));
        setSessionCheck(null);
        setSessionFillResult(null);
        setSessionVerifyResult(null);
        setCopyNotice(`${CAPTURE_SLOT_LABELS[slot].title}已保存到本地证据目录。`);
      } catch (caught) {
        if (activeCaptureRequestRef.current && canPublishReadbackResult(request, activeCaptureRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, `${CAPTURE_SLOT_LABELS[slot].title}存证失败。`));
        }
      } finally {
        setActiveCaptureSlot(null);
      }
    });
  }

  async function loadApprovedRows() {
    const request: ReadbackRequestSnapshot = {
      kind: 'rows',
      requestId: ++rowsRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeRowsRequestRef.current = request;
    setLoading(true);
    setMessage(null);
    try {
      const rows = await (window as any).electronAPI?.getRecommendations?.({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
        batchId: currentBatchId,
        status: 'approved',
        limit: 100,
      });
      if (activeRowsRequestRef.current && canPublishReadbackResult(request, activeRowsRequestRef.current)) {
        const nextRows = Array.isArray(rows) ? rows : [];
        setApprovedRows(nextRows);
        if (authority.previewOnly && nextRows[0] && (previewScenarioId === 'missing-readback-evidence' || previewScenarioId === 'delivery-ready')) {
          const complete = previewScenarioId === 'delivery-ready';
          const previewForm = readbackPreviewFormFromRecommendation(nextRows[0], scope, currentBatchId, complete);
          formEpochRef.current += 1;
          setForm(previewForm);
          setActiveStep(complete ? 'verify-export' : 'evidence');
          if (complete) {
            setExportResult({
              jsonPath: 'D:/preview/readback/readback-pass.json',
              markdownPath: 'D:/preview/readback/readback-pass.md',
              sha256: 'PREVIEW_ONLY_NOT_A_REAL_HASH',
              status: 'PASS',
              readyForVerifier: true,
              nextAction: 'verify',
            });
            setSessionVerifyResult({
              evidencePath: 'D:/preview/readback/readback-pass.json',
              ready: true,
              status: 'PASS',
              issues: [],
              previewOnly: true,
            });
          }
        }
      }
    } catch (caught) {
      if (activeRowsRequestRef.current && canPublishReadbackResult(request, activeRowsRequestRef.current)) {
        setMessage(readbackErrorMessage(caught, '加载已批准动作失败。'));
      }
    } finally {
      if (activeRowsRequestRef.current && canPublishReadbackResult(request, activeRowsRequestRef.current)) {
        setLoading(false);
      }
    }
  }

  async function runWorkspaceAction<T>(
    action: ReadbackWorkspaceActionKey,
    task: () => Promise<T>,
  ): Promise<T | undefined> {
    if (activeActionRef.current) return undefined;
    activeActionRef.current = action;
    setActiveAction(action);
    try {
      return await task();
    } finally {
      if (activeActionRef.current === action) activeActionRef.current = null;
      setActiveAction((current) => current === action ? null : current);
    }
  }

  async function exportEvidence(options: { withinActiveAction?: boolean } = {}) {
    if (!authority.capabilities.exportEvidence) {
      setMessage('仅开发预览为只读布局，不能导出真实回读证据，也不代表正式交付就绪。');
      return;
    }
    const task = async () => {
      const request: ReadbackRequestSnapshot = {
        kind: 'export',
        requestId: ++exportRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeExportRequestRef.current = request;
      setMessage(null);
      try {
        const exportAdReadbackEvidence = (window as any).electronAPI?.exportAdReadbackEvidence;
        if (typeof exportAdReadbackEvidence !== 'function') {
          throw new Error('回读证据导出接口未暴露。');
        }
        const result = await runReadbackWorkflowMutation<any>('create', () => exportAdReadbackEvidence({
          recommendationId: Number(form.recommendationId),
          expectedRevision: form.recommendationRevision,
          scope: {
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin || form.asin,
            batchId: currentBatchId || '',
          },
          operatorEvidence: {
            approval: {
              operatorConfirmed: form.operatorConfirmed,
              realWriteApproved: form.realWriteApproved,
              approvalArtifactPath: form.approvalArtifactPath,
            },
            risk: {
              allowedByPolicy: form.allowedByPolicy,
            },
            before: {
              value: form.beforeValue,
              capturedAt: form.beforeCapturedAt,
              screenshotPath: form.beforeScreenshotPath,
              liveBidSourceNote: form.liveBidSourceNote,
            },
            after: {
              value: form.afterValue,
              capturedAt: form.afterCapturedAt,
              screenshotPath: form.afterScreenshotPath,
            },
            readback: {
              verified: form.readbackVerified,
              method: 'Ads UI reload',
              readAt: form.readbackReadAt,
              actualValue: form.readbackActualValue,
              evidencePath: form.readbackEvidencePath,
            },
            execution: {
              success: form.executionSuccess,
              verified: form.executionVerified,
              executionId: form.executionId,
              executedAt: form.executionExecutedAt,
              channel: 'manual_ads_ui',
              executedBy: form.executedBy,
              appExecutorUsed: false,
            },
          },
        }), undefined, () => Boolean(
          activeExportRequestRef.current
          && canPublishReadbackResult(request, activeExportRequestRef.current)
        ));
        if (!activeExportRequestRef.current || !canPublishReadbackResult(request, activeExportRequestRef.current)) return;
        setExportResult(result || null);
        setSessionResult(null);
        setSessionCheck(null);
        setSessionFillResult(null);
        setSessionVerifyResult(null);
        setMessage(result?.readyForVerifier ? '回读证据已导出，字段完整，等待最终验收。' : '回读证据已导出，但仍存在缺失项，不能作为最终就绪证据。');
        return result;
      } catch (caught) {
        if (activeExportRequestRef.current && canPublishReadbackResult(request, activeExportRequestRef.current)) {
          setMessage(readbackErrorMessage(caught, '导出回读证据失败。'));
        }
      }
    };
    return options.withinActiveAction ? task() : runWorkspaceAction('export-evidence', task);
  }

  async function openReadbackPath(targetPath?: string, label = '打开路径') {
    if (!targetPath) return;
    const key = readbackPathActionKey(label, targetPath);
    await runWorkspaceAction('open-path', async () => {
      setActivePathKey(key);
      setCopyNotice(`${label}打开中...`);
      try {
        await (window as any).electronAPI?.openReportPath?.(targetPath);
        setCopyNotice(`${label}已请求打开。`);
      } catch (caught) {
        setCopyNotice(readbackErrorMessage(caught, `${label}打开失败。`));
      } finally {
        setActivePathKey(null);
      }
    });
  }

  async function openExport() {
    await openReadbackPath(exportOpenPath, '打开导出文件');
  }

  async function prepareSessionPacket() {
    if (!authority.capabilities.prepareSession) {
      setCopyNotice('仅开发预览为只读布局，不能创建真实回读工作包。');
      return;
    }
    if (exportRoute.kind !== 'prepare-session') {
      setCopyNotice(exportRoute.kind === 'direct-verify'
        ? '当前证据已完整，请直接运行最终校验，无需创建工作包。'
        : '当前导出合同无效，请刷新已批准动作后重新导出。');
      return;
    }
    const sourcePath = exportRoute.sourcePath;
    await runWorkspaceAction('prepare-session', async () => {
      const request: ReadbackRequestSnapshot = {
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeSessionRequestRef.current = request;
      try {
        const result = await (window as any).electronAPI?.prepareAdReadbackSession?.({ sourcePath });
        if (!activeSessionRequestRef.current || !canPublishReadbackResult(request, activeSessionRequestRef.current)) return;
        setSessionResult(result || null);
        setSessionCheck(null);
        setSessionFillResult(null);
        setSessionVerifyResult(null);
        setCopyNotice('回读工作包已创建。');
      } catch (caught) {
        if (activeSessionRequestRef.current && canPublishReadbackResult(request, activeSessionRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '创建回读工作包失败。'));
        }
      }
    });
  }

  async function openSessionPacket() {
    await openReadbackPath(sessionResult?.sessionDir, '打开工作包');
  }

  async function openSessionInputFile() {
    await openReadbackPath(sessionResult?.sessionInputPath, '打开填写文件');
  }

  async function openSessionInputGuide() {
    await openReadbackPath(sessionResult?.sessionInputGuidePath, '打开填写说明');
  }

  async function verifySessionPacket() {
    if (!authority.capabilities.verifySession) {
      setCopyNotice('仅开发预览为只读布局，不能检查真实回读工作包。');
      return;
    }
    const sessionDir = sessionResult?.sessionDir;
    if (!sessionDir) {
      setCopyNotice('请先创建回读工作包，再检查工作包。');
      return;
    }
    await runWorkspaceAction('verify-session', async () => {
      const request: ReadbackRequestSnapshot = {
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeSessionRequestRef.current = request;
      try {
        const result = await (window as any).electronAPI?.verifyAdReadbackSession?.({ sessionDir });
        if (!activeSessionRequestRef.current || !canPublishReadbackResult(request, activeSessionRequestRef.current)) return;
        setSessionCheck(result || null);
        if (result?.ready && result?.captureReady) {
          setCopyNotice('工作包结构和现场证据均已通过。');
        } else if (result?.ready) {
          setCopyNotice('工作包结构检查通过，现场证据仍待填写。');
        } else {
          setCopyNotice('工作包结构检查未通过。');
        }
      } catch (caught) {
        if (activeSessionRequestRef.current && canPublishReadbackResult(request, activeSessionRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '检查回读工作包失败。'));
        }
      }
    });
  }

  async function fillSessionPacket() {
    if (!authority.capabilities.fillSession) {
      setCopyNotice('仅开发预览为只读布局，不能生成真实回读证据。');
      return;
    }
    const sessionDir = sessionResult?.sessionDir;
    if (!sessionDir) {
      setCopyNotice('请先创建回读工作包，再生成回读证据。');
      return;
    }
    await runWorkspaceAction('fill-session', async () => {
      const request: ReadbackRequestSnapshot = {
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeSessionRequestRef.current = request;
      try {
        const fillAdReadbackSession = (window as any).electronAPI?.fillAdReadbackSession;
        if (typeof fillAdReadbackSession !== 'function') {
          throw new Error('回读证据生成接口未暴露。');
        }
        const result = await runReadbackWorkflowMutation<any>(
          'create',
          () => fillAdReadbackSession({ sessionDir }),
          undefined,
          () => Boolean(
            activeSessionRequestRef.current
              && canPublishReadbackResult(request, activeSessionRequestRef.current)
          ),
        );
        if (!activeSessionRequestRef.current || !canPublishReadbackResult(request, activeSessionRequestRef.current)) return;
        setSessionFillResult(result || null);
        setSessionVerifyResult(null);
        if (result?.readyForVerifier) setSessionCheck(null);
        setCopyNotice(result?.readyForVerifier ? '回读证据已生成，等待最终校验。' : '回读证据仍未就绪。');
      } catch (caught) {
        if (activeSessionRequestRef.current && canPublishReadbackResult(request, activeSessionRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '生成回读证据失败。'));
        }
      }
    });
  }

  async function verifyReadbackEvidence(options: { evidencePath?: string; withinActiveAction?: boolean } = {}) {
    if (!authority.capabilities.verifyEvidence) {
      setCopyNotice('仅开发预览为只读布局，不能运行真实回读校验，也不代表正式交付就绪。');
      return;
    }
    const evidencePath = options.evidencePath || (exportRoute.kind === 'direct-verify'
      ? exportRoute.evidencePath
      : sessionFillResult?.jsonPath);
    if (!evidencePath) {
      setCopyNotice(exportRoute.kind === 'prepare-session'
        ? '请先补齐工作包并生成回读证据，再运行最终校验。'
        : '请先导出当前已批准动作的回读证据，再运行最终校验。');
      return;
    }
    const task = async () => {
      const request: ReadbackRequestSnapshot = {
        kind: 'verify',
        requestId: ++verifyRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeVerifyRequestRef.current = request;
      try {
        const verifyAdReadbackEvidence = (window as any).electronAPI?.verifyAdReadbackEvidence;
        if (typeof verifyAdReadbackEvidence !== 'function') {
          throw new Error('回读证据校验接口未暴露。');
        }
        const result = await runReadbackWorkflowMutation<any>(
          'verify',
          () => verifyAdReadbackEvidence({ evidencePath }),
          undefined,
          () => Boolean(
            activeVerifyRequestRef.current
            && canPublishReadbackResult(request, activeVerifyRequestRef.current)
          ),
        );
        if (!activeVerifyRequestRef.current || !canPublishReadbackResult(request, activeVerifyRequestRef.current)) return;
        setSessionVerifyResult(result || null);
        if (readbackVerifierPassed(result)) {
          setActiveStep('verify-export');
          setMessage(null);
          setCopyNotice('最终证据已校验通过。');
        } else {
          setCopyNotice('回读证据校验未通过。');
        }
        return result;
      } catch (caught) {
        if (activeVerifyRequestRef.current && canPublishReadbackResult(request, activeVerifyRequestRef.current)) {
          setCopyNotice(readbackErrorMessage(caught, '校验回读证据失败。'));
        }
      }
    };
    return options.withinActiveAction ? task() : runWorkspaceAction('verify-evidence', task);
  }

  async function runFinalVerification() {
    if (!authority.capabilities.exportEvidence || !authority.capabilities.verifyEvidence) {
      setCopyNotice('仅开发预览为只读布局，不能运行真实回读校验，也不代表正式交付就绪。');
      return;
    }
    activateReadbackStep('verify-export');
    await runWorkspaceAction('final-verification', async () => {
      const request: ReadbackRequestSnapshot = {
        kind: 'final',
        requestId: ++finalRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeFinalRequestRef.current = request;
      setMessage('正在绑定当前已批准动作并导出权威回读证据...');
      setCopyNotice(null);
      try {
        await runCurrentReadbackFinalVerification(
          () => runReadbackFinalVerificationWorkflow({
            exportEvidence: async () => {
              const result = await exportEvidence({ withinActiveAction: true });
              if (!result) throw new Error('导出结果已过期或为空，请重新运行最终校验。');
              return result;
            },
            verifyEvidence: async (evidencePath) => {
              const result = await verifyReadbackEvidence({ evidencePath, withinActiveAction: true });
              if (!result) throw new Error('校验结果已过期或为空，请重新运行最终校验。');
              return result;
            },
          }),
          () => Boolean(
            activeFinalRequestRef.current
            && canPublishReadbackResult(request, activeFinalRequestRef.current)
          ),
          (outcome) => {
            if (outcome.kind === 'verification-result') {
              const passed = readbackVerifierPassed(outcome.verifyResult);
              setMessage(passed
                ? '最终校验通过：权威动作、现场证据和回读结果一致。'
                : '最终校验未通过，请按校验缺口修复后重试。');
              if (!passed) setTechnicalInspectorOpen(true);
              return;
            }
            if (outcome.kind === 'needs-work') {
              setMessage('证据仍需补齐；请在技术详情中创建工作包补证，系统不会自动代填。');
              setTechnicalInspectorOpen(true);
              return;
            }
            setMessage('导出合同不一致，已停止校验；请刷新当前已批准动作后重试。');
            setTechnicalInspectorOpen(true);
          },
        );
      } catch (caught) {
        if (activeFinalRequestRef.current && canPublishReadbackResult(request, activeFinalRequestRef.current)) {
          setMessage(readbackErrorMessage(caught, '运行最终校验失败。'));
          setTechnicalInspectorOpen(true);
        }
      }
    });
  }

  function focusRepairTarget(action: ReadbackRepairAction) {
    activateReadbackStep(action.stepId);
    const focusTarget = () => {
      const target = document.getElementById(action.focusTarget);
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusTarget);
      return;
    }
    focusTarget();
  }

  function activateRepairAction(action: ReadbackRepairAction) {
    focusRepairTarget(action);
    if (action.blocker === 'verification') void runFinalVerification();
  }

  async function copyFillCommand() {
    const sourcePath = exportResult?.jsonPath;
    if (!sourcePath) {
      setCopyNotice('请先导出回读证据，再复制备用命令。');
      return;
    }
    await runWorkspaceAction('copy-command', async () => {
      setActiveCopyCommand('long-fill');
      setCopyNotice('正在复制长参数生成命令...');
      try {
        await navigator.clipboard.writeText(buildFillAdReadbackCommand(form, sourcePath));
        setCopyNotice('长参数生成命令已复制。');
      } catch (caught) {
        setCopyNotice(readbackErrorMessage(caught, '复制生成命令失败。'));
      } finally {
        setActiveCopyCommand(null);
      }
    });
  }

  async function copySessionCommand(kind: 'prepare' | 'verify' | 'fill') {
    const sourcePath = exportResult?.jsonPath;
    if (!sourcePath) {
      setCopyNotice('请先导出回读证据，再复制工作包命令。');
      return;
    }
    const builders = {
      prepare: buildPrepareAdReadbackSessionCommand,
      verify: buildVerifyAdReadbackSessionCommand,
      fill: buildFillAdReadbackSessionCommand,
    };
    const labels = {
      prepare: '创建工作包命令已复制。',
      verify: '检查工作包命令已复制。',
      fill: '生成回读证据命令已复制。',
    };
    const runningLabels = {
      prepare: '正在复制创建工作包命令...',
      verify: '正在复制检查工作包命令...',
      fill: '正在复制生成回读证据命令...',
    };
    await runWorkspaceAction('copy-command', async () => {
      setActiveCopyCommand(kind);
      setCopyNotice(runningLabels[kind]);
      try {
        await navigator.clipboard.writeText(builders[kind](sourcePath));
        setCopyNotice(labels[kind]);
      } catch (caught) {
        setCopyNotice(readbackErrorMessage(caught, '复制工作包命令失败。'));
      } finally {
        setActiveCopyCommand(null);
      }
    });
  }

  useEffect(() => {
    formEpochRef.current += 1;
    activeRowsRequestRef.current = {
      kind: 'rows',
      requestId: ++rowsRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeExportRequestRef.current = {
      kind: 'export',
      requestId: ++exportRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeCaptureRequestRef.current = {
      kind: 'capture',
      requestId: ++captureRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeFinalRequestRef.current = {
      kind: 'final',
      requestId: ++finalRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeVerifyRequestRef.current = {
      kind: 'verify',
      requestId: ++verifyRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    activeSessionRequestRef.current = {
      kind: 'session',
      requestId: ++sessionRequestIdRef.current,
      queryKey,
      formEpoch: formEpochRef.current,
    };
    setApprovedRows([]);
    setForm(EMPTY_FORM);
    setExportResult(null);
    setSessionResult(null);
    setSessionCheck(null);
    setSessionFillResult(null);
    setSessionVerifyResult(null);
    setCapturePreviews({});
    setCopyNotice(null);
    setActiveStep('target-source');
    if (!currentBatchId) {
      setLoading(false);
      return;
    }
    void loadApprovedRows();
  }, [queryKey]);

  useEffect(() => {
    if (!form.recommendationId) return;
    const stillApproved = approvedRows.some((row) => String(row.id) === form.recommendationId);
    if (!stillApproved) {
      formEpochRef.current += 1;
      activeSessionRequestRef.current = {
        kind: 'session',
        requestId: ++sessionRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeCaptureRequestRef.current = {
        kind: 'capture',
        requestId: ++captureRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeFinalRequestRef.current = {
        kind: 'final',
        requestId: ++finalRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeExportRequestRef.current = {
        kind: 'export',
        requestId: ++exportRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      activeVerifyRequestRef.current = {
        kind: 'verify',
        requestId: ++verifyRequestIdRef.current,
        queryKey,
        formEpoch: formEpochRef.current,
      };
      setForm(EMPTY_FORM);
      setExportResult(null);
      setSessionResult(null);
      setSessionCheck(null);
      setSessionFillResult(null);
      setSessionVerifyResult(null);
      setCapturePreviews({});
      setCopyNotice(null);
      setActiveStep('target-source');
      setMessage('已清空结果核对表单：当前范围不再包含该已批准动作。');
    }
  }, [approvedRows, form.recommendationId]);

  useEffect(() => {
    if (activeStep !== 'evidence' || !authority.capabilities.captureEvidence) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
      const files = captureFileList(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void captureEvidence(nextEvidenceCaptureSlot(form), files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [activeStep, authority.capabilities.captureEvidence, form, sessionResult?.sessionDir]);

  const prepareSessionButton = readbackActionButtonView({
    action: 'prepare-session',
    activeAction: readbackActionBusy,
    baseClassName: 'primary-button',
    busyLabel: readbackActionBusyLabel('prepare-session'),
    disabled: !authority.capabilities.prepareSession || exportRoute.kind !== 'prepare-session',
    label: '创建回读工作包',
  });
  const verifySessionButton = readbackActionButtonView({
    action: 'verify-session',
    activeAction: readbackActionBusy,
    baseClassName: 'secondary-button',
    busyLabel: readbackActionBusyLabel('verify-session'),
    disabled: !authority.capabilities.verifySession || !sessionResult?.sessionDir,
    label: '检查工作包',
  });
  const fillSessionButton = readbackActionButtonView({
    action: 'fill-session',
    activeAction: readbackActionBusy,
    baseClassName: 'primary-button',
    busyLabel: readbackActionBusyLabel('fill-session'),
    disabled: !authority.capabilities.fillSession || !sessionResult?.sessionDir,
    label: '生成回读证据',
  });
  const verifyEvidenceButton = readbackActionButtonView({
    action: 'verify-evidence',
    activeAction: readbackActionBusy,
    baseClassName: 'primary-button',
    busyLabel: readbackActionBusyLabel('verify-evidence'),
    disabled: !authority.capabilities.verifyEvidence
      || (exportRoute.kind !== 'direct-verify' && !sessionFillResult?.jsonPath),
    label: '校验证据文件',
  });
  const canCopyCommands = exportRoute.kind === 'prepare-session';
  const prepareCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'prepare',
    disabled: !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制创建工作包命令',
  });
  const verifyCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'verify',
    disabled: !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制检查工作包命令',
  });
  const fillCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'fill',
    disabled: !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制生成回读证据命令',
  });
  const longFillCopyCommandButton = readbackCopyCommandButtonView({
    activeCommand: copyCommandBusy,
    command: 'long-fill',
    disabled: !canCopyCommands || Boolean(readbackActionBusy),
    label: '复制长参数生成命令',
  });
  const repairActions = readbackRepairActions(readbackRepairBlockersForMissing(missing))
    .map((action) => resolveReadbackScreenshotRepairAction(action, form));
  const primaryRepairAction = repairActions[0];
  const secondaryRepairActions = repairActions.slice(1, 2);
  const finalVerificationView = readbackGlobalBusyView({
    action: 'final-verification',
    activeAction,
    disabled: !authority.capabilities.verifyEvidence || !form.recommendationId,
  });
  const technicalInspectorLocked = Boolean(activeAction);
  const taskBannerAction = (action: ReadbackRepairAction) => ({
    label: action.label,
    ariaLabel: action.label,
    busy: action.blocker === 'verification' && finalVerificationView.showSpinner,
    busyLabel: action.blocker === 'verification' ? '正在导出并校验...' : undefined,
    disabled: authority.previewOnly || Boolean(activeAction) || !form.recommendationId,
    disabledReason: authority.previewOnly
      ? '仅开发预览为只读布局，不代表正式交付就绪。'
      : !form.recommendationId ? '请先选择一条已批准动作。' : undefined,
    onClick: () => activateRepairAction(action),
  });
  const passedTaskAction = {
    label: '查看核对详情',
    ariaLabel: '查看核对详情',
    disabled: Boolean(activeAction),
    onClick: () => setTechnicalInspectorOpen(true),
  };

  return (
    <div
      className={authority.previewOnly ? 'readback-page readback-page-preview-readonly' : 'readback-page'}
      data-readback-mode={authority.mode}
      data-preview-scenario={authority.previewOnly ? previewScenarioId : undefined}
      data-workspace="readback"
      data-workspace-evidence-root="true"
      data-workspace-subview="evidence"
      onBeforeInputCapture={(event) => {
        if (!authority.previewOnly) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onChangeCapture={(event) => {
        if (!authority.previewOnly) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClickCapture={(event) => {
        if (!authority.previewOnly) return;
        const target = event.target as HTMLElement;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <PageFrame
        pageId="readback"
        title="结果核对"
        description="选择已批准动作，保存审批凭证、执行前后截图和刷新后的回读值；最终校验会重新核对后台批准记录与当前报表批次。"
        task={(
          <div data-action={finalVerificationPassed ? 'review-readback-result' : `repair-${primaryRepairAction.blocker}`} id="readback-verify-evidence" tabIndex={-1}>
            <TaskBanner
              eyebrow="当前主任务"
              title={finalVerificationPassed ? '结果核对已通过' : primaryRepairAction.label}
              description={finalVerificationPassed
                ? '最终证据已核对通过；可在详情中查看本地证据路径与校验记录。'
                : primaryRepairAction.blocker === 'verification'
                  ? '字段已具备，运行一次最终校验；证据完整时直接进入最终验收，仍有缺口时只打开补证流程，不会自动填写。'
                  : '先修复当前最靠前的现场证据缺口；动作会切换到对应步骤并把焦点送到唯一修复目标。'}
              tone={finalVerificationPassed ? 'confirmed' : missing.length ? 'attention' : 'neutral'}
              status={(
                <StatusPill tone={finalVerificationPassed ? 'ready' : missing.length ? 'blocked' : 'pending'}>
                  {finalVerificationPassed ? '校验通过' : precheckCopy.statusLabel}
                </StatusPill>
              )}
              meta={<span>{form.recommendationId ? `已选择建议 #${form.recommendationId} · 建议版本 ${form.recommendationRevision}` : '尚未选择已批准动作'} · {finalVerificationPassed ? '最终证据已收齐' : `截图 ${capturedEvidenceCount}/4`}</span>}
              primaryAction={finalVerificationPassed ? passedTaskAction : taskBannerAction(primaryRepairAction)}
              secondaryActions={finalVerificationPassed ? [] : secondaryRepairActions.map(taskBannerAction)}
            />
          </div>
        )}
      >
      {authority.previewOnly && (
        <div className="readback-preview-only-banner" role="status" aria-live="polite">
          <strong>仅开发预览，不代表正式交付就绪</strong>
          <span>{previewScenarioId ? `场景：${previewScenarioId}。` : ''} 当前仅展示只读结果核对布局，所有证据写入与真实校验均已锁定。</span>
        </div>
      )}
      <div className="business-stack">
        {repairIntent && (
          <div className="readback-repair-banner" role="status" aria-live="polite">
            <strong>交付验收直达修复</strong>
            <span>{readbackRepairIntentMessage(repairIntent)}</span>
          </div>
        )}

        <div className="readback-repair-actions" role="status" aria-live="polite">
          <strong>当前步骤 {activeStepIndex + 1}/4 · {activeStepSummary.title}</strong>
          <span>{activeStepDetail}</span>
        </div>

        <div className="readback-step-grid readback-step-tabs" role="tablist" aria-label="结果核对步骤" style={readbackStepRailStyle}>
          {readbackStepSummaries.map((step, index) => (
            <button
              aria-controls={readbackStepPanelId(step.id)}
              aria-selected={activeStep === step.id}
              className={`readback-step readback-step-${step.status}${activeStep === step.id ? ' readback-step-active' : ''}${repairIntent && repairIntentStep === step.id ? ' readback-step-repair-pulse' : ''}`}
              id={readbackStepTabId(step.id)}
              key={step.id}
              onClick={() => activateReadbackStep(step.id)}
              onKeyDown={(event) => {
                const nextStep = readbackStepFromKeyboard(step.id, event.key);
                if (!nextStep) return;
                event.preventDefault();
                activateReadbackStep(nextStep, true);
              }}
              ref={(node) => {
                stepTabRefs.current[step.id] = node;
              }}
              role="tab"
              tabIndex={activeStep === step.id ? 0 : -1}
              type="button"
            >
              <span>{index + 1}</span>
              <strong>{readbackStepTabTitle(step.title)}</strong>
              <small>{step.detail}</small>
            </button>
          ))}
        </div>

        <WorkbenchPanel
          className="readback-workbench"
          title={activeStepSummary.title}
          description={activeStepDetail}
          status={<StatusPill tone={activeMissingCount ? 'blocked' : 'ready'}>{activeMissingCount ? `缺 ${activeMissingCount} 项` : '本步骤已满足'}</StatusPill>}
          toolbar={(
            <button
              aria-label="查看技术与证据详情"
              className="workspace-button workspace-button--secondary"
              data-action="open-technical-inspector"
              disabled={technicalInspectorLocked}
              onClick={() => setTechnicalInspectorOpen(true)}
              type="button"
            >
              查看技术与证据详情
            </button>
          )}
        >
        <fieldset
          aria-disabled={authority.previewOnly || Boolean(activeAction)}
          className="readback-workbench-fieldset"
          disabled={authority.previewOnly || Boolean(activeAction)}
        >
        <div hidden={activeStep !== 'target-source'}>
          <div {...readbackStepPanelProps('target-source')}>
            <section aria-label="已批准动作与来源" className="readback-workbench-section" data-readback-authority-source="main-derived">
            <div className="business-split">
              <div>
                <div className="business-scope-line">当前有效批次：{currentBatchId || '暂无'}</div>
                <p className="muted-line">来源批次、指标日期、来源行号、来源文件、来源当前值和建议值是回读证据的一部分；缺失或串批次时只能导出缺口草稿。</p>
              </div>
              <StatusPill tone={sourceBatchMatches ? 'ready' : form.sourceBatchId ? 'blocked' : 'pending'}>
                {sourceBatchMatches ? '来源批次匹配' : form.sourceBatchId ? '来源批次不一致' : '待载入来源'}
              </StatusPill>
            </div>
            <div className="table-wrap">
              <table className="business-table approval-table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>位置</th>
                    <th>动作与值</th>
                    <th>审批版本</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedRows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{objectName(row) || row.evidence?.asin || '-'}</strong><small>{row.evidence?.asin || '-'} · {row.entityType || row.evidence?.matchType || '-'}</small></td>
                      <td><strong>{row.evidence?.campaignName || '-'}</strong><small>{row.evidence?.portfolioName || '-'} / {row.evidence?.adGroupName || '-'}</small></td>
                      <td><strong>{row.actionType}</strong><small>{row.currentValue || '-'} {'→'} {row.recommendedValue || '-'}</small></td>
                      <td><strong>#{row.id}</strong><small>版本 {row.revision}</small></td>
                      <td>
                        <button
                          className="secondary-button compact-button"
                          onClick={() => {
                            const nextForm = formFromRecommendation(row, scope, currentBatchId);
                            formEpochRef.current += 1;
                            activeExportRequestRef.current = {
                              kind: 'export',
                              requestId: ++exportRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeCaptureRequestRef.current = {
                              kind: 'capture',
                              requestId: ++captureRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeFinalRequestRef.current = {
                              kind: 'final',
                              requestId: ++finalRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeVerifyRequestRef.current = {
                              kind: 'verify',
                              requestId: ++verifyRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeSessionRequestRef.current = {
                              kind: 'session',
                              requestId: ++sessionRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            setForm(nextForm);
                            setExportResult(null);
                            setSessionResult(null);
                            setSessionCheck(null);
                            setSessionFillResult(null);
                            setSessionVerifyResult(null);
                            setCapturePreviews({});
                            setMessage(null);
                            setCopyNotice(null);
                            setActiveStep(firstIncompleteReadbackStep(requiredMissing(nextForm, currentBatchId)));
                          }}
                          type="button"
                        >
                          载入
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!approvedRows.length && (
                    <tr>
                      <td colSpan={5}>{loading ? '加载中...' : '当前范围没有已批准待执行动作。'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="readback-source-summary" aria-label="载入来源字段摘要">
              <div className="readback-source-summary-main">
                <span>来源字段</span>
                <strong>{form.entityName || form.asin || '尚未载入动作'}</strong>
                <p>
                  {form.actionType || '待选择动作'}
                  {' / '}
                  来源行 {form.sourceRow || '-'}
                  {' / '}
                  指标日 {form.sourceMetricDate || '-'}
                </p>
              </div>
              <div className="readback-source-summary-grid">
                <div>
                  <span>字段完整度</span>
                  <strong>{sourceFieldCount}/14</strong>
                </div>
                <div>
                  <span>来源文件</span>
                  <strong>{sourceFilesCount || 0} 个</strong>
                </div>
                <div>
                  <span>批次状态</span>
                  <strong>{sourceBatchMatches ? '匹配' : form.sourceBatchId ? '不一致' : '待载入'}</strong>
                </div>
              </div>
              <span className="readback-authority-lock">由后台按已批准建议、版本、范围与报表批次重新读取；页面不可修改。</span>
            </div>
            </section>
          </div>
        </div>

        <div hidden={activeStep !== 'approval'}>
          <div {...readbackStepPanelProps('approval')}>
            <section aria-label="审批凭证内容" className="readback-workbench-section">
            <dl className="readback-authority-grid" data-readback-approval-authority="main-derived">
              <div><dt>审批人</dt><dd>{form.approverName || '-'}</dd></div>
              <div><dt>审批时间</dt><dd>{form.approvalConfirmedAt || '-'}</dd></div>
              <div><dt>审批备注</dt><dd>{form.approvalNote || '无补充备注'}</dd></div>
            </dl>
            <div className="readback-capture-grid readback-capture-grid-single">
              <ReadbackCaptureTarget
                onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                disabled={authority.previewOnly || Boolean(activeAction)}
                id={firstScreenshotRepairSlot === 'approval' ? 'readback-first-missing-screenshot' : undefined}
                previewUrl={capturePreviews.approval}
                saving={captureSavingSlot === 'approval'}
                slot="approval"
                value={form.approvalArtifactPath}
              />
            </div>
            <div className="checkbox-grid">
              <label><input checked={form.operatorConfirmed} onChange={(event) => update({ operatorConfirmed: event.target.checked })} type="checkbox" /> 审批人确认范围</label>
              <label><input checked={form.realWriteApproved} onChange={(event) => update({ realWriteApproved: event.target.checked })} type="checkbox" /> 外部审批允许</label>
              <label><input checked={form.allowedByPolicy} onChange={(event) => update({ allowedByPolicy: event.target.checked })} type="checkbox" /> 低风险策略允许</label>
            </div>
            <p className="muted-line">审批允许只开放人工已批准的低风险动作；没有审批凭证、审批时间和明确允许时不能声称执行完成。</p>
            </section>
          </div>
        </div>

        <div hidden={activeStep !== 'evidence'}>
          <div
            {...readbackStepPanelProps('evidence')}
            className={`readback-step-panel ${readbackRepairPanelClass(Boolean(repairIntent), repairPulse)}`}
          >
            <section aria-label="执行与回读内容" className="readback-workbench-section">
              <p className="muted-line">先记录执行前值和截图，再记录执行后值和截图，最后刷新广告后台填写回读值和回读截图；三类截图不能复用。</p>
              <ReadbackContractStrip checks={contractChecks} />
              <div className="form-grid">
                <ReadbackFieldCell className={repairFieldClass('执行人')} label="执行人"><input value={form.executedBy} onChange={(event) => update({ executedBy: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行编号')} label="执行编号"><input value={form.executionId} onChange={(event) => update({ executionId: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行时间')} label="执行时间"><input value={form.executionExecutedAt} onChange={(event) => update({ executionExecutedAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行前值')} label="执行前值"><input value={form.beforeValue} onChange={(event) => update({ beforeValue: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行前时间')} label="执行前时间"><input value={form.beforeCapturedAt} onChange={(event) => update({ beforeCapturedAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行后值')} label="执行后值"><input value={form.afterValue} onChange={(event) => update({ afterValue: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行后时间')} label="执行后时间"><input value={form.afterCapturedAt} onChange={(event) => update({ afterCapturedAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('回读值')} label="回读值"><input id="readback-actual-value" value={form.readbackActualValue} onChange={(event) => update({ readbackActualValue: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('回读时间')} label="回读时间"><input value={form.readbackReadAt} onChange={(event) => update({ readbackReadAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('现场行证明', 'form-grid-wide')} label="现场行证明"><textarea value={form.liveBidSourceNote} onChange={(event) => update({ liveBidSourceNote: event.target.value })} /></ReadbackFieldCell>
              </div>
              <div className="readback-capture-grid">
                <ReadbackCaptureTarget
                  disabled={authority.previewOnly || Boolean(activeAction)}
                  id={firstScreenshotRepairSlot === 'before' ? 'readback-first-missing-screenshot' : undefined}
                  onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                  previewUrl={capturePreviews.before}
                  repairClassName={repairFieldClass('执行前截图')}
                  saving={captureSavingSlot === 'before'}
                  slot="before"
                  value={form.beforeScreenshotPath}
                />
                <ReadbackCaptureTarget
                  disabled={authority.previewOnly || Boolean(activeAction)}
                  id={firstScreenshotRepairSlot === 'after' ? 'readback-first-missing-screenshot' : undefined}
                  onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                  previewUrl={capturePreviews.after}
                  repairClassName={repairFieldClass('执行后截图')}
                  saving={captureSavingSlot === 'after'}
                  slot="after"
                  value={form.afterScreenshotPath}
                />
                <ReadbackCaptureTarget
                  disabled={authority.previewOnly || Boolean(activeAction)}
                  id={firstScreenshotRepairSlot === 'readback' ? 'readback-first-missing-screenshot' : undefined}
                  onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                  previewUrl={capturePreviews.readback}
                  repairClassName={repairFieldClass('回读证据')}
                  saving={captureSavingSlot === 'readback'}
                  slot="readback"
                  value={form.readbackEvidencePath}
                />
              </div>
            </section>
          </div>
        </div>

        <div hidden={activeStep !== 'verify-export'}>
          <div {...readbackStepPanelProps('verify-export')}>
            <section aria-label="最终校验内容" className="readback-workbench-section">
              <div className="checkbox-grid">
                <label><input checked={form.executionSuccess} onChange={(event) => update({ executionSuccess: event.target.checked })} type="checkbox" /> 执行成功确认</label>
                <label><input checked={form.executionVerified} onChange={(event) => update({ executionVerified: event.target.checked })} type="checkbox" /> 执行已核验</label>
                <label><input checked={form.readbackVerified} onChange={(event) => update({ readbackVerified: event.target.checked })} type="checkbox" /> 回读已核验</label>
              </div>
              <div className="business-split">
                <div>
                  <StatusPill tone={finalVerificationPassed || !missing.length ? 'ready' : 'blocked'}>
                    {finalVerificationPassed ? '最终校验通过' : precheckCopy.statusLabel}
                  </StatusPill>
                  {finalVerificationPassed ? (
                    <div className="chip-row">
                      <span className="chip chip-ready">最终证据已核对</span>
                    </div>
                  ) : missing.length ? (
                    <div className="missing-group-grid">
                      {missingGroups.map((group) => (
                        <div className="missing-group" key={group.title}>
                          <strong>{group.title}</strong>
                          <span>{group.items.join('、')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="chip-row">
                      <span className="chip chip-ready">{precheckCopy.chipLabel}</span>
                    </div>
                  )}
                </div>
              </div>
              <p className="muted-line">
                {finalVerificationPassed
                  ? '最终证据已通过后台批准记录、当前报表批次与现场证据核对。'
                  : precheckCopy.helperText}
              </p>
              {message && <p className={message.includes('失败') ? 'blocked-line' : 'muted-line'}>{message}</p>}
            </section>
          </div>
        </div>
        </fieldset>
        </WorkbenchPanel>

        <ResponsiveInspector
          open={technicalInspectorOpen}
          title="技术与证据详情"
          description="只在需要追踪本地证据、verifier 或 NEEDS_WORK 工作包时查看；此处不会自动执行广告或代填证据。"
          busy={technicalInspectorLocked}
          dismissDisabled={technicalInspectorLocked}
          onClose={() => setTechnicalInspectorOpen(false)}
        >
          <div className="readback-technical-drawer">
            <section className="readback-technical-section" aria-labelledby="readback-technical-export-title">
              <h3 id="readback-technical-export-title">导出结果与权威路径</h3>
              {exportResult ? (
                <div className="export-result-card">
                  <div>
                    <span>导出状态</span>
                    <strong>{completedViaWorkPackage
                      ? '初始缺口已由工作包补齐并通过校验'
                      : exportResult.readyForVerifier ? '可进入最终验收' : '已导出但仍需补证据'}</strong>
                  </div>
                  <div>
                    <span>执行范围</span>
                    <strong>{[form.storeName, form.marketplaceCode, form.campaignName, form.adGroupName, form.entityName].filter(Boolean).join(' / ') || '未完整填写'}</strong>
                  </div>
                  <div>
                    <span>证据文件</span>
                    <code>{exportResult.jsonPath || '-'}</code>
                  </div>
                  <div>
                    <span>说明文件</span>
                    <code>{exportResult.markdownPath || '-'}</code>
                  </div>
                  <div>
                    <span>SHA-256</span>
                    <code>{exportResult.sha256 || '-'}</code>
                  </div>
                  <p>{completedViaWorkPackage
                    ? '初始缺口已通过工作包补齐；该流程只写入本地证据文件，不会提交 Amazon。'
                    : '该导出只写入本地证据文件，不会提交 Amazon。下一步：补齐缺失项后重新导出，或到“交付验收”查看最终缺口。'}</p>
                  <button aria-busy={openExportButton.ariaBusy} className={openExportButton.className} disabled={openExportButton.disabled} onClick={openExport} type="button">
                    {readbackActionButtonContent(openExportButton)}
                  </button>
                </div>
              ) : (
                <p className="muted-line">导出后这里显示本地证据文件和说明文件路径。</p>
              )}
            </section>

            <section className="readback-technical-section" aria-labelledby="readback-technical-session-title">
              <h3 id="readback-technical-session-title">NEEDS_WORK 工作包</h3>
              <div className="business-split">
                <div>
                  <div className="business-scope-line">工作包状态：{completedViaWorkPackage ? '已补齐并通过最终校验' : readbackSessionSummary(exportResult?.jsonPath)}</div>
                  <p className="muted-line">真实广告动作只按单个已批准建议处理；工作包用于把审批、执行前、执行后和刷新回读证据分目录收齐。</p>
                </div>
                <StatusPill tone={completedViaWorkPackage ? 'ready' : exportResult?.jsonPath ? 'pending' : 'blocked'}>
                  {completedViaWorkPackage ? '补证完成' : exportResult?.jsonPath ? '可创建工作包' : '先导出回读证据'}
                </StatusPill>
              </div>
              <div className="action-row">
                <button aria-busy={prepareSessionButton.ariaBusy} className={prepareSessionButton.className} disabled={prepareSessionButton.disabled} onClick={prepareSessionPacket} type="button">
                  {readbackActionButtonContent(prepareSessionButton)}
                </button>
                <button aria-busy={verifySessionButton.ariaBusy} className={verifySessionButton.className} disabled={verifySessionButton.disabled} onClick={verifySessionPacket} type="button">
                  {readbackActionButtonContent(verifySessionButton)}
                </button>
                <button aria-busy={fillSessionButton.ariaBusy} className={fillSessionButton.className} disabled={fillSessionButton.disabled} onClick={fillSessionPacket} type="button">
                  {readbackActionButtonContent(fillSessionButton)}
                </button>
                <button aria-busy={verifyEvidenceButton.ariaBusy} className={verifyEvidenceButton.className} disabled={verifyEvidenceButton.disabled} onClick={() => { void verifyReadbackEvidence(); }} type="button">
                  {readbackActionButtonContent(verifyEvidenceButton)}
                </button>
              </div>
              <section className="readback-technical-subsection" aria-labelledby="readback-session-steps-title">
                <h4 id="readback-session-steps-title">工作包内要做什么</h4>
                <div className="business-scope-line">工作包目录：{sessionWorkflow.sessionDir}</div>
                <ol className="readback-session-list">
                  {sessionWorkflow.steps.map((step, index) => (
                    <li key={step}>
                      <span>{index + 1}</span>
                      <p>{step}</p>
                    </li>
                  ))}
                </ol>
                <p className="muted-line">{sessionWorkflow.warning}</p>
              </section>
              {sessionResult && (
                <section className="readback-technical-subsection" aria-labelledby="readback-session-paths-title">
                  <h4 id="readback-session-paths-title">工作包路径</h4>
                  <div className="readback-session-result">
                    <div>
                      <span>工作包目录</span>
                      <code>{sessionResult.sessionDir || '-'}</code>
                    </div>
                    <div>
                      <span>填写文件</span>
                      <code>{sessionResult.sessionInputPath || '-'}</code>
                    </div>
                    <div>
                      <span>填写说明</span>
                      <code>{sessionResult.sessionInputGuidePath || '-'}</code>
                    </div>
                    <div>
                      <span>操作清单</span>
                      <code>{sessionResult.checklistPath || '-'}</code>
                    </div>
                    <div>
                      <span>最终证据输出</span>
                      <code>{sessionResult.passEvidencePath || '-'}</code>
                    </div>
                  </div>
                  <div className="action-row">
                    <button aria-busy={openSessionPacketButton.ariaBusy} className={openSessionPacketButton.className} disabled={openSessionPacketButton.disabled} onClick={openSessionPacket} type="button">
                      {readbackActionButtonContent(openSessionPacketButton)}
                    </button>
                    <button aria-busy={openSessionInputFileButton.ariaBusy} className={openSessionInputFileButton.className} disabled={openSessionInputFileButton.disabled} onClick={openSessionInputFile} type="button">
                      {readbackActionButtonContent(openSessionInputFileButton)}
                    </button>
                    <button aria-busy={openSessionInputGuideButton.ariaBusy} className={openSessionInputGuideButton.className} disabled={openSessionInputGuideButton.disabled} onClick={openSessionInputGuide} type="button">
                      {readbackActionButtonContent(openSessionInputGuideButton)}
                    </button>
                  </div>
                </section>
              )}
              {sessionCheck && (
                <div className={`readback-session-check ${sessionCheckCopy(sessionCheck).className}`}>
                  <strong>{sessionCheckCopy(sessionCheck).title}</strong>
                  <span>{sessionCheckCopy(sessionCheck).detail}</span>
                  {sessionCheck.ready && !sessionCheck.captureReady && (
                    <p className="muted-line">检查工作包只证明目录和文件结构安全；还必须填写现场信息并生成最终证据后，才可能进入最终验收。</p>
                  )}
                  {!sessionCheck.ready && Array.isArray(sessionCheck.issues) && (
                    <ul>
                      {sessionCheck.issues.map((issue: string) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {sessionFillResult && (
                <div className={`readback-session-check ${sessionFillResult.readyForVerifier ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                  <strong>{completedViaWorkPackage ? '回读证据已生成并通过校验' : sessionFillResult.readyForVerifier ? '回读证据已生成，待最终校验' : '回读证据仍未就绪'}</strong>
                  <span>{completedViaWorkPackage
                    ? '已根据填写文件生成证据，并通过最终校验；最终交付状态仍由最终验收汇总决定。'
                    : sessionFillResult.readyForVerifier ? '已根据填写文件生成证据文件；最终可交付仍必须通过本地回读证据校验和最终验收汇总。' : '填写文件或证据文件仍有缺口，不能进入最终验收。'}</span>
                  <div className="readback-session-result readback-session-result-embedded">
                    <div>
                      <span>证据文件</span>
                      <code>{sessionFillResult.jsonPath || '-'}</code>
                    </div>
                    <div>
                      <span>说明文件</span>
                      <code>{sessionFillResult.markdownPath || '-'}</code>
                    </div>
                  </div>
                  {Array.isArray(sessionFillResult.issues) && sessionFillResult.issues.length > 0 && (
                    <ul>
                      {sessionFillResult.issues.map((issue: string) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {sessionVerifyResult && (
                <div className={`readback-session-check ${readbackVerifierPassed(sessionVerifyResult) ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                  <strong>{readbackVerifierPassed(sessionVerifyResult) ? '回读证据校验已通过' : '回读证据校验未通过'}</strong>
                  <span>{readbackVerifierPassed(sessionVerifyResult) ? '这份证据已通过本地回读证据校验；最终可交付仍需进入最终验收汇总。' : '这份证据还不能进入最终验收汇总，请按下列缺口补证据后重新生成或重新校验。'}</span>
                  <div className="readback-session-result readback-session-result-embedded">
                    <div>
                      <span>校验文件</span>
                      <code>{sessionVerifyResult.evidencePath || '-'}</code>
                    </div>
                    <div>
                      <span>状态</span>
                      <strong>{readbackVerifierPassed(sessionVerifyResult) ? '通过' : '需补证据'}</strong>
                    </div>
                  </div>
                  {!readbackVerifierPassed(sessionVerifyResult) && Array.isArray(sessionVerifyResult.issues) && sessionVerifyResult.issues.length > 0 && (
                    <ul>
                      {sessionVerifyResult.issues.map((issue: string) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {copyNotice && <p className="muted-line">{copyNotice}</p>}
            </section>

            <section className="readback-technical-section" aria-labelledby="readback-technical-verifier-title">
              <h3 id="readback-technical-verifier-title">Verifier、哈希与备用命令</h3>
              <ul className="readback-safety-gates" aria-label="最终校验安全门">
                <li>仅 Main 可从 approved recommendation、revision、scope 与 batch 派生权威身份。</li>
                <li>审批、执行前、执行后与回读截图必须独立，时间顺序必须可追溯。</li>
                <li>只有 verifier 返回 ready=true 且 status=PASS 才广播回读已验证。</li>
              </ul>
              <p>最终验收仍以本地证据文件、截图路径、时间顺序和最终验收汇总为准；业务页不展示长命令块。</p>
              <p>真实执行路径保持 fail-closed：没有审批、执行前、执行后、回读证据时不能声称执行完成。</p>
              <div className="action-row">
                <button aria-busy={prepareCopyCommandButton.ariaBusy} className={prepareCopyCommandButton.className} disabled={prepareCopyCommandButton.disabled} onClick={() => copySessionCommand('prepare')} type="button">
                  {readbackActionButtonContent(prepareCopyCommandButton)}
                </button>
                <button aria-busy={verifyCopyCommandButton.ariaBusy} className={verifyCopyCommandButton.className} disabled={verifyCopyCommandButton.disabled} onClick={() => copySessionCommand('verify')} type="button">
                  {readbackActionButtonContent(verifyCopyCommandButton)}
                </button>
                <button aria-busy={fillCopyCommandButton.ariaBusy} className={fillCopyCommandButton.className} disabled={fillCopyCommandButton.disabled} onClick={() => copySessionCommand('fill')} type="button">
                  {readbackActionButtonContent(fillCopyCommandButton)}
                </button>
                <button aria-busy={longFillCopyCommandButton.ariaBusy} className={longFillCopyCommandButton.className} disabled={longFillCopyCommandButton.disabled} onClick={copyFillCommand} type="button">
                  {readbackActionButtonContent(longFillCopyCommandButton)}
                </button>
              </div>
              {copyNotice && <p className="muted-line">{copyNotice}</p>}
            </section>
          </div>
        </ResponsiveInspector>
      </div>

      </PageFrame>
    </div>
  );
}
