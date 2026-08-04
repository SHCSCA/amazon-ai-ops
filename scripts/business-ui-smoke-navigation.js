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

function storeDisplayName(storeLabel) {
  return String(storeLabel || '').split('·')[0].trim();
}

async function openStoreScopeSwitcher(page) {
  const dialog = page.getByRole('dialog', { name: '店铺与站点选择器' });
  if (!await dialog.isVisible().catch(() => false)) {
    const trigger = page.locator(
      'section[aria-label="店铺与站点"] .store-scope-switcher__trigger',
    ).first();
    await trigger.waitFor({ state: 'visible', timeout: 15_000 });
    await trigger.click();
  }
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

async function visibleStoreOption(page, { storeId, storeName }) {
  const dialog = await openStoreScopeSwitcher(page);
  const options = dialog.locator('.store-scope-switcher__option[data-store-scope-id]');
  await options.first().waitFor({ state: 'visible', timeout: 15_000 });
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    const optionStoreId = await option.getAttribute('data-store-scope-id');
    const optionName = String(await option.locator('strong').first().textContent() || '').trim();
    if ((storeId && optionStoreId === storeId) || (!storeId && optionName === storeName)) {
      return option;
    }
  }
  throw new Error(`Store switcher did not expose ${storeName || storeId}.`);
}

async function switchPreviewStore(page, storeId, storeName) {
  const currentStoreId = await page.locator('.mission-control-shell[data-store-context]')
    .getAttribute('data-store-context')
    .catch(() => null);
  if (currentStoreId === storeId) return;
  const option = await visibleStoreOption(page, { storeId, storeName });
  await option.click();
  await page.waitForFunction(async ({ expectedId, expectedName }) => {
    const shellStoreId = document.querySelector('.mission-control-shell[data-store-context]')
      ?.getAttribute('data-store-context');
    const getContext = window.electronAPI?.getActiveStoreContext;
    const context = typeof getContext === 'function' ? await getContext() : null;
    return shellStoreId === expectedId
      && (!getContext || context?.storeId === expectedId)
      && document.body.innerText.includes(expectedName);
  }, { expectedId: storeId, expectedName: storeName }, { timeout: 15_000 });
}

async function enterPreviewStore(page, storeLabel = 'SHC001-US') {
  if (await page.locator('nav[aria-label="主业务导航"]').isVisible().catch(() => false)) return;
  const displayName = storeDisplayName(storeLabel);
  const gate = page.locator('.mission-control-store-gate-shell[data-state="needs-selection"]');
  try {
    await gate.waitFor({ state: 'visible', timeout: 15_000 });
    const option = await visibleStoreOption(page, { storeName: displayName });
    await option.click();
    await page.locator('nav[aria-label="主业务导航"]').waitFor({ state: 'visible', timeout: 15_000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error([
      'Business UI smoke did not reach Store Gate or the authenticated app shell.',
      `Body: ${body.slice(0, 2_000) || '(empty)'}`,
      error instanceof Error ? error.message : String(error),
    ].join('\n'));
  }
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
  switchPreviewStore,
};
