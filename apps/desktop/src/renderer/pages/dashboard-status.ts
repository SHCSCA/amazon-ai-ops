import { operatorFacingAiError } from '../ai-call-diagnostics';
import type {
  AiDiagnosisRunView,
  ProductHistoryLedgerView,
  SettingsRuleConfig,
} from '../types';
import { localizeProductStage } from '@amazon-ai-ops/business-presenters';
import { type DashboardStatusCard } from "./dashboard-contracts";
import { DEFAULT_DASHBOARD_RULE_CONFIG } from "./dashboard-constants";

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeRuleConfig(config: Partial<SettingsRuleConfig> | null | undefined) {
  return {
    targetAcos: readNumber(config?.targetAcos, DEFAULT_DASHBOARD_RULE_CONFIG.targetAcos),
    highAcosThreshold: readNumber(config?.highAcosThreshold, DEFAULT_DASHBOARD_RULE_CONFIG.highAcosThreshold),
    noOrderClickThreshold: readNumber(config?.noOrderClickThreshold, DEFAULT_DASHBOARD_RULE_CONFIG.noOrderClickThreshold),
    minSpend: readNumber(config?.minSpend, DEFAULT_DASHBOARD_RULE_CONFIG.minSpend),
  };
}

export function productStageLabel(stage?: string): string {
  return localizeProductStage(stage);
}

export function dashboardSelectProductHistory(
  ledgers: ProductHistoryLedgerView[],
  scopeAsin?: string,
): ProductHistoryLedgerView | undefined {
  const requestedAsin = String(scopeAsin || '').trim().toUpperCase();
  if (!requestedAsin) return undefined;
  return ledgers.find((ledger) => ledger.asin.toUpperCase() === requestedAsin);
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

export function dashboardAiStatus(settings: Record<string, unknown> | null | undefined): {
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
} {
  if (!settings) {
    return {
      label: 'AI 状态未读取',
      detail: '设置接口不可用时，建议仍可使用规则兜底，但不会标记 AI 已参与。',
      tone: 'pending',
    };
  }
  const keyConfigured = readBoolean(settings.aiKeyConfigured ?? settings.ai_key_configured)
    || Boolean(readString(settings.aiApiKey ?? settings.ai_api_key));
  const baseUrl = readString(settings.aiBaseUrl ?? settings.ai_base_url) || 'https://api.deepseek.com';
  const model = readString(settings.aiModel ?? settings.ai_model) || 'deepseek-v4-flash';
  const testedBase = normalizeBaseUrl(settings.aiLastTestBaseUrl ?? settings.ai_last_test_base_url);
  const testedModel = readString(settings.aiLastTestModel ?? settings.ai_last_test_model);
  const testStatus = readString(settings.aiLastTestStatus ?? settings.ai_last_test_status);
  if (!keyConfigured) {
    return {
      label: 'AI 未配置',
      detail: '未配置 DeepSeek/OpenAI Compatible Key，优化建议会回落到规则解释。',
      tone: 'warning',
    };
  }
  if (testedBase === normalizeBaseUrl(baseUrl) && testedModel === model && testStatus === 'available') {
    return {
      label: 'AI 可用',
      detail: `${model} 已测试通过；生成建议时参与阶段诊断和动态阈值。`,
      tone: 'ready',
    };
  }
  if (testedBase === normalizeBaseUrl(baseUrl) && testedModel === model && testStatus === 'failed') {
    return {
      label: 'AI 测试失败',
      detail: readString(settings.aiLastTestMessage ?? settings.ai_last_test_message) || '最近一次连接测试失败，需要到 AI 设置复测。',
      tone: 'blocked',
    };
  }
  return {
    label: 'AI 待测试',
    detail: `${model} 已配置但当前 Base URL/模型未完成可用性测试。`,
    tone: 'pending',
  };
}

export function latestDiagnosisRun(runs: AiDiagnosisRunView[]): AiDiagnosisRunView | undefined {
  return [...runs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
}

export function dashboardAiWorkStatus(baseStatus: DashboardStatusCard, runs: AiDiagnosisRunView[]): DashboardStatusCard {
  const latest = latestDiagnosisRun(runs);
  if (!latest) return baseStatus;

  if (latest.success === false) {
    return {
      label: 'AI 最近诊断失败',
      detail: operatorFacingAiError(latest.errorMessage || latest.diagnosis?.aiFallbackReason || '最近一次 AI 诊断失败，建议到广告表现页查看调用记录并复测 AI 设置。'),
      tone: 'blocked',
      route: 'ad-quant',
      actionLabel: '查看 AI 诊断',
    };
  }

  const insightCount = latest.insights?.length || 0;
  const formalCount = latest.formalRecommendationCount || 0;
  if (formalCount > 0) {
    return {
      label: 'AI 已产出建议',
      detail: `最近一次 AI 诊断形成 ${formalCount} 条正式建议，另有 ${insightCount} 条洞察。继续到优化建议页查看证据和审批状态。`,
      tone: 'ready',
      route: 'recommendations',
      actionLabel: '去建议页',
    };
  }

  if (insightCount > 0) {
    return {
      label: 'AI 有洞察待补证据',
      detail: `最近一次 AI 诊断产生 ${insightCount} 条洞察，但因证据引用或广告对象绑定不足未进入建议池。先补齐证据引用、来源行和广告活动/广告组/关键词绑定。`,
      tone: 'warning',
      route: 'ad-quant',
      actionLabel: '查看 AI 诊断',
    };
  }

  if (latest.diagnosis?.summary) {
    return {
      label: 'AI 已完成诊断',
      detail: latest.diagnosis.summary,
      tone: 'pending',
      route: 'ad-quant',
      actionLabel: '查看诊断',
    };
  }

  return baseStatus;
}
