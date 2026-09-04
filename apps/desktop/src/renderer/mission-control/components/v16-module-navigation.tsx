/**
 * V1.6 Six-Module Navigation Component
 *
 * Renders the primary navigation for the six V1.6 business modules,
 * replacing the previous workspace-centric sidebar.
 */

import React from 'react';
import {
  ClipboardText,
  Stack,
  Lightbulb,
  Lightning,
  Brain,
  GearSix,
} from '@phosphor-icons/react';
import type {
  V16ModuleId,
  V16ModuleDefinition,
} from '../workspaces/v16-module-router';
import { V16_SIX_MODULES } from '../workspaces/v16-module-router';
import type { NavigationIntent } from '../../navigation';

export interface V16ModuleNavigationProps {
  activeModule?: V16ModuleId | null;
  pendingModule?: V16ModuleId | null;
  onNavigateToModule: (moduleId: V16ModuleId) => void;
  className?: string;
}

const MODULE_ICONS: Record<V16ModuleId, React.ReactElement> = {
  today: <ClipboardText size={20} weight="duotone" />,
  'operations-assets': <Stack size={20} weight="duotone" />,
  'decision-center': <Lightbulb size={20} weight="duotone" />,
  'execution-experiments': <Lightning size={20} weight="duotone" />,
  'operating-memory': <Brain size={20} weight="duotone" />,
  'system-settings': <GearSix size={20} weight="duotone" />,
};

function ModuleButton({
  module,
  isActive,
  isPending,
  onClick,
}: {
  module: V16ModuleDefinition;
  isActive: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`v16-module-nav-button ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}`}
      onClick={onClick}
      disabled={isPending}
      aria-current={isActive ? 'page' : undefined}
      aria-busy={isPending}
      title={module.description}
    >
      <span className="v16-module-nav-icon" aria-hidden="true">
        {MODULE_ICONS[module.id]}
      </span>
      <span className="v16-module-nav-label">{module.label}</span>
      {isPending && (
        <span className="v16-module-nav-pending-chip" aria-hidden="true">
          转跳中...
        </span>
      )}
    </button>
  );
}

export function V16ModuleNavigation({
  activeModule,
  pendingModule,
  onNavigateToModule,
  className = '',
}: V16ModuleNavigationProps) {
  return (
    <nav
      className={`v16-module-navigation ${className}`}
      role="navigation"
      aria-label="六模块主导航"
    >
      <div className="v16-module-nav-list" role="list">
        {V16_SIX_MODULES.map((module) => (
          <div key={module.id} role="listitem">
            <ModuleButton
              module={module}
              isActive={activeModule === module.id}
              isPending={pendingModule === module.id}
              onClick={() => onNavigateToModule(module.id)}
            />
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * Get the default navigation intent for a module.
 */
export function getModuleDefaultIntent(moduleId: V16ModuleId): NavigationIntent {
  const module = V16_SIX_MODULES.find((m) => m.id === moduleId);
  if (!module) {
    throw new Error(`Unknown module id: ${moduleId}`);
  }

  // Return the first workspace's default intent
  const firstWorkspace = module.workspaceIds[0];
  
  // Map workspace to its default intent
  const intentMap: Record<string, NavigationIntent> = {
    today: { workspace: 'today', subview: 'overview' },
    objects: { workspace: 'objects', subview: 'products' },
    collection: { workspace: 'collection', subview: 'scope' },
    missions: { workspace: 'missions', subview: 'overview' },
    decisions: { workspace: 'decisions', subview: 'recommendations' },
    execution: { workspace: 'execution', subview: 'live' },
    experiments: { workspace: 'experiments', subview: 'ledger' },
    memory: { workspace: 'memory', subview: 'timeline' },
    policy: { workspace: 'policy', subview: 'rules' },
    settings: { workspace: 'settings', subview: 'ai-and-local' },
  };

  const intent = intentMap[firstWorkspace];
  if (!intent) {
    throw new Error(`No default intent for workspace: ${firstWorkspace}`);
  }

  return intent;
}
