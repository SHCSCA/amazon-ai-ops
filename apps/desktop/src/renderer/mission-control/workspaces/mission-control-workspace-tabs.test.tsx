import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import type { WorkspaceSubviewShellProps } from '../../components/workspace';
import type { NavigationIntent } from '../../navigation';
import { MISSION_CONTROL_WORKSPACE_REGISTRY } from './registry';
import { MissionControlWorkspaceTabs } from './mission-control-workspace-tabs';

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!React.isValidElement(node)) return '';
  return textContent(node.props.children);
}

function firstIntent(workspaceIndex: number): NavigationIntent {
  const workspace = MISSION_CONTROL_WORKSPACE_REGISTRY[workspaceIndex];
  return {
    workspace: workspace.id,
    subview: workspace.subviews[0].id,
  } as NavigationIntent;
}

function viewCapability(
  view: MissionControlCapabilityProjection['view'],
  state: MissionControlCapabilityProjection['state'],
): MissionControlCapabilityProjection {
  return {
    capabilityId: `${view}.view`,
    workspace: view.split('/')[0] as MissionControlCapabilityProjection['workspace'],
    view,
    action: 'view',
    state,
    detail: `${view} ${state}`,
  };
}

describe('MissionControlWorkspaceTabs', () => {
  it('exposes every one of the 22 registered intents from its workspace first screen', () => {
    const reached: NavigationIntent[] = [];
    for (let workspaceIndex = 0; workspaceIndex < MISSION_CONTROL_WORKSPACE_REGISTRY.length; workspaceIndex += 1) {
      const registration = MISSION_CONTROL_WORKSPACE_REGISTRY[workspaceIndex];
      const tree = MissionControlWorkspaceTabs({
        intent: firstIntent(workspaceIndex),
        capabilities: registration.subviews.map((subview) => viewCapability(subview.view, 'PROTOTYPE_ONLY')),
        onNavigate: (intent) => reached.push(intent),
        children: <div>ACTIVE_VIEW</div>,
      }) as ReactElement<WorkspaceSubviewShellProps<string>>;

      expect(tree.props.tabs.map((tab) => tab.id)).toEqual(registration.subviews.map((subview) => subview.id));
      for (const subview of registration.subviews) tree.props.onNavigate(subview.id);
    }

    expect(reached).toHaveLength(22);
    expect(reached.map((intent) => `${intent.workspace}/${intent.subview}`)).toEqual(
      MISSION_CONTROL_WORKSPACE_REGISTRY.flatMap((workspace) => (
        workspace.subviews.map((subview) => `${workspace.id}/${subview.id}`)
      )),
    );
  });

  it('renders an accessible tablist and keeps capability state explicit per view', () => {
    const registration = MISSION_CONTROL_WORKSPACE_REGISTRY.find((workspace) => workspace.id === 'objects')!;
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceTabs
        capabilities={registration.subviews.map((subview, index) => (
          viewCapability(subview.view, index === 0 ? 'PRODUCTION_NATIVE' : index === 1 ? 'BLOCKED' : 'PROTOTYPE_ONLY')
        ))}
        intent={{ workspace: 'objects', subview: 'targets' }}
        onNavigate={vi.fn()}
      >
        <section>对象工作台</section>
      </MissionControlWorkspaceTabs>,
    );

    expect((markup.match(/role="tab"/g) ?? [])).toHaveLength(4);
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('data-capability-state="PRODUCTION_NATIVE"');
    expect(markup).toContain('data-capability-state="BLOCKED"');
    expect(markup).toContain('data-capability-state="PROTOTYPE_ONLY"');
    expect(markup).toContain('生产');
    expect(markup).toContain('受阻');
    expect(markup).toContain('原型');
  });

  it('shows loading before Main capability projection arrives without inventing authority', () => {
    const tree = MissionControlWorkspaceTabs({
      intent: { workspace: 'missions', subview: 'overview' },
      capabilities: undefined,
      onNavigate: vi.fn(),
      children: <div>MISSION_VIEW</div>,
    }) as ReactElement<WorkspaceSubviewShellProps<string>>;

    expect(tree.props.tabs).toHaveLength(2);
    expect(tree.props.tabs.every((tab) => textContent(tab.status) === '读取中')).toBe(true);
  });
});
