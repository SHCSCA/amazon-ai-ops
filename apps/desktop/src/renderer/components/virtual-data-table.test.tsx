import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  virtualColumnSortAria,
  virtualColumnTemplate,
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
});
