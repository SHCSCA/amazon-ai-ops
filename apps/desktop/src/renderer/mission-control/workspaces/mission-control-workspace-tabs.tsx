import React from 'react';
import type {
  MissionControlCapabilityProjection,
  MissionControlCapabilityState,
} from '@amazon-ai-ops/shared-types';
import { WorkspaceSubviewShell } from '../../components/workspace';
import { normalizeNavigationTarget, type NavigationIntent } from '../../navigation';
import { summarizeViewCapability } from '../components';
import { registrationForWorkspace } from './registry';
import '../../styles/mission-control-workspace-tabs.css';

const TAB_STATE_LABELS: Record<MissionControlCapabilityState, string> = {
  PRODUCTION_NATIVE: '生产',
  LEGACY_ADAPTER: '适配',
  PROTOTYPE_ONLY: '原型',
  BLOCKED: '受阻',
};

function capabilityStateForTab(
  capabilities: readonly MissionControlCapabilityProjection[] | undefined,
  view: MissionControlCapabilityProjection['view'],
): { state: MissionControlCapabilityState | 'LOADING'; label: string } {
  const summary = summarizeViewCapability(capabilities, view);
  if (!summary && capabilities === undefined) return { state: 'LOADING', label: '读取中' };
  const state = summary?.state ?? 'BLOCKED';
  return { state, label: TAB_STATE_LABELS[state] };
}

export interface MissionControlWorkspaceTabsProps {
  intent: NavigationIntent;
  capabilities?: readonly MissionControlCapabilityProjection[];
  onNavigate: (intent: NavigationIntent) => void;
  children: React.ReactNode;
}

/**
 * Canonical Mission Control navigation for all 22 registered subviews.
 *
 * Tabs only change NavigationIntent. They do not bypass the legacy adapter,
 * store authority, or action-level capability gates used by the active view.
 */
export function MissionControlWorkspaceTabs({
  intent,
  capabilities,
  onNavigate,
  children,
}: MissionControlWorkspaceTabsProps) {
  const registration = registrationForWorkspace(intent.workspace);
  const tabs = registration.subviews.map((subview) => {
    const capability = capabilityStateForTab(capabilities, subview.view);
    return {
      id: subview.id,
      label: subview.label,
      status: (
        <span
          className="mission-control-workspace-tab__state"
          data-capability-state={capability.state}
        >
          {capability.label}
        </span>
      ),
    };
  });

  return (
    <WorkspaceSubviewShell
      className="mission-control-workspace-tabs"
      description={registration.description}
      onNavigate={(subview) => {
        const nextIntent = normalizeNavigationTarget({
          workspace: intent.workspace,
          subview,
        });
        if (!nextIntent) {
          throw new Error(`Mission Control subview ${intent.workspace}/${subview} is not registered`);
        }
        onNavigate(nextIntent);
      }}
      subview={intent.subview}
      tabs={tabs}
      workspace={intent.workspace}
      workspaceLabel={registration.label}
    >
      {children}
    </WorkspaceSubviewShell>
  );
}
