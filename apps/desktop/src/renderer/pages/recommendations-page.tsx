import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { formatPercent, formatUsd } from '../formatters';
import type { AiProviderSettings, RecommendationView, SettingsRuleConfig } from '../types';
import { toUserFacingError } from '../user-facing-error';

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

function recommendationObject(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '-';
}

function sourceLabel(rec: RecommendationView): string {
  if (rec.evidence?.explanationSource === 'ai') return 'DeepSeek AI';
  if (rec.evidence?.aiFallbackReason) return '规则 fallback';
  return '规则';
}

function strategyLabel(rec: RecommendationView): string {
  if (rec.evidence?.aiStrategySource === 'ai') return 'AI 策略诊断';
  if (rec.evidence?.aiStrategySource === 'rule') return '规则策略 fallback';
  return '未诊断';
}

function lifecycleLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '关键词探索',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    clearance: '清货',
    declining_repair: '衰退修复',
    unknown: '未知阶段',
  };
  return labels[String(stage || 'unknown')] || String(stage || '未知阶段');
}

function decisionLabel(rec: RecommendationView): string {
  const labels: Record<string, string> = {
    aligned: '规则+AI 一致',
    conflict: '规则/AI 冲突',
    ai_only: 'AI 独立洞察',
    rule_only: '规则独立建议',
  };
  return labels[String(rec.evidence?.decisionAgreement || '')] || '未合并';
}

function decisionTone(rec: RecommendationView): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (rec.evidence?.decisionAgreement === 'aligned') return 'ready';
  if (rec.evidence?.decisionAgreement === 'conflict') return 'blocked';
  if (rec.evidence?.decisionAgreement === 'ai_only') return 'warning';
  if (rec.evidence?.decisionRequiresReview) return 'warning';
  return 'pending';
}

function quantLabel(status?: string): string {
  const labels: Record<string, string> = {
    healthy: '健康',
    watch: '观察',
    waste: '浪费风险',
    scale: '可扩量',
    blocked: '样本不足',
  };
  return labels[String(status || '')] || '未量化';
}

function quantTone(status?: string): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (status === 'waste') return 'blocked';
  if (status === 'scale' || status === 'healthy') return 'ready';
  if (status === 'watch') return 'warning';
  return 'pending';
}

function thresholdSuggestionSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.aiThresholdSuggestions;
  if (!thresholds) return '暂无 AI 动态阈值';
  const parts = [
    thresholds.targetAcos ? `目标 ACOS ${formatPercent(Number(thresholds.targetAcos.value) * 100)}` : '',
    thresholds.highAcosThreshold ? `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold.value) * 100)}` : '',
    thresholds.noOrderClickThreshold ? `无订单 ${thresholds.noOrderClickThreshold.value} 点击` : '',
    thresholds.minSpend ? `最低花费 ${formatUsd(thresholds.minSpend.value)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : '暂无 AI 动态阈值';
}

function ruleQuantThresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.quantThresholds;
  if (!thresholds) return '暂无规则阈值';
  return [
    `目标 ACOS ${formatPercent(Number(thresholds.targetAcos || 0) * 100)}`,
    `高风险 ${formatPercent(Number(thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(thresholds.minSpend)}`,
  ].join(' / ');
}

function reviewReason(rec: RecommendationView): string {
  if (rec.evidence?.decisionAgreement === 'conflict') return 'AI 与规则冲突，必须人工复核';
  if (rec.evidence?.decisionAgreement === 'ai_only') return 'AI 独立洞察，必须人工复核';
  if (rec.evidence?.quantReviewRequired) return '规则量化要求人工复核';
  if (rec.status === 'needs_review') return '已进入复核队列';
  return '可进入普通审批';
}

function evidenceBatch(rec: RecommendationView, fallbackBatchId?: string): string {
  return rec.evidence?.batchId || fallbackBatchId || '-';
}

function evidenceSourceFiles(rec: RecommendationView): string[] {
  return Array.from(new Set((rec.evidence?.sourceFiles || []).filter(Boolean)));
}

function recommendationEvidenceIssues(rec: RecommendationView, currentBatchId?: string): string[] {
  const issues: string[] = [];
  const sourceBatchId = rec.evidence?.batchId;
  if (!sourceBatchId) issues.push('缺来源批次');
  if (sourceBatchId && currentBatchId && sourceBatchId !== currentBatchId) issues.push('来源批次不一致');
  if (!rec.evidence?.date) issues.push('缺指标日期');
  if (!rec.currentValue) issues.push('缺当前值');
  if (!rec.recommendedValue) issues.push('缺建议值');
  if (!evidenceSourceFiles(rec).length) issues.push('缺来源文件');
  if (!rec.evidence?.campaignName) issues.push('缺广告活动');
  if (!rec.evidence?.adGroupName) issues.push('缺广告组');
  if (!recommendationObject(rec) || recommendationObject(rec) === '-') issues.push('缺关键词/搜索词/投放对象');
  return issues;
}

function recommendationType(rec: RecommendationView): string {
  return rec.entityType || rec.evidence?.matchType || '-';
}

function riskTone(riskLevel?: string): 'ready' | 'pending' | 'blocked' | 'warning' {
  const normalized = String(riskLevel || '').toLowerCase();
  if (normalized.includes('high') || normalized.includes('approval')) return 'warning';
  if (normalized.includes('block')) return 'blocked';
  return 'pending';
}

function eventMatchesRecommendation(event: { asin?: string; campaignName?: string; adGroupName?: string }, rec: RecommendationView): boolean {
  const recAsin = String(rec.evidence?.asin || '').trim().toUpperCase();
  const recCampaign = String(rec.evidence?.campaignName || '').trim().toLowerCase();
  const recAdGroup = String(rec.evidence?.adGroupName || '').trim().toLowerCase();
  const eventHasSpecificTarget = Boolean(event.asin || event.campaignName || event.adGroupName);
  if (!eventHasSpecificTarget) return true;
  if (event.asin && recAsin && event.asin.trim().toUpperCase() !== recAsin) return false;
  if (event.campaignName && recCampaign && event.campaignName.trim().toLowerCase() !== recCampaign) return false;
  if (event.adGroupName && recAdGroup && event.adGroupName.trim().toLowerCase() !== recAdGroup) return false;
  return true;
}

function operationEventTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    coupon: 'Coupon',
    deal: 'Deal / 促销',
    bd: 'BD',
    ld: 'LD',
    promotion: '大促 / 活动',
    price_change: '调价',
    inventory_issue: '库存异常',
    inventory: '库存',
    listing_change: 'Listing 修改',
    offsite_promotion: '站外推广',
    review_change: '评价变化',
    external_traffic: '站外流量',
    note: '备注',
    manual_note: '人工备注',
  };
  return labels[String(type || '')] || String(type || '事件');
}

function thresholdSummary(config: SettingsRuleConfig | null): string {
  if (!config) return '正在读取规则阈值';
  return `目标 ACOS ${formatPercent(config.targetAcos * 100)} / 高 ACOS ${formatPercent(config.highAcosThreshold * 100)} / 无订单 ${config.noOrderClickThreshold} 点击 / 最低花费 ${formatUsd(config.minSpend)}`;
}

type AiReadinessStatus = 'unknown' | 'unconfigured' | 'pending_test' | 'available' | 'failed';

interface AiReadiness {
  status: AiReadinessStatus;
  label: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  model?: string;
  baseUrl?: string;
  lastTestAt?: string;
  message: string;
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

function normalizeAiSettings(settings: Record<string, unknown> | null | undefined): AiProviderSettings {
  return {
    aiApiKey: readString(settings?.aiApiKey ?? settings?.ai_api_key),
    aiKeyConfigured: readBoolean(settings?.aiKeyConfigured ?? settings?.ai_key_configured),
    aiBaseUrl: readString(settings?.aiBaseUrl ?? settings?.ai_base_url) || 'https://api.deepseek.com',
    aiModel: readString(settings?.aiModel ?? settings?.ai_model) || 'deepseek-v4-flash',
    aiTemperature: readString(settings?.aiTemperature ?? settings?.ai_temperature) || '0.3',
    aiMaxTokens: readString(settings?.aiMaxTokens ?? settings?.ai_max_tokens) || '700',
    aiLastTestStatus: readString(settings?.aiLastTestStatus ?? settings?.ai_last_test_status) as AiProviderSettings['aiLastTestStatus'],
    aiLastTestAt: readString(settings?.aiLastTestAt ?? settings?.ai_last_test_at),
    aiLastTestBaseUrl: readString(settings?.aiLastTestBaseUrl ?? settings?.ai_last_test_base_url),
    aiLastTestModel: readString(settings?.aiLastTestModel ?? settings?.ai_last_test_model),
    aiLastTestMessage: readString(settings?.aiLastTestMessage ?? settings?.ai_last_test_message),
  };
}

function aiReadinessFromSettings(settings: AiProviderSettings | null): AiReadiness {
  if (!settings) {
    return {
      status: 'unknown',
      label: 'AI 状态未读取',
      tone: 'pending',
      message: '无法读取 AI 设置时，本页仍可使用规则生成建议，但不会声称 AI 已参与。',
    };
  }
  const keyPresent = Boolean(settings.aiApiKey.trim() || settings.aiKeyConfigured);
  if (!keyPresent) {
    return {
      status: 'unconfigured',
      label: 'AI 未配置',
      tone: 'warning',
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      message: '未配置 API Key，本次只能使用规则量化和规则解释。',
    };
  }
  const testedSameBase = normalizeBaseUrl(settings.aiLastTestBaseUrl) === normalizeBaseUrl(settings.aiBaseUrl);
  const testedSameModel = settings.aiLastTestModel === settings.aiModel;
  if (testedSameBase && testedSameModel && settings.aiLastTestStatus === 'available') {
    return {
      status: 'available',
      label: 'AI 可用',
      tone: 'ready',
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      lastTestAt: settings.aiLastTestAt,
      message: '生成建议时会调用 AI 参与产品阶段诊断、动态阈值建议和动作解释。',
    };
  }
  if (testedSameBase && testedSameModel && settings.aiLastTestStatus === 'failed') {
    return {
      status: 'failed',
      label: 'AI 测试失败',
      tone: 'blocked',
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      lastTestAt: settings.aiLastTestAt,
      message: settings.aiLastTestMessage || '最近一次 AI 连接测试失败，本次可能回落到规则。',
    };
  }
  return {
    status: 'pending_test',
    label: 'AI 待测试',
    tone: 'pending',
    model: settings.aiModel,
    baseUrl: settings.aiBaseUrl,
    message: 'API Key 已配置，但当前 Base URL 或模型未完成可用性测试；建议先到设置页测试 AI 连接。',
  };
}

interface GenerateAiSummary {
  generated: number;
  metrics: number;
  candidates: number;
  skipped: number;
  configured: boolean;
  invoked: boolean;
  aiCount: number;
  ruleCount: number;
  model?: string;
  reason: string;
  aiCandidateCount: number;
  finalActionCount: number;
  strategy?: {
    source?: 'ai' | 'rule';
    lifecycleStage?: string;
    summary?: string;
    mainProblems?: string[];
    riskWarnings?: string[];
    thresholdSuggestions?: Record<string, { value: number; reason: string }>;
    aiCandidateCount?: number;
    operationEventCount?: number;
    productContextCount?: number;
    decisionCounts?: {
      total?: number;
      aligned?: number;
      ruleOnly?: number;
      aiOnly?: number;
      conflict?: number;
      reviewRequired?: number;
    };
    finalCandidateCount?: number;
    filteredAiOnlyCandidateCount?: number;
    filterReasons?: string[];
    fallbackReason?: string;
  };
}

function generateAiTone(summary: GenerateAiSummary): 'success' | 'default' | 'blocked' | 'warning' {
  if (!summary.configured) return 'warning';
  if (!summary.invoked) return 'default';
  if (summary.aiCount > 0 || summary.strategy?.source === 'ai') return 'success';
  return 'warning';
}

function generateAiStatus(summary: GenerateAiSummary): string {
  if (!summary.configured) return '未配置 AI Key';
  if (!summary.invoked) return 'AI 未调用';
  if (summary.aiCount > 0) return 'AI 已参与';
  if (summary.strategy?.source === 'ai') return 'AI 已参与诊断';
  return 'AI 无可用输出';
}

function generateStrategyThresholdLine(summary: GenerateAiSummary): string {
  const thresholds = summary.strategy?.thresholdSuggestions;
  if (!thresholds) return '暂无动态阈值建议';
  const parts = [
    thresholds.targetAcos ? `目标 ACOS ${formatPercent(Number(thresholds.targetAcos.value) * 100)}` : '',
    thresholds.highAcosThreshold ? `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold.value) * 100)}` : '',
    thresholds.noOrderClickThreshold ? `无订单 ${Number(thresholds.noOrderClickThreshold.value)} 点击` : '',
    thresholds.minSpend ? `最低花费 ${formatUsd(Number(thresholds.minSpend.value))}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : '暂无动态阈值建议';
}

function generateDecisionDiagnosticLine(summary: GenerateAiSummary): string {
  const counts = summary.strategy?.decisionCounts;
  if (!counts) return '暂无 AI/规则合并诊断';
  return [
    `一致 ${Number(counts.aligned || 0)}`,
    `规则-only ${Number(counts.ruleOnly || 0)}`,
    `AI-only ${Number(counts.aiOnly || 0)}`,
    `冲突 ${Number(counts.conflict || 0)}`,
    `需复核 ${Number(counts.reviewRequired || 0)}`,
  ].join(' / ');
}

function generateFilterReasonLine(summary: GenerateAiSummary): string {
  const reasons = summary.strategy?.filterReasons || [];
  if (reasons.length) return reasons.join('；');
  return '本次没有返回额外过滤原因。';
}

function productStageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '关键词探索',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    clearance: '清货',
    declining_repair: '衰退修复',
    launch: '新品启动',
    growth: '增长期',
    stabilize: '稳定期',
    harvest: '利润收割',
    active: '在售',
    unknown: '未知阶段',
  };
  return labels[String(stage || 'unknown')] || String(stage || '未知阶段');
}

function optionalPercent(value: unknown): string {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? formatPercent(numberValue * 100) : '-';
}

function optionalMoney(value: unknown): string {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? formatUsd(numberValue) : '-';
}

function emptyRecommendationReason(
  quantReady: boolean,
  lastGenerateResult: GenerateAiSummary | null,
  aiReadiness: AiReadiness,
  gateIssues: string[],
): { title: string; detail: string; nextStep: string; tone: 'default' | 'warning' | 'blocked' } {
  if (!quantReady) {
    return {
      title: '缺少真实数据，建议生成被锁定',
      detail: gateIssues.length
        ? `当前阻断：${gateIssues.slice(0, 3).join('；')}。`
        : '当前范围没有真实报表文件或导入指标，系统不会调用 AI，也不会用 0 值生成建议。',
      nextStep: '回到数据采集页，确认 xlsx/xls/csv 文件存在并完成导入。',
      tone: 'blocked',
    };
  }
  if (!lastGenerateResult) {
    return {
      title: '尚未生成当前范围建议',
      detail: '当前列表只显示待审批建议。请先点击“生成优化建议”，系统会用规则和 AI 并行诊断当前范围。',
      nextStep: aiReadiness.status === 'available' ? '点击生成优化建议。' : '建议先到设置页测试 AI；也可以先用规则 fallback 生成。',
      tone: 'default',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.skipped > 0) {
    return {
      title: '没有新增建议，候选已存在',
      detail: `${lastGenerateResult.candidates} 条候选中有 ${lastGenerateResult.skipped} 条重复建议已跳过，待审批列表可能已经被审批、拒绝或过滤。`,
      nextStep: '刷新待审批列表，或到审批中心查看已处理建议。',
      tone: 'warning',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.candidates === 0) {
    const aiCandidateText = lastGenerateResult.aiCandidateCount > 0
      ? `AI 返回 ${lastGenerateResult.aiCandidateCount} 条候选，但未形成可绑定当前广告对象的待审批动作。`
      : 'AI 没有返回可审批动作候选。';
    const filterReasons = lastGenerateResult.strategy?.filterReasons?.length
      ? ` 过滤原因：${lastGenerateResult.strategy.filterReasons.join('；')}`
      : '';
    return {
      title: '没有可安全绑定的广告动作',
      detail: `${lastGenerateResult.reason || '规则和 AI 完成诊断，但没有找到足够明确、可绑定 campaign/ad group/对象的动作。'} ${aiCandidateText}${filterReasons}`,
      nextStep: '查看广告量化页的风险对象；必要时补充运营事件或调整阈值后重新生成。若 AI 候选被过滤，说明它缺少可匹配的 campaign/ad group/关键词/投放对象。',
      tone: 'warning',
    };
  }
  return {
    title: '待审批列表为空',
    detail: '本次生成可能已经完成但当前筛选状态没有 pending 建议，或建议已被处理。',
    nextStep: '刷新建议列表，或到审批中心查看已审批/已拒绝记录。',
    tone: 'default',
  };
}

export function RecommendationsPage() {
  const { data, loading: pipelineLoading, reload: reloadPipeline, scope } = useBusinessDataPipeline();
  const [recommendations, setRecommendations] = useState<RecommendationView[]>([]);
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const [ruleConfig, setRuleConfig] = useState<SettingsRuleConfig | null>(null);
  const [aiSettings, setAiSettings] = useState<AiProviderSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastGenerateResult, setLastGenerateResult] = useState<GenerateAiSummary | null>(null);
  const quantReady = Boolean(data?.collection.realReportFiles.length && data?.quant.hasImportedMetrics);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const importedRowCount = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const realReportCount = data?.collection.fileAudit?.realReportFileCount ?? data?.collection.realReportFiles.length ?? 0;
  const actionableMetricRows = data?.quant.actionableRows ?? 0;
  const diagnosticCount = data?.quant.diagnostics?.length ?? 0;
  const timelineCount = data?.quant.adObjectTimelines?.length ?? 0;
  const recommendationGateIssues = useMemo(() => {
    const issues = new Set<string>();
    if (!data) {
      issues.add('正在读取当前业务范围的数据状态');
      return Array.from(issues);
    }
    if (!data.collection.realReportFiles.length) issues.add('当前范围缺少真实 xlsx/xls/csv 原始报表文件');
    if ((data.collection.fileAudit?.importedRowCount ?? data.quant.importedRows ?? 0) <= 0) issues.add('当前范围没有写入 DB 的广告指标行');
    if (data.quant.importedRows > 0 && !data.quant.hasImportedMetrics) issues.add('当前范围没有 keyword/search term/target 等可执行口径指标');
    for (const blocker of [...(data.collection.blockers || []), ...(data.quant.blockers || [])]) {
      if (blocker) issues.add(blocker);
    }
    if (!currentBatchId) issues.add('当前范围没有可绑定的采集批次');
    return Array.from(issues);
  }, [currentBatchId, data]);
  const operationEvents = data?.operations?.events || [];
  const productContexts = data?.productContext?.products || [];
  const productContextCount = data?.productContext?.productCount ?? productContexts.length;
  const productWithTargetCount = productContexts.filter((item) => Number(item.cost?.targetAcos || 0) > 0 || Number(item.cost?.targetTacos || 0) > 0).length;
  const primaryProductContext = productContexts.find((item) => scope.asin && item.asin.toUpperCase() === scope.asin.toUpperCase()) || productContexts[0];
  const latestOperationEvent = [...operationEvents].sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))[0];
  const aiTextCount = recommendations.filter((item) => item.evidence?.explanationSource === 'ai').length;
  const aiStrategyCount = recommendations.filter((item) => item.evidence?.aiStrategySource === 'ai').length;
  const aiParticipatedCount = recommendations.filter((item) => item.evidence?.explanationSource === 'ai' || item.evidence?.aiStrategySource === 'ai').length;
  const ruleOnlyCount = recommendations.length - aiParticipatedCount;
  const alignedCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'aligned').length;
  const conflictCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'conflict').length;
  const aiOnlyCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'ai_only').length;
  const reviewRequiredCount = recommendations.filter((item) => item.status === 'needs_review' || item.evidence?.decisionRequiresReview || item.evidence?.quantReviewRequired).length;
  const wasteCount = recommendations.filter((item) => item.evidence?.quantStatus === 'waste').length;
  const totalPendingSpend = recommendations.reduce((sum, item) => sum + Number(item.evidence?.cost ?? item.cost ?? 0), 0);
  const highRiskCount = recommendations.filter((item) => ['high', 'APPROVAL', 'HIGH'].includes(String(item.riskLevel))).length;
  const aiReadiness = aiReadinessFromSettings(aiSettings);
  const emptyReason = emptyRecommendationReason(quantReady, lastGenerateResult, aiReadiness, recommendationGateIssues);
  const topRecommendation = [...recommendations].sort((a, b) => {
    const riskDelta = Number(['high', 'APPROVAL', 'HIGH'].includes(String(b.riskLevel))) - Number(['high', 'APPROVAL', 'HIGH'].includes(String(a.riskLevel)));
    if (riskDelta !== 0) return riskDelta;
    return Number(b.evidence?.cost ?? b.cost ?? 0) - Number(a.evidence?.cost ?? a.cost ?? 0);
  })[0];
  const selectedOperationEvents = selected
    ? operationEvents.filter((event) => eventMatchesRecommendation(event, selected)).slice(0, 4)
    : [];

  const filter = useMemo(() => ({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    status: 'pending',
    limit: 100,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  async function loadRecommendations() {
    setLoading(true);
    setMessage(null);
    try {
      const rows = await (window as any).electronAPI?.getRecommendations?.(filter);
      const nextRows = Array.isArray(rows) ? rows : [];
      setRecommendations(nextRows);
      setSelected((current) => (current && nextRows.some((row) => row.id === current.id) ? current : null));
    } catch (caught) {
      setMessage(errorMessage(caught, '加载优化建议失败'));
    } finally {
      setLoading(false);
    }
  }

  async function generateRecommendations() {
    if (!quantReady) {
      setMessage(`建议生成被锁定：${recommendationGateIssues.length ? recommendationGateIssues.join('；') : '当前范围缺少真实原始报表文件或导入指标'}。`);
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const result = await (window as any).electronAPI?.generateRecommendations?.({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
        batchId: currentBatchId,
        limit: 300,
      });
      await reloadPipeline();
      await loadRecommendations();
      const generated = Number(result?.generated ?? 0);
      const metrics = Number(result?.metrics ?? 0);
      const candidates = Number(result?.recommendationCandidates ?? generated);
      const skipped = Number(result?.skippedDuplicates ?? 0);
      const aiExplanation = result?.aiExplanation || {};
      const strategyDiagnosis = aiExplanation.strategyDiagnosis && typeof aiExplanation.strategyDiagnosis === 'object'
        ? aiExplanation.strategyDiagnosis
        : undefined;
      const aiReason = aiExplanation.reason ? ` ${aiExplanation.reason}` : '';
      const duplicateNote = skipped > 0 ? ` 另有 ${skipped} 条重复建议已跳过。` : '';
      setLastGenerateResult({
        generated,
        metrics,
        candidates,
        skipped,
        configured: Boolean(aiExplanation.configured),
        invoked: Boolean(aiExplanation.invoked),
        aiCount: Number(aiExplanation.aiCount || 0),
        ruleCount: Number(aiExplanation.ruleCount || 0),
        model: typeof aiExplanation.model === 'string' ? aiExplanation.model : undefined,
        reason: typeof aiExplanation.reason === 'string' ? aiExplanation.reason : '本次生成未返回 AI 参与说明。',
        aiCandidateCount: Number(strategyDiagnosis?.aiCandidateCount || 0),
        finalActionCount: generated + skipped,
        strategy: strategyDiagnosis,
      });
      const aiCandidateCount = Number(strategyDiagnosis?.aiCandidateCount || 0);
      const finalActionCount = generated + skipped;
      setMessage(`已生成 ${generated} 条新建议，规则候选 ${candidates} 条，AI 候选 ${aiCandidateCount} 条，最终可审批动作 ${finalActionCount} 条，处理 ${metrics} 行广告指标。${duplicateNote}${aiReason}`);
    } catch (caught) {
      setMessage(errorMessage(caught, '生成优化建议失败'));
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled && config) setRuleConfig(config);
      } catch {
        if (!cancelled) setRuleConfig(null);
      }
      try {
        const getSettings = (window as any).electronAPI?.getSettings;
        if (typeof getSettings !== 'function') {
          if (!cancelled) setAiSettings(null);
        } else {
          const settings = await getSettings();
          if (!cancelled) setAiSettings(normalizeAiSettings(settings));
        }
      } catch {
        if (!cancelled) setAiSettings(null);
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentBatchId) {
      setRecommendations([]);
      setSelected(null);
      return;
    }
    loadRecommendations();
  }, [currentBatchId, filter]);

  return (
    <div>
      <PageHeader
        eyebrow="广告执行"
        title="优化建议"
        description="只负责生成和解释广告建议。审批、真实执行和回读在后续独立页面完成，避免一个页面承担全部任务。"
        primaryTask="解释为什么要改"
        nextAction={quantReady ? '生成或复核建议' : '先完成数据采集和广告量化'}
      />

      <div className="business-stack">
        <Panel title="建议生成范围" tone={quantReady ? 'success' : 'blocked'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">
                真实报表 {data?.collection.realReportFiles.length ?? 0} 个，导入指标 {importedRowCount} 行。
              </p>
            </div>
            <StatusPill tone={quantReady ? 'ready' : 'blocked'}>
              {quantReady ? '可以生成建议' : '缺真实数据，建议生成锁定'}
            </StatusPill>
          </div>
          <div className="business-pill-row">
            <StatusPill tone={aiReadiness.tone}>{aiReadiness.label}</StatusPill>
            <StatusPill tone="pending">{aiReadiness.model || '模型未读取'}</StatusPill>
            <StatusPill tone="pending">{aiReadiness.baseUrl || 'Base URL 未读取'}</StatusPill>
          </div>
          <p className={aiReadiness.status === 'available' ? 'muted-line' : aiReadiness.status === 'failed' ? 'blocked-line' : 'warning-line'}>
            {aiReadiness.message}
          </p>
          <div className="context-summary-grid">
            <div>
              <span>真实广告事实</span>
              <strong>{realReportCount} 个表格 / {importedRowCount} 行 DB 指标</strong>
              <p>只使用当前范围真实 xlsx/xls/csv 导入后的每日广告事实。</p>
            </div>
            <div>
              <span>可执行口径</span>
              <strong>{actionableMetricRows} 行 / {diagnosticCount} 个诊断对象</strong>
              <p>建议只绑定 keyword、search term、target 等能落到广告对象的行。</p>
            </div>
            <div>
              <span>阶段与运营上下文</span>
              <strong>{timelineCount} 条时间线 / {operationEvents.length} 条运营事件</strong>
              <p>AI 会结合对象生命周期、Coupon、BD、调价、库存和 Listing 变更解释波动。</p>
            </div>
            <div>
              <span>产品配置</span>
              <strong>{productContextCount} 个产品 / {productWithTargetCount} 个有目标阈值</strong>
              <p>
                {primaryProductContext
                  ? `${primaryProductContext.asin} / ${productStageLabel(primaryProductContext.productStage)} / 目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)} / TACOS ${optionalPercent(primaryProductContext.cost?.targetTacos)}`
                  : '未配置产品成本、阶段和目标阈值时，AI 只能按广告表现估算。'}
              </p>
            </div>
            <div>
              <span>规则阈值</span>
              <strong>{thresholdSummary(ruleConfig)}</strong>
              <p>规则先给出可复现候选，AI 再参与阶段判断、动态阈值和异常解释。</p>
            </div>
            <div>
              <span>本次 AI 输入</span>
              <strong>广告事实 + 产品配置 + 运营事件 + 规则阈值 + 量化诊断</strong>
              <p>AI 不直接读取审计包，也不会在缺真实数据时用 0 值生成建议。</p>
            </div>
            <div>
              <span>安全边界</span>
              <strong>只生成待审批建议</strong>
              <p>本页不审批、不执行广告、不写入 Amazon；后续必须逐条审批和回读。</p>
            </div>
          </div>
          {!quantReady && recommendationGateIssues.length > 0 && (
            <div className="inline-blocker-list">
              <strong>当前不能生成建议的原因</strong>
              <ul>
                {recommendationGateIssues.slice(0, 6).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="action-row">
            <button className="secondary-button" disabled={loading} onClick={loadRecommendations} type="button">
              {loading ? '刷新中...' : '刷新建议'}
            </button>
            <button className="primary-button" disabled={!quantReady || generating || pipelineLoading} onClick={generateRecommendations} type="button">
              {generating ? '生成中...' : '生成优化建议'}
            </button>
          </div>
          {message && <p className={message.includes('失败') || message.includes('不能') ? 'blocked-line' : 'muted-line'}>{message}</p>}
        </Panel>

        {lastGenerateResult && (
          <Panel title="本次生成 AI 参与状态" tone={generateAiTone(lastGenerateResult)}>
            <div className="context-summary-grid">
              <div>
                <span>AI 状态</span>
                <strong>{generateAiStatus(lastGenerateResult)}</strong>
                <p>{lastGenerateResult.reason}</p>
              </div>
              <div>
                <span>模型</span>
                <strong>{lastGenerateResult.model || '-'}</strong>
                <p>{lastGenerateResult.configured ? '来自当前保存的 DeepSeek/OpenAI Compatible 设置。' : '未配置 Key 时不会伪装成 AI 策略。'}</p>
              </div>
              <div>
                <span>生成结果</span>
                <strong>{lastGenerateResult.generated} 新建议 / {lastGenerateResult.finalActionCount} 可审批动作</strong>
                <p>规则候选 {lastGenerateResult.candidates} 条，AI 候选 {lastGenerateResult.aiCandidateCount} 条，跳过 {lastGenerateResult.skipped} 条重复建议。</p>
              </div>
              <div>
                <span>解释来源</span>
                <strong>{lastGenerateResult.aiCount} AI 建议解释 / {lastGenerateResult.ruleCount} 规则解释</strong>
                <p>
                  {lastGenerateResult.strategy?.source === 'ai'
                    ? 'AI 已参与产品阶段诊断和动态阈值；AI-only 和冲突建议只进入人工复核。'
                    : '这里统计建议文本解释来源；AI 不可用时回落到规则解释。'}
                </p>
              </div>
              <div>
                <span>事件上下文</span>
                <strong>{operationEvents.length} 条运营事件</strong>
                <p>{operationEvents.length ? '已进入广告阶段诊断和动态阈值判断。' : '本次生成没有运营事件背景，AI 只看广告数据。'}</p>
              </div>
              <div>
                <span>产品上下文</span>
                <strong>{lastGenerateResult.strategy?.productContextCount ?? productContextCount} 个产品配置</strong>
                <p>
                  {primaryProductContext
                    ? `${primaryProductContext.asin} / ${productStageLabel(primaryProductContext.productStage)} / 目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)}`
                    : '本次没有产品成本和目标阈值，AI 阈值建议缺少利润空间约束。'}
                </p>
              </div>
              <div>
                <span>广告阶段诊断</span>
                <strong>{lifecycleLabel(lastGenerateResult.strategy?.lifecycleStage)} / {lastGenerateResult.strategy?.source === 'ai' ? 'AI' : '规则 fallback'}</strong>
                <p>{lastGenerateResult.strategy?.summary || '本次没有返回阶段诊断摘要。'}</p>
              </div>
              <div>
                <span>动态阈值建议</span>
                <strong>{generateStrategyThresholdLine(lastGenerateResult)}</strong>
                <p>
                  AI 候选 {lastGenerateResult.aiCandidateCount} 条，
                  运营事件 {lastGenerateResult.strategy?.operationEventCount ?? 0} 条，
                  产品配置 {lastGenerateResult.strategy?.productContextCount ?? productContextCount} 个进入诊断上下文。
                </p>
              </div>
              <div>
                <span>AI/规则合并诊断</span>
                <strong>{generateDecisionDiagnosticLine(lastGenerateResult)}</strong>
                <p>{generateFilterReasonLine(lastGenerateResult)}</p>
              </div>
            </div>
          </Panel>
        )}

        <Panel title="建议处理路径">
          <div className="workflow-strip">
            <button className="workflow-step" onClick={() => generateRecommendations()} disabled={!quantReady || generating || pipelineLoading} type="button">
              <span>1. 生成解释</span>
              <strong>{recommendations.length ? `${recommendations.length} 条待审批` : '等待生成建议'}</strong>
              <StatusPill tone={quantReady ? 'pending' : 'blocked'}>{quantReady ? '本页完成' : '缺真实数据'}</StatusPill>
            </button>
            <button className="workflow-step" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'approval' }))} disabled={!recommendations.length} type="button">
              <span>2. 审批决策</span>
              <strong>人工批准或拒绝</strong>
              <StatusPill tone={recommendations.length ? 'pending' : 'blocked'}>去审批中心</StatusPill>
            </button>
            <button className="workflow-step" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'readback' }))} disabled={!recommendations.length} type="button">
              <span>3. 执行回读</span>
              <strong>记录 before/after/readback</strong>
              <StatusPill tone={recommendations.length ? 'warning' : 'blocked'}>独立证据页</StatusPill>
            </button>
          </div>
          <p className="blocked-line">本页不审批、不执行广告、不写入 Amazon；真实动作必须在审批后逐条记录截图和回读证据。</p>
        </Panel>

        <Panel title="建议上下文检查">
          <div className="context-summary-grid">
            <div>
              <span>当前批次</span>
              <strong>{currentBatchId || '-'}</strong>
              <p>建议必须绑定当前真实报表批次；审批时会重新校验。</p>
            </div>
            <div>
              <span>待审批建议</span>
              <strong>{recommendations.length}</strong>
              <p>{aiStrategyCount} 条 AI 策略诊断，{aiTextCount} 条 AI 文本解释，{ruleOnlyCount} 条纯规则 fallback。</p>
            </div>
            <div>
              <span>AI/规则合并</span>
              <strong>{alignedCount} 一致 / {conflictCount} 冲突 / {aiOnlyCount} AI-only</strong>
              <p>冲突和 AI-only 建议必须人工复核，不会进入自动执行。</p>
            </div>
            <div>
              <span>规则量化</span>
              <strong>{wasteCount} 浪费 / {reviewRequiredCount} 需复核</strong>
              <p>复核来源包括规则样本不足、白名单、AI 冲突和高风险动作。</p>
            </div>
            <div>
              <span>运营事件</span>
              <strong>{operationEvents.length} 条进入 AI 上下文</strong>
              <p>{latestOperationEvent ? `${latestOperationEvent.eventDate} / ${latestOperationEvent.title}` : '无事件时 AI 只能参考广告报表。'}</p>
            </div>
            <div>
              <span>产品目标</span>
              <strong>{productContextCount} 个产品配置</strong>
              <p>
                {primaryProductContext
                  ? `${primaryProductContext.asin}：${productStageLabel(primaryProductContext.productStage)}，目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)}，TACOS ${optionalPercent(primaryProductContext.cost?.targetTacos)}。`
                  : '建议到“产品配置”填写阶段、成本、最低价和目标 ACOS/TACOS。'}
              </p>
            </div>
            <div>
              <span>涉及花费</span>
              <strong>{formatUsd(totalPendingSpend)}</strong>
              <p>金额口径为 USD，仅来自当前范围导入指标。</p>
            </div>
            <div>
              <span>执行边界</span>
              <strong>{highRiskCount} 条需重点复核</strong>
              <p>本页只生成解释，不执行广告动作。</p>
            </div>
          </div>
        </Panel>

        {!recommendations.length && (
          <Panel title="为什么现在没有建议" tone={emptyReason.tone}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">{emptyReason.title}</div>
                <p className="muted-line">{emptyReason.detail}</p>
                <p className="muted-line">{emptyReason.nextStep}</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={quantReady ? 'ready' : 'blocked'}>{quantReady ? '真实数据可用' : '缺真实数据'}</StatusPill>
                <StatusPill tone={aiReadiness.tone}>{aiReadiness.label}</StatusPill>
                {lastGenerateResult && (
                  <>
                    <StatusPill tone={lastGenerateResult.candidates > 0 ? 'pending' : 'warning'}>规则候选 {lastGenerateResult.candidates}</StatusPill>
                    <StatusPill tone={lastGenerateResult.aiCandidateCount > 0 ? 'pending' : 'warning'}>AI候选 {lastGenerateResult.aiCandidateCount}</StatusPill>
                    <StatusPill tone={lastGenerateResult.finalActionCount > 0 ? 'ready' : 'warning'}>可审批 {lastGenerateResult.finalActionCount}</StatusPill>
                    <StatusPill tone={lastGenerateResult.skipped > 0 ? 'warning' : 'pending'}>跳过 {lastGenerateResult.skipped}</StatusPill>
                  </>
                )}
              </div>
            </div>
            <div className="action-row">
              <button className="primary-button" disabled={!quantReady || generating || pipelineLoading} onClick={generateRecommendations} type="button">
                {generating ? '生成中...' : '重新生成优化建议'}
              </button>
              <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: quantReady ? 'ad-quant' : 'data-collection' }))} type="button">
                {quantReady ? '查看广告量化' : '去数据采集'}
              </button>
            </div>
          </Panel>
        )}

        <Panel title="AI + 规则并行决策模型" tone={quantReady ? 'default' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>规则引擎</span>
              <strong>硬阈值与安全边界</strong>
              <p>使用目标 ACOS、高风险 ACOS、无订单点击、最低花费和白名单，先产生可解释的规则候选。</p>
            </div>
            <div>
              <span>DeepSeek / AI</span>
              <strong>{aiReadiness.label}</strong>
              <p>{aiReadiness.status === 'available' ? '结合每日广告数据、产品推广阶段和运营事件，判断冷启动、测词、放量、稳定或异常修复。' : aiReadiness.message}</p>
            </div>
            <div>
              <span>合并层</span>
              <strong>{alignedCount} 一致 / {conflictCount} 冲突 / {aiOnlyCount} AI-only</strong>
              <p>规则和 AI 一致才进入普通审批；冲突、AI-only 和样本不足进入人工复核。</p>
            </div>
            <div>
              <span>量化输入</span>
              <strong>{importedRowCount} 行 / {operationEvents.length} 条事件 / {productContextCount} 个产品</strong>
              <p>建议只基于当前范围真实报表、产品配置和运营事件；没有导入指标时不调用 AI 生成建议。</p>
            </div>
            <div>
              <span>利润约束</span>
              <strong>目标 ACOS {optionalPercent(primaryProductContext?.cost?.targetAcos)} / 净利率 {optionalPercent(primaryProductContext?.cost?.targetNetMargin)}</strong>
              <p>{primaryProductContext ? `最低价 ${optionalMoney(primaryProductContext.cost?.minPrice)}，用于约束 AI 动态阈值建议。` : '未维护成本和目标时，建议先到产品配置页补齐。'}</p>
            </div>
          </div>
        </Panel>

        <Panel title="建议优先级与判断标准" tone={recommendations.length ? 'warning' : 'default'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line">
                {topRecommendation ? `${topRecommendation.actionType} / ${recommendationObject(topRecommendation)}` : '当前范围暂无待审批建议'}
              </div>
              <p className="muted-line">
                {topRecommendation
                  ? `优先按风险等级和涉及花费排序：${formatUsd(topRecommendation.evidence?.cost ?? topRecommendation.cost)} / ACOS ${formatPercent((topRecommendation.evidence?.acos ?? topRecommendation.acos ?? 0) * 100)}。`
                  : '生成建议前先确认真实报表、导入指标和量化口径。'}
              </p>
              <p className="muted-line">规则阈值：{thresholdSummary(ruleConfig)}</p>
            </div>
            <div className="business-pill-row business-pill-row-right">
              <StatusPill tone={highRiskCount > 0 ? 'warning' : 'pending'}>高风险 {highRiskCount}</StatusPill>
              <StatusPill tone={conflictCount > 0 ? 'blocked' : alignedCount > 0 ? 'ready' : 'pending'}>AI/规则一致 {alignedCount}</StatusPill>
              <StatusPill tone={reviewRequiredCount > 0 ? 'warning' : 'pending'}>需复核 {reviewRequiredCount}</StatusPill>
              <StatusPill tone={aiParticipatedCount > 0 ? 'ready' : 'pending'}>AI参与 {aiParticipatedCount}</StatusPill>
              <StatusPill tone={aiTextCount > 0 ? 'ready' : 'pending'}>AI解释 {aiTextCount}</StatusPill>
              <StatusPill tone={recommendations.length > 0 ? 'ready' : 'pending'}>待处理 {recommendations.length}</StatusPill>
            </div>
          </div>
          <div className="action-row">
            <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'settings' }))} type="button">
              调整规则阈值
            </button>
            <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'approval' }))} disabled={!recommendations.length} type="button">
              去审批中心
            </button>
          </div>
        </Panel>

        <Panel title="待审批建议">
          <div className="table-wrap">
            <table className="business-table recommendation-table">
              <thead>
                <tr>
                  <th>建议动作</th>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>产品/ASIN</th>
                  <th>对象类型</th>
                  <th>对象</th>
                  <th>当前值</th>
                  <th>建议值</th>
                  <th>证据指标</th>
                  <th>批次/来源</th>
                  <th>来源</th>
                  <th>规则量化</th>
                  <th>AI/规则判断</th>
                  <th>风险</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((rec) => (
                  <tr key={rec.id}>
                    <td>{rec.actionType}</td>
                    <td>{rec.evidence?.portfolioName || '-'}</td>
                    <td>{rec.evidence?.campaignName || '-'}</td>
                    <td>{rec.evidence?.adGroupName || '-'}</td>
                    <td>{rec.evidence?.asin || '-'}</td>
                    <td>{recommendationType(rec)}</td>
                    <td>{recommendationObject(rec)}</td>
                    <td>{rec.currentValue || '-'}</td>
                    <td>{rec.recommendedValue || '-'}</td>
                    <td>
                      <strong>{formatUsd(rec.evidence?.cost ?? rec.cost)}</strong>
                      <div className="muted-cell">
                        ACOS {formatPercent((rec.evidence?.acos ?? rec.acos ?? 0) * 100)} / {rec.evidence?.orders ?? '-'} 单 / {rec.evidence?.clicks ?? rec.clicks} 点击
                      </div>
                    </td>
                    <td>
                      <strong>{evidenceBatch(rec, currentBatchId)}</strong>
                      <div className="muted-cell">{evidenceSourceFiles(rec).length} 个来源文件{rec.evidence?.sourceRow ? ` / 行 ${rec.evidence.sourceRow}` : ''}</div>
                    </td>
                    <td>{sourceLabel(rec)}</td>
                    <td>
                      <StatusPill tone={quantTone(rec.evidence?.quantStatus)}>{quantLabel(rec.evidence?.quantStatus)}</StatusPill>
                      <div className="muted-cell">{lifecycleLabel(rec.evidence?.quantLifecycleStage || rec.evidence?.aiLifecycleStage)}</div>
                    </td>
                    <td>
                      <StatusPill tone={decisionTone(rec)}>{decisionLabel(rec)}</StatusPill>
                      <div className="muted-cell">{reviewReason(rec)}</div>
                    </td>
                    <td><StatusPill tone={riskTone(rec.riskLevel)}>{rec.riskLevel}</StatusPill></td>
                    <td>
                      <button className="secondary-button compact-button" onClick={() => setSelected(rec)} type="button">
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
                {!recommendations.length && (
                  <tr>
                    <td colSpan={16}>{quantReady ? '当前范围还没有待审批建议。' : '缺少真实数据，本页不生成建议。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {selected && (
          <Panel title="建议详情">
            {(() => {
              const issues = recommendationEvidenceIssues(selected, currentBatchId);
              const sourceBatchId = selected.evidence?.batchId || '-';
              const batchMatched = Boolean(selected.evidence?.batchId && currentBatchId && selected.evidence.batchId === currentBatchId);
              return (
                <div className="evidence-check-panel">
                  <div className="business-split">
                    <div>
                      <h3>送审前证据检查</h3>
                      <p className="muted-line">审批中心只接收绑定当前批次、对象、来源文件和当前/建议值完整的建议。</p>
                    </div>
                    <StatusPill tone={issues.length ? 'blocked' : 'ready'}>
                      {issues.length ? `缺 ${issues.length} 项` : '证据完整'}
                    </StatusPill>
                  </div>
                  <div className="business-pill-row">
                    <StatusPill tone={batchMatched ? 'ready' : 'blocked'}>
                      {batchMatched ? '来源批次匹配' : '来源批次需核对'}
                    </StatusPill>
                    <StatusPill tone={evidenceSourceFiles(selected).length ? 'ready' : 'blocked'}>
                      来源文件 {evidenceSourceFiles(selected).length}
                    </StatusPill>
                    <StatusPill tone={selected.currentValue && selected.recommendedValue ? 'ready' : 'blocked'}>
                      当前/建议值
                    </StatusPill>
                    <StatusPill tone={selected.evidence?.explanationSource === 'ai' ? 'ready' : 'pending'}>
                      {sourceLabel(selected)}
                    </StatusPill>
                    <StatusPill tone={decisionTone(selected)}>
                      {decisionLabel(selected)}
                    </StatusPill>
                  </div>
                  <p className={issues.length ? 'blocked-line' : 'muted-line'}>
                    {issues.length
                      ? `送审前需要补齐：${issues.join('、')}。`
                      : `可进入审批中心复核；来源批次 ${sourceBatchId} 已绑定当前范围。`}
                  </p>
                </div>
              );
            })()}
            <div className="detail-grid">
              <div><span>数据范围</span><strong><ScopeText scope={data?.scope || scope} /></strong></div>
              <div><span>数据批次</span><strong>{evidenceBatch(selected, currentBatchId)}</strong></div>
              <div><span>当前值</span><strong>{selected.currentValue || '-'}</strong></div>
              <div><span>建议值</span><strong>{selected.recommendedValue || '-'}</strong></div>
              <div><span>广告组合</span><strong>{selected.evidence?.portfolioName || '-'}</strong></div>
              <div><span>广告活动</span><strong>{selected.evidence?.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{selected.evidence?.adGroupName || '-'}</strong></div>
              <div><span>产品/ASIN</span><strong>{selected.evidence?.asin || '-'}</strong></div>
              <div><span>对象类型</span><strong>{recommendationType(selected)}</strong></div>
              <div><span>对象</span><strong>{recommendationObject(selected)}</strong></div>
              <div><span>指标日期</span><strong>{selected.evidence?.date || '-'}</strong></div>
              <div><span>来源行号</span><strong>{selected.evidence?.sourceRow ?? '-'}</strong></div>
              <div><span>当前指标</span><strong>{formatUsd(selected.evidence?.cost ?? selected.cost)} / {selected.evidence?.clicks ?? selected.clicks} clicks / {selected.evidence?.orders ?? '-'} orders</strong></div>
              <div><span>销售额</span><strong>{formatUsd(selected.evidence?.sales ?? 0)} / ACOS {formatPercent((selected.evidence?.acos ?? selected.acos ?? 0) * 100)}</strong></div>
              <div><span>推荐动作</span><strong>{selected.actionType} {selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</strong></div>
              <div><span>解释来源</span><strong>{sourceLabel(selected)}{selected.evidence?.aiModel ? ` / ${selected.evidence.aiModel}` : ''}</strong></div>
              <div><span>策略诊断</span><strong>{strategyLabel(selected)} / {lifecycleLabel(selected.evidence?.aiLifecycleStage)}</strong></div>
              <div><span>AI 动态阈值</span><strong>{thresholdSuggestionSummary(selected)}</strong></div>
              <div><span>规则量化</span><strong>{quantLabel(selected.evidence?.quantStatus)} / {lifecycleLabel(selected.evidence?.quantLifecycleStage)}</strong></div>
              <div><span>规则阈值</span><strong>{ruleQuantThresholdSummary(selected)}</strong></div>
              <div><span>复核原因</span><strong>{reviewReason(selected)}</strong></div>
              <div><span>AI/规则合并</span><strong>{decisionLabel(selected)}{selected.evidence?.decisionRequiresReview ? ' / 需人工复核' : ''}</strong></div>
              <div><span>运营事件</span><strong>{selected.evidence?.operationEventCount ?? 0} 条进入诊断上下文</strong></div>
              <div><span>产品配置</span><strong>{selected.evidence?.productContextCount ?? 0} 个进入诊断上下文</strong></div>
              <div><span>产品阶段</span><strong>{productStageLabel(selected.evidence?.productStage)}</strong></div>
              <div><span>产品目标 ACOS / TACOS</span><strong>{optionalPercent(selected.evidence?.productTargetAcos)} / {optionalPercent(selected.evidence?.productTargetTacos)}</strong></div>
              <div><span>目标净利率 / 最低价</span><strong>{optionalPercent(selected.evidence?.productTargetNetMargin)} / {optionalMoney(selected.evidence?.productMinPrice)}</strong></div>
              <div><span>规则阈值</span><strong>{thresholdSummary(ruleConfig)}</strong></div>
              <div><span>执行边界</span><strong>只解释和送审，不执行广告动作</strong></div>
            </div>
            {selected.evidence?.aiStrategySummary && (
              <div className="evidence-check-panel">
                <h3>AI 策略诊断</h3>
                <p className="muted-line">{selected.evidence.aiStrategySummary}</p>
                <p className="muted-line">动态阈值：{thresholdSuggestionSummary(selected)}</p>
                {Boolean(selected.evidence.aiMainProblems?.length) && (
                  <div className="business-pill-row">
                    {selected.evidence.aiMainProblems?.map((problem) => (
                      <StatusPill key={problem} tone="pending">{problem}</StatusPill>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="evidence-check-panel">
              <h3>关联运营事件</h3>
              {selectedOperationEvents.length > 0 ? (
                <div className="context-summary-grid">
                  {selectedOperationEvents.map((event) => (
                    <div key={event.id}>
                      <span>{event.eventDate} / {operationEventTypeLabel(event.eventType)}</span>
                      <strong>{event.title}</strong>
                      <p>{event.impactExpectation || '影响待观察'} / {event.asin || event.campaignName || '当前范围'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-line">
                  {selected.evidence?.operationEventCount
                    ? `${selected.evidence.operationEventCount} 条运营事件进入了整体诊断，但没有精确绑定到当前建议对象。`
                    : '当前建议没有关联运营事件，AI 和规则只参考广告数据。'}
                </p>
              )}
            </div>
            {Boolean(selected.evidence?.quantReasons?.length) && (
              <div className="evidence-check-panel">
                <h3>规则量化依据</h3>
                <p className="muted-line">{ruleQuantThresholdSummary(selected)}</p>
                <ul className="business-list">
                  {selected.evidence?.quantReasons?.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
            <p className="muted-line">{selected.evidence?.aiExplanation || selected.reason}</p>
            {selected.evidence?.aiFallbackReason && <p className="blocked-line">{selected.evidence.aiFallbackReason}</p>}
            {Boolean(selected.evidence?.decisionReasons?.length) && (
              <ul className="business-list">
                {selected.evidence?.decisionReasons?.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            {Boolean(selected.evidence?.decisionRiskWarnings?.length) && (
              <ul className="business-list">
                {selected.evidence?.decisionRiskWarnings?.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            {Boolean(evidenceSourceFiles(selected).length) && (
              <div className="source-file-list">
                <span>来源文件</span>
                {evidenceSourceFiles(selected).map((file) => (
                  <code key={file} title={file}>{file}</code>
                ))}
              </div>
            )}
            {Boolean(selected.evidence?.aiRiskWarnings?.length) && (
              <ul className="business-list">
                {selected.evidence?.aiRiskWarnings?.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
