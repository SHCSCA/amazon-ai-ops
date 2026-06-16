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
