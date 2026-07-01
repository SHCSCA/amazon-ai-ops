import React from 'react';
import type { PageHeaderProps } from '../types';

function pageHeaderIdSeed(eyebrow: string, title: string): string {
  let hash = 0;
  for (const char of `${eyebrow}:${title}`) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

function panelIdSeed(title: string, tone: string): string {
  let hash = 0;
  for (const char of `${tone}:${title}`) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function PageHeader({ eyebrow, title, description, primaryTask, nextAction }: PageHeaderProps) {
  const idSeed = pageHeaderIdSeed(eyebrow, title);
  const titleId = `page-header-${idSeed}-title`;
  const descriptionId = `page-header-${idSeed}-description`;

  return (
    <header className="page-header" aria-describedby={descriptionId} aria-labelledby={titleId}>
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 id={titleId}>{title}</h1>
        <p id={descriptionId}>{description}</p>
      </div>
      {(primaryTask || nextAction) && (
        <div className="page-header-rail" role="list" aria-label="首屏主任务和建议下一步">
          {primaryTask && (
            <div className="page-header-rail-card" role="listitem" tabIndex={0}>
              <span>当前主任务</span>
              <strong>{primaryTask}</strong>
            </div>
          )}
          {nextAction && (
            <div className="page-header-rail-card" role="listitem" tabIndex={0}>
              <span>建议下一步</span>
              <strong>{nextAction}</strong>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

export function Panel({ title, children, tone = 'default' }: { title?: string; children: React.ReactNode; tone?: 'default' | 'warning' | 'blocked' | 'success' }) {
  const titleId = title ? `ui-panel-${panelIdSeed(title, tone)}-title` : undefined;

  return (
    <section aria-labelledby={titleId} className={`ui-panel ui-panel-${tone}`}>
      {title && (
        <div className="panel-title-row">
          <h3 id={titleId}>{title}</h3>
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusPill({ tone, children }: { tone: 'ready' | 'pending' | 'blocked' | 'warning'; children: React.ReactNode }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export type IndustrialTone = 'ready' | 'pending' | 'blocked' | 'warning';

export interface StateLightItem {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone: IndustrialTone;
}

export function StateLightGrid({
  items,
  refreshing = false,
  ariaLabel = '首屏状态红绿灯',
}: {
  items: StateLightItem[];
  refreshing?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={`state-light-grid${refreshing ? ' state-light-grid-refreshing' : ''}`}
      data-refreshing={refreshing || undefined}
      role="list"
    >
      {items.map((item) => (
        <div className={`state-light-card state-light-${item.tone}`} key={item.label} role="listitem" tabIndex={0}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.detail && <p>{item.detail}</p>}
        </div>
      ))}
    </div>
  );
}

export interface MicroStepItem {
  label: string;
  meta?: React.ReactNode;
  detail?: React.ReactNode;
  tone: IndustrialTone;
}

export function MicroStepper({ items }: { items: MicroStepItem[] }) {
  return (
    <div className="micro-stepper">
      {items.map((item) => (
        <div className={`micro-step micro-step-${item.tone}`} key={item.label}>
          <span className="micro-step-indicator" aria-hidden="true" />
          <span>{item.label}</span>
          {item.meta && <strong>{item.meta}</strong>}
          {item.detail && <p>{item.detail}</p>}
        </div>
      ))}
    </div>
  );
}

export function FormTable({ children }: { children: React.ReactNode }) {
  return <div className="form-table">{children}</div>;
}

export type FormTableFeedbackTone = 'ready' | 'pending' | 'blocked' | 'warning';

export function FormTableRow({
  label,
  required,
  children,
  hint,
  feedback,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: React.ReactNode;
  feedback?: {
    tone: FormTableFeedbackTone;
    children: React.ReactNode;
  };
}) {
  return (
    <label className={`form-table-row${feedback ? ` form-table-row-${feedback.tone}` : ''}`}>
      <span className="form-table-label">
        {label}
        {required && <b aria-label="必填">*</b>}
      </span>
      <span className="form-table-control">
        {children}
        {hint && <small>{hint}</small>}
        <span className="form-table-feedback-slot">
          {feedback ? (
            <small className={`form-table-feedback form-table-feedback-${feedback.tone}`} role="status" aria-live="polite">
              {feedback.children}
            </small>
          ) : (
            <small aria-hidden="true" className="form-table-feedback form-table-feedback-placeholder">
              &nbsp;
            </small>
          )}
        </span>
      </span>
    </label>
  );
}

export function SafetyGateLine({ children, tone = 'blocked' }: { children: React.ReactNode; tone?: IndustrialTone }) {
  return <div className={`safety-gate-line safety-gate-${tone}`}>{children}</div>;
}

export interface DecisionActionItem {
  label: string;
  detail?: React.ReactNode;
  tone: IndustrialTone;
  onClick?: () => void;
  disabled?: boolean;
}

export function DecisionActionStrip({
  items,
  ariaLabel = '审批三态决策动作',
}: {
  items: DecisionActionItem[];
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="decision-action-strip"
      data-hover-fade="true"
      role="group"
    >
      {items.map((item) => (
        <button
          className={`decision-action decision-action-${item.tone}`}
          data-decision-action="true"
          disabled={item.disabled}
          key={item.label}
          onClick={item.onClick}
          type="button"
        >
          <strong>{item.label}</strong>
          {item.detail && <span>{item.detail}</span>}
        </button>
      ))}
    </div>
  );
}
