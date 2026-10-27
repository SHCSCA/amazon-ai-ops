// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  } = dependencies;
  const validateSchedulerSubviewEvidence = (...args) => dependencies.validateSchedulerSubviewEvidence(...args);

async function collectSchedulerSubviewEvidence(
  page,
  ledgerBefore,
  ledgerAfter,
  expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0],
) {
  const dom = await page.evaluate((settings) => {
    const rootSelector = `[data-workspace-evidence-root][data-workspace="${settings.workspace}"][data-workspace-subview="${settings.subview}"]`;
    const roots = Array.from(document.querySelectorAll(rootSelector));
    const root = roots[0] || null;
    const visible = (node) => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const compactText = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
    const headings = root ? Array.from(root.querySelectorAll('h1')).filter(visible) : [];
    const selectedTabs = root
      ? Array.from(root.querySelectorAll(':scope > .workspace-subview-shell__navigation [role="tab"][aria-selected="true"]')).filter(visible)
      : [];
    const selectedTab = selectedTabs[0] || null;
    const selectedTabState = selectedTab?.querySelector('[data-capability-state]') || null;
    const legacyBoundaries = root
      ? Array.from(root.querySelectorAll('.legacy-adapter-boundary[data-legacy-route="scheduler"]')).filter(visible)
      : [];
    const legacyBoundary = legacyBoundaries[0] || null;
    const pages = root
      ? Array.from(root.querySelectorAll('[data-workspace-page="store-automation"]')).filter(visible)
      : [];
    const retentionControls = root
      ? Array.from(root.querySelectorAll('[data-capability-id="settings.scheduler.retention-preview"]')).filter(visible)
      : [];
    const scheduleRefreshControls = root
      ? Array.from(root.querySelectorAll(
          '[data-action-id="settings.scheduler.refresh"], [data-action-id="settings.scheduler.refresh-secondary"]',
        )).filter(visible)
      : [];
    const scheduleProjections = root
      ? Array.from(root.querySelectorAll('[aria-label="店铺自动化七状态计划"]')).filter(visible)
      : [];
    const retentionSummaries = root
      ? Array.from(root.querySelectorAll('.mission-control-retention-metrics')).filter(visible)
      : [];
    const scheduleProjection = root
      ? Array.from(root.querySelectorAll('.mission-control-automation-window')).find(visible) || null
      : null;
    const retentionSummary = retentionSummaries[0] || null;
    const schedulerErrors = root
      ? Array.from(root.querySelectorAll(
          '.mission-control-store-error[role="alert"], [data-workspace-state="error"]',
        )).filter(visible)
      : [];
    const loadingStates = root
      ? Array.from(root.querySelectorAll(
          '[data-workspace-state="loading"], [data-workspace-state="busy"]',
        )).filter(visible)
      : [];
    const busyControls = root
      ? Array.from(root.querySelectorAll('button[aria-busy="true"]')).filter(visible)
      : [];
    const shell = document.querySelector('.mission-control-shell[data-store-context]');
    const storeSummary = document.querySelector(
      '.mission-control-store-select--readonly[aria-label="当前店铺权威摘要"][data-store-id]',
    );
    const fixedScopeSurfaces = Array.from(document.querySelectorAll(
      '.mission-control-fixed-scope, .mission-control-legacy-adapter__context',
    )).filter(visible);
    const fixedScope = fixedScopeSurfaces[0] || null;
    const fixedScopeText = fixedScope
      ? Array.from(fixedScope.children)
        .filter(visible)
        .map((node) => compactText(node))
        .join(' ')
      : '';
    const fixedScopeTexts = fixedScopeSurfaces.map((surface) => Array.from(surface.children)
      .filter(visible)
      .map((node) => compactText(node))
      .join(' '));
    const previewMarkers = root
      ? Array.from(root.querySelectorAll('[data-workspace-preview-notice], [data-preview-scenario], [data-readback-mode="preview-readonly"]')).filter(visible)
      : [];
    const dialogs = Array.from(document.querySelectorAll('[role="alertdialog"]')).filter(visible);
    const confirmRunDialogs = Array.from(document.querySelectorAll('#store-automation-confirm-title'))
      .filter((node) => visible(node.closest('[role="alertdialog"]')));
    return {
      alertDialogCount: dialogs.length,
      confirmRunDialogCount: confirmRunDialogs.length,
      fixedScopeText,
      fixedScopeTexts,
      fixedScopeVisibleCount: fixedScopeSurfaces.length,
      heading: compactText(headings[0]),
      headingCount: headings.length,
      legacyBoundaryCount: legacyBoundaries.length,
      legacyCapabilityState: legacyBoundary?.getAttribute('data-capability-state') || null,
      legacyRoute: legacyBoundary?.getAttribute('data-legacy-route') || null,
      legacyStoreId: legacyBoundary?.getAttribute('data-store-id') || null,
      pageCount: pages.length,
      previewMarkerCount: previewMarkers.length + (/仅开发预览/.test(document.body?.innerText || '') ? 1 : 0),
      busyControlCount: busyControls.length,
      loadingStateCount: loadingStates.length,
      retentionBlockerCount: retentionSummary?.getAttribute('data-blocker-count') || null,
      retentionCandidateCount: retentionSummary?.getAttribute('data-candidate-count') || null,
      retentionCurrency: retentionSummary?.getAttribute('data-currency') || null,
      retentionMarketplace: retentionSummary?.getAttribute('data-marketplace') || null,
      retentionPreviewCapabilityId: retentionControls[0]?.getAttribute('data-capability-id') || null,
      retentionPreviewControlCount: retentionControls.length,
      retentionPreviewEnabledCount: retentionControls.filter((node) => !node.disabled).length,
      retentionProfileId: retentionSummary?.getAttribute('data-browser-profile-id') || null,
      retentionStoreId: retentionSummary?.getAttribute('data-store-id') || null,
      retentionSummaryCount: retentionSummaries.length,
      rootCount: roots.length,
      scheduleBusinessDate: scheduleProjection?.getAttribute('data-business-date') || null,
      scheduleCurrency: scheduleProjection?.getAttribute('data-currency') || null,
      scheduleEnabled: scheduleProjection?.getAttribute('data-schedule-enabled') || null,
      scheduleMarketplace: scheduleProjection?.getAttribute('data-marketplace') || null,
      scheduleProjectionCount: scheduleProjections.length,
      scheduleRefreshEnabledCount: scheduleRefreshControls.filter((node) => !node.disabled).length,
      scheduleState: scheduleProjection?.getAttribute('data-schedule-state') || null,
      scheduleStoreId: scheduleProjection?.getAttribute('data-store-id') || null,
      schedulerErrorCount: schedulerErrors.length,
      selectedStoreId: storeSummary?.getAttribute('data-store-id') || null,
      selectedTabCapabilityState: selectedTabState?.getAttribute('data-capability-state') || null,
      selectedTabCount: selectedTabs.length,
      selectedTabId: selectedTab?.id || null,
      shellStoreId: shell?.getAttribute('data-store-context') || null,
      subview: root?.getAttribute('data-workspace-subview') || null,
      workspace: root?.getAttribute('data-workspace') || null,
    };
  }, expected);
  return validateSchedulerSubviewEvidence({
    dom,
    ledgerAfter,
    ledgerBefore,
  }, expected);
}

  return {
    collectSchedulerSubviewEvidence,
  };
};
