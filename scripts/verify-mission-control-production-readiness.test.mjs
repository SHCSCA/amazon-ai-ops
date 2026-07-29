import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import packageUiEvidence from './package-ui-evidence.js';
import packageSecurity from './smoke-package-security-boundaries.js';
import packageAdversarialNodeEnv from './smoke-package-adversarial-node-env.js';
import continuousOperationVerifier from './verify-s7-continuous-operation.js';
import sqliteAuthorityCurrentness from './sqlite-authority-currentness.js';
import { writeValidPackageLaunchSmoke } from './package-launch-smoke.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(path.join(root, 'packages', 'local-db', 'package.json'));
const Database = requireFromLocalDb('better-sqlite3');
const verifierPath = path.join(root, 'scripts', 'verify-mission-control-production-readiness.js');
const readinessVerifier = createRequire(import.meta.url)(verifierPath);
const testTempRoot = path.join(root, 'output', 'codex-temp');
const EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT = 'mission-control-execution-canary-authority/v1';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const HASH_C = 'C'.repeat(64);
const V15_GATE_IDS = [
  'report-collection-delivery',
  'lingxing-listing-full-read',
  'ai-live-provider',
  'ad-recommendation-ai-explanation',
  'listing-ai-draft',
  'real-ad-execution-readback',
  'release-package-hash',
  'package-launch-smoke',
];
const {
  EXPECTED_OVERLAY_CHECK_IDS,
  EXPECTED_PACKAGE_UI_SCALES,
  EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  EXPECTED_PACKAGE_UI_WORKSPACES,
  INTERACTIVE_LOGIN_CONTRACT,
  ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
  PACKAGE_UI_PROFILE_SEQUENCE,
  PACKAGE_UI_WIDE_PROFILE,
  buildPackageUiAttemptArtifactManifest,
  buildPackageUiRunnerContract,
  buildProcessIsolationEvidence,
  writeImmutableEnvelope,
} = packageUiEvidence;
const { EXPECTED_PACKAGE_SECURITY_CHECK_CODES } = packageSecurity;
const { buildAdversarialNodeEnvEvidence } = packageAdversarialNodeEnv;
const {
  EXPECTED_REPORT_TYPES,
  buildEvidenceManifest: buildContinuousOperationManifest,
  evaluateContinuousOperationSnapshot,
  readContinuousOperationSnapshot,
} = continuousOperationVerifier;
const { runReadonlySqliteOnlineBackupSync } = sqliteAuthorityCurrentness;

fs.mkdirSync(testTempRoot, { recursive: true });

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(testTempRoot, prefix));
}

function runVerifier(args) {
  if (args.verificationContext) {
    const result = readinessVerifier.run(args, args.verificationContext);
    return { status: result.exitCode, stdout: '', stderr: '' };
  }
  const env = { ...process.env, TEMP: testTempRoot, TMP: testTempRoot };
  delete env.npm_config_cache;
  return spawnSync(process.execPath, [verifierPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

function createCanonicalPackageFixture(tempDir) {
  const releaseRoot = path.join(tempDir, 'release');
  const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
  const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
  const portablePath = path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  const installerPath = path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0.exe');
  fs.mkdirSync(path.join(appContentPath, 'dist', 'preload'), { recursive: true });
  fs.mkdirSync(path.join(appContentPath, 'dist', 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(appContentPath, 'playwright-browsers', 'chrome-win64'), { recursive: true });
  writeJson(path.join(appContentPath, 'package.json'), {
    name: '@amazon-ai-ops/desktop', version: '1.5.0', main: 'dist/main/index.js',
  });
  fs.mkdirSync(path.dirname(mainBundlePath), { recursive: true });
  fs.writeFileSync(executablePath, 'canonical-unpacked-package');
  fs.writeFileSync(mainBundlePath, 'canonical-main-bundle');
  fs.writeFileSync(path.join(appContentPath, 'dist', 'preload', 'index.js'), 'canonical-preload');
  fs.writeFileSync(path.join(appContentPath, 'dist', 'renderer', 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(appContentPath, 'playwright-browsers', 'chrome-win64', 'chrome.exe'), 'canonical-chromium-runtime');
  fs.writeFileSync(portablePath, 'canonical-portable-package');
  fs.writeFileSync(installerPath, 'canonical-installer-package');
  const builtAt = new Date('2026-07-10T00:30:00.000Z');
  const touchTree = (target) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) for (const name of fs.readdirSync(target)) touchTree(path.join(target, name));
    fs.utimesSync(target, builtAt, builtAt);
  };
  touchTree(releaseRoot);
  const appContent = packageUiEvidence.buildAppContentManifest(appContentPath);
  return {
    releaseRoot, executablePath, appContentPath, mainBundlePath, portablePath, installerPath,
    packageIdentity: {
      executableSha256: sha256File(executablePath),
      appContentSha256: appContent.sha256.toUpperCase(),
      mainBundleSha256: sha256File(mainBundlePath),
    },
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function artifact(filePath) {
  const stat = fs.statSync(filePath);
  return { path: filePath, sizeBytes: stat.size, sha256: sha256File(filePath) };
}

function writeArtifact(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return artifact(filePath);
}

function screenshotBytes(label) {
  return Buffer.concat([ONE_PIXEL_PNG, Buffer.from(`\n${label}\n`, 'utf8')]);
}

function packageIndexArtifact(kind, filePath) {
  const record = artifact(filePath);
  return {
    kind,
    sourcePath: record.path,
    fileName: path.basename(record.path),
    exists: true,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    modifiedAt: fs.statSync(filePath).mtime.toISOString(),
  };
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

function validLogicalArtifact() {
  return {
    method: 'readonly-sqlite-online-backup',
    remainingPages: 0,
    schemaVersion: 'sqlite-authority-currentness-proof/v1',
    sha256: HASH_A,
    sizeBytes: 4096,
    totalPages: 1,
  };
}

function validProfileLineageState() {
  return {
    capturedAt: '2026-07-23T01:00:01.100Z',
    logicalDatabase: validLogicalArtifact(),
    profileContent: {
      fileCount: 10,
      sha256: HASH_B,
      sizeBytes: 8192,
    },
  };
}

function validAttemptArtifacts(screenshotRoot, profileId) {
  const attemptRoot = path.join(screenshotRoot, profileId, 'attempt-artifacts');
  writeArtifact(
    path.join(attemptRoot, 'immutable-attempt.txt'),
    Buffer.from(`immutable-package-ui-attempt:${profileId}`, 'utf8'),
  );
  return buildPackageUiAttemptArtifactManifest(attemptRoot);
}

function validChromiumLineage() {
  const profilePathBindingSha256 = HASH_A;
  const profileBindingSha256 = sha256Text(stableJson([profilePathBindingSha256])).toUpperCase();
  return {
    chromium: { sha256: HASH_A, sizeBytes: 1234 },
    cleanup: validProcessSnapshot({ attempts: 1 }),
    descendantProcessIds: [902],
    expectedProfileRootSha256: HASH_B,
    observedAt: '2026-07-23T01:00:00.600Z',
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

function validCheckpointComposition(screenshotRoot, runGroupId, runnerContractSha256) {
  const checkpointRoot = path.join(screenshotRoot, 'checkpoints');
  const checkpointRecords = PACKAGE_UI_PROFILE_SEQUENCE.map((profileId, index) => {
    const payload = {
      kind: 'package-ui-profile-checkpoint',
      profileId,
      runGroupId,
      runnerContractSha256,
      schemaVersion: 'package-ui-profile-checkpoint/v1',
      sequence: index + 1,
    };
    const file = writeImmutableEnvelope(
      path.join(checkpointRoot, `${profileId}.json`),
      payload,
    );
    const envelope = readJson(file.path);
    return {
      file,
      payloadSha256: envelope.payloadSha256,
      profileId,
    };
  });
  return {
    checkpointRecords,
    finalProfileState: validProfileLineageState(),
    packageLineage: { chromium: { sha256: HASH_A } },
    passed: true,
    runGroupId,
    runnerContractSha256,
  };
}

function validOperatorHandoff() {
  return {
    automationReadSecrets: false,
    automationTypedSecrets: false,
    completedAt: '2026-07-23T01:00:00.450Z',
    kind: 'visible-user-handoff',
    outcome: 'workspace-reached',
    startedAt: '2026-07-23T01:00:00.150Z',
  };
}

function validDiagnostics(profileId) {
  const connectionBootstrap = {
    completedAt: '2026-07-23T01:00:00.400Z',
    outcome: 'existing-lingxing-connection',
    startedAt: '2026-07-23T01:00:00.300Z',
  };
  const operatorHandoff = validOperatorHandoff();
  const selectedStore = {
    displayName: null,
    idLength: 12,
    idSha256: HASH_A,
  };
  return {
    cleanupErrors: [],
    completedAt: '2026-07-23T01:00:01.000Z',
    failure: null,
    login: {
      attempts: [],
      completedAt: '2026-07-23T01:00:00.500Z',
      connectionBootstrap,
      operatorHandoff,
      outcome: 'interactive-operator-login',
      savedCredentials: null,
      startedAt: '2026-07-23T01:00:00.100Z',
    },
    lifecycle: {
      droppedCount: 0,
      events: [
        { at: '2026-07-23T01:00:00.005Z', kind: 'window-attached', phase: 'electron-launch', runnerCloseRequested: false, windowId: 1 },
        { at: '2026-07-23T01:00:00.700Z', kind: 'runner-close-requested', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-23T01:00:00.750Z', kind: 'window-closed', phase: 'electron-close', runnerCloseRequested: true, windowId: 1 },
        { at: '2026-07-23T01:00:00.800Z', kind: 'electron-context-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-23T01:00:00.850Z', kind: 'electron-app-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-23T01:00:00.900Z', code: 0, kind: 'electron-process-exit', phase: 'electron-close', runnerCloseRequested: true, signal: null },
      ],
      limit: 100,
      processExit: {
        at: '2026-07-23T01:00:00.900Z',
        code: 0,
        runnerCloseRequested: true,
        signal: null,
      },
      runnerCloseRequestedAt: '2026-07-23T01:00:00.700Z',
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
    startedAt: '2026-07-23T01:00:00.000Z',
    storeGate: {
      completedAt: '2026-07-23T01:00:00.050Z',
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'selected-existing-store',
      resultingSurface: 'login',
      selectedStore,
      startedAt: '2026-07-23T01:00:00.010Z',
    },
    timeline: [
      { at: '2026-07-23T01:00:00.000Z', phase: 'created' },
      { at: '2026-07-23T01:00:01.000Z', phase: 'completed' },
    ],
  };
}

function validPackageUiSession(profileId, { firstRun = false } = {}) {
  const diagnostics = validDiagnostics(profileId);
  return {
    connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
    loginSessionAttestation: {
      adsSessionReady: true,
      credentialPersistence: firstRun ? 'saved' : 'main_managed',
      credentialSource: firstRun ? 'typed' : 'saved',
      erpSessionReady: true,
      erpSessionReused: !firstRun,
      ok: true,
      sessionIdentityVerified: firstRun,
    },
    mode: 'interactive-operator-login',
    operatorHandoff: { ...diagnostics.login.operatorHandoff },
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

const PACKAGE_UI_USER_DATA_DIR = 'D:\\Temp\\amazon-ai-ops-package-ui\\profile-copy';
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

function validPackageUiDatabaseMutationAudit() {
  const metrics = {
    digestSha256: 'D'.repeat(64),
    serializedBytes: 18_000_000,
    totalChanges: 12,
    dataVersion: 1,
    pageCount: 4_500,
    pageSize: 4_096,
    schemaVersion: 9,
    userVersion: 9,
  };
  const checkpoints = [
    {
      sequence: 1,
      phase: 'post-bootstrap',
      capturedAt: '2026-07-23T01:00:00.600Z',
      contextDigestSha256: 'E'.repeat(64),
      metrics: { ...metrics },
    },
    {
      sequence: 2,
      phase: 'post-navigation',
      capturedAt: '2026-07-23T01:00:00.900Z',
      contextDigestSha256: 'E'.repeat(64),
      metrics: { ...metrics },
    },
    {
      sequence: 3,
      phase: 'pre-close-terminal',
      capturedAt: '2026-07-23T01:00:00.990Z',
      contextDigestSha256: 'E'.repeat(64),
      metrics: { ...metrics },
    },
  ];
  return {
    kind: 'package-ui-database-mutation-audit',
    schemaVersion: 1,
    requiredPhases: ['post-bootstrap', 'post-navigation', 'pre-close-terminal'],
    checkpoints,
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

function schedulerAuditSnapshot({ counts = {}, events = [] } = {}) {
  return {
    kind: 'package-ui-scheduler-audit',
    schemaVersion: 1,
    generatedAt: '2026-07-23T01:00:00.000Z',
    pid: 321,
    evidenceMode: 'package-ui',
    userDataDir: PACKAGE_UI_USER_DATA_DIR,
    policies: { runNow: 'reject' },
    counts: { ...EMPTY_SCHEDULER_COUNTS, ...counts },
    suppressed: {
      automaticReconcile: 0,
      localSchedulerStart: 1,
      startupReconcile: 1,
      storeSchedulerStart: 1,
    },
    guards: {
      localSchedulerStarted: false,
      storeCollectionSchedulerStarted: false,
      runNowIpcDisabled: true,
      startupReconcileSuppressed: true,
      automaticReconcileSuppressed: true,
      readOnlyInvariantPassed: true,
    },
    databaseMutationAudit: validPackageUiDatabaseMutationAudit(),
    events,
  };
}

function validSchedulerIdentityEvidence(scalePercent) {
  const schedulerSubview = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const requestId = `renderer-bootstrap-${scalePercent}-1`;
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
        capabilities: schedulerSubview.capabilities.map((capability) => ({
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
      heading: schedulerSubview.heading,
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
      selectedTabId: schedulerSubview.tabId,
      shellStoreId: SCHEDULER_CONTEXT.storeId,
      subview: schedulerSubview.subview,
      workspace: schedulerSubview.workspace,
    },
    ledgerBefore: schedulerAuditSnapshot(),
    ledgerAfter: schedulerAuditSnapshot({
      counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
      events,
    }),
  };
}

function validPackageUiReadOnlyRuntime(
  filePath,
  profileId,
  marker = validSchedulerIdentityEvidence(profileId).ledgerAfter,
) {
  const artifactRecord = writeArtifact(
    filePath,
    Buffer.from(JSON.stringify(marker), 'utf8'),
  );
  return packageUiEvidence.validatePackageUiReadOnlyRuntimeEvidence({
    artifact: artifactRecord,
    main: {
      evidenceMode: 'package-ui',
      pid: marker.pid,
      userDataDir: PACKAGE_UI_USER_DATA_DIR,
    },
    marker,
    processExitConfirmed: true,
    profileId,
  });
}

function validPackageUiRun(scale, screenshotRoot) {
  const schedulerSubview = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const firstRun = scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent;
  const profileId = `${scale.scalePercent}-compact`;
  const schedulerIdentityCapabilityEvidence = packageUiEvidence.validateSchedulerSubviewEvidence(
    validSchedulerIdentityEvidence(scale.scalePercent),
  );
  const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(
    path.join(
      screenshotRoot,
      `${scale.scalePercent}`,
      'runtime',
      'package-ui-scheduler-audit.json',
    ),
    profileId,
    schedulerIdentityCapabilityEvidence.ledgerAfter,
  );
  return {
    actualDeviceScaleFactor: scale.deviceScaleFactor,
    attemptArtifacts: validAttemptArtifacts(screenshotRoot, profileId),
    chromiumProcessLineage: validChromiumLineage(),
    consoleErrors: [],
    diagnostics: validDiagnostics(profileId),
    identity: { passed: true },
    overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => {
      const screenshot = writeArtifact(
        path.join(screenshotRoot, `${scale.scalePercent}`, 'overlays', `${id}.png`),
        screenshotBytes(`package-ui:${scale.scalePercent}:overlay:${id}`),
      );
      return {
        compositeEvidence: { passed: true },
        id,
        overlayVisibleAfterCapture: true,
        overlayVisibleBeforeCapture: true,
        passed: true,
        screenshot,
      };
    }),
    packageProcessIsolation: validProcessIsolation(),
    pageErrors: [],
    passed: true,
    profileProcessIsolation: validProcessIsolation(),
    scalePercent: scale.scalePercent,
    schedulerReadOnlyRuntime,
    databaseAuditCheckpoints: {
      postBootstrap: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[0],
      postNavigation: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[1],
    },
    session: validPackageUiSession(profileId, { firstRun }),
    screenshots: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace) => ({
      ...writeArtifact(
        path.join(screenshotRoot, `${scale.scalePercent}`, 'workspaces', `${workspace.workspace}.png`),
        screenshotBytes(`package-ui:${scale.scalePercent}:workspace:${workspace.workspace}`),
      ),
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    subviewChecks: [{
      ...schedulerSubview,
      compositeEvidence: { passed: true },
      identityCapabilityEvidence: schedulerIdentityCapabilityEvidence,
      passed: schedulerIdentityCapabilityEvidence.passed,
      screenshot: {
        ...writeArtifact(
          path.join(screenshotRoot, `${scale.scalePercent}`, 'subviews', 'settings-scheduler.png'),
          screenshotBytes(`package-ui:${scale.scalePercent}:subview:settings/scheduler`),
        ),
        subview: schedulerSubview.subview,
        workspace: schedulerSubview.workspace,
      },
      settleEvidence: { passed: true },
      violations: schedulerIdentityCapabilityEvidence.violations,
    }],
    viewport: { height: 700, width: 1200 },
    workspaceChecks: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace) => ({
      compositeEvidence: { passed: true },
      experienceEvidence: null,
      inspectorEvidence: null,
      keyboardEvidence: { passed: true },
      passed: true,
      settleEvidence: { passed: true },
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
  };
}

function validWideRun(screenshotRoot) {
  const profileId = PACKAGE_UI_WIDE_PROFILE.id;
  const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(
    path.join(screenshotRoot, 'wide', 'runtime', 'package-ui-scheduler-audit.json'),
    profileId,
  );
  return {
    actualDeviceScaleFactor: 1,
    attemptArtifacts: validAttemptArtifacts(screenshotRoot, profileId),
    chromiumProcessLineage: validChromiumLineage(),
    consoleErrors: [],
    diagnostics: validDiagnostics(profileId),
    identity: { passed: true },
    packageProcessIsolation: validProcessIsolation(),
    pageErrors: [],
    passed: true,
    profileId,
    profileProcessIsolation: validProcessIsolation(),
    screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
      ...writeArtifact(
        path.join(screenshotRoot, 'wide', 'workspaces', `${workspace.workspace}.png`),
        screenshotBytes(`package-ui:wide:workspace:${workspace.workspace}`),
      ),
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    schedulerReadOnlyRuntime,
    databaseAuditCheckpoints: {
      postBootstrap: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[0],
      postNavigation: schedulerReadOnlyRuntime.marker.databaseMutationAudit.checkpoints[1],
    },
    session: validPackageUiSession(profileId),
    viewport: { height: 900, width: 1400 },
    workspaceChecks: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
      compositeEvidence: { passed: true },
      experienceEvidence: null,
      inspectorEvidence: null,
      keyboardEvidence: { passed: true },
      passed: true,
      settleEvidence: { passed: true },
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
  };
}

function validPackageUiManifest(packageIdentity, screenshotRoot) {
  const runGroupId = `package-ui-readiness-${path.basename(screenshotRoot)}`;
  const runnerContract = buildPackageUiRunnerContract();
  const checkpointComposition = validCheckpointComposition(
    screenshotRoot,
    runGroupId,
    runnerContract.sha256,
  );
  return {
    kind: 'package-ui-evidence',
    schemaVersion: 7,
    generatedAt: '2026-07-23T01:00:00.000Z',
    interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
    isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    passed: true,
    artifactHashesStable: true,
    checkpointComposition,
    artifactsBefore: {
      exe: { sha256: packageIdentity.executableSha256 },
      appContent: { sha256: packageIdentity.appContentSha256 },
    },
    artifactsAfter: {
      exe: { sha256: packageIdentity.executableSha256 },
      appContent: { sha256: packageIdentity.appContentSha256 },
    },
    requested: {
      allowInteractiveLogin: true,
      allowSavedLogin: false,
      expectedExeSha256: packageIdentity.executableSha256,
      expectedAppContentSha256: packageIdentity.appContentSha256,
      interactiveLoginTimeoutMs: 600_000,
      loginMode: 'interactive-operator-each-run',
      resumeRunGroupId: null,
      runGroupId,
      subviewChecks: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    },
    packageProcessIsolation: validProcessIsolation(),
    profileDatabaseFileIsolation: { passed: true },
    profileDatabaseProvenance: { passed: true },
    profileLineage: {
      final: structuredClone(checkpointComposition.finalProfileState),
      passed: true,
    },
    profileProcessIsolation: validProcessIsolation(),
    protectedDatabase: { passed: true },
    protectedDatabaseLogical: {
      after: validLogicalArtifact(),
      before: validLogicalArtifact(),
      passed: true,
    },
    runGroup: {
      profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
      runGroupId,
      runnerContractSha256: runnerContract.sha256,
    },
    runs: EXPECTED_PACKAGE_UI_SCALES.map((scale) => validPackageUiRun(scale, screenshotRoot)),
    wideProfile: validWideRun(screenshotRoot),
    violations: [],
  };
}

function validSecurityEvidence(packageIdentity) {
  const checks = EXPECTED_PACKAGE_SECURITY_CHECK_CODES.map((code) => ({ code, passed: true }));
  return {
    kind: 'package-security-boundaries',
    schemaVersion: 1,
    generatedAt: '2026-07-23T01:01:00.000Z',
    passed: true,
    package: { ...packageIdentity },
    summary: { total: checks.length, passed: checks.length, failed: 0 },
    checks,
  };
}

function validAdversarialEvidence(packageIdentity) {
  return buildAdversarialNodeEnvEvidence({
    generatedAt: '2026-07-23T01:02:00.000Z',
    identityAfter: packageIdentity,
    identityBefore: packageIdentity,
    expected: { ...packageIdentity, rendererEntrySha256: HASH_C },
    processCleanup: { afterMatchingCount: 0, attempts: 1, beforeMatchingCount: 0, passed: true },
    runtime: {
      allDevToolsClosed: true,
      evidenceMode: 'package-launch-smoke',
      isPackaged: true,
      isolatedUserData: true,
      localhostDetected: false,
      nodeEnv: 'development',
      rendererEntrySha256: HASH_C,
      rendererExact: true,
      rendererScheme: 'file:',
      windowCount: 1,
    },
  });
}

function businessDates() {
  return ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-20', '2026-07-21'];
}

const storeFixtures = Object.freeze([
  Object.freeze({ storeId: 'store-us-east', browserProfileId: 'profile-us-east' }),
  Object.freeze({ storeId: 'store-us-west', browserProfileId: 'profile-us-west' }),
]);

function canaryDefinition(mode) {
  const manual = mode === 'manual_approval';
  const suffix = manual ? 'manual' : 'policy';
  const store = manual ? storeFixtures[0] : storeFixtures[1];
  const beforeBid = manual ? 100 : 95;
  const targetBid = manual ? 95 : 90;
  const authority = {
    storeId: store.storeId,
    browserProfileId: store.browserProfileId,
    issuerType: manual ? 'human' : 'policy',
    authorityId: `authority-${suffix}`,
    missionId: `mission-${suffix}`,
    missionRevision: 1,
    missionGrantId: `grant-${suffix}`,
    batchId: `batch-${suffix}`,
    jobId: `job-${suffix}`,
    proposalId: `proposal-${suffix}`,
    decisionId: `decision-${suffix}`,
    decisionRevision: 1,
    actionRevision: 1,
    policyVersionId: `policy-version-${suffix}-1`,
    policyRevision: 1,
  };
  const sourceAuthorityProofSha256 = sha256Text(`source-authority-proof:${suffix}`).toUpperCase();
  const object = {
    storeId: store.storeId,
    actionType: 'set_keyword_bid',
    identityVersionId: `identity-${suffix}`,
    canonicalKeywordId: `keyword-canonical-${suffix}`,
    adEntityId: `ad-entity-${suffix}`,
    entityRevision: 1,
    objectRevision: manual ? 4 : 5,
    adsAccountId: `ads-account-${suffix}`,
    campaignId: `campaign-${suffix}`,
    adGroupId: `ad-group-${suffix}`,
    keywordId: `keyword-${suffix}`,
    pageIdentityHash: sha256Text(`page-identity:${suffix}`).toUpperCase(),
    sourceAuthorityProofSha256,
    expectedBidCents: beforeBid,
    targetBidCents: targetBid,
  };
  return {
    authority,
    beforeBid,
    mode,
    object,
    scope: {
      storeId: store.storeId,
      browserProfileId: store.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
    },
    suffix,
    targetBid,
  };
}

function executionArtifactPath(storesRoot, { storeId, batchId, jobId, slot }) {
  return path.join(
    storesRoot,
    storeId.trim().toLowerCase(),
    'evidence',
    'ad-execution',
    `batch-${sha256Text(batchId.trim().toLowerCase()).slice(0, 24)}`,
    `job-${sha256Text(jobId.trim().toLowerCase()).slice(0, 24)}`,
    `${slot}.png`,
  );
}

function executionArtifactRef(binding) {
  return `artifact:execution:v1:${sha256Text(stableJson({
    batchId: binding.batchId,
    jobId: binding.jobId,
    slot: binding.slot,
    storeId: binding.storeId,
  }))}`;
}

function buildExecutionCanary(mode, storesRoot) {
  const definition = canaryDefinition(mode);
  const { authority, beforeBid, object, scope, suffix, targetBid } = definition;
  const minuteBase = mode === 'manual_approval' ? 4 : 14;
  const evidence = ['before', 'after', 'reload'].map((slot, index) => {
    const binding = { storeId: scope.storeId, batchId: authority.batchId, jobId: authority.jobId, slot };
    const artifactPath = executionArtifactPath(storesRoot, binding);
    const artifactRecord = writeArtifact(
      artifactPath,
      screenshotBytes(stableJson({
        schemaVersion: 'mission-control-execution-artifact/v1',
        ...binding,
        observedBidCents: slot === 'before' ? beforeBid : targetBid,
      })),
    );
    return {
      id: `${suffix}-${slot}`,
      ...binding,
      artifactPath,
      artifactRef: executionArtifactRef(binding),
      contentSha256: artifactRecord.sha256,
      sizeBytes: artifactRecord.sizeBytes,
      pageIdentityHash: object.pageIdentityHash,
      canonicalKeywordId: object.canonicalKeywordId,
      objectRevision: object.objectRevision,
      observedBidCents: slot === 'before' ? beforeBid : targetBid,
      capturedSessionGeneration: mode === 'manual_approval' ? 9 : 10,
      capturedAt: `2026-07-23T01:${String(minuteBase + index).padStart(2, '0')}:00.000Z`,
      createdAt: `2026-07-23T01:${String(minuteBase + index).padStart(2, '0')}:01.000Z`,
    };
  });
  return {
    kind: 'mission-control-execution-canary-evidence',
    schemaVersion: 'mission-control-execution-canary-evidence/v1',
    generatedAt: `2026-07-23T01:${mode === 'manual_approval' ? '21' : '23'}:00.000Z`,
    status: 'PASSED',
    passed: true,
    mode,
    storesRoot,
    scope,
    authority,
    object,
    execution: { status: 'succeeded', evidence },
  };
}

function installAuthoritySchema(database) {
  database.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY, browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL, currency TEXT NOT NULL, display_name TEXT NOT NULL,
      status TEXT NOT NULL, business_timezone TEXT NOT NULL,
      legacy_store_name_normalized TEXT, legacy_marketplace_code_normalized TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
    );
    CREATE TABLE lingxing_collection_jobs (
      store_id TEXT NOT NULL, job_id TEXT NOT NULL, request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL, marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      business_timezone TEXT NOT NULL, business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL, date_start TEXT NOT NULL, date_end TEXT NOT NULL,
      mode TEXT NOT NULL, report_types_json TEXT NOT NULL, state TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, last_event_id TEXT, last_event_emitted_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      blocker_code TEXT, detail TEXT, PRIMARY KEY (store_id, job_id)
    );
    CREATE TABLE lingxing_collection_report_checkpoints (
      store_id TEXT NOT NULL, job_id TEXT NOT NULL, report_type TEXT NOT NULL,
      state TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
      error_code TEXT, detail TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE lingxing_report_batches (
      id TEXT NOT NULL, store_id TEXT NOT NULL, business_date TEXT NOT NULL,
      request_id TEXT NOT NULL, browser_profile_id TEXT NOT NULL,
      session_generation INTEGER NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      PRIMARY KEY (store_id, id)
    );
    CREATE TABLE report_import_runs (
      store_id TEXT NOT NULL, run_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL, batch_id TEXT NOT NULL, status TEXT NOT NULL,
      source_file_count INTEGER NOT NULL, metric_row_count INTEGER NOT NULL,
      reconciliation_count INTEGER NOT NULL, started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE report_import_file_snapshots (
      store_id TEXT NOT NULL, run_id TEXT NOT NULL, report_type TEXT NOT NULL,
      batch_id TEXT NOT NULL, file_hash TEXT NOT NULL, file_path TEXT NOT NULL,
      file_name TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL, captured_at TEXT NOT NULL
    );
    CREATE TABLE report_import_reconciliations (
      store_id TEXT NOT NULL, run_id TEXT NOT NULL, report_type TEXT NOT NULL,
      batch_id TEXT NOT NULL, status TEXT NOT NULL,
      within_tolerance INTEGER NOT NULL, reconciled_at TEXT NOT NULL
    );
    CREATE TABLE verified_ad_entity_authority (
      authority_id TEXT PRIMARY KEY, store_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_name TEXT NOT NULL,
      campaign_name TEXT NOT NULL, ad_group_name TEXT NOT NULL, evidence_package_id TEXT NOT NULL,
      source_report_type TEXT NOT NULL, source_file_hash TEXT NOT NULL, source_row INTEGER NOT NULL,
      identity_source TEXT NOT NULL, proof_sha256 TEXT NOT NULL, verified_by TEXT NOT NULL,
      verified_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE ad_keyword_identity_versions (
      identity_version_id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL,
      currency TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL, ads_account_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
      ad_group_id TEXT NOT NULL, keyword_id TEXT NOT NULL, object_revision INTEGER NOT NULL,
      observed_bid_cents INTEGER NOT NULL, page_identity_hash TEXT NOT NULL,
      source_authority_id TEXT NOT NULL, source_authority_proof_sha256 TEXT NOT NULL,
      resolution_proof_sha256 TEXT NOT NULL, resolved_session_generation INTEGER NOT NULL,
      resolved_at TEXT NOT NULL, resolved_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE missions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL,
      currency TEXT NOT NULL, policy_version_id TEXT NOT NULL,
      status TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE policy_versions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, status TEXT NOT NULL,
      rules_json TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE policy_runtime (
      store_id TEXT NOT NULL, autonomy_mode TEXT NOT NULL, kill_switch INTEGER NOT NULL,
      circuit_breaker_state TEXT NOT NULL, active_policy_version_id TEXT NOT NULL
    );
    CREATE TABLE decisions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, mission_id TEXT NOT NULL,
      policy_version_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
      action_revision INTEGER NOT NULL, action_type TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
      valid_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE decision_history (
      id TEXT NOT NULL, store_id TEXT NOT NULL, decision_id TEXT NOT NULL,
      decision_revision INTEGER NOT NULL, event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE analysis_proposal_snapshots (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL,
      currency TEXT NOT NULL, mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL,
      policy_version_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
      action_revision INTEGER NOT NULL, action_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      ad_entity_authority_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      ad_entity_revision INTEGER NOT NULL, current_bid_cents INTEGER NOT NULL,
      proposed_bid_cents INTEGER NOT NULL, change_pct REAL NOT NULL,
      authorization_json TEXT NOT NULL, valid_until TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE analysis_proposal_decision_links (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
      decision_id TEXT NOT NULL
    );
    CREATE TABLE mission_grants (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL, decision_ids_json TEXT NOT NULL,
      action_revision INTEGER NOT NULL, allowed_action_types_json TEXT NOT NULL,
      allowed_ad_entity_ids_json TEXT NOT NULL, max_change_pct REAL NOT NULL,
      total_impact_budget REAL NOT NULL, expires_at TEXT NOT NULL, policy_version_id TEXT NOT NULL,
      policy_revision INTEGER NOT NULL, required_evidence_json TEXT NOT NULL,
      stop_conditions_json TEXT NOT NULL, issuer_type TEXT NOT NULL, issuer_actor_id TEXT NOT NULL,
      issued_at TEXT NOT NULL, created_session_generation INTEGER NOT NULL
    );
    CREATE TABLE mission_grant_events (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, grant_id TEXT NOT NULL,
      event_type TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE ad_execution_batches (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL, grant_id TEXT NOT NULL,
      action_revision INTEGER NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
      created_session_generation INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, terminal_at TEXT
    );
    CREATE TABLE ad_execution_jobs (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, batch_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      mission_id TEXT NOT NULL, grant_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
      decision_id TEXT NOT NULL, decision_revision INTEGER NOT NULL, action_revision INTEGER NOT NULL,
      action_type TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL, ads_account_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
      ad_group_id TEXT NOT NULL, keyword_id TEXT NOT NULL, object_revision INTEGER NOT NULL,
      page_identity_hash TEXT NOT NULL, expected_bid_cents INTEGER NOT NULL,
      target_bid_cents INTEGER NOT NULL, change_pct REAL NOT NULL, idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL, revision INTEGER NOT NULL, created_session_generation INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submit_intent_id TEXT,
      command_fingerprint TEXT, intent_written_at TEXT, submitted_at TEXT, terminal_at TEXT
    );
    CREATE TABLE ad_execution_evidence (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, batch_id TEXT NOT NULL, job_id TEXT NOT NULL,
      slot TEXT NOT NULL, artifact_ref TEXT NOT NULL, content_sha256 TEXT NOT NULL,
      page_identity_hash TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL, observed_bid_cents INTEGER NOT NULL,
      captured_session_generation INTEGER NOT NULL, captured_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}

function insertCanaryAuthority(database, canary) {
  const { authority, object, scope } = canary;
  const evidence = canary.execution.evidence;
  const sessionGeneration = evidence[0].capturedSessionGeneration;
  database.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type, entity_name,
      campaign_name, ad_group_name, evidence_package_id, source_report_type, source_file_hash,
      source_row, identity_source, proof_sha256, verified_by, verified_at, created_at
    ) VALUES (?, ?, ?, ?, 'keyword', ?, ?, ?, ?, 'keyword', ?, 1, 'ads_ui', ?, 'operator', ?, ?)
  `).run(
    authority.authorityId, scope.storeId, object.adEntityId, object.entityRevision,
    `keyword-${canary.mode}`, object.campaignId, object.adGroupId, `evidence-package-${canary.mode}`,
    sha256Text(`source-file:${canary.mode}`).toUpperCase(), object.sourceAuthorityProofSha256,
    '2026-07-23T01:00:00.000Z', '2026-07-23T01:00:00.000Z',
  );
  database.prepare(`
    INSERT INTO ad_keyword_identity_versions (
      identity_version_id, store_id, marketplace, currency, canonical_keyword_id, ad_entity_id,
      entity_revision, ads_account_id, campaign_id, ad_group_id, keyword_id, object_revision,
      observed_bid_cents, page_identity_hash, source_authority_id, source_authority_proof_sha256,
      resolution_proof_sha256, resolved_session_generation, resolved_at, resolved_by, created_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'operator', ?)
  `).run(
    object.identityVersionId, scope.storeId, object.canonicalKeywordId, object.adEntityId,
    object.entityRevision, object.adsAccountId, object.campaignId, object.adGroupId, object.keywordId,
    object.objectRevision, object.expectedBidCents, object.pageIdentityHash, authority.authorityId,
    object.sourceAuthorityProofSha256, sha256Text(`resolution:${canary.mode}`).toUpperCase(),
    sessionGeneration, '2026-07-23T01:01:00.000Z', '2026-07-23T01:01:00.000Z',
  );
  database.prepare(`
    INSERT INTO missions (
      id, store_id, marketplace, currency, policy_version_id, status, revision
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', ?)
  `).run(
    authority.missionId,
    scope.storeId,
    authority.policyVersionId,
    authority.missionRevision,
  );
  database.prepare(`
    INSERT INTO policy_versions (id, store_id, status, rules_json, revision)
    VALUES (?, ?, 'enabled', ?, ?)
  `).run(
    authority.policyVersionId,
    scope.storeId,
    JSON.stringify({ killSwitch: false }),
    authority.policyRevision,
  );
  database.prepare(`
    INSERT INTO policy_runtime (
      store_id, autonomy_mode, kill_switch, circuit_breaker_state, active_policy_version_id
    ) VALUES (?, ?, 0, 'closed', ?)
  `).run(scope.storeId, canary.mode, authority.policyVersionId);
  database.prepare(`
    INSERT INTO decisions (
      id, store_id, mission_id, policy_version_id, policy_revision, action_revision,
      action_type, ad_entity_id, status, revision, valid_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'set_keyword_bid', ?, 'approved', ?, ?, ?, ?)
  `).run(
    authority.decisionId,
    scope.storeId,
    authority.missionId,
    authority.policyVersionId,
    authority.policyRevision,
    authority.actionRevision,
    object.adEntityId,
    authority.decisionRevision,
    '2026-07-24T00:00:00.000Z',
    '2026-07-23T01:01:20.000Z',
    '2026-07-23T01:01:40.000Z',
  );
  database.prepare(`
    INSERT INTO decision_history (
      id, store_id, decision_id, decision_revision, event_type, created_at
    ) VALUES (?, ?, ?, ?, 'approved', ?)
  `).run(
    `decision-approved-${canary.mode}`,
    scope.storeId,
    authority.decisionId,
    authority.decisionRevision,
    '2026-07-23T01:01:30.000Z',
  );
  database.prepare(`
    INSERT INTO analysis_proposal_snapshots (
      id, store_id, marketplace, currency, mission_id, mission_revision,
      policy_version_id, policy_revision, action_revision, action_type, entity_type,
      ad_entity_authority_id, ad_entity_id, ad_entity_revision, current_bid_cents,
      proposed_bid_cents, change_pct, authorization_json, valid_until,
      created_session_generation, created_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, 'set_keyword_bid', 'keyword',
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    authority.proposalId,
    scope.storeId,
    authority.missionId,
    authority.missionRevision,
    authority.policyVersionId,
    authority.policyRevision,
    authority.actionRevision,
    authority.authorityId,
    object.adEntityId,
    object.entityRevision,
    object.expectedBidCents,
    object.targetBidCents,
    ((object.targetBidCents - object.expectedBidCents) / object.expectedBidCents) * 100,
    JSON.stringify({
      human: { eligible: true, blockers: [] },
      policy: { eligible: true, blockers: [] },
    }),
    '2026-07-24T00:00:00.000Z',
    sessionGeneration,
    '2026-07-23T01:01:10.000Z',
  );
  database.prepare(`
    INSERT INTO analysis_proposal_decision_links (
      id, store_id, proposal_id, decision_id
    ) VALUES (?, ?, ?, ?)
  `).run(
    `proposal-decision-link-${canary.mode}`,
    scope.storeId,
    authority.proposalId,
    authority.decisionId,
  );
  database.prepare(`
    INSERT INTO mission_grants (
      id, store_id, marketplace, currency, mission_id, mission_revision, decision_ids_json,
      action_revision, allowed_action_types_json, allowed_ad_entity_ids_json, max_change_pct,
      total_impact_budget, expires_at, policy_version_id, policy_revision, required_evidence_json,
      stop_conditions_json, issuer_type, issuer_actor_id, issued_at, created_session_generation
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, 10, 10, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    authority.missionGrantId, scope.storeId, authority.missionId, authority.missionRevision,
    JSON.stringify([authority.decisionId]), authority.actionRevision, JSON.stringify(['set_keyword_bid']),
    JSON.stringify([object.adEntityId]), '2026-07-24T00:00:00.000Z', authority.policyVersionId,
    authority.policyRevision,
    JSON.stringify(['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value']),
    JSON.stringify(['identity_drift', 'expected_before_mismatch', 'unknown_result', 'data_stale', 'impact_budget_exhausted', 'kill_switch']),
    authority.issuerType, `${authority.issuerType}-actor`, '2026-07-23T01:02:00.000Z', sessionGeneration,
  );
  const eventInsert = database.prepare(`
    INSERT INTO mission_grant_events (id, store_id, grant_id, event_type, actor_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  eventInsert.run(`${authority.missionGrantId}-issued`, scope.storeId, authority.missionGrantId, 'issued', `${authority.issuerType}-actor`, 'canary grant issued', '2026-07-23T01:02:00.000Z');
  eventInsert.run(`${authority.missionGrantId}-consumed`, scope.storeId, authority.missionGrantId, 'consumed', 'executor', 'canary execution succeeded', '2026-07-23T01:17:30.000Z');
  database.prepare(`
    INSERT INTO ad_execution_batches (
      id, store_id, marketplace, currency, mission_id, mission_revision, grant_id, action_revision,
      status, revision, created_session_generation, created_at, updated_at, terminal_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, 'succeeded', 4, ?, ?, ?, ?)
  `).run(
    authority.batchId, scope.storeId, authority.missionId, authority.missionRevision,
    authority.missionGrantId, authority.actionRevision, sessionGeneration,
    '2026-07-23T01:03:00.000Z', '2026-07-23T01:17:00.000Z', '2026-07-23T01:17:00.000Z',
  );
  database.prepare(`
    INSERT INTO ad_execution_jobs (
      id, store_id, batch_id, ordinal, mission_id, grant_id, proposal_id, decision_id,
      decision_revision, action_revision, action_type, canonical_keyword_id, ad_entity_id,
      entity_revision, ads_account_id, campaign_id, ad_group_id, keyword_id, object_revision,
      page_identity_hash, expected_bid_cents, target_bid_cents, change_pct, idempotency_key,
      status, revision, created_session_generation, created_at, updated_at, submit_intent_id,
      command_fingerprint, intent_written_at, submitted_at, terminal_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'set_keyword_bid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 7, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    authority.jobId, scope.storeId, authority.batchId, authority.missionId, authority.missionGrantId,
    authority.proposalId, authority.decisionId, authority.decisionRevision, authority.actionRevision,
    object.canonicalKeywordId, object.adEntityId, object.entityRevision, object.adsAccountId,
    object.campaignId, object.adGroupId, object.keywordId, object.objectRevision, object.pageIdentityHash,
    object.expectedBidCents, object.targetBidCents,
    ((object.targetBidCents - object.expectedBidCents) / object.expectedBidCents) * 100,
    sha256Text(`idempotency:${canary.mode}`).toUpperCase(), sessionGeneration,
    '2026-07-23T01:03:00.000Z', '2026-07-23T01:17:00.000Z', `intent-${canary.mode}`,
    sha256Text(`command:${canary.mode}`).toUpperCase(), '2026-07-23T01:03:30.000Z',
    canary.mode === 'manual_approval'
      ? '2026-07-23T01:04:30.000Z'
      : '2026-07-23T01:14:30.000Z',
    '2026-07-23T01:17:00.000Z',
  );
  const evidenceInsert = database.prepare(`
    INSERT INTO ad_execution_evidence (
      id, store_id, batch_id, job_id, slot, artifact_ref, content_sha256, page_identity_hash,
      canonical_keyword_id, object_revision, observed_bid_cents, captured_session_generation,
      captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const record of evidence) {
    evidenceInsert.run(
      record.id, record.storeId, record.batchId, record.jobId, record.slot, record.artifactRef,
      record.contentSha256, record.pageIdentityHash, record.canonicalKeywordId,
      record.objectRevision, record.observedBidCents, record.capturedSessionGeneration,
      record.capturedAt, record.createdAt,
    );
  }
}

function createAuthorityDatabase(databasePath, canaries) {
  const database = new Database(databasePath);
  try {
    installAuthoritySchema(database);
    const insertStore = database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name, status,
        business_timezone, created_at, updated_at
      ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
    `);
    for (const store of storeFixtures) {
      insertStore.run(store.storeId, store.browserProfileId, store.storeId, '2026-07-13T00:00:00.000Z', '2026-07-23T00:00:00.000Z');
    }
    const insertJob = database.prepare(`
      INSERT INTO lingxing_collection_jobs (
        store_id, job_id, request_id, browser_profile_id, marketplace, currency,
        business_timezone, business_date, session_generation, date_start, date_end, mode,
        report_types_json, state, snapshot_json, created_at, updated_at, completed_at,
        blocker_code, detail
      ) VALUES (?, ?, ?, ?, 'US', 'USD', 'America/Los_Angeles', ?, 9, ?, ?,
        'create-and-download', ?, 'completed', '{}', ?, ?, ?, NULL, NULL)
    `);
    const insertCheckpoint = database.prepare(`
      INSERT INTO lingxing_collection_report_checkpoints
        (store_id, job_id, report_type, state, file_size_bytes, error_code, detail, updated_at)
      VALUES (?, ?, ?, 'downloaded', ?, NULL, 'downloaded', ?)
    `);
    const insertBatch = database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, store_id, business_date, request_id, browser_profile_id,
        session_generation, status, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 9, 'completed', ?, ?)
    `);
    const insertRun = database.prepare(`
      INSERT INTO report_import_runs
        (store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
         source_file_count, metric_row_count, reconciliation_count,
         started_at, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 8, 80, 8, ?, ?, ?)
    `);
    const insertFile = database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, run_id, report_type, batch_id, file_hash, file_path,
        file_name, file_size_bytes, imported_rows, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, ?)
    `);
    const insertReconciliation = database.prepare(`
      INSERT INTO report_import_reconciliations (
        store_id, run_id, report_type, batch_id, status, within_tolerance, reconciled_at
      ) VALUES (?, ?, ?, ?, 'matched', 1, ?)
    `);
    for (const store of storeFixtures) {
      for (const [index, businessDate] of businessDates().entries()) {
        const timestamp = `${businessDate}T16:00:00.000Z`;
        const jobId = `${store.storeId}-job-${index}`;
        const runId = `${store.storeId}-run-${index}`;
        insertJob.run(
          store.storeId, jobId, `${store.storeId}-request-${index}`,
          store.browserProfileId, businessDate, businessDate, businessDate,
          JSON.stringify(EXPECTED_REPORT_TYPES), timestamp, timestamp, timestamp,
        );
        insertBatch.run(
          jobId,
          store.storeId,
          businessDate,
          `${store.storeId}-request-${index}`,
          store.browserProfileId,
          timestamp,
          timestamp,
        );
        insertRun.run(
          store.storeId, runId, `${store.storeId}-idem-${index}`,
          sha256Text(`${store.storeId}:${businessDate}:fingerprint`).toUpperCase(), jobId,
          timestamp, timestamp, timestamp,
        );
        for (const reportType of EXPECTED_REPORT_TYPES) {
          const reportPath = path.join(
            path.dirname(databasePath),
            'stores',
            store.storeId,
            'reports',
            businessDate,
            `${reportType}.csv`,
          );
          const reportArtifact = writeArtifact(
            reportPath,
            `${store.storeId},${businessDate},${reportType},${runId}\n`,
          );
          insertCheckpoint.run(
            store.storeId,
            jobId,
            reportType,
            reportArtifact.sizeBytes,
            timestamp,
          );
          insertFile.run(
            store.storeId,
            runId,
            reportType,
            jobId,
            reportArtifact.sha256,
            reportPath,
            path.basename(reportPath),
            reportArtifact.sizeBytes,
            timestamp,
          );
          insertReconciliation.run(store.storeId, runId, reportType, jobId, timestamp);
        }
      }
    }
    for (const canary of canaries) insertCanaryAuthority(database, canary);
  } finally {
    database.close();
  }
}

function validContinuousOperationEvidence(databasePath, authoritySnapshot) {
  const dates = businessDates();
  const input = {
    stores: storeFixtures.map((store) => store.storeId),
    dates,
    dateFrom: dates[0],
    dateTo: dates.at(-1),
    generatedAt: '2026-07-23T01:19:00.000Z',
    storesRoot: authoritySnapshot.storesRoot,
  };
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrityCheck = database.pragma('integrity_check').map((row) => String(row.integrity_check));
    const result = evaluateContinuousOperationSnapshot(readContinuousOperationSnapshot(database, input), input);
    if (!result.passed) throw new Error(`continuous fixture is invalid: ${JSON.stringify(result.violations)}`);
    return buildContinuousOperationManifest(databasePath, input, result, integrityCheck, authoritySnapshot);
  } finally {
    database.close();
  }
}

function attachCanaryDatabaseProof(canary, databasePath) {
  const databaseArtifact = artifact(databasePath);
  const evidenceIds = canary.execution.evidence.map((record) => record.id);
  const queryExecutedAt = canary.mode === 'manual_approval'
    ? '2026-07-23T01:20:00.000Z'
    : '2026-07-23T01:22:00.000Z';
  canary.database = {
    absolutePath: databasePath,
    sha256: databaseArtifact.sha256,
    sizeBytes: databaseArtifact.sizeBytes,
    integrityCheck: ['ok'],
    openedReadOnly: true,
    authorityProof: {
      queryContract: EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT,
      queryExecutedAt,
      databaseSha256: databaseArtifact.sha256,
      passed: true,
      recordIdentity: {
        storeId: canary.scope.storeId,
        browserProfileId: canary.scope.browserProfileId,
        authorityId: canary.authority.authorityId,
        identityVersionId: canary.object.identityVersionId,
        missionGrantId: canary.authority.missionGrantId,
        batchId: canary.authority.batchId,
        jobId: canary.authority.jobId,
        canonicalKeywordId: canary.object.canonicalKeywordId,
        objectRevision: canary.object.objectRevision,
        evidenceIds,
      },
    },
  };
  return canary;
}

function passingEvidenceChain(tempDir) {
  const canonicalPackage = createCanonicalPackageFixture(tempDir);
  const {
    executablePath: unpackedPath, portablePath, installerPath, packageIdentity,
  } = canonicalPackage;
  const sourceDatabasePath = path.join(tempDir, 'live-appdata', 'amazon-ai-ops.db');
  const authoritySnapshotRoot = path.join(tempDir, 'authority-snapshots');
  const databasePath = path.join(authoritySnapshotRoot, 'authority-snapshot.db');
  const storesRoot = path.join(path.dirname(sourceDatabasePath), 'stores');
  const packageUiScreenshotRoot = path.join(tempDir, 'package-ui-screenshots');
  const manualCanary = buildExecutionCanary('manual_approval', storesRoot);
  const policyCanary = buildExecutionCanary('policy_auto', storesRoot);
  fs.mkdirSync(path.dirname(sourceDatabasePath), { recursive: true });
  fs.mkdirSync(authoritySnapshotRoot, { recursive: true });
  createAuthorityDatabase(sourceDatabasePath, [manualCanary, policyCanary]);
  const sourceWriter = new Database(sourceDatabasePath);
  sourceWriter.pragma('journal_mode = WAL');
  sourceWriter.pragma('wal_autocheckpoint = 0');
  sourceWriter.pragma('wal_checkpoint(TRUNCATE)');
  sourceWriter.close();
  const onlineBackup = runReadonlySqliteOnlineBackupSync({
    sourceDatabasePath,
    destinationPath: databasePath,
    ownedTempRoot: authoritySnapshotRoot,
  });
  const snapshotWriter = new Database(databasePath, { readonly: true, fileMustExist: true });
  const snapshotTotalPages = Number(snapshotWriter.pragma('page_count', { simple: true }));
  snapshotWriter.close();
  attachCanaryDatabaseProof(manualCanary, databasePath);
  attachCanaryDatabaseProof(policyCanary, databasePath);
  const paths = {
    finalReadiness: path.join(tempDir, 'final-readiness.json'),
    packageLaunch: path.join(tempDir, 'package-launch.json'),
    packageUi: path.join(tempDir, 'package-ui.json'),
    packageSecurity: path.join(tempDir, 'package-security.json'),
    packageAdversarial: path.join(tempDir, 'package-adversarial.json'),
    continuousOperation: path.join(tempDir, 'continuous-operation.json'),
    manualCanary: path.join(tempDir, 'manual-canary.json'),
    policyCanary: path.join(tempDir, 'policy-canary.json'),
    evidenceManifest: path.join(tempDir, 'v15-evidence-manifest.json'),
    authoritySnapshotManifest: path.join(authoritySnapshotRoot, 'snapshot-manifest.json'),
    sourceDatabase: sourceDatabasePath,
    database: databasePath,
    storesRoot,
  };
  const sourceArtifact = artifact(sourceDatabasePath);
  const sourceStat = fs.statSync(sourceDatabasePath);
  const snapshotArtifact = artifact(databasePath);
  writeJson(paths.authoritySnapshotManifest, {
    kind: 'mission-control-authority-database-snapshot',
    schemaVersion: 'mission-control-authority-database-snapshot/v2',
    exportedAt: '2026-07-23T01:18:00.000Z',
    backup: {
      method: 'sqlite-online-backup',
      startedAt: '2026-07-23T01:17:59.000Z',
      completedAt: '2026-07-23T01:18:00.000Z',
      completed: true,
      totalPages: onlineBackup.observedBackup.totalPages || snapshotTotalPages,
      remainingPages: onlineBackup.observedBackup.remainingPages,
    },
    source: {
      absolutePath: sourceDatabasePath,
      realPath: fs.realpathSync.native(sourceDatabasePath),
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
      artifactBefore: {
        sha256: sourceArtifact.sha256,
        sizeBytes: sourceArtifact.sizeBytes,
        mtimeMs: sourceStat.mtimeMs,
      },
      artifactAfter: {
        sha256: sourceArtifact.sha256,
        sizeBytes: sourceArtifact.sizeBytes,
        mtimeMs: sourceStat.mtimeMs,
      },
    },
    snapshot: {
      absolutePath: databasePath,
      realPath: fs.realpathSync.native(databasePath),
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
      sha256: snapshotArtifact.sha256,
      sizeBytes: snapshotArtifact.sizeBytes,
    },
    packageIdentity,
  });
  const snapshotManifestSha256 = sha256File(paths.authoritySnapshotManifest);
  for (const canary of [manualCanary, policyCanary]) {
    canary.packageIdentity = { ...packageIdentity };
    canary.database.packageIdentity = { ...packageIdentity };
    canary.database.snapshotManifestSha256 = snapshotManifestSha256;
  }
  writeJson(paths.evidenceManifest, { kind: 'v15-final-readiness-evidence-manifest' });
  const packageLaunch = writeValidPackageLaunchSmoke(tempDir, {
    evidencePath: paths.packageLaunch,
    generatedAt: '2026-07-23T01:00:00.000Z',
    portablePath,
    releaseDir: canonicalPackage.releaseRoot,
    unpackedPath,
  });
  writeJson(paths.packageUi, validPackageUiManifest(packageIdentity, packageUiScreenshotRoot));
  writeJson(paths.packageSecurity, validSecurityEvidence(packageIdentity));
  writeJson(paths.packageAdversarial, validAdversarialEvidence(packageIdentity));
  const continuousEvidence = validContinuousOperationEvidence(databasePath, {
    manifestPath: paths.authoritySnapshotManifest,
    packageIdentity,
    snapshotManifestSha256,
    storesRoot,
  });
  continuousEvidence.generatedAt = '2026-07-23T01:19:00.000Z';
  continuousEvidence.packageIdentity = { ...packageIdentity };
  continuousEvidence.database.packageIdentity = { ...packageIdentity };
  continuousEvidence.database.snapshotManifestSha256 = snapshotManifestSha256;
  writeJson(paths.continuousOperation, continuousEvidence);
  writeJson(paths.manualCanary, manualCanary);
  writeJson(paths.policyCanary, policyCanary);

  const packages = [
    packageIndexArtifact('installer', installerPath),
    packageIndexArtifact('portable', portablePath),
  ];
  const finalReadiness = {
    generatedAt: '2026-07-23T01:08:00.000Z',
    evidenceSelection: { mode: 'manifest', manifestPath: paths.evidenceManifest },
    manifestDriven: true,
    status: 'APP_NEEDS_WORK',
    appReady: false,
    allGatesPass: false,
    formalAllGatesPass: false,
    missing: ['Legacy manual Ads UI readback is not credited for the Stage 7 app executor.'],
    actionItems: ['Use the explicit manual and policy-auto Stage 7 canaries for the production decision.'],
    failures: [{
      gateId: 'real-ad-execution-readback',
      code: 'GATE_FAILED',
      message: 'Legacy manual Ads UI readback is not credited for the Stage 7 app executor.',
      evidencePath: path.join(tempDir, 'real-ad-execution-readback.json'),
    }],
    packageIndex: {
      present: true,
      count: 2,
      existingCount: 2,
      missingCount: 0,
      releaseDir: canonicalPackage.releaseRoot,
      error: null,
      packages,
    },
    currentPortablePackage: packages[1],
    packageLaunchSmoke: {
      present: true,
      evidencePath: paths.packageLaunch,
      selectedBy: 'explicit-arg',
      generatedAt: packageLaunch.generatedAt,
      passed: true,
      artifacts: packageLaunch.artifacts,
      checks: packageLaunch.checks,
    },
    packageAdversarialNodeEnv: {
      contractVersion: 'package-adversarial-node-env/v1',
      present: true,
      evidencePath: paths.packageAdversarial,
      selectedBy: 'explicit-arg',
      requiredForDeliverySafety: true,
      passed: true,
      evidenceSha256: sha256File(paths.packageAdversarial),
      package: { ...packageIdentity },
    },
    gates: V15_GATE_IDS.map((id) => ({
      id,
      name: id,
      status: id === 'real-ad-execution-readback' ? 'needs_work' : 'passed',
      ok: id !== 'real-ad-execution-readback',
      evidencePath: id === 'package-launch-smoke' ? paths.packageLaunch : path.join(tempDir, `${id}.json`),
      message: id === 'real-ad-execution-readback'
        ? 'Legacy manual Ads UI readback is superseded by the two Stage 7 execution canaries.'
        : 'passed',
    })),
  };
  writeJson(paths.finalReadiness, finalReadiness);
  paths.verificationContext = {
    nowMs: Date.parse('2026-07-23T02:00:00.000Z'),
    releaseRoot: canonicalPackage.releaseRoot,
    executablePath: canonicalPackage.executablePath,
    appContentPath: canonicalPackage.appContentPath,
    mainBundlePath: canonicalPackage.mainBundlePath,
    authorityDbPath: sourceDatabasePath,
    authorityDbError: null,
    authoritySnapshotRoot,
  };
  return { packageIdentity, paths, manualCanary, policyCanary };
}

function refreshAuthoritySnapshotBindings(paths) {
  const snapshotArtifact = artifact(paths.database);
  const snapshotManifest = readJson(paths.authoritySnapshotManifest);
  snapshotManifest.snapshot.sha256 = snapshotArtifact.sha256;
  snapshotManifest.snapshot.sizeBytes = snapshotArtifact.sizeBytes;
  snapshotManifest.snapshot.realPath = fs.realpathSync.native(paths.database);
  writeJson(paths.authoritySnapshotManifest, snapshotManifest);
  const snapshotManifestSha256 = sha256File(paths.authoritySnapshotManifest);

  for (const evidencePath of [paths.continuousOperation, paths.manualCanary, paths.policyCanary]) {
    const evidence = readJson(evidencePath);
    evidence.database.sha256 = snapshotArtifact.sha256;
    evidence.database.sizeBytes = snapshotArtifact.sizeBytes;
    evidence.database.snapshotManifestSha256 = snapshotManifestSha256;
    if (evidence.database.authorityProof) {
      evidence.database.authorityProof.databaseSha256 = snapshotArtifact.sha256;
    }
    if (evidence.authoritySnapshotManifest) {
      evidence.authoritySnapshotManifest.sha256 = snapshotManifestSha256;
    }
    writeJson(evidencePath, evidence);
  }
  return { snapshotArtifact, snapshotManifestSha256 };
}

function mutateAuthoritySnapshot(paths, mutateDatabase) {
  const database = new Database(paths.database);
  try {
    mutateDatabase(database);
  } finally {
    database.close();
  }
  return refreshAuthoritySnapshotBindings(paths);
}

function writeFullyReadyV15Baseline(paths) {
  const readiness = readJson(paths.finalReadiness);
  readiness.status = 'APP_READY';
  readiness.appReady = true;
  readiness.allGatesPass = true;
  readiness.formalAllGatesPass = true;
  readiness.missing = [];
  readiness.actionItems = [];
  readiness.failures = [];
  readiness.gates = readiness.gates.map((gate) => ({
    ...gate,
    status: 'passed',
    ok: true,
    message: 'passed',
  }));
  writeJson(paths.finalReadiness, readiness);
}

function writeInvalidV15FailureSet(paths, failedGateIds) {
  const readiness = readJson(paths.finalReadiness);
  const failures = failedGateIds.map((gateId) => ({
    gateId,
    code: 'GATE_FAILED',
    message: `Legacy gate ${gateId} failed.`,
    evidencePath: readiness.gates.find((gate) => gate.id === gateId)?.evidencePath ?? null,
  }));
  readiness.status = 'APP_NEEDS_WORK';
  readiness.appReady = false;
  readiness.allGatesPass = false;
  readiness.formalAllGatesPass = false;
  readiness.missing = failures.map((failure) => failure.message);
  readiness.failures = failures;
  readiness.gates = readiness.gates.map((gate) => {
    const failed = failedGateIds.includes(gate.id);
    return {
      ...gate,
      status: failed ? 'needs_work' : 'passed',
      ok: !failed,
      message: failed ? `Legacy gate ${gate.id} failed.` : 'passed',
    };
  });
  writeJson(paths.finalReadiness, readiness);
}

function verifierArgs(paths, outputPath) {
  const args = [
    '--v15-final-readiness', paths.finalReadiness,
    '--package-launch-smoke', paths.packageLaunch,
    '--package-ui-manifest', paths.packageUi,
    '--package-security-evidence', paths.packageSecurity,
    '--package-adversarial-node-env-evidence', paths.packageAdversarial,
    '--s7-continuous-operation-evidence', paths.continuousOperation,
    '--manual-canary-evidence', paths.manualCanary,
    '--policy-auto-canary-evidence', paths.policyCanary,
    '--authority-snapshot-manifest', paths.authoritySnapshotManifest,
    '--authority-db', paths.sourceDatabase,
    '--out', outputPath,
  ];
  args.verificationContext = paths.verificationContext;
  return args;
}

describe('Mission Control production readiness CLI', () => {
  it('is exposed through the Stage 7 root package script', () => {
    const packageJson = readJson(path.join(root, 'package.json'));
    expect(packageJson.scripts['verify:s7-production-readiness']).toBe(
      'node scripts/verify-mission-control-production-readiness.js',
    );
  });

  it('writes APP_NEEDS_WORK with every gate when explicit evidence inputs are missing', () => {
    const tempDir = makeTempDir('mission-control-readiness-missing-');
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(['--out', outputPath]);

    expect(result.status).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);
    const report = readJson(outputPath);
    expect(report).toMatchObject({
      kind: 'mission-control-production-readiness',
      schemaVersion: 'mission-control-production-readiness/v1',
      status: 'APP_NEEDS_WORK',
      appReady: false,
      allGatesPass: false,
      evidenceSelection: {
        explicitOnly: true,
        latestFallbackUsed: false,
      },
      summary: { total: 8, passed: 0, failed: 8 },
    });
    expect(report.gates).toHaveLength(8);
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'v15-final-readiness', ok: false, status: 'missing', evidencePath: null }),
      expect.objectContaining({ id: 'policy-auto-canary', ok: false, status: 'missing', evidencePath: null }),
    ]));
    expect(report.gates.every((gate) => typeof gate.reason === 'string' && gate.reason.includes('explicit'))).toBe(true);
  });

  it('writes APP_READY when the sole legacy 7/8 readback failure is superseded by both DB-backed canaries', () => {
    const tempDir = makeTempDir('mission-control-readiness-pass-');
    const { packageIdentity, paths } = passingEvidenceChain(tempDir);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const report = readJson(outputPath);
    expect(report).toMatchObject({
      status: 'APP_READY',
      appReady: true,
      allGatesPass: true,
      packageIdentity,
      summary: { total: 8, passed: 8, failed: 0 },
    });
    expect(report.gates).toHaveLength(8);
    expect(report.gates.every((gate) => gate.ok === true && gate.status === 'passed')).toBe(true);
    expect(report.gates.every((gate) => path.isAbsolute(gate.evidencePath))).toBe(true);
    expect(report.gates.find((gate) => gate.id === 'v15-final-readiness')).toEqual(expect.objectContaining({
      supersededBy: ['manual-canary', 'policy-auto-canary'],
    }));
    const snapshotManifest = readJson(paths.authoritySnapshotManifest);
    expect(snapshotManifest.source.artifactAfter.sha256).not.toBe(snapshotManifest.snapshot.sha256);
  });

  it('rejects package launch evidence when a required native runtime proof is deleted', () => {
    const tempDir = makeTempDir('mission-control-readiness-launch-proof-');
    const { paths } = passingEvidenceChain(tempDir);
    const launch = readJson(paths.packageLaunch);
    delete launch.checks.find((check) => check.kind === 'portable').runtimeProcess;
    writeJson(paths.packageLaunch, launch);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'package-launch',
        ok: false,
        reason: expect.stringMatching(/strict contract|runtime process|PACKAGE_LAUNCH/i),
      }),
    ]));
  });

  it('also accepts a genuine legacy 8/8 APP_READY baseline', () => {
    const tempDir = makeTempDir('mission-control-readiness-v15-ready-');
    const { paths } = passingEvidenceChain(tempDir);
    writeFullyReadyV15Baseline(paths);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readJson(outputPath)).toMatchObject({
      status: 'APP_READY',
      appReady: true,
      allGatesPass: true,
      summary: { total: 8, passed: 8, failed: 0 },
    });
  });

  it.each([
    ['a different sole legacy failure', ['listing-ai-draft']],
    ['an additional legacy failure', ['real-ad-execution-readback', 'listing-ai-draft']],
  ])('rejects %s instead of treating it as Stage 7 supersession', (_label, failedGateIds) => {
    const tempDir = makeTempDir('mission-control-readiness-v15-failure-');
    const { paths } = passingEvidenceChain(tempDir);
    writeInvalidV15FailureSet(paths, failedGateIds);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'v15-final-readiness',
        ok: false,
        reason: expect.stringMatching(/legacy|7\/8|readback|failure/i),
      }),
    ]));
  });

  it('fails closed when explicitly selected package evidence has a mismatched executable hash', () => {
    const tempDir = makeTempDir('mission-control-readiness-hash-');
    const { paths } = passingEvidenceChain(tempDir);
    const security = readJson(paths.packageSecurity);
    security.package.executableSha256 = HASH_A;
    writeJson(paths.packageSecurity, security);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    const report = readJson(outputPath);
    expect(report.status).toBe('APP_NEEDS_WORK');
    expect(report.packageIdentity.executableSha256).toBe(sha256File(paths.verificationContext.executablePath));
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'package-security',
        ok: false,
        reason: expect.stringMatching(/executableSha256.*does not match/i),
      }),
    ]));
  });

  it('rejects a package UI screenshot whose current bytes no longer match its manifest', () => {
    const tempDir = makeTempDir('mission-control-readiness-ui-stale-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.packageUi);
    fs.appendFileSync(manifest.runs[0].screenshots[0].path, Buffer.from('tampered'));
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'package-ui',
        ok: false,
        reason: expect.stringMatching(/workspace screenshot files are missing or stale/i),
      }),
    ]));
  });

  it('rejects historical v5/v6 package UI evidence and a stale scheduler subview screenshot', () => {
    for (const schemaVersion of [5, 6]) {
      const legacyDir = makeTempDir(`mission-control-readiness-ui-v${schemaVersion}-`);
      const legacy = passingEvidenceChain(legacyDir);
      const legacyManifest = readJson(legacy.paths.packageUi);
      legacyManifest.schemaVersion = schemaVersion;
      writeJson(legacy.paths.packageUi, legacyManifest);
      const legacyOutput = path.join(legacyDir, 'readiness.json');

      expect(runVerifier(verifierArgs(legacy.paths, legacyOutput)).status).toBe(1);
      expect(readJson(legacyOutput).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'package-ui',
          ok: false,
          reason: expect.stringMatching(/schema v7/i),
        }),
      ]));
    }

    const staleDir = makeTempDir('mission-control-readiness-ui-subview-stale-');
    const stale = passingEvidenceChain(staleDir);
    const staleManifest = readJson(stale.paths.packageUi);
    fs.appendFileSync(
      staleManifest.runs[0].subviewChecks[0].screenshot.path,
      Buffer.from('tampered-scheduler-subview'),
    );
    const staleOutput = path.join(staleDir, 'readiness.json');

    expect(runVerifier(verifierArgs(stale.paths, staleOutput)).status).toBe(1);
    expect(readJson(staleOutput).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'package-ui',
        ok: false,
        reason: expect.stringMatching(/read-only subview screenshot files are missing or stale/i),
      }),
    ]));
  });

  it.each([
    [
      'that enables saved-login automation instead of the visible handoff',
      (manifest) => {
        manifest.requested.allowInteractiveLogin = false;
        manifest.requested.allowSavedLogin = true;
        manifest.requested.loginMode = 'app-owned-saved-login';
      },
      /INTERACTIVE_LOGIN_REQUEST_CONTRACT_MISMATCH|visible operator handoff/i,
    ],
    [
      'whose first 100% run lacks fresh typed-and-saved identity proof',
      (manifest) => {
        manifest.runs[0].session.loginSessionAttestation = {
          adsSessionReady: true,
          credentialPersistence: 'main_managed',
          credentialSource: 'saved',
          erpSessionReady: true,
          erpSessionReused: true,
          ok: true,
          sessionIdentityVerified: false,
        };
      },
      /INTERACTIVE_LOGIN_FIRST_RUN_TYPED_PROOF_MISSING|typed-and-saved/i,
    ],
    [
      'whose wide run omits its own interactive operator handoff',
      (manifest) => {
        manifest.wideProfile.session.mode = 'existing-authenticated-session';
        delete manifest.wideProfile.session.operatorHandoff;
        manifest.wideProfile.diagnostics.login.outcome = 'existing-authenticated-session';
        delete manifest.wideProfile.diagnostics.login.operatorHandoff;
      },
      /WIDE_INTERACTIVE_LOGIN_HANDOFF_MISSING|own visible operator handoff/i,
    ],
  ])('rejects schema v7 package UI evidence %s', (_caseName, mutateManifest, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-ui-interactive-contract-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.packageUi);
    mutateManifest(manifest);
    writeJson(paths.packageUi, manifest);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'package-ui',
        ok: false,
        reason: expect.stringMatching(reasonPattern),
      }),
    ]));
  });

  it('rejects canary JSON that omits its read-only authority database proof', () => {
    const tempDir = makeTempDir('mission-control-readiness-canary-db-proof-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    delete canary.database.authorityProof;
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/authority query contract|authorityProof/i),
      }),
    ]));
  });

  it('rejects a Store Capsule artifact mutated after the canary manifest was written', () => {
    const tempDir = makeTempDir('mission-control-readiness-artifact-stale-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    fs.appendFileSync(canary.execution.evidence[0].artifactPath, Buffer.from('tampered'));
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'policy-auto-canary',
        ok: false,
        reason: expect.stringMatching(/current artifact SHA-256 does not match/i),
      }),
    ]));
  });

  it('rejects a canary artifact path redirected outside its deterministic Store Capsule', () => {
    const tempDir = makeTempDir('mission-control-readiness-artifact-outside-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    const outsidePath = path.join(tempDir, 'outside-capsule', 'before.png');
    fs.mkdirSync(path.dirname(outsidePath), { recursive: true });
    fs.copyFileSync(canary.execution.evidence[0].artifactPath, outsidePath);
    canary.execution.evidence[0].artifactPath = outsidePath;
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/deterministic Store Capsule path/i),
      }),
    ]));
  });

  it('rejects a canary evidence row altered in JSON while the authority DB is unchanged', () => {
    const tempDir = makeTempDir('mission-control-readiness-canary-db-mismatch-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    canary.execution.evidence[1].createdAt = '2026-07-23T01:15:02.000Z';
    writeJson(paths.policyCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'policy-auto-canary',
        ok: false,
        reason: expect.stringMatching(/JSON evidence does not match the authority DB record/i),
      }),
    ]));
  });

  it.each([
    [
      'a missing MissionGrant',
      (database) => database.prepare('DELETE FROM mission_grants WHERE id = ?').run('grant-manual'),
      /MissionGrant must resolve to exactly one authority DB row/i,
    ],
    [
      'a duplicate MissionGrant',
      (database) => database.exec(`
        CREATE TABLE mission_grants_copy AS SELECT * FROM mission_grants;
        DROP TABLE mission_grants;
        ALTER TABLE mission_grants_copy RENAME TO mission_grants;
        INSERT INTO mission_grants SELECT * FROM mission_grants WHERE id = 'grant-manual';
      `),
      /MissionGrant must resolve to exactly one authority DB row/i,
    ],
    [
      'a duplicate execution job in the selected batch',
      (database) => database.exec(`
        CREATE TABLE ad_execution_jobs_copy AS SELECT * FROM ad_execution_jobs;
        DROP TABLE ad_execution_jobs;
        ALTER TABLE ad_execution_jobs_copy RENAME TO ad_execution_jobs;
        INSERT INTO ad_execution_jobs SELECT * FROM ad_execution_jobs WHERE id = 'job-manual';
      `),
      /single execution job must resolve to exactly one authority DB row/i,
    ],
    [
      'a duplicate policy runtime',
      (database) => database.exec(`
        INSERT INTO policy_runtime SELECT * FROM policy_runtime WHERE store_id = 'store-us-east';
      `),
      /policy runtime must resolve to exactly one authority DB row/i,
    ],
    [
      'a missing Mission authority table',
      (database) => database.exec('DROP TABLE missions;'),
      /no such table: missions/i,
    ],
  ])('rejects authority snapshots with %s', (_caseName, mutateDatabase, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-authority-exact-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, mutateDatabase);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(reasonPattern),
      }),
    ]));
  });

  it.each([
    [
      'a deleted approval',
      (database) => database.prepare(`
        DELETE FROM decision_history WHERE decision_id = ?
      `).run('decision-manual'),
    ],
    [
      'a duplicate approval',
      (database) => database.exec(`
        INSERT INTO decision_history
        SELECT * FROM decision_history WHERE decision_id = 'decision-manual';
      `),
    ],
    [
      'an approval forged for another decision revision',
      (database) => database.prepare(`
        UPDATE decision_history SET decision_revision = ?
        WHERE decision_id = ?
      `).run(2, 'decision-manual'),
    ],
  ])('rejects authority snapshots with %s in decision_history', (_caseName, mutateDatabase) => {
    const tempDir = makeTempDir('mission-control-readiness-decision-approval-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, mutateDatabase);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/decision approval history.*exactly one|missing, duplicated, or not exact/i),
      }),
    ]));
  });

  it.each([
    [
      'a stale immutable proposal',
      (database) => database.prepare(`
        UPDATE analysis_proposal_snapshots SET created_at = ?
        WHERE id = ?
      `).run('2026-07-19T01:01:10.000Z', 'proposal-manual'),
    ],
    [
      'an approval recorded after the MissionGrant was issued',
      (database) => database.prepare(`
        UPDATE decision_history SET created_at = ?
        WHERE decision_id = ?
      `).run('2026-07-23T01:02:30.000Z', 'decision-manual'),
    ],
  ])('rejects authorization chain with %s', (_caseName, mutateDatabase) => {
    const tempDir = makeTempDir('mission-control-readiness-authorization-time-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, mutateDatabase);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/authorization\/captured\/terminal.*stale|replayed|out of order/i),
      }),
    ]));
  });

  it('rejects an authority source whose selected live DB is not named amazon-ai-ops.db', () => {
    const tempDir = makeTempDir('mission-control-readiness-authority-name-');
    const { paths } = passingEvidenceChain(tempDir);
    const renamedSource = path.join(path.dirname(paths.sourceDatabase), 'renamed-authority.db');
    fs.renameSync(paths.sourceDatabase, renamedSource);
    paths.sourceDatabase = renamedSource;
    paths.verificationContext.authorityDbPath = renamedSource;
    const snapshot = readJson(paths.authoritySnapshotManifest);
    snapshot.source.absolutePath = renamedSource;
    snapshot.source.realPath = fs.realpathSync.native(renamedSource);
    writeJson(paths.authoritySnapshotManifest, snapshot);
    refreshAuthoritySnapshotBindings(paths);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/amazon-ai-ops\.db filename/i),
      }),
    ]));
  });

  it('rejects canary evidence whose DB execution was created in another browser session generation', () => {
    const tempDir = makeTempDir('mission-control-readiness-cross-session-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, (database) => {
      database.prepare(`
        UPDATE ad_execution_jobs SET created_session_generation = ?
        WHERE id = ?
      `).run(999, 'job-manual');
    });
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/session generation.*capturedSessionGeneration/i),
      }),
    ]));
  });

  it('rejects a self-reported storesRoot outside snapshot source USER_DATA_DIR/stores', () => {
    const tempDir = makeTempDir('mission-control-readiness-stores-root-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    canary.storesRoot = path.join(tempDir, 'wrong-stores-root');
    fs.mkdirSync(canary.storesRoot, { recursive: true });
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/canonical USER_DATA_DIR\/stores/i),
      }),
    ]));
  });

  it('rejects a hash-matching fake screenshot that is not a PNG with IHDR', () => {
    const tempDir = makeTempDir('mission-control-readiness-fake-png-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    const before = canary.execution.evidence.find((record) => record.slot === 'before');
    fs.writeFileSync(before.artifactPath, Buffer.alloc(64, 0x41));
    before.contentSha256 = sha256File(before.artifactPath);
    before.sizeBytes = fs.statSync(before.artifactPath).size;
    writeJson(paths.manualCanary, canary);
    mutateAuthoritySnapshot(paths, (database) => {
      database.prepare(`
        UPDATE ad_execution_evidence SET content_sha256 = ? WHERE id = ?
      `).run(before.contentSha256, before.id);
    });
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/PNG.*IHDR/i),
      }),
    ]));
  });

  it('rejects a fresh snapshot/export that attempts to wash an execution older than 72 hours', () => {
    const tempDir = makeTempDir('mission-control-readiness-old-execution-');
    const { paths } = passingEvidenceChain(tempDir);
    const snapshot = readJson(paths.authoritySnapshotManifest);
    snapshot.backup.startedAt = '2026-07-27T01:19:59.000Z';
    snapshot.backup.completedAt = '2026-07-27T01:20:00.000Z';
    snapshot.exportedAt = snapshot.backup.completedAt;
    writeJson(paths.authoritySnapshotManifest, snapshot);
    for (const [canaryPath, generatedAt, queryExecutedAt] of [
      [paths.manualCanary, '2026-07-27T01:31:00.000Z', '2026-07-27T01:30:00.000Z'],
      [paths.policyCanary, '2026-07-27T01:33:00.000Z', '2026-07-27T01:32:00.000Z'],
    ]) {
      const canary = readJson(canaryPath);
      canary.generatedAt = generatedAt;
      canary.database.authorityProof.queryExecutedAt = queryExecutedAt;
      writeJson(canaryPath, canary);
    }
    const continuous = readJson(paths.continuousOperation);
    continuous.generatedAt = '2026-07-27T01:21:00.000Z';
    writeJson(paths.continuousOperation, continuous);
    refreshAuthoritySnapshotBindings(paths);
    paths.verificationContext.nowMs = Date.parse('2026-07-27T02:00:00.000Z');
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        reason: expect.stringMatching(/authorization\/captured\/terminal.*stale|replayed/i),
      }),
      expect.objectContaining({
        id: 'policy-auto-canary',
        ok: false,
        reason: expect.stringMatching(/authorization\/captured\/terminal.*stale|replayed/i),
      }),
    ]));
  });

  it('rejects a continuous-operation outcome altered in the manifest but not in SQLite', () => {
    const tempDir = makeTempDir('mission-control-readiness-continuous-db-mismatch-');
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    continuous.stores[0].days[0].blockerDetail = 'Fabricated replacement blocker detail.';
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 's7-continuous-operation',
        ok: false,
        reason: expect.stringMatching(/canonical stores\/dates\/outcomes do not match/i),
      }),
    ]));
  });

  it('rejects continuous-operation recomputation with a self-reported non-canonical storesRoot', () => {
    const tempDir = makeTempDir('mission-control-readiness-continuous-stores-root-');
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    continuous.storesRoot = path.join(tempDir, 'wrong-continuous-stores-root');
    fs.mkdirSync(continuous.storesRoot, { recursive: true });
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 's7-continuous-operation',
        ok: false,
        reason: expect.stringMatching(/storesRoot.*canonical.*USER_DATA_DIR\/stores/i),
      }),
    ]));
  });

  it.each([
    ['generatedAt', /generatedAt|validation failed closed/i],
    ['storesRoot', /storesRoot|validation failed closed/i],
  ])('rejects continuous-operation evidence with required %s deleted', (field, reasonPattern) => {
    const tempDir = makeTempDir(`mission-control-readiness-continuous-missing-${field}-`);
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    delete continuous[field];
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 's7-continuous-operation',
        ok: false,
        reason: expect.stringMatching(reasonPattern),
      }),
    ]));
  });

  it('rechecks retained Store Capsule files before finalizing APP_READY', () => {
    const tempDir = makeTempDir('mission-control-readiness-store-capsule-toctou-');
    const { paths } = passingEvidenceChain(tempDir);
    const database = new Database(paths.database, { readonly: true, fileMustExist: true });
    const { file_path: reportFilePath } = database.prepare(`
      SELECT file_path
      FROM report_import_file_snapshots
      ORDER BY file_path ASC
      LIMIT 1
    `).get();
    database.close();
    paths.verificationContext.beforeFinalEvidenceRecheck = () => {
      fs.appendFileSync(reportFilePath, 'changed-before-final-readiness-write');
    };
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    const report = readJson(outputPath);
    expect(report).toMatchObject({
      status: 'APP_NEEDS_WORK',
      appReady: false,
      allGatesPass: false,
      summary: { total: 8, passed: 7, failed: 1 },
    });
    expect(report).not.toHaveProperty('_verifiedFileArtifacts');
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 's7-continuous-operation',
        ok: false,
        reason: expect.stringMatching(/Store Capsule TOCTOU.*changed after continuous-operation verification/i),
      }),
    ]));
  });

  it.each([
    ['kind', (canary) => { canary.kind = 'generic-pass'; }, /kind is invalid/],
    ['passed state', (canary) => { canary.passed = false; }, /did not pass/],
    ['US\/USD scope', (canary) => { canary.scope.currency = 'EUR'; }, /must be US\/USD/],
    ['Profile authority binding', (canary) => { canary.authority.browserProfileId = 'foreign-profile'; }, /same store\/Profile/],
    ['reload value', (canary) => { canary.execution.evidence[2].observedBidCents += 1; }, /values are inconsistent/],
  ])('rejects policy-auto canary evidence with an invalid %s contract', (_label, mutate, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-canary-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    mutate(canary);
    writeJson(paths.policyCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    const report = readJson(outputPath);
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'policy-auto-canary', ok: false, reason: expect.stringMatching(reasonPattern) }),
    ]));
  });

  it('rejects a seven-date continuous-operation claim that includes a weekend', () => {
    const tempDir = makeTempDir('mission-control-readiness-weekend-');
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    continuous.window.businessDates[5] = '2026-07-18';
    for (const store of continuous.stores) store.days[5].businessDate = '2026-07-18';
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 's7-continuous-operation',
        ok: false,
        reason: expect.stringMatching(/weekend or invalid US business date/i),
      }),
    ]));
  });

  it('does not expose a CLI fixture override that can make a temporary EXE and hand-made SQLite READY', () => {
    const tempDir = makeTempDir('mission-control-readiness-production-anchor-');
    const { paths } = passingEvidenceChain(tempDir);
    const outputPath = path.join(tempDir, 'readiness.json');
    const args = verifierArgs(paths, outputPath);
    delete args.verificationContext;

    const result = runVerifier(args);

    expect(result.status).toBe(1);
    expect(readJson(outputPath)).toMatchObject({ status: 'APP_NEEDS_WORK', appReady: false });
  });

  it('rejects canonical packaged app content changed after package evidence capture', () => {
    const tempDir = makeTempDir('mission-control-readiness-app-content-tamper-');
    const { paths } = passingEvidenceChain(tempDir);
    fs.appendFileSync(paths.verificationContext.mainBundlePath, '\n// tampered');
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'package-security', ok: false, reason: expect.stringMatching(/canonical|recomputed|mainBundleSha256/i) }),
    ]));
  });

  it.each([
    ['stale', '2026-07-01T00:00:00.000Z'],
    ['future', '2026-07-24T00:00:00.000Z'],
  ])('rejects a %s canary manifest replay', (_label, generatedAt) => {
    const tempDir = makeTempDir('mission-control-readiness-canary-replay-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    canary.generatedAt = generatedAt;
    writeJson(paths.policyCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'policy-auto-canary', ok: false, reason: expect.stringMatching(/future|stale|order|timestamp/i) }),
    ]));
  });

  it('rejects operational evidence bound to another package identity', () => {
    const tempDir = makeTempDir('mission-control-readiness-operational-package-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    canary.packageIdentity.mainBundleSha256 = HASH_A;
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manual-canary', ok: false, reason: expect.stringMatching(/packageIdentity|current canonical package/i) }),
    ]));
  });

  it('rejects an authority snapshot manifest that claims a non-canonical hand-made database source', () => {
    const tempDir = makeTempDir('mission-control-readiness-fake-authority-db-');
    const { paths } = passingEvidenceChain(tempDir);
    const fakeSource = path.join(tempDir, 'fake-authority.db');
    fs.copyFileSync(paths.database, fakeSource);
    const manifest = readJson(paths.authoritySnapshotManifest);
    manifest.source.absolutePath = fakeSource;
    manifest.source.realPath = fs.realpathSync.native(fakeSource);
    writeJson(paths.authoritySnapshotManifest, manifest);
    const manifestSha = sha256File(paths.authoritySnapshotManifest);
    for (const evidencePath of [paths.continuousOperation, paths.manualCanary, paths.policyCanary]) {
      const evidence = readJson(evidencePath);
      evidence.database.snapshotManifestSha256 = manifestSha;
      writeJson(evidencePath, evidence);
    }
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).authoritySnapshot.reason).toMatch(/canonical live AppData database|source realpath/i);
  });

  it('rejects legacy v1 authority snapshot manifests instead of silently applying the old equal-hash contract', () => {
    const tempDir = makeTempDir('mission-control-readiness-authority-v1-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.authoritySnapshotManifest);
    manifest.schemaVersion = 'mission-control-authority-database-snapshot/v1';
    manifest.source.sha256 = manifest.snapshot.sha256;
    writeJson(paths.authoritySnapshotManifest, manifest);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).authoritySnapshot).toEqual(expect.objectContaining({
      ok: false,
      reason: expect.stringMatching(/v2.*v1.*fail-closed/i),
    }));
  });

  it('rejects an authority snapshot after the canonical live database drifts from artifactAfter', () => {
    const tempDir = makeTempDir('mission-control-readiness-live-authority-drift-');
    const { paths } = passingEvidenceChain(tempDir);
    fs.appendFileSync(paths.sourceDatabase, 'live-database-drift-after-snapshot-export');
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    const report = readJson(outputPath);
    expect(report.authoritySnapshot).toEqual(expect.objectContaining({
      ok: false,
      reason: expect.stringMatching(/live source bytes\/size\/mtime drifted after snapshot export/i),
    }));
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 's7-continuous-operation', ok: false }),
      expect.objectContaining({ id: 'manual-canary', ok: false }),
      expect.objectContaining({ id: 'policy-auto-canary', ok: false }),
    ]));
  });

  it('rejects an old authority snapshot after a committed WAL-only live change', () => {
    const tempDir = makeTempDir('mission-control-readiness-live-wal-drift-');
    const { paths } = passingEvidenceChain(tempDir);
    const database = new Database(paths.sourceDatabase);
    try {
      database.pragma('wal_autocheckpoint = 0');
      database.pragma('wal_checkpoint(TRUNCATE)');
      const mainBefore = artifact(paths.sourceDatabase);
      const mainMtimeBefore = fs.statSync(paths.sourceDatabase).mtimeMs;
      database.exec(`
        CREATE TABLE authority_currentness_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_currentness_drift VALUES ('grant-1', 1);
      `);
      expect(fs.statSync(`${paths.sourceDatabase}-wal`).size).toBeGreaterThan(0);
      expect(artifact(paths.sourceDatabase)).toEqual(mainBefore);
      expect(fs.statSync(paths.sourceDatabase).mtimeMs).toBe(mainMtimeBefore);
      const outputPath = path.join(tempDir, 'readiness.json');

      expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
      const report = readJson(outputPath);
      expect(report.authoritySnapshot).toEqual(expect.objectContaining({
        ok: false,
        currentness: expect.objectContaining({
          method: 'readonly-sqlite-online-backup',
          passed: false,
        }),
        reason: expect.stringMatching(/online backup does not match the selected authority snapshot/i),
      }));
      expect(report.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 's7-continuous-operation', ok: false }),
        expect.objectContaining({ id: 'manual-canary', ok: false }),
        expect.objectContaining({ id: 'policy-auto-canary', ok: false }),
      ]));
    } finally {
      database.close();
    }
  });

  it('rechecks WAL-aware live authority currentness before the final report write', () => {
    const tempDir = makeTempDir('mission-control-readiness-live-wal-toctou-');
    const { paths } = passingEvidenceChain(tempDir);
    let database;
    paths.verificationContext.beforeFinalEvidenceRecheck = () => {
      database = new Database(paths.sourceDatabase);
      database.pragma('wal_autocheckpoint = 0');
      database.pragma('wal_checkpoint(TRUNCATE)');
      database.exec(`
        CREATE TABLE authority_finalization_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_finalization_drift VALUES ('grant-1', 1);
      `);
    };
    const outputPath = path.join(tempDir, 'readiness.json');
    try {
      expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
      const report = readJson(outputPath);
      expect(report.authoritySnapshot).toEqual(expect.objectContaining({
        ok: false,
        currentness: expect.objectContaining({
          beforeFinalWriteCapturedAt: null,
          passed: false,
        }),
        reason: expect.stringMatching(/before-final-report-write.*failed closed|online backup does not match/i),
      }));
      expect(report.status).toBe('APP_NEEDS_WORK');
    } finally {
      if (database) database.close();
    }
  });

  it.each([
    [
      'an incomplete online backup',
      (manifest) => {
        manifest.backup.remainingPages = 1;
        manifest.backup.completed = false;
      },
      /completion|remaining pages/i,
    ],
    [
      'a package identity from another release',
      (manifest) => {
        manifest.packageIdentity.mainBundleSha256 = HASH_A;
      },
      /current canonical package identity/i,
    ],
    [
      'source bytes that changed during the online backup',
      (manifest) => {
        manifest.source.artifactBefore.sha256 = HASH_A;
      },
      /artifactBefore and artifactAfter.*unchanged live database/i,
    ],
  ])('rejects an authority snapshot manifest with %s', (_label, mutate, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-authority-contract-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.authoritySnapshotManifest);
    mutate(manifest);
    writeJson(paths.authoritySnapshotManifest, manifest);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).authoritySnapshot.reason).toMatch(reasonPattern);
  });

  it('rejects changed snapshot bytes and a snapshot that escapes the canonical evidence root', () => {
    const tamperDir = makeTempDir('mission-control-readiness-authority-tamper-');
    const tampered = passingEvidenceChain(tamperDir);
    fs.appendFileSync(tampered.paths.database, 'tampered-after-manifest');
    const tamperOutput = path.join(tamperDir, 'readiness.json');

    expect(runVerifier(verifierArgs(tampered.paths, tamperOutput)).status).toBe(1);
    expect(readJson(tamperOutput).authoritySnapshot.reason).toMatch(/bytes are missing, linked, or stale/i);

    const escapeDir = makeTempDir('mission-control-readiness-authority-escape-');
    const escaped = passingEvidenceChain(escapeDir);
    const escapedDatabase = path.join(escapeDir, 'outside-authority-snapshot.db');
    fs.copyFileSync(escaped.paths.database, escapedDatabase);
    const escapedArtifact = artifact(escapedDatabase);
    const manifest = readJson(escaped.paths.authoritySnapshotManifest);
    manifest.snapshot.absolutePath = escapedDatabase;
    manifest.snapshot.realPath = fs.realpathSync.native(escapedDatabase);
    manifest.snapshot.sha256 = escapedArtifact.sha256;
    manifest.snapshot.sizeBytes = escapedArtifact.sizeBytes;
    writeJson(escaped.paths.authoritySnapshotManifest, manifest);
    const escapeOutput = path.join(escapeDir, 'readiness.json');

    expect(runVerifier(verifierArgs(escaped.paths, escapeOutput)).status).toBe(1);
    expect(readJson(escapeOutput).authoritySnapshot.reason).toMatch(/outside|escapes the canonical snapshot root/i);
  });

  it('requires the explicit live authority DB selector even when an injected test context knows a DB path', () => {
    const tempDir = makeTempDir('mission-control-readiness-authority-selector-');
    const { paths } = passingEvidenceChain(tempDir);
    const outputPath = path.join(tempDir, 'readiness.json');
    const args = verifierArgs(paths, outputPath);
    const authorityDbIndex = args.indexOf('--authority-db');
    args.splice(authorityDbIndex, 2);

    expect(runVerifier(args).status).toBe(1);
    expect(readJson(outputPath)).toMatchObject({
      inputContractPassed: false,
      inputErrors: expect.arrayContaining([expect.stringMatching(/--authority-db/i)]),
    });
  });

  it('rejects a selected evidence JSON with more than one filesystem hard link', () => {
    const tempDir = makeTempDir('mission-control-readiness-hardlink-');
    const { paths } = passingEvidenceChain(tempDir);
    const linkedPath = path.join(tempDir, 'manual-canary-hardlink.json');
    fs.linkSync(paths.manualCanary, linkedPath);
    paths.manualCanary = linkedPath;
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manual-canary', ok: false, reason: expect.stringMatching(/filesystem link/i) }),
    ]));
  });

  it('rejects a continuous window whose first business day predates the current package build date', () => {
    const tempDir = makeTempDir('mission-control-readiness-old-window-');
    const { paths } = passingEvidenceChain(tempDir);
    paths.verificationContext.nowMs = Date.parse('2026-07-23T02:00:00.000Z');
    const builtAt = new Date('2026-07-15T00:30:00.000Z');
    const touchTree = (target) => {
      if (fs.statSync(target).isDirectory()) for (const name of fs.readdirSync(target)) touchTree(path.join(target, name));
      fs.utimesSync(target, builtAt, builtAt);
    };
    touchTree(paths.verificationContext.releaseRoot);
    const outputPath = path.join(tempDir, 'readiness.json');

    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 's7-continuous-operation', ok: false, reason: expect.stringMatching(/business window predates/i) }),
    ]));
  });

  it('still writes APP_NEEDS_WORK when one explicitly selected JSON file is malformed', () => {
    const tempDir = makeTempDir('mission-control-readiness-malformed-');
    const { paths } = passingEvidenceChain(tempDir);
    fs.writeFileSync(paths.manualCanary, '{ invalid-json', 'utf8');
    const outputPath = path.join(tempDir, 'readiness.json');

    const result = runVerifier(verifierArgs(paths, outputPath));

    expect(result.status).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'manual-canary',
        ok: false,
        status: 'needs_work',
        evidencePath: paths.manualCanary,
        reason: expect.stringMatching(/could not be read/i),
      }),
    ]));
  });
});
