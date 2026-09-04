# Shared Renderer UI Components

Framework: React 18 + TypeScript in an Electron/Vite renderer. Component library: custom in-repo primitives. Styling: vanilla CSS class contracts from `apps/desktop/src/renderer/styles.css` and layered files under `apps/desktop/src/renderer/styles/`.

This catalog intentionally focuses on shared primitives and workspace building blocks. App-wide shell/layout files are cataloged separately in `layouts.md`. Every source block below is the complete current file, not a paraphrase.

## Core UI primitives

- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Description: Shared semantic page header, panel, status, form, safety, decision and KPI primitives used throughout the renderer.
- Key props/contracts: `PageHeader`: eyebrow/title/description/primaryTask/nextAction/primaryAction; `Panel`: title/titleAccessory/tone/className; `StatusPill`: tone/focusable/live; `StateLightGrid`: items/refreshing/ariaLabel; `MicroStepper`: items/ariaLabel; `FormTableRow`: label/required/hint/feedback; `SafetyGateLine`: tone/focusable; `DecisionActionStrip`: items/ariaLabel; `KpiCard`: label/value/detail/tone.

```tsx
import React from 'react';
import type { PageHeaderProps } from '../types';

function pageHeaderIdSeed(eyebrow: string, title: string): string {
  let hash = 0;
  for (const char of `${eyebrow}:${title}`) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

function panelIdSeed(title: string, tone: string): string {
  let hash = 0;
  for (const char of `${tone}:${title}`) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function PageHeader({ eyebrow, title, description, primaryTask, nextAction, primaryAction }: PageHeaderProps) {
  const idSeed = pageHeaderIdSeed(eyebrow, title);
  const titleId = `page-header-${idSeed}-title`;
  const descriptionId = `page-header-${idSeed}-description`;

  return (
    <header className="page-header" aria-describedby={descriptionId} aria-labelledby={titleId}>
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 id={titleId}>{title}</h1>
        <p id={descriptionId}>{description}</p>
      </div>
      {(primaryTask || nextAction) && (
        <div className="page-header-rail" role="list" aria-label="首屏主任务和建议下一步">
          {primaryTask && (
            <div className="page-header-rail-card" role="listitem">
              <span>当前主任务</span>
              <strong>{primaryTask}</strong>
            </div>
          )}
          {nextAction && (
            <div className="page-header-rail-card" role="listitem">
              <span>建议下一步</span>
              <strong>{nextAction}</strong>
            </div>
          )}
        </div>
      )}
      {primaryAction && (
        <button
          aria-busy={primaryAction.busy || undefined}
          className={primaryAction.className || 'primary-button'}
          disabled={primaryAction.disabled}
          onClick={primaryAction.onClick}
          type="button"
        >
          {primaryAction.busy && <span aria-hidden="true" className="button-spinner" />}
          <span>{primaryAction.busy ? primaryAction.busyLabel || primaryAction.label : primaryAction.label}</span>
        </button>
      )}
    </header>
  );
}

export function Panel({
  title,
  titleAccessory,
  children,
  tone = 'default',
  className,
}: {
  title?: string;
  titleAccessory?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'warning' | 'blocked' | 'success';
  className?: string;
}) {
  const titleId = title ? `ui-panel-${panelIdSeed(title, tone)}-title` : undefined;

  return (
    <section aria-labelledby={titleId} className={`ui-panel ui-panel-${tone}${className ? ` ${className}` : ''}`}>
      {title && (
        <div className="panel-title-row">
          <h3 id={titleId}>{title}</h3>
          {titleAccessory && <div className="panel-title-accessory">{titleAccessory}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusPill({
  tone,
  children,
  focusable = false,
  live = false,
}: {
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  children: React.ReactNode;
  focusable?: boolean;
  live?: boolean;
}) {
  const semanticProps: React.HTMLAttributes<HTMLSpanElement> = live
    ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': true }
    : { role: 'note', 'aria-roledescription': '状态标签' };

  return (
    <span
      {...semanticProps}
      className={`status-pill status-${tone}`}
      data-status-tone={tone}
      tabIndex={focusable ? 0 : undefined}
    >
      {children}
    </span>
  );
}

export type IndustrialTone = 'ready' | 'pending' | 'blocked' | 'warning';

export interface StateLightItem {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone: IndustrialTone;
}

export function StateLightGrid({
  items,
  refreshing = false,
  ariaLabel = '首屏状态红绿灯',
}: {
  items: StateLightItem[];
  refreshing?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={`state-light-grid${refreshing ? ' state-light-grid-refreshing' : ''}`}
      data-refreshing={refreshing || undefined}
      role="list"
    >
      {items.map((item) => (
        <div className={`state-light-card state-light-${item.tone}`} key={item.label} role="listitem">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.detail && <p>{item.detail}</p>}
        </div>
      ))}
    </div>
  );
}

export interface MicroStepItem {
  label: string;
  meta?: React.ReactNode;
  detail?: React.ReactNode;
  tone: IndustrialTone;
}

export function MicroStepper({ ariaLabel = '流程步骤状态', items }: { ariaLabel?: string; items: MicroStepItem[] }) {
  return (
    <div aria-label={ariaLabel} className="micro-stepper" role="list">
      {items.map((item) => (
        <div className={`micro-step micro-step-${item.tone}`} key={item.label} role="listitem">
          <span className="micro-step-indicator" aria-hidden="true" />
          <span>{item.label}</span>
          {item.meta && <strong>{item.meta}</strong>}
          {item.detail && <p>{item.detail}</p>}
        </div>
      ))}
    </div>
  );
}

export function FormTable({ children }: { children: React.ReactNode }) {
  return <div className="form-table">{children}</div>;
}

export type FormTableFeedbackTone = 'ready' | 'pending' | 'blocked' | 'warning';

export function FormTableRow({
  label,
  required,
  children,
  hint,
  feedback,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: React.ReactNode;
  feedback?: {
    tone: FormTableFeedbackTone;
    children: React.ReactNode;
  };
}) {
  return (
    <label className={`form-table-row${feedback ? ` form-table-row-${feedback.tone}` : ''}`}>
      <span className="form-table-label">
        {label}
        {required && <b aria-label="必填">*</b>}
      </span>
      <span className="form-table-control">
        {children}
        {hint && <small>{hint}</small>}
        <span className="form-table-feedback-slot">
          {feedback ? (
            <small className={`form-table-feedback form-table-feedback-${feedback.tone}`} role="status" aria-live="polite">
              {feedback.children}
            </small>
          ) : (
            <small aria-hidden="true" className="form-table-feedback form-table-feedback-placeholder">
              &nbsp;
            </small>
          )}
        </span>
      </span>
    </label>
  );
}

export function SafetyGateLine({
  children,
  focusable = false,
  tone = 'blocked',
}: {
  children: React.ReactNode;
  focusable?: boolean;
  tone?: IndustrialTone;
}) {
  return (
    <div
      aria-atomic={true}
      aria-live="polite"
      aria-roledescription="安全门状态"
      className={`safety-gate-line safety-gate-${tone}`}
      data-safety-tone={tone}
      role="status"
      tabIndex={focusable ? 0 : undefined}
    >
      {children}
    </div>
  );
}

export interface DecisionActionItem {
  label: string;
  detail?: React.ReactNode;
  tone: IndustrialTone;
  onClick?: () => void;
  disabled?: boolean;
}

export function DecisionActionStrip({
  items,
  ariaLabel = '审批三态决策动作',
}: {
  items: DecisionActionItem[];
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="decision-action-strip"
      data-hover-fade="true"
      role="group"
    >
      {items.map((item) => (
        <button
          className={`decision-action decision-action-${item.tone}`}
          data-decision-action="true"
          disabled={item.disabled}
          key={item.label}
          onClick={item.onClick}
          type="button"
        >
          <strong>{item.label}</strong>
          {item.detail && <span>{item.detail}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── v1.6 低噪音设计系统扩展 ── */

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: 'ready' | 'warning' | 'blocked' | 'pending';
}

export function KpiCard({ label, value, detail, tone }: KpiCardProps) {
  return (
    <div className={`kpi-card${tone ? ` kpi-card--${tone}` : ''}`}>
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value">{value}</span>
      {detail && <p className="kpi-card__detail">{detail}</p>}
    </div>
  );
}
```

## RequirementList

- Source: `apps/desktop/src/renderer/components/status.tsx`
- Description: Ordered requirement/checklist primitive with numbered markers.
- Key props/contracts: `items: string[]`.

```tsx
import React from 'react';

export function RequirementList({ items }: { items: string[] }) {
  return (
    <ol className="requirement-list">
      {items.map((item, index) => (
        <li key={item}>
          <span>{index + 1}</span>
          {item}
        </li>
      ))}
    </ol>
  );
}
```

## TagMetricGroup

- Source: `apps/desktop/src/renderer/components/tag-metric-group.tsx`
- Description: Compact metric-chip group that can act as a filter with active and dimmed states.
- Key props/contracts: `items`, `activeKey`, `ariaLabel`, `dimInactive`, `onSelect`.

```tsx
import React from 'react';

export type TagMetricTone = 'ready' | 'warning' | 'blocked' | 'neutral';

export interface TagMetricItem {
  key?: string;
  label: string;
  value?: string | number;
  detail?: string;
  tone?: TagMetricTone;
  disabled?: boolean;
}

export function TagMetricGroup({
  items,
  activeKey,
  ariaLabel,
  dimInactive = false,
  onSelect,
}: {
  items: TagMetricItem[];
  activeKey?: string;
  ariaLabel?: string;
  dimInactive?: boolean;
  onSelect?: (item: TagMetricItem) => void;
}) {
  return (
    <div aria-label={ariaLabel} className="tag-metric-group">
      {items.map((item) => {
        const metricKey = item.key || '';
        const interactive = Boolean(metricKey && onSelect);
        const className = [
          'tag-metric',
          `tag-metric-${item.tone || 'neutral'}`,
          interactive ? 'tag-metric-action' : '',
          activeKey && metricKey === activeKey ? 'tag-metric-active' : '',
          dimInactive && activeKey && metricKey && metricKey !== activeKey ? 'tag-metric-dimmed' : '',
        ].filter(Boolean).join(' ');
        const content = (
          <>
            <span>{item.label}</span>
            {item.value !== undefined && <strong>{item.value}</strong>}
          </>
        );
        if (interactive) {
          return (
            <button
              aria-pressed={metricKey === activeKey}
              className={className}
              disabled={item.disabled}
              key={`${item.label}-${item.value ?? ''}-${metricKey}`}
              onClick={() => onSelect?.(item)}
              title={item.detail}
              type="button"
            >
              {content}
            </button>
          );
        }
        return (
          <span className={className} key={`${item.label}-${item.value ?? ''}-${metricKey}`} title={item.detail}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
```

## ProgressiveDetails

- Source: `apps/desktop/src/renderer/components/progressive-details.tsx`
- Description: Native disclosure for secondary diagnostic or evidence content.
- Key props/contracts: `title`, `children`, `defaultOpen`.

```tsx
import React from 'react';

export type ProgressiveDetailsProps = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

export function ProgressiveDetails({ title, children, defaultOpen }: ProgressiveDetailsProps) {
  return (
    <details className="progressive-details" open={defaultOpen}>
      <summary className="progressive-details-summary">{title}</summary>
      <div className="progressive-details-body">{children}</div>
    </details>
  );
}
```

## OperatorTaskPanel

- Source: `apps/desktop/src/renderer/components/operator-task-panel.tsx`
- Description: First-screen operator task card with one primary and bounded secondary actions plus group busy locking.
- Key props/contracts: `eyebrow`, `title`, `detail`, `primaryAction`, `secondaryActions`, `children`.

```tsx
import React from 'react';

export type OperatorTaskAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
};

export type OperatorTaskPanelProps = {
  eyebrow?: string;
  title: string;
  detail?: string;
  primaryAction: OperatorTaskAction;
  secondaryActions?: OperatorTaskAction[];
  children?: React.ReactNode;
};

function operatorTaskPanelIdSeed(eyebrow: string | undefined, title: string): string {
  let hash = 0;
  for (const char of `${eyebrow ?? ''}:${title}`) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function OperatorTaskPanel({
  eyebrow,
  title,
  detail,
  primaryAction,
  secondaryActions = [],
  children,
}: OperatorTaskPanelProps) {
  const idSeed = operatorTaskPanelIdSeed(eyebrow, title);
  const titleId = `operator-task-${idSeed}-title`;
  const detailId = detail ? `operator-task-${idSeed}-detail` : undefined;
  const actionBusy = Boolean(primaryAction.busy || secondaryActions.some((action) => action.busy));

  const renderActionContent = (action: OperatorTaskAction) => {
    if (!action.busy) return action.label;
    return (
      <span className="button-content">
        <span aria-hidden="true" className="button-spinner" />
        <span>{action.busyLabel ?? '处理中...'}</span>
      </span>
    );
  };

  const actionClassName = (baseClassName: string, action: OperatorTaskAction) => (
    action.busy ? `${baseClassName} button-loading` : baseClassName
  );

  return (
    <section className="operator-task-panel" aria-describedby={detailId} aria-labelledby={titleId}>
      <div className="operator-task-main">
        {eyebrow && <div className="operator-task-eyebrow">{eyebrow}</div>}
        <h2 id={titleId}>{title}</h2>
        {detail && <p id={detailId}>{detail}</p>}
        {children}
      </div>
      <div className="operator-task-actions" role="group" aria-label="首屏任务动作">
        <button
          aria-busy={primaryAction.busy || undefined}
          className={actionClassName('primary-button', primaryAction)}
          disabled={primaryAction.disabled || actionBusy}
          onClick={primaryAction.onClick}
          type="button"
        >
          {renderActionContent(primaryAction)}
        </button>
        {secondaryActions.map((action, index) => (
          <button
            aria-busy={action.busy || undefined}
            className={actionClassName('secondary-button', action)}
            disabled={action.disabled || actionBusy}
            key={`${action.label}-${index}`}
            onClick={action.onClick}
            type="button"
          >
            {renderActionContent(action)}
          </button>
        ))}
      </div>
    </section>
  );
}
```

## VirtualDataTable

- Source: `apps/desktop/src/renderer/components/virtual-data-table.tsx`
- Description: Accessible virtualized data grid for large queues, sortable columns, row selection and expanded detail.
- Key props/contracts: `rows`, `columns`, `getRowKey`, `emptyMessage`, loading/size/overscan/className, selection, sorting and expanded-content callbacks.

```tsx
import React, { useId, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export type VirtualSortDirection = 'asc' | 'desc';
export type VirtualAriaSort = 'ascending' | 'descending' | 'none';

export interface VirtualDataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  width?: string;
  className?: string;
  sticky?: 'left';
  sortable?: boolean;
  sortLabel?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

export function virtualColumnTemplate<T>(columns: Array<VirtualDataTableColumn<T>>): string {
  return columns.map((column) => column.width || 'minmax(120px, 1fr)').join(' ');
}

export function virtualColumnSortAria(columnKey: string, sortKey?: string, sortDirection: VirtualSortDirection = 'desc'): VirtualAriaSort {
  if (columnKey !== sortKey) return 'none';
  return sortDirection === 'asc' ? 'ascending' : 'descending';
}

export function virtualSortHeaderClass({ sortable, active }: { sortable: boolean; active: boolean }): string {
  return [
    sortable ? 'virtual-table-sortable' : '',
    active ? 'virtual-table-sort-active' : '',
  ].filter(Boolean).join(' ');
}

export function virtualColumnStickyClass<T>(column: VirtualDataTableColumn<T>): string {
  return column.sticky === 'left' ? 'virtual-table-cell-sticky-left' : '';
}

export function virtualRowParityClass(index: number): string {
  return index % 2 === 0 ? 'virtual-table-row-even' : 'virtual-table-row-odd';
}

const VIRTUAL_ROW_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[data-row-interaction]',
].join(',');

export function virtualRowSelectionAllowed(target: unknown, currentTarget: unknown): boolean {
  if (target === currentTarget) return true;
  const candidate = target as { closest?: (selector: string) => unknown } | null | undefined;
  if (typeof candidate?.closest !== 'function') return true;
  return !candidate.closest(VIRTUAL_ROW_INTERACTIVE_SELECTOR);
}

export function virtualTableStatusText({ loading, rowCount, columnCount }: { loading: boolean; rowCount: number; columnCount: number }): string {
  if (loading && rowCount > 0) return `表格正在加载，当前暂存 ${rowCount} 行 / ${columnCount} 列。`;
  if (loading) return `表格正在加载，保留 ${columnCount} 列结构。`;
  if (rowCount > 0) return `当前展示 ${rowCount} 行 / ${columnCount} 列。`;
  return `当前没有可展示的表格行，表头保留 ${columnCount} 列。`;
}

export interface VirtualDataTableProps<T> {
  rows: T[];
  columns: Array<VirtualDataTableColumn<T>>;
  getRowKey: (row: T, index: number) => React.Key;
  emptyMessage: React.ReactNode;
  loading?: boolean;
  minWidth?: string;
  estimateSize?: number;
  overscan?: number;
  className?: string;
  rowClassName?: (row: T, index: number) => string | undefined;
  expandedContent?: (row: T, index: number) => React.ReactNode;
  selectedRowKey?: React.Key | null;
  onRowSelect?: (row: T, index: number) => void;
  rowAriaLabel?: (row: T, index: number) => string;
  sortKey?: string;
  sortDirection?: VirtualSortDirection;
  onSortChange?: (key: string) => void;
}

export function VirtualDataTable<T>({
  rows,
  columns,
  getRowKey,
  emptyMessage,
  loading = false,
  minWidth = '960px',
  estimateSize = 54,
  overscan = 10,
  className = '',
  rowClassName,
  expandedContent,
  selectedRowKey = null,
  onRowSelect,
  rowAriaLabel,
  sortKey,
  sortDirection = 'desc',
  onSortChange,
}: VirtualDataTableProps<T>) {
  const statusId = useId();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const gridTemplateColumns = useMemo(() => virtualColumnTemplate(columns), [columns]);
  const statusText = virtualTableStatusText({ loading, rowCount: rows.length, columnCount: columns.length });
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => getRowKey(rows[index], index),
    measureElement: (element) => element?.getBoundingClientRect().height ?? estimateSize,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      aria-busy={loading}
      className={`virtual-table-wrap ${loading ? 'virtual-table-loading' : ''} ${className}`.trim()}
      data-scroll-owner="virtual-table"
      data-workspace-queue-scroll={true}
      ref={parentRef}
    >
      <div className="virtual-table-status" id={statusId} role="status" aria-live="polite" aria-atomic="true">
        {statusText}
      </div>
      {loading && (
        <div aria-label="表格正在加载" className="virtual-table-skeleton">
          <span />
          <span />
          <span />
        </div>
      )}
      <div aria-colcount={columns.length} aria-describedby={statusId} aria-rowcount={rows.length} className="virtual-table" role="table" style={{ minWidth }}>
        <div className="virtual-table-head" data-workspace-queue-header={true} role="rowgroup">
          <div className="virtual-table-row virtual-table-header-row" role="row" style={{ gridTemplateColumns }}>
            {columns.map((column) => {
              const active = column.key === sortKey;
              const sortable = Boolean(column.sortable);
              const sortClass = virtualSortHeaderClass({ sortable, active });
              const stickyClass = virtualColumnStickyClass(column);
              return (
                <div
                  aria-sort={sortable ? virtualColumnSortAria(column.key, sortKey, sortDirection) : undefined}
                  className={`virtual-table-cell virtual-table-header-cell ${sortClass} ${stickyClass} ${column.className || ''}`.trim()}
                  data-sort-direction={active ? sortDirection : undefined}
                  key={column.key}
                  role="columnheader"
                >
                  {sortable ? (
                    <button
                      aria-label={`${column.sortLabel || String(column.header)} 排序`}
                      className="virtual-table-sort-button"
                      disabled={!onSortChange}
                      onClick={() => onSortChange?.(column.key)}
                      type="button"
                    >
                      <span>{column.header}</span>
                      <span aria-hidden="true" className="virtual-table-sort-arrow">↓</span>
                    </button>
                  ) : column.header}
                </div>
              );
            })}
          </div>
        </div>
        {rows.length ? (
          <div className="virtual-table-body" role="rowgroup" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const key = getRowKey(row, virtualRow.index);
              const detail = expandedContent?.(row, virtualRow.index);
              const rowSelectable = Boolean(onRowSelect);
              const rowSelected = selectedRowKey !== null && selectedRowKey === key;
              return (
                <div
                  className="virtual-table-item"
                  data-index={virtualRow.index}
                  key={key}
                  ref={rowVirtualizer.measureElement}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div
                    aria-label={rowAriaLabel?.(row, virtualRow.index)}
                    aria-selected={rowSelectable ? rowSelected : undefined}
                    className={`virtual-table-row virtual-table-body-row ${virtualRowParityClass(virtualRow.index)} ${rowSelectable ? 'virtual-table-row-selectable' : ''} ${rowSelected ? 'virtual-table-row-selected' : ''} ${rowClassName?.(row, virtualRow.index) || ''}`.trim()}
                    data-row-index={virtualRow.index}
                    data-row-key={String(key)}
                    data-workspace-row={true}
                    onClick={rowSelectable ? (event) => {
                      if (!virtualRowSelectionAllowed(event.target, event.currentTarget)) return;
                      onRowSelect?.(row, virtualRow.index);
                    } : undefined}
                    onKeyDown={rowSelectable ? (event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onRowSelect?.(row, virtualRow.index);
                    } : undefined}
                    role="row"
                    style={{ gridTemplateColumns }}
                    tabIndex={rowSelectable ? 0 : undefined}
                  >
                    {columns.map((column) => {
                      const stickyClass = virtualColumnStickyClass(column);
                      return (
                        <div className={`virtual-table-cell ${stickyClass} ${column.className || ''}`.trim()} key={column.key} role="cell">
                          {column.cell(row, virtualRow.index)}
                        </div>
                      );
                    })}
                  </div>
                  {detail && <div className="virtual-table-detail">{detail}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="virtual-table-empty" role="rowgroup">
            <div role="row">
              <div role="cell">{emptyMessage}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Workspace shared types

- Source: `apps/desktop/src/renderer/components/workspace/types.ts`
- Description: Shared tone and action contracts consumed by workspace primitives.
- Key props/contracts: `WorkspaceTone`, `WorkspaceAction`, `WorkspaceContent`.

```ts
import type React from 'react';

export type WorkspaceTone = 'neutral' | 'attention' | 'blocked' | 'confirmed';

export type WorkspaceAction = {
  actionId?: string;
  label: string;
  onClick: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  busyLabel?: string;
};

export type WorkspaceContent = React.ReactNode;
```

## ActionMenu

- Source: `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
- Description: Keyboard-accessible overflow action menu with disabled and danger states.
- Key props/contracts: `label`, `items`, `align`, `disabled`, `onOpenChange`.

```tsx
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

export type ActionMenuItem = {
  id: string;
  label: string;
  description?: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
};

export type ActionMenuProps = {
  label: string;
  items: ActionMenuItem[];
  align?: 'start' | 'end';
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type ActionMenuKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'Escape' | string;

function firstEnabledIndex(enabled: boolean[]): number {
  return enabled.findIndex(Boolean);
}

function lastEnabledIndex(enabled: boolean[]): number {
  for (let index = enabled.length - 1; index >= 0; index -= 1) {
    if (enabled[index]) return index;
  }
  return -1;
}

export function actionMenuKeyboardTarget(
  key: ActionMenuKey,
  currentIndex: number,
  enabled: boolean[],
): number | null {
  if (key === 'Escape') return null;
  const first = firstEnabledIndex(enabled);
  if (first < 0) return -1;
  if (key === 'Home') return first;
  if (key === 'End') return lastEnabledIndex(enabled);
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return currentIndex;

  const direction = key === 'ArrowDown' ? 1 : -1;
  let candidate = currentIndex;
  for (let checked = 0; checked < enabled.length; checked += 1) {
    candidate = (candidate + direction + enabled.length) % enabled.length;
    if (enabled[candidate]) return candidate;
  }
  return first;
}

export function restoreActionMenuFocus(trigger: Pick<HTMLButtonElement, 'focus'> | null): void {
  trigger?.focus();
}

export function ActionMenu({
  label,
  items,
  align = 'end',
  disabled = false,
  onOpenChange,
}: ActionMenuProps) {
  const id = useId().replace(/:/g, '');
  const triggerId = `action-menu-${id}-trigger`;
  const menuId = `action-menu-${id}-menu`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const enabled = items.map((item) => !item.disabled);

  const setOpenState = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpenState(false);
    setActiveIndex(-1);
    if (restoreFocus) restoreActionMenuFocus(triggerRef.current);
  }, [setOpenState]);

  const openMenu = useCallback((placement: 'first' | 'last' = 'first') => {
    const nextIndex = placement === 'last' ? lastEnabledIndex(enabled) : firstEnabledIndex(enabled);
    setActiveIndex(nextIndex);
    setOpenState(true);
  }, [enabled, setOpenState]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMenu, open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }
    const target = actionMenuKeyboardTarget(event.key, index, enabled);
    if (target === null) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (target !== index) {
      event.preventDefault();
      setActiveIndex(target);
    }
  };

  return (
    <div
      className="action-menu"
      data-menu-align={align}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu(false);
      }}
      ref={containerRef}
    >
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        className="action-menu__trigger"
        disabled={disabled || items.length === 0}
        id={triggerId}
        onClick={() => (open ? closeMenu(false) : openMenu('first'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu('last');
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="action-menu__chevron">⋯</span>
      </button>
      {open && (
        <div
          aria-label={label}
          aria-labelledby={triggerId}
          className="action-menu__popover"
          id={menuId}
          role="menu"
        >
          {items.map((item, index) => (
            <button
              aria-disabled={item.disabled || undefined}
              className={`action-menu__item action-menu__item--${item.tone ?? 'default'}`}
              disabled={item.disabled}
              key={item.id}
              onClick={() => {
                if (item.disabled) return;
                closeMenu(true);
                item.onSelect();
              }}
              onKeyDown={(event) => handleMenuKeyDown(event, index)}
              onMouseEnter={() => {
                if (!item.disabled) setActiveIndex(index);
              }}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              role="menuitem"
              tabIndex={activeIndex === index ? 0 : -1}
              type="button"
            >
              <span>{item.label}</span>
              {item.description && <small>{item.description}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

## PriorityDataTable

- Source: `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
- Description: Desktop operational table that declares anchor/primary/supporting/action column priority.
- Key props/contracts: `caption`, `rows`, `columns`, `getRowKey`, empty/selection/ARIA/class callbacks.

```tsx
import React from 'react';

export type PriorityDataTableColumnPriority = 'anchor' | 'primary' | 'supporting' | 'action';

export type PriorityDataTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  priority: PriorityDataTableColumnPriority;
  width?: string;
  align?: 'start' | 'left' | 'center' | 'end' | 'right';
  className?: string;
};

export type PriorityDataTableProps<T> = {
  caption: string;
  rows: T[];
  columns: Array<PriorityDataTableColumn<T>>;
  getRowKey: (row: T, index: number) => React.Key;
  emptyState?: React.ReactNode;
  selectedRowKey?: React.Key | null;
  onRowSelect?: (row: T, index: number) => void;
  rowAriaLabel?: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
  className?: string;
};

function tableCellClass<T>(column: PriorityDataTableColumn<T>): string {
  const alignment = column.align === 'left'
    ? 'start'
    : column.align === 'right'
      ? 'end'
      : column.align;
  return [
    'priority-table__cell',
    `priority-table__cell--${column.priority}`,
    alignment ? `priority-table__cell--${alignment}` : '',
    column.className ?? '',
  ].filter(Boolean).join(' ');
}

export function PriorityDataTable<T>({
  caption,
  rows,
  columns,
  getRowKey,
  emptyState = '当前没有可展示的对象',
  selectedRowKey = null,
  onRowSelect,
  rowAriaLabel,
  rowClassName,
  className,
}: PriorityDataTableProps<T>) {
  const selectable = Boolean(onRowSelect);

  return (
    <div className={`priority-table-scroll${className ? ` ${className}` : ''}`} data-scroll-exception="horizontal-only">
      <table className="priority-table">
        <caption className="priority-table__caption">{caption}</caption>
        <colgroup>
          {columns.map((column) => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={tableCellClass(column)}
                data-column-priority={column.priority}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => {
            const rowKey = getRowKey(row, index);
            const selected = selectedRowKey !== null && rowKey === selectedRowKey;
            const customRowClassName = rowClassName?.(row, index);
            return (
              <tr
                aria-label={rowAriaLabel?.(row, index)}
                aria-selected={selectable ? selected : undefined}
                className={`${selectable ? 'priority-table__row--selectable' : ''}${selected ? ' priority-table__row--selected' : ''}${customRowClassName ? ` ${customRowClassName}` : ''}`.trim() || undefined}
                key={rowKey}
                onClick={selectable ? (event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest?.('button, a, input, select, textarea, [role="button"], [role="menuitem"]')) return;
                  onRowSelect?.(row, index);
                } : undefined}
                onKeyDown={selectable ? (event) => {
                  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  onRowSelect?.(row, index);
                } : undefined}
                tabIndex={selectable ? 0 : undefined}
              >
                {columns.map((column) => (
                  <td
                    className={tableCellClass(column)}
                    data-column-priority={column.priority}
                    key={column.key}
                  >
                    {column.cell(row, index)}
                  </td>
                ))}
              </tr>
            );
          }) : (
            <tr>
              <td className="priority-table__empty" colSpan={columns.length}>{emptyState}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

## SummaryStrip

- Source: `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
- Description: Four-item maximum definition-list summary strip for current work status.
- Key props/contracts: `items`, `ariaLabel`.

```tsx
import React from 'react';
import type { WorkspaceTone } from './types';

export type SummaryStripItem = {
  id: string;
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: WorkspaceTone;
};

export type SummaryStripProps = {
  items: SummaryStripItem[];
  ariaLabel?: string;
};

export function SummaryStrip({ items, ariaLabel = '当前工作摘要' }: SummaryStripProps) {
  return (
    <dl aria-label={ariaLabel} className="summary-strip">
      {items.slice(0, 4).map((item) => (
        <div
          className="summary-strip__item"
          data-summary-item="true"
          data-tone={item.tone ?? 'neutral'}
          key={item.id}
        >
          <dt>{item.label}</dt>
          <dd>
            <strong>{item.value}</strong>
            {item.detail && <small>{item.detail}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
```

## TaskBanner

- Source: `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
- Description: Mission/task-first banner with tone, status, progress copy and bounded action group.
- Key props/contracts: `compact`, `eyebrow`, `title`, `description`, `tone`, `status`, `primaryAction`, `secondaryActions`, `meta`, `children`.

```tsx
import React from 'react';
import type { WorkspaceAction, WorkspaceTone } from './types';

export type TaskBannerProps = {
  compact?: boolean;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  tone?: WorkspaceTone;
  status?: React.ReactNode;
  primaryAction?: WorkspaceAction;
  secondaryActions?: WorkspaceAction[];
  meta?: React.ReactNode;
  children?: React.ReactNode;
};

function taskBannerIdSeed(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

function actionReasonId(seed: string, priority: 'primary' | 'secondary', index: number): string {
  return `task-banner-${seed}-${priority}-${index}-reason`;
}

function renderActionButton({
  action,
  priority,
  index,
  groupBusy,
  seed,
}: {
  action: WorkspaceAction;
  priority: 'primary' | 'secondary';
  index: number;
  groupBusy: boolean;
  seed: string;
}) {
  const disabled = Boolean(action.disabled || groupBusy);
  const reasonId = action.disabledReason ? actionReasonId(seed, priority, index) : undefined;

  return (
    <div className="task-banner__action-shell">
      <button
        aria-busy={action.busy || undefined}
        aria-describedby={reasonId}
        aria-label={action.ariaLabel}
        className={`workspace-button workspace-button--${priority}${action.busy ? ' workspace-button--busy' : ''}`}
        data-action-id={action.actionId}
        data-action-priority={priority}
        disabled={disabled}
        onClick={action.onClick}
        type="button"
      >
        {action.busy && <span aria-hidden="true" className="workspace-spinner" />}
        <span>{action.busy ? action.busyLabel ?? '处理中...' : action.label}</span>
      </button>
      {action.disabledReason && (
        <span className="task-banner__disabled-reason" id={reasonId}>{action.disabledReason}</span>
      )}
    </div>
  );
}

export function TaskBanner({
  compact = false,
  eyebrow = '当前主任务',
  title,
  description,
  tone = 'neutral',
  status,
  primaryAction,
  secondaryActions = [],
  meta,
  children,
}: TaskBannerProps) {
  const seed = taskBannerIdSeed(`${eyebrow}:${title}`);
  const titleId = `task-banner-${seed}-title`;
  const descriptionId = description ? `task-banner-${seed}-description` : undefined;
  const visibleSecondaryActions = secondaryActions.slice(0, 2);
  const groupBusy = Boolean(primaryAction?.busy || visibleSecondaryActions.some((action) => action.busy));
  const hasActions = Boolean(primaryAction || visibleSecondaryActions.length > 0);

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`task-banner task-banner--${tone}${compact ? ' task-banner--compact' : ''}`}
      data-task-density={compact ? 'compact' : 'standard'}
      data-task-tone={tone}
    >
      <div className="task-banner__copy">
        <div className="task-banner__eyebrow">{eyebrow}</div>
        <div className="task-banner__title-line">
          <h2 id={titleId}>{title}</h2>
          {status && <span className="task-banner__status" role="status" aria-live="polite">{status}</span>}
        </div>
        {description && <div className="task-banner__description" id={descriptionId}>{description}</div>}
        {children}
        {meta && <div className="task-banner__meta">{meta}</div>}
      </div>
      {hasActions && (
        <div aria-label="首屏任务动作" className="task-banner__actions" role="group">
          {primaryAction && renderActionButton({ action: primaryAction, groupBusy, index: 0, priority: 'primary', seed })}
          {visibleSecondaryActions.map((action, index) => (
            <React.Fragment key={`${action.label}-${index}`}>
              {renderActionButton({
                action,
                groupBusy,
                index,
                priority: 'secondary',
                seed,
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
```

## WorkbenchPanel

- Source: `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
- Description: Named operational workbench panel with heading, status, toolbar, body and footer slots.
- Key props/contracts: `title`, `description`, `toolbar`, `status`, `children`, `footer`, `className`.

```tsx
import React from 'react';

export type WorkbenchPanelProps = {
  title: string;
  description?: React.ReactNode;
  toolbar?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

function workbenchIdSeed(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function WorkbenchPanel({
  title,
  description,
  toolbar,
  status,
  children,
  footer,
  className,
}: WorkbenchPanelProps) {
  const seed = workbenchIdSeed(title);
  const titleId = `workbench-${seed}-title`;
  const descriptionId = description ? `workbench-${seed}-description` : undefined;

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`workbench-panel${className ? ` ${className}` : ''}`}
    >
      <header className="workbench-panel__header">
        <div className="workbench-panel__heading">
          <div className="workbench-panel__title-line">
            <h2 id={titleId}>{title}</h2>
            {status && <span className="workbench-panel__status" role="status" aria-live="polite">{status}</span>}
          </div>
          {description && <div className="workbench-panel__description" id={descriptionId}>{description}</div>}
        </div>
        {toolbar && <div aria-label={`${title}工具栏`} className="workbench-panel__toolbar" role="toolbar">{toolbar}</div>}
      </header>
      <div className="workbench-panel__body">{children}</div>
      {footer && <footer className="workbench-panel__footer">{footer}</footer>}
    </section>
  );
}
```

## WorkspaceState

- Source: `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
- Description: Reusable loading, empty, blocked, error, busy and disabled state surface.
- Key props/contracts: `kind`, `title`, `description`, `action`, `progress`, `details`.

```tsx
import React from 'react';
import type { WorkspaceAction } from './types';

export type WorkspaceStateKind = 'loading' | 'empty' | 'blocked' | 'error' | 'busy' | 'disabled';

export type WorkspaceProgress = {
  value: number;
  max: number;
  label: string;
};

export type WorkspaceStateProps = {
  kind: WorkspaceStateKind;
  title?: string;
  description: React.ReactNode;
  action?: WorkspaceAction;
  progress?: WorkspaceProgress;
  details?: React.ReactNode;
};

const defaultTitles: Record<WorkspaceStateKind, string> = {
  loading: '正在载入',
  empty: '暂无内容',
  blocked: '当前被阻塞',
  error: '加载失败',
  busy: '正在处理',
  disabled: '当前不可用',
};

export function WorkspaceState({
  kind,
  title = defaultTitles[kind],
  description,
  action,
  progress,
  details,
}: WorkspaceStateProps) {
  const live = kind === 'loading' || kind === 'busy';
  const role = kind === 'error' ? 'alert' : 'status';

  return (
    <div
      aria-busy={live || undefined}
      aria-live={role === 'status' ? 'polite' : undefined}
      className={`workspace-state workspace-state--${kind}`}
      data-workspace-state={kind}
      role={role}
    >
      <span aria-hidden="true" className="workspace-state__indicator">
        {live && <span className="workspace-spinner" />}
      </span>
      <div className="workspace-state__copy">
        <strong>{title}</strong>
        <div className="workspace-state__description">{description}</div>
        {progress && (
          <div className="workspace-state__progress">
            <progress aria-label={progress.label} max={progress.max} value={progress.value} />
            <span>{progress.label}</span>
          </div>
        )}
        {details && <div className="workspace-state__details">{details}</div>}
      </div>
      {action && (
        <button
          aria-busy={action.busy || undefined}
          aria-label={action.ariaLabel}
          className={`workspace-state__action${action.busy ? ' workspace-button--busy' : ''}`}
          disabled={action.disabled || action.busy}
          onClick={action.onClick}
          title={action.disabledReason}
          type="button"
        >
          {action.busy && <span aria-hidden="true" className="workspace-spinner" />}
          <span>{action.busy ? action.busyLabel ?? '处理中...' : action.label}</span>
        </button>
      )}
    </div>
  );
}
```

## PageFrame

- Source: `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
- Description: Task-first page frame with stable page heading, description, task, summary and content regions.
- Key props/contracts: `title`, `description`, `task`, `summary`, `children`, `className`, `pageId`.

```tsx
import React from 'react';

export type PageFrameProps = {
  title: string;
  description?: React.ReactNode;
  task?: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pageId?: string;
};

function pageFrameIdSeed(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function PageFrame({
  title,
  description,
  task,
  summary,
  children,
  className,
  pageId,
}: PageFrameProps) {
  const idSeed = pageId ?? pageFrameIdSeed(title);
  const titleId = `workspace-page-${idSeed}-title`;
  const descriptionId = description ? `workspace-page-${idSeed}-description` : undefined;

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`workspace-page-frame${className ? ` ${className}` : ''}`}
      data-workspace-page={pageId || undefined}
    >
      <header className="workspace-page-frame__header">
        <h1 id={titleId}>{title}</h1>
        {description && <div className="workspace-page-frame__description" id={descriptionId}>{description}</div>}
      </header>
      {task && <div className="workspace-page-frame__task">{task}</div>}
      {summary && <div className="workspace-page-frame__summary">{summary}</div>}
      <div className="workspace-page-frame__content">{children}</div>
    </section>
  );
}
```

## WorkspaceSubviewShell

- Source: `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
- Description: Workspace identity and keyboard-operable tab shell for related subviews.
- Key props/contracts: `workspace`, `workspaceLabel`, `description`, `subview`, `tabs`, `onNavigate`, `ownsPageHeading`, `previewNotice`, `className`, `children`.

```tsx
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
```

## ResponsiveInspector

- Source: `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
- Description: Object inspector that is inline at 1400px+ and a focus-trapped drawer below 1400px.
- Key props/contracts: `open`, `title`, `description`, `dismissDisabled`, `busy`, `onClose`, `resolveFocusReturnTarget`, `children`.

```tsx
import React, { useEffect, useId, useRef, useState } from 'react';
import {
  captureOverlayFocusTarget,
  handleOverlayEscape,
  isTopOverlayKeyboardLayer,
  makeOverlayBackgroundInert,
  overlayDismissLocked,
  registerOverlayKeyboardLayer,
  resolveOverlayFocusReturnTarget,
  restoreOverlayFocus,
  scheduleOverlayFocusRestore,
  trapOverlayTab,
  type OverlayFocusSurface,
  type OverlayFocusTarget,
  type OverlayInertRoot,
} from './overlay-focus-scope';

export const RESPONSIVE_INSPECTOR_MEDIA_QUERY = '(max-width: 1399px)';

export type ResponsiveInspectorMode = 'inline' | 'drawer';

export type ResponsiveInspectorViewport = {
  innerWidth?: number;
  matchMedia?: (query: string) => { matches: boolean };
};

export type ResponsiveInspectorFocusTarget = OverlayFocusTarget;

export type ResponsiveInspectorProps = {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  dismissDisabled?: boolean;
  busy?: boolean;
  onClose: () => void;
  resolveFocusReturnTarget?: (
    trigger: ResponsiveInspectorFocusTarget | null,
  ) => ResponsiveInspectorFocusTarget | null;
  children: React.ReactNode;
};

type ResponsiveInspectorFocusScope = OverlayFocusSurface;
type ResponsiveInspectorInertRoot = OverlayInertRoot;

export function resolveResponsiveInspectorMode(
  viewport: ResponsiveInspectorViewport | undefined,
): ResponsiveInspectorMode {
  if (!viewport) return 'inline';

  if (typeof viewport.matchMedia === 'function') {
    try {
      return viewport.matchMedia(RESPONSIVE_INSPECTOR_MEDIA_QUERY).matches ? 'drawer' : 'inline';
    } catch {
      // Fall through to the width check for incomplete browser shims.
    }
  }

  if (typeof viewport.innerWidth === 'number') {
    return viewport.innerWidth < 1400 ? 'drawer' : 'inline';
  }

  return 'inline';
}

export function captureResponsiveInspectorTrigger(
  activeElement: unknown,
): ResponsiveInspectorFocusTarget | null {
  return captureOverlayFocusTarget(activeElement);
}

export function restoreResponsiveInspectorFocus(
  trigger: ResponsiveInspectorFocusTarget | null,
): void {
  restoreOverlayFocus(trigger);
}

export function scheduleResponsiveInspectorFocusRestore(
  trigger: ResponsiveInspectorFocusTarget | null,
  schedule: (callback: () => void) => void,
): void {
  scheduleOverlayFocusRestore(trigger, schedule);
}

export function resolveResponsiveInspectorFocusReturnTarget(
  trigger: ResponsiveInspectorFocusTarget | null,
  resolver?: (
    trigger: ResponsiveInspectorFocusTarget | null,
  ) => ResponsiveInspectorFocusTarget | null,
): ResponsiveInspectorFocusTarget | null {
  return resolveOverlayFocusReturnTarget(trigger, resolver);
}

export function focusResponsiveInspectorEntry(
  mode: ResponsiveInspectorMode,
  closeButton: ResponsiveInspectorFocusTarget | null,
  surface: ResponsiveInspectorFocusTarget | null,
): void {
  if (mode !== 'drawer') return;
  (closeButton ?? surface)?.focus();
}

export function responsiveInspectorDismissLocked(
  dismissDisabled = false,
  busy = false,
): boolean {
  return overlayDismissLocked(dismissDisabled, busy);
}

export function handleResponsiveInspectorEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  onClose: () => void,
  dismissLocked = false,
): boolean {
  return handleOverlayEscape(event, onClose, dismissLocked);
}

export function trapResponsiveInspectorTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  surface: ResponsiveInspectorFocusScope | null,
  activeElement: unknown,
): boolean {
  return trapOverlayTab(event, surface, activeElement);
}

export function makeResponsiveInspectorBackgroundInert(
  root: ResponsiveInspectorInertRoot | null,
): () => void {
  return makeOverlayBackgroundInert(root);
}

function currentViewport(): ResponsiveInspectorViewport | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function useResponsiveInspectorMode(): ResponsiveInspectorMode {
  const [mode, setMode] = useState<ResponsiveInspectorMode>(() => (
    resolveResponsiveInspectorMode(currentViewport())
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateMode = () => setMode(resolveResponsiveInspectorMode(window));
    if (typeof window.matchMedia === 'function') {
      let mediaQuery: MediaQueryList;
      try {
        mediaQuery = window.matchMedia(RESPONSIVE_INSPECTOR_MEDIA_QUERY);
      } catch {
        window.addEventListener('resize', updateMode);
        return () => window.removeEventListener('resize', updateMode);
      }

      const handleChange = () => updateMode();
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      }

      mediaQuery.addListener?.(handleChange);
      return () => mediaQuery.removeListener?.(handleChange);
    }

    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  return mode;
}

export function ResponsiveInspector({
  open,
  title,
  description,
  dismissDisabled = false,
  busy = false,
  onClose,
  resolveFocusReturnTarget,
  children,
}: ResponsiveInspectorProps) {
  const id = useId().replace(/:/g, '');
  const titleId = `responsive-inspector-${id}-title`;
  const descriptionId = description ? `responsive-inspector-${id}-description` : undefined;
  const mode = useResponsiveInspectorMode();
  const surfaceRef = useRef<HTMLElement | null>(null);
  const drawerRootRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<ResponsiveInspectorFocusTarget | null>(null);
  const keyboardLayerRef = useRef(Symbol('responsive-inspector-keyboard-layer'));
  const focusReturnResolverRef = useRef(resolveFocusReturnTarget);
  const dismissLockedRef = useRef(false);
  const modeRef = useRef(mode);
  const onCloseRef = useRef(onClose);
  focusReturnResolverRef.current = resolveFocusReturnTarget;
  const dismissLocked = responsiveInspectorDismissLocked(dismissDisabled, busy);
  dismissLockedRef.current = dismissLocked;
  modeRef.current = mode;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    triggerRef.current = captureResponsiveInspectorTrigger(document.activeElement);

    return () => {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      const returnTarget = resolveResponsiveInspectorFocusReturnTarget(
        trigger,
        focusReturnResolverRef.current,
      );
      scheduleResponsiveInspectorFocusRestore(returnTarget, (callback) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(callback);
          return;
        }
        queueMicrotask(callback);
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    focusResponsiveInspectorEntry(
      mode,
      dismissLocked ? null : closeButtonRef.current,
      surfaceRef.current,
    );
  }, [dismissLocked, mode, open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const keyboardLayer = keyboardLayerRef.current;
    const unregisterKeyboardLayer = registerOverlayKeyboardLayer(keyboardLayer);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayKeyboardLayer(keyboardLayer)) return;
      if (modeRef.current === 'drawer' && trapResponsiveInspectorTab(
        event,
        surfaceRef.current,
        document.activeElement,
      )) {
        return;
      }
      handleResponsiveInspectorEscape(event, () => onCloseRef.current(), dismissLockedRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unregisterKeyboardLayer();
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'drawer') return undefined;
    return makeResponsiveInspectorBackgroundInert(drawerRootRef.current);
  }, [mode, open]);

  if (!open) return null;

  const content = (
    <>
      <header className="responsive-inspector__header">
        <div className="responsive-inspector__heading">
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p className="responsive-inspector__description" id={descriptionId}>{description}</p>
          )}
        </div>
        <button
          aria-disabled={dismissLocked || undefined}
          aria-label="关闭详情检查器"
          className="responsive-inspector__close"
          disabled={dismissLocked}
          onClick={dismissLocked ? undefined : onClose}
          ref={closeButtonRef}
          type="button"
        >
          关闭
        </button>
      </header>
      <div className="responsive-inspector__body">{children}</div>
    </>
  );

  if (mode === 'drawer') {
    return (
      <div
        className="responsive-inspector__backdrop"
        data-inspector-mode="drawer"
        ref={drawerRootRef}
      >
        <section
          aria-busy={busy || undefined}
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          aria-modal="true"
          className="responsive-inspector responsive-inspector--drawer"
          data-dismiss-locked={dismissLocked ? 'true' : undefined}
          data-inspector-mode="drawer"
          ref={surfaceRef}
          role="dialog"
          tabIndex={-1}
        >
          {content}
        </section>
      </div>
    );
  }

  return (
    <aside
      aria-busy={busy || undefined}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="responsive-inspector responsive-inspector--inline"
      data-dismiss-locked={dismissLocked ? 'true' : undefined}
      data-inspector-mode="inline"
      ref={surfaceRef}
      role="complementary"
      tabIndex={-1}
    >
      {content}
    </aside>
  );
}
```

## Overlay focus-scope utilities

- Source: `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
- Description: Shared accessibility utilities and hook used by modal/drawer overlays for focus trap, focus restoration, Escape and inert background.
- Key props/contracts: `useOverlayFocusScope` options include open/dismissDisabled/modal and independently configurable focus policies.

```ts
import { useEffect, useRef } from 'react';

export const OVERLAY_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'summary',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export type OverlayFocusTarget = {
  focus: () => void;
  getClientRects?: () => ArrayLike<unknown>;
  hidden?: boolean;
  isConnected?: boolean;
  matches?: (selector: string) => boolean;
};

export type OverlayFocusSurface = OverlayFocusTarget & {
  querySelector?: (selector: string) => unknown;
  querySelectorAll?: (selector: string) => ArrayLike<unknown>;
};

export type OverlayInertTarget = {
  inert: boolean;
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

type OverlayInertParent = {
  children: ArrayLike<unknown>;
  parentElement?: OverlayInertParent | null;
};

export type OverlayInertRoot = OverlayInertTarget & {
  parentElement?: OverlayInertParent | null;
};

export type OverlayFocusPolicyInput = {
  modal: boolean;
  autoFocus?: boolean;
  dismissOnEscape?: boolean;
  inertBackground?: boolean;
  restoreFocus?: boolean;
  trapFocus?: boolean;
};

export type OverlayFocusPolicy = {
  autoFocus: boolean;
  dismissOnEscape: boolean;
  inertBackground: boolean;
  restoreFocus: boolean;
  trapFocus: boolean;
};

export type UseOverlayFocusScopeOptions = {
  open: boolean;
  onDismiss: () => void;
  dismissDisabled?: boolean;
  modal?: boolean;
  autoFocus?: boolean;
  dismissOnEscape?: boolean;
  inertBackground?: boolean;
  restoreFocus?: boolean;
  trapFocus?: boolean;
  resolveFocusReturnTarget?: (
    trigger: OverlayFocusTarget | null,
  ) => OverlayFocusTarget | null;
};

export function resolveOverlayFocusPolicy(input: OverlayFocusPolicyInput): OverlayFocusPolicy {
  return {
    autoFocus: input.autoFocus ?? input.modal,
    dismissOnEscape: input.dismissOnEscape ?? input.modal,
    inertBackground: input.inertBackground ?? input.modal,
    restoreFocus: input.restoreFocus ?? input.modal,
    trapFocus: input.trapFocus ?? input.modal,
  };
}

const overlayKeyboardLayerStack: symbol[] = [];

export function registerOverlayKeyboardLayer(layer: symbol): () => void {
  overlayKeyboardLayerStack.push(layer);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const index = overlayKeyboardLayerStack.lastIndexOf(layer);
    if (index >= 0) overlayKeyboardLayerStack.splice(index, 1);
  };
}

export function isTopOverlayKeyboardLayer(layer: symbol): boolean {
  return overlayKeyboardLayerStack.at(-1) === layer;
}

export function captureOverlayFocusTarget(activeElement: unknown): OverlayFocusTarget | null {
  if (!activeElement || typeof (activeElement as { focus?: unknown }).focus !== 'function') {
    return null;
  }
  return activeElement as OverlayFocusTarget;
}

export function restoreOverlayFocus(trigger: OverlayFocusTarget | null): void {
  trigger?.focus();
}

export function scheduleOverlayFocusRestore(
  trigger: OverlayFocusTarget | null,
  schedule: (callback: () => void) => void,
): void {
  if (!trigger) return;
  schedule(() => {
    if (trigger.isConnected === false) return;
    restoreOverlayFocus(trigger);
  });
}

export function resolveOverlayFocusReturnTarget(
  trigger: OverlayFocusTarget | null,
  resolver?: (trigger: OverlayFocusTarget | null) => OverlayFocusTarget | null,
): OverlayFocusTarget | null {
  return resolver ? resolver(trigger) : trigger;
}

export function focusOverlayEntry(
  autoFocus: boolean,
  surface: OverlayFocusSurface | null,
  preferredTarget?: OverlayFocusTarget | null,
): boolean {
  if (!autoFocus || !surface) return false;
  if (preferredTarget) {
    preferredTarget.focus();
    return true;
  }
  const declaredTarget = captureOverlayFocusTarget(
    surface.querySelector?.('[data-overlay-initial-focus]'),
  );
  const firstFocusable = Array.from(surface.querySelectorAll?.(OVERLAY_FOCUSABLE_SELECTOR) || [])
    .map((element) => captureOverlayFocusTarget(element))
    .find((element): element is OverlayFocusTarget => element !== null && isOverlayFocusTargetVisible(element));
  (preferredTarget ?? declaredTarget ?? firstFocusable ?? surface).focus();
  return true;
}

export function isOverlayFocusTargetVisible(target: OverlayFocusTarget): boolean {
  if (target.isConnected === false || target.hidden === true) return false;
  if (target.matches?.(':disabled, [aria-hidden="true"], [inert]')) return false;
  if (typeof target.getClientRects === 'function' && target.getClientRects().length === 0) return false;
  return true;
}

export function overlayDismissLocked(dismissDisabled = false, busy = false): boolean {
  return dismissDisabled || busy;
}

export function handleOverlayEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'> & { defaultPrevented?: boolean },
  onDismiss: () => void,
  dismissLocked = false,
): boolean {
  if (event.defaultPrevented || event.key !== 'Escape' || dismissLocked) return false;
  event.preventDefault();
  onDismiss();
  return true;
}

export function trapOverlayTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  surface: OverlayFocusSurface | null,
  activeElement: unknown,
): boolean {
  if (event.key !== 'Tab' || !surface?.querySelectorAll) return false;

  const focusable = Array.from(surface.querySelectorAll(OVERLAY_FOCUSABLE_SELECTOR))
    .map((element) => captureOverlayFocusTarget(element))
    .filter((element): element is OverlayFocusTarget => element !== null && isOverlayFocusTargetVisible(element));

  if (focusable.length === 0) {
    event.preventDefault();
    surface.focus();
    return true;
  }

  const current = captureOverlayFocusTarget(activeElement);
  const currentIndex = current ? focusable.indexOf(current) : -1;
  const shouldWrapBackward = event.shiftKey && currentIndex <= 0;
  const shouldWrapForward = !event.shiftKey
    && (currentIndex < 0 || currentIndex === focusable.length - 1);

  if (!shouldWrapBackward && !shouldWrapForward) return false;

  event.preventDefault();
  focusable[shouldWrapBackward ? focusable.length - 1 : 0]?.focus();
  return true;
}

function asOverlayInertTarget(value: unknown): OverlayInertTarget | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<OverlayInertTarget>;
  if (
    typeof candidate.hasAttribute !== 'function'
    || typeof candidate.setAttribute !== 'function'
    || typeof candidate.removeAttribute !== 'function'
  ) {
    return null;
  }
  return candidate as OverlayInertTarget;
}

export function makeOverlayBackgroundInert(root: OverlayInertRoot | null): () => void {
  if (!root?.parentElement) return () => undefined;

  const snapshots: Array<{
    element: OverlayInertTarget;
    inert: boolean;
    hadAttribute: boolean;
  }> = [];
  const captured = new Set<OverlayInertTarget>();
  let activePathNode: unknown = root;
  let parent: OverlayInertParent | null | undefined = root.parentElement;

  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling === activePathNode) continue;
      const element = asOverlayInertTarget(sibling);
      if (!element || captured.has(element)) continue;
      captured.add(element);
      snapshots.push({
        element,
        inert: Boolean(element.inert),
        hadAttribute: element.hasAttribute('inert'),
      });
    }
    activePathNode = parent;
    parent = parent.parentElement;
  }

  for (const { element } of snapshots) {
    element.inert = true;
    element.setAttribute('inert', '');
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const snapshot of snapshots) {
      snapshot.element.inert = snapshot.inert;
      if (snapshot.hadAttribute) snapshot.element.setAttribute('inert', '');
      else snapshot.element.removeAttribute('inert');
    }
  };
}

function scheduleAfterOverlayCleanup(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
}

export function useOverlayFocusScope<
  TRoot extends HTMLElement = HTMLElement,
  TSurface extends HTMLElement = HTMLElement,
>({
  open,
  onDismiss,
  dismissDisabled = false,
  modal = true,
  autoFocus,
  dismissOnEscape,
  inertBackground,
  restoreFocus,
  trapFocus,
  resolveFocusReturnTarget,
}: UseOverlayFocusScopeOptions) {
  const overlayRootRef = useRef<TRoot | null>(null);
  const surfaceRef = useRef<TSurface | null>(null);
  const triggerRef = useRef<OverlayFocusTarget | null>(null);
  const keyboardLayerRef = useRef(Symbol('overlay-keyboard-layer'));
  const onDismissRef = useRef(onDismiss);
  const focusReturnResolverRef = useRef(resolveFocusReturnTarget);
  const dismissDisabledRef = useRef(dismissDisabled);
  onDismissRef.current = onDismiss;
  focusReturnResolverRef.current = resolveFocusReturnTarget;
  dismissDisabledRef.current = dismissDisabled;
  const policy = resolveOverlayFocusPolicy({
    modal,
    autoFocus,
    dismissOnEscape,
    inertBackground,
    restoreFocus,
    trapFocus,
  });
  const keyboardEnabled = policy.trapFocus || policy.dismissOnEscape;
  const keyboardPolicyRef = useRef({
    dismissOnEscape: policy.dismissOnEscape,
    trapFocus: policy.trapFocus,
  });
  keyboardPolicyRef.current = {
    dismissOnEscape: policy.dismissOnEscape,
    trapFocus: policy.trapFocus,
  };

  useEffect(() => {
    if (!open || !policy.restoreFocus || typeof document === 'undefined') return undefined;
    triggerRef.current = captureOverlayFocusTarget(document.activeElement);
    return () => {
      const returnTarget = resolveOverlayFocusReturnTarget(
        triggerRef.current,
        focusReturnResolverRef.current,
      );
      triggerRef.current = null;
      scheduleOverlayFocusRestore(returnTarget, scheduleAfterOverlayCleanup);
    };
  }, [open, policy.restoreFocus]);

  useEffect(() => {
    if (!open) return;
    focusOverlayEntry(policy.autoFocus, surfaceRef.current as OverlayFocusSurface | null);
  }, [open, policy.autoFocus]);

  useEffect(() => {
    if (
      !open
      || typeof document === 'undefined'
      || !keyboardEnabled
    ) return undefined;
    const keyboardLayer = keyboardLayerRef.current;
    const unregisterKeyboardLayer = registerOverlayKeyboardLayer(keyboardLayer);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayKeyboardLayer(keyboardLayer)) return;
      if (keyboardPolicyRef.current.trapFocus && trapOverlayTab(
        event,
        surfaceRef.current as OverlayFocusSurface | null,
        document.activeElement,
      )) {
        return;
      }
      if (keyboardPolicyRef.current.dismissOnEscape) {
        handleOverlayEscape(event, () => onDismissRef.current(), dismissDisabledRef.current);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unregisterKeyboardLayer();
    };
  }, [keyboardEnabled, open]);

  useEffect(() => {
    if (!open || !policy.inertBackground) return undefined;
    return makeOverlayBackgroundInert(overlayRootRef.current as OverlayInertRoot | null);
  }, [open, policy.inertBackground]);

  return {
    overlayRootRef,
    surfaceRef,
  };
}
```

