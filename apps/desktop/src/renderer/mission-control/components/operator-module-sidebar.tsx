import React from 'react';
import {
  Brain,
  ClipboardText,
  GearSix,
  Lightbulb,
  Lightning,
  SidebarSimple,
  Stack,
} from '@phosphor-icons/react';
import type { NavigationIntent } from '../../navigation';
import {
  V16_OPERATOR_MODULES as OPERATOR_MODULES,
  v16OperatorEntryCapabilityAttention as operatorEntryCapabilityAttention,
  v16OperatorModuleCapabilityAttention as operatorModuleCapabilityAttention,
  v16OperatorModuleForIntent as operatorModuleForIntent,
} from '../workspaces/v16-module-bridge';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import './operator-module-sidebar.css';

const MODULE_ICONS = {
  'today': ClipboardText,
  'operations-assets': Stack,
  'decision-center': Lightbulb,
  'execution-experiments': Lightning,
  'operating-memory': Brain,
  'system-settings': GearSix,
} as const;

export interface OperatorModuleSidebarProps {
  activeIntent: NavigationIntent;
  capabilities?: readonly MissionControlCapabilityProjection[];
  pendingIntent?: NavigationIntent | null;
  collapsed?: boolean;
  storeScopeControl?: React.ReactNode;
  onToggleCollapsed?: () => void;
  onNavigate: (intent: NavigationIntent) => void;
}

export function OperatorModuleSidebar({
  activeIntent,
  capabilities = [],
  pendingIntent = null,
  collapsed = false,
  storeScopeControl,
  onToggleCollapsed,
  onNavigate,
}: OperatorModuleSidebarProps) {
  const activeModule = operatorModuleForIntent(activeIntent);
  const pendingModule = pendingIntent ? operatorModuleForIntent(pendingIntent) : null;
  const navigationBusy = Boolean(pendingIntent);

  return (
    <nav
      aria-busy={navigationBusy || undefined}
      aria-label="主业务导航"
      className={`app-sidebar operator-module-sidebar${collapsed ? ' app-sidebar-collapsed' : ''}`}
      data-navigation-busy={navigationBusy || undefined}
    >
      <div className="app-sidebar-scroll">
        <div aria-label="运营模块" className="operator-module-list" role="list">
          {OPERATOR_MODULES.map((module) => {
            const active = module.id === activeModule.id;
            const pending = module.id === pendingModule?.id;
            const moduleAttention = operatorModuleCapabilityAttention(capabilities, module);
            const Icon = MODULE_ICONS[module.id];
            return (
              <section
                className="operator-module"
                data-active={active || undefined}
                key={module.id}
                role="listitem"
              >
                <button
                  aria-busy={pending || undefined}
                  aria-describedby={navigationBusy ? 'operator-navigation-pending-reason' : undefined}
                  aria-expanded={!collapsed && active}
                  aria-label={collapsed ? module.label : undefined}
                  className="operator-module-button"
                  data-operator-module={module.id}
                  disabled={navigationBusy}
                  onClick={() => {
                    if (!navigationBusy) onNavigate(module.defaultIntent);
                  }}
                  title={collapsed ? `${module.label} · ${module.description}` : module.description}
                  type="button"
                >
                  <Icon aria-hidden="true" size={19} weight={active ? 'fill' : 'regular'} />
                  <span>{module.label}</span>
                  {moduleAttention && (
                    <b data-attention={moduleAttention}>
                      {moduleAttention === 'blocked' ? '受阻' : '需关注'}
                    </b>
                  )}
                  {pending && <small>转跳中...</small>}
                </button>

                {!collapsed && active && (
                  <div
                    aria-label={`${module.label}二级入口`}
                    className="operator-module-entries"
                    role="list"
                  >
                    {module.entries.map((moduleEntry) => {
                      const entryAttention = operatorEntryCapabilityAttention(capabilities, moduleEntry);
                      const entryActive = moduleEntry.intent.workspace === activeIntent.workspace
                        && moduleEntry.intent.subview === activeIntent.subview;
                      const entryPending = moduleEntry.intent.workspace === pendingIntent?.workspace
                        && moduleEntry.intent.subview === pendingIntent?.subview;
                      return (
                        <div key={moduleEntry.view} role="listitem">
                          <button
                            aria-busy={entryPending || undefined}
                            aria-describedby={navigationBusy ? 'operator-navigation-pending-reason' : undefined}
                            aria-current={entryActive ? 'page' : undefined}
                            className="operator-module-entry"
                            data-operator-entry={moduleEntry.view}
                            disabled={navigationBusy}
                            onClick={() => {
                              if (!navigationBusy) onNavigate(moduleEntry.intent);
                            }}
                            title={moduleEntry.description}
                            type="button"
                          >
                            <span>{moduleEntry.label}</span>
                            {entryAttention && (
                              <b data-attention={entryAttention}>
                                {entryAttention === 'blocked' ? '受阻' : '需关注'}
                              </b>
                            )}
                            {entryPending && <small>转跳中...</small>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {navigationBusy && <p className="muted-line" id="operator-navigation-pending-reason" role="status">
          正在转跳到{pendingModule?.label || '所选入口'}，请等待完成后再选择其他入口。
        </p>}
      </div>

      {(storeScopeControl || onToggleCollapsed) && (
        <div className="app-sidebar-footer">
          {storeScopeControl}
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
        </div>
      )}
    </nav>
  );
}
