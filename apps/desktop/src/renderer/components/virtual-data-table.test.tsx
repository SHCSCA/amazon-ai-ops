import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { virtualColumnTemplate, type VirtualDataTableColumn } from './virtual-data-table';

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

  it('has sticky header, skeleton overlay, and high-density cell containment styles', () => {
    const text = css();

    expect(text).toContain('.virtual-table-wrap');
    expect(text).toContain('.virtual-table-skeleton');
    expect(text).toMatch(/\.virtual-table-head[\s\S]*position:\s*sticky/);
    expect(text).toMatch(/\.virtual-table-cell[\s\S]*contain:\s*strict/);
  });
});
