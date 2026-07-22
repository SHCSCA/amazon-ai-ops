import React from 'react';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import {
  ChartLineUp,
  ClipboardText,
  Database,
  Flask,
  Gear,
  ListChecks,
  MonitorPlay,
  Notebook,
  ShieldCheck,
  SidebarSimple,
  Storefront,
} from '@phosphor-icons/react';
import {
  VISIBLE_WORKSPACES,
} from '../navigation';
import type {
  NavigationIntent,
  VisibleWorkspaceDefinition,
  WorkspaceSection,
} from '../navigation';
import type { NextSafeAction } from '../workflow-state';

export const NAVIGATION_SECTION_DEFINITIONS: ReadonlyArray<{
  id: WorkspaceSection;
  label: string;
  items: readonly VisibleWorkspaceDefinition[];
}> = [
  { id: 'mission', label: '任务', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'mission') },
  { id: 'learning', label: '学习闭环', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'learning') },
  { id: 'foundation', label: '运营底座', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'foundation') },
  { id: 'governance', label: '治理', items: VISIBLE_WORKSPACES.filter((item) => item.section === 'governance') },
];

export function navGroupLabelId(index: number): string {
  return `app-nav-group-${index + 1}-label`;
}

const WORKSPACE_ICONS = {
  today: ChartLineUp,
  missions: ListChecks,
  decisions: ClipboardText,
  experiments: Flask,
  execution: MonitorPlay,
  memory: Notebook,
  objects: Storefront,
  collection: Database,
  policy: ShieldCheck,
  settings: Gear,
} as const;

export function workspaceCapabilityState(
  capabilities: readonly MissionControlCapabilityProjection[],
  workspace: VisibleWorkspaceDefinition['id'],
): MissionControlCapabilityProjection['state'] | 'MIXED' | undefined {
  const states = new Set(
    capabilities
      .filter((capability) => capability.workspace === workspace)
      .map((capability) => capability.state),
  );
  if (states.size === 0) return undefined;
  if (states.size === 1) return [...states][0];
  return 'MIXED';
}

function capabilityLabel(state: ReturnType<typeof workspaceCapabilityState>): string | null {
  if (state === 'BLOCKED') return '受阻';
  if (state === 'MIXED') return '部分可用';
  return null;
}

export function Sidebar({
  activeIntent,
  pendingIntent = null,
  capabilities = [],
  collapsed = false,
  activeStore,
  onToggleCollapsed,
  onNavigate,
}: {
  activeIntent: NavigationIntent;
  pendingIntent?: NavigationIntent | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  collapsed?: boolean;
  activeStore?: {
    storeId: string;
    displayName: string;
    marketplace: 'US';
    currency: 'USD';
  } | null;
  onToggleCollapsed?: () => void;
  onNavigate: (intent: NavigationIntent) => void;
}) {
  const navigationBusy = Boolean(pendingIntent);
  const activeWorkspace = activeIntent.workspace;
  const pendingWorkspace = pendingIntent?.workspace;

  return (
    <nav
      aria-busy={navigationBusy || undefined}
      aria-label="主业务导航"
      className={`app-sidebar${collapsed ? ' app-sidebar-collapsed' : ''}`}
      data-navigation-busy={navigationBusy || undefined}
    >
      <div className="app-sidebar-scroll">
        {NAVIGATION_SECTION_DEFINITIONS.map((section, groupIndex) => {
          const groupLabelId = navGroupLabelId(groupIndex);

          return (
            <section
              aria-labelledby={groupLabelId}
              className={`nav-group nav-group-${section.id}`}
              data-navigation-section={section.id}
              key={section.id}
              role="group"
            >
              <div className="nav-group-label" id={groupLabelId}>{section.label}</div>
              <div className="nav-item-list" role="list" aria-label={`${section.label}导航项`}>
                {section.items.map((item, index) => {
                  const isPending = pendingWorkspace === item.id;
                  const state = workspaceCapabilityState(capabilities, item.id);
                  const stateLabel = capabilityLabel(state);
                  const Icon = WORKSPACE_ICONS[item.id];
                  const active = activeWorkspace === item.id;
                  return (
                    <div
                      aria-posinset={index + 1}
                      aria-setsize={section.items.length}
                      className="nav-item-shell"
                      key={item.id}
                      role="listitem"
                    >
                      <button
                        aria-busy={isPending || undefined}
                        aria-current={active ? 'page' : undefined}
                        aria-describedby={collapsed ? undefined : groupLabelId}
                        aria-label={collapsed ? item.label : undefined}
                        className="nav-item"
                        data-capability-state={state}
                        data-pending={isPending ? 'true' : undefined}
                        disabled={navigationBusy}
                        onClick={() => {
                          if (!navigationBusy) onNavigate(item.defaultIntent);
                        }}
                        title={collapsed ? `${item.label} · ${item.description}` : item.description}
                        type="button"
                      >
                        <span className="nav-item-index" aria-hidden="true">
                          <Icon size={19} weight={active ? 'fill' : 'regular'} />
                        </span>
                        <span className="nav-item-label">{item.label}</span>
                        {stateLabel && <span className="nav-item-capability">{stateLabel}</span>}
                        {isPending && <span className="nav-item-feedback">转跳中...</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {(onToggleCollapsed || activeStore) && (
        <div className="app-sidebar-footer">
          {onToggleCollapsed && (
            <button
              aria-label={collapsed ? '展开主导航' : '收起主导航'}
              className="sidebar-collapse-button"
              onClick={onToggleCollapsed}
              type="button"
            >
              <SidebarSimple aria-hidden="true" size={18} />
              <span>{collapsed ? '展开' : '收起导航'}</span>
            </button>
          )}
          {activeStore && (
            <button
              aria-label={`打开 ${activeStore.displayName} 的店铺与广告对象`}
              className="sidebar-store-card"
              onClick={() => onNavigate(
                VISIBLE_WORKSPACES.find((item) => item.id === 'objects')!.defaultIntent,
              )}
              title={`${activeStore.displayName} · ${activeStore.storeId}`}
              type="button"
            >
              <span className="sidebar-store-icon" aria-hidden="true">
                <Storefront size={17} weight="duotone" />
              </span>
              <span className="sidebar-store-copy">
                <strong>{activeStore.displayName}</strong>
                <small>美国站 · USD · 独立数据域</small>
              </span>
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

export function NextSafeActionHandoff({
  action,
  onNavigate,
}: {
  action: NextSafeAction;
  onNavigate: (intent: NavigationIntent) => void;
}) {
  return (
    <section
      aria-label="下一安全动作"
      className="next-safe-action-handoff"
      data-blocked={action.blocked ? 'true' : 'false'}
      data-workflow-stage={action.stage}
    >
      <div className="next-safe-action-copy">
        <strong>下一安全动作</strong>
        <span>{action.reason}</span>
      </div>
      <button className="primary-button" onClick={() => onNavigate(action.intent)} type="button">
        {action.label}
      </button>
    </section>
  );
}
