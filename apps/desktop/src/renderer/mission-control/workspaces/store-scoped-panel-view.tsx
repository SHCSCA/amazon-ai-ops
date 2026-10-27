import React from 'react';
import { WorkspaceState } from '../../components/workspace';

export function MissingStoreContext({ subject }: { subject: string }) {
  return (
    <div className="store-scoped-ad-listing-panel">
      <WorkspaceState
        description={`当前店铺信息尚未完整确认，${subject}读取已停止。请刷新店铺状态后重试。`}
        kind="blocked"
        title="当前店铺尚未确认"
      />
    </div>
  );
}
