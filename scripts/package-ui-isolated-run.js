// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    BUNDLED_CHROMIUM_RELATIVE_PATH,
    DEFAULT_APP_CONTENT_PATH,
    PACKAGE_UI_VIEWPORT,
    PACKAGE_UI_WIDE_PROFILE,
    path,
  } = dependencies;
  const buildProcessIsolationEvidence = (...args) => dependencies.buildProcessIsolationEvidence(...args);
  const chromiumLineageEvidencePassed = (...args) => dependencies.chromiumLineageEvidencePassed(...args);
  const collectMatchingPackageProcesses = (...args) => dependencies.collectMatchingPackageProcesses(...args);
  const collectMatchingProfileBrowserProcesses = (...args) => dependencies.collectMatchingProfileBrowserProcesses(...args);
  const collectPackageUiProfileLockEvidence = (...args) => dependencies.collectPackageUiProfileLockEvidence(...args);
  const completeRunDiagnostics = (...args) => dependencies.completeRunDiagnostics(...args);
  const createRunDiagnostics = (...args) => dependencies.createRunDiagnostics(...args);
  const diagnosticFailurePhase = (...args) => dependencies.diagnosticFailurePhase(...args);
  const fail = (...args) => dependencies.fail(...args);
  const packageProcessAbsencePassed = (...args) => dependencies.packageProcessAbsencePassed(...args);
  const packageProcessIsolationEvidencePassed = (...args) => dependencies.packageProcessIsolationEvidencePassed(...args);
  const packageUiProfileLockSnapshotPassed = (...args) => dependencies.packageUiProfileLockSnapshotPassed(...args);
  const processIsolationEvidencePassed = (...args) => dependencies.processIsolationEvidencePassed(...args);
  const processSnapshotEvidencePassed = (...args) => dependencies.processSnapshotEvidencePassed(...args);
  const recordRunDiagnosticFailure = (...args) => dependencies.recordRunDiagnosticFailure(...args);
  const runScaleEvidenceCore = (...args) => dependencies.runScaleEvidenceCore(...args);
  const runWideProfileEvidenceCore = (...args) => dependencies.runWideProfileEvidenceCore(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const setRunDiagnosticPhase = (...args) => dependencies.setRunDiagnosticPhase(...args);
  const validSuccessfulElectronLifecycle = (...args) => dependencies.validSuccessfulElectronLifecycle(...args);
  const waitForPackageProcessCleanup = (...args) => dependencies.waitForPackageProcessCleanup(...args);
  const waitForProfileBrowserProcessCleanup = (...args) => dependencies.waitForProfileBrowserProcessCleanup(...args);

async function executeEvidenceRunWithIsolation({
  baseEvidence,
  options,
  processApi = {},
  profileId,
  run,
}) {
  const diagnostics = createRunDiagnostics(profileId);
  const profileBrowserPath = path.join(options.userDataDir, 'stores');
  setRunDiagnosticPhase(diagnostics, 'process-preflight');
  const collectPackage = processApi.collectPackage || collectMatchingPackageProcesses;
  const collectProfile = processApi.collectProfile || collectMatchingProfileBrowserProcesses;
  const collectProfileLocks = processApi.collectProfileLocks
    || collectPackageUiProfileLockEvidence;
  const waitPackage = processApi.waitPackage || waitForPackageProcessCleanup;
  const waitProfile = processApi.waitProfile || waitForProfileBrowserProcessCleanup;
  const packageProcessesBefore = collectPackage(options.executablePath);
  const chromiumPath = path.join(
    options.appContentPath || DEFAULT_APP_CONTENT_PATH,
    BUNDLED_CHROMIUM_RELATIVE_PATH,
  );
  const profileLockOptions = {
    invocationId: options.invocationId || 'unbound-invocation',
    profileId,
  };
  const profileLocksBefore = collectProfileLocks(
    options.userDataDir,
    profileLockOptions,
  );
  const profileCollectOptions = {
    allowUnreadableBaseline: packageProcessAbsencePassed(packageProcessesBefore)
      && packageUiProfileLockSnapshotPassed(profileLocksBefore),
    expectedExecutablePath: chromiumPath,
  };
  const profileProcessesBefore = collectProfile(profileBrowserPath, profileCollectOptions);
  const profileBrowserBaselineProcessIds = Array.isArray(profileProcessesBefore.observedProcessIds)
    ? profileProcessesBefore.observedProcessIds
    : [];
  options.profileBrowserBaselineProcessIds = profileBrowserBaselineProcessIds;
  const profileCleanupCollectOptions = {
    allowUnreadableBaseline: profileCollectOptions.allowUnreadableBaseline,
    baselineProcessIds: profileBrowserBaselineProcessIds,
    expectedExecutablePath: chromiumPath,
  };
  let coreEvidence = null;

  try {
    if (!packageProcessAbsencePassed(packageProcessesBefore)) {
      fail('Every same-name packaged process must be absent before this evidence profile', JSON.stringify(packageProcessesBefore));
    }
    if (
      !processSnapshotEvidencePassed(profileProcessesBefore)
      || profileProcessesBefore.matchingCount !== 0
      || profileProcessesBefore.unresolvedCount !== 0
    ) {
      fail('A Chromium profile process was already running or unresolved before this evidence profile', JSON.stringify(profileProcessesBefore));
    }
    if (!packageUiProfileLockSnapshotPassed(profileLocksBefore)) {
      fail('The isolated profile bounded lock/handle preflight was incomplete', JSON.stringify(profileLocksBefore));
    }
    coreEvidence = await run(diagnostics);
  } catch (error) {
    recordRunDiagnosticFailure(diagnostics, error, diagnosticFailurePhase(diagnostics));
  }

  setRunDiagnosticPhase(diagnostics, 'process-cleanup-attestation');
  let packageProcessesAfter;
  let profileProcessesAfter;
  let profileLocksAfter;
  try {
    [packageProcessesAfter, profileProcessesAfter] = await Promise.all([
      waitPackage(options.executablePath),
      waitProfile(profileBrowserPath, { collectOptions: profileCleanupCollectOptions }),
    ]);
    profileLocksAfter = collectProfileLocks(
      options.userDataDir,
      profileLockOptions,
    );
  } catch (error) {
    recordRunDiagnosticFailure(diagnostics, error, 'process-cleanup-attestation');
    packageProcessesAfter ||= {
      attempts: null,
      error: sanitizeDiagnosticText(error?.message || error),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      unresolved: [],
      unresolvedCount: null,
    };
    profileProcessesAfter ||= {
      attempts: null,
      error: sanitizeDiagnosticText(error?.message || error),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      profilePath: profileBrowserPath,
      unresolved: [],
      unresolvedCount: null,
    };
    profileLocksAfter ||= {
      error: sanitizeDiagnosticText(error?.message || error),
      passed: false,
      unresolved: [],
      unresolvedCount: null,
    };
  }
  const packageProcessIsolation = buildProcessIsolationEvidence(packageProcessesBefore, packageProcessesAfter);
  const profileProcessIsolation = buildProcessIsolationEvidence(profileProcessesBefore, profileProcessesAfter);
  const profileLockIsolation = {
    after: profileLocksAfter,
    before: profileLocksBefore,
    passed: packageUiProfileLockSnapshotPassed(profileLocksBefore)
      && packageUiProfileLockSnapshotPassed(
        profileLocksAfter,
        profileLocksBefore.binding,
      ),
  };
  const chromiumProcessLineage = coreEvidence?.chromiumProcessLineage
    ? {
      ...coreEvidence.chromiumProcessLineage,
      cleanup: profileProcessesAfter,
      passed: chromiumLineageEvidencePassed(coreEvidence.chromiumProcessLineage)
        && processSnapshotEvidencePassed(profileProcessesAfter)
        && profileProcessesAfter.matchingCount === 0,
    }
    : null;
  if (diagnostics.cleanupErrors.length > 0 && !diagnostics.failure) {
    recordRunDiagnosticFailure(
      diagnostics,
      new Error('Electron close reported one or more cleanup errors.'),
      'electron-close',
    );
  }
  if (
    (
      !packageProcessIsolationEvidencePassed(packageProcessIsolation)
      || !processIsolationEvidencePassed(profileProcessIsolation)
      || !profileLockIsolation.passed
    )
    && !diagnostics.failure
  ) {
    recordRunDiagnosticFailure(
      diagnostics,
      new Error('Packaged product or profile browser process isolation failed.'),
      'process-cleanup-attestation',
    );
  }
  const lifecycleAttestationPassed = validSuccessfulElectronLifecycle(
    diagnostics.lifecycle,
    Date.parse(diagnostics.startedAt),
    Date.now(),
  );
  if (coreEvidence?.passed === true && !lifecycleAttestationPassed && !diagnostics.failure) {
    recordRunDiagnosticFailure(
      diagnostics,
      new Error('Packaged Electron lifecycle attestation was incomplete or observed an unrequested close.'),
      'electron-lifecycle-attestation',
    );
  }
  const passed = coreEvidence?.passed === true
    && diagnostics.failure === null
    && diagnostics.cleanupErrors.length === 0
    && lifecycleAttestationPassed
    && packageProcessIsolationEvidencePassed(packageProcessIsolation)
    && processIsolationEvidencePassed(profileProcessIsolation)
    && profileLockIsolation.passed
    && chromiumProcessLineage?.passed === true;
  if (diagnostics.login.outcome === 'not-started') diagnostics.login.outcome = 'not-reached';
  if (diagnostics.login.outcome === 'in-progress') diagnostics.login.outcome = passed ? 'completed' : 'failed-before-outcome';
  completeRunDiagnostics(diagnostics, passed);

  return {
    ...baseEvidence,
    ...(coreEvidence || {}),
    consoleErrors: diagnostics.renderer.consoleErrors,
    chromiumProcessLineage,
    diagnostics,
    failure: diagnostics.failure,
    lifecycleAttestation: { passed: lifecycleAttestationPassed },
    packageProcessIsolation,
    pageErrors: diagnostics.renderer.pageErrors,
    passed,
    profileLockIsolation,
    profileProcessIsolation,
  };
}

async function runScaleEvidence(options, scale, artifacts, runDir) {
  return executeEvidenceRunWithIsolation({
    baseEvidence: {
      actualDeviceScaleFactor: null,
      overlayChecks: [],
      scalePercent: scale.scalePercent,
      screenshots: [],
      schedulerReadOnlyRuntime: null,
      nativeLaunch: null, nativeCleanup: null, readerLaunch: null, readerCleanup: null,
      nativeRuntimeArtifacts: [], screenReaderRequested: Boolean(options.screenReaderExecutablePath),
      subviewChecks: [],
      viewport: { ...PACKAGE_UI_VIEWPORT },
      workspaceChecks: [],
    },
    options,
    profileId: `${scale.scalePercent}-compact`,
    run: (diagnostics) => runScaleEvidenceCore(options, scale, artifacts, runDir, diagnostics),
  });
}

async function runWideProfileEvidence(options, artifacts, runDir) {
  return executeEvidenceRunWithIsolation({
    baseEvidence: {
      actualDeviceScaleFactor: null,
      profileId: PACKAGE_UI_WIDE_PROFILE.id,
      screenshots: [],
      schedulerReadOnlyRuntime: null,
      nativeLaunch: null, nativeCleanup: null, readerLaunch: null, readerCleanup: null,
      nativeRuntimeArtifacts: [], screenReaderRequested: Boolean(options.screenReaderExecutablePath),
      viewport: { ...PACKAGE_UI_WIDE_PROFILE.viewport },
      workspaceChecks: [],
    },
    options,
    profileId: PACKAGE_UI_WIDE_PROFILE.id,
    run: (diagnostics) => runWideProfileEvidenceCore(options, artifacts, runDir, diagnostics),
  });
}

  return {
    executeEvidenceRunWithIsolation,
    runScaleEvidence,
    runWideProfileEvidence,
  };
};
