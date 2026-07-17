import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  virtualColumnSortAria,
  virtualColumnStickyClass,
  virtualColumnTemplate,
  virtualRowSelectionAllowed,
  virtualTableStatusText,
  virtualRowParityClass,
  virtualSortHeaderClass,
  type VirtualDataTableColumn,
} from './virtual-data-table';

interface Row {
  keyword: string;
  score: number;
}

function source(): string {
  return readFileSync(new URL('./virtual-data-table.tsx', import.meta.url), 'utf8');
}

function css(): string {
  return readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
}

describe('VirtualDataTable', () => {
  it('uses TanStack virtualizer instead of rendering every row', () => {
    const text = source();

    expect(text).toContain("@tanstack/react-virtual");
    expect(text).toContain('useVirtualizer');
    expect(text).toContain('getVirtualItems');
    expect(text).toContain('getTotalSize');
    expect(text).toContain('measureElement');
    expect(text).toContain('data-scroll-owner="virtual-table"');
  });

  it('builds an explicit grid template so dense columns cannot reflow unpredictably', () => {
    const columns: Array<VirtualDataTableColumn<Row>> = [
      { key: 'keyword', header: '关键词', width: 'minmax(180px, 1.4fr)', cell: (row) => row.keyword },
      { key: 'score', header: '评分', width: '96px', cell: (row) => row.score },
      { key: 'fallback', header: '默认', cell: () => '-' },
    ];

    expect(virtualColumnTemplate(columns)).toBe('minmax(180px, 1.4fr) 96px minmax(120px, 1fr)');
  });

  it('makes sticky columns an explicit table contract instead of a first-child side effect', () => {
    const columns: Array<VirtualDataTableColumn<Row>> = [
      { key: 'keyword', header: '关键词', sticky: 'left', cell: (row) => row.keyword },
      { key: 'score', header: '评分', cell: (row) => row.score },
    ];

    expect(virtualColumnStickyClass(columns[0])).toBe('virtual-table-cell-sticky-left');
    expect(virtualColumnStickyClass(columns[1])).toBe('');

    const text = source();

    expect(text).toContain('virtualColumnStickyClass(column)');
    expect(text).toContain('const stickyClass = virtualColumnStickyClass(column);');
  });

  it('maps active sortable headers to stable ARIA sort states', () => {
    expect(virtualColumnSortAria('keyword', 'keyword', 'asc')).toBe('ascending');
    expect(virtualColumnSortAria('score', 'score', 'desc')).toBe('descending');
    expect(virtualColumnSortAria('keyword', 'score', 'desc')).toBe('none');
  });

  it('marks sortable and active headers for arrow rotation feedback', () => {
    expect(virtualSortHeaderClass({ sortable: true, active: true })).toContain('virtual-table-sort-active');
    expect(virtualSortHeaderClass({ sortable: true, active: false })).toContain('virtual-table-sortable');
    expect(virtualSortHeaderClass({ sortable: false, active: false })).not.toContain('virtual-table-sortable');
  });

  it('has sticky header, skeleton overlay, and high-density cell containment styles', () => {
    const text = css();

    expect(text).toContain('.virtual-table-wrap');
    expect(text).toContain('.virtual-table-skeleton');
    expect(text).toMatch(/\.virtual-table-head[\s\S]*position:\s*sticky/);
    expect(text).toMatch(/\.virtual-table-cell[\s\S]*contain:\s*strict/);
    expect(text).toMatch(/\.virtual-table-cell-sticky-left[\s\S]*position:\s*sticky/);
    expect(text).toMatch(/\.virtual-table-cell-sticky-left[\s\S]*left:\s*0/);
    expect(text).toMatch(/\.virtual-table-header-cell\.virtual-table-cell-sticky-left[\s\S]*z-index:\s*9/);
    expect(text).not.toContain('.virtual-table-cell:first-child');
    expect(text).toMatch(/\.virtual-table-body-row[\s\S]*transition:\s*[\s\S]*background var\(--motion-fast\)[\s\S]*box-shadow var\(--motion-fast\)/);
    expect(text).toMatch(/\.virtual-table-body-row:active[\s\S]*box-shadow:\s*inset 3px 0 0 var\(--primary\)/);
    expect(text).toMatch(/\.virtual-table-body-row:focus-within[\s\S]*box-shadow:\s*inset 3px 0 0 var\(--primary\)/);
    expect(text).toContain('.virtual-table-sort-button');
    expect(text).toMatch(/\.virtual-table-sort-arrow[\s\S]*transition:\s*transform 150ms/);
    expect(text).toMatch(/\.virtual-table-sort-active\[data-sort-direction="asc"\][\s\S]*rotate\(180deg\)/);
    expect(text).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.virtual-table-sort-arrow[\s\S]*transition:\s*none/);
    expect(text).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.virtual-table-skeleton span[\s\S]*animation:\s*none/);
  });

  it('renders sortable headers as buttons with sort callbacks and columnheader aria-sort', () => {
    const text = source();

    expect(text).toContain('onSortChange');
    expect(text).toContain('aria-sort');
    expect(text).toContain('virtual-table-sort-button');
    expect(text).toContain('virtual-table-sort-arrow');
  });

  it('uses actual virtual row indexes for zebra striping instead of DOM nth-child order', () => {
    const text = source();
    const styles = css();

    expect(virtualRowParityClass(0)).toBe('virtual-table-row-even');
    expect(virtualRowParityClass(1)).toBe('virtual-table-row-odd');
    expect(virtualRowParityClass(42)).toBe('virtual-table-row-even');
    expect(text).toContain('virtual-table-row-even');
    expect(text).toContain('virtual-table-row-odd');
    expect(text).toContain('virtualRowParityClass(virtualRow.index)');
    expect(styles).toMatch(/\.virtual-table-row-even[\s\S]*background:\s*#fff/);
    expect(styles).toMatch(/\.virtual-table-row-odd[\s\S]*background:\s*#f8fafc/);
    expect(styles.indexOf('.virtual-table-row-odd')).toBeLessThan(styles.indexOf('.virtual-table-body-row:hover'));
  });

  it('exposes a stable table status line for loading, populated, and empty states', () => {
    expect(virtualTableStatusText({ loading: true, rowCount: 0, columnCount: 7 })).toBe('表格正在加载，保留 7 列结构。');
    expect(virtualTableStatusText({ loading: true, rowCount: 18, columnCount: 7 })).toBe('表格正在加载，当前暂存 18 行 / 7 列。');
    expect(virtualTableStatusText({ loading: false, rowCount: 18, columnCount: 7 })).toBe('当前展示 18 行 / 7 列。');
    expect(virtualTableStatusText({ loading: false, rowCount: 0, columnCount: 7 })).toBe('当前没有可展示的表格行，表头保留 7 列。');
  });

  it('wires the status line to the virtual table without layout shift', () => {
    const text = source();
    const styles = css();

    expect(text).toContain('useId');
    expect(text).toContain('const statusId = useId()');
    expect(text).toContain('virtualTableStatusText({ loading, rowCount: rows.length, columnCount: columns.length })');
    expect(text).toContain('className="virtual-table-status"');
    expect(text).toContain('role="status"');
    expect(text).toContain('aria-live="polite"');
    expect(text).toContain('aria-atomic="true"');
    expect(text).toContain('aria-describedby={statusId}');
    expect(text).toContain('aria-colcount={columns.length}');
    expect(text).toContain('aria-rowcount={rows.length}');
    expect(styles).toMatch(/\.virtual-table-status[\s\S]*min-height:\s*30px/);
    expect(styles).toMatch(/\.virtual-table-status[\s\S]*border-bottom:\s*1px solid var\(--line-soft\)/);
    expect(styles).toMatch(/\.virtual-table-skeleton[\s\S]*top:\s*30px/);
  });

  it('supports optional row selection without adding per-row action buttons', () => {
    const text = source();
    const styles = css();

    expect(text).toContain('selectedRowKey');
    expect(text).toContain('onRowSelect');
    expect(text).toContain('rowAriaLabel');
    expect(text).toContain('aria-selected={rowSelectable ? rowSelected : undefined}');
    expect(text).toContain("if (event.key !== 'Enter' && event.key !== ' ') return;");
    expect(styles).toContain('.virtual-table-row-selectable');
    expect(styles).toContain('.virtual-table-row-selected');
  });

  it('does not let nested controls masquerade as a row-selection gesture', () => {
    const row = {};
    const nestedButton = { closest: () => ({ tagName: 'BUTTON' }) };
    const plainCell = { closest: () => null };

    expect(virtualRowSelectionAllowed(row, row)).toBe(true);
    expect(virtualRowSelectionAllowed(plainCell, row)).toBe(true);
    expect(virtualRowSelectionAllowed(nestedButton, row)).toBe(false);

    const text = source();
    expect(text).toContain('event.target !== event.currentTarget');
    expect(text).toContain('virtualRowSelectionAllowed(event.target, event.currentTarget)');
  });

  it('exposes stable queue, sticky-header, row-index, and row-key evidence markers', () => {
    const text = source();

    expect(text).toContain('data-workspace-queue-scroll');
    expect(text).toContain('data-workspace-queue-header');
    expect(text).toContain('data-workspace-row');
    expect(text).toContain('data-row-index={virtualRow.index}');
    expect(text).toContain('data-row-key={String(key)}');
  });
});
