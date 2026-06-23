import React from 'react';
import type { PageHeaderProps } from '../types';

export function PageHeader({ eyebrow, title, description, primaryTask, nextAction }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {(primaryTask || nextAction) && (
        <div className="page-header-rail">
          {primaryTask && (
            <div>
              <span>当前主任务</span>
              <strong>{primaryTask}</strong>
            </div>
          )}
          {nextAction && (
            <div>
              <span>建议下一步</span>
              <strong>{nextAction}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Panel({ title, children, tone = 'default' }: { title?: string; children: React.ReactNode; tone?: 'default' | 'warning' | 'blocked' | 'success' }) {
  return (
    <section className={`ui-panel ui-panel-${tone}`}>
      {title && (
        <div className="panel-title-row">
          <h3>{title}</h3>
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

export function StateLightGrid({ items }: { items: StateLightItem[] }) {
  return (
    <div className="state-light-grid">
      {items.map((item) => (
        <div className={`state-light-card state-light-${item.tone}`} key={item.label}>
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

export function FormTableRow({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label className="form-table-row">
      <span className="form-table-label">
        {label}
        {required && <b aria-label="必填">*</b>}
      </span>
      <span className="form-table-control">
        {children}
        {hint && <small>{hint}</small>}
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

export function DecisionActionStrip({ items }: { items: DecisionActionItem[] }) {
  return (
    <div className="decision-action-strip">
      {items.map((item) => (
        <button
          className={`decision-action decision-action-${item.tone}`}
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
