import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import React, { useEffect, useMemo, useRef, useState } from 'react';

export function PreviewBanner({ onInspectBoundary }: { onInspectBoundary?: () => void }) {
  return (
    <div className="execution-preview-banner" role="note">
      <strong>仅开发预览</strong>
      <span>仅开发预览 · 不连接真实广告页面，不提交任何广告调整</span>
      {onInspectBoundary && <button onClick={onInspectBoundary} type="button">查看接入边界</button>}
      <details>
        <summary>诊断详情</summary>
        <code>MISSIONGRANT → SERIAL EXECUTION</code>
        <code>内存 mock · Amazon US / USD · 不调用真实 API、不写入 Ads</code>
        <code>只演示降价且单次不超过 10%</code>
        <WorkspaceActionButton disabled type="button" disabledReason={'开发预览不能创建真实执行队列，请在真实店铺完成授权后操作。'}>从完整 Grant 建队列</WorkspaceActionButton>
      </details>
    </div>
  );
}
