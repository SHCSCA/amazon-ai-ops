import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('legacy IPC store authority contract', () => {
  it('retires legacy operation-event IPC instead of resolving store authority after invocation', () => {
    for (const channel of [
      'operation-events:list',
      'operation-events:create',
      'operation-events:update',
      'operation-events:delete',
    ]) {
      expect(source).not.toContain(`ipcMain.handle('${channel}'`);
      expect(preload).not.toContain(`ipcRenderer.invoke('${channel}'`);
    }
    expect(source).toContain('registerStoreScopedObjectsIpcHandlers(');
  });

  it('retires legacy product IPC in favor of StoreContext plus revision CAS', () => {
    for (const channel of [
      'products:get',
      'products:add',
      'products:save-config',
      'products:bulk-update-target-acos',
    ]) {
      expect(source).not.toContain(`ipcMain.handle('${channel}'`);
      expect(preload).not.toContain(`ipcRenderer.invoke('${channel}'`);
    }
    expect(preload).toContain("ipcRenderer.invoke('store-objects:products:update', { storeContext, input })");
  });

  it('retires the path-bearing legacy keyword opportunity bridge', () => {
    expect(source).not.toContain("ipcMain.handle('v1_5:business-ui:keyword-opportunities'");
    expect(preload).not.toContain("ipcRenderer.invoke('v1_5:business-ui:keyword-opportunities'");
    expect(preload).toContain("ipcRenderer.invoke('store-ad-listing:keyword-facts:list', { storeContext, input })");
  });

  it('routes internal Listing persistence through the active store CAS service', () => {
    const persistence = between(
      'function persistListingContent',
      'function readCurrentOperationScopeValue',
    );

    expect(persistence).toContain('resolveBusinessStoreAuthority');
    expect(persistence).toContain('canonicalizeAmazonAsin(listing.asin)');
    expect(persistence).toContain('storeScopedAdListingService.listListingContent(activeContext');
    expect(persistence).toContain('storeScopedAdListingService.updateListingContent(activeContext');
    expect(persistence).toContain('expectedRevision: existing.revision');
    expect(persistence).toContain('storeScopedAdListingService.createListingContent(activeContext');
    expect(persistence).not.toContain('UPDATE listing_content');
    expect(persistence).not.toContain('INSERT INTO listing_content');
  });
});

describe('collection Renderer boundary contract', () => {
  it('returns a path-free minimal DTO from resume instead of spreading the runner result', () => {
    const handler = between(
      'async function handleResumeLingxingCollection',
      'const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS',
    );

    expect(handler).not.toContain('...output.result');
    expect(handler).toContain('job: minimalLingxingCollectionJobForRenderer(output.result.job)');
    expect(handler).toContain('sanitizeLingxingImportSummaryForRenderer');
    expect(handler).not.toContain('output.result.batch');
    expect(handler).not.toContain('output.result.files');
  });

  it('does not claim matched reconciliation without an independent source total', () => {
    const importer = between(
      'function importStoreScopedLingxingDownloadedReportMetrics',
      'function loadLatestImportableLingxingBatchForScope',
    );

    expect(importer).toContain('reconciliations: []');
    expect(importer).not.toContain('const reconciliationGroups = new Map');
    expect(importer).not.toContain('expectedRows: 0');
    expect(importer).not.toContain('expectedCost: 0');
  });

  it('walks the complete pending and failed import recovery queue by cursor', () => {
    const recovery = between(
      'function recoverPendingLingxingCollectionImportsOnStartup',
      'function sanitizeLingxingImportSummaryForRenderer',
    );

    expect(recovery).toContain('listRecoverableCollectionImportsForStore');
    expect(recovery).toContain("importStates: ['pending', 'failed']");
    expect(recovery).toContain('cursor = page.nextCursor');
    expect(recovery).not.toContain('listCollectionJobsForStore');
    expect(recovery).not.toContain("checkpoint.state !== 'downloaded'");
  });

  it('builds Today facts from US/USD metrics and per-report immutable import proofs', () => {
    const today = between(
      'function buildAuthoritativeMissionControlTodayProjection',
      'function normalizeLingxingCollectionRequest',
    );

    expect(today).toContain("upper(trim(marketplace_code)) = 'US'");
    expect(today).toContain("upper(trim(currency)) = 'USD'");
    expect(today).toContain('report_import_file_snapshots');
    expect(today).toContain('report_import_runs');
    expect(today).toContain('runs.store_id = snapshots.store_id');
    expect(today).toContain('runs.run_id = snapshots.run_id');
    expect(today).toContain('runs.batch_id = snapshots.batch_id');
    expect(today).toContain("runs.status = 'completed'");
    expect(today).toContain('snapshots.report_file_id IS NOT NULL');
    expect(today).toContain('reportImportProofs');
    expect(today).toContain('archived_at IS NULL');
  });
});

describe('US business-date rollover authority contract', () => {
  it('rebroadcasts fresh authority, rebinds the visible runtime and keeps old requests stale', () => {
    const rollover = between(
      'function refreshActiveStoreBusinessDateAuthority',
      'function stopStoreBusinessDateAuthorityMonitor',
    );

    expect(rollover).toContain('previous.businessDate === next.businessDate');
    expect(rollover).toContain('state.browserRuntime = { ...state.browserRuntime');
    expect(rollover).toContain('publishStoreContextChanged(view)');
    expect(rollover).toContain('setInterval(');
    expect(rollover).toContain('storeBusinessDateAuthorityTimer.unref?.()');
  });
});
