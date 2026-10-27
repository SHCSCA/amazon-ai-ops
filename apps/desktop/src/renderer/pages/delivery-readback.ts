import { type ReadbackRepairIntent } from '../readback-repair-intent';
import type { DeliveryReadinessGate, DeliveryReadinessView } from '../types';
import { type ReadbackSessionCheckResult } from './delivery-contracts';
import { deliveryTextForDisplay } from './delivery-presentation';

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

export function deliveryCaptureFieldLabelForDisplay(value: unknown): string {
  return deliveryTextForDisplay(String(value || ''))
    .replace(/执行前\s*Ads UI live bid/gi, '现场出价')
    .replace(/执行后\s*Ads UI live bid/gi, '现场出价')
    .replace(/Ads UI live bid/gi, '现场出价');
}

export function formatCaptureMissing(
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
