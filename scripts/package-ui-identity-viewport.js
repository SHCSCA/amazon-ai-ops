// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    DEFAULT_APP_CONTENT_PATH,
    EXPECTED_PACKAGE_UI_ENTRIES,
    EXPECTED_PACKAGE_UI_MODULES,
    EXPECTED_RENDERER_ENTRY_PATH,
    PACKAGE_UI_VIEWPORT,
    PACKAGE_UI_VIEWPORT_TOLERANCE,
    fileURLToPath,
    fs,
    path,
    validateEvidenceUserDataIdentity,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const currentFileRecordMatches = (...args) => dependencies.currentFileRecordMatches(...args);
  const exactPackageUiCollection = (...args) => dependencies.exactPackageUiCollection(...args);
  const normalizeSha256 = (...args) => dependencies.normalizeSha256(...args);
  const screenshotFileTuple = (...args) => dependencies.screenshotFileTuple(...args);
  const validateWorkspaceTabKeyboardEvidence = (...args) => dependencies.validateWorkspaceTabKeyboardEvidence(...args);

function safeRealPath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function normalizedWindowsPath(filePath) {
  return safeRealPath(filePath).replace(/\\/g, '/').toLowerCase();
}

function violation(code, message, details) {
  return { code, message, ...(details === undefined ? {} : { details }) };
}

function validatePackageIdentity(input) {
  const violations = [];
  if (normalizeSha256(input.actualExeSha256, 'actualExeSha256') !== normalizeSha256(input.expectedExeSha256, 'expectedExeSha256')) {
    violations.push(violation('EXE_HASH_MISMATCH', 'The launched EXE hash does not match the explicitly approved hash.'));
  }
  if (normalizeSha256(input.actualAppContentSha256, 'actualAppContentSha256') !== normalizeSha256(input.expectedAppContentSha256, 'expectedAppContentSha256')) {
    violations.push(violation('APP_CONTENT_HASH_MISMATCH', 'The launched unpacked app-content manifest hash does not match the explicitly approved hash.'));
  }
  if (normalizedWindowsPath(input.actualExecutablePath) !== normalizedWindowsPath(input.expectedExecutablePath)) {
    violations.push(violation('EXECUTABLE_PATH_MISMATCH', 'Playwright attached to a different executable.', {
      actual: input.actualExecutablePath,
      expected: input.expectedExecutablePath,
    }));
  }
  if (normalizedWindowsPath(input.appPath) !== normalizedWindowsPath(DEFAULT_APP_CONTENT_PATH)) {
    violations.push(violation('APP_CONTENT_PATH_MISMATCH', 'Electron app.getAppPath() is not the fixed win-unpacked resources/app directory.', {
      actual: input.appPath,
      expected: DEFAULT_APP_CONTENT_PATH,
    }));
  }
  if (input.isPackaged !== true) {
    violations.push(violation('RUNTIME_NOT_PACKAGED', 'Electron runtime does not report app.isPackaged=true.'));
  }
  if (String(input.appVersion || '') !== String(input.expectedVersion || '')) {
    violations.push(violation('APP_VERSION_MISMATCH', 'Electron runtime version does not match the desktop package.', {
      actual: input.appVersion,
      expected: input.expectedVersion,
    }));
  }
  const userDataIdentity = validateEvidenceUserDataIdentity({
    actualUserDataDir: input.actualUserDataDir,
    evidenceMode: input.evidenceMode,
    expectedMode: input.expectedEvidenceMode,
    expectedUserDataDir: input.expectedUserDataDir,
  });
  violations.push(...userDataIdentity.violations.map((item) => violation(item.code, item.message, {
    actual: item.actual,
    expected: item.expected,
  })));
  let rendererUrl;
  try {
    rendererUrl = new URL(input.rendererUrl);
  } catch {
    rendererUrl = null;
  }
  if (!rendererUrl || rendererUrl.protocol !== 'file:') {
    violations.push(violation('RENDERER_NOT_FILE_URL', 'Packaged evidence must render from a file URL inside the unpacked resources/app directory.', {
      actual: input.rendererUrl,
    }));
  }
  if (rendererUrl?.protocol === 'file:') {
    let rendererPath;
    try {
      rendererPath = normalizedWindowsPath(fileURLToPath(rendererUrl));
    } catch {
      rendererPath = null;
    }
    const appContentPath = normalizedWindowsPath(DEFAULT_APP_CONTENT_PATH);
    const rendererInsideAppContent = Boolean(
      rendererPath
      && (rendererPath === appContentPath || rendererPath.startsWith(`${appContentPath}/`)),
    );
    if (!rendererInsideAppContent) {
      violations.push(violation('RENDERER_OUTSIDE_APP_CONTENT', 'Packaged file renderer must resolve inside the fixed resources/app directory.', {
        actual: input.rendererUrl,
        expectedRoot: DEFAULT_APP_CONTENT_PATH,
      }));
    } else if (rendererPath !== normalizedWindowsPath(EXPECTED_RENDERER_ENTRY_PATH)) {
      violations.push(violation('RENDERER_ENTRY_MISMATCH', 'Packaged evidence must render the fixed dist/renderer/index.html entry.', {
        actual: input.rendererUrl,
        expected: EXPECTED_RENDERER_ENTRY_PATH,
      }));
    }
  }
  if (rendererUrl && (
    rendererUrl.searchParams.get('preview') === '1'
    || rendererUrl.searchParams.has('scenario')
    || /(?:localhost|127\.0\.0\.1)/i.test(rendererUrl.hostname)
  )) {
    violations.push(violation('PREVIEW_RENDERER_FORBIDDEN', 'Preview or localhost renderer identity is forbidden for packaged evidence.', {
      actual: input.rendererUrl,
    }));
  }
  return { passed: violations.length === 0, violations };
}

function evaluatePackageViewportContract({
  actual,
  actualDeviceScaleFactor,
  expectedDeviceScaleFactor,
  requested = PACKAGE_UI_VIEWPORT,
}) {
  const finiteNumberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const normalizedActual = {
    width: finiteNumberOrNull(actual?.width),
    height: finiteNumberOrNull(actual?.height),
    deviceScaleFactor: finiteNumberOrNull(actualDeviceScaleFactor),
  };
  const normalizedRequested = {
    width: finiteNumberOrNull(requested?.width),
    height: finiteNumberOrNull(requested?.height),
    deviceScaleFactor: finiteNumberOrNull(expectedDeviceScaleFactor),
  };
  const delta = {
    width: Number.isFinite(normalizedActual.width) && Number.isFinite(normalizedRequested.width)
      ? normalizedActual.width - normalizedRequested.width
      : null,
    height: Number.isFinite(normalizedActual.height) && Number.isFinite(normalizedRequested.height)
      ? normalizedActual.height - normalizedRequested.height
      : null,
    deviceScaleFactor: Number.isFinite(normalizedActual.deviceScaleFactor) && Number.isFinite(normalizedRequested.deviceScaleFactor)
      ? normalizedActual.deviceScaleFactor - normalizedRequested.deviceScaleFactor
      : null,
  };
  const violations = [];
  if (
    !Number.isFinite(delta.width)
    || !Number.isFinite(delta.height)
    || Math.abs(delta.width) > PACKAGE_UI_VIEWPORT_TOLERANCE.width
    || Math.abs(delta.height) > PACKAGE_UI_VIEWPORT_TOLERANCE.height
  ) {
    violations.push(violation('VIEWPORT_DIMENSION_DELTA', 'Actual CSS viewport exceeds the strict Windows DPI rounding tolerance.', {
      actual: normalizedActual,
      delta,
      requested: normalizedRequested,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    }));
  }
  if (
    !Number.isFinite(delta.deviceScaleFactor)
    || Math.abs(delta.deviceScaleFactor) > PACKAGE_UI_VIEWPORT_TOLERANCE.deviceScaleFactor
  ) {
    violations.push(violation('DEVICE_SCALE_FACTOR_DELTA', 'Actual device scale factor exceeds the strict tolerance.', {
      actual: normalizedActual,
      delta,
      requested: normalizedRequested,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    }));
  }
  return {
    actual: normalizedActual,
    delta,
    passed: violations.length === 0,
    requested: normalizedRequested,
    tolerance: { ...PACKAGE_UI_VIEWPORT_TOLERANCE },
    violations,
  };
}

function validateWorkspaceRuntimeMetrics(metrics, expected, requestedViewport = PACKAGE_UI_VIEWPORT) {
  const violations = [];
  if (
    metrics.root?.count !== 1
    || metrics.root?.workspace !== expected.workspace
    || metrics.root?.subview !== expected.subview
  ) {
    violations.push(violation('WORKSPACE_IDENTITY_MISMATCH', 'The visible workspace/subview identity does not match the clicked sidebar target.', {
      actual: metrics.root,
      expected: { workspace: expected.workspace, subview: expected.subview },
    }));
  }
  if (metrics.h1?.count !== 1 || metrics.h1?.labels?.[0] !== expected.heading) {
    violations.push(violation('H1_CONTRACT', 'The workspace must expose exactly one expected visible h1.', {
      actual: metrics.h1,
      expected: expected.heading,
    }));
  }
  if (metrics.primaryAction?.count !== 1) {
    violations.push(violation('PRIMARY_ACTION_CONTRACT', 'The first viewport must expose exactly one visible primary action.', metrics.primaryAction));
  }
  const module = EXPECTED_PACKAGE_UI_MODULES.find((item) => item.workspaces.includes(expected.workspace));
  const entries = module?.workspaces.flatMap((workspace) => EXPECTED_PACKAGE_UI_ENTRIES
    .filter((item) => item.workspace === workspace).map((item) => `${workspace}/${item.subview}`));
  if (!module
    || metrics.activeNavigation?.count !== 1
    || metrics.activeNavigation?.view !== `${expected.workspace}/${expected.subview}`
    || canonicalJson(metrics.activeNavigation?.moduleIds) !== canonicalJson(EXPECTED_PACKAGE_UI_MODULES.map((item) => item.id))
    || canonicalJson(metrics.activeNavigation?.activeModuleIds) !== canonicalJson([module.id])
    || canonicalJson(metrics.activeNavigation?.entryIds) !== canonicalJson(entries)) {
    violations.push(violation('ACTIVE_NAVIGATION_CONTRACT', 'The six modules and selected module entries must match exactly, with only the clicked entry active.', {
      actual: metrics.activeNavigation,
      expected: { module: module?.id, view: `${expected.workspace}/${expected.subview}`, entries },
    }));
  }
  if ((metrics.horizontalOverflow?.violations || []).length > 0) {
    violations.push(violation('PAGE_HORIZONTAL_OVERFLOW', 'Page-level containers must not overflow horizontally.', metrics.horizontalOverflow.violations));
  }
  if (
    metrics.scrollOwnership?.defaultOwner?.matchCount !== 1
    || metrics.scrollOwnership?.defaultOwner?.declared !== true
  ) {
    violations.push(violation('DEFAULT_SCROLL_OWNER', '.app-content must remain the single declared workspace scroll owner.', metrics.scrollOwnership?.defaultOwner));
  }
  const workspaceScrollTop = Number(metrics.scrollOwnership?.defaultOwner?.scrollTop);
  if (!Number.isFinite(workspaceScrollTop) || Math.abs(workspaceScrollTop) > 1) {
    violations.push(violation('WORKSPACE_NOT_AT_TOP', 'Every workspace capture must start at the top of the shared .app-content scroll owner.', {
      scrollTop: metrics.scrollOwnership?.defaultOwner?.scrollTop ?? null,
    }));
  }
  if ((metrics.scrollOwnership?.unlabelledActiveOwners || []).length > 0) {
    violations.push(violation('UNLABELLED_SCROLL_OWNER', 'Active nested vertical scroll owners must be explicitly labelled exceptions.', metrics.scrollOwnership.unlabelledActiveOwners));
  }
  if ((metrics.aria?.duplicateIds || []).length > 0) {
    violations.push(violation('DUPLICATE_DOM_ID', 'DOM ids referenced by accessibility relationships must be unique.', metrics.aria.duplicateIds));
  }
  if ((metrics.aria?.brokenReferences || []).length > 0) {
    violations.push(violation('BROKEN_ARIA_REFERENCE', 'ARIA id references must resolve to an existing unique element.', metrics.aria.brokenReferences));
  }
  if ((metrics.previewMarkers || []).length > 0) {
    violations.push(violation('PREVIEW_MARKER_PRESENT', 'A packaged production renderer must not expose preview identity markers.', metrics.previewMarkers));
  }
  const operatorCopy = metrics.operatorCopy;
  if (
    !operatorCopy
    || !Array.isArray(operatorCopy.forbiddenMatches)
    || !Number.isSafeInteger(operatorCopy.textLength)
    || operatorCopy.textLength < 1
    || !/^[A-F0-9]{64}$/.test(String(operatorCopy.textSha256 || ''))
  ) {
    violations.push(violation(
      'OPERATOR_COPY_AUDIT_MISSING',
      'Each packaged workspace must include a hash-bound audit of visible operator-facing copy.',
      operatorCopy ?? null,
    ));
  } else if (operatorCopy.forbiddenMatches.length > 0) {
    violations.push(violation(
      'OPERATOR_INTERNAL_COPY_VISIBLE',
      'Ordinary packaged UI must not expose internal workflow names or technical status values.',
      operatorCopy.forbiddenMatches,
    ));
  }
  const workspaceDeviceScaleFactor = Number.isFinite(Number(metrics.deviceScaleFactor))
    ? Number(metrics.deviceScaleFactor)
    : 1;
  const viewportContract = evaluatePackageViewportContract({
    actual: metrics.viewport,
    actualDeviceScaleFactor: workspaceDeviceScaleFactor,
    expectedDeviceScaleFactor: workspaceDeviceScaleFactor,
    requested: requestedViewport,
  });
  if (viewportContract.violations.some((item) => item.code === 'VIEWPORT_DIMENSION_DELTA')) {
    violations.push(violation('VIEWPORT_MISMATCH', 'The packaged UI viewport exceeds the requested dimensions and Windows DPI rounding tolerance.', viewportContract));
  }
  let rendererUrl;
  try {
    rendererUrl = new URL(metrics.rendererUrl);
  } catch {
    rendererUrl = null;
  }
  if (!rendererUrl || rendererUrl.protocol !== 'file:' || rendererUrl.searchParams.get('preview') === '1') {
    violations.push(violation('WORKSPACE_RENDERER_IDENTITY', 'Workspace metrics did not come from the packaged file renderer.', metrics.rendererUrl));
  }
  return { passed: violations.length === 0, violations };
}

function validatePackageMinimumWindow(input) {
  const violations = [];
  const native = input?.nativeWindow;
  if (native?.minimum?.width !== 1200 || native?.minimum?.height !== 700
    || native?.attempted?.width !== 1199 || native?.attempted?.height !== 699
    || Math.abs(Number(native?.bounds?.width) - 1200) > 2
    || Math.abs(Number(native?.bounds?.height) - 700) > 2
    || !Number.isFinite(native?.bounds?.width) || !Number.isFinite(native?.bounds?.height)
    || native?.maximized !== false || native?.fullScreen !== false
    || !(native?.content?.width > 0 && native.content.width <= native.bounds.width)
    || !(native?.content?.height > 0 && native.content.height <= native.bounds.height)
    || Math.abs(Number(input?.viewport?.width) - native.content.width) > 2
    || Math.abs(Number(input?.viewport?.height) - native.content.height) > 2
    || !Number.isFinite(input?.viewport?.width) || !Number.isFinite(input?.viewport?.height)
    || input?.viewport?.deviceScaleFactor !== 1) {
    violations.push(violation('MINIMUM_WINDOW_BOUNDS', 'Minimum-window evidence must prove the native 1200x700 clamp and its actual renderer content size at 100%.', native));
  }
  const keys = EXPECTED_PACKAGE_UI_ENTRIES.map((item) => `${item.workspace}/${item.subview}`);
  for (const field of ['workspaceChecks', 'screenshots']) {
    const exact = exactPackageUiCollection(input?.[field], keys, (item) => `${item?.workspace}/${item?.subview}`);
    if (!exact.passed) violations.push(violation('MINIMUM_WINDOW_ENTRIES_NOT_EXACT', `Minimum-window ${field} must cover all 22 entries exactly once.`, exact));
  }
  for (const expected of EXPECTED_PACKAGE_UI_ENTRIES) {
    const check = input?.workspaceChecks?.find((item) => item.workspace === expected.workspace && item.subview === expected.subview);
    const screenshot = input?.screenshots?.find((item) => item.workspace === expected.workspace && item.subview === expected.subview);
    if (check?.passed !== true || check?.settleEvidence?.passed !== true || check?.compositeEvidence?.passed !== true
      || screenshot?.profileId !== '100-compact' || screenshot?.scalePercent !== 100
      || canonicalJson(screenshotFileTuple(check?.screenshot)) !== canonicalJson(screenshotFileTuple(screenshot))
      || !currentFileRecordMatches(screenshot)) {
      violations.push(violation('MINIMUM_WINDOW_CAPTURE_INVALID', 'Minimum-window capture must bind the settled entry to current screenshot bytes.', `${expected.workspace}/${expected.subview}`));
    }
    violations.push(...validateWorkspaceRuntimeMetrics(check?.metrics || {}, expected, input?.viewport || {}).violations);
    violations.push(...validateWorkspaceTabKeyboardEvidence(check?.keyboardEvidence, expected).violations);
  }
  return { passed: violations.length === 0, violations };
}

  return {
    safeRealPath,
    normalizedWindowsPath,
    violation,
    validatePackageIdentity,
    evaluatePackageViewportContract,
    validateWorkspaceRuntimeMetrics,
    validatePackageMinimumWindow,
  };
};
