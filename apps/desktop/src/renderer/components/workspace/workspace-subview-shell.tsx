import React from 'react';

export type WorkspaceSubviewTab<T extends string> = {
  id: T;
  label: string;
  detail?: string;
  status?: React.ReactNode;
};

export type WorkspaceSubviewShellProps<T extends string> = {
  workspace: string;
  workspaceLabel: string;
  description: React.ReactNode;
  subview: T;
  tabs: readonly WorkspaceSubviewTab<T>[];
  onNavigate: (subview: T) => void;
  children: React.ReactNode;
  ownsPageHeading?: boolean;
  previewNotice?: React.ReactNode;
  className?: string;
};

export function workspaceSubviewIndexFromKey(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % itemCount;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
  return null;
}

function workspaceSubviewId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}

export function WorkspaceSubviewShell<T extends string>({
  workspace,
  workspaceLabel,
  description,
  subview,
  tabs,
  onNavigate,
  children,
  ownsPageHeading = false,
  previewNotice,
  className,
}: WorkspaceSubviewShellProps<T>) {
  const shellId = workspaceSubviewId(workspace);
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === subview));
  const activeTab = tabs[activeIndex] ?? tabs[0];
  const activeTabId = `${shellId}-workspace-tab-${workspaceSubviewId(activeTab?.id ?? subview)}`;
  const panelId = `${shellId}-workspace-panel`;

  return (
    <div
      className={`workspace-subview-shell${className ? ` ${className}` : ''}`}
      data-workspace={workspace}
      data-workspace-evidence-root={true}
      data-workspace-subview={subview}
    >
      <section aria-label={`${workspaceLabel}工作区导航`} className="workspace-subview-shell__navigation">
        <div className="workspace-subview-shell__identity">
          <span>工作区</span>
          {ownsPageHeading
            ? <h1 id={`${shellId}-workspace-title`}>{workspaceLabel}</h1>
            : <strong>{workspaceLabel}</strong>}
          <p>{description}</p>
        </div>
        <div
          aria-label={`${workspaceLabel}子视图`}
          aria-orientation="horizontal"
          className="workspace-subview-shell__tabs"
          role="tablist"
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === subview;
            const tabId = `${shellId}-workspace-tab-${workspaceSubviewId(tab.id)}`;
            return (
              <button
                aria-controls={panelId}
                aria-selected={selected}
                id={tabId}
                key={tab.id}
                onClick={() => onNavigate(tab.id)}
                onKeyDown={(event) => {
                  const nextIndex = workspaceSubviewIndexFromKey(event.key, index, tabs.length);
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const nextTab = tabs[nextIndex];
                  if (!nextTab) return;
                  onNavigate(nextTab.id);
                  if (typeof document !== 'undefined') {
                    document.getElementById(
                      `${shellId}-workspace-tab-${workspaceSubviewId(nextTab.id)}`,
                    )?.focus();
                  }
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span>{tab.label}</span>
                {tab.status && <strong>{tab.status}</strong>}
                {tab.detail && <small>{tab.detail}</small>}
              </button>
            );
          })}
        </div>
      </section>
      {previewNotice && (
        <div className="workspace-subview-shell__preview" data-workspace-preview-notice={true} role="note">
          {previewNotice}
        </div>
      )}
      <div
        aria-labelledby={activeTabId}
        className="workspace-subview-shell__panel"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
