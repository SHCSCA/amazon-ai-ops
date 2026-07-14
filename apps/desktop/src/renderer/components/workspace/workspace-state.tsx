import React from 'react';
import type { WorkspaceAction } from './types';

export type WorkspaceStateKind = 'loading' | 'empty' | 'blocked' | 'error' | 'busy' | 'disabled';

export type WorkspaceProgress = {
  value: number;
  max: number;
  label: string;
};

export type WorkspaceStateProps = {
  kind: WorkspaceStateKind;
  title?: string;
  description: React.ReactNode;
  action?: WorkspaceAction;
  progress?: WorkspaceProgress;
  details?: React.ReactNode;
};

const defaultTitles: Record<WorkspaceStateKind, string> = {
  loading: '正在载入',
  empty: '暂无内容',
  blocked: '当前被阻塞',
  error: '加载失败',
  busy: '正在处理',
  disabled: '当前不可用',
};

export function WorkspaceState({
  kind,
  title = defaultTitles[kind],
  description,
  action,
  progress,
  details,
}: WorkspaceStateProps) {
  const live = kind === 'loading' || kind === 'busy';
  const role = kind === 'error' ? 'alert' : 'status';

  return (
    <div
      aria-busy={live || undefined}
      aria-live={role === 'status' ? 'polite' : undefined}
      className={`workspace-state workspace-state--${kind}`}
      data-workspace-state={kind}
      role={role}
    >
      <span aria-hidden="true" className="workspace-state__indicator">
        {live && <span className="workspace-spinner" />}
      </span>
      <div className="workspace-state__copy">
        <strong>{title}</strong>
        <div className="workspace-state__description">{description}</div>
        {progress && (
          <div className="workspace-state__progress">
            <progress aria-label={progress.label} max={progress.max} value={progress.value} />
            <span>{progress.label}</span>
          </div>
        )}
        {details && <div className="workspace-state__details">{details}</div>}
      </div>
      {action && (
        <button
          aria-busy={action.busy || undefined}
          aria-label={action.ariaLabel}
          className={`workspace-state__action${action.busy ? ' workspace-button--busy' : ''}`}
          disabled={action.disabled || action.busy}
          onClick={action.onClick}
          title={action.disabledReason}
          type="button"
        >
          {action.busy && <span aria-hidden="true" className="workspace-spinner" />}
          <span>{action.busy ? action.busyLabel ?? '处理中...' : action.label}</span>
        </button>
      )}
    </div>
  );
}
