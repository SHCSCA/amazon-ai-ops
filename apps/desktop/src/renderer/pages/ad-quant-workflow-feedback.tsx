import { operatorFacingAdQuantReason } from '../evidence-display';
import type { AdStrategyDiagnosisView } from '../types';
import { runWorkflowInvalidatingMutation } from '../workflow-invalidation';
import type { WorkflowEventTarget } from '../workflow-invalidation';
import { buildDiagnosisDataRemediationAction } from './diagnosis-workspace-model';
import {
  type AdQuantActionButtonInput,
  type AdQuantActionButtonView,
  type StatusTone,
  type StrategyRunFeedback,
} from "./ad-quant-contracts";

export function runAdQuantDiagnosisWorkflowMutation<T>(
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
  canInvalidate?: () => boolean,
): Promise<T> {
  return runWorkflowInvalidatingMutation('ad-quant-diagnosis', task, target, canInvalidate);
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

export function adQuantActionButtonContent(view: AdQuantActionButtonView) {
  if (!view.showSpinner) return view.label;
  return (
    <span className="button-content">
      <span aria-hidden="true" className="button-spinner" />
      <span>{view.label}</span>
    </span>
  );
}

export function feedbackClassName(tone: StatusTone): string {
  if (tone === 'ready') return 'collection-action-feedback collection-action-feedback-ready';
  if (tone === 'blocked' || tone === 'warning') return 'collection-action-feedback collection-action-feedback-blocked';
  return 'collection-action-feedback';
}

export function isAiOutputContractFallback(reason: string): boolean {
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
