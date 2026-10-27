import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));
const { createRuntimeLogRecord } = require(path.join(root, 'packages/shared-types/src/runtime-log-format.cjs'));

export async function withAutomationControlFixture(options: Record<string, unknown>, run: (page: Page) => Promise<void>) {
  let browser: Browser | undefined;
  try {
    const result = await viteRequire('esbuild').build({
      stdin: { contents: fixture, loader: 'tsx', resolveDir: path.join(root, 'apps/desktop/src/renderer/mission-control/components') },
      bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
      nodePaths: [path.join(root, 'apps/desktop/node_modules')],
      alias: { '@amazon-ai-ops/shared-types': path.join(root, 'packages/shared-types/src/index.ts') },
      define: { 'process.env.NODE_ENV': '"test"' },
    });
    browser = await chromium.launch({ headless: true, timeout: 10_000 });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); });
    page.setDefaultTimeout(5_000);
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: 'window.automationFixtureOptions=' + JSON.stringify(options) + ';\n' + result.outputFiles[0].text });
    await page.locator('#fixture-scope').waitFor();
    await run(page);
    if (errors.length) throw new Error('AUTOMATION_CONTROL_BROWSER_ERRORS:' + errors.join('|'));
  } catch (error) {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'test.automation_control_fixture_failed', { error })) + '\n');
    throw error;
  } finally {
    if (browser) {
      try { await browser.close(); }
      catch (error) {
        process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'test.automation_control_fixture_cleanup_failed', { error })) + '\n');
        throw error;
      }
    }
  }
}

const fixture = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createRuntimeLogRecord } from '@amazon-ai-ops/shared-types';
import { StoreCollectionAutomationControl } from './store-collection-automation-control';
import { StoreRuntimeConfigPanel } from './store-runtime-config-panel';
const options = window.automationFixtureOptions || {};
let context = makeContext('store-a'), instance = 0;
const reads = [], writes = [], logs = [], saved = new Map();
function makeContext(storeId) { return { storeId, browserProfileId: 'profile-' + storeId, marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-21', sessionGeneration: 1 }; }
function current(ctx) { return saved.get(ctx.storeId + '|' + ctx.browserProfileId) || {
  storeId: ctx.storeId, browserProfileId: ctx.browserProfileId, automaticCollectionEnabled: true,
  source: 'legacy-default', revision: 0, updatedAt: null }; }
function getStoreCollectionAutomation(ctx) {
  return new Promise((resolve, reject) => {
    const row = { context: { ...ctx }, projection: { ...current(ctx) }, resolve, reject };
    reads.push(row);
    if (!options.deferReads) resolve({ ...row.projection });
  });
}
function setStoreCollectionAutomation(ctx, input) {
  return new Promise((resolve, reject) => { writes.push({ context: { ...ctx }, input: { ...input }, resolve, reject }); });
}
window.electronAPI = {
  getStoreRuntimeConfig: async () => ({ current: null, versions: [] }),
  createStoreRuntimeConfig: async () => { throw new Error('SOFTWARE_FIXTURE_CONFIG_WRITE_FORBIDDEN'); },
  updateStoreRuntimeConfig: async () => { throw new Error('SOFTWARE_FIXTURE_CONFIG_WRITE_FORBIDDEN'); },
  archiveStoreRuntimeConfig: async () => { throw new Error('SOFTWARE_FIXTURE_CONFIG_WRITE_FORBIDDEN'); },
  restoreStoreRuntimeConfig: async () => { throw new Error('SOFTWARE_FIXTURE_CONFIG_WRITE_FORBIDDEN'); },
  reportRuntimeLog: async report => { logs.push(createRuntimeLogRecord(report.level, report.event, report.context)); },
  ...(!options.missingApi ? { getStoreCollectionAutomation, setStoreCollectionAutomation } : {}),
};
const root = createRoot(document.querySelector('#root'));
function render() { root.render(<><output id="fixture-scope">{context.storeId} / SOFTWARE_ONLY</output>{options.surface === 'panel'
  ? <StoreRuntimeConfigPanel key={instance} storeContext={context} />
  : <StoreCollectionAutomationControl key={instance} storeContext={context} />}</>); }
window.automationFixture = { reads, writes, logs,
  setStore(storeId) { context = makeContext(storeId); render(); },
  remount() { instance += 1; render(); },
  finishRead(index, change = {}) {
    const row = reads[index];
    if (change.error) row.reject(new Error('SOFTWARE_FIXTURE_READ_REJECTED'));
    else row.resolve({ ...row.projection, ...(change.patch || {}) });
  },
  finishWrite(index, change = {}) {
    const row = writes[index], old = current(row.context);
    if (change.error || row.input.expectedRevision !== old.revision) {
      row.reject(new Error('当前配置版本已变化，请重新读取。')); return;
    }
    const next = { storeId: row.context.storeId, browserProfileId: row.context.browserProfileId,
      automaticCollectionEnabled: row.input.automaticCollectionEnabled, source: 'explicit-override',
      revision: old.revision + 1, updatedAt: '2026-10-22T06:00:00.000Z', ...(change.patch || {}) };
    saved.set(row.context.storeId + '|' + row.context.browserProfileId, next);
    row.resolve({ ...next });
  },
};
render();
`;
