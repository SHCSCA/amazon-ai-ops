import { rendererRuntimeLog } from '../runtime-log';
import React from 'react';
import { type ReadbackRepairAction } from './readback-workspace-model';
import { toReadbackUserFacingError } from '../user-facing-error';
import { notifyWorkflowInvalidated } from '../workflow-invalidation';
import type { WorkflowEventTarget } from '../workflow-invalidation';
import {
  type ReadbackActionButtonInput,
  type ReadbackActionButtonView,
  type ReadbackCopyCommandButtonInput,
  type ReadbackActionKey,
} from "./readback-contracts";

export function readbackVerifierPassed(value: unknown): boolean {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return result.ready === true && result.status === 'PASS';
}

export function readbackPrimaryTaskCopy(input: {
  recommendationId?: string;
  finalVerificationPassed: boolean;
  primaryRepairAction: ReadbackRepairAction;
}) {
  if (input.finalVerificationPassed) {
    return {
      dataAction: 'review-readback-result',
      title: '结果核对已通过',
      description: '最终证据已核对通过；可在详情中查看本地证据路径与校验记录。',
      statusLabel: '校验通过',
    };
  }
  if (!input.recommendationId) {
    return {
      dataAction: 'select-approved-action',
      title: '选择已批准动作',
      description: '先在第 1 步载入一条当前范围内的已批准动作，再补审批凭证、执行截图和回读值。',
      statusLabel: '待选择动作',
    };
  }
  return {
    dataAction: `repair-${input.primaryRepairAction.blocker}`,
    title: input.primaryRepairAction.label,
    description: input.primaryRepairAction.blocker === 'verification'
      ? '字段已具备，运行一次最终校验；证据完整时直接进入最终验收，仍有缺口时只打开补证流程，不会自动填写。'
      : '先修复当前最靠前的现场证据缺口；动作会切换到对应步骤并把焦点送到唯一修复目标。',
    statusLabel: '',
  };
}

export async function runReadbackWorkflowMutation<T>(
  action: 'create' | 'verify',
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
  shouldPublish: () => boolean = () => true,
): Promise<T> {
  const result = await task();
  if (!shouldPublish()) return result;
  if (action === 'create') notifyWorkflowInvalidated('readback-created', target);
  if (action === 'verify' && readbackVerifierPassed(result)) {
    notifyWorkflowInvalidated('readback-verified', target);
  }
  return result;
}

export function readbackActionButtonView(input: ReadbackActionButtonInput): ReadbackActionButtonView {
  const active = input.activeAction === input.action;
  return {
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activeAction),
    label: active ? input.busyLabel : input.label,
    showSpinner: active,
  };
}

export function readbackCopyCommandButtonView(input: ReadbackCopyCommandButtonInput): ReadbackActionButtonView {
  const active = input.activeCommand === input.command;
  return {
    ariaBusy: active ? true : undefined,
    className: ['secondary-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activeCommand),
    label: active ? '复制中...' : input.label,
    showSpinner: active,
  };
}

export function readbackPathActionKey(label: string, targetPath?: string): string {
  return targetPath ? `${label}:${targetPath}` : '';
}

export function readbackOpenPathButtonView(input: {
  activePathKey: string | null;
  baseClassName?: string;
  disabled?: boolean;
  idleLabel: string;
  pathKey: string;
}): ReadbackActionButtonView {
  const active = Boolean(input.activePathKey && input.activePathKey === input.pathKey);
  return {
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName || 'secondary-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.activePathKey || !input.pathKey),
    label: active ? '打开中...' : input.idleLabel,
    showSpinner: active,
  };
}

export function readbackActionBusyLabel(action: ReadbackActionKey): string {
  const labels: Record<ReadbackActionKey, string> = {
    'export-evidence': '导出中...',
    'fill-session': '生成中...',
    'prepare-session': '创建中...',
    'verify-evidence': '校验中...',
    'verify-session': '检查中...',
  };
  return labels[action];
}

export function readbackActionButtonContent(view: ReadbackActionButtonView) {
  if (!view.showSpinner) return view.label;
  return (
    <span className="button-content">
      <span aria-hidden="true" className="button-spinner" />
      <span>{view.label}</span>
    </span>
  );
}

export function ReadbackFieldCell({
  children,
  className = '',
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={['readback-field-cell', className].filter(Boolean).join(' ')}>
      <span className="readback-field-cell-label">{label}</span>
      {children}
    </label>
  );
}

export function readbackErrorMessage(caught: unknown, fallback: string): string {
  rendererRuntimeLog.error('renderer.readback_failed', { fallback, error: caught });
  return toReadbackUserFacingError(caught, fallback);
}
