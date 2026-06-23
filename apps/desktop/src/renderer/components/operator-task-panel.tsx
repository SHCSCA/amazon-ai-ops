import React from 'react';

export type OperatorTaskAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
          className="primary-button"
          disabled={primaryAction.disabled}
          onClick={primaryAction.onClick}
          type="button"
        >
          {primaryAction.label}
        </button>
        {secondaryActions.map((action, index) => (
          <button
            className="secondary-button"
            disabled={action.disabled}
            key={`${action.label}-${index}`}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
