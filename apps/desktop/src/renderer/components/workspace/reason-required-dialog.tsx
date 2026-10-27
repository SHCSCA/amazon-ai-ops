import React, { useEffect, useRef, useState } from 'react';
import { WorkspaceActionButton } from './action-feedback';
import { useOverlayFocusScope } from './overlay-focus-scope';

/**
 * ReasonRequiredDialog — centralized confirm dialog for any action that must
 * record an operator-supplied reason before it can run (policy kill-switch clear,
 * decision approval/rejection, store mode switch, etc).
 *
 * Behaviour:
 * - Always renders a backdrop with a single `role="alertdialog"` section so
 *   assistive tech knows the dialog is modal.
 * - The confirm button stays disabled until the user types at least
 *   `reasonMinLength` non-whitespace characters.
 * - Esc / cancel always closes the dialog (unless `busy`).
 * - Enter inside the textarea inserts a newline; Enter on the buttons submits.
 * - `busy` disables both action buttons and the textarea.
 *
 * The dialog owns the reason text internally and only surfaces it through the
 * `onConfirm(reason)` callback. Callers do not need to manage the input state.
 */

export type ReasonRequiredDialogTone = 'danger' | 'warning' | 'primary';

export interface ReasonRequiredDialogProps {
  open: boolean;
  /** Short eyebrow label shown above the title (e.g. "解除紧急停止"). */
  eyebrow?: string;
  /** Title shown in the dialog header. Becomes the aria label. */
  title: string;
  /** Operator-facing description shown under the title. */
  description: string;
  /** Tone determines the confirm button variant. Defaults to "primary". */
  tone?: ReasonRequiredDialogTone;
  /** Confirm button label (e.g. "确认解除"). */
  confirmLabel: string;
  /** Cancel button label. Defaults to "取消". */
  cancelLabel?: string;
  /** Label for the reason textarea (e.g. "解除原因 *"). */
  reasonLabel?: string;
  /** Placeholder text inside the textarea. */
  reasonPlaceholder?: string;
  /** Minimum non-whitespace length before the confirm button enables. Defaults to 1. */
  reasonMinLength?: number;
  /** Rows for the textarea. Defaults to 4. */
  rows?: number;
  /** Disables all interaction while IPC is in flight. */
  busy?: boolean;
  /** Optional diagnostic details rendered under the footer (collapsible). */
  diagnosticDetails?: React.ReactNode;
  /** Fired when the operator confirms with a valid reason. */
  onConfirm(reason: string): void;
  /** Fired when the operator cancels / closes the dialog. */
  onClose(): void;
  /**
   * Allows callers to gate the confirm button further (e.g. capability checks).
   * When provided, the confirm button stays disabled even when reason is valid.
   */
  isConfirmDisabled?(reason: string): boolean;
}

function buildTitleId(title: string): string {
  const sanitized = title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return sanitized ? `reason-dialog-title-${sanitized}` : 'reason-dialog-title';
}

export function ReasonRequiredDialog({
  open,
  eyebrow,
  title,
  description,
  tone = 'primary',
  confirmLabel,
  cancelLabel = '取消',
  reasonLabel = '复核原因 *',
  reasonPlaceholder = '请用一句话说明这次操作的业务依据',
  reasonMinLength = 1,
  rows = 4,
  busy = false,
  diagnosticDetails,
  onConfirm,
  onClose,
  isConfirmDisabled,
}: ReasonRequiredDialogProps) {
  const [reason, setReason] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = React.useMemo(() => buildTitleId(title), [title]);

  // 对象变更或关闭时清理原因，防止沿用上一个决定的输入。
  useEffect(() => {
    setReason('');
  }, [open, title]);

  // 保留原因输入的首焦点，共享弹层负责焦点圈定与返回。
  useEffect(() => {
    if (open) {
      const handle = window.setTimeout(() => textareaRef.current?.focus(), 0);
      return () => window.clearTimeout(handle);
    }
    return undefined;
  }, [open]);
  const focusScope = useOverlayFocusScope<HTMLDivElement, HTMLElement>({ open, onDismiss: onClose, dismissDisabled: busy });

  if (!open) return null;

  // 标签尾部的必填星号仅用于展示，不加入可访问名称。
  const hasRequiredMarker = reasonLabel.endsWith(' *');
  const reasonName = hasRequiredMarker ? reasonLabel.slice(0, -2) : reasonLabel;
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= reasonMinLength;
  const confirmDisabled = busy || !reasonValid || Boolean(isConfirmDisabled?.(trimmedReason));

  const confirmClassName = `workspace-button workspace-button--${tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'primary'}`;

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm(trimmedReason);
  };

  return (
    <div
      className="mission-control-dialog-backdrop"
      ref={focusScope.overlayRootRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-description`}
        aria-modal="true"
        className="mission-control-dialog mission-control-dialog--confirm"
        ref={focusScope.surfaceRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <header>
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h2 id={titleId}>{title}</h2>
            <p id={`${titleId}-description`}>{description}</p>
          </div>
        </header>
        <div className="reason-required-dialog__body">
          <label>
            <span>{reasonName}{hasRequiredMarker ? <span aria-hidden="true"> *</span> : null}</span>
            <textarea
              aria-label={reasonName}
              aria-required="true"
              aria-describedby={busy ? `${titleId}-busy-hint` : !reasonValid ? `${titleId}-reason-hint` : undefined}
              data-overlay-initial-focus
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              ref={textareaRef}
              rows={rows}
              value={reason}
            />
          </label>
          {busy && <p className="reason-required-dialog__hint" id={`${titleId}-busy-hint`} role="status">当前操作正在提交，完成后可继续填写原因。</p>}
          {!reasonValid && (
            <p className="reason-required-dialog__hint" id={`${titleId}-reason-hint`} role="status">
              至少输入 {reasonMinLength} 个非空白字符后再确认。
            </p>
          )}
        </div>
        <footer>
          <WorkspaceActionButton
            className="workspace-button workspace-button--secondary"
            disabled={busy}
            disabledReason="当前操作正在提交，请等待完成后关闭。"
            onClick={onClose}
            type="button"
          >
            {cancelLabel}
          </WorkspaceActionButton>
          <WorkspaceActionButton
            busy={busy}
            busyLabel={`${confirmLabel}中…`}
            className={confirmClassName}
            disabled={confirmDisabled}
            disabledReason={busy ? '当前操作正在提交，请等待完成。' : !reasonValid
              ? `至少输入 ${reasonMinLength} 个非空白字符后再确认。`
              : '当前操作条件尚未满足，请关闭后刷新当前对象，再重新确认。'}
            onClick={handleConfirm}
            type="button"
          >
            {confirmLabel}
          </WorkspaceActionButton>
        </footer>
        {diagnosticDetails ? (
          <details className="reason-required-dialog__diagnostics">
            <summary>诊断详情</summary>
            {diagnosticDetails}
          </details>
        ) : null}
      </section>
    </div>
  );
}
