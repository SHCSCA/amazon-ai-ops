import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build } = require('../apps/desktop/node_modules/esbuild');

export async function buildSettingsProductOperationsFixture() {
  const result = await build({
    stdin: {
      sourcefile: 'settings-product-operations-fixture.tsx',
      resolveDir: path.resolve('apps/desktop/src/renderer'), loader: 'tsx',
      contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPage } from './pages/settings-page';
import { ProductConfigPage } from './pages/product-config-page';
const root = createRoot(document.getElementById('root'));
window.calls = { saves: [], tests: [], bulk: [], productSaves: [], loads: [], logs: [], dataEvents: 0 };
window.waiting = { saves: [], tests: [], bulk: [], productSaves: [], loads: [] };
window.addEventListener('business-ui:data-updated', () => window.calls.dataEvents++);
window.mode = 'settings'; window.generation = 0;
window.bind = (id, missing = false, asin = 'B012345678') => {
  window.generation++;
  window.currentContext = { storeId: id, browserProfileId: 'profile-' + id, marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 1 };
  window.authorityView = missing ? null : { phase: 'ready', authorityKey: id, contextEpoch: window.generation, authoritativeContext: window.currentContext };
  window.currentScope = { dateFrom: '2026-10-01', dateTo: '2026-10-07', storeName: 'same-name-store', marketplaceCode: 'US', asin, batchId: 'same-batch', currency: 'USD' };
  window.renderFixture();
};
const defer = (kind, payload) => { window.calls[kind].push(payload); return new Promise((resolve, reject) => window.waiting[kind].push({resolve, reject})); };
window.resolveFixture = (kind, index, result) => window.waiting[kind][index].resolve(result);
window.rejectFixture = (kind, index, message) => window.waiting[kind][index].reject(new Error(message));
window.electronAPI = {
  getSettings: async () => ({ aiKeyConfigured: true, aiBaseUrl:'https://provider.invalid/v1', aiModel:'model-' + window.currentContext.storeId }),
  getRuleConfig: async () => null,
  getStoragePaths: async () => ({}), listAiCallLogs: async () => [],
  saveSettings: value => defer('saves', value), testAiSettings: value => defer('tests', value),
  saveRuleConfig: value => defer('saves', value),
  reportRuntimeLog: async value => { window.calls.logs.push(value); },
  getProducts: async () => {
    const row = { id:1, asin: window.currentScope.asin, store_name: window.currentScope.storeName, marketplace_code:'US', title:'product-' + window.currentContext.storeId, cost:{ targetAcos:0.35 } };
    if (window.deferLoads) return defer('loads', window.currentContext.storeId);
    return window.currentScope.asin ? [row] : [];
  },
  saveProductConfig: value => defer('productSaves', value),
  bulkUpdateProductTargetAcos: value => defer('bulk', value),
};
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { if (window.clipboardFailure) throw new DOMException('Clipboard denied', 'NotAllowedError'); } } });
window.invokeTwice = selector => {
  const button = document.querySelector(selector);
  const props = button[Object.keys(button).find(key => key.startsWith('__reactProps'))];
  props.onClick({}); props.onClick({});
};
window.renderFixture = () => root.render(window.mode === 'settings' ? <SettingsPage storeContext={window.currentContext}/> : <ProductConfigPage/>);
window.showFixture = (mode, missing = false, asin = 'B012345678') => { window.mode = mode; window.bind('A', missing, asin); };
window.disposeFixture = () => root.unmount();
`,
    },
    plugins: [{ name: 'isolated-page-ports', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)components\/business-data$/ }, () => ({ path: 'business-data', namespace: 'fixture-ports' }));
      builder.onResolve({ filter: /(?:^|\/)scope-store$/ }, () => ({ path: 'scope', namespace: 'fixture-ports' }));
      builder.onResolve({ filter: /(?:^|\/)mission-control\/store-context$/ }, () => ({ path: 'authority', namespace: 'fixture-ports' }));
      builder.onResolve({ filter: /(?:^|\/)components\/workspace\/ai-spend-panel$/ }, () => ({ path: 'ai-spend', namespace: 'fixture-ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-ports' }, args => ({ loader: 'ts', contents: {
        'business-data': `export const useBusinessDataPipeline=()=>({scope:window.currentScope,data:{collection:{fileAudit:{importedRowCount:0}},quant:{importedRows:0}}});`,
        scope: `export const useScopeStore=()=>({scope:window.currentScope});`,
        authority: `export const useOptionalMissionControlStoreContext=()=>window.authorityView;`,
        'ai-spend': `export const AiSpendPanel=()=>null;`,
      }[args.path] }));
    } }],
    bundle: true, write: false, format: 'iife', platform: 'browser',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
  });
  return result.outputFiles[0].text;
}
