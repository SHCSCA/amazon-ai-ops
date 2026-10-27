// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    DIAGNOSTIC_MESSAGE_LIMIT,
    DIAGNOSTIC_STACK_LIMIT,
    PACKAGE_UI_VIEWPORT,
    PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS,
    PACKAGE_UI_VIEWPORT_STABILITY_MS,
    PACKAGE_UI_VIEWPORT_STATE_POLL_MS,
    PACKAGE_UI_VIEWPORT_TOLERANCE,
  } = dependencies;
  const appendRendererDiagnostic = (...args) => dependencies.appendRendererDiagnostic(...args);
  const capturePackageWorkspaceMatrix = (...args) => dependencies.capturePackageWorkspaceMatrix(...args);
  const evaluatePackageViewportContract = (...args) => dependencies.evaluatePackageViewportContract(...args);
  const fail = (...args) => dependencies.fail(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const validatePackageMinimumWindow = (...args) => dependencies.validatePackageMinimumWindow(...args);

async function setElectronViewport(electronApp, viewport, owner) {
  if (owner !== undefined && (!owner || JSON.stringify(Object.keys(owner).sort()) !== JSON.stringify([
    'electronVersion', 'mainCreationTime', 'mainPid', 'rendererCreationTime', 'rendererPid', 'url', 'windowId'])
    || !['mainPid', 'rendererPid', 'windowId'].every(field => Number.isSafeInteger(owner[field]) && owner[field] > 0)
    || owner.mainPid === owner.rendererPid || !['mainCreationTime', 'rendererCreationTime'].every(field => Number.isFinite(owner[field]) && owner[field] > 0)
    || typeof owner.url !== 'string' || !owner.url.startsWith('file:') || typeof owner.electronVersion !== 'string' || !owner.electronVersion)) {
    fail('UI_MOTION_RESTORE_OWNER_INVALID');
  }
  await electronApp.evaluate(async ({ app, BrowserWindow }, settings) => {
    const window = settings.owner ? BrowserWindow.fromId(settings.owner.windowId)
      : BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) throw new Error('No BrowserWindow available for package UI evidence.');
    const assertOwner = () => {
      if (!settings.owner) return;
      const expected = settings.owner, metrics = app.getAppMetrics();
      if (window.isDestroyed() || window.webContents.isDestroyed() || process.pid !== expected.mainPid
        || window.id !== expected.windowId || window.webContents.getOSProcessId() !== expected.rendererPid
        || window.webContents.getURL() !== expected.url || process.versions.electron !== expected.electronVersion
        || metrics.find(row => row.pid === process.pid)?.creationTime !== expected.mainCreationTime
        || metrics.find(row => row.pid === expected.rendererPid)?.creationTime !== expected.rendererCreationTime) {
        throw new Error('UI_MOTION_RESTORE_OWNED_WINDOW_REQUIRED');
      }
    };
    assertOwner();

    const delay = (milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
    const deadline = Date.now() + settings.restoreTimeoutMs;
    const waitForWindowStateExit = async (label, isActive) => {
      while (isActive()) {
        assertOwner();
        if (window.isDestroyed()) {
          throw new Error(`Package UI BrowserWindow closed while leaving ${label}.`);
        }
        if (Date.now() >= deadline) {
          throw new Error(`Package UI BrowserWindow did not leave ${label} before viewport restore timeout.`);
        }
        await delay(settings.pollMs);
      }
    };

    if (window.isMinimized()) {
      window.restore();
      await waitForWindowStateExit('minimized state', () => window.isMinimized());
    }
    if (window.isFullScreen()) {
      window.setFullScreen(false);
      await waitForWindowStateExit('full-screen state', () => window.isFullScreen());
    }
    if (window.isMaximized()) {
      window.unmaximize();
      await waitForWindowStateExit('maximized state', () => window.isMaximized());
    }

    assertOwner();
    window.setContentSize(settings.width, settings.height, false);
    let stableSince = null;
    while (Date.now() < deadline) {
      assertOwner();
      if (window.isDestroyed()) {
        throw new Error('Package UI BrowserWindow closed while restoring the viewport.');
      }
      if (window.isMinimized() || window.isFullScreen() || window.isMaximized()) {
        stableSince = null;
      } else {
        const [actualWidth, actualHeight] = window.getContentSize();
        if (Math.abs(actualWidth - settings.width) <= settings.tolerance.width
          && Math.abs(actualHeight - settings.height) <= settings.tolerance.height) {
          stableSince ??= Date.now();
          if (Date.now() - stableSince >= settings.stabilityMs) break;
        } else {
          stableSince = null;
          assertOwner();
          window.setContentSize(settings.width, settings.height, false);
        }
      }
      await delay(settings.pollMs);
    }
    if (stableSince === null || Date.now() - stableSince < settings.stabilityMs) {
      const [actualWidth, actualHeight] = window.getContentSize();
      throw new Error(
        `Package UI BrowserWindow viewport did not stabilize at ${settings.width}x${settings.height}; actual ${actualWidth}x${actualHeight}.`,
      );
    }
    assertOwner();
    window.show();
    window.focus();
  }, {
    height: viewport.height,
    pollMs: PACKAGE_UI_VIEWPORT_STATE_POLL_MS,
    restoreTimeoutMs: PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS,
    stabilityMs: PACKAGE_UI_VIEWPORT_STABILITY_MS,
    tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    width: viewport.width,
    ...(owner === undefined ? {} : { owner }),
  });
}

async function readElectronViewport(page) {
  return page.evaluate(() => ({
    deviceScaleFactor: window.devicePixelRatio,
    height: window.innerHeight,
    width: window.innerWidth,
  }));
}

async function restoreElectronViewportAfterAuthentication(
  electronApp,
  page,
  viewport,
  expectedDeviceScaleFactor,
) {
  await setElectronViewport(electronApp, viewport);
  const waitTarget = {
    dpr: expectedDeviceScaleFactor,
    tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    viewport,
  };
  try {
    await page.waitForFunction(({ viewport: target, dpr, tolerance }) => (
      Math.abs(window.innerWidth - target.width) <= tolerance.width
      && Math.abs(window.innerHeight - target.height) <= tolerance.height
      && Math.abs(window.devicePixelRatio - dpr) <= tolerance.deviceScaleFactor
    ), waitTarget, { timeout: 20_000 });
  } catch (error) {
    const actual = await readElectronViewport(page).catch(() => ({
      deviceScaleFactor: null,
      height: null,
      width: null,
    }));
    fail('Packaged viewport did not recover after authentication', JSON.stringify({
      actual,
      requested: viewport,
      timeoutError: String(error?.message || error),
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    }));
  }
  const actual = await readElectronViewport(page);
  const contract = evaluatePackageViewportContract({
    actual,
    actualDeviceScaleFactor: actual.deviceScaleFactor,
    expectedDeviceScaleFactor,
    requested: viewport,
  });
  if (!contract.passed) {
    fail('Packaged viewport contract failed after authentication', JSON.stringify(contract));
  }
  return contract;
}

function attachRendererDiagnostics(page, diagnostics, attachedPages) {
  if (!page || attachedPages.has(page)) return;
  attachedPages.add(page);
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    let location = null;
    try {
      const source = message.location();
      location = source ? {
        columnNumber: Number(source.columnNumber) || 0,
        lineNumber: Number(source.lineNumber) || 0,
        url: sanitizeDiagnosticText(source.url || '', 1_000),
      } : null;
    } catch {
      location = null;
    }
    appendRendererDiagnostic(diagnostics, 'consoleErrors', {
      at: new Date().toISOString(),
      kind: 'console-error',
      location,
      message: sanitizeDiagnosticText(message.text(), DIAGNOSTIC_MESSAGE_LIMIT),
      phase: diagnostics.phase,
    });
  });
  page.on('pageerror', (error) => {
    appendRendererDiagnostic(diagnostics, 'pageErrors', {
      at: new Date().toISOString(),
      kind: 'page-error',
      message: sanitizeDiagnosticText(error?.message || error, DIAGNOSTIC_MESSAGE_LIMIT),
      name: sanitizeDiagnosticText(error?.name || 'Error', 120),
      phase: diagnostics.phase,
      stack: sanitizeDiagnosticText(error?.stack || '', DIAGNOSTIC_STACK_LIMIT),
    });
  });
}

async function capturePackageMinimumWindow(page, electronApp, options) {
  try {
    await setElectronViewport(electronApp, PACKAGE_UI_VIEWPORT);
    const nativeWindow = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      if (!window) throw new Error('No BrowserWindow available for minimum-window evidence.');
      const [width, height] = window.getMinimumSize();
      window.setSize(width - 1, height - 1, false);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const [contentWidth, contentHeight] = window.getContentSize();
      return {
        minimum: { width, height }, attempted: { width: width - 1, height: height - 1 },
        bounds: window.getBounds(), content: { width: contentWidth, height: contentHeight },
        maximized: window.isMaximized(), fullScreen: window.isFullScreen(),
      };
    });
    await page.waitForFunction((size) => Math.abs(window.innerWidth - size.width) <= 2
      && Math.abs(window.innerHeight - size.height) <= 2, nativeWindow.content, { timeout: 5_000 });
    const viewport = await readElectronViewport(page);
    const captures = await capturePackageWorkspaceMatrix(page, electronApp, {
      ...options, profileId: '100-compact', captureId: 'minimum-100-compact', scalePercent: 100, viewport,
    });
    const evidence = { nativeWindow, viewport, ...captures };
    const validation = validatePackageMinimumWindow(evidence);
    if (!validation.passed) fail('Native minimum-window evidence failed', JSON.stringify(validation.violations));
    return { ...evidence, ...validation };
  } finally {
    await setElectronViewport(electronApp, PACKAGE_UI_VIEWPORT);
  }
}

  return {
    setElectronViewport,
    readElectronViewport,
    restoreElectronViewportAfterAuthentication,
    attachRendererDiagnostics,
    capturePackageMinimumWindow,
  };
};
