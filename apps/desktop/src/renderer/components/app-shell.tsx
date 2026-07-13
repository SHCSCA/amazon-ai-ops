import React from 'react';
import type { AppRoute } from '../types';
import {
  VISIBLE_WORKSPACES,
  workspaceForRoute,
} from '../navigation';
import type { NavigationIntent, VisibleWorkspaceDefinition } from '../navigation';
import type { NextSafeAction } from '../workflow-state';

const navigationSections: Array<{
  id: 'daily' | 'system';
  label: string;
  items: readonly VisibleWorkspaceDefinition[];
}> = [
  { id: 'daily', label: '运营工作台', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'daily') },
  { id: 'system', label: '系统', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'system') },
];

export function navItemOrdinal(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function navGroupLabelId(index: number): string {
  return `app-nav-group-${index + 1}-label`;
}

export function Sidebar({
  activeRoute,
  pendingRoute = null,
  onNavigate,
}: {
  activeRoute: AppRoute;
  pendingRoute?: AppRoute | null;
  onNavigate: (intent: NavigationIntent) => void;
}) {
  const navigationBusy = Boolean(pendingRoute);
  const activeWorkspace = workspaceForRoute(activeRoute);
  const pendingWorkspace = workspaceForRoute(pendingRoute);

  return (
    <nav className="app-sidebar" aria-busy={navigationBusy || undefined} aria-label="主业务导航" data-navigation-busy={navigationBusy || undefined}>
      <div className="sidebar-brand">
        <strong>Amazon AI Ops</strong>
        <span>v1.5</span>
      </div>
      {navigationSections.map((section, groupIndex) => {
        const groupLabelId = navGroupLabelId(groupIndex);

        return (
          <section
            className={`nav-group${section.id === 'system' ? ' nav-group-system' : ''}`}
            data-navigation-section={section.id}
            key={section.id}
            role="group"
            aria-labelledby={groupLabelId}
          >
            <div className="nav-group-label" id={groupLabelId}>{section.label}</div>
            <div className="nav-item-list" role="list" aria-label={`${section.label}导航项`}>
              {section.items.map((item, index) => {
                const isPending = pendingWorkspace === item.id;
                return (
                  <div className="nav-item-shell" key={item.id} role="listitem" aria-posinset={index + 1} aria-setsize={section.items.length}>
                    <button
                      aria-busy={isPending || undefined}
                      aria-current={activeWorkspace === item.id ? 'page' : undefined}
                      aria-describedby={groupLabelId}
                      className="nav-item"
                      data-pending={isPending ? 'true' : undefined}
                      disabled={navigationBusy}
                      onClick={() => {
                        if (!navigationBusy) onNavigate(item.defaultIntent);
                      }}
                      title={item.description}
                      type="button"
                    >
                      <span className="nav-item-index">{navItemOrdinal(index)}</span>
                      <span className="nav-item-label">{item.label}</span>
                      {isPending && <span className="nav-item-feedback">转跳中...</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

export function NextSafeActionHandoff({
  action,
  onNavigate,
}: {
  action: NextSafeAction;
  onNavigate: (intent: NavigationIntent) => void;
}) {
  return (
    <section
      aria-label="下一安全动作"
      className="next-safe-action-handoff"
      data-blocked={action.blocked ? 'true' : 'false'}
      data-workflow-stage={action.stage}
    >
      <div className="next-safe-action-copy">
        <strong>下一安全动作</strong>
        <span>{action.reason}</span>
      </div>
      <button className="primary-button" onClick={() => onNavigate(action.intent)} type="button">
        {action.label}
      </button>
    </section>
  );
}
