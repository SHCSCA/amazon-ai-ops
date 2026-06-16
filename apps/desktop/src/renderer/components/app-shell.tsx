import React from 'react';
import type { AppRoute, NavGroup } from '../types';

export const navGroups: NavGroup[] = [
  { label: '运营总览', items: [{ id: 'dashboard', label: '仪表盘' }] },
  {
    label: '数据与量化',
    items: [
      { id: 'operation-scope', label: '工作范围' },
      { id: 'data-collection', label: '数据采集' },
      { id: 'data-import-validation', label: '数据导入与校验' },
      { id: 'operation-events', label: '运营事件' },
      { id: 'product-config', label: '产品配置' },
      { id: 'ad-quant', label: '广告量化' },
    ],
  },
  {
    label: '广告执行',
    items: [
      { id: 'recommendations', label: '优化建议' },
      { id: 'approval', label: '审批中心' },
      { id: 'readback', label: '执行回读' },
    ],
  },
  {
    label: '关键词与 Listing',
    items: [
      { id: 'keyword-opportunities', label: '关键词机会' },
      { id: 'listing-optimization', label: 'Listing 优化' },
    ],
  },
  {
    label: '系统与交付',
    items: [
      { id: 'delivery', label: '交付验收' },
      { id: 'scheduler', label: '定时任务' },
      { id: 'settings', label: '设置' },
    ],
  },
];

export function Sidebar({ activeRoute, onNavigate }: { activeRoute: AppRoute; onNavigate: (route: AppRoute) => void }) {
  let itemIndex = 0;

  return (
    <nav className="app-sidebar" aria-label="主导航">
      {navGroups.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item) => {
            itemIndex += 1;
            return (
              <button
                aria-current={activeRoute === item.id ? 'page' : undefined}
                className="nav-item"
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <span className="nav-item-index">{String(itemIndex).padStart(2, '0')}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
