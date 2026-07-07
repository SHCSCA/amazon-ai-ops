import { formatUsd } from './formatters';
import type { AdStrategyDiagnosisView, AiEvidenceDisplayItemView, RecommendationEvidence } from './types';

export type DecisionEvidenceTone = 'ready' | 'pending' | 'warning' | 'blocked';

export interface DecisionEvidenceSummary {
  statusLabel: string;
  tone: DecisionEvidenceTone;
  headline: string;
  reasons: string[];
  evidenceSummary: string;
  riskWarnings: string[];
  nextAction: string;
}

export interface AdQuantDiagnosisSummary {
  statusLabel: string;
  tone: DecisionEvidenceTone;
  headline: string;
  reasons: string[];
  evidenceSummary: string;
  evidenceStats: string;
  riskWarnings: string[];
  nextAction: string;
}

export function operatorFacingAdQuantReason(value: string): string {
  return String(value || '')
    .replace(/AI unavailable/gi, 'AI 当前不可用')
    .replace(/AI 输出格式未通过校验/g, 'AI 返回内容未满足固定输出格式')
    .replace(/AI 候选动作缺少 evidenceRefs/g, 'AI 候选动作没有正确引用当前证据')
    .replace(/AI 阶段判断缺少 evidenceRefs/g, 'AI 阶段判断没有正确引用当前证据')
    .replace(/AI 阈值建议缺少 evidenceRefs/g, 'AI 阈值建议没有正确引用当前证据')
    .replace(/evidenceRefs/g, '证据引用')
    .replace(/sourceFile\/sourceRow/g, '报表来源文件和行号')
    .replace(/sourceFile/g, '报表来源文件')
    .replace(/sourceRow/g, '报表来源行');
}

export function formatEvidenceRefSummary(
  refs: string[] | undefined,
  evidenceItems: AiEvidenceDisplayItemView[] | undefined,
): string {
  const evidenceById = new Map((evidenceItems || []).map((item) => [item.evidenceId, item]));
  const cleanRefs = (refs || []).filter(Boolean);
  if (!cleanRefs.length) return '无';
  return cleanRefs
    .map((ref) => {
      const evidence = evidenceById.get(ref);
      if (!evidence) return `缺少证据明细：${ref}`;
      return summarizeEvidenceItem(evidence);
    })
    .join('；');
}

export function summarizeEvidenceItem(item: AiEvidenceDisplayItemView): string {
  return [
    evidenceTypeLabel(item.type),
    item.label,
    item.batchId ? `批次 ${item.batchId}` : '',
    item.reportType ? `报表 ${item.reportType}` : '',
    item.dateRange ? `日期 ${item.dateRange}` : '',
    item.campaignName ? `广告活动 ${item.campaignName}` : '',
    item.adGroupName ? `广告组 ${item.adGroupName}` : '',
    item.asin ? `ASIN ${item.asin}` : '',
    evidenceObjectLabel(item),
    item.sourceRow ? `行 ${item.sourceRow}` : '',
    metricSummary(item),
  ].filter(Boolean).join(' / ');
}

export function buildDecisionEvidenceSummary(
  evidence: RecommendationEvidence | undefined,
): DecisionEvidenceSummary {
  const safeEvidence = evidence || {};
  const evidenceSummary = formatEvidenceRefSummary(
    safeEvidence.aiEvidenceRefs,
    safeEvidence.aiEvidenceDetails,
  );
  const riskWarnings = firstNonEmptyArray(
    safeEvidence.decisionRiskWarnings,
    safeEvidence.aiStrategyRiskWarnings,
    safeEvidence.aiRiskWarnings,
  );
  const missingEvidenceDetails = missingEvidenceDetailReasons(
    safeEvidence.aiEvidenceRefs,
    safeEvidence.aiEvidenceDetails,
  );

  if ((safeEvidence.aiEvidenceRefs?.length || 0) > 0 && missingEvidenceDetails.length > 0) {
    return {
      statusLabel: '证据缺失',
      tone: 'blocked',
      headline: 'AI 建议缺少可展示的证据详情，不能审批或执行。',
      reasons: missingEvidenceDetails,
      evidenceSummary,
      riskWarnings,
      nextAction: '重新生成建议或补齐 AI 证据详情后再审批。',
    };
  }

  if (safeEvidence.aiInsightOnly) {
    return {
      statusLabel: '洞察未采纳',
      tone: 'blocked',
      headline: 'AI 返回了判断，但证据不足，不能审批或执行。',
      reasons: firstNonEmptyArray(
        safeEvidence.aiInsightInvalidReasons,
        safeEvidence.aiReasoningSteps,
        ['AI 判断未进入正式建议池。'],
      ),
      evidenceSummary,
      riskWarnings,
      nextAction: '补齐真实报表指标证据后重新生成建议。',
    };
  }

  if (safeEvidence.decisionAgreement === 'conflict' || safeEvidence.decisionRequiresReview) {
    return {
      statusLabel: '需要复核',
      tone: 'warning',
      headline: safeEvidence.decisionAgreement === 'conflict'
        ? '规则与 AI 存在分歧，需要人工复核。'
        : '建议命中复核条件，需要人工确认。',
      reasons: firstNonEmptyArray(
        safeEvidence.decisionReasons,
        safeEvidence.aiReasoningSteps,
        ['该建议需要人工复核后才能审批。'],
      ),
      evidenceSummary,
      riskWarnings,
      nextAction: '先复核规则、AI 理由和真实报表证据，再决定是否审批。',
    };
  }

  if (safeEvidence.decisionAgreement === 'aligned') {
    return {
      statusLabel: '正式建议',
      tone: 'ready',
      headline: '规则与 AI 一致，且已绑定可回查证据。',
      reasons: firstNonEmptyArray(
        safeEvidence.aiReasoningSteps,
        safeEvidence.decisionReasons,
        ['规则与 AI 结论一致。'],
      ),
      evidenceSummary,
      riskWarnings,
      nextAction: '可进入审批，但仍需人工确认和结果核对。',
    };
  }

  if (safeEvidence.decisionAgreement === 'ai_only') {
    return {
      statusLabel: 'AI 复核建议',
      tone: 'warning',
      headline: 'AI 提出动作但缺少规则一致确认，需要人工复核。',
      reasons: firstNonEmptyArray(
        safeEvidence.aiReasoningSteps,
        safeEvidence.decisionReasons,
        ['AI 独立洞察不直接执行。'],
      ),
      evidenceSummary,
      riskWarnings,
      nextAction: '人工确认对象、证据和风险后才能审批。',
    };
  }

  return {
    statusLabel: '规则建议',
    tone: 'pending',
    headline: '当前建议以规则结果为主。',
    reasons: firstNonEmptyArray(
      safeEvidence.decisionReasons,
      safeEvidence.quantReasons,
      safeEvidence.aiReasoningSteps,
      ['暂无 AI 证据摘要。'],
    ),
    evidenceSummary,
    riskWarnings,
    nextAction: '查看证据后再审批。',
  };
}

function missingEvidenceDetailReasons(
  refs: string[] | undefined,
  evidenceItems: AiEvidenceDisplayItemView[] | undefined,
): string[] {
  const cleanRefs = (refs || []).map((ref) => String(ref || '').trim()).filter(Boolean);
  if (!cleanRefs.length) return [];
  const evidenceById = new Set((evidenceItems || []).map((item) => String(item.evidenceId || '').trim()).filter(Boolean));
  return cleanRefs
    .filter((ref) => !evidenceById.has(ref))
    .map((ref) => `缺少证据明细：${ref}`);
}

export function buildAdQuantDiagnosisSummary(
  diagnosis: AdStrategyDiagnosisView['summary'] | undefined,
): AdQuantDiagnosisSummary {
  if (!diagnosis) {
    return {
      statusLabel: '未运行诊断',
      tone: 'pending',
      headline: '当前范围尚未运行 AI 阶段分析。',
      reasons: ['先确认真实报表和 DB 指标，再运行 AI 阶段分析。'],
      evidenceSummary: '无',
      evidenceStats: '0 条证据',
      riskWarnings: [],
      nextAction: '先完成数据采集和导入，再运行 AI 阶段分析。',
    };
  }

  const lifecycleLabel = adLifecycleLabel(diagnosis.lifecycleStage);
  const evidenceSummary = formatEvidenceRefSummary(
    diagnosis.lifecycleStageEvidenceRefs,
    diagnosis.evidencePackPreview,
  );
  const missingLifecycleEvidenceDetails = missingEvidenceDetailReasons(
    diagnosis.lifecycleStageEvidenceRefs,
    diagnosis.evidencePackPreview,
  );
  const sufficiency = diagnosis.evidenceSufficiency;
  const riskWarnings = firstNonEmptyArray(
    diagnosis.lifecycleStageInvalidReasons,
    diagnosis.riskWarnings,
    sufficiency?.blockers,
    sufficiency?.warnings,
  );

  if (diagnosis.source === 'ai' && missingLifecycleEvidenceDetails.length > 0) {
    return {
      statusLabel: 'AI 未采纳',
      tone: 'blocked',
      headline: 'AI 未采纳：证据引用不完整，当前仍以规则量化为准。',
      reasons: operatorFacingReasons(missingLifecycleEvidenceDetails),
      evidenceSummary,
      evidenceStats: evidenceSufficiencyStats(sufficiency),
      riskWarnings: operatorFacingReasons(riskWarnings),
      nextAction: '可先生成规则建议；需要 AI 参与时重新运行阶段分析。',
    };
  }

  if (diagnosis.source !== 'ai') {
    return {
      statusLabel: 'AI 未采纳',
      tone: 'warning',
      headline: 'AI 未采纳，当前使用规则量化兜底。',
      reasons: operatorFacingReasons(firstNonEmptyArray(
        diagnosis.fallbackReason ? [diagnosis.fallbackReason] : undefined,
        diagnosis.mainProblems,
        ['AI 未参与当前广告阶段和动态阈值判断。'],
      )),
      evidenceSummary,
      evidenceStats: evidenceSufficiencyStats(sufficiency),
      riskWarnings: operatorFacingReasons(riskWarnings),
      nextAction: '规则量化可继续；修复 AI 设置后再重新分析。',
    };
  }

  if (diagnosis.lifecycleStageRequiresReview || sufficiency?.canUseForFormalActions === false) {
    const formalActionBlockedReasons = sufficiency?.canUseForFormalActions === false ? sufficiency.blockers : undefined;
    return {
      statusLabel: 'AI 需复核',
      tone: 'warning',
      headline: `AI 已返回${lifecycleLabel}判断，但证据不足，暂不进入正式建议。`,
      reasons: operatorFacingReasons(firstNonEmptyArray(
        diagnosis.lifecycleStageInvalidReasons,
        formalActionBlockedReasons,
        diagnosis.lifecycleStageReason ? [diagnosis.lifecycleStageReason] : undefined,
        ['阶段判断缺少足够的真实指标证据。'],
      )),
      evidenceSummary,
      evidenceStats: evidenceSufficiencyStats(sufficiency),
      riskWarnings: operatorFacingReasons(riskWarnings),
      nextAction: '可先生成规则建议；补齐证据后再让 AI 参与。',
    };
  }

  return {
    statusLabel: 'AI 阶段诊断',
    tone: 'ready',
    headline: `AI 判断当前处于${lifecycleLabel}，可用于动态阈值复核。`,
    reasons: operatorFacingReasons(firstNonEmptyArray(
      diagnosis.lifecycleStageReason ? [diagnosis.lifecycleStageReason] : undefined,
      diagnosis.mainProblems,
      ['AI 已完成阶段诊断。'],
    )),
    evidenceSummary,
    evidenceStats: evidenceSufficiencyStats(sufficiency),
    riskWarnings: operatorFacingReasons(riskWarnings),
    nextAction: '可以进入优化建议，但正式动作仍需审批和结果核对。',
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

function adLifecycleLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '测词',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    declining_repair: '异常修复',
    clearance: '清货',
    unknown: '阶段待判定',
  };
  return labels[String(stage || 'unknown')] || String(stage || '阶段待判定');
}

function evidenceSufficiencyStats(sufficiency: AdStrategyDiagnosisView['summary']['evidenceSufficiency']): string {
  if (!sufficiency) return '0 条证据';
  return [
    `${Number(sufficiency.metricEvidenceCount || 0)} 条指标证据`,
    `${Number(sufficiency.sampleDays || 0)} 天样本`,
    `${Number(sufficiency.totalClicks || 0)} 点击`,
    `${formatUsd(Number(sufficiency.totalCost || 0))} 花费`,
    `${Number(sufficiency.totalOrders || 0)} 单`,
  ].join(' / ');
}

function metricSummary(item: AiEvidenceDisplayItemView): string {
  if (!item.metrics) return '';
  return [
    `${formatUsd(item.metrics.cost || 0)} / ${formatUsd(item.metrics.sales || 0)}`,
    `${Number(item.metrics.orders || 0)} 单`,
    `${Number(item.metrics.clicks || 0)} 点击`,
  ].join(' / ');
}

function evidenceObjectLabel(item: AiEvidenceDisplayItemView): string {
  const entityName = String(item.entityName || '').trim();
  if (!entityName) return '';
  const entityType = String(item.entityType || '').trim();
  return entityType ? `${entityType} ${entityName}` : entityName;
}

function firstNonEmptyArray<T>(...values: Array<T[] | undefined>): T[] {
  for (const value of values) {
    if (value?.length) return value;
  }
  return [];
}

function operatorFacingReasons(values: string[]): string[] {
  return values.map(operatorFacingAdQuantReason).filter(Boolean);
}
