import React from 'react';
import type { WorkspaceAction, WorkspaceTone } from './types';

export type TaskBannerProps = {
  compact?: boolean;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  tone?: WorkspaceTone;
  status?: React.ReactNode;
  primaryAction?: WorkspaceAction;
  secondaryActions?: WorkspaceAction[];
  meta?: React.ReactNode;
  children?: React.ReactNode;
};

function taskBannerIdSeed(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

function actionReasonId(seed: string, priority: 'primary' | 'secondary', index: number): string {
  return `task-banner-${seed}-${priority}-${index}-reason`;
}

function renderActionButton({
  action,
  priority,
  index,
  groupBusy,
  seed,
}: {
  action: WorkspaceAction;
  priority: 'primary' | 'secondary';
  index: number;
  groupBusy: boolean;
  seed: string;
}) {
  const disabled = Boolean(action.disabled || groupBusy);
  const visibleDisabledReason = disabled ? action.disabledReason : undefined;
  const reasonId = visibleDisabledReason ? actionReasonId(seed, priority, index) : undefined;

  return (
    <div className="task-banner__action-shell">
      <button
        aria-busy={action.busy || undefined}
        aria-describedby={reasonId}
        aria-label={action.ariaLabel}
        className={`workspace-button workspace-button--${priority}${action.busy ? ' workspace-button--busy' : ''}`}
        data-action-id={action.actionId}
        data-action-priority={priority}
        disabled={disabled}
        onClick={action.onClick}
        type="button"
      >
        {action.busy && <span aria-hidden="true" className="workspace-spinner" />}
        <span>{action.busy ? action.busyLabel ?? '处理中...' : action.label}</span>
      </button>
      {visibleDisabledReason && (
        <span className="task-banner__disabled-reason" id={reasonId}>{visibleDisabledReason}</span>
      )}
    </div>
  );
}

export function TaskBanner({
  compact = false,
  eyebrow = '当前主任务',
  title,
  description,
  tone = 'neutral',
  status,
  primaryAction,
  secondaryActions = [],
  meta,
  children,
}: TaskBannerProps) {
  const seed = taskBannerIdSeed(`${eyebrow}:${title}`);
  const titleId = `task-banner-${seed}-title`;
  const descriptionId = description ? `task-banner-${seed}-description` : undefined;
  const visibleSecondaryActions = secondaryActions.slice(0, 2);
  const groupBusy = Boolean(primaryAction?.busy || visibleSecondaryActions.some((action) => action.busy));
  const hasActions = Boolean(primaryAction || visibleSecondaryActions.length > 0);

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`task-banner task-banner--${tone}${compact ? ' task-banner--compact' : ''}`}
      data-task-density={compact ? 'compact' : 'standard'}
      data-task-tone={tone}
    >
      <div className="task-banner__copy">
        <div className="task-banner__eyebrow">{eyebrow}</div>
        <div className="task-banner__title-line">
          <h2 id={titleId}>{title}</h2>
          {status && <span className="task-banner__status" role="status" aria-live="polite">{status}</span>}
        </div>
        {description && <div className="task-banner__description" id={descriptionId}>{description}</div>}
        {children}
        {meta && <div className="task-banner__meta">{meta}</div>}
      </div>
      {hasActions && (
        <div aria-label="首屏任务动作" className="task-banner__actions" role="group">
          {primaryAction && renderActionButton({ action: primaryAction, groupBusy, index: 0, priority: 'primary', seed })}
          {visibleSecondaryActions.map((action, index) => (
            <React.Fragment key={`${action.label}-${index}`}>
              {renderActionButton({
                action,
                groupBusy,
                index,
                priority: 'secondary',
                seed,
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
