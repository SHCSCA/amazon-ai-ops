import React from 'react';
import type { AppRoute, NavGroup } from '../types';

export const navGroups: NavGroup[] = [
  {
    label: '总览',
    items: [
      { id: 'dashboard', label: '今日看板' },
      { id: 'product-management', label: '产品管理' },
    ],
  },
  {
    label: '数据',
    items: [
      { id: 'operation-scope', label: '工作范围' },
      { id: 'data-collection', label: '数据采集' },
      { id: 'data-import-validation', label: '导入校验' },
      { id: 'operation-events', label: '运营事件' },
      { id: 'product-config', label: '成本目标' },
      { id: 'ad-quant', label: '广告表现' },
    ],
  },
  {
    label: '广告',
    items: [
      { id: 'recommendations', label: '优化建议' },
      { id: 'approval', label: '审批中心' },
      { id: 'readback', label: '结果核对' },
    ],
  },
  {
    label: '增长',
    items: [
      { id: 'keyword-opportunities', label: '关键词机会' },
      { id: 'listing-optimization', label: 'Listing草案' },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'delivery', label: '交付验收' },
      { id: 'scheduler', label: '自动任务' },
      { id: 'settings', label: 'AI与规则' },
    ],
  },
];

export function navItemOrdinal(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function navGroupLabelId(index: number): string {
  return `app-nav-group-${index + 1}-label`;
}

export function visibleNavRouteFor(route?: AppRoute | null): AppRoute | null {
  if (!route) return null;
  return route;
}

export function Sidebar({
  activeRoute,
  pendingRoute = null,
  onNavigate,
}: {
  activeRoute: AppRoute;
  pendingRoute?: AppRoute | null;
  onNavigate: (route: AppRoute) => void;
}) {
  const navigationBusy = Boolean(pendingRoute);
  const activeNavRoute = visibleNavRouteFor(activeRoute);
  const pendingNavRoute = visibleNavRouteFor(pendingRoute);

  return (
    <nav className="app-sidebar" aria-busy={navigationBusy || undefined} aria-label="主业务导航" data-navigation-busy={navigationBusy || undefined}>
      <div className="sidebar-brand">
        <strong>Amazon AI Ops</strong>
        <span>v1.5</span>
      </div>
      {navGroups.map((group, groupIndex) => {
        const groupLabelId = navGroupLabelId(groupIndex);

        return (
          <section className="nav-group" key={group.label} role="group" aria-labelledby={groupLabelId}>
            <div className="nav-group-label" id={groupLabelId}>
              {group.label}
            </div>
            <div className="nav-item-list" role="list" aria-label={`${group.label}导航项`}>
              {group.items.map((item, index) => {
                const isPending = pendingNavRoute === item.id;
                return (
                  <div className="nav-item-shell" key={item.id} role="listitem" aria-posinset={index + 1} aria-setsize={group.items.length}>
                    <button
                      aria-busy={isPending || undefined}
                      aria-current={activeNavRoute === item.id ? 'page' : undefined}
                      aria-describedby={groupLabelId}
                      className="nav-item"
                      data-pending={isPending ? 'true' : undefined}
                      disabled={navigationBusy}
                      onClick={() => {
                        if (!navigationBusy) onNavigate(item.id);
                      }}
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
