const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COMPONENT_PATH = path.join(
  ROOT,
  'apps',
  'desktop',
  'src',
  'renderer',
  'components',
  'virtual-data-table.tsx',
);
const ROW_COUNT = 50_000;
const ROW_HEIGHT = 54;
const VIEWPORT_HEIGHT = 600;
const OVERSCAN = 10;
const MAX_RENDERED_ITEMS = 40;

function requireVirtualizer() {
  return require(path.join(
    ROOT,
    'apps',
    'desktop',
    'node_modules',
    '@tanstack',
    'react-virtual',
  )).Virtualizer;
}

function assertComponentContract(source) {
  const required = [
    'count: rows.length',
    'getItemKey: (index) => getRowKey(rows[index], index)',
    'const virtualRows = rowVirtualizer.getVirtualItems()',
    'virtualRows.map((virtualRow)',
    'rowVirtualizer.getTotalSize()',
    'data-workspace-queue-scroll',
    'data-workspace-queue-header',
    "if (event.key !== 'Enter' && event.key !== ' ') return;",
    'tabIndex={rowSelectable ? 0 : undefined}',
  ];
  const missing = required.filter((marker) => !source.includes(marker));
  if (missing.length > 0) {
    throw new Error(`VirtualDataTable production contract is incomplete: ${missing.join(', ')}`);
  }
  if (/\{rows\.map\(/.test(source)) {
    throw new Error('VirtualDataTable renders rows.map directly instead of the bounded virtual range.');
  }
  return required;
}

function createRows() {
  return Array.from({ length: ROW_COUNT }, (_, index) => ({
    id: `row-${String(index).padStart(5, '0')}`,
    keyword: `keyword-${index}`,
    bidCents: 25 + (index % 400),
  }));
}

function createVirtualizer(rows, initialOffset) {
  const Virtualizer = requireVirtualizer();
  return new Virtualizer({
    count: rows.length,
    getScrollElement: () => null,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index].id,
    observeElementRect: () => () => {},
    observeElementOffset: () => () => {},
    scrollToFn: () => {},
    initialRect: { width: 1_280, height: VIEWPORT_HEIGHT },
    initialOffset,
  });
}

function inspectRange(rows, initialOffset) {
  const virtualizer = createVirtualizer(rows, initialOffset);
  const items = virtualizer.getVirtualItems();
  if (items.length === 0 || items.length > MAX_RENDERED_ITEMS) {
    throw new Error(`Expected a bounded non-empty virtual range, received ${items.length} items.`);
  }
  const keys = items.map((item) => item.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Visible virtual row keys are not unique.');
  }
  return {
    initialOffset,
    renderedItemCount: items.length,
    firstIndex: items[0].index,
    lastIndex: items[items.length - 1].index,
    firstKey: String(items[0].key),
    lastKey: String(items[items.length - 1].key),
    totalSize: virtualizer.getTotalSize(),
  };
}

function verifyMissionControlLargeTable() {
  const source = fs.readFileSync(COMPONENT_PATH, 'utf8');
  const contractMarkers = assertComponentContract(source);
  const rows = createRows();
  const expectedTotalSize = ROW_COUNT * ROW_HEIGHT;
  const ranges = {
    start: inspectRange(rows, 0),
    middle: inspectRange(rows, Math.floor(expectedTotalSize / 2)),
    end: inspectRange(rows, expectedTotalSize - VIEWPORT_HEIGHT),
  };

  for (const range of Object.values(ranges)) {
    if (range.totalSize !== expectedTotalSize) {
      throw new Error(`Virtual total size mismatch: ${range.totalSize} !== ${expectedTotalSize}.`);
    }
  }
  if (ranges.start.firstIndex !== 0 || ranges.end.lastIndex !== ROW_COUNT - 1) {
    throw new Error('The 50,000-row virtual range cannot reach both table boundaries.');
  }
  if (ranges.middle.firstIndex >= Math.floor(ROW_COUNT / 2)
    || ranges.middle.lastIndex <= Math.floor(ROW_COUNT / 2)) {
    throw new Error('The middle virtual range does not straddle the requested midpoint.');
  }

  return {
    kind: 'mission-control-large-table-verification',
    schemaVersion: 1,
    passed: true,
    rowCount: ROW_COUNT,
    rowHeight: ROW_HEIGHT,
    viewportHeight: VIEWPORT_HEIGHT,
    overscan: OVERSCAN,
    maxRenderedItemLimit: MAX_RENDERED_ITEMS,
    expectedTotalSize,
    keyboardSelection: ['Enter', 'Space'],
    contractMarkers,
    ranges,
  };
}

module.exports = {
  MAX_RENDERED_ITEMS,
  OVERSCAN,
  ROW_COUNT,
  ROW_HEIGHT,
  VIEWPORT_HEIGHT,
  assertComponentContract,
  inspectRange,
  verifyMissionControlLargeTable,
};

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(verifyMissionControlLargeTable(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`[S7 LARGE TABLE BLOCKED] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
