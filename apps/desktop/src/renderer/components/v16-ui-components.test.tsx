import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MissionFlightPanel, DecisionQueuePanel, ExecutionMonitorPanel, MemoryBrowserPanel } from './v16-ui-components';
import { MissionsWorkspace } from '../mission-control/workspaces/missions-workspace';
import { DecisionsWorkspace } from '../mission-control/workspaces/decisions-workspace';
import { ExecutionWorkspace } from '../mission-control/workspaces/execution-workspace';
import { MemoryWorkspace } from '../mission-control/workspaces/memory-workspace';
import { V16WorkspaceRouter } from './v16-workspace-router';

describe('V1.6 entry points use the complete production workspaces', () => {
  it('shares the actual queue, decisions, execution and memory implementations', () => {
    expect(MissionFlightPanel).toBe(MissionsWorkspace);
    expect(DecisionQueuePanel).toBe(DecisionsWorkspace);
    expect(ExecutionMonitorPanel).toBe(ExecutionWorkspace);
    expect(MemoryBrowserPanel).toBe(MemoryWorkspace);
  });
  it.each(['missions', 'decisions', 'execution', 'memory'] as const)('fails closed for %s without current context and capabilities', initialView => {
    const html = renderToStaticMarkup(<V16WorkspaceRouter initialView={initialView} storeContext={null} previewMode={false} blockedReason="尚未连接当前店铺" />);
    expect(html).toContain('BLOCKED');
    expect(html).not.toContain('Navigate to execution queue');
    expect(html).not.toContain('Test Mission');
  });
});
