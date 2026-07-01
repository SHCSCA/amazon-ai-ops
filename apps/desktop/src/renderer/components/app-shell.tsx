import React from 'react';
import type { AppRoute, NavGroup } from '../types';

export const navGroups: NavGroup[] = [
  {
    label: '运营总览',
    items: [
      { id: 'dashboard', label: '今日看板' },
      { id: 'product-management', label: '产品管理' },
    ],
  },
  {
    label: '数据与量化',
    items: [
      { id: 'operation-scope', label: '工作范围' },
      { id: 'data-collection', label: '批量数据采集' },
      { id: 'data-import-validation', label: '指标核验入库' },
      { id: 'operation-events', label: '运营事件' },
      { id: 'product-config', label: '产品 ACOS 配置' },
      { id: 'ad-quant', label: '量化诊断中心' },
    ],
  },
  {
    label: '广告执行',
    items: [
      { id: 'recommendations', label: '优化建议草案' },
      { id: 'approval', label: '审批历史中心' },
      { id: 'readback', label: '渐进执行回读' },
    ],
  },
  {
    label: '关键词与 Listing',
    items: [
      { id: 'keyword-opportunities', label: '关键词机会矩阵' },
      { id: 'listing-optimization', label: 'Listing 结构重写' },
    ],
  },
  {
    label: '系统与交付',
    items: [
      { id: 'delivery', label: '最终验收就绪门' },
      { id: 'scheduler', label: '本地定时调度' },
      { id: 'settings', label: 'AI 适配与诊断' },
    ],
  },
];

export function navItemOrdinal(index: number): string {
  return String(index + 1).padStart(2, '0');
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
    <nav className="app-sidebar" aria-busy={navigationBusy || undefined} aria-label="主导航" data-navigation-busy={navigationBusy || undefined}>
      {navGroups.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item, index) => {
            const isPending = pendingNavRoute === item.id;
            return (
              <button
                aria-busy={isPending || undefined}
                aria-current={activeNavRoute === item.id ? 'page' : undefined}
                className="nav-item"
                data-pending={isPending ? 'true' : undefined}
                disabled={navigationBusy}
                key={item.id}
                onClick={() => {
                  if (!navigationBusy) onNavigate(item.id);
                }}
                type="button"
              >
                <span className="nav-item-index">{navItemOrdinal(index)}</span>
                <span className="nav-item-label">{item.label}</span>
                {isPending && <span className="nav-item-feedback">转跳中...</span>}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
