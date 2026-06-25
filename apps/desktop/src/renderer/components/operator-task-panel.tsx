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

export function OperatorTaskPanel({
  eyebrow,
  title,
  detail,
  primaryAction,
  secondaryActions = [],
  children,
}: OperatorTaskPanelProps) {
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
    <section className="operator-task-panel">
      <div className="operator-task-main">
        {eyebrow && <div className="operator-task-eyebrow">{eyebrow}</div>}
        <h3>{title}</h3>
        {detail && <p>{detail}</p>}
        {children}
      </div>
      <div className="operator-task-actions">
        <button
          aria-busy={primaryAction.busy || undefined}
          className={actionClassName('primary-button', primaryAction)}
          disabled={primaryAction.disabled || primaryAction.busy}
          onClick={primaryAction.onClick}
          type="button"
        >
          {renderActionContent(primaryAction)}
        </button>
        {secondaryActions.map((action, index) => (
          <button
            aria-busy={action.busy || undefined}
            className={actionClassName('secondary-button', action)}
            disabled={action.disabled || action.busy}
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
