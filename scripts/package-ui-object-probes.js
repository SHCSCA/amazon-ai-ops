// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    path,
  } = dependencies;
  const captureViewportScreenshot = (...args) => dependencies.captureViewportScreenshot(...args);
  const fail = (...args) => dependencies.fail(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const screenshotRecord = (...args) => dependencies.screenshotRecord(...args);
  const validateObjectInspectorEvidence = (...args) => dependencies.validateObjectInspectorEvidence(...args);

async function collectVisibleAiRunState(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[data-ai-run-status-visible="true"]');
    if (!node) return { ariaBusy: false, observed: false, statusLabel: null, text: '', tone: null };
    const rendered = (() => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })();
    return {
      ariaBusy: node.getAttribute('aria-busy') === 'true',
      observed: rendered,
      statusLabel: (node.querySelector('.diagnosis-ai-run-inline__state')?.textContent || '').replace(/\s+/g, ' ').trim() || null,
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      tone: node.getAttribute('data-ai-run-tone'),
    };
  });
}

async function collectObjectQueueCapacityMetrics(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const queue = root?.querySelector('[data-workspace-queue-scroll]') || null;
    const table = queue?.querySelector('[aria-rowcount]') || null;
    const header = queue?.querySelector('[data-workspace-queue-header]') || null;
    const status = queue?.querySelector('.virtual-table-status') || null;
    const rows = queue ? Array.from(queue.querySelectorAll('[data-workspace-row]')) : [];
    const rowHeights = rows
      .map((row) => row.getBoundingClientRect().height)
      .filter((height) => Number.isFinite(height) && height > 0);
    const rowHeightPx = rowHeights.length > 0 ? Math.max(...rowHeights) : null;
    const clientHeight = queue?.clientHeight || 0;
    const headerHeightPx = header?.getBoundingClientRect().height || 0;
    const statusHeightPx = status?.getBoundingClientRect().height || 0;
    const availableRowViewportHeightPx = Math.max(0, clientHeight - headerHeightPx - statusHeightPx);
    const ariaRowCount = Number.parseInt(table?.getAttribute('aria-rowcount') || '', 10);
    return {
      allRowsFit: Number.isInteger(ariaRowCount)
        && ariaRowCount >= 1
        && rowHeightPx !== null
        && ariaRowCount <= Math.floor(availableRowViewportHeightPx / rowHeightPx),
      ariaRowCount: Number.isInteger(ariaRowCount) ? ariaRowCount : null,
      availableRowViewportHeightPx,
      clientHeight,
      headerHeightPx,
      rowHeightPx,
      scrollHeight: queue?.scrollHeight || 0,
      scrollable: Boolean(queue && queue.scrollHeight > queue.clientHeight + 1),
      statusHeightPx,
      visibleRowCapacity: rowHeightPx === null ? 0 : Math.floor(availableRowViewportHeightPx / rowHeightPx),
    };
  }, rootSelector);
}

function adaptiveObjectExperienceContract(baseContract, capacity) {
  const ariaRowCount = Math.max(1, Number(capacity?.ariaRowCount) || 1);
  return {
    ...baseContract,
    minAriaRowCount: 1,
    minFullyVisibleRows: Math.min(baseContract.minFullyVisibleRows, ariaRowCount),
  };
}

async function readOperationScope(page) {
  return page.evaluate(async () => {
    const api = window.electronAPI;
    if (!api || typeof api.getOperationScope !== 'function') return null;
    return api.getOperationScope();
  });
}

async function exerciseObjectInspector(page, options) {
  const workspaceRoot = page.locator(
    `[data-workspace-evidence-root][data-workspace="${options.workspace.workspace}"][data-workspace-subview="${options.workspace.subview}"]`,
  );
  const rows = workspaceRoot.locator('[data-workspace-row]');
  if (await rows.count() < 1) fail('Object workspace has no selectable virtual row', options.workspace.workspace);
  let row = rows.first();
  if (options.workspace.workspace === 'product') {
    const unlockedRows = rows.filter({ hasText: '仅查看' });
    if (await unlockedRows.count() > 0) row = unlockedRows.first();
  }
  await row.scrollIntoViewIfNeeded();
  const rowBefore = await row.evaluate((node) => ({
    ariaLabel: node.getAttribute('aria-label'),
    key: node.getAttribute('data-row-key'),
    title: (node.querySelector('.virtual-table-cell strong')?.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  if (!rowBefore.key || !rowBefore.title) fail('Selectable object row lacks a stable key or title', JSON.stringify(rowBefore));
  const operationScopeBefore = options.workspace.workspace === 'product' ? await readOperationScope(page) : undefined;
  if (options.workspace.workspace === 'product' && !operationScopeBefore) {
    fail('Product read-only evidence could not read operation scope before row selection.');
  }
  await row.focus();
  await row.press('Enter');
  const inspector = page.locator(`.responsive-inspector[data-inspector-mode="${options.expectedMode}"]`);
  await inspector.waitFor({ state: 'visible', timeout: 10_000 });
  const inspectorState = await inspector.evaluate((node) => ({
    ariaModal: node.getAttribute('aria-modal'),
    description: (node.querySelector('.responsive-inspector__description')?.textContent || '').replace(/\s+/g, ' ').trim(),
    mode: node.getAttribute('data-inspector-mode'),
    role: node.getAttribute('role'),
    title: (node.querySelector('h2')?.textContent || '').replace(/\s+/g, ' ').trim(),
    visible: true,
  }));
  const selectedAfterClick = await row.getAttribute('aria-selected') === 'true';
  const screenshotPath = path.join(
    options.runDir,
    `${safeSegment(options.profileId)}-${safeSegment(options.workspace.workspace)}-row-inspector.png`,
  );
  const screenshotCapture = await captureViewportScreenshot(options.electronApp, screenshotPath);
  const screenshot = screenshotRecord(screenshotPath, {
    capture: screenshotCapture,
    inspectorMode: options.expectedMode,
    kind: 'read-only-object-inspector',
    profileId: options.profileId,
    workspace: options.workspace.workspace,
  });
  await page.keyboard.press('Escape');
  await inspector.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.waitForFunction((rowKey) => (
    document.activeElement?.getAttribute('data-row-key') === rowKey
  ), rowBefore.key, { timeout: 10_000 });
  const focusedRowKey = await page.evaluate(() => document.activeElement?.getAttribute('data-row-key') || null);
  const operationScopeAfter = options.workspace.workspace === 'product' ? await readOperationScope(page) : undefined;
  const input = {
    escape: {
      closed: await inspector.count() === 0 || !(await inspector.isVisible().catch(() => false)),
      focusRestored: focusedRowKey === rowBefore.key,
      focusedRowKey,
    },
    expectedMode: options.expectedMode,
    inspector: inspectorState,
    operationScope: options.workspace.workspace === 'product'
      ? { before: operationScopeBefore, after: operationScopeAfter }
      : undefined,
    row: { ...rowBefore, selectedAfterClick },
    screenshot,
    workspace: options.workspace.workspace,
  };
  const evidence = validateObjectInspectorEvidence(input);
  if (!evidence.passed) fail('Read-only object inspector evidence failed', JSON.stringify(evidence.violations));
  return evidence;
}

  return {
    collectVisibleAiRunState,
    collectObjectQueueCapacityMetrics,
    adaptiveObjectExperienceContract,
    readOperationScope,
    exerciseObjectInspector,
  };
};
