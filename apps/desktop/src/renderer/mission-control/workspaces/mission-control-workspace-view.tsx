import React from 'react';
import { CanonicalWorkspace } from './canonical-workspace';
import { LegacyWorkspace } from './legacy-workspace';
import { MissionControlWorkspaceTabs } from './mission-control-workspace-tabs';
import { subviewDefinitionForIntent } from './registry';
import type { MissionControlWorkspaceViewProps } from './types';
import { capabilityForAction } from '../components';

const CANONICAL_KIND_BY_VIEW = {
  'today/overview': 'today',
  'missions/overview': 'missions',
  'decisions/recommendations': 'decisions',
  'decisions/approval': 'decisions',
  'decisions/decided': 'decisions',
  'experiments/ledger': 'experiments',
  'execution/live': 'execution',
  'memory/timeline': 'memory',
  'policy/rules': 'policy',
} as const;

export function MissionControlWorkspaceView({
  intent,
  storeContext,
  capabilities,
  autonomy,
  previewMode,
  onNavigate,
  legacySlot,
  storeCrudSlot,
  settingsCrudSlot,
}: MissionControlWorkspaceViewProps) {
  const definition = subviewDefinitionForIntent(intent);
  const kind = CANONICAL_KIND_BY_VIEW[definition.view as keyof typeof CANONICAL_KIND_BY_VIEW];
  const viewCapability = capabilityForAction(capabilities, definition.view, 'view');
  const legacyAuthorityReady = viewCapability?.state === 'LEGACY_ADAPTER'
    || viewCapability?.state === 'PRODUCTION_NATIVE';
  const useCanonicalSurface = definition.kind === 'canonical'
    || (Boolean(kind) && !legacyAuthorityReady);
  let content: React.ReactNode;
  if (useCanonicalSurface) {
    if (!kind) {
      throw new Error(`Canonical Mission Control view ${definition.view} has no renderer`);
    }
    content = (
      <CanonicalWorkspace
        autonomy={autonomy}
        capabilities={capabilities}
        kind={kind}
        previewMode={previewMode}
        storeContext={storeContext}
        view={definition.view}
      />
    );
  } else {
    if (!definition.legacyRoute) {
      throw new Error(`Legacy Mission Control view ${definition.view} has no route adapter`);
    }
    content = (
      <LegacyWorkspace
        capabilities={capabilities}
        description={definition.description}
        intent={intent}
        legacySlot={legacySlot}
        previewMode={previewMode}
        route={definition.legacyRoute}
        settingsCrudSlot={settingsCrudSlot}
        storeContext={storeContext}
        storeCrudSlot={storeCrudSlot}
        title={definition.label}
        view={definition.view}
      />
    );
  }

  return (
    <MissionControlWorkspaceTabs
      capabilities={capabilities}
      intent={intent}
      onNavigate={onNavigate}
    >
      {content}
    </MissionControlWorkspaceTabs>
  );
}
