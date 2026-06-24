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

export function Sidebar({ activeRoute, onNavigate }: { activeRoute: AppRoute; onNavigate: (route: AppRoute) => void }) {
  return (
    <nav className="app-sidebar" aria-label="主导航">
      {navGroups.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item, index) => (
            <button
              aria-current={activeRoute === item.id ? 'page' : undefined}
              className="nav-item"
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <span className="nav-item-index">{navItemOrdinal(index)}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
