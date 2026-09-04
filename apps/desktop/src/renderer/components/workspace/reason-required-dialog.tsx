import React, { useEffect, useRef, useState } from 'react';

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

  // Reset internal state when the dialog closes (or the title changes, which is
  // how callers typically re-purpose the same dialog across entities).
  useEffect(() => {
    if (!open) {
      setReason('');
    }
  }, [open, title]);

  // Autofocus the textarea on open, matching the existing inline dialogs.
  useEffect(() => {
    if (open) {
      const handle = window.setTimeout(() => textareaRef.current?.focus(), 0);
      return () => window.clearTimeout(handle);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= reasonMinLength;
  const confirmDisabled = busy || !reasonValid || Boolean(isConfirmDisabled?.(trimmedReason));

  const confirmClassName = `workspace-button workspace-button--${tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'primary'}`;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
    }
  };

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm(trimmedReason);
  };

  return (
    <div
      className="mission-control-dialog-backdrop"
      onKeyDown={handleKeyDown}
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
        role="alertdialog"
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
            <span>{reasonLabel}</span>
            <textarea
              aria-label={reasonLabel}
              aria-required="true"
              autoFocus
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              ref={textareaRef}
              rows={rows}
              value={reason}
            />
          </label>
          {!reasonValid && reason.length > 0 && (
            <p className="reason-required-dialog__hint" role="status">
              至少输入 {reasonMinLength} 个非空白字符后再确认。
            </p>
          )}
        </div>
        <footer>
          <button
            className="workspace-button workspace-button--secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            aria-busy={busy || undefined}
            className={confirmClassName}
            disabled={confirmDisabled}
            onClick={handleConfirm}
            type="button"
          >
            {busy ? `${confirmLabel}中…` : confirmLabel}
          </button>
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
