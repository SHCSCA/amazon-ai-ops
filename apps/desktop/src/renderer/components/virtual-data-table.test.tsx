import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  virtualColumnSortAria,
  virtualColumnTemplate,
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
  });

  it('builds an explicit grid template so dense columns cannot reflow unpredictably', () => {
    const columns: Array<VirtualDataTableColumn<Row>> = [
      { key: 'keyword', header: '关键词', width: 'minmax(180px, 1.4fr)', cell: (row) => row.keyword },
      { key: 'score', header: '评分', width: '96px', cell: (row) => row.score },
      { key: 'fallback', header: '默认', cell: () => '-' },
    ];

    expect(virtualColumnTemplate(columns)).toBe('minmax(180px, 1.4fr) 96px minmax(120px, 1fr)');
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
    expect(text).toContain('.virtual-table-sort-button');
    expect(text).toMatch(/\.virtual-table-sort-arrow[\s\S]*transition:\s*transform 150ms/);
    expect(text).toMatch(/\.virtual-table-sort-active\[data-sort-direction="asc"\][\s\S]*rotate\(180deg\)/);
  });

  it('renders sortable headers as buttons with sort callbacks and columnheader aria-sort', () => {
    const text = source();

    expect(text).toContain('onSortChange');
    expect(text).toContain('aria-sort');
    expect(text).toContain('virtual-table-sort-button');
    expect(text).toContain('virtual-table-sort-arrow');
  });
});
