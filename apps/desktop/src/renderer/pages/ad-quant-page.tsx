import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { TagMetricGroup } from '../components/tag-metric-group';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { VirtualDataTable, type VirtualDataTableColumn } from '../components/virtual-data-table';
import { ResponsiveInspector, TaskBanner, WorkbenchPanel, WorkspaceState } from '../components/workspace';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { buildAdQuantProductGroups, filterAdQuantByProduct, productGroupScopePatch } from '../ad-quant-product-groups';
import { buildAdQuantDiagnosisSummary, formatEvidenceRefSummary, operatorFacingAdQuantReason } from '../evidence-display';
import { formatPercent, formatUsd } from '../formatters';
import { operatorFacingAiError } from '../ai-call-diagnostics';
import { buildRecommendationGateIssues, resolveRecommendationBatchId } from '../recommendation-readiness';
import { hasRealReportCoverage, importedReportTypeCoverageCount, realReportCoverageCount } from '../report-coverage';
import { countProductsWithTargets, normalizeProductContexts } from '../product-context';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type { AdStrategyDiagnosisView, AiDiagnosisRunView, AiEvidenceDisplayItemView, AppRoute, BusinessQuantDiagnostic, BusinessQuantTimeline, OperationScope, SettingsRuleConfig } from '../types';
import { runWorkflowInvalidatingMutation } from '../workflow-invalidation';
import type { WorkflowEventTarget } from '../workflow-invalidation';
import {
  buildDiagnosisDataRemediationAction,
  buildDiagnosisQueueRows,
  buildDiagnosisWorkspaceModel,
  type DiagnosisQueueRow,
} from './diagnosis-workspace-model';

const DEFAULT_QUANT_RULE_CONFIG: Pick<SettingsRuleConfig, 'targetAcos' | 'highAcosThreshold' | 'noOrderClickThreshold' | 'minSpend'> = {
  targetAcos: 0.25,
  highAcosThreshold: 0.4,
  noOrderClickThreshold: 30,
  minSpend: 10,
};

export function runAdQuantDiagnosisWorkflowMutation<T>(
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
): Promise<T> {
  return runWorkflowInvalidatingMutation('ad-quant-diagnosis', task, target);
}

export type AdQuantMetricFocus = 'all' | 'high_acos' | 'waste' | 'orders' | 'scale' | 'review';

type StatusTone = 'ready' | 'pending' | 'blocked' | 'warning';

export interface AdQuantDecisionStatus {
  aiLabel: string;
  aiDetail: string;
  aiTone: StatusTone;
  ruleLabel: string;
  ruleDetail: string;
  ruleTone: StatusTone;
  actionLabel: string;
  actionDetail: string;
  actionTone: StatusTone;
  primaryActionLabel: string;
}

export interface StrategyRunFeedback {
  visible: boolean;
  title: string;
  detail: string;
  statusLabel: string;
  tone: StatusTone;
  className: string;
  ariaBusy?: boolean;
  radarVisible?: boolean;
  primaryAction?: StrategyRunFeedbackAction;
  secondaryAction?: StrategyRunFeedbackAction;
}

export interface StrategyRunFeedbackAction {
  label: string;
  target: 'run-ai' | 'settings' | 'data-collection' | 'data-import-validation' | 'recommendations';
}

interface AdQuantActionButtonInput {
  active: boolean;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
  idleLabel: string;
}

export interface AdQuantActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function adQuantActionButtonView(input: AdQuantActionButtonInput): AdQuantActionButtonView {
  const active = Boolean(input.active);
  return {
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || active || (input.groupBusy && !active)),
    label: active ? input.busyLabel : input.idleLabel,
    showSpinner: active,
  };
}

function adQuantActionButtonContent(view: AdQuantActionButtonView) {
  if (!view.showSpinner) return view.label;
  return (
    <span className="button-content">
      <span aria-hidden="true" className="button-spinner" />
      <span>{view.label}</span>
    </span>
  );
}

export interface WasteRiskSpendTile {
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRuleConfig(config: Partial<SettingsRuleConfig> | null | undefined) {
  return {
    targetAcos: readNumber(config?.targetAcos, DEFAULT_QUANT_RULE_CONFIG.targetAcos),
    highAcosThreshold: readNumber(config?.highAcosThreshold, DEFAULT_QUANT_RULE_CONFIG.highAcosThreshold),
    noOrderClickThreshold: readNumber(config?.noOrderClickThreshold, DEFAULT_QUANT_RULE_CONFIG.noOrderClickThreshold),
    minSpend: readNumber(config?.minSpend, DEFAULT_QUANT_RULE_CONFIG.minSpend),
  };
}

export function adQuantFocusLabel(focus: AdQuantMetricFocus): string {
  const labels: Record<AdQuantMetricFocus, string> = {
    all: '全部诊断对象',
    high_acos: '高 ACOS 对象',
    waste: '无订单浪费对象',
    orders: '已出单对象',
    scale: '可扩量对象',
    review: '待复核对象',
  };
  return labels[focus];
}

export function adQuantDiagnosticMatchesFocus(
  row: BusinessQuantDiagnostic,
  focus: AdQuantMetricFocus,
  config: Pick<SettingsRuleConfig, 'highAcosThreshold' | 'noOrderClickThreshold' | 'minSpend'>,
): boolean {
  if (focus === 'all') return true;
  if (focus === 'high_acos') return row.acos >= config.highAcosThreshold && row.spend >= config.minSpend;
  if (focus === 'waste') return row.quantStatus === 'waste' || (row.orders === 0 && (row.spend >= config.minSpend || row.clicks >= config.noOrderClickThreshold));
  if (focus === 'orders') return row.orders > 0;
  if (focus === 'scale') return row.quantStatus === 'scale';
  if (focus === 'review') return row.quantStatus === 'watch' || row.quantStatus === 'blocked' || row.severity === 'medium' || row.severity === 'high';
  return true;
}

export function adQuantTimelineMatchesFocus(
  timeline: BusinessQuantTimeline,
  focus: AdQuantMetricFocus,
  config: Pick<SettingsRuleConfig, 'highAcosThreshold' | 'noOrderClickThreshold' | 'minSpend'>,
): boolean {
  if (focus === 'all') return true;
  if (focus === 'high_acos') return timeline.totals.acos >= config.highAcosThreshold && timeline.totals.cost >= config.minSpend;
  if (focus === 'waste') return timeline.quantStatus === 'waste' || (timeline.totals.orders === 0 && (timeline.totals.cost >= config.minSpend || timeline.totals.clicks >= config.noOrderClickThreshold));
  if (focus === 'orders') return timeline.totals.orders > 0;
  if (focus === 'scale') return timeline.quantStatus === 'scale';
  if (focus === 'review') return timeline.reviewRequired || timeline.quantStatus === 'watch' || timeline.quantStatus === 'blocked';
  return true;
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function quantSourceLabel(source?: string): string {
  if (source === 'canonical_advertised_product') return '推广商品报表口径';
  if (source === 'canonical_ad_group') return '广告组报表口径';
  if (source === 'canonical_user_search_term') return '用户搜索词权威口径';
  if (source === 'canonical_search_term') return '搜索词总盘口径';
  if (source === 'actionable_fallback') return '可行动报表近似口径';
  return '未形成量化口径';
}

function quantSourceDescription(source?: string): string {
  if (source === 'canonical_advertised_product') return '总盘使用推广商品报表汇总，优先对齐领星 ERP 广告效果的 ASIN 级花费、销售、订单和点击。';
  if (source === 'canonical_ad_group') return '总盘使用广告组报表汇总，优先对齐领星 ERP 广告效果的花费、销售、订单和点击。';
  if (source === 'canonical_user_search_term') return '总盘使用用户搜索词报表汇总，避免广告活动/广告组/投放位置等报表重复累加。';
  if (source === 'canonical_search_term') return '总盘使用搜索词报表汇总，避免广告活动/广告组/投放位置等报表重复累加。';
  if (source === 'actionable_fallback') return '未找到推广商品、广告组或搜索词权威总表，暂用关键词、商品投放和自动投放等可行动报表近似汇总。';
  return '当前范围缺少真实原始报表或导入指标，不能计算广告表现。';
}

export function buildQuantAccountingLine(input: {
  summarySource?: string;
  batchIds?: string[];
  asin?: string;
  canonicalRows?: number;
}): string {
  const batchText = input.batchIds?.length ? input.batchIds.join('、') : '当前匹配批次';
  const asinText = input.asin ? `，只筛选 ASIN ${input.asin}` : '';
  const rowText = Number(input.canonicalRows || 0) > 0 ? `，可加总 ${input.canonicalRows} 行` : '';
  return `当前总盘只读取 ${batchText} 的 ${quantSourceLabel(input.summarySource)}${asinText}${rowText}；重复采集按批次隔离，不跨批次、不跨报表层级重复相加。`;
}

export function buildWasteRiskSpendTile(input: {
  wastedSpend?: number | null;
  totalSpend?: number | null;
  highRiskCount?: number | null;
}): WasteRiskSpendTile {
  const hasWastedSpend = typeof input.wastedSpend === 'number' && Number.isFinite(input.wastedSpend);
  const totalSpend = typeof input.totalSpend === 'number' && Number.isFinite(input.totalSpend) ? input.totalSpend : 0;
  const highRiskCount = Math.max(0, Number(input.highRiskCount || 0));

  if (!hasWastedSpend) {
    return {
      label: '浪费/高风险花费',
      value: '待日级数据',
      detail: '先导入 8 类真实报表后显示金额占比。',
      tone: 'pending',
    };
  }

  const wastedSpend = Math.max(0, Number(input.wastedSpend));
  const riskText = highRiskCount > 0 ? `${highRiskCount} 个高风险对象` : '暂无高风险对象';
  const ratioText = totalSpend > 0
    ? `占当前产品花费 ${formatPercent((wastedSpend / totalSpend) * 100)}`
    : '当前产品花费为 0，暂不计算占比';

  return {
    label: '浪费/高风险花费',
    value: formatUsd(wastedSpend),
    detail: `${ratioText}；${riskText}`,
    tone: wastedSpend > 0 || highRiskCount > 0 ? 'blocked' : 'ready',
  };
}

function feedbackClassName(tone: StatusTone): string {
  if (tone === 'ready') return 'collection-action-feedback collection-action-feedback-ready';
  if (tone === 'blocked' || tone === 'warning') return 'collection-action-feedback collection-action-feedback-blocked';
  return 'collection-action-feedback';
}

function isAiOutputContractFallback(reason: string): boolean {
  return /JSON|格式|schemaVersion|输出契约|固定输出|解析|校验/i.test(reason);
}

export function buildStrategyRunFeedback(input: {
  canDiagnose: boolean;
  loading: boolean;
  realReportCount?: number;
  importedReportTypeCount?: number;
  requiredReportCount?: number;
  error?: string;
  diagnosis?: AdStrategyDiagnosisView | null;
  lastRunAt?: string;
}): StrategyRunFeedback {
  if (!input.canDiagnose) {
    const requiredReportCount = Math.max(1, Number(input.requiredReportCount || 8));
    const realReportCount = Math.max(0, Number(input.realReportCount || 0));
    const importedReportTypeCount = Math.max(0, Number(input.importedReportTypeCount || 0));
    const remediationAction = buildDiagnosisDataRemediationAction({
      realReportCount,
      requiredReportCount,
    });
    return {
      visible: true,
      title: 'AI 暂不可运行',
      detail: realReportCount >= requiredReportCount
        ? `报表文件 ${realReportCount}/${requiredReportCount} 已齐，逐类入库 ${importedReportTypeCount}/${requiredReportCount}；先补齐逐类入库后再运行 AI。系统不会用空数据或审计文件调用 AI。`
        : `报表文件 ${realReportCount}/${requiredReportCount}、逐类入库 ${importedReportTypeCount}/${requiredReportCount}；先补齐真实报表后再运行 AI。系统不会用空数据或审计文件调用 AI。`,
      statusLabel: '待数据',
      tone: 'blocked',
      className: feedbackClassName('blocked'),
      primaryAction: { label: remediationAction.label, target: remediationAction.target },
    };
  }
  if (input.loading) {
    return {
      visible: true,
      title: 'AI 阶段分析运行中',
      detail: '正在调用模型、校验证据引用并生成阶段判断；完成或失败都会在这里显示。',
      statusLabel: '运行中',
      tone: 'pending',
      className: `${feedbackClassName('pending')} ad-quant-strategy-feedback-running`,
      ariaBusy: true,
      radarVisible: true,
    };
  }
  if (input.error) {
    return {
      visible: true,
      title: 'AI 阶段分析失败',
      detail: input.error,
      statusLabel: '需处理',
      tone: 'blocked',
      className: feedbackClassName('blocked'),
      primaryAction: { label: '重新运行 AI', target: 'run-ai' },
      secondaryAction: { label: '检查 AI 设置', target: 'settings' },
    };
  }
  if (!input.diagnosis) {
    return {
      visible: true,
      title: 'AI 尚未运行',
      detail: '点击“运行大模型深度诊断”后，本页会显示运行中、完成结果、失败原因和下一步动作。',
      statusLabel: '未运行',
      tone: 'pending',
      className: feedbackClassName('pending'),
      primaryAction: { label: '运行 AI 诊断', target: 'run-ai' },
      secondaryAction: { label: '检查 AI 设置', target: 'settings' },
    };
  }

  const source = input.diagnosis.summary.source;
  const aiCandidateCount = Number(input.diagnosis.summary.aiCandidateCount || 0);
  const insightOnlyCount = Number(input.diagnosis.summary.insightOnlyCandidateCount || 0);
  const evidenceCount = Number(input.diagnosis.summary.evidencePackSummary?.total || 0);
  const runTime = input.lastRunAt ? `；最近完成 ${input.lastRunAt.replace('T', ' ').slice(0, 16)}` : '';
  if (source === 'ai') {
    return {
      visible: true,
      title: 'AI 阶段分析已完成',
      detail: `模型 ${input.diagnosis.model} 已返回 ${aiCandidateCount} 条 AI 候选、${insightOnlyCount} 条仅洞察，引用 ${evidenceCount} 条证据${runTime}。结果已显示在本页下方。`,
      statusLabel: 'AI 已完成',
      tone: 'ready',
      className: feedbackClassName('ready'),
      primaryAction: { label: '进入优化建议', target: 'recommendations' },
    };
  }

  const fallbackReason = input.diagnosis.summary.fallbackReason || 'AI 输出没有通过证据校验。';
  if (isAiOutputContractFallback(fallbackReason)) {
    return {
      visible: true,
      title: '上次 AI 输出契约失败，等待重新运行',
      detail: `上次模型返回未通过结构化 JSON 校验，已保留规则量化结果。当前版本会按 8192 token 下限和 JSON 示例契约重新调用 ${input.diagnosis.model || 'AI 模型'}；点击重新运行验证${runTime}。`,
      statusLabel: '待复测',
      tone: 'warning',
      className: feedbackClassName('warning'),
      primaryAction: { label: '重新运行 AI', target: 'run-ai' },
      secondaryAction: { label: '检查 AI 设置', target: 'settings' },
    };
  }

  return {
    visible: true,
    title: 'AI 阶段分析已完成，当前使用规则兜底',
    detail: `${operatorFacingAdQuantReason(fallbackReason)} 当前仍保留规则量化结果和人工复核入口${runTime}。`,
    statusLabel: '规则兜底',
    tone: 'warning',
    className: feedbackClassName('warning'),
    primaryAction: { label: '生成规则建议', target: 'recommendations' },
    secondaryAction: { label: '重新运行 AI', target: 'run-ai' },
  };
}

export function strategyDiagnosisSourceLabel(source?: string): string {
  return source === 'ai' ? 'AI 已分析' : '规则兜底';
}

export function strategyThresholdTitle(source?: string): string {
  return source === 'ai' ? 'AI 动态阈值建议' : '规则兜底阈值建议';
}

function lifecycleLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '测词',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    declining_repair: '异常修复',
    unknown: '阶段待判定',
  };
  return labels[stage || 'unknown'] || stage || '阶段待判定';
}

function quantStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    healthy: '健康',
    watch: '观察',
    waste: '浪费风险',
    scale: '可扩量',
    blocked: '样本不足',
  };
  return labels[status || 'blocked'] || status || '样本不足';
}

function trendLabel(value?: string): string {
  const labels: Record<string, string> = {
    up: '上升',
    down: '下降',
    flat: '平稳',
    insufficient: '样本不足',
  };
  return labels[value || 'insufficient'] || '样本不足';
}

function maxDailyCost(daily: Array<{ cost: number }>): number {
  return Math.max(1, ...daily.map((item) => Number(item.cost || 0)));
}

function timelineTone(timeline: BusinessQuantTimeline): 'ready' | 'warning' | 'blocked' | 'pending' {
  if (timeline.quantStatus === 'waste') return 'blocked';
  if (timeline.quantStatus === 'scale') return 'ready';
  if (timeline.reviewRequired || timeline.quantStatus === 'watch') return 'warning';
  return 'pending';
}

function thresholdLine(timeline: BusinessQuantTimeline): string {
  return [
    `目标 ACOS ${formatPercent(Number(timeline.thresholds.targetAcos || 0) * 100)}`,
    `高风险 ${formatPercent(Number(timeline.thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(timeline.thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(timeline.thresholds.minSpend)}`,
  ].join(' / ');
}

function thresholdSourceLine(): string {
  return '来源：当前规则配置；AI 动态阈值在“优化建议”生成时结合运营事件、产品阶段和每日趋势复核。';
}

function ruleThresholdSummary(config: ReturnType<typeof normalizeRuleConfig>): string {
  return [
    `目标 ACOS ${formatPercent(config.targetAcos * 100)}`,
    `高风险 ${formatPercent(config.highAcosThreshold * 100)}`,
    `无订单 ${config.noOrderClickThreshold} 点击`,
    `最低花费 ${formatUsd(config.minSpend)}`,
  ].join(' / ');
}

function priorityReason(row: BusinessQuantDiagnostic, config: ReturnType<typeof normalizeRuleConfig>): string {
  if (row.orders === 0 && row.spend >= config.minSpend) return `花费达到 ${formatUsd(config.minSpend)} 仍无订单`;
  if (row.orders === 0 && row.clicks >= config.noOrderClickThreshold) return `点击达到 ${config.noOrderClickThreshold} 仍无订单`;
  if (row.acos >= config.highAcosThreshold && row.spend >= config.minSpend) return `ACOS 高于 ${formatPercent(config.highAcosThreshold * 100)}`;
  if (row.orders > 0 && row.acos <= config.targetAcos) return `ACOS 低于目标 ${formatPercent(config.targetAcos * 100)}`;
  if (row.clicks > 0 && row.sales === 0) return '有点击无销售';
  return '需人工复核相关性';
}

function priorityScore(row: BusinessQuantDiagnostic, config: ReturnType<typeof normalizeRuleConfig>): number {
  const noOrderPenalty = row.orders === 0 && (row.spend >= config.minSpend || row.clicks >= config.noOrderClickThreshold) ? 10000 : 0;
  const highAcosPenalty = row.acos >= config.highAcosThreshold && row.spend >= config.minSpend ? 5000 : 0;
  return noOrderPenalty + highAcosPenalty + row.spend + row.clicks * 0.1;
}

function aiThresholdValueLabel(key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'], value: number): string {
  if (key === 'targetAcos' || key === 'highAcosThreshold') return formatPercent(value * 100);
  if (key === 'minSpend') return formatUsd(value);
  return `${Math.round(value)} 点击`;
}

function aiThresholdLabel(key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']): string {
  const labels: Record<keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'], string> = {
    targetAcos: '目标 ACOS',
    highAcosThreshold: '高风险 ACOS',
    noOrderClickThreshold: '无订单点击',
    minSpend: '最低花费',
  };
  return labels[key];
}

function ruleThresholdValue(config: ReturnType<typeof normalizeRuleConfig>, key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']): number {
  if (key === 'targetAcos') return config.targetAcos;
  if (key === 'highAcosThreshold') return config.highAcosThreshold;
  if (key === 'noOrderClickThreshold') return config.noOrderClickThreshold;
  return config.minSpend;
}

function thresholdDeltaLabel(
  key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'],
  ruleValue: number,
  aiValue: number,
): string {
  const delta = aiValue - ruleValue;
  if (Math.abs(delta) < 0.0001) return '与规则一致';
  const prefix = delta > 0 ? 'AI 更宽松' : 'AI 更严格';
  if (key === 'targetAcos' || key === 'highAcosThreshold') return `${prefix} ${formatPercent(Math.abs(delta) * 100)}`;
  if (key === 'minSpend') return `${prefix} ${formatUsd(Math.abs(delta))}`;
  return `${prefix} ${Math.round(Math.abs(delta))} 点击`;
}

function aiFallbackMessage(diagnosis: AdStrategyDiagnosisView | null): string {
  if (!diagnosis || diagnosis.summary.source === 'ai') return '';
  if (diagnosis.summary.fallbackReason?.includes('未配置 AI Key')) {
    return 'AI 未连接：当前只使用规则量化。可在设置页测试 DeepSeek 后重新分析。';
  }
  if (diagnosis.summary.fallbackReason) {
    return `AI 未参与：${operatorFacingAdQuantReason(diagnosis.summary.fallbackReason)}。当前只使用规则量化。`;
  }
  return 'AI 未参与：当前只使用规则量化。';
}

export function buildAdQuantDecisionStatus(input: {
  canDiagnose: boolean;
  canGenerateFormalRecommendations: boolean;
  diagnosticCount: number;
  diagnosis?: AdStrategyDiagnosisView['summary'] | null;
}): AdQuantDecisionStatus {
  if (!input.canDiagnose) {
    return {
      aiLabel: '未调用',
      aiDetail: '真实报表和 DB 指标未闭合，系统不会调用 AI。',
      aiTone: 'pending',
      ruleLabel: '待数据',
      ruleDetail: '先补齐真实报表和导入指标。',
      ruleTone: 'blocked',
      actionLabel: '建议锁定',
      actionDetail: '不能用空数据或审计文件生成建议。',
      actionTone: 'blocked',
      primaryActionLabel: '补齐数据后再生成',
    };
  }

  if (!input.diagnosticCount) {
    return {
      aiLabel: input.diagnosis?.source === 'ai' ? '已分析' : '未采纳',
      aiDetail: input.diagnosis?.source === 'ai' ? 'AI 已返回阶段判断，但当前没有可执行诊断对象。' : '当前没有可执行对象，AI 不进入正式建议。',
      aiTone: input.diagnosis?.source === 'ai' ? 'ready' : 'pending',
      ruleLabel: '已完成',
      ruleDetail: '规则量化已完成，但没有 keyword、search term 或 target 对象可生成动作。',
      ruleTone: 'warning',
      actionLabel: '缺少可建议对象',
      actionDetail: '请先复核报表类型和广告对象粒度。',
      actionTone: 'blocked',
      primaryActionLabel: '缺少诊断对象',
    };
  }

  if (!input.canGenerateFormalRecommendations) {
    return {
      aiLabel: input.diagnosis?.source === 'ai' ? '已分析' : '未采纳',
      aiDetail: input.diagnosis?.source === 'ai' ? 'AI 已返回阶段判断，但正式建议门槛未放行。' : 'AI 当前不进入正式建议。',
      aiTone: input.diagnosis?.source === 'ai' ? 'warning' : 'pending',
      ruleLabel: '已完成',
      ruleDetail: '规则量化可复核，正式建议仍被数据门槛锁定。',
      ruleTone: 'warning',
      actionLabel: '建议锁定',
      actionDetail: '先补齐当前范围真实报表、DB 指标和可建议对象。',
      actionTone: 'blocked',
      primaryActionLabel: '建议锁定',
    };
  }

  const aiAccepted = input.diagnosis?.source === 'ai'
    && input.diagnosis.lifecycleStageRequiresReview !== true
    && input.diagnosis.evidenceSufficiency?.canUseForFormalActions !== false;
  if (aiAccepted) {
    return {
      aiLabel: '已采纳',
      aiDetail: 'AI 阶段判断和证据引用已通过，可参与建议生成。',
      aiTone: 'ready',
      ruleLabel: '已完成',
      ruleDetail: '规则量化继续作为确定性安全边界。',
      ruleTone: 'ready',
      actionLabel: '可生成 AI+规则建议',
      actionDetail: '进入建议页后仍需审批和结果核对。',
      actionTone: 'ready',
      primaryActionLabel: '生成 AI+规则建议',
    };
  }

  if (input.diagnosis?.source === 'ai') {
    return {
      aiLabel: '需复核',
      aiDetail: 'AI 已返回判断，但证据引用或样本门槛不足，暂不参与正式建议。',
      aiTone: 'warning',
      ruleLabel: '已完成',
      ruleDetail: '当前可先用规则量化继续生成建议。',
      ruleTone: 'ready',
      actionLabel: '可生成规则建议',
      actionDetail: '需要 AI 参与时，先补齐证据后重新运行阶段分析。',
      actionTone: 'warning',
      primaryActionLabel: '生成规则建议',
    };
  }

  return {
    aiLabel: input.diagnosis ? '未采纳' : '未运行',
    aiDetail: input.diagnosis
      ? 'AI 没有通过当前输出或证据检查，系统未采纳其判断。'
      : '还没有运行 AI 阶段分析，当前只使用规则量化。',
    aiTone: input.diagnosis ? 'warning' : 'pending',
    ruleLabel: '已完成',
    ruleDetail: '规则量化已完成，可作为兜底建议来源。',
    ruleTone: 'ready',
    actionLabel: '可生成规则建议',
    actionDetail: '按钮不会执行广告动作，只进入建议页等待审批。',
    actionTone: 'ready',
    primaryActionLabel: '生成规则建议',
  };
}

export function buildAiDiagnosisRunsRequest(input: {
  scope: OperationScope;
  latestBatchId?: string;
}) {
  return {
    dateFrom: input.scope.dateFrom,
    dateTo: input.scope.dateTo,
    storeName: input.scope.storeName,
    marketplaceCode: input.scope.marketplaceCode,
    asin: input.scope.asin,
    batchId: input.scope.batchId || input.latestBatchId,
    limit: 5,
  };
}

function diagnosisIdentityPart(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

export function diagnosisTimelineMatchesDiagnostic(
  timeline: BusinessQuantTimeline,
  diagnostic: BusinessQuantDiagnostic,
): boolean {
  const timelineObjectKey = diagnosisIdentityPart(timeline.objectKey);
  const diagnosticObjectKey = diagnosisIdentityPart(diagnostic.objectKey);
  if (!timelineObjectKey || !diagnosticObjectKey || timelineObjectKey !== diagnosticObjectKey) return false;

  return diagnosisIdentityPart(timeline.objectType) === diagnosisIdentityPart(diagnostic.objectType)
    && diagnosisIdentityPart(timeline.objectName) === diagnosisIdentityPart(diagnostic.objectName)
    && diagnosisIdentityPart(timeline.campaignName) === diagnosisIdentityPart(diagnostic.campaignName)
    && diagnosisIdentityPart(timeline.adGroupName) === diagnosisIdentityPart(diagnostic.adGroupName)
    && diagnosisIdentityPart(timeline.asin) === diagnosisIdentityPart(diagnostic.asin);
}

export function adQuantBlockerDetail(input: {
  realReportCount?: number;
  importedReportTypeCount?: number;
  requiredReportCount?: number;
  fallback?: string;
}): string {
  const requiredReportCount = Math.max(1, Math.trunc(Number(input.requiredReportCount || 8)));
  const realReportCount = Math.max(0, Math.trunc(Number(input.realReportCount || 0)));
  const importedReportTypeCount = Math.max(0, Math.trunc(Number(input.importedReportTypeCount || 0)));
  if (realReportCount >= requiredReportCount && importedReportTypeCount < requiredReportCount) {
    const remainingReportTypeCount = requiredReportCount - importedReportTypeCount;
    return `报表文件 ${realReportCount}/${requiredReportCount} 已齐，当前仅 ${importedReportTypeCount}/${requiredReportCount} 类逐类入库；请到导入检查补齐剩余 ${remainingReportTypeCount} 类。截图、审计文件和空报表不作为广告数据。`;
  }
  return input.fallback?.trim()
    || `请先完成 ${requiredReportCount} 类真实报表采集并导入 DB；截图、审计文件和空报表不作为广告数据。`;
}

export function adQuantScopeKey(scope: Partial<OperationScope>): string {
  return [
    scope.dateFrom,
    scope.dateTo,
    scope.storeName,
    scope.marketplaceCode,
    scope.asin,
    scope.batchId,
  ].map((value) => String(value || '').trim()).join('|');
}

export function createAdQuantScopeRequestGate() {
  let activeScopeKey = '';
  let sequence = 0;
  return {
    activate(scopeKey: string) {
      if (scopeKey !== activeScopeKey) {
        activeScopeKey = scopeKey;
        sequence += 1;
      }
    },
    begin(scopeKey: string) {
      if (scopeKey !== activeScopeKey) return { scopeKey, sequence: -1 };
      sequence += 1;
      return { scopeKey, sequence };
    },
    isCurrent(request: { scopeKey: string; sequence: number }) {
      return request.sequence >= 0
        && request.scopeKey === activeScopeKey
        && request.sequence === sequence;
    },
  };
}

function diagnosisRunEvidenceTotal(run: AiDiagnosisRunView): number {
  return Number(run.evidencePackSummary?.total || 0);
}

export function diagnosisRunEvidenceLabel(run: AiDiagnosisRunView): string {
  return `证据包 ${diagnosisRunEvidenceTotal(run)} 条`;
}

export function diagnosisRunSummaryText(run: AiDiagnosisRunView): string {
  const summary = run.diagnosis?.summary?.trim();
  if (summary) return summary;

  const fallbackReason = run.diagnosis?.aiFallbackReason?.trim();
  if (fallbackReason) return fallbackReason;

  const insightCount = run.insights?.length || 0;
  if (insightCount > 0 && !run.formalRecommendationCount) {
    return `AI 已完成诊断，产生 ${insightCount} 条洞察，但未形成可审批建议。先补齐证据引用、来源行和广告对象绑定后再重新生成。`;
  }

  if (insightCount > 0) {
    return `AI 已完成诊断，产生 ${insightCount} 条洞察，并形成 ${run.formalRecommendationCount} 条正式建议。`;
  }

  if (run.success === false) return run.errorMessage || 'AI 诊断失败，当前没有可展示摘要。';
  return '本次诊断没有形成摘要；请检查 AI 调用日志、证据包和当前范围数据。';
}

export function diagnosisRunInsightPreview(run: AiDiagnosisRunView): string[] {
  return (run.insights || []).slice(0, 3).map((insight) => {
    const reason = insight.invalidReasons?.filter(Boolean).join('；')
      || insight.reason
      || '未进入建议池';
    return `${insight.entityType || '对象'} / ${insight.actionType || '动作'} / ${insight.entityName || '-'}：${reason}`;
  });
}

export function thresholdEvidenceReviewLine(input: {
  item: AdStrategyDiagnosisView['summary']['thresholdSuggestions'][keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']];
  evidencePackPreview?: AiEvidenceDisplayItemView[];
}): { tone: 'muted' | 'warning'; text: string } {
  const evidenceSummary = formatEvidenceRefSummary(input.item.evidenceRefs, input.evidencePackPreview);
  const missingDetail = evidenceSummary.includes('缺少证据明细：');
  const reviewReasons = [
    ...(input.item.reviewReasons || []),
    ...(missingDetail ? [evidenceSummary] : []),
  ].map(operatorFacingAdQuantReason);
  const needsReview = input.item.requiresReview === true || missingDetail;
  const reviewText = needsReview
    ? `；需要人工复核后才能覆盖规则阈值${reviewReasons.length ? `。复核原因：${reviewReasons.join('；')}` : '。'}`
    : '';
  return {
    tone: needsReview ? 'warning' : 'muted',
    text: `引用证据：${evidenceSummary}${reviewText}`,
  };
}

function evidenceTypeLabel(type: AiEvidenceDisplayItemView['type']): string {
  const labels: Record<AiEvidenceDisplayItemView['type'], string> = {
    metric: '报表指标',
    timeline: '对象时间线',
    operation_event: '运营事件',
    product_context: '产品配置',
    rule_candidate: '规则候选',
  };
  return labels[type] || type;
}

function evidenceMetricLine(item: AiEvidenceDisplayItemView): string {
  if (!item.metrics) return '';
  return [
    `${formatUsd(item.metrics.cost || 0)} / ${formatUsd(item.metrics.sales || 0)}`,
    `${Number(item.metrics.orders || 0)} 单`,
    `${Number(item.metrics.clicks || 0)} 点击`,
  ].join(' / ');
}

function evidenceContextLine(item: AiEvidenceDisplayItemView): string {
  return [item.campaignName, item.adGroupName, item.entityName].filter(Boolean).join(' / ');
}

function evidenceSourceLine(item: AiEvidenceDisplayItemView): string {
  const parts = [
    item.dateRange,
    item.batchId ? `批次 ${item.batchId}` : '',
    item.reportType ? `报表 ${item.reportType}` : '',
    item.sourceRow ? `行 ${item.sourceRow}` : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function evidenceEventLine(item: AiEvidenceDisplayItemView): string {
  if (!item.event) return '';
  return [item.event.eventDate, item.event.eventType, item.event.impactExpectation].filter(Boolean).join(' / ');
}

function evidenceProductLine(item: AiEvidenceDisplayItemView): string {
  if (!item.product) return '';
  return [
    item.product.productStage ? `阶段 ${lifecycleLabel(item.product.productStage)}` : '',
    typeof item.product.targetAcos === 'number' ? `目标 ACOS ${formatPercent(item.product.targetAcos * 100)}` : '',
    typeof item.product.targetTacos === 'number' ? `目标 TACOS ${formatPercent(item.product.targetTacos * 100)}` : '',
    typeof item.product.minPrice === 'number' ? `最低价 ${formatUsd(item.product.minPrice)}` : '',
  ].filter(Boolean).join(' / ');
}

function evidenceTimelineLine(item: AiEvidenceDisplayItemView): string {
  if (!item.timeline) return '';
  return [
    item.timeline.inferredStage ? `阶段 ${lifecycleLabel(item.timeline.inferredStage)}` : '',
    typeof item.timeline.activeDays === 'number' ? `活跃 ${item.timeline.activeDays} 天` : '',
    item.timeline.firstMetricDate && item.timeline.lastMetricDate ? `${item.timeline.firstMetricDate} 至 ${item.timeline.lastMetricDate}` : '',
  ].filter(Boolean).join(' / ');
}

function evidenceTimelineDailyLine(item: AiEvidenceDisplayItemView): string {
  const recent = item.timeline?.recentDaily || [];
  if (!recent.length) return '';
  return recent
    .slice(-3)
    .map((day) => `${day.date} ${formatUsd(day.cost || 0)} / ${day.orders || 0} 单`)
    .join('；');
}

function evidenceSufficiencyLabel(level?: string): string {
  if (level === 'high') return '证据充分';
  if (level === 'medium') return '证据中等';
  if (level === 'low') return '证据不足';
  return '无指标证据';
}

function evidenceSufficiencyTone(level?: string): 'ready' | 'warning' | 'blocked' | 'pending' {
  if (level === 'high') return 'ready';
  if (level === 'medium') return 'warning';
  if (level === 'low' || level === 'none') return 'blocked';
  return 'pending';
}

function aiFormalGateLabel(summary: AdStrategyDiagnosisView['summary']): string {
  if (summary.source !== 'ai') return 'AI 未进入建议池';
  if (summary.lifecycleStageRequiresReview || summary.evidenceSufficiency?.canUseForFormalActions === false) return 'AI 只作洞察';
  return 'AI 可参与建议';
}

function aiFormalGateDetail(summary: AdStrategyDiagnosisView['summary']): string {
  if (summary.source !== 'ai') return '当前正式建议只使用规则量化，不采纳 AI 判断。';
  if (summary.lifecycleStageRequiresReview) return operatorFacingAdQuantReason(summary.lifecycleStageInvalidReasons?.join('；') || 'AI 阶段判断需要人工复核。');
  const sufficiency = summary.evidenceSufficiency;
  if (sufficiency?.canUseForFormalActions === false) return operatorFacingAdQuantReason(sufficiency.blockers.join('；') || 'AI 证据不足，不能进入正式建议。');
  return '当前 AI 判断满足证据门槛，仍需在后续页面审批和回读。';
}

function referencedEvidenceIds(summary: AdStrategyDiagnosisView['summary']): Set<string> {
  const refs = [
    ...(summary.lifecycleStageEvidenceRefs || []),
    ...Object.values(summary.thresholdSuggestions || {}).flatMap((item) => item.evidenceRefs || []),
    ...(summary.aiInsights || []).flatMap((item) => item.evidenceRefs || []),
  ];
  return new Set(refs.filter(Boolean));
}

export function AdQuantPage() {
  const { data, error, loading, reload, scope } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const strategyRequestGateRef = useRef(createAdQuantScopeRequestGate());
  const diagnosisRunsRequestGateRef = useRef(createAdQuantScopeRequestGate());
  const queueFocusFallbackRef = useRef<HTMLDivElement | null>(null);
  const [ruleConfig, setRuleConfig] = useState(() => normalizeRuleConfig(null));
  const [strategyState, setStrategyState] = useState<{
    scopeKey: string;
    diagnosis: AdStrategyDiagnosisView | null;
    loading: boolean;
    error: string;
    lastRunAt: string;
  }>({ scopeKey: '', diagnosis: null, loading: false, error: '', lastRunAt: '' });
  const [diagnosisRunsState, setDiagnosisRunsState] = useState<{
    scopeKey: string;
    runs: AiDiagnosisRunView[];
    error: string;
  }>({ scopeKey: '', runs: [], error: '' });
  const [metricFocus, setMetricFocus] = useState<AdQuantMetricFocus>('all');
  const [selectedDiagnosticKey, setSelectedDiagnosticKey] = useState<string | null>(null);
  const quant = data?.quant;
  const collection = data?.collection;
  const operationEvents = data?.operations?.events || [];
  const sourceBatchIds = collection?.sourceBatchIds || (collection?.latestBatch?.id ? [collection.latestBatch.id] : []);
  const currentBatchId = resolveRecommendationBatchId({
    scopeBatchId: scope.batchId,
    latestBatchId: collection?.latestBatch?.id,
    sourceBatchIds,
  });
  const strategyRequestScope: OperationScope = { ...scope, batchId: currentBatchId || '' };
  const strategyScopeKey = adQuantScopeKey(strategyRequestScope);
  strategyRequestGateRef.current.activate(strategyScopeKey);
  diagnosisRunsRequestGateRef.current.activate(strategyScopeKey);
  const activeStrategyState = strategyState.scopeKey === strategyScopeKey
    ? strategyState
    : { scopeKey: strategyScopeKey, diagnosis: null, loading: false, error: '', lastRunAt: '' };
  const strategyDiagnosis = activeStrategyState.diagnosis;
  const strategyLoading = activeStrategyState.loading;
  const strategyError = activeStrategyState.error;
  const strategyLastRunAt = activeStrategyState.lastRunAt;
  const diagnosisRuns = diagnosisRunsState.scopeKey === strategyScopeKey ? diagnosisRunsState.runs : [];
  const diagnosisRunsError = diagnosisRunsState.scopeKey === strategyScopeKey ? diagnosisRunsState.error : '';
  const realReportCount = realReportCoverageCount(collection);
  const importedReportTypeCount = importedReportTypeCoverageCount(collection);
  const importedRowCount = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const recommendationGateIssues = data
    ? buildRecommendationGateIssues({
      requiredReportCount: 8,
      realReportFileCount: realReportCount,
      realReportFilesLength: collection?.realReportFiles.length ?? 0,
      importedReportTypeCount,
      importedRowCount,
      quantImportedRows: quant?.importedRows ?? 0,
      hasImportedMetrics: Boolean(quant?.hasImportedMetrics),
      currentBatchId,
      collectionBlockers: collection?.blockers || [],
      quantBlockers: quant?.blockers || [],
    })
    : ['正在读取当前业务范围的数据状态'];
  const canDiagnose = Boolean(
    realReportCount >= 8
      && importedReportTypeCount >= 8
      && importedRowCount > 0
      && quant?.hasImportedMetrics,
  );
  const canGenerateFormalRecommendations = Boolean(data && recommendationGateIssues.length === 0);
  const visibleQuant = canDiagnose ? quant : undefined;
  const allDiagnostics = canDiagnose ? quant?.diagnostics || [] : [];
  const allTimelines = canDiagnose ? quant?.adObjectTimelines || [] : [];
  const allProductHistoryLedgers = canDiagnose ? data?.productHistory?.ledgers || [] : [];
  const productGrouping = useMemo(() => buildAdQuantProductGroups({
    scopeAsin: scope.asin,
    canonicalSummary: visibleQuant && scope.asin
      ? {
          asin: scope.asin,
          cost: visibleQuant.totalSpend,
          sales: visibleQuant.totalSales,
          orders: visibleQuant.totalOrders,
          clicks: visibleQuant.totalClicks,
        }
      : undefined,
    diagnostics: allDiagnostics,
    timelines: allTimelines,
    ledgers: allProductHistoryLedgers,
  }), [scope.asin, visibleQuant, allDiagnostics, allTimelines, allProductHistoryLedgers]);
  const [selectedProductKey, setSelectedProductKey] = useState(() => String(scope.asin || '').trim().toUpperCase());
  const selectedProduct = selectedProductKey;
  const selectedProductGroup = productGrouping.groups.find((group) => group.productKey === selectedProduct);
  const productFiltered = filterAdQuantByProduct({
    productKey: selectedProduct,
    diagnostics: allDiagnostics,
    timelines: allTimelines,
    ledgers: allProductHistoryLedgers,
  });
  const productDiagnostics = productFiltered.diagnostics;
  const productTimelines = productFiltered.timelines;
  const visibleDiagnostics = useMemo(
    () => productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, metricFocus, ruleConfig)),
    [productDiagnostics, metricFocus, ruleConfig],
  );
  const visibleTimelines = useMemo(
    () => productTimelines.filter((timeline) => adQuantTimelineMatchesFocus(timeline, metricFocus, ruleConfig)),
    [productTimelines, metricFocus, ruleConfig],
  );
  const productHistoryLedgers = productFiltered.ledgers;
  const diagnosisQueueRows = useMemo(
    () => buildDiagnosisQueueRows(
      visibleDiagnostics,
      (row) => priorityScore(row, ruleConfig),
    ),
    [ruleConfig, visibleDiagnostics],
  );
  const selectedQueueRow = diagnosisQueueRows.find((entry) => entry.key === selectedDiagnosticKey) || null;
  const selectedDiagnostic = selectedQueueRow?.diagnostic || null;
  const selectedTimeline = selectedDiagnostic
    ? productTimelines.find((timeline) => diagnosisTimelineMatchesDiagnostic(timeline, selectedDiagnostic)) || null
    : null;
  const selectedProductContext = selectedDiagnostic?.asin
    ? normalizeProductContexts(data?.productContext?.products).find((product) => product.asin === selectedDiagnostic.asin?.trim().toUpperCase())
    : undefined;
  const selectedLedger = selectedDiagnostic?.asin
    ? allProductHistoryLedgers.find((ledger) => String(ledger.asin || '').trim().toUpperCase() === selectedDiagnostic.asin?.trim().toUpperCase())
    : undefined;
  const selectedOperationEvents = selectedDiagnostic
    ? operationEvents.filter((event) => !event.asin || String(event.asin).trim().toUpperCase() === String(selectedDiagnostic.asin || '').trim().toUpperCase()).slice(0, 3)
    : [];
  const quantDiagnosisSummary = buildAdQuantDiagnosisSummary(strategyDiagnosis?.summary);
  const decisionStatus = buildAdQuantDecisionStatus({
    canDiagnose,
    canGenerateFormalRecommendations,
    diagnosticCount: productDiagnostics.length,
    diagnosis: strategyDiagnosis?.summary,
  });
  const strategyRunFeedback = buildStrategyRunFeedback({
    canDiagnose,
    loading: strategyLoading,
    realReportCount,
    importedReportTypeCount,
    requiredReportCount: 8,
    error: strategyError,
    diagnosis: strategyDiagnosis,
    lastRunAt: strategyLastRunAt,
  });
  const strategyReferencedEvidenceIds = strategyDiagnosis ? referencedEvidenceIds(strategyDiagnosis.summary) : new Set<string>();
  const productContexts = normalizeProductContexts(data?.productContext?.products);
  const productContextCount = data?.productContext?.productCount ?? productContexts.length;
  const productWithTargets = countProductsWithTargets(productContexts);
  const canonicalRows = quant?.canonicalRows ?? 0;
  const actionableRows = quant?.actionableRows ?? 0;
  const breakdownRows = quant?.breakdownRows ?? 0;
  const diagnosticCount = productDiagnostics.length;
  const productHighAcosRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'high_acos', ruleConfig));
  const productNoOrderRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'waste', ruleConfig));
  const productOrderRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'orders', ruleConfig));
  const productScaleRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'scale', ruleConfig));
  const productReviewRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'review', ruleConfig));
  const productNoOrderSpend = productNoOrderRows.reduce((sum, row) => sum + row.spend, 0);
  const workspaceModel = buildDiagnosisWorkspaceModel({
    realReportCount,
    requiredReportCount: 8,
    importedReportTypeCount,
    importedRowCount,
    hasImportedMetrics: Boolean(quant?.hasImportedMetrics),
    recommendationGateIssues,
    diagnosticCount: productDiagnostics.length,
    visibleDiagnosticCount: visibleDiagnostics.length,
    selectedObject: selectedDiagnostic
      ? {
          name: selectedDiagnostic.objectName || selectedDiagnostic.campaignName,
          diagnosis: selectedDiagnostic.diagnosis,
        }
      : null,
    scopeAiSummary: strategyDiagnosis?.summary.summary,
  });
  const selectedSpend = selectedProductGroup?.cost ?? visibleQuant?.totalSpend ?? 0;
  const selectedSales = selectedProductGroup?.sales ?? visibleQuant?.totalSales ?? 0;
  const selectedOrders = selectedProductGroup?.orders ?? visibleQuant?.totalOrders ?? 0;
  const selectedAcos = selectedProductGroup ? selectedProductGroup.acos : (visibleQuant?.acos ?? 0);
  const wasteRiskSpendTile = buildWasteRiskSpendTile({
    wastedSpend: visibleQuant?.wastedSpend,
    totalSpend: selectedSpend,
    highRiskCount: visibleQuant?.highRiskCount,
  });
  useEffect(() => {
    const scopedProduct = String(scope.asin || '').trim().toUpperCase();
    setSelectedProductKey(
      scopedProduct && productGrouping.groups.some((group) => group.productKey === scopedProduct)
        ? scopedProduct
        : '',
    );
  }, [productGrouping.groups, scope.asin]);

  useEffect(() => {
    setSelectedDiagnosticKey((current) => (
      current && diagnosisQueueRows.some((entry) => entry.key === current) ? current : null
    ));
  }, [diagnosisQueueRows]);

  useEffect(() => {
    setSelectedDiagnosticKey(null);
  }, [strategyScopeKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadRuleConfig() {
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled) setRuleConfig(normalizeRuleConfig(config));
      } catch {
        if (!cancelled) setRuleConfig(normalizeRuleConfig(null));
      }
    }

    loadRuleConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadDiagnosisRuns(requestedScope: OperationScope = strategyRequestScope) {
    const api = (window as any).electronAPI;
    const requestedScopeKey = adQuantScopeKey(requestedScope);
    const request = diagnosisRunsRequestGateRef.current.begin(requestedScopeKey);
    if (!diagnosisRunsRequestGateRef.current.isCurrent(request)) return;
    if (!api?.listAiDiagnosisRuns) {
      setDiagnosisRunsState({ scopeKey: request.scopeKey, runs: [], error: '' });
      return;
    }
    try {
      const runs = await api.listAiDiagnosisRuns(buildAiDiagnosisRunsRequest({
        scope: requestedScope,
      }));
      if (!diagnosisRunsRequestGateRef.current.isCurrent(request)) return;
      setDiagnosisRunsState({
        scopeKey: request.scopeKey,
        runs: Array.isArray(runs) ? runs : [],
        error: '',
      });
    } catch (caught) {
      if (!diagnosisRunsRequestGateRef.current.isCurrent(request)) return;
      setDiagnosisRunsState({
        scopeKey: request.scopeKey,
        runs: [],
        error: caught instanceof Error ? caught.message : String(caught || '读取 AI 诊断记录失败。'),
      });
    }
  }

  useEffect(() => {
    void loadDiagnosisRuns(strategyRequestScope);
  }, [strategyScopeKey]);

  async function runStrategyDiagnosis() {
    const api = (window as any).electronAPI;
    const requestedScope = { ...strategyRequestScope };
    const request = strategyRequestGateRef.current.begin(strategyScopeKey);
    if (!strategyRequestGateRef.current.isCurrent(request)) return;
    setStrategyState({
      scopeKey: request.scopeKey,
      diagnosis: null,
      loading: true,
      error: '',
      lastRunAt: '',
    });
    try {
      if (!api?.runAdStrategyDiagnosis) {
        throw new Error('AI 阶段诊断接口未暴露。');
      }
      const result = await runAdQuantDiagnosisWorkflowMutation<any>(() => api.runAdStrategyDiagnosis({
        dateFrom: requestedScope.dateFrom,
        dateTo: requestedScope.dateTo,
        storeName: requestedScope.storeName,
        marketplaceCode: requestedScope.marketplaceCode,
        asin: requestedScope.asin,
        batchId: requestedScope.batchId,
        limit: 300,
      }));
      if (!strategyRequestGateRef.current.isCurrent(request)) return;
      setStrategyState({
        scopeKey: request.scopeKey,
        diagnosis: result,
        loading: true,
        error: '',
        lastRunAt: new Date().toISOString(),
      });
      await loadDiagnosisRuns(requestedScope);
    } catch (caught) {
      if (!strategyRequestGateRef.current.isCurrent(request)) return;
      setStrategyState({
        scopeKey: request.scopeKey,
        diagnosis: null,
        loading: true,
        error: toUserFacingError(caught, 'AI 阶段诊断失败。'),
        lastRunAt: new Date().toISOString(),
      });
    } finally {
      if (strategyRequestGateRef.current.isCurrent(request)) {
        setStrategyState((current) => current.scopeKey === request.scopeKey
          ? { ...current, loading: false }
          : current);
      }
    }
  }

  const queueColumns = useMemo<Array<VirtualDataTableColumn<DiagnosisQueueRow<BusinessQuantDiagnostic>>>>(() => [
    {
      key: 'object',
      header: '广告对象',
      width: 'minmax(220px, 1.45fr)',
      sticky: 'left',
      cell: (entry) => (
        <div>
          <strong>{entry.diagnostic.objectName || entry.diagnostic.campaignName || '-'}</strong>
          <div className="table-subtext">
            {entry.diagnostic.objectType || '-'} / {quantStatusLabel(entry.diagnostic.quantStatus)}
          </div>
        </div>
      ),
    },
    {
      key: 'diagnosis',
      header: '诊断与方向',
      width: 'minmax(260px, 1.8fr)',
      cell: (entry) => (
        <div>
          <strong>{entry.diagnostic.diagnosis || '待人工复核'}</strong>
          <div className="table-subtext">{entry.diagnostic.suggestedDirection || '暂无明确方向'}</div>
        </div>
      ),
    },
    {
      key: 'spend',
      header: '花费 / 销售',
      width: '150px',
      cell: (entry) => (
        <div>
          <strong>{formatUsd(entry.diagnostic.spend)}</strong>
          <div className="table-subtext">{formatUsd(entry.diagnostic.sales)}</div>
        </div>
      ),
    },
    {
      key: 'orders',
      header: '订单 / 点击',
      width: '130px',
      cell: (entry) => (
        <div>
          <strong>{entry.diagnostic.orders} 单</strong>
          <div className="table-subtext">{entry.diagnostic.clicks} 点击</div>
        </div>
      ),
    },
    {
      key: 'risk',
      header: 'ACOS / 优先级',
      width: '180px',
      cell: (entry) => (
        <div>
          <StatusPill
            tone={entry.diagnostic.severity === 'high' || entry.diagnostic.quantStatus === 'waste'
              ? 'blocked'
              : entry.diagnostic.severity === 'medium' || entry.diagnostic.quantStatus === 'watch'
                ? 'warning'
                : 'ready'}
          >
            {formatPercent(entry.diagnostic.acos * 100)}
          </StatusPill>
          <div className="table-subtext">{priorityReason(entry.diagnostic, ruleConfig)}</div>
        </div>
      ),
    },
  ], [ruleConfig]);

  const taskPrimaryAction = loading
    ? {
        label: '正在读取诊断数据',
        busy: true,
        busyLabel: '正在读取诊断数据',
        disabled: true,
        onClick: reload,
      }
    : error
      ? {
          label: '重新读取',
          onClick: reload,
        }
      : {
          label: workspaceModel.primaryAction.label,
          disabled: workspaceModel.primaryAction.disabled,
          disabledReason: workspaceModel.primaryAction.disabled ? '当前范围没有可进入建议的诊断对象。' : undefined,
          onClick: () => navigate(workspaceModel.primaryAction.target),
        };
  const taskSecondaryActions = canDiagnose && !error
    ? [
        {
          label: strategyError ? '重新运行 AI' : '运行 AI 阶段分析',
          busy: strategyLoading,
          busyLabel: 'AI 分析中...',
          disabled: strategyLoading,
          onClick: () => { void runStrategyDiagnosis(); },
        },
        {
          label: strategyError ? '检查 AI 设置' : '补充运营事件',
          disabled: strategyLoading,
          onClick: () => navigate(strategyError ? 'settings' : 'operation-events'),
        },
      ]
    : [];
  const taskTone: 'neutral' | 'attention' | 'blocked' | 'confirmed' = error || !canDiagnose
    ? 'blocked'
    : workspaceModel.formalRecommendationsLocked
      ? 'attention'
      : 'confirmed';

  return (
    <div
      className="diagnosis-workspace"
      data-workspace="diagnosis"
      data-workspace-evidence-root="true"
      data-workspace-subview="analysis"
    >
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.adQuant}
        description="按风险优先级复核广告对象；选择一行后在检查器中核对规则、趋势、产品上下文与安全边界。"
      />

      <div data-diagnosis-summary-boundary>
        <TaskBanner
          compact
          description={error
            ? '当前业务数据读取失败，先重新读取，再继续对象诊断。'
            : strategyRunFeedback.visible
              ? (
                  <span
                    aria-atomic="true"
                    aria-busy={strategyRunFeedback.ariaBusy || undefined}
                    aria-live="polite"
                    className="diagnosis-ai-run-inline"
                    data-ai-run-status-visible="true"
                    data-ai-run-tone={strategyRunFeedback.tone}
                    id="ai-strategy-run-feedback"
                    role="status"
                    title={`${strategyRunFeedback.title}：${strategyRunFeedback.detail}`}
                  >
                    {strategyRunFeedback.ariaBusy && <span aria-hidden="true" className="workspace-spinner" />}
                    <strong>{strategyRunFeedback.title}</strong>
                    <span className="diagnosis-ai-run-inline__detail">· {strategyRunFeedback.detail}</span>
                    <span className="diagnosis-ai-run-inline__state">{strategyRunFeedback.statusLabel}</span>
                  </span>
                )
              : workspaceModel.readinessDetail}
          meta={(selectedProductGroup?.label || '全部产品')
            + ' · 花费 ' + formatUsd(selectedSpend)
            + ' · 销售 ' + formatUsd(selectedSales)
            + ' · ' + selectedOrders + ' 单'
            + ' · ACOS ' + formatPercent(selectedAcos * 100)}
          primaryAction={taskPrimaryAction}
          secondaryActions={taskSecondaryActions}
          status={loading
            ? '读取中'
            : error
              ? '读取失败'
              : workspaceModel.formalRecommendationsLocked
                ? '正式建议锁定'
                : '正式建议可进入'}
          title={selectedDiagnostic
            ? '正在复核：' + (selectedDiagnostic.objectName || selectedDiagnostic.campaignName || '未命名对象')
            : canDiagnose
              ? '选择一个广告对象开始复核'
              : '先闭合真实广告数据'}
          tone={taskTone}
        />
      </div>

      <div className="diagnosis-workbench-layout" data-workspace-work-surface="true">
        <div data-workspace-queue="true" ref={queueFocusFallbackRef} tabIndex={-1}>
          <WorkbenchPanel
            className="ad-quant-primary-panel diagnosis-queue-panel"
            description="队列按止损风险、ACOS 风险和花费排序。当前筛选只改变可见对象，不改变正式建议资格。"
            status={(
              <StatusPill tone={diagnosisQueueRows.length ? 'ready' : canDiagnose ? 'warning' : 'blocked'}>
                {diagnosisQueueRows.length}/{diagnosticCount} 个对象
              </StatusPill>
            )}
            title="广告对象诊断"
            toolbar={(
              <label className="inline-field">
                <span>产品范围</span>
                <select
                  aria-label="选择广告诊断产品范围"
                  disabled={loading}
                  onChange={(event) => {
                    const nextProductKey = event.target.value;
                    setSelectedProductKey(nextProductKey);
                    setSelectedDiagnosticKey(null);
                    setScope(productGroupScopePatch(nextProductKey));
                  }}
                  value={selectedProductKey}
                >
                  <option value="">全部产品</option>
                  {productGrouping.groups.map((group) => (
                    <option key={group.productKey} value={group.productKey}>
                      {group.label} · {group.diagnosticCount} 个对象
                    </option>
                  ))}
                </select>
              </label>
            )}
          >
            <div className="diagnosis-queue-controls">
              <TagMetricGroup
                activeKey={metricFocus}
                ariaLabel="广告表现维度快速聚焦"
                dimInactive={metricFocus !== 'all'}
                items={[
                  { key: 'all', label: '全部对象', value: productDiagnostics.length, tone: productDiagnostics.length > 0 ? 'ready' : 'blocked', detail: realReportCount + '/8 类真实报表' },
                  { key: 'waste', label: '浪费超支', value: formatUsd(productNoOrderSpend), tone: productNoOrderSpend > 0 ? 'blocked' : 'ready' },
                  { key: 'high_acos', label: '高 ACOS', value: productHighAcosRows.length, tone: productHighAcosRows.length > 0 ? 'warning' : 'ready' },
                  { key: 'orders', label: '出单对象', value: productOrderRows.length, tone: productOrderRows.length > 0 ? 'ready' : 'warning' },
                  { key: 'scale', label: '可扩量', value: productScaleRows.length, tone: productScaleRows.length > 0 ? 'ready' : 'neutral' },
                  { key: 'review', label: '待复核', value: productReviewRows.length, tone: productReviewRows.length > 0 ? 'warning' : 'ready' },
                ]}
                onSelect={(item) => setMetricFocus((item.key || 'all') as AdQuantMetricFocus)}
              />
              <p className="ad-quant-focus-line" aria-live="polite">
                当前聚焦：{adQuantFocusLabel(metricFocus)}。筛选仅改变当前队列视图；正式资格仍按未筛选的 {diagnosticCount} 个对象计算。
              </p>
            </div>

            {loading ? (
              <WorkspaceState
                description="正在读取当前范围的真实报表、逐类入库和广告对象诊断。"
                kind="loading"
                title="正在读取诊断数据"
              />
            ) : error ? (
              <WorkspaceState
                action={{ label: '重新读取', onClick: reload }}
                description={error}
                kind="error"
                title="诊断数据读取失败"
              />
            ) : !canDiagnose ? (
              <WorkspaceState
                description={adQuantBlockerDetail({
                  realReportCount,
                  importedReportTypeCount,
                  requiredReportCount: 8,
                  fallback: quant?.blockers?.[0],
                })}
                details="截图、审计文件和空报表不作为广告数据；8 类真实报表未闭合时不生成诊断。"
                kind="blocked"
                title="广告表现阻断"
              />
            ) : diagnosticCount <= 0 ? (
              <WorkspaceState
                description="当前产品范围没有形成可复核的广告对象。请检查 ASIN 范围、批次与逐类入库结果。"
                kind="empty"
                title="当前范围没有诊断对象"
              />
            ) : diagnosisQueueRows.length <= 0 ? (
              <WorkspaceState
                action={{ label: '查看全部对象', onClick: () => setMetricFocus('all') }}
                description={'当前聚焦“' + adQuantFocusLabel(metricFocus) + '”没有匹配对象；这不会锁定正式建议入口。'}
                kind="empty"
                title="当前筛选没有匹配对象"
              />
            ) : (
              <VirtualDataTable
                columns={queueColumns}
                emptyMessage="当前没有可展示的诊断对象。"
                estimateSize={54}
                getRowKey={(entry) => entry.key}
                minWidth="940px"
                onRowSelect={(entry) => setSelectedDiagnosticKey(entry.key)}
                rowAriaLabel={(entry) => {
                  const row = entry.diagnostic;
                  return '复核 ' + (row.objectName || row.campaignName || '未命名对象')
                    + '，' + (row.diagnosis || '待人工复核')
                    + '，ACOS ' + formatPercent(row.acos * 100);
                }}
                rows={diagnosisQueueRows}
                selectedRowKey={selectedDiagnosticKey}
              />
            )}
          </WorkbenchPanel>
        </div>

        <ResponsiveInspector
          description={selectedDiagnostic
            ? (selectedDiagnostic.campaignName || '-') + ' / ' + (selectedDiagnostic.adGroupName || '-') + ' / ' + (selectedDiagnostic.asin || '未绑定 ASIN')
            : undefined}
          onClose={() => setSelectedDiagnosticKey(null)}
          open={Boolean(selectedDiagnostic)}
          resolveFocusReturnTarget={(trigger) => (
            trigger && trigger.isConnected !== false ? trigger : queueFocusFallbackRef.current
          )}
          title={selectedDiagnostic?.objectName || selectedDiagnostic?.campaignName || '广告对象详情'}
        >
          {selectedDiagnostic && (
            <div className="business-stack diagnosis-inspector-stack">
              <Panel
                title="当前规则判断"
                titleAccessory={(
                  <StatusPill tone={selectedDiagnostic.severity === 'high' ? 'blocked' : selectedDiagnostic.severity === 'medium' ? 'warning' : 'ready'}>
                    {quantStatusLabel(selectedDiagnostic.quantStatus)}
                  </StatusPill>
                )}
                tone={selectedDiagnostic.severity === 'high' ? 'blocked' : selectedDiagnostic.severity === 'medium' ? 'warning' : 'success'}
              >
                <p><strong>{selectedDiagnostic.diagnosis || '待人工复核'}</strong></p>
                <p className="muted-line">{selectedDiagnostic.suggestedDirection || '暂无明确建议方向。'}</p>
                <div className="business-pill-row">
                  <StatusPill tone="pending">花费 {formatUsd(selectedDiagnostic.spend)}</StatusPill>
                  <StatusPill tone="pending">销售 {formatUsd(selectedDiagnostic.sales)}</StatusPill>
                  <StatusPill tone={selectedDiagnostic.orders > 0 ? 'ready' : 'warning'}>{selectedDiagnostic.orders} 单</StatusPill>
                  <StatusPill tone={selectedDiagnostic.acos >= ruleConfig.highAcosThreshold ? 'blocked' : 'ready'}>ACOS {formatPercent(selectedDiagnostic.acos * 100)}</StatusPill>
                </div>
                <p className="muted-line">复核优先级：{priorityReason(selectedDiagnostic, ruleConfig)}</p>
                <p className="muted-line">当前规则：{ruleThresholdSummary(ruleConfig)}</p>
              </Panel>

              <Panel title="对象时间线" tone={selectedTimeline ? 'success' : 'warning'}>
                {selectedTimeline ? (
                  <>
                    <div className="context-summary-grid compact-summary diagnosis-inspector-summary diagnosis-inspector-summary--timeline">
                      <div>
                        <span>日期范围</span>
                        <strong className="diagnosis-inspector-date-range">
                          <time dateTime={selectedTimeline.dateFrom}>{selectedTimeline.dateFrom}</time>
                          <span className="diagnosis-inspector-date-range__end">
                            至 <time dateTime={selectedTimeline.dateTo}>{selectedTimeline.dateTo}</time>
                          </span>
                        </strong>
                        <p>{selectedTimeline.daysActive} 个活跃日</p>
                      </div>
                      <div>
                        <span>趋势</span>
                        <strong className="diagnosis-inspector-trend">
                          <span className="diagnosis-inspector-trend__item">花费{trendLabel(selectedTimeline.trend.spend)} /</span>
                          <span className="diagnosis-inspector-trend__item">销售{trendLabel(selectedTimeline.trend.sales)}</span>
                        </strong>
                        <p>{selectedTimeline.totals.orders} 单 / {selectedTimeline.totals.clicks} 点击</p>
                      </div>
                    </div>
                    <p className="muted-line">{thresholdLine(selectedTimeline)}</p>
                    {selectedTimeline.reasons.length > 0 && (
                      <ul className="business-list">
                        {selectedTimeline.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="muted-line">没有找到与当前行对象身份完全匹配的时间线；这里不会用产品总盘替代对象证据。</p>
                )}
              </Panel>

              <Panel title="产品上下文与历史" tone={selectedProductContext || selectedLedger ? 'success' : 'warning'}>
                {selectedProductContext ? (
                  <div className="context-summary-grid compact-summary diagnosis-inspector-summary diagnosis-inspector-summary--product">
                    <div>
                      <span>产品</span>
                      <strong>{selectedProductContext.title || selectedProductContext.asin}</strong>
                      <p>{selectedProductContext.asin} / {selectedProductContext.status || '未标记状态'}</p>
                    </div>
                    <div>
                      <span>产品阶段</span>
                      <strong>{lifecycleLabel(selectedProductContext.productStage)}</strong>
                      <p>
                        目标 ACOS {typeof selectedProductContext.cost?.targetAcos === 'number' ? formatPercent(selectedProductContext.cost.targetAcos * 100) : '未配置'}
                        {' / '}目标 TACOS {typeof selectedProductContext.cost?.targetTacos === 'number' ? formatPercent(selectedProductContext.cost.targetTacos * 100) : '未配置'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="muted-line">当前对象没有匹配的产品配置。</p>
                )}
                {selectedLedger ? (
                  <p className="muted-line">
                    产品历史：{selectedLedger.dateFrom} 至 {selectedLedger.dateTo}，{selectedLedger.activeDays} 个活跃日，
                    花费 {formatUsd(selectedLedger.totals.cost)}，销售 {formatUsd(selectedLedger.totals.sales)}，{selectedLedger.totals.orders} 单。
                  </p>
                ) : (
                  <p className="muted-line">当前对象没有匹配的产品历史账本。</p>
                )}
                {selectedOperationEvents.length > 0 ? (
                  <ul className="business-list">
                    {selectedOperationEvents.map((event) => (
                      <li key={event.id}>
                        {event.eventDate} · {event.title}
                        {event.impactExpectation ? ' · ' + event.impactExpectation : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-line">当前对象没有匹配的近期运营事件。</p>
                )}
              </Panel>

              <Panel title="范围级 AI 总结" tone={workspaceModel.scopeAiSummary ? 'success' : 'warning'}>
                {workspaceModel.scopeAiSummary ? (
                  <>
                    <p>{workspaceModel.scopeAiSummary.text}</p>
                    <p className="warning-line">{workspaceModel.scopeAiSummary.caveat}</p>
                  </>
                ) : (
                  <p className="muted-line">当前范围尚未运行 AI 阶段分析；对象规则诊断仍可独立复核。</p>
                )}
              </Panel>

              <Panel title="执行安全边界" tone="blocked">
                <p className="blocked-line">
                  本页只做诊断和证据复核，不写入 Amazon Ads。任何动作仍需进入优化建议、人工审批，并完成执行回读证据。
                </p>
              </Panel>
            </div>
          )}
        </ResponsiveInspector>
      </div>

      <ProgressiveDetails title="技术依据与诊断上下文">
        <div className="business-stack">
          <Panel title="数据来源与量化口径" tone={canDiagnose ? 'success' : 'blocked'}>
            <div className="business-split">
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={realReportCount >= 8 ? 'ready' : 'blocked'}>真实报表 {realReportCount}/8</StatusPill>
                <StatusPill tone={importedReportTypeCount >= 8 ? 'ready' : 'blocked'}>逐类入库 {importedReportTypeCount}/8</StatusPill>
                <StatusPill tone={importedRowCount > 0 ? 'ready' : 'blocked'}>指标 {importedRowCount} 行</StatusPill>
              </div>
            </div>
            <p className="muted-line">{quantSourceDescription(quant?.summarySource)}</p>
            <p className="muted-line">
              {buildQuantAccountingLine({
                summarySource: quant?.summarySource,
                batchIds: sourceBatchIds,
                asin: scope.asin,
                canonicalRows,
              })}
            </p>
            <p className="muted-line">
              可加总 {canonicalRows} 行 / 可行动 {actionableRows} 行 / 分解明细 {breakdownRows} 行 / 产品配置 {productWithTargets}/{productContextCount}。
            </p>
            {quant?.summaryWarning && <p className="warning-line">{quant.summaryWarning}</p>}
          </Panel>

          <Panel title="AI 与规则诊断依据" tone={strategyDiagnosis ? 'success' : 'warning'}>
            <div className="business-pill-row">
              <StatusPill tone={decisionStatus.aiTone}>{decisionStatus.aiLabel}</StatusPill>
              <StatusPill tone={decisionStatus.ruleTone}>{decisionStatus.ruleLabel}</StatusPill>
              <StatusPill tone={decisionStatus.actionTone}>{decisionStatus.actionLabel}</StatusPill>
            </div>
            <p className="muted-line">规则阈值：{ruleThresholdSummary(ruleConfig)}</p>
            <p>{quantDiagnosisSummary.headline}</p>
            {quantDiagnosisSummary.reasons.length > 0 && (
              <ul className="business-list">
                {quantDiagnosisSummary.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            <p className="muted-line">证据：{quantDiagnosisSummary.evidenceStats}。下一步：{quantDiagnosisSummary.nextAction}</p>
            {quantDiagnosisSummary.riskWarnings.length > 0 && (
              <p className="warning-line">复核提示：{quantDiagnosisSummary.riskWarnings.join('；')}</p>
            )}
            <p className="muted-line">{thresholdSourceLine()}</p>
          </Panel>

          <Panel title="最近 AI 诊断记录" tone={diagnosisRunsError ? 'blocked' : diagnosisRuns.length ? 'success' : 'warning'}>
            {diagnosisRunsError && <p className="blocked-line">{diagnosisRunsError}</p>}
            {!diagnosisRunsError && diagnosisRuns.length === 0 && (
              <p className="muted-line">当前范围还没有历史 AI 诊断记录。</p>
            )}
            {diagnosisRuns.length > 0 && (
              <div className="ad-quant-review-list">
                {diagnosisRuns.slice(0, 5).map((run) => (
                  <div className="ad-quant-review-item" key={run.id}>
                    <span>{run.createdAt.replace('T', ' ').slice(0, 16)} · {diagnosisRunEvidenceLabel(run)}</span>
                    <strong>{diagnosisRunSummaryText(run)}</strong>
                    {diagnosisRunInsightPreview(run).map((line) => <p key={line}>{line}</p>)}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </ProgressiveDetails>
    </div>
  );
}
