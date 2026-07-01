import React, { useMemo, useRef } from 'react';
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
  sortKey,
  sortDirection = 'desc',
  onSortChange,
}: VirtualDataTableProps<T>) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const gridTemplateColumns = useMemo(() => virtualColumnTemplate(columns), [columns]);
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
      ref={parentRef}
    >
      {loading && (
        <div aria-label="表格正在加载" className="virtual-table-skeleton">
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="virtual-table" role="table" style={{ minWidth }}>
        <div className="virtual-table-head" role="rowgroup">
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
              return (
                <div
                  className="virtual-table-item"
                  data-index={virtualRow.index}
                  key={key}
                  ref={rowVirtualizer.measureElement}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div
                    className={`virtual-table-row virtual-table-body-row ${virtualRowParityClass(virtualRow.index)} ${rowClassName?.(row, virtualRow.index) || ''}`.trim()}
                    role="row"
                    style={{ gridTemplateColumns }}
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
