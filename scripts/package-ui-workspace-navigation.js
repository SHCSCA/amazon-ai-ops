// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_PACKAGE_UI_MODULES,
    EXPECTED_PACKAGE_UI_WORKSPACES,
  } = dependencies;
  const decisionsTabAccessibleNamePattern = (...args) => dependencies.decisionsTabAccessibleNamePattern(...args);
  const fail = (...args) => dependencies.fail(...args);
  const hasAuthenticatedWorkspace = (...args) => dependencies.hasAuthenticatedWorkspace(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const validateWorkspaceTabKeyboardEvidence = (...args) => dependencies.validateWorkspaceTabKeyboardEvidence(...args);

async function waitForNavigationIdle(page) {
  await page.waitForFunction(() => {
    const nav = document.querySelector('nav[aria-label="主业务导航"]');
    return Boolean(nav) && nav.getAttribute('aria-busy') !== 'true';
  }, undefined, { timeout: 10_000 });
}

async function waitForRendererComposite(page, electronApp, requiredLocator) {
  if (requiredLocator) {
    await requiredLocator.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      throw new Error('No live packaged BrowserWindow is available for composite settling.');
    }
    if (typeof window.webContents.invalidate === 'function') {
      window.webContents.invalidate();
    }
  });
  await page.waitForTimeout(180);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const requiredVisible = requiredLocator ? await requiredLocator.isVisible() : true;
  if (!requiredVisible) fail('Required packaged UI surface disappeared while the compositor settled.');
  return { passed: true, requiredVisible };
}

async function collectWorkspaceSettleSnapshot(page, selector) {
  return page.evaluate(({ rootSelector, busyTokens }) => {
    const root = document.querySelector(rootSelector);
    const visible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const liveCandidates = Array.from(document.querySelectorAll([
      '[aria-busy="true"]',
      '.button-loading',
      '.route-handoff-feedback',
      'button',
      '[role="status"]',
      '[aria-live]',
    ].join(','))).filter(visible);
    const busyLabels = liveCandidates
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => busyTokens.some((token) => text.includes(token)));
    const normalizedText = (root?.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      busyCount: liveCandidates.filter((node) => node.matches('[aria-busy="true"], .button-loading, .route-handoff-feedback')).length,
      busyLabels,
      navigationBusy: document.querySelector('nav[aria-label="主业务导航"]')?.getAttribute('aria-busy') === 'true',
      rootVisible: Boolean(root && visible(root)),
      routeHandoffVisible: Array.from(document.querySelectorAll('.route-handoff-feedback')).some(visible),
      text: normalizedText,
    };
  }, {
    busyTokens: ['加载中', '正在载入', '正在刷新', '刷新中', '转跳中', '处理中'],
    rootSelector: selector,
  });
}

async function waitForWorkspaceSettled(page, selector, settleMs) {
  const minimumWaitMs = Math.max(Number(settleMs || 0), 2_500);
  await page.waitForTimeout(minimumWaitMs);
  const startedAt = Date.now();
  const timeoutMs = 20_000;
  let previousText = null;
  let stableSamples = 0;
  let sampleCount = 0;
  let latest = null;
  while (Date.now() - startedAt <= timeoutMs) {
    latest = await collectWorkspaceSettleSnapshot(page, selector);
    sampleCount += 1;
    const idle = latest.rootVisible
      && !latest.navigationBusy
      && !latest.routeHandoffVisible
      && latest.busyCount === 0
      && latest.busyLabels.length === 0
      && latest.text.length > 0;
    stableSamples = idle && latest.text === previousText ? stableSamples + 1 : 0;
    if (stableSamples >= 3) {
      return {
        busyCount: latest.busyCount,
        busyLabels: latest.busyLabels,
        minimumWaitMs,
        passed: true,
        sampleCount,
        stableSamples,
        textLength: latest.text.length,
        textSha256: sha256Buffer(Buffer.from(latest.text, 'utf8')),
      };
    }
    previousText = latest.text;
    await page.waitForTimeout(400);
  }
  fail('Packaged workspace did not reach a stable non-busy state', JSON.stringify({
    ...latest,
    text: undefined,
    sampleCount,
    stableSamples,
  }));
}

async function selectSidebarEntry(page, expected) {
  await waitForNavigationIdle(page);
  const expand = page.getByRole('button', { name: '展开主导航', exact: true });
  if (await expand.isVisible()) await expand.click();
  const module = EXPECTED_PACKAGE_UI_MODULES.find((item) => item.workspaces.includes(expected.workspace));
  if (!module) fail('Workspace has no canonical module', expected.workspace);
  const button = page.locator(`.app-sidebar [data-operator-module="${module.id}"]`);
  if (await button.count() !== 1) fail('Expected exactly one sidebar module button', module.id);
  if (await button.getAttribute('aria-expanded') !== 'true') {
    await button.click();
    await waitForNavigationIdle(page);
  }
  const entry = page.locator(`.app-sidebar [data-operator-entry="${expected.workspace}/${expected.subview}"]`);
  if (await entry.count() !== 1) fail('Expected exactly one sidebar entry', `${expected.workspace}/${expected.subview}`);
  if (await entry.getAttribute('aria-current') !== 'page') await entry.click();
  await waitForNavigationIdle(page);
}

async function navigateToWorkspace(page, expected, settleMs, options = {}) {
  await selectSidebarEntry(page, expected);
  if (expected.tabLabel) {
    const tab = page.getByRole('tab', { name: decisionsTabAccessibleNamePattern(expected.tabLabel) });
    await tab.waitFor({ state: 'visible', timeout: 10_000 });
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  }
  const selector = `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${expected.subview}"]`;
  await page.locator(selector).waitFor({ state: 'visible', timeout: 15_000 });
  await waitForNavigationIdle(page);
  // 采集器可显式恢复其滚动位置；默认导航继续核验现有位置。
  if (options.resetScroll === true) {
    await restoreWorkspaceScrollTop(page);
  } else {
    await page.waitForFunction(() => {
      const content = document.querySelector('.app-content');
      return Boolean(content) && Math.abs(content.scrollTop) <= 1;
    }, undefined, { timeout: 10_000 });
  }
  if (options.deferSettle === true) return null;
  return waitForWorkspaceSettled(page, selector, settleMs);
}

async function restoreWorkspaceScrollTop(page) {
  const position = await page.evaluate(() => {
    const content = document.querySelector('.app-content');
    if (!(content instanceof HTMLElement)) return null;
    const before = content.scrollTop;
    content.scrollTop = 0;
    return {
      after: content.scrollTop,
      before,
    };
  });
  if (!position) {
    fail('Shared workspace scroll owner is unavailable before capture');
  }
  await page.waitForFunction(() => {
    const content = document.querySelector('.app-content');
    return Boolean(content) && Math.abs(content.scrollTop) <= 1;
  }, undefined, { timeout: 10_000 });
  return position;
}

async function workspaceTabKeyboardSnapshot(page, expected) {
  return page.evaluate((settings) => {
    const root = document.querySelector(
      `[data-workspace-evidence-root][data-workspace="${settings.workspace}"]`,
    );
    const tabs = root
      ? Array.from(root.querySelectorAll(':scope > .workspace-subview-shell__navigation [role="tab"]'))
      : [];
    const subviewFor = (tab) => {
      const prefix = `${settings.workspace}-workspace-tab-`;
      return tab?.id?.startsWith(prefix) ? tab.id.slice(prefix.length) : null;
    };
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    const focused = tabs.find((tab) => tab === document.activeElement) || null;
    return {
      activeSubview: root?.getAttribute('data-workspace-subview') || null,
      focusedSubview: subviewFor(focused),
      selectedCount: selected.length,
      selectedSubview: subviewFor(selected[0] || null),
      tabCount: tabs.length,
    };
  }, expected);
}

async function waitForWorkspaceSubview(page, workspace, subview) {
  const selector = `[data-workspace-evidence-root][data-workspace="${workspace}"][data-workspace-subview="${subview}"]`;
  await page.locator(selector).waitFor({ state: 'visible', timeout: 15_000 });
  await waitForNavigationIdle(page);
}

async function exerciseWorkspaceTabKeyboard(page, expected) {
  const root = page.locator(
    `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${expected.subview}"]`,
  );
  const activeTab = root.locator(':scope > .workspace-subview-shell__navigation [role="tab"][aria-selected="true"]');
  if (await activeTab.count() !== 1) {
    fail('Workspace must expose one selected canonical subview tab before keyboard evidence', expected.workspace);
  }
  await activeTab.focus();
  const initial = await workspaceTabKeyboardSnapshot(page, expected);
  const endSubview = expected.tabs[expected.tabs.length - 1];
  await page.keyboard.press('End');
  await waitForWorkspaceSubview(page, expected.workspace, endSubview);
  const end = await workspaceTabKeyboardSnapshot(page, expected);
  await page.keyboard.press('Home');
  await waitForWorkspaceSubview(page, expected.workspace, expected.tabs[0]);
  for (let index = 1; index <= expected.tabs.indexOf(expected.subview); index += 1) {
    await page.keyboard.press('ArrowRight');
    await waitForWorkspaceSubview(page, expected.workspace, expected.tabs[index]);
  }
  const restored = await workspaceTabKeyboardSnapshot(page, expected);
  const evidence = validateWorkspaceTabKeyboardEvidence({
    initial,
    end,
    restored,
  }, expected);
  if (!evidence.passed) {
    fail('Workspace canonical subview keyboard evidence failed', `${expected.workspace}: ${JSON.stringify(evidence.violations)}`);
  }
  return evidence;
}

async function reloadAuthenticatedWorkspaceForSubviewEvidence(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!await hasAuthenticatedWorkspace(page, 15_000)) {
    fail(
      'Read-only subview reload did not restore the authenticated workspace with a valid Main session attestation',
    );
  }
  await waitForNavigationIdle(page);
}

async function prepareReadOnlySubviewNavigationBoundary(page, expected, settleMs) {
  const boundaryWorkspace = EXPECTED_PACKAGE_UI_WORKSPACES.find(
    (candidate) => candidate.workspace !== expected.workspace,
  );
  if (!boundaryWorkspace) {
    fail(
      'Read-only subview requires a distinct canonical workspace navigation boundary',
      `${expected.workspace}/${expected.subview}`,
    );
  }
  await navigateToWorkspace(page, boundaryWorkspace, settleMs);
}

async function navigateToReadOnlySubview(page, expected, settleMs) {
  const defaultWorkspace = EXPECTED_PACKAGE_UI_WORKSPACES.find(
    (workspace) => workspace.workspace === expected.workspace,
  );
  if (!defaultWorkspace) {
    fail('Read-only subview has no canonical workspace navigation entry', `${expected.workspace}/${expected.subview}`);
  }
  await navigateToWorkspace(page, defaultWorkspace, settleMs);
  const root = page.locator(
    `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${defaultWorkspace.subview}"]`,
  );
  const tab = root.locator(`#${expected.tabId}`);
  if (await tab.count() !== 1) {
    fail('Read-only subview must expose one exact canonical tab', `${expected.workspace}/${expected.subview}`);
  }
  await tab.click();
  await waitForWorkspaceSubview(page, expected.workspace, expected.subview);
  await page.waitForFunction(() => {
    const content = document.querySelector('.app-content');
    return Boolean(content) && Math.abs(content.scrollTop) <= 1;
  }, undefined, { timeout: 10_000 });
  const selector = `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${expected.subview}"]`;
  return waitForWorkspaceSettled(page, selector, settleMs);
}

  return {
    waitForNavigationIdle,
    waitForRendererComposite,
    collectWorkspaceSettleSnapshot,
    waitForWorkspaceSettled,
    selectSidebarEntry,
    navigateToWorkspace,
    restoreWorkspaceScrollTop,
    workspaceTabKeyboardSnapshot,
    waitForWorkspaceSubview,
    exerciseWorkspaceTabKeyboard,
    reloadAuthenticatedWorkspaceForSubviewEvidence,
    prepareReadOnlySubviewNavigationBoundary,
    navigateToReadOnlySubview,
  };
};
