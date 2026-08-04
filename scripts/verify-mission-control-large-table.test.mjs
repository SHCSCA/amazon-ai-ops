import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  MAX_RENDERED_ITEMS,
  ROW_COUNT,
  assertComponentContract,
  verifyMissionControlLargeTable,
} = require('./verify-mission-control-large-table.js');

describe('Stage 7 Mission Control 50,000-row verifier', () => {
  it('proves bounded rendering at the start, middle, and end of 50,000 stable rows', () => {
    const evidence = verifyMissionControlLargeTable();

    expect(evidence.passed).toBe(true);
    expect(evidence.rowCount).toBe(ROW_COUNT);
    expect(evidence.ranges.start.firstIndex).toBe(0);
    expect(evidence.ranges.end.lastIndex).toBe(ROW_COUNT - 1);
    for (const range of Object.values(evidence.ranges)) {
      expect(range.renderedItemCount).toBeGreaterThan(0);
      expect(range.renderedItemCount).toBeLessThanOrEqual(MAX_RENDERED_ITEMS);
    }
  });

  it('fails closed if production stops binding count, stable keys, virtual rows, or keyboard selection', () => {
    expect(() => assertComponentContract('const rows = [];')).toThrow(/contract is incomplete/i);
    expect(() => assertComponentContract(`
      count: rows.length
      getItemKey: (index) => getRowKey(rows[index], index)
      const virtualRows = rowVirtualizer.getVirtualItems()
      virtualRows.map((virtualRow)
      rowVirtualizer.getTotalSize()
      data-workspace-queue-scroll
      data-workspace-queue-header
      if (event.key !== 'Enter' && event.key !== ' ') return;
      tabIndex={rowSelectable ? 0 : undefined}
      {rows.map((row) => row)}
    `)).toThrow(/rows\.map directly/i);
  });
});
