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
