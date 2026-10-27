import { operatorFacingAdQuantReason } from '../evidence-display';
import type { AdStrategyDiagnosisView } from '../types';
import { type AdQuantDecisionStatus } from "./ad-quant-contracts";

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

export function aiFormalGateLabel(summary: AdStrategyDiagnosisView['summary']): string {
  if (summary.source !== 'ai') return 'AI 未进入建议池';
  if (summary.lifecycleStageRequiresReview || summary.evidenceSufficiency?.canUseForFormalActions === false) return 'AI 只作洞察';
  return 'AI 可参与建议';
}

export function aiFormalGateDetail(summary: AdStrategyDiagnosisView['summary']): string {
  if (summary.source !== 'ai') return '当前正式建议只使用规则量化，不采纳 AI 判断。';
  if (summary.lifecycleStageRequiresReview) return operatorFacingAdQuantReason(summary.lifecycleStageInvalidReasons?.join('；') || 'AI 阶段判断需要人工复核。');
  const sufficiency = summary.evidenceSufficiency;
  if (sufficiency?.canUseForFormalActions === false) return operatorFacingAdQuantReason(sufficiency.blockers.join('；') || 'AI 证据不足，不能进入正式建议。');
  return '当前 AI 判断满足证据门槛，仍需在后续页面审批和回读。';
}
