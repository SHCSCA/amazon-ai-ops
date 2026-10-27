import type { ReactNode } from 'react';
import { WorkspaceState } from './workspace/workspace-state';
import type { AppRoute } from '../types';

export function BusinessDataConfigurationNotice() {
  return (
    <WorkspaceState
      kind="blocked"
      title="当前店铺运行配置待创建"
      description="当前业务数据尚未读取。请在系统设置中新建当前店铺运行配置，再返回刷新。"
      action={{
        label: '打开店铺配置',
        onClick: () => window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: 'settings' })),
      }}
    />
  );
}

export function BusinessDataConfigurationGuard({
  configurationRequired,
  children,
}: {
  configurationRequired: boolean;
  children: ReactNode;
}) {
  if (configurationRequired) return <BusinessDataConfigurationNotice />;
  return children;
}
