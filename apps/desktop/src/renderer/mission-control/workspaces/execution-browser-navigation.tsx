import React from 'react';
import type { ExecutionBrowserTab } from './execution-workspace-contracts';

type NavigationReasonProps = { reasonId: string };
type BrowserTabsProps = NavigationReasonProps & {
  browserTab: ExecutionBrowserTab;
  onTabChange: (tab: ExecutionBrowserTab) => void;
  previewEnabled: boolean;
};

// 导航只呈现执行投影；真实页面操作仍由既有浏览器与权限流程负责。
export function ExecutionBrowserTabs({ browserTab, onTabChange, previewEnabled, reasonId }: BrowserTabsProps) {
  return <div className="execution-browser-tabs" role="tablist" aria-label="领星页面标签">
    {([{ id: 'home', label: '首页' }, { id: 'ads', label: '广告管理' }, { id: 'search', label: '搜索词报告' }] as const).map(tab => <button
      aria-describedby={!previewEnabled ? reasonId : undefined} aria-selected={browserTab === tab.id}
      disabled={!previewEnabled} key={tab.id} onClick={() => onTabChange(tab.id)} role="tab" type="button">{tab.label}</button>)}
    <button aria-describedby={reasonId} aria-label="新建领星标签（未接入）" className="execution-browser-new-tab" disabled type="button">＋</button>
  </div>;
}

export function ExecutionBrowserNavigationNotice({ previewEnabled, reasonId }: NavigationReasonProps & { previewEnabled: boolean }) {
  return <p className="execution-browser-navigation-reason" id={reasonId}>{previewEnabled
    ? '仅开发预览：新增标签和左侧导航暂不可操作；上方标签可用于查看预览画面。'
    : '真实页面在已打开的广告浏览器中操作；请在该浏览器切换页面。'}</p>;
}

export function ExecutionBrowserSidebar({ reasonId }: NavigationReasonProps) {
  return <nav aria-label="领星广告管理导航">
    {['概览', '广告活动', '广告组', '关键词', '搜索词报告', '商品投放', '否定关键词', '广告设置'].map(item => <button
      aria-current={item === '关键词' ? 'page' : undefined} aria-describedby={reasonId} disabled key={item} type="button">{item}</button>)}
  </nav>;
}
