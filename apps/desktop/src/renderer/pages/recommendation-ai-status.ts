import { localizeProductStage } from '@amazon-ai-ops/business-presenters';
import { formatPercent,formatUsd } from '../formatters';
import type { AiEvidenceSufficiencyView,AiProviderSettings } from '../types';

export type AiReadinessStatus = 'unknown' | 'unconfigured' | 'pending_test' | 'available' | 'failed';

export interface AiReadiness {
  status: AiReadinessStatus;
  label: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  model?: string;
  baseUrl?: string;
  lastTestAt?: string;
  message: string;
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

export function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

export function normalizeAiSettings(settings: Record<string, unknown> | null | undefined): AiProviderSettings {
  return {
    aiApiKey: readString(settings?.aiApiKey ?? settings?.ai_api_key),
    aiKeyConfigured: readBoolean(settings?.aiKeyConfigured ?? settings?.ai_key_configured),
    aiBaseUrl: readString(settings?.aiBaseUrl ?? settings?.ai_base_url) || 'https://api.deepseek.com',
    aiModel: readString(settings?.aiModel ?? settings?.ai_model) || 'deepseek-v4-flash',
    aiTemperature: readString(settings?.aiTemperature ?? settings?.ai_temperature) || '0.3',
    aiMaxTokens: readString(settings?.aiMaxTokens ?? settings?.ai_max_tokens) || '8192',
    aiLastTestStatus: readString(settings?.aiLastTestStatus ?? settings?.ai_last_test_status) as AiProviderSettings['aiLastTestStatus'],
    aiLastTestAt: readString(settings?.aiLastTestAt ?? settings?.ai_last_test_at),
    aiLastTestBaseUrl: readString(settings?.aiLastTestBaseUrl ?? settings?.ai_last_test_base_url),
    aiLastTestModel: readString(settings?.aiLastTestModel ?? settings?.ai_last_test_model),
    aiLastTestMessage: readString(settings?.aiLastTestMessage ?? settings?.ai_last_test_message),
  };
}

export function aiReadinessFromSettings(settings: AiProviderSettings | null): AiReadiness {
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

export interface GenerateAiSummary {
  generated: number;
  metrics: number;
  candidates: number;
  skipped: number;
  refreshed: number;
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
    evidenceSufficiency?: AiEvidenceSufficiencyView;
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
    insightOnlyCandidateCount?: number;
    aiInsights?: Array<{
      entityType?: string;
      entityName?: string;
      actionType?: string;
      reason?: string;
      invalidReasons?: string[];
      confidence?: number;
    }>;
    filteredAiOnlyCandidateCount?: number;
    filterReasons?: string[];
    fallbackReason?: string;
  };
}

export function generateAiTone(summary: GenerateAiSummary): 'success' | 'default' | 'blocked' | 'warning' {
  if (!summary.configured) return 'warning';
  if (!summary.invoked) return 'default';
  if (summary.aiCount > 0 || summary.strategy?.source === 'ai') return 'success';
  return 'warning';
}

export function generateAiStatus(summary: GenerateAiSummary): string {
  if (!summary.configured) return '未配置 AI Key';
  if (!summary.invoked) return 'AI 未调用';
  if (summary.aiCount > 0) return 'AI 已参与';
  if (summary.strategy?.source === 'ai') return 'AI 已参与诊断';
  if (summary.strategy?.fallbackReason) return `AI 已转为规则兜底：${summary.strategy.fallbackReason}`;
  if (summary.strategy?.aiInsights?.length) return 'AI 仅作洞察';
  return 'AI 无可用输出';
}

export function generateStrategyThresholdLine(summary: GenerateAiSummary): string {
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

export function generateDecisionDiagnosticLine(summary: GenerateAiSummary): string {
  const counts = summary.strategy?.decisionCounts;
  if (!counts) return '暂无 AI/规则合并诊断';
  return [
    `一致 ${Number(counts.aligned || 0)}`,
    `规则独立 ${Number(counts.ruleOnly || 0)}`,
    `AI 独立洞察 ${Number(counts.aiOnly || 0)}`,
    `冲突 ${Number(counts.conflict || 0)}`,
    `需复核 ${Number(counts.reviewRequired || 0)}`,
  ].join(' / ');
}

export function generateFilterReasonLine(summary: GenerateAiSummary): string {
  const reasons = summary.strategy?.filterReasons || [];
  if (reasons.length) return reasons.join('；');
  return '本次没有返回额外过滤原因。';
}

export function productStageLabel(stage?: string): string {
  return localizeProductStage(stage);
}

export function optionalPercent(value: unknown): string {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? formatPercent(numberValue * 100) : '-';
}

export function optionalMoney(value: unknown): string {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? formatUsd(numberValue) : '-';
}

export function emptyRecommendationReason(
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
      nextStep: '到“数据准备 → 报表采集”确认 xlsx/xls/csv 文件存在，再到“导入检查”完成入库。',
      tone: 'blocked',
    };
  }
  if (!lastGenerateResult) {
    return {
      title: '尚未生成当前范围建议',
      detail: '当前列表显示待审批建议和需复核建议。请先点击“生成优化建议”，系统会用规则和 AI 并行诊断当前范围。',
      nextStep: aiReadiness.status === 'available' ? '点击生成优化建议。' : '建议先到设置页测试 AI；也可以先用规则兜底生成。',
      tone: 'default',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.refreshed > 0) {
    return {
      title: '已刷新历史不完整建议',
      detail: `${lastGenerateResult.candidates} 条候选中有 ${lastGenerateResult.refreshed} 条旧建议已补齐为当前证据链版本。`,
      nextStep: '刷新建议池，检查这些建议的来源报表、行号和建议值后再进入审批。',
      tone: 'default',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.skipped > 0) {
    return {
      title: '没有新增建议，候选已存在',
      detail: `${lastGenerateResult.candidates} 条候选中有 ${lastGenerateResult.skipped} 条重复建议已跳过，建议池可能已经被审批、拒绝或过滤。`,
      nextStep: '刷新建议池，或到审批中心查看已处理建议。',
      tone: 'warning',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.candidates === 0) {
    const aiCandidateText = lastGenerateResult.aiCandidateCount > 0
      ? `AI 返回 ${lastGenerateResult.aiCandidateCount} 条候选，但未形成可绑定当前广告对象的待审批动作。`
      : 'AI 没有返回可审批动作候选。';
    const insightReasons = (lastGenerateResult.strategy?.aiInsights || []).flatMap((item) => item.invalidReasons || []);
    const filterReasonList = [
      ...(lastGenerateResult.strategy?.filterReasons || []),
      ...insightReasons,
    ].filter(Boolean);
    const filterReasons = filterReasonList.length
      ? ` 未进入建议池原因：${Array.from(new Set(filterReasonList)).slice(0, 4).join('；')}`
      : '';
    if ((lastGenerateResult.strategy?.aiInsights?.length || 0) > 0 || insightReasons.length > 0) {
      return {
        title: 'AI 仅生成洞察，未进入建议池',
        detail: `${lastGenerateResult.reason || 'AI 已完成诊断，但没有形成可审批动作。'} ${aiCandidateText}${filterReasons}`,
        nextStep: '先补齐证据和对象绑定：确认来源行、广告活动/广告组/关键词或投放对象能回查到当前真实报表；必要时补充运营事件和产品配置后重新生成。',
        tone: 'warning',
      };
    }
    return {
      title: '没有可安全绑定的广告动作',
      detail: `${lastGenerateResult.reason || '规则和 AI 完成诊断，但没有找到足够明确、可绑定广告活动/广告组/对象的动作。'} ${aiCandidateText}${filterReasons}`,
      nextStep: '查看广告表现页的风险对象；必要时补充运营事件或调整阈值后重新生成。若 AI 候选被过滤，说明它缺少可匹配的广告活动/广告组/关键词/投放对象。',
      tone: 'warning',
    };
  }
  return {
    title: '建议池为空',
    detail: '本次生成可能已经完成但当前筛选状态没有待审批或需复核建议，或建议已被处理。',
    nextStep: '刷新建议列表，或到审批中心查看已审批/已拒绝记录。',
    tone: 'default',
  };
}
