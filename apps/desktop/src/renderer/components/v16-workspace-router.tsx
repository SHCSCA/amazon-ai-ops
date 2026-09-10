import React from 'react';
import { MissionFlightPanel, DecisionQueuePanel, ExecutionMonitorPanel, MemoryBrowserPanel } from './v16-ui-components';
import type { MissionsWorkspaceProps } from '../mission-control/workspaces/missions-workspace';
export type V16WorkspaceView = 'missions' | 'decisions' | 'execution' | 'memory';
export function V16WorkspaceRouter({ initialView = 'missions', ...props }: Pick<MissionsWorkspaceProps, 'storeContext' | 'blockedReason' | 'capabilities' | 'previewMode' | 'onInspectBoundary'> & { initialView?: V16WorkspaceView }) {
  if (initialView === 'decisions') return <DecisionQueuePanel {...props} view="decisions/approval" />;
  if (initialView === 'execution') return <ExecutionMonitorPanel storeContext={props.storeContext} capabilities={props.capabilities} blockedReason={props.blockedReason} previewEnabled={props.previewMode} />;
  if (initialView === 'memory') return <MemoryBrowserPanel {...props} />;
  return <MissionFlightPanel {...props} />;
}
