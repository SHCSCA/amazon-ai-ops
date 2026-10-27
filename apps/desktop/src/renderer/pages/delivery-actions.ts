import type { OperatorTaskAction } from '../components/operator-task-panel';
import type { AppRoute } from '../types';
import type { WorkflowEventTarget } from '../workflow-invalidation';
import { notifyWorkflowInvalidated } from '../workflow-invalidation';
import { type DeliveryActionButtonInput, type DeliveryActionButtonView, type DeliveryActionKey, type DeliveryCopySummaryActionInput, type DeliveryOpenPathButtonInput, type FinalReadinessRefreshResult } from './delivery-contracts';

export async function readFinalReadinessRefresh(task: () => Promise<FinalReadinessRefreshResult>): Promise<FinalReadinessRefreshResult> {
  const result = await task();
  if (!result?.readiness || typeof result.readiness.appReady !== 'boolean') {
    throw new Error('未读取到本次验收结论，请刷新重试。');
  }
  return result;
}

export function deliveryReadbackVerifierPassed(value: unknown): boolean {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return result.ready === true && result.status === 'PASS';
}

export async function runDeliveryWorkflowMutation<T>(
  action: 'refresh' | 'create-readback' | 'verify-readback',
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
  canInvalidate: () => boolean = () => true,
): Promise<T> {
  const source = action === 'refresh'
    ? 'delivery-refreshed'
    : action === 'create-readback'
      ? 'readback-created'
      : 'readback-verified';
  const result = await task();
  if (canInvalidate() && (action !== 'verify-readback' || deliveryReadbackVerifierPassed(result))) {
    notifyWorkflowInvalidated(source, target);
  }
  return result;
}

export function api(): Record<string, any> {
  return ((window as any).electronAPI || {}) as Record<string, any>;
}

export function deliveryActionButtonView(input: DeliveryActionButtonInput): DeliveryActionButtonView {
  const isActive = input.activeAction === input.action;
  return {
    ariaBusy: isActive ? true : undefined,
    className: [input.baseClassName, isActive ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activeAction),
    label: isActive ? input.busyLabel : input.idleLabel,
    showSpinner: isActive,
  };
}

export function deliveryOpenPathButtonView(input: DeliveryOpenPathButtonInput): DeliveryActionButtonView {
  const isActive = input.activePathKey === input.pathKey;
  return {
    ariaBusy: isActive ? true : undefined,
    className: [input.baseClassName || 'secondary-button', isActive ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activePathKey),
    label: isActive ? (input.busyLabel || '打开中...') : input.idleLabel,
    showSpinner: isActive,
  };
}

export function deliveryCopySummaryActionView(input: DeliveryCopySummaryActionInput): OperatorTaskAction {
  return {
    label: '复制摘要',
    onClick: input.onClick,
    busy: input.copying,
    busyLabel: '复制中...',
    disabled: Boolean(input.copying || input.disabled),
  };
}

export function deliveryActionBusyLabel(action: DeliveryActionKey): string {
  const labels: Record<DeliveryActionKey, string> = {
    'create-readback': '创建中...',
    'export-bundle': '导出中...',
    'export-non-ready': '导出中...',
    'export-reconciliation': '导出中...',
    'fill-readback-session': '生成中...',
    'refresh-final': '刷新中...',
    'refresh-final-with-readback': '刷新中...',
    'verify-readback-evidence': '校验中...',
    'verify-readback-session': '检查中...',
  };
  return labels[action];
}

export function deliveryPathActionKey(label: string, targetPath: string): string {
  return `${label}:${String(targetPath || 'missing')}`;
}

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}
