import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import React from 'react';
import { StatusPill } from '../components/ui';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { type CollectionMonitorState, type ActionProgressStep } from './collection-contracts';

export function CollectionMonitorDrawer({
  state,
  steps,
  evidenceAvailable,
  onClose,
}: {
  state: CollectionMonitorState;
  steps: ActionProgressStep[];
  evidenceAvailable?: boolean;
  onClose: () => void;
}) {
  const monitorDrawerFocus = useOverlayFocusScope<HTMLElement, HTMLElement>({
    dismissDisabled: !state.canClose,
    modal: false,
    onDismiss: onClose,
    open: true,
  });

  return (
    <aside
      aria-label="自动数据采集监控"
      aria-live="polite"
      className={`collection-monitor-drawer collection-monitor-${state.tone}`}
      ref={monitorDrawerFocus.surfaceRef}
    >
      <div className="collection-monitor-header">
        <div>
          <span>{state.title}</span>
          <strong>{state.headline}</strong>
        </div>
        <div className="collection-monitor-header-actions">
          <StatusPill tone={state.tone}>{state.statusLabel}</StatusPill>
          <WorkspaceActionButton disabledReason="当前采集动作仍在执行，完成或安全停止后可收起。" className="secondary-button compact-button" disabled={!state.canClose} onClick={onClose} type="button">
            收起
          </WorkspaceActionButton>
        </div>
      </div>
      <p className="collection-monitor-detail">{state.detail}</p>
      <div className="collection-monitor-preview" aria-label="下载中心监控预览">
        <div className="collection-monitor-preview-screen">
          <div
            aria-label="采集流程状态与最近证据"
            className="collection-monitor-preview-canvas"
            role="status"
          />
          <div className="collection-monitor-preview-overlay">
            <span className="collection-monitor-scanline" />
            <strong>{state.previewTitle}</strong>
            <small>{state.previewDetail}</small>
          </div>
        </div>
      </div>
      {steps.length > 0 && (
        <div className="collection-monitor-steps">
          {steps.map((step) => (
            <div className={`collection-monitor-step collection-monitor-step-${step.status}`} key={step.label}>
              <span />
              <div>
                <strong>{step.label}</strong>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {evidenceAvailable && (
        <div className="collection-monitor-evidence">
          <span>受控证据</span>
          <strong>已登记到当前店铺，可按工件打开</strong>
        </div>
      )}
    </aside>
  );
}
