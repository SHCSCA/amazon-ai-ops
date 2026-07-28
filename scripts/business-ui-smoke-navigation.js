const { createRequire } = require('node:module');
const path = require('node:path');

async function navigateLegacyRoute(page, route) {
  await page.evaluate((nextRoute) => {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: nextRoute }));
  }, route);
}

async function startBusinessUiDevServer(repoRoot, scenario = 'diagnosis-ready') {
  const desktopRequire = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
  const { createServer } = desktopRequire('vite');
  const server = await createServer({
    configFile: path.join(repoRoot, 'apps', 'desktop', 'vite.config.ts'),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Business UI smoke Vite server did not expose a TCP address.');
  }
  return {
    url: `http://127.0.0.1:${address.port}/?preview=1&scenario=${encodeURIComponent(scenario)}`,
    close: () => server.close(),
  };
}

async function installPreviewApiBridge(page) {
  await page.addInitScript(() => {
    let previewApi;
    let smokeOverrides = window.__businessUiSmokeOverrides || {};
    let exposedApi;
    const authorityMethods = [
      'archiveStore',
      'createStore',
      'getActiveStoreContext',
      'getActiveStoreWorkspaceView',
      'getState',
      'getStore',
      'listStores',
      'onStoreContextChanged',
      'onStoresChanged',
      'restoreStore',
      'switchStore',
      'updateStore',
    ];
    const refreshExposedApi = () => {
      exposedApi = previewApi ? { ...previewApi, ...smokeOverrides } : undefined;
      for (const method of authorityMethods) {
        if (typeof previewApi?.[method] === 'function') exposedApi[method] = previewApi[method];
      }
    };
    Object.defineProperty(window, '__businessUiSmokeOverrides', {
      configurable: true,
      enumerable: false,
      get() {
        return smokeOverrides;
      },
      set(nextOverrides) {
        smokeOverrides = { ...smokeOverrides, ...(nextOverrides || {}) };
        refreshExposedApi();
      },
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      enumerable: true,
      get() {
        return exposedApi;
      },
      set(nextPreviewApi) {
        previewApi = nextPreviewApi || {};
        Object.defineProperty(window, '__businessUiPreviewApiBase', {
          configurable: true,
          enumerable: false,
          value: previewApi,
          writable: true,
        });
        refreshExposedApi();
      },
    });
  });
}

async function enterPreviewStore(page, storeLabel = 'SHC001-US · US · USD') {
  if (await page.locator('.app-shell').isVisible().catch(() => false)) return;
  const selector = page.locator('#mission-control-store-select');
  try {
    await selector.waitFor({ state: 'visible', timeout: 15_000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error([
      'Business UI smoke did not reach Store Gate or the authenticated app shell.',
      `Body: ${body.slice(0, 2_000) || '(empty)'}`,
      error instanceof Error ? error.message : String(error),
    ].join('\n'));
  }
  await selector.selectOption({ label: storeLabel });
  await page.getByRole('button', { name: '进入所选店铺', exact: true }).click();
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15_000 });
}

async function openScopeEditor(page) {
  const batchSelect = page.getByLabel('数据批次来源');
  if (!await batchSelect.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '范围设置', exact: true }).click();
  }
  await batchSelect.waitFor({ state: 'visible', timeout: 5000 });
  return batchSelect;
}

async function setManualScopeBatch(page, batchId) {
  const batchSelect = await openScopeEditor(page);
  await batchSelect.selectOption('__manual__');
  await page.getByRole('textbox', { name: '手动批次 ID', exact: true }).fill(batchId);
}

module.exports = {
  enterPreviewStore,
  installPreviewApiBridge,
  navigateLegacyRoute,
  openScopeEditor,
  setManualScopeBatch,
  startBusinessUiDevServer,
};
