// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_PACKAGE_UI_WORKSPACES,
    OVERLAY_FOCUSABLE_SELECTOR,
    path,
  } = dependencies;
  const captureViewportScreenshot = (...args) => dependencies.captureViewportScreenshot(...args);
  const decisionsTabAccessibleNamePattern = (...args) => dependencies.decisionsTabAccessibleNamePattern(...args);
  const fail = (...args) => dependencies.fail(...args);
  const navigateToWorkspace = (...args) => dependencies.navigateToWorkspace(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const screenshotRecord = (...args) => dependencies.screenshotRecord(...args);
  const validateOverlayKeyboardEvidence = (...args) => dependencies.validateOverlayKeyboardEvidence(...args);
  const validateOverlayTriggerContract = (...args) => dependencies.validateOverlayTriggerContract(...args);
  const waitForRendererComposite = (...args) => dependencies.waitForRendererComposite(...args);
  const waitForWorkspaceSettled = (...args) => dependencies.waitForWorkspaceSettled(...args);

async function elementDescriptor(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof Element)) return null;
    return {
      ariaLabel: element.getAttribute('aria-label'),
      evidenceBoundary: element.getAttribute('data-package-ui-focus-boundary'),
      evidenceTrigger: element.getAttribute('data-package-ui-evidence-trigger'),
      id: element.id || null,
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    };
  });
}

async function overlayElementDescriptor(page, dialog) {
  const descriptor = await elementDescriptor(page);
  const insideDialog = await dialog.evaluate((node) => node.contains(document.activeElement));
  return descriptor ? { ...descriptor, insideDialog } : { insideDialog };
}

async function exerciseOverlayFocus(page, options) {
  const trigger = options.trigger;
  const triggerCount = await trigger.count();
  const triggerState = triggerCount === 1
    ? await trigger.evaluate((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        actionId: node.getAttribute('data-action-id') || node.getAttribute('data-action'),
        ariaDisabled: node.getAttribute('aria-disabled'),
        disabled: node.matches(':disabled'),
        rendered: style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0,
        tagName: node.tagName.toLowerCase(),
      };
    })
    : {};
  const triggerContract = validateOverlayTriggerContract({
    ...triggerState,
    expectedActionId: options.expectedActionId,
    triggerCount,
  });
  if (!triggerContract.passed) {
    fail('Overlay trigger failed the read-only pre-click contract', `${options.id}: ${JSON.stringify(triggerContract.violations)}`);
  }
  const triggerMarker = `${options.id}-${options.scalePercent}`;
  await trigger.evaluate((node, marker) => node.setAttribute('data-package-ui-evidence-trigger', marker), triggerMarker);
  await trigger.focus();
  const triggerBefore = await elementDescriptor(page);
  await trigger.click();
  const dialog = options.dialogLocator
    || page.getByRole('dialog', { name: options.dialogName, exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  if (await dialog.count() !== 1) fail('Expected exactly one named overlay dialog', options.id);
  await page.waitForTimeout(80);
  const initialFocus = await elementDescriptor(page);
  const overlayState = await dialog.evaluate((node, focusableSelector) => {
    const rendered = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.matches(':disabled')
        && element.getAttribute('aria-disabled') !== 'true'
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const focusables = Array.from(node.querySelectorAll(focusableSelector)).filter(rendered);
    focusables.forEach((element) => element.removeAttribute('data-package-ui-focus-boundary'));
    if (focusables.length === 1) {
      focusables[0].setAttribute('data-package-ui-focus-boundary', 'single');
    } else {
      focusables[0]?.setAttribute('data-package-ui-focus-boundary', 'first');
      focusables[focusables.length - 1]?.setAttribute('data-package-ui-focus-boundary', 'last');
    }
    const idCounts = new Map();
    for (const element of Array.from(document.querySelectorAll('[id]'))) {
      if (!element.id) continue;
      idCounts.set(element.id, (idCounts.get(element.id) || 0) + 1);
    }
    const duplicateIds = Array.from(idCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
    const brokenReferences = [];
    const referenceAttributes = [
      'aria-labelledby',
      'aria-describedby',
      'aria-controls',
      'aria-owns',
      'aria-flowto',
      'aria-activedescendant',
    ];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of referenceAttributes) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        for (const token of value.trim().split(/\s+/).filter(Boolean)) {
          const count = idCounts.get(token) || 0;
          if (count !== 1) brokenReferences.push({ attribute, token, count });
        }
      }
    }
    return {
      ariaModal: node.getAttribute('aria-modal'),
      brokenReferences,
      duplicateIds,
      focusableCount: focusables.length,
      initialFocusInside: node.contains(document.activeElement),
      inspectorMode: node.getAttribute('data-inspector-mode'),
    };
  }, OVERLAY_FOCUSABLE_SELECTOR);
  if (!overlayState.initialFocusInside) fail('Overlay did not move initial focus inside', options.id);
  if (overlayState.focusableCount === 0) fail('Overlay exposes no enabled focusable control for keyboard evidence', options.id);
  if (overlayState.ariaModal !== 'true') fail('Overlay is not aria-modal', options.id);
  if (overlayState.duplicateIds.length > 0) fail('Overlay introduced duplicate DOM ids', `${options.id}: ${JSON.stringify(overlayState.duplicateIds)}`);
  if (overlayState.brokenReferences.length > 0) fail('Overlay introduced broken ARIA references', `${options.id}: ${JSON.stringify(overlayState.brokenReferences)}`);
  if (options.expectedInspectorMode && overlayState.inspectorMode !== options.expectedInspectorMode) {
    fail('Responsive inspector mode mismatch', `${options.id}: ${overlayState.inspectorMode}`);
  }

  let keyboardStartFocus;
  let backwardFocus;
  let forwardFocus;
  if (overlayState.focusableCount === 1) {
    const singleControl = dialog.locator('[data-package-ui-focus-boundary="single"]');
    if (await singleControl.count() !== 1) fail('Single-control overlay boundary marker is missing or ambiguous', options.id);
    await singleControl.focus();
    keyboardStartFocus = await overlayElementDescriptor(page, dialog);
    await page.keyboard.press('Shift+Tab');
    backwardFocus = await overlayElementDescriptor(page, dialog);
    await page.keyboard.press('Tab');
    forwardFocus = await overlayElementDescriptor(page, dialog);
  } else {
    await dialog.locator('[data-package-ui-focus-boundary="first"]').focus();
    keyboardStartFocus = await overlayElementDescriptor(page, dialog);
    await page.keyboard.press('Shift+Tab');
    backwardFocus = await overlayElementDescriptor(page, dialog);

    await dialog.locator('[data-package-ui-focus-boundary="last"]').focus();
    await page.keyboard.press('Tab');
    forwardFocus = await overlayElementDescriptor(page, dialog);
  }
  const keyboardEvidence = validateOverlayKeyboardEvidence({
    backwardFocus,
    focusableCount: overlayState.focusableCount,
    forwardFocus,
  });
  if (!keyboardEvidence.passed) {
    fail('Overlay keyboard focus contract failed', `${options.id}: ${JSON.stringify(keyboardEvidence.violations)}`);
  }
  const backwardWrapped = keyboardEvidence.multiControlEvidence?.backwardWrapped ?? null;
  const forwardWrapped = keyboardEvidence.multiControlEvidence?.forwardWrapped ?? null;
  const singleControlEvidence = keyboardEvidence.mode === 'single-control'
    ? {
      ...keyboardEvidence.singleControlEvidence,
      focusBeforeKeys: keyboardStartFocus,
      shiftTabFocus: backwardFocus,
      tabFocus: forwardFocus,
    }
    : null;

  const requiredContent = [];
  for (const text of options.requiredTexts || []) {
    const matches = dialog.getByText(text, { exact: true });
    const count = await matches.count();
    requiredContent.push({ text, count });
    if (count < 1) fail('Required overlay content is missing', `${options.id}: ${text}`);
  }
  if (options.screenshotAnchor) {
    if (await options.screenshotAnchor.count() !== 1) {
      fail('Expected exactly one screenshot anchor in overlay', options.id);
    }
    await options.screenshotAnchor.scrollIntoViewIfNeeded();
  }

  const compositeEvidence = await waitForRendererComposite(page, options.electronApp, dialog);
  const overlayVisibleBeforeCapture = await dialog.isVisible();
  if (!overlayVisibleBeforeCapture) fail('Overlay disappeared before screenshot capture', options.id);
  const screenshotPath = path.join(options.runDir, `${options.scalePercent}-${safeSegment(options.id)}.png`);
  const screenshotCapture = await captureViewportScreenshot(options.electronApp, screenshotPath);
  const overlayVisibleAfterCapture = await dialog.isVisible();
  if (!overlayVisibleAfterCapture) fail('Overlay disappeared during screenshot capture', options.id);
  const screenshot = screenshotRecord(screenshotPath, {
    capture: screenshotCapture,
    overlayId: options.id,
    scalePercent: options.scalePercent,
  });

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(async () => {
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const focusAfterEscape = await elementDescriptor(page);
  const focusRestored = focusAfterEscape?.evidenceTrigger === triggerMarker;
  if (!focusRestored) fail('Escape did not restore focus to the overlay trigger', options.id);
  await page.locator(`[data-package-ui-evidence-trigger="${triggerMarker}"]`).evaluate((node) => {
    node.removeAttribute('data-package-ui-evidence-trigger');
  }).catch(() => undefined);

  return {
    id: options.id,
    passed: true,
    triggerContract,
    triggerState,
    triggerBefore,
    initialFocus,
    overlayState,
    requiredContent,
    keyboardMode: keyboardEvidence.mode,
    keyboardStartFocus,
    backwardFocus,
    backwardWrapped,
    forwardFocus,
    forwardWrapped,
    singleControlEvidence,
    focusAfterEscape,
    focusRestored,
    compositeEvidence,
    overlayVisibleAfterCapture,
    overlayVisibleBeforeCapture,
    screenshot,
  };
}

async function runOverlayChecks(page, runOptions) {
  const collection = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'collection');
  await navigateToWorkspace(page, collection, runOptions.settleMs);
  await page.getByRole('tab', { name: /采集任务/ }).click();
  const reportRootSelector = '[data-workspace-evidence-root][data-workspace="collection"][data-workspace-subview="reports"]';
  await page.locator(reportRootSelector).waitFor({ state: 'visible', timeout: 10_000 });
  await waitForWorkspaceSettled(page, reportRootSelector, runOptions.settleMs);
  const reportCheck = await exerciseOverlayFocus(page, {
    dialogName: '调整本次下载/重建的报表',
    electronApp: runOptions.electronApp,
    id: 'report-selector-dialog',
    runDir: runOptions.runDir,
    scalePercent: runOptions.scalePercent,
    trigger: page.getByRole('button', { name: '调整', exact: true }),
  });

  const decisions = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'decisions');
  await navigateToWorkspace(page, decisions, runOptions.settleMs);
  const decisionsTab = page.locator('#decisions-workspace-tab-recommendations');
  if (await decisionsTab.count() !== 1) {
    fail('Expected exactly one canonical Decisions recommendations tab');
  }
  await decisionsTab.waitFor({ state: 'visible', timeout: 10_000 });
  if (await decisionsTab.getAttribute('role') !== 'tab') {
    fail('Canonical Decisions recommendations target is not a tab');
  }
  const decisionsTabText = String(await decisionsTab.innerText()).replace(/\s+/g, ' ').trim();
  if (!decisionsTabAccessibleNamePattern('待判断').test(decisionsTabText)) {
    fail('Canonical Decisions recommendations tab has an unexpected visible identity', decisionsTabText);
  }
  await decisionsTab.click();
  const recommendationsRootSelector = '[data-workspace-evidence-root][data-workspace="decisions"][data-workspace-subview="recommendations"]';
  await page.locator(recommendationsRootSelector).waitFor({ state: 'visible', timeout: 10_000 });
  await waitForWorkspaceSettled(page, recommendationsRootSelector, runOptions.settleMs);
  const decisionsCheck = await exerciseOverlayFocus(page, {
    dialogName: '决策与审批接入边界',
    electronApp: runOptions.electronApp,
    expectedActionId: 'decision-boundary',
    expectedInspectorMode: 'drawer',
    id: 'decisions-controlled-review-inspector',
    requiredTexts: [
      '决策与审批接入边界',
      '仅展示本机安全进程返回的店铺范围和动作级能力。',
      '店铺',
      '当前店铺',
      '浏览器隔离',
      '已启用',
      '业务日期',
      '会话代次',
    ],
    runDir: runOptions.runDir,
    scalePercent: runOptions.scalePercent,
    screenshotAnchor: page.getByRole('heading', { name: '决策与审批接入边界', exact: true }),
    trigger: page.locator('[data-workspace="decisions"] .task-banner [data-action-id="decision-boundary"]'),
  });

  const execution = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'execution');
  await navigateToWorkspace(page, execution, runOptions.settleMs);
  const executionEvidenceTab = page.locator('#execution-workspace-tab-evidence');
  if (await executionEvidenceTab.count() !== 1) {
    fail('Expected exactly one canonical Execution evidence tab');
  }
  await executionEvidenceTab.waitFor({ state: 'visible', timeout: 10_000 });
  if (await executionEvidenceTab.getAttribute('role') !== 'tab') {
    fail('Canonical Execution evidence target is not a tab');
  }
  const executionEvidenceTabText = String(await executionEvidenceTab.innerText()).replace(/\s+/g, ' ').trim();
  if (!decisionsTabAccessibleNamePattern('执行回读').test(executionEvidenceTabText)) {
    fail('Canonical Execution evidence tab has an unexpected visible identity', executionEvidenceTabText);
  }
  await executionEvidenceTab.click();
  const readbackRootSelector = '[data-workspace-evidence-root][data-workspace="execution"][data-workspace-subview="evidence"]';
  await page.locator(readbackRootSelector).waitFor({ state: 'visible', timeout: 10_000 });
  const readbackAdapterRootSelector = `${readbackRootSelector} [data-workspace-evidence-root][data-workspace="readback"][data-workspace-subview="evidence"]`;
  await page.locator(readbackAdapterRootSelector).waitFor({ state: 'visible', timeout: 10_000 });
  await waitForWorkspaceSettled(page, readbackAdapterRootSelector, runOptions.settleMs);
  const readbackCheck = await exerciseOverlayFocus(page, {
    dialogName: '技术与证据详情',
    electronApp: runOptions.electronApp,
    expectedActionId: 'open-technical-inspector',
    expectedInspectorMode: 'drawer',
    id: 'readback-technical-drawer',
    runDir: runOptions.runDir,
    scalePercent: runOptions.scalePercent,
    trigger: page.locator(`${readbackAdapterRootSelector} [data-action="open-technical-inspector"]`),
  });
  return [reportCheck, decisionsCheck, readbackCheck];
}

  return {
    elementDescriptor,
    overlayElementDescriptor,
    exerciseOverlayFocus,
    runOverlayChecks,
  };
};
