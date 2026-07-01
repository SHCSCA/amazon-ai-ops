import React from 'react';

export type OperatorTaskAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
};

export type OperatorTaskPanelProps = {
  eyebrow?: string;
  title: string;
  detail?: string;
  primaryAction: OperatorTaskAction;
  secondaryActions?: OperatorTaskAction[];
  children?: React.ReactNode;
};

function operatorTaskPanelIdSeed(eyebrow: string | undefined, title: string): string {
  let hash = 0;
  for (const char of `${eyebrow ?? ''}:${title}`) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function OperatorTaskPanel({
  eyebrow,
  title,
  detail,
  primaryAction,
  secondaryActions = [],
  children,
}: OperatorTaskPanelProps) {
  const idSeed = operatorTaskPanelIdSeed(eyebrow, title);
  const titleId = `operator-task-${idSeed}-title`;
  const detailId = detail ? `operator-task-${idSeed}-detail` : undefined;
  const actionBusy = Boolean(primaryAction.busy || secondaryActions.some((action) => action.busy));

  const renderActionContent = (action: OperatorTaskAction) => {
    if (!action.busy) return action.label;
    return (
      <span className="button-content">
        <span aria-hidden="true" className="button-spinner" />
        <span>{action.busyLabel ?? '处理中...'}</span>
      </span>
    );
  };

  const actionClassName = (baseClassName: string, action: OperatorTaskAction) => (
    action.busy ? `${baseClassName} button-loading` : baseClassName
  );

  return (
    <section className="operator-task-panel" aria-describedby={detailId} aria-labelledby={titleId}>
      <div className="operator-task-main">
        {eyebrow && <div className="operator-task-eyebrow">{eyebrow}</div>}
        <h2 id={titleId}>{title}</h2>
        {detail && <p id={detailId}>{detail}</p>}
        {children}
      </div>
      <div className="operator-task-actions" role="group" aria-label="首屏任务动作">
        <button
          aria-busy={primaryAction.busy || undefined}
          className={actionClassName('primary-button', primaryAction)}
          disabled={primaryAction.disabled || actionBusy}
          onClick={primaryAction.onClick}
          type="button"
        >
          {renderActionContent(primaryAction)}
        </button>
        {secondaryActions.map((action, index) => (
          <button
            aria-busy={action.busy || undefined}
            className={actionClassName('secondary-button', action)}
            disabled={action.disabled || actionBusy}
            key={`${action.label}-${index}`}
            onClick={action.onClick}
            type="button"
          >
            {renderActionContent(action)}
          </button>
        ))}
      </div>
    </section>
  );
}
