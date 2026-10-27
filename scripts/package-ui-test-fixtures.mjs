import {
  CURRENT_ARTIFACT_ROOT,
  EXPECTED_OVERLAY_CHECK_IDS,
  EXPECTED_PACKAGE_UI_ENTRIES,
  EXPECTED_PACKAGE_UI_SCALES,
  EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  HASH_A,
  HASH_B,
  PACKAGE_UI_WIDE_PROFILE,
  USER_DATA_DIR,
  bindRunAttemptArtifacts,
  buildPackageUiAttemptArtifactManifest,
  buildPackageUiAttemptArtifactReferences,
  buildProcessIsolationEvidence,
  canonicalJsonForTest,
  evidenceModule,
  mkdirSync,
  mkdtempSync,
  path,
  pathToFileURL,
  readFileSync,
  rmSync,
  tmpdir,
  utimesSync,
  validPackageUiMinimumWindow,
  validPackageUiWorkspaceCheck,
  validProfileLockIsolation,
  validRunEvidenceBinding,
  validatePackageUiReadOnlyRuntimeEvidence,
  validateSchedulerSubviewEvidence,
  writeFileSync,
} from './package-ui-test-context.mjs';

function withValidAppContent(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-'));
  const files = {
    'dist/main/index.js': 'main-entry',
    'dist/preload/index.js': 'preload-entry',
    'dist/renderer/assets/index.js': 'renderer-bundle',
    'dist/renderer/index.html': '<main>renderer</main>',
    'node_modules/runtime/index.js': 'runtime-dependency',
    'package.json': JSON.stringify({ main: 'dist/main/index.js', name: '@amazon-ai-ops/desktop', version: JSON.parse(readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')).version }),
    'playwright-browsers/chrome-win64/chrome.exe': 'chromium-runtime',
  };
  for (const [relativePath, content] of Object.entries(files).reverse()) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  try {
    return run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function withProductionBuildPayload(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-production-build-'));
  const files = {
    'main/index.cjs': 'main-runtime',
    'main/index.js': 'main-runtime',
    'main/index.d.ts': 'stale-types',
    'main/index.cjs.map': 'source-map',
    'preload/index.cjs': 'preload-runtime',
    'preload/index.js': 'preload-runtime',
    'preload/index.d.ts': 'stale-types',
    'preload/index.cjs.map': 'source-map',
    'renderer/assets/index.css': 'renderer-style',
    'renderer/assets/index.js': 'renderer-runtime',
    'renderer/index.html': '<main>renderer</main>',
    'win-unpacked/historical.exe': 'old-package',
    'linux-unpacked/historical': 'old-package',
    'main-test.js': 'old-test-output',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  const oldTime = new Date('2025-01-01T00:00:00.000Z');
  utimesSync(path.join(root, 'main/index.d.ts'), oldTime, oldTime);
  utimesSync(path.join(root, 'win-unpacked/historical.exe'), oldTime, oldTime);
  try {
    return run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function validIdentity(overrides = {}) {
  const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
  const appContentPath = path.resolve('apps/desktop/release/win-unpacked/resources/app');
  return {
    actualAppContentSha256: HASH_B,
    actualExeSha256: HASH_A,
    actualExecutablePath: executablePath,
    actualUserDataDir: USER_DATA_DIR,
    appPath: appContentPath,
    appVersion: '1.5.0',
    expectedAppContentSha256: HASH_B,
    expectedExeSha256: HASH_A,
    expectedExecutablePath: executablePath,
    expectedEvidenceMode: 'package-ui',
    expectedUserDataDir: USER_DATA_DIR,
    expectedVersion: '1.5.0',
    evidenceMode: 'package-ui',
    isPackaged: true,
    rendererUrl: pathToFileURL(path.join(appContentPath, 'dist/renderer/index.html')).href,
    ...overrides,
  };
}

function validMetrics(expected, overrides = {}) {
  return { ...validPackageUiWorkspaceCheck(expected).metrics, ...overrides };
}

function validProcessSnapshot(overrides = {}) {
  return {
    error: null,
    matching: [],
    matchingCount: 0,
    observedCount: 0,
    passed: true,
    unresolved: [],
    unresolvedCount: 0,
    ...overrides,
  };
}

function validProcessIsolation() {
  return buildProcessIsolationEvidence(validProcessSnapshot(), validProcessSnapshot({ attempts: 1 }));
}

function runEvidenceBindingFromAttempt(manager, profileId, attemptContext) {
  return validRunEvidenceBinding(profileId, {
    attemptId: attemptContext.attemptId,
    invocationId: attemptContext.invocationId,
    runGroupId: manager.runGroupId,
    runnerContractSha256: manager.metadata.runnerContractSha256,
  });
}

function validInvocation(manager, suffix = '001') {
  const invocationId = `test-invocation-${suffix}`;
  const lease = {
    payload: {
      generation: `test-generation-${suffix}`,
      invocationId,
      runGroupId: manager.runGroupId,
      runnerContractSha256: manager.metadata.runnerContractSha256,
    },
    payloadSha256: HASH_A,
  };
  return { invocationId, lease };
}

function artifactReferences(manifest, role = 'workspace-screenshot') {
  return manifest.files.map((file) => ({
    path: path.join(manifest.rootPath, ...file.path.split('/')),
    role,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
  }));
}

function bindSingleSuccessfulAttemptArtifact(run, manifest) {
  const file = manifest.files[0];
  run.schedulerReadOnlyRuntime = {
    artifact: {
      path: path.join(manifest.rootPath, ...file.path.split('/')),
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    },
  };
  run.screenshots = [];
  run.artifactReferences = buildPackageUiAttemptArtifactReferences(
    manifest,
    run,
  );
  return run;
}

function validAttemptArtifacts(label = 'fixture') {
  const root = mkdtempSync(path.join(CURRENT_ARTIFACT_ROOT, 'attempt-artifacts-'));
  writeFileSync(path.join(root, `${label}.txt`), `immutable-${label}`, 'utf8');
  return buildPackageUiAttemptArtifactManifest(root);
}

function changedRunnerContract(contract) {
  const binding = {
    evidenceScript: {
      ...contract.evidenceScript,
      sha256: contract.evidenceScript.sha256 === HASH_A ? HASH_B : HASH_A,
    },
    protectedSqliteTempScript: contract.protectedSqliteTempScript,
    semanticContractSha256: contract.semanticContractSha256,
  };
  return {
    ...binding,
    sha256: evidenceModule.sha256Buffer(
      Buffer.from(canonicalJsonForTest(binding), 'utf8'),
    ),
  };
}

function validChromiumLineage() {
  const profilePathBindingSha256 = HASH_A;
  const profileBindingSha256 = evidenceModule.sha256Buffer(
    Buffer.from(canonicalJsonForTest([profilePathBindingSha256]), 'utf8'),
  );
  return {
    chromium: { sha256: HASH_A, sizeBytes: 1234 },
    cleanup: validProcessSnapshot({ attempts: 1 }),
    descendantProcessIds: [902],
    expectedProfileRootSha256: HASH_B,
    observedAt: '2026-07-17T06:00:00.600Z',
    passed: true,
    profileBindingSha256,
    profileBindingTokenCount: 1,
    rootProcessIds: [901],
    snapshot: validProcessSnapshot({
      expectedProfileRootSha256: HASH_B,
      matching: [
        {
          executablePath: 'D:\\App\\chrome.exe',
          name: 'chrome.exe',
          parentProcessId: 900,
          processId: 901,
          profileMatched: true,
          profilePathBindingSha256,
        },
        {
          executablePath: 'D:\\App\\chrome.exe',
          name: 'chrome.exe',
          parentProcessId: 901,
          processId: 902,
          profileMatched: false,
          profilePathBindingSha256: null,
        },
      ],
      matchingCount: 2,
      observedCount: 2,
      profileBindingSha256,
      profileBindingTokenCount: 1,
      rootProcessIds: [901],
    }),
  };
}

function validDiagnostics(profileId) {
  const connectionBootstrap = {
    completedAt: '2026-07-17T06:00:00.400Z',
    outcome: 'existing-lingxing-connection',
    startedAt: '2026-07-17T06:00:00.300Z',
  };
  const selectedStore = {
    displayName: null,
    idLength: 12,
    idSha256: HASH_A,
  };
  return {
    cleanupErrors: [],
    completedAt: '2026-07-17T06:00:01.000Z',
    failure: null,
    login: {
      attempts: [],
      completedAt: '2026-07-17T06:00:00.500Z',
      connectionBootstrap,
      outcome: 'existing-authenticated-session',
      savedCredentials: null,
      startedAt: '2026-07-17T06:00:00.100Z',
    },
    lifecycle: {
      droppedCount: 0,
      events: [
        { at: '2026-07-17T06:00:00.005Z', kind: 'window-attached', phase: 'electron-launch', runnerCloseRequested: false, windowId: 1 },
        { at: '2026-07-17T06:00:00.700Z', kind: 'runner-close-requested', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-17T06:00:00.750Z', kind: 'window-closed', phase: 'electron-close', runnerCloseRequested: true, windowId: 1 },
        { at: '2026-07-17T06:00:00.800Z', kind: 'electron-context-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-17T06:00:00.850Z', kind: 'electron-app-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-17T06:00:00.900Z', code: 0, kind: 'electron-process-exit', phase: 'electron-close', runnerCloseRequested: true, signal: null },
      ],
      limit: 100,
      processExit: {
        at: '2026-07-17T06:00:00.900Z',
        code: 0,
        runnerCloseRequested: true,
        signal: null,
      },
      runnerCloseRequestedAt: '2026-07-17T06:00:00.700Z',
      unexpectedCloseObserved: false,
    },
    phase: 'completed',
    profileId,
    renderer: {
      consoleErrors: [],
      droppedCount: { consoleErrors: 0, pageErrors: 0 },
      limits: { consoleErrors: 100, pageErrors: 100 },
      pageErrors: [],
    },
    schemaVersion: 'package-ui-run-diagnostics/v2',
    startedAt: '2026-07-17T06:00:00.000Z',
    storeGate: {
      completedAt: '2026-07-17T06:00:00.050Z',
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'selected-existing-store',
      resultingSurface: 'login',
      selectedStore,
      startedAt: '2026-07-17T06:00:00.010Z',
    },
    timeline: [
      { at: '2026-07-17T06:00:00.000Z', phase: 'created' },
      { at: '2026-07-17T06:00:01.000Z', phase: 'completed' },
    ],
  };
}

function failedDiagnostics(profileId, message = 'synthetic failure') {
  const diagnostics = validDiagnostics(profileId);
  const failure = {
    at: diagnostics.completedAt,
    message,
    name: 'Error',
    phase: 'synthetic-test',
    stack: `Error: ${message}`,
  };
  diagnostics.failure = failure;
  diagnostics.phase = 'failed';
  diagnostics.timeline[diagnostics.timeline.length - 1] = {
    at: diagnostics.completedAt,
    phase: 'failed',
  };
  return { diagnostics, failure };
}

function validSession(profileId) {
  const diagnostics = validDiagnostics(profileId);
  return {
    connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
    loginSessionAttestation: {
      adsSessionReady: true,
      credentialPersistence: 'main_managed',
      credentialSource: 'saved',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
    },
    mode: 'existing-authenticated-session',
    savedCredentialsLoginUsed: false,
    storeGate: {
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'selected-existing-store',
      selectedStore: { ...diagnostics.storeGate.selectedStore },
    },
    storeAuthorityReadback: {
      actualIdSha256: HASH_A,
      currency: 'USD',
      expectedIdSha256: HASH_A,
      marketplace: 'US',
      passed: true,
    },
  };
}

const SCHEDULER_CONTEXT = {
  storeId: 'store-us-001',
  browserProfileId: 'profile-us-001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 4,
};

const EMPTY_SCHEDULER_COUNTS = {
  workspaceQuery: 0,
  schedulerGet: 0,
  retentionPreview: 0,
  runNow: 0,
  runNowRejected: 0,
  localSchedulerStart: 0,
  storeSchedulerStart: 0,
  reconcile: 0,
  execute: 0,
};

function validDatabaseMutationAudit() {
  const metrics = {
    digestSha256: HASH_A,
    serializedBytes: 49_152,
    totalChanges: 8,
    dataVersion: 1,
    pageCount: 12,
    pageSize: 4096,
    schemaVersion: 8,
    userVersion: 9,
  };
  return {
    kind: 'package-ui-database-mutation-audit',
    schemaVersion: 1,
    requiredPhases: ['post-bootstrap', 'post-navigation', 'pre-close-terminal'],
    checkpoints: [
      {
        sequence: 1,
        phase: 'post-bootstrap',
        capturedAt: '2026-07-23T01:00:00.050Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
      {
        sequence: 2,
        phase: 'post-navigation',
        capturedAt: '2026-07-23T01:05:00.050Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
      {
        sequence: 3,
        phase: 'pre-close-terminal',
        capturedAt: '2026-07-23T01:05:01.050Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
    ],
    comparisons: {
      contextDigestMatched: true,
      digestMatched: true,
      serializedBytesMatched: true,
      totalChangesMatched: true,
      dataVersionMatched: true,
      pageCountMatched: true,
      pageSizeMatched: true,
      schemaVersionMatched: true,
      userVersionMatched: true,
    },
    passed: true,
  };
}

function databaseCheckpointReceipts(runtime) {
  const checkpoints = runtime.marker.databaseMutationAudit.checkpoints;
  return {
    postBootstrap: structuredClone(checkpoints[0]),
    postNavigation: structuredClone(checkpoints[1]),
  };
}

function schedulerAuditSnapshot({ counts = {}, events = [], pid = 321 } = {}) {
  const mergedCounts = { ...EMPTY_SCHEDULER_COUNTS, ...counts };
  const suppressed = {
    automaticReconcile: 0,
    localSchedulerStart: 1,
    startupReconcile: 1,
    storeSchedulerStart: 1,
  };
  return {
    kind: 'package-ui-scheduler-audit',
    schemaVersion: 1,
    generatedAt: '2026-07-23T01:00:00.000Z',
    pid,
    evidenceMode: 'package-ui',
    userDataDir: USER_DATA_DIR,
    policies: { runNow: 'reject' },
    counts: mergedCounts,
    suppressed,
    guards: {
      localSchedulerStarted: false,
      storeCollectionSchedulerStarted: false,
      runNowIpcDisabled: true,
      startupReconcileSuppressed: true,
      automaticReconcileSuppressed: true,
      readOnlyInvariantPassed: true,
    },
    databaseMutationAudit: validDatabaseMutationAudit(),
    events,
  };
}

function validSchedulerSubviewEvidence() {
  const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const requestId = 'renderer-bootstrap-1784786120654-1';
  const events = [
    {
      sequence: 1,
      at: '2026-07-23T01:00:00.100Z',
      source: 'mission-control:query',
      outcome: 'succeeded',
      context: SCHEDULER_CONTEXT,
      request: {
        query: 'workspace-bootstrap',
        requestId,
        contextEpoch: 1,
        context: SCHEDULER_CONTEXT,
      },
      response: {
        query: 'workspace-bootstrap',
        requestId,
        contextEpoch: 1,
        authoritativeContext: SCHEDULER_CONTEXT,
        capabilities: expected.capabilities.map((capability) => ({
          ...capability,
          view: 'settings/scheduler',
          workspace: 'settings',
        })),
      },
      errorCode: null,
    },
    {
      sequence: 2,
      at: '2026-07-23T01:00:00.200Z',
      source: 'store-collection-scheduler:get',
      outcome: 'succeeded',
      context: SCHEDULER_CONTEXT,
      request: { storeContext: SCHEDULER_CONTEXT },
      response: {
        businessDate: SCHEDULER_CONTEXT.businessDate,
        detail: '等待当前店铺配置的采集时间。',
        enabled: true,
        state: 'waiting',
        storeId: SCHEDULER_CONTEXT.storeId,
      },
      errorCode: null,
    },
    {
      sequence: 3,
      at: '2026-07-23T01:00:00.300Z',
      source: 'store-evidence-retention:preview',
      outcome: 'succeeded',
      context: SCHEDULER_CONTEXT,
      request: { storeContext: SCHEDULER_CONTEXT },
      response: {
        applyable: false,
        blockerCount: 0,
        candidateCount: 0,
        currency: 'USD',
        deletionSupported: false,
        marketplace: 'US',
        mode: 'dry-run',
        profileId: SCHEDULER_CONTEXT.browserProfileId,
        schemaVersion: 1,
        storeId: SCHEDULER_CONTEXT.storeId,
      },
      errorCode: null,
    },
  ];
  return {
    dom: {
      alertDialogCount: 0,
      busyControlCount: 0,
      confirmRunDialogCount: 0,
      fixedScopeText: 'US USD',
      fixedScopeTexts: ['US USD'],
      fixedScopeVisibleCount: 1,
      heading: expected.heading,
      headingCount: 1,
      legacyBoundaryCount: 1,
      legacyCapabilityState: 'LEGACY_ADAPTER',
      legacyRoute: 'scheduler',
      legacyStoreId: SCHEDULER_CONTEXT.storeId,
      pageCount: 1,
      previewMarkerCount: 0,
      loadingStateCount: 0,
      retentionPreviewCapabilityId: 'settings.scheduler.retention-preview',
      retentionPreviewControlCount: 1,
      retentionPreviewEnabledCount: 1,
      retentionBlockerCount: '0',
      retentionCandidateCount: '0',
      retentionCurrency: 'USD',
      retentionMarketplace: 'US',
      retentionProfileId: SCHEDULER_CONTEXT.browserProfileId,
      retentionStoreId: SCHEDULER_CONTEXT.storeId,
      retentionSummaryCount: 1,
      rootCount: 1,
      scheduleBusinessDate: SCHEDULER_CONTEXT.businessDate,
      scheduleCurrency: 'USD',
      scheduleEnabled: 'true',
      scheduleMarketplace: 'US',
      scheduleProjectionCount: 1,
      scheduleRefreshEnabledCount: 1,
      scheduleState: 'waiting',
      scheduleStoreId: SCHEDULER_CONTEXT.storeId,
      schedulerErrorCount: 0,
      selectedStoreId: SCHEDULER_CONTEXT.storeId,
      selectedTabCapabilityState: 'LEGACY_ADAPTER',
      selectedTabCount: 1,
      selectedTabId: expected.tabId,
      shellStoreId: SCHEDULER_CONTEXT.storeId,
      subview: expected.subview,
      workspace: expected.workspace,
    },
    ledgerBefore: schedulerAuditSnapshot(),
    ledgerAfter: schedulerAuditSnapshot({
      counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
      events,
    }),
  };
}

function validSubviewCheck(scale) {
  const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const screenshotPath = path.join(
    CURRENT_ARTIFACT_ROOT,
    `${expected.workspace}-${expected.subview}-${scale.scalePercent}.png`,
  );
  writeFileSync(screenshotPath, Buffer.from(`scheduler-${scale.scalePercent}`));
  return {
    ...expected,
    compositeEvidence: { passed: true },
    identityCapabilityEvidence: validateSchedulerSubviewEvidence(validSchedulerSubviewEvidence(), expected),
    passed: true,
    screenshot: {
      path: screenshotPath,
      scalePercent: scale.scalePercent,
      sha256: evidenceModule.sha256File(screenshotPath),
      sizeBytes: readFileSync(screenshotPath).byteLength,
      subview: expected.subview,
      workspace: expected.workspace,
    },
    settleEvidence: { passed: true },
    violations: [],
  };
}

function validReadOnlyRuntime(profileId) {
  const marker = validSchedulerSubviewEvidence().ledgerAfter;
  const artifactPath = path.join(
    CURRENT_ARTIFACT_ROOT,
    `${profileId}-package-ui-scheduler-audit.json`,
  );
  writeFileSync(artifactPath, JSON.stringify(marker), 'utf8');
  return validatePackageUiReadOnlyRuntimeEvidence({
    artifact: {
      path: artifactPath,
      sha256: evidenceModule.sha256File(artifactPath),
      sizeBytes: readFileSync(artifactPath).byteLength,
    },
    main: {
      evidenceMode: 'package-ui',
      pid: marker.pid,
      userDataDir: USER_DATA_DIR,
    },
    marker,
    processExitConfirmed: true,
  });
}

function validRun(scale) {
  const profileId = `${scale.scalePercent}-compact`;
  const evidenceBinding = validRunEvidenceBinding(profileId);
  const schedulerReadOnlyRuntime = validReadOnlyRuntime(`${scale.scalePercent}-compact`);
  const run = {
    actualDeviceScaleFactor: scale.deviceScaleFactor,
    chromiumProcessLineage: validChromiumLineage(),
    consoleErrors: [],
    databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
    diagnostics: validDiagnostics(`${scale.scalePercent}-compact`),
    identity: { passed: true },
    evidenceBinding,
    failure: null,
    overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => ({
      compositeEvidence: { passed: true },
      id,
      overlayVisibleAfterCapture: true,
      overlayVisibleBeforeCapture: true,
      passed: true,
      screenshot: {
        overlayId: id,
        path: `${id}-${scale.scalePercent}.png`,
        scalePercent: scale.scalePercent,
        sha256: HASH_B,
      },
    })),
    pageErrors: [],
    packageProcessIsolation: validProcessIsolation(),
    profileId,
    profileLockIsolation: validProfileLockIsolation(
      profileId,
      evidenceBinding.invocationId,
    ),
    passed: true,
    scalePercent: scale.scalePercent,
    minimumWindow: scale.scalePercent === 100 ? validPackageUiMinimumWindow(CURRENT_ARTIFACT_ROOT) : null,
    screenshots: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace) => ({
      path: `${workspace.workspace}-${scale.scalePercent}.png`,
      scalePercent: scale.scalePercent,
      sha256: HASH_A,
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    schedulerReadOnlyRuntime,
    session: validSession(`${scale.scalePercent}-compact`),
    subviewChecks: [validSubviewCheck(scale)],
    viewport: { height: 768, width: 1366 },
    profileProcessIsolation: validProcessIsolation(),
    workspaceChecks: EXPECTED_PACKAGE_UI_ENTRIES.map((workspace) => {
      const objectWorkspace = workspace.workspace === 'product' || workspace.workspace === 'diagnosis';
      return {
        compositeEvidence: { passed: true },
        experienceEvidence: objectWorkspace ? { passed: true } : null,
        inspectorEvidence: objectWorkspace ? {
          inspector: { ariaModal: 'true', mode: 'drawer' },
          passed: true,
          screenshot: { path: `${workspace.workspace}-inspector-${scale.scalePercent}.png`, sha256: HASH_B },
        } : null,
        passed: true,
        settleEvidence: { passed: true },
        ...validPackageUiWorkspaceCheck(workspace),
        subview: workspace.subview,
        workspace: workspace.workspace,
      };
    }),
  };
  for (const check of run.workspaceChecks) {
    check.screenshot = run.screenshots.find((record) => (
      record.workspace === check.workspace && record.subview === check.subview
    ));
  }
  return bindRunAttemptArtifacts(
    applyInteractiveOperatorHandoff(run, {
      firstRun: scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent,
    }),
    `${scale.scalePercent}-compact`,
  );
}

function validSavedLoginRun(scale) {
  const run = validRun(scale);
  run.session.mode = 'saved-credentials-login';
  run.session.savedCredentialsLoginUsed = true;
  delete run.session.operatorHandoff;
  run.diagnostics.login.outcome = 'saved-credentials-login';
  delete run.diagnostics.login.operatorHandoff;
  run.diagnostics.login.attempts = [
    {
      attempt: 1,
      completedAt: '2026-07-17T06:00:00.250Z',
      message: 'saved-session browser navigation replaced its execution context',
      outcome: 'retryable-navigation',
      retryable: true,
      startedAt: '2026-07-17T06:00:00.200Z',
    },
    {
      attempt: 2,
      completedAt: '2026-07-17T06:00:00.450Z',
      message: null,
      outcome: 'workspace-reached',
      retryable: false,
      startedAt: '2026-07-17T06:00:00.300Z',
    },
  ];
  return run;
}

function applyInteractiveOperatorHandoff(run, { firstRun = false } = {}) {
  const operatorHandoff = {
    automationReadSecrets: false,
    automationTypedSecrets: false,
    completedAt: '2026-07-17T06:00:00.400Z',
    durationClock: 'performance.now',
    elapsedMs: 190,
    finalPhase: 'authorization',
    kind: 'visible-user-handoff',
    maximumTotalTimeoutMs: 1_200_000,
    outcome: 'workspace-reached',
    phaseTimeoutMs: 600_000,
    phaseTransitions: [
      { elapsedMs: 0, phase: 'preparation', startedAt: '2026-07-17T06:00:00.210Z' },
      { elapsedMs: 90, phase: 'authorization', startedAt: '2026-07-17T06:00:00.300Z' },
    ],
    startedAt: '2026-07-17T06:00:00.200Z',
  };
  const connectionBootstrap = {
    completedAt: operatorHandoff.completedAt,
    outcome: 'operator-established-lingxing-connection-and-session',
    startedAt: operatorHandoff.startedAt,
  };
  run.session.mode = 'interactive-operator-login';
  run.session.savedCredentialsLoginUsed = false;
  run.session.operatorHandoff = { ...operatorHandoff };
  run.session.connectionBootstrap = { ...connectionBootstrap };
  run.session.loginSessionAttestation = firstRun
    ? {
        adsSessionReady: true,
        credentialPersistence: 'saved',
        credentialSource: 'typed',
        erpSessionReady: true,
        erpSessionReused: false,
        ok: true,
        sessionIdentityVerified: true,
      }
    : {
        adsSessionReady: true,
        credentialPersistence: 'main_managed',
        credentialSource: 'saved',
        erpSessionReady: true,
        erpSessionReused: true,
        ok: true,
        sessionIdentityVerified: false,
      };
  run.diagnostics.login.outcome = 'interactive-operator-login';
  run.diagnostics.login.operatorHandoff = { ...operatorHandoff };
  run.diagnostics.login.connectionBootstrap = { ...connectionBootstrap };
  return run;
}

function validWideRun() {
  const evidenceBinding = validRunEvidenceBinding(PACKAGE_UI_WIDE_PROFILE.id);
  const schedulerReadOnlyRuntime = validReadOnlyRuntime(PACKAGE_UI_WIDE_PROFILE.id);
  const run = {
    actualDeviceScaleFactor: 1,
    chromiumProcessLineage: validChromiumLineage(),
    consoleErrors: [],
    databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
    diagnostics: validDiagnostics(PACKAGE_UI_WIDE_PROFILE.id),
    evidenceBinding,
    failure: null,
    identity: { passed: true },
    pageErrors: [],
    packageProcessIsolation: validProcessIsolation(),
    profileLockIsolation: validProfileLockIsolation(
      PACKAGE_UI_WIDE_PROFILE.id,
      evidenceBinding.invocationId,
    ),
    profileId: PACKAGE_UI_WIDE_PROFILE.id,
    screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
      path: `${workspace.workspace}-wide.png`,
      profileId: PACKAGE_UI_WIDE_PROFILE.id,
      sha256: HASH_A,
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    schedulerReadOnlyRuntime,
    session: validSession(PACKAGE_UI_WIDE_PROFILE.id),
    profileProcessIsolation: validProcessIsolation(),
    passed: true,
    viewport: { height: 900, width: 1400 },
    workspaceChecks: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
      compositeEvidence: { passed: true },
      experienceEvidence: null,
      inspectorEvidence: null,
      ...validPackageUiWorkspaceCheck(workspace, PACKAGE_UI_WIDE_PROFILE.viewport),
      passed: true,
      settleEvidence: { passed: true },
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
  };
  for (const check of run.workspaceChecks) {
    check.screenshot = run.screenshots.find((record) => (
      record.workspace === check.workspace && record.subview === check.subview
    ));
  }
  return bindRunAttemptArtifacts(
    applyInteractiveOperatorHandoff(run),
    PACKAGE_UI_WIDE_PROFILE.id,
  );
}

export {
  withValidAppContent,
  withProductionBuildPayload,
  validIdentity,
  validMetrics,
  validProcessSnapshot,
  validProcessIsolation,
  runEvidenceBindingFromAttempt,
  validInvocation,
  artifactReferences,
  bindSingleSuccessfulAttemptArtifact,
  validAttemptArtifacts,
  changedRunnerContract,
  validChromiumLineage,
  validDiagnostics,
  failedDiagnostics,
  validSession,
  SCHEDULER_CONTEXT,
  EMPTY_SCHEDULER_COUNTS,
  validDatabaseMutationAudit,
  databaseCheckpointReceipts,
  schedulerAuditSnapshot,
  validSchedulerSubviewEvidence,
  validSubviewCheck,
  validReadOnlyRuntime,
  validRun,
  validSavedLoginRun,
  applyInteractiveOperatorHandoff,
  validWideRun,
};
