// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME,
  } = dependencies;
  const beginStoreGateDiagnostics = (...args) => dependencies.beginStoreGateDiagnostics(...args);
  const completeStoreGateDiagnostics = (...args) => dependencies.completeStoreGateDiagnostics(...args);
  const fail = (...args) => dependencies.fail(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

async function ensureEvidenceLingxingConnection(page, loginDiagnostics) {
  const status = page.locator('[data-login-connection-status]');
  await status.waitFor({ state: 'visible', timeout: 10_000 });
  const startedAt = new Date().toISOString();
  const initialState = await status.getAttribute('data-state');
  if (initialState === 'ready') {
    const evidence = {
      completedAt: new Date().toISOString(),
      outcome: 'existing-lingxing-connection',
      startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
    return evidence;
  }
  if (initialState !== 'missing') {
    const evidence = {
      completedAt: new Date().toISOString(),
      failureMessage: `unexpected visible connection state: ${sanitizeDiagnosticText(initialState || 'none', 80)}`,
      outcome: 'invalid-connection-state',
      startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
    fail(
      'Package login did not expose a bindable or ready Lingxing store connection',
      evidence.failureMessage,
    );
  }

  const bindButton = page.locator(
    '[data-package-ui-evidence-action="bind-lingxing-connection"]',
  );
  await bindButton.waitFor({ state: 'visible', timeout: 10_000 });
  await bindButton.click();
  const outcomeHandle = await page.waitForFunction(() => {
    const status = document.querySelector('[data-login-connection-status]');
    const state = status?.getAttribute('data-state') || null;
    if (state === 'ready') return { kind: 'ready' };
    if (state === 'error') {
      return {
        kind: 'error',
        message: status?.textContent || 'visible Lingxing connection binding failed',
      };
    }
    return null;
  }, undefined, { timeout: 10_000 });
  const outcome = await outcomeHandle.jsonValue();
  if (outcome?.kind !== 'ready') {
    const evidence = {
      completedAt: new Date().toISOString(),
      failureMessage: sanitizeDiagnosticText(
        outcome?.message || 'unknown visible connection binding failure',
        500,
      ),
      outcome: 'binding-failed',
      startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
    fail(
      'Could not bind the isolated evidence store to the visible saved Lingxing account label',
      evidence.failureMessage,
    );
  }
  const evidence = {
    completedAt: new Date().toISOString(),
    outcome: 'bound-isolated-evidence-lingxing-connection',
    startedAt,
  };
  if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
  return evidence;
}

function selectDeterministicEvidenceStoreCandidate(options) {
  if (!Array.isArray(options)) return null;
  for (const selected of [true, false]) {
    for (const option of options) {
      if (Boolean(option?.selected) !== selected || option?.disabled === true) continue;
      const value = String(option?.value || '').trim();
      if (!value) continue;
      return {
        label: sanitizeDiagnosticText(option?.label || '', 160),
        value,
      };
    }
  }
  return null;
}

function boundedEvidenceStoreReference(candidate, createdEvidenceStore) {
  if (!candidate?.value) return null;
  return {
    displayName: createdEvidenceStore ? PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME : null,
    idLength: candidate.value.length,
    idSha256: sha256Buffer(Buffer.from(candidate.value, 'utf8')),
  };
}

async function waitForPackageEntrySurface(page, timeoutMs = 30_000) {
  const handle = await page.waitForFunction(() => {
    if (document.querySelector('nav[aria-label="主业务导航"]')) return { kind: 'workspace' };
    if (
      document.querySelector('button.login-submit-button')
      || Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.trim() === '登录并进入 Ads')
    ) {
      return { kind: 'login' };
    }
    const storeGate = document.querySelector('.mission-control-store-gate-shell');
    if (storeGate?.getAttribute('data-state') === 'needs-selection') {
      return { kind: 'store-gate' };
    }
    if (storeGate?.getAttribute('data-state') === 'error') {
      return {
        kind: 'store-gate-error',
        message: storeGate.querySelector('[role="alert"]')?.textContent || '',
      };
    }
    return null;
  }, undefined, { timeout: timeoutMs });
  return handle.jsonValue();
}

async function openPackageStoreScopeSwitcher(page) {
  const dialog = page.getByRole('dialog', { name: '店铺与站点选择器' });
  if (!await dialog.isVisible().catch(() => false)) {
    const trigger = page.locator(
      'section[aria-label="店铺与站点"] .store-scope-switcher__trigger',
    ).first();
    await trigger.waitFor({ state: 'visible', timeout: 10_000 });
    await trigger.click();
  }
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  return dialog;
}

async function packageStoreOptionById(page, storeId) {
  const dialog = await openPackageStoreScopeSwitcher(page);
  const options = dialog.locator('.store-scope-switcher__option[data-store-scope-id]');
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if (await option.getAttribute('data-store-scope-id') === storeId) return option;
  }
  return null;
}

async function ensureEvidenceStoreContext(page, diagnostics) {
  const storeGateDiagnostics = beginStoreGateDiagnostics(diagnostics);
  const storeDialog = await openPackageStoreScopeSwitcher(page);
  const storeOptions = storeDialog.locator(
    '.store-scope-switcher__option[data-store-scope-id]',
  );
  const candidates = await storeOptions.evaluateAll((options) => options.map((option) => ({
    disabled: option instanceof HTMLButtonElement ? option.disabled : true,
    label: option.querySelector('strong')?.textContent || '',
    selected: option.getAttribute('aria-selected') === 'true',
    value: option.getAttribute('data-store-scope-id') || '',
  })));

  let candidate = selectDeterministicEvidenceStoreCandidate(candidates);
  let createdEvidenceStore = false;
  let switchButton = null;
  if (!candidate) {
    const addButton = storeDialog.getByRole('button', { name: '新增店铺', exact: true });
    await addButton.click();
    const createDialog = page.getByRole('dialog', { name: '新增美国站店铺' });
    const storeNameInput = createDialog.getByRole('textbox', { name: '店铺名称', exact: true });
    const createButton = createDialog.getByRole('button', { name: '创建店铺', exact: true });
    await storeNameInput.waitFor({ state: 'visible', timeout: 10_000 });
    await storeNameInput.fill(PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME);
    await createButton.waitFor({ state: 'visible', timeout: 10_000 });
    await createButton.click();
    const creationHandle = await page.waitForFunction((displayName) => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="store-scope-create-title"]');
      const error = dialog?.querySelector('.store-scope-create-feedback [role="alert"]');
      if (error?.textContent?.trim()) {
        return { kind: 'error', message: error.textContent.trim() };
      }
      const switchButton = dialog?.querySelector('button[data-store-scope-id]');
      const storeId = switchButton?.getAttribute('data-store-scope-id') || '';
      return storeId && dialog?.textContent?.includes(`${displayName} 已创建`)
        ? { kind: 'created', label: displayName, value: storeId }
        : null;
    }, PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME, { timeout: 15_000 });
    const creation = await creationHandle.jsonValue();
    if (creation?.kind !== 'created') {
      completeStoreGateDiagnostics(storeGateDiagnostics, 'creation-failed', {
        failureMessage: sanitizeDiagnosticText(creation?.message || 'unknown store creation failure', 500),
      });
      fail(
        'Could not create the isolated Package UI evidence store through the visible Store Gate',
        sanitizeDiagnosticText(creation?.message || 'unknown store creation failure', 500),
      );
    }
    candidate = selectDeterministicEvidenceStoreCandidate([creation]);
    createdEvidenceStore = true;
    switchButton = createDialog.locator('button[data-store-scope-id]').filter({
      hasText: '切换到新店铺',
    }).first();
  }
  if (!candidate) {
    completeStoreGateDiagnostics(storeGateDiagnostics, 'selection-failed');
    fail('Store Gate did not expose an active US/USD store for the isolated Package UI profile.');
  }

  if (!switchButton) switchButton = await packageStoreOptionById(page, candidate.value);
  if (!switchButton) {
    completeStoreGateDiagnostics(storeGateDiagnostics, 'selection-failed');
    fail('Store Gate option disappeared before the explicit switch action.');
  }

  const selectedStore = boundedEvidenceStoreReference(candidate, createdEvidenceStore);
  await switchButton.waitFor({ state: 'visible', timeout: 10_000 });
  await switchButton.click();
  const outcomeHandle = await page.waitForFunction(() => {
    if (document.querySelector('nav[aria-label="主业务导航"]')) return { kind: 'workspace' };
    if (
      document.querySelector('button.login-submit-button')
      || Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.trim() === '登录并进入 Ads')
    ) {
      return { kind: 'login' };
    }
    const storeGate = document.querySelector('.mission-control-store-gate-shell');
    if (storeGate?.getAttribute('data-state') === 'error') {
      return {
        kind: 'store-gate-error',
        message: storeGate.querySelector('[role="alert"]')?.textContent || '',
      };
    }
    return null;
  }, undefined, { timeout: 15_000 });
  const outcome = await outcomeHandle.jsonValue();
  if (outcome?.kind === 'store-gate-error') {
    completeStoreGateDiagnostics(storeGateDiagnostics, 'switch-failed', {
      createdEvidenceStore,
      failureMessage: sanitizeDiagnosticText(outcome.message || 'unknown store switch failure', 500),
      selectedStore,
    });
    fail(
      'Could not enter the explicitly selected isolated Package UI evidence store',
      sanitizeDiagnosticText(outcome.message || 'unknown store switch failure', 500),
    );
  }
  completeStoreGateDiagnostics(
    storeGateDiagnostics,
    createdEvidenceStore
      ? 'created-and-selected-isolated-evidence-store'
      : 'selected-existing-store',
    {
      createdEvidenceStore,
      selectedStore,
      resultingSurface: outcome?.kind || null,
    },
  );
  return {
    createdEvidenceStore,
    currency: 'USD',
    marketplace: 'US',
    outcome: storeGateDiagnostics?.outcome || (
      createdEvidenceStore
        ? 'created-and-selected-isolated-evidence-store'
        : 'selected-existing-store'
    ),
    selectedStore,
  };
}

async function collectEvidenceStoreAuthorityReadback(page, storeGate) {
  const shell = page.locator('.mission-control-shell[data-store-context]');
  await shell.waitFor({ state: 'visible', timeout: 10_000 });
  const storeId = String(await shell.getAttribute('data-store-context') || '').trim();
  const actualIdSha256 = storeId ? sha256Buffer(Buffer.from(storeId, 'utf8')) : null;
  const expectedIdSha256 = storeGate?.selectedStore?.idSha256 || null;
  return {
    actualIdSha256,
    expectedIdSha256,
    marketplace: storeGate?.marketplace || null,
    currency: storeGate?.currency || null,
    passed: Boolean(
      actualIdSha256
      && actualIdSha256 === expectedIdSha256
      && storeGate?.marketplace === 'US'
      && storeGate?.currency === 'USD'
    ),
  };
}

  return {
    ensureEvidenceLingxingConnection,
    selectDeterministicEvidenceStoreCandidate,
    boundedEvidenceStoreReference,
    waitForPackageEntrySurface,
    openPackageStoreScopeSwitcher,
    packageStoreOptionById,
    ensureEvidenceStoreContext,
    collectEvidenceStoreAuthorityReadback,
  };
};
