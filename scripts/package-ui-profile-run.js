// 同次运行的原生证明与读屏生命周期由短模块持有，既有采集路径保留原预算。
const nativeLaunch = require('./package-ui-native-launch');
const nativeReader = require('./package-ui-native-reader');
module.exports = function createPackageUiModule(dependencies) {
  const {
    DESKTOP_PACKAGE,
    EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    PACKAGE_UI_EVIDENCE_MODE,
    EVIDENCE_MODE_ENV,
    PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS,
    PACKAGE_UI_NATIVE_RUNTIME_CONTRACT,
    PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
    PACKAGE_UI_VIEWPORT,
    PACKAGE_UI_VIEWPORT_TOLERANCE,
    PACKAGE_UI_WIDE_PROFILE,
    _electron,
    buildEvidenceUserDataEnv,
    path,
    performance,
  } = dependencies;
  const attachElectronLifecycleDiagnostics = (...args) => dependencies.attachElectronLifecycleDiagnostics(...args);
  const attachRendererDiagnostics = (...args) => dependencies.attachRendererDiagnostics(...args);
  const capturePackageMinimumWindow = (...args) => dependencies.capturePackageMinimumWindow(...args);
  const capturePackageWorkspaceMatrix = (...args) => dependencies.capturePackageWorkspaceMatrix(...args);
  const captureViewportScreenshot = (...args) => dependencies.captureViewportScreenshot(...args);
  const chromiumLineageEvidencePassed = (...args) => dependencies.chromiumLineageEvidencePassed(...args);
  const collectElectronIdentity = (...args) => dependencies.collectElectronIdentity(...args);
  const collectEvidenceStoreAuthorityReadback = (...args) => dependencies.collectEvidenceStoreAuthorityReadback(...args);
  const collectPackageUiMainIdentity = (...args) => dependencies.collectPackageUiMainIdentity(...args);
  const collectPackageUiReadOnlyRuntimeEvidence = (...args) => dependencies.collectPackageUiReadOnlyRuntimeEvidence(...args);
  const collectPackageWorkspaceMetrics = (...args) => dependencies.collectPackageWorkspaceMetrics(...args);
  const collectSchedulerSubviewEvidence = (...args) => dependencies.collectSchedulerSubviewEvidence(...args);
  const createStructuredFailure = (...args) => dependencies.createStructuredFailure(...args);
  const ensureAuthenticatedWorkspace = (...args) => dependencies.ensureAuthenticatedWorkspace(...args);
  const evaluatePackageViewportContract = (...args) => dependencies.evaluatePackageViewportContract(...args);
  const fail = (...args) => dependencies.fail(...args);
  const markRunnerElectronCloseRequested = (...args) => dependencies.markRunnerElectronCloseRequested(...args);
  const navigateToReadOnlySubview = (...args) => dependencies.navigateToReadOnlySubview(...args);
  const prepareReadOnlySubviewNavigationBoundary = (...args) => dependencies.prepareReadOnlySubviewNavigationBoundary(...args);
  const readElectronViewport = (...args) => dependencies.readElectronViewport(...args);
  const readPackageUiSchedulerAudit = (...args) => dependencies.readPackageUiSchedulerAudit(...args);
  const reloadAuthenticatedWorkspaceForSubviewEvidence = (...args) => dependencies.reloadAuthenticatedWorkspaceForSubviewEvidence(...args);
  const requestPackageUiDatabaseCheckpoint = (...args) => dependencies.requestPackageUiDatabaseCheckpoint(...args);
  const restoreElectronViewportAfterAuthentication = (...args) => dependencies.restoreElectronViewportAfterAuthentication(...args);
  const runOverlayChecks = (...args) => dependencies.runOverlayChecks(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const screenshotRecord = (...args) => dependencies.screenshotRecord(...args);
  const setElectronViewport = (...args) => dependencies.setElectronViewport(...args);
  const setRunDiagnosticPhase = (...args) => dependencies.setRunDiagnosticPhase(...args);
  const validatePackageIdentity = (...args) => dependencies.validatePackageIdentity(...args);
  const validateWorkspaceRuntimeMetrics = (...args) => dependencies.validateWorkspaceRuntimeMetrics(...args);
  const waitForActiveBundledChromiumLineage = (...args) => dependencies.waitForActiveBundledChromiumLineage(...args);
  const waitForBoundedElectronClose = (...args) => dependencies.waitForBoundedElectronClose(...args);
  const waitForRendererComposite = (...args) => dependencies.waitForRendererComposite(...args);

async function runScaleEvidenceCore(options, scale, artifacts, runDir, diagnostics) {
  const consoleErrors = diagnostics.renderer.consoleErrors;
  const pageErrors = diagnostics.renderer.pageErrors;
  const attachedPages = new WeakSet();
  let electronApp;
  let nativeRuntime = null;
  let preparedNative = null;
  let mainIdentity = null;
  let pendingEvidence = null;
  let processExitConfirmed = false;
  try {
    setRunDiagnosticPhase(diagnostics, 'electron-launch');
    const nativeStartedAt = new Date().toISOString();
    electronApp = await _electron.launch({
      executablePath: options.executablePath,
      args: [`--force-device-scale-factor=${scale.deviceScaleFactor}`],
      cwd: path.dirname(options.executablePath),
      env: {
        ...buildEvidenceUserDataEnv(process.env, PACKAGE_UI_EVIDENCE_MODE, options.userDataDir),
        [PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV]: options.requireFreshTypedProof ? '1' : '0',
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_ENABLE_STACK_DUMPING: '1',
      },
      timeout: 60_000,
    });
    preparedNative = nativeLaunch.preparePackageUiNativeLaunch(electronApp, nativeStartedAt,
      PACKAGE_UI_NATIVE_RUNTIME_CONTRACT.operationTimeoutMs);
    const lifecycleObserver = attachElectronLifecycleDiagnostics(electronApp, diagnostics);
    const attachPage = (candidate) => attachRendererDiagnostics(candidate, diagnostics, attachedPages);
    const attachObservedPage = (candidate) => {
      lifecycleObserver.attachPage(candidate);
      attachPage(candidate);
    };
    electronApp.on('window', attachObservedPage);
    for (const existingPage of electronApp.windows()) attachObservedPage(existingPage);
    setRunDiagnosticPhase(diagnostics, 'first-window');
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    attachObservedPage(page);
    setRunDiagnosticPhase(diagnostics, 'viewport');
    await setElectronViewport(electronApp, PACKAGE_UI_VIEWPORT);
    const viewportWait = {
      width: PACKAGE_UI_VIEWPORT.width,
      height: PACKAGE_UI_VIEWPORT.height,
      dpr: scale.deviceScaleFactor,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    };
    try {
      await page.waitForFunction(({ width, height, dpr, tolerance }) => (
        Math.abs(window.innerWidth - width) <= tolerance.width
        && Math.abs(window.innerHeight - height) <= tolerance.height
        && Math.abs(window.devicePixelRatio - dpr) <= tolerance.deviceScaleFactor
      ), viewportWait, { timeout: 20_000 });
    } catch (error) {
      const actualAfterTimeout = await readElectronViewport(page).catch(() => ({
        deviceScaleFactor: null,
        height: null,
        width: null,
      }));
      const timeoutContract = evaluatePackageViewportContract({
        actual: actualAfterTimeout,
        actualDeviceScaleFactor: actualAfterTimeout.deviceScaleFactor,
        expectedDeviceScaleFactor: scale.deviceScaleFactor,
      });
      fail('Packaged viewport did not settle within the strict DPI rounding tolerance', JSON.stringify({
        actual: timeoutContract.actual,
        delta: timeoutContract.delta,
        requested: timeoutContract.requested,
        scalePercent: scale.scalePercent,
        timeoutError: String(error?.message || error),
        tolerance: timeoutContract.tolerance,
      }));
    }
    const actualViewport = await readElectronViewport(page);
    const viewportContract = evaluatePackageViewportContract({
      actual: actualViewport,
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      expectedDeviceScaleFactor: scale.deviceScaleFactor,
    });
    if (!viewportContract.passed) {
      fail('Packaged viewport contract failed after settling', JSON.stringify(viewportContract));
    }

    setRunDiagnosticPhase(diagnostics, 'identity');
    const actualIdentity = await collectElectronIdentity(electronApp, page);
    const identity = validatePackageIdentity({
      ...actualIdentity,
      actualAppContentSha256: artifacts.appContent.sha256,
      actualExeSha256: artifacts.exe.sha256,
      expectedAppContentSha256: options.expectedAppContentSha256,
      expectedExeSha256: options.expectedExeSha256,
      expectedExecutablePath: options.executablePath,
      expectedEvidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedUserDataDir: options.userDataDir,
      expectedVersion: DESKTOP_PACKAGE.version,
    });
    if (!identity.passed) fail('Packaged runtime identity failed', JSON.stringify(identity.violations));
    nativeRuntime = await nativeLaunch.openPackageUiNativeLaunch({ app: electronApp, page, prepared: preparedNative,
      options, artifacts, runDir, evidenceModeEnv: EVIDENCE_MODE_ENV,
      timeoutMs: PACKAGE_UI_NATIVE_RUNTIME_CONTRACT.operationTimeoutMs });

    setRunDiagnosticPhase(diagnostics, 'login');
    const session = await ensureAuthenticatedWorkspace(page, { ...options, diagnostics });
    await restoreElectronViewportAfterAuthentication(
      electronApp,
      page,
      PACKAGE_UI_VIEWPORT,
      scale.deviceScaleFactor,
    );
    setRunDiagnosticPhase(diagnostics, 'chromium-lineage');
    const chromiumProcessLineage = await waitForActiveBundledChromiumLineage(options);
    if (!chromiumLineageEvidencePassed(chromiumProcessLineage)) {
      fail(
        'The active browser session was not bound to the packaged Chromium process lineage',
        JSON.stringify(chromiumProcessLineage),
      );
    }
    session.storeAuthorityReadback = await collectEvidenceStoreAuthorityReadback(
      page,
      session.storeGate,
    );
    if (!session.storeAuthorityReadback.passed) {
      fail(
        'Packaged shell Store Authority did not match the explicitly selected isolated evidence store',
        JSON.stringify(session.storeAuthorityReadback),
      );
    }
    const databaseAuditCheckpoints = {
      postBootstrap: await requestPackageUiDatabaseCheckpoint(page, 'post-bootstrap'),
      postNavigation: null,
    };
    const { workspaceChecks, screenshots } = await capturePackageWorkspaceMatrix(page, electronApp, {
      diagnostics, runDir, settleMs: options.settleMs, profileId: `${scale.scalePercent}-compact`,
      scalePercent: scale.scalePercent, viewport: PACKAGE_UI_VIEWPORT,
    });
    const minimumWindow = scale.scalePercent === 100
      ? await capturePackageMinimumWindow(page, electronApp, { diagnostics, runDir, settleMs: options.settleMs })
      : null;
    const subviewChecks = [];
    for (const subview of EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS) {
      setRunDiagnosticPhase(diagnostics, `subview:${subview.workspace}/${subview.subview}`);
      await prepareReadOnlySubviewNavigationBoundary(page, subview, options.settleMs);
      const schedulerLedgerBefore = readPackageUiSchedulerAudit(options.userDataDir);
      await reloadAuthenticatedWorkspaceForSubviewEvidence(page);
      const settleEvidence = await navigateToReadOnlySubview(page, subview, options.settleMs);
      const rootSelector = `[data-workspace-evidence-root][data-workspace="${subview.workspace}"][data-workspace-subview="${subview.subview}"]`;
      const subviewRoot = page.locator(rootSelector);
      const compositeEvidence = await waitForRendererComposite(page, electronApp, subviewRoot);
      const metrics = await collectPackageWorkspaceMetrics(page, subview);
      const contract = validateWorkspaceRuntimeMetrics(metrics, subview);
      const schedulerLedgerAfter = readPackageUiSchedulerAudit(options.userDataDir);
      const identityCapabilityEvidence = await collectSchedulerSubviewEvidence(
        page,
        schedulerLedgerBefore,
        schedulerLedgerAfter,
        subview,
      );
      const screenshotPath = path.join(
        runDir,
        `${scale.scalePercent}-${safeSegment(subview.workspace)}-${safeSegment(subview.subview)}-readonly.png`,
      );
      const screenshotCapture = await captureViewportScreenshot(electronApp, screenshotPath);
      const screenshot = screenshotRecord(screenshotPath, {
        capture: screenshotCapture,
        heading: subview.heading,
        scalePercent: scale.scalePercent,
        subview: subview.subview,
        workspace: subview.workspace,
      });
      const passed = contract.passed && identityCapabilityEvidence.passed;
      subviewChecks.push({
        ...subview,
        compositeEvidence,
        identityCapabilityEvidence,
        metrics,
        passed,
        screenshot,
        settleEvidence,
        violations: [...contract.violations, ...identityCapabilityEvidence.violations],
      });
      if (!passed) {
        fail(
          'Packaged read-only subview contract failed',
          `${subview.workspace}/${subview.subview}: ${JSON.stringify([
            ...contract.violations,
            ...identityCapabilityEvidence.violations,
          ])}`,
        );
      }
    }

    setRunDiagnosticPhase(diagnostics, 'overlays');
    const overlayChecks = await runOverlayChecks(page, {
      electronApp,
      runDir,
      scalePercent: scale.scalePercent,
      settleMs: options.settleMs,
    });
    setRunDiagnosticPhase(diagnostics, 'native-reader-governance');
    await nativeReader.collectPackageUiNativeGovernance(nativeRuntime, options, dependencies,
      PACKAGE_UI_NATIVE_RUNTIME_CONTRACT.operationTimeoutMs);
    databaseAuditCheckpoints.postNavigation = await requestPackageUiDatabaseCheckpoint(
      page,
      'post-navigation',
    );
    mainIdentity = await collectPackageUiMainIdentity(electronApp);
    if (consoleErrors.length > 0) fail('Renderer console errors were observed', JSON.stringify(consoleErrors));
    if (pageErrors.length > 0) fail('Renderer page errors were observed', JSON.stringify(pageErrors));

    pendingEvidence = {
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      actualIdentity,
      chromiumProcessLineage,
      consoleErrors,
      databaseAuditCheckpoints,
      identity,
      overlayChecks,
      pageErrors,
      passed: true,
      scalePercent: scale.scalePercent,
      screenshots,
      session,
      minimumWindow,
      subviewChecks,
      viewport: { width: actualViewport.width, height: actualViewport.height },
      viewportContract,
      workspaceChecks,
    };
  } finally {
    if (electronApp) {
      try { await nativeReader.closePackageUiNativeReader(nativeRuntime); }
      catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'reader-close')); }
      if (nativeRuntime && !mainIdentity) {
        try { mainIdentity = await collectPackageUiMainIdentity(electronApp); }
        catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'native-terminal-main')); }
      }
      const nativeCloseStartedAt = performance.now();
      setRunDiagnosticPhase(diagnostics, 'electron-close');
      markRunnerElectronCloseRequested(diagnostics);
      try {
        await waitForBoundedElectronClose({
          close: async () => {
            await electronApp.close();
          },
        });
      } catch (error) {
        diagnostics.cleanupErrors.push(createStructuredFailure(error, 'electron-close'));
      }
      if (nativeRuntime) {
        try {
          const nativeCloseRemainingMs = Math.floor(PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS - (performance.now() - nativeCloseStartedAt));
          if (nativeCloseRemainingMs <= 0) fail('Package UI held Main exit exceeded the original close deadline.');
          processExitConfirmed = await nativeRuntime.confirmMainExit(mainIdentity || nativeRuntime.identity, nativeCloseRemainingMs);
        } catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'native-main-exit')); }
        try { await nativeRuntime.dispose(); }
        catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'native-watcher-dispose')); }
      }
    }
  }
  if (!processExitConfirmed || !mainIdentity || !pendingEvidence) {
    fail('Packaged Electron did not exit before terminal Main attestation was collected.');
  }
  setRunDiagnosticPhase(diagnostics, 'terminal-main-attestation');
  const schedulerReadOnlyRuntime = collectPackageUiReadOnlyRuntimeEvidence(
    mainIdentity,
    options.userDataDir,
    runDir,
    `${scale.scalePercent}-compact`,
    { requireSchedulerReads: true },
  );
  if (!schedulerReadOnlyRuntime.passed) {
    fail(
      'Package UI terminal Main scheduler read-only attestation failed',
      JSON.stringify(schedulerReadOnlyRuntime.violations),
    );
  }
  return {
    ...pendingEvidence,
    ...nativeRuntime.evidence(),
    schedulerReadOnlyRuntime,
  };
}

async function runWideProfileEvidenceCore(options, artifacts, runDir, diagnostics) {
  const profile = PACKAGE_UI_WIDE_PROFILE;
  const consoleErrors = diagnostics.renderer.consoleErrors;
  const pageErrors = diagnostics.renderer.pageErrors;
  const attachedPages = new WeakSet();
  let electronApp;
  let nativeRuntime = null;
  let preparedNative = null;
  let mainIdentity = null;
  let pendingEvidence = null;
  let processExitConfirmed = false;
  try {
    setRunDiagnosticPhase(diagnostics, 'electron-launch');
    const nativeStartedAt = new Date().toISOString();
    electronApp = await _electron.launch({
      executablePath: options.executablePath,
      args: [`--force-device-scale-factor=${profile.deviceScaleFactor}`],
      cwd: path.dirname(options.executablePath),
      env: {
        ...buildEvidenceUserDataEnv(process.env, PACKAGE_UI_EVIDENCE_MODE, options.userDataDir),
        [PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV]: options.requireFreshTypedProof ? '1' : '0',
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_ENABLE_STACK_DUMPING: '1',
      },
      timeout: 60_000,
    });
    preparedNative = nativeLaunch.preparePackageUiNativeLaunch(electronApp, nativeStartedAt,
      PACKAGE_UI_NATIVE_RUNTIME_CONTRACT.operationTimeoutMs);
    const lifecycleObserver = attachElectronLifecycleDiagnostics(electronApp, diagnostics);
    const attachPage = (candidate) => attachRendererDiagnostics(candidate, diagnostics, attachedPages);
    const attachObservedPage = (candidate) => {
      lifecycleObserver.attachPage(candidate);
      attachPage(candidate);
    };
    electronApp.on('window', attachObservedPage);
    for (const existingPage of electronApp.windows()) attachObservedPage(existingPage);
    setRunDiagnosticPhase(diagnostics, 'first-window');
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    attachObservedPage(page);
    setRunDiagnosticPhase(diagnostics, 'viewport');
    await setElectronViewport(electronApp, profile.viewport);
    await page.waitForFunction(({ viewport, dpr, tolerance }) => (
      Math.abs(window.innerWidth - viewport.width) <= tolerance.width
      && Math.abs(window.innerHeight - viewport.height) <= tolerance.height
      && Math.abs(window.devicePixelRatio - dpr) <= tolerance.deviceScaleFactor
    ), {
      viewport: profile.viewport,
      dpr: profile.deviceScaleFactor,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    }, { timeout: 20_000 });
    const actualViewport = await readElectronViewport(page);
    const viewportContract = evaluatePackageViewportContract({
      actual: actualViewport,
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      expectedDeviceScaleFactor: profile.deviceScaleFactor,
      requested: profile.viewport,
    });
    if (!viewportContract.passed) fail('Wide packaged viewport contract failed', JSON.stringify(viewportContract));
    setRunDiagnosticPhase(diagnostics, 'identity');
    const actualIdentity = await collectElectronIdentity(electronApp, page);
    const identity = validatePackageIdentity({
      ...actualIdentity,
      actualAppContentSha256: artifacts.appContent.sha256,
      actualExeSha256: artifacts.exe.sha256,
      expectedAppContentSha256: options.expectedAppContentSha256,
      expectedExeSha256: options.expectedExeSha256,
      expectedExecutablePath: options.executablePath,
      expectedEvidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedUserDataDir: options.userDataDir,
      expectedVersion: DESKTOP_PACKAGE.version,
    });
    if (!identity.passed) fail('Wide packaged runtime identity failed', JSON.stringify(identity.violations));
    nativeRuntime = await nativeLaunch.openPackageUiNativeLaunch({ app: electronApp, page, prepared: preparedNative,
      options, artifacts, runDir, evidenceModeEnv: EVIDENCE_MODE_ENV,
      timeoutMs: PACKAGE_UI_NATIVE_RUNTIME_CONTRACT.operationTimeoutMs });
    setRunDiagnosticPhase(diagnostics, 'login');
    const session = await ensureAuthenticatedWorkspace(page, { ...options, diagnostics });
    await restoreElectronViewportAfterAuthentication(
      electronApp,
      page,
      profile.viewport,
      profile.deviceScaleFactor,
    );
    setRunDiagnosticPhase(diagnostics, 'chromium-lineage');
    const chromiumProcessLineage = await waitForActiveBundledChromiumLineage(options);
    if (!chromiumLineageEvidencePassed(chromiumProcessLineage)) {
      fail(
        'The wide browser session was not bound to the packaged Chromium process lineage',
        JSON.stringify(chromiumProcessLineage),
      );
    }
    session.storeAuthorityReadback = await collectEvidenceStoreAuthorityReadback(
      page,
      session.storeGate,
    );
    if (!session.storeAuthorityReadback.passed) {
      fail(
        'Wide packaged shell Store Authority did not match the explicitly selected isolated evidence store',
        JSON.stringify(session.storeAuthorityReadback),
      );
    }
    const databaseAuditCheckpoints = {
      postBootstrap: await requestPackageUiDatabaseCheckpoint(page, 'post-bootstrap'),
      postNavigation: null,
    };
    const { workspaceChecks, screenshots } = await capturePackageWorkspaceMatrix(page, electronApp, {
      diagnostics, runDir, settleMs: options.settleMs, profileId: profile.id,
      scalePercent: profile.scalePercent, viewport: profile.viewport, wide: true,
    });
    setRunDiagnosticPhase(diagnostics, 'native-reader-governance');
    await nativeReader.collectPackageUiNativeGovernance(nativeRuntime, options, dependencies,
      PACKAGE_UI_NATIVE_RUNTIME_CONTRACT.operationTimeoutMs);
    databaseAuditCheckpoints.postNavigation = await requestPackageUiDatabaseCheckpoint(
      page,
      'post-navigation',
    );
    mainIdentity = await collectPackageUiMainIdentity(electronApp);
    if (consoleErrors.length > 0) fail('Wide packaged renderer console errors were observed', JSON.stringify(consoleErrors));
    if (pageErrors.length > 0) fail('Wide packaged renderer page errors were observed', JSON.stringify(pageErrors));
    pendingEvidence = {
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      actualIdentity,
      chromiumProcessLineage,
      consoleErrors,
      databaseAuditCheckpoints,
      identity,
      pageErrors,
      passed: true,
      profileId: profile.id,
      screenshots,
      session,
      viewport: { width: actualViewport.width, height: actualViewport.height },
      viewportContract,
      workspaceChecks,
    };
  } finally {
    if (electronApp) {
      try { await nativeReader.closePackageUiNativeReader(nativeRuntime); }
      catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'reader-close')); }
      if (nativeRuntime && !mainIdentity) {
        try { mainIdentity = await collectPackageUiMainIdentity(electronApp); }
        catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'native-terminal-main')); }
      }
      const nativeCloseStartedAt = performance.now();
      setRunDiagnosticPhase(diagnostics, 'electron-close');
      markRunnerElectronCloseRequested(diagnostics);
      try {
        await waitForBoundedElectronClose({
          close: async () => {
            await electronApp.close();
          },
        });
      } catch (error) {
        diagnostics.cleanupErrors.push(createStructuredFailure(error, 'electron-close'));
      }
      if (nativeRuntime) {
        try {
          const nativeCloseRemainingMs = Math.floor(PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS - (performance.now() - nativeCloseStartedAt));
          if (nativeCloseRemainingMs <= 0) fail('Package UI held Main exit exceeded the original close deadline.');
          processExitConfirmed = await nativeRuntime.confirmMainExit(mainIdentity || nativeRuntime.identity, nativeCloseRemainingMs);
        } catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'native-main-exit')); }
        try { await nativeRuntime.dispose(); }
        catch (error) { diagnostics.cleanupErrors.push(createStructuredFailure(error, 'native-watcher-dispose')); }
      }
    }
  }
  if (!processExitConfirmed || !mainIdentity || !pendingEvidence) {
    fail('Wide packaged Electron did not exit before terminal Main attestation was collected.');
  }
  setRunDiagnosticPhase(diagnostics, 'terminal-main-attestation');
  const schedulerReadOnlyRuntime = collectPackageUiReadOnlyRuntimeEvidence(
    mainIdentity,
    options.userDataDir,
    runDir,
    profile.id,
    { requireSchedulerReads: false },
  );
  if (!schedulerReadOnlyRuntime.passed) {
    fail(
      'Wide package UI terminal Main scheduler read-only attestation failed',
      JSON.stringify(schedulerReadOnlyRuntime.violations),
    );
  }
  return {
    ...pendingEvidence,
    ...nativeRuntime.evidence(),
    schedulerReadOnlyRuntime,
  };
}

  return {
    runScaleEvidenceCore,
    runWideProfileEvidenceCore,
  };
};
