import type { AiCallLogView } from './types';

export interface AiCallDiagnostics {
  status: 'ready' | 'warning' | 'blocked';
  headline: string;
  detail: string;
  nextAction: string;
}

export function buildAiCallDiagnostics(logs: AiCallLogView[]): AiCallDiagnostics {
  const latest = latestAiCallLog(logs);
  if (!latest) {
    return {
      status: 'warning',
      headline: '暂无 AI 调用记录',
      detail: '当前还没有广告诊断、建议解释或 Listing 草案调用记录，无法证明 AI 已参与业务分析。',
      nextAction: '先测试 AI 连接，再运行广告量化或优化建议',
    };
  }

  const evidenceLabel = aiCallEvidenceLabel(latest);
  if (!latest.success) {
    return {
      status: 'blocked',
      headline: '最近 AI 调用失败',
      detail: `${aiCallKindLabel(latest)} / ${latest.model} / ${operatorFacingAiError(latest.errorMessage)} / ${evidenceLabel}。`,
      nextAction: '检查模型、Base URL、固定输出格式和证据包',
    };
  }

  return {
    status: 'ready',
    headline: '最近 AI 调用成功',
    detail: `${aiCallKindLabel(latest)} / ${latest.model} / 输出格式 ${aiCallOutputFormatLabel(latest)} / ${evidenceLabel}。`,
    nextAction: '查看广告量化或优化建议中的 AI 判断依据',
  };
}

export function operatorFacingAiError(message?: string): string {
  const text = String(message || '').trim();
  if (!text) return '未记录失败原因';
  if (isJsonParserDetail(text)) {
    return 'AI 输出格式未通过校验，当前使用规则引擎兜底';
  }
  return text
    .replace(/schemaVersion/gi, '输出格式')
    .replace(/JSON schema/gi, '固定输出格式')
    .replace(/\bschema\b/gi, '输出格式')
    .replace(/AI 输出\s+输出格式\s+错误/g, 'AI 输出格式错误');
}

function isJsonParserDetail(text: string): boolean {
  return /Expected ['"`].+JSON at position/i.test(text)
    || /Unexpected token.+JSON at position/i.test(text)
    || /Unexpected end of JSON input/i.test(text)
    || /after array element in JSON/i.test(text)
    || /line \d+ column \d+/i.test(text);
}

function latestAiCallLog(logs: AiCallLogView[]): AiCallLogView | undefined {
  return [...logs].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || '');
    const rightTime = Date.parse(right.createdAt || '');
    const normalizedLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
    const normalizedRightTime = Number.isFinite(rightTime) ? rightTime : 0;
    if (normalizedRightTime !== normalizedLeftTime) return normalizedRightTime - normalizedLeftTime;
    return Number(right.id || 0) - Number(left.id || 0);
  })[0];
}

export function aiCallEvidenceTotal(log: AiCallLogView): number {
  const summary = log.evidencePackSummary as any;
  return Number(summary?.total || 0);
}

export function aiCallEvidenceLabel(log: AiCallLogView): string {
  const total = aiCallEvidenceTotal(log);
  if (log.promptKey === 'ad_action_reason') return `源文件/证据引用 ${total} 条`;
  if (log.promptKey === 'listing_rewrite') return `草案证据 ${total} 条`;
  return `证据包 ${total} 条`;
}

export function aiCallKindLabel(log: Pick<AiCallLogView, 'promptKey'>): string {
  if (log.promptKey === 'ad_strategy_diagnosis') return '广告策略诊断';
  if (log.promptKey === 'ad_action_reason') return '广告建议解释';
  if (log.promptKey === 'listing_rewrite') return 'Listing 草案';
  return 'AI 调用';
}

export function aiCallOutputFormatLabel(log: Pick<AiCallLogView, 'schemaVersion' | 'promptVersion'>): string {
  const raw = String(log.schemaVersion || log.promptVersion || '').trim();
  if (!raw) return '未记录';
  const version = raw.match(/_v(\d+)$/i)?.[1];
  const suffix = version ? ` v${version}` : '';
  if (/ad_strategy_diagnosis/i.test(raw)) return `广告策略诊断${suffix}`;
  if (/ad_action_reason/i.test(raw)) return `广告建议解释${suffix}`;
  if (/listing_rewrite/i.test(raw)) return `Listing 草案${suffix}`;
  return version ? `固定输出格式 v${version}` : '固定输出格式已记录';
}
