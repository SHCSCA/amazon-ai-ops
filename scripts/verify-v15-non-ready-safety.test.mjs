import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import {
  createValidAdReadbackEvidence,
  writeAdReadbackAuthorityDb,
} from './ad-readback-authority-db.test-fixture.mjs';
import {
  bundleAdversarialNodeEnvEvidence,
  writeValidAdversarialNodeEnvEvidence,
} from './package-adversarial-node-env.test-fixture.mjs';
import { writeValidPackageLaunchSmoke } from './package-launch-smoke.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');
const PACKAGE_MAIN_BUNDLE_SHA256 = 'C'.repeat(64);
const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const require = createRequire(import.meta.url);
const {
  packageUiReferencedArtifactsAreBundled,
} = require('./verify-v15-non-ready-safety.js');
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
  evaluatePackageUiEvidenceCompleteness,
  validatePackageUiReadOnlyRuntimeEvidence,
  validateSchedulerSubviewEvidence,
  writeImmutableEnvelope,
} = require('./package-ui-evidence.js');

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function artifactRecord(filePath) {
  return {
    path: filePath,
    sizeBytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
  };
}

function writeValidReadbackWithDb(fixtureDir, evidencePath) {
  const evidence = createValidAdReadbackEvidence(fixtureDir);
  writeJson(evidencePath, evidence);
  return writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), evidence);
}

function writeReadme(filePath, status = 'IN_PROGRESS') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `# Fixture\n\n**DELIVERY: ${status}.** Fixture README for non-ready safety tests.\n`, 'utf8');
  return filePath;
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(path.basename(filePath), 'utf8'),
  ]));
  return filePath;
}

function writeReport(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'placeholder report file for non-ready safety readback verifier\n', 'utf8');
  return filePath;
}

function sha256Text(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function finalPackageIndex(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const installerContent = 'installer package fixture\n';
  const portableContent = 'portable package fixture\n';
  const installerPath = path.join(dir, 'AmazonAIOpsAgent-1.5.0.exe');
  const portablePath = path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  fs.writeFileSync(installerPath, installerContent, 'utf8');
  fs.writeFileSync(portablePath, portableContent, 'utf8');
  const installerStat = fs.statSync(installerPath);
  const portableStat = fs.statSync(portablePath);
  return {
    generatedAt: '2026-07-16T08:06:00.000Z',
    present: true,
    count: 2,
    existingCount: 2,
    missingCount: 0,
    releaseDir: dir,
    error: null,
    copyPolicy: 'Installer and portable EXE binaries are not copied into readiness evidence; this index records local paths, existence, size, and SHA-256.',
    packages: [
      {
        kind: 'installer',
        sourcePath: installerPath,
        fileName: 'AmazonAIOpsAgent-1.5.0.exe',
        exists: true,
        sizeBytes: Buffer.byteLength(installerContent, 'utf8'),
        sha256: sha256Text(installerContent),
        modifiedAt: installerStat.mtime.toISOString(),
      },
      {
        kind: 'portable',
        sourcePath: portablePath,
        fileName: 'AmazonAIOpsAgent-1.5.0-portable.exe',
        exists: true,
        sizeBytes: Buffer.byteLength(portableContent, 'utf8'),
        sha256: sha256Text(portableContent),
        modifiedAt: portableStat.mtime.toISOString(),
      },
    ],
  };
}

function validPackageLaunchSmoke(dir, portablePackage) {
  const portablePath = portablePackage?.sourcePath || path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  return writeValidPackageLaunchSmoke(dir, {
    generatedAt: '2026-07-16T08:07:10.078Z',
    portablePath,
    releaseDir: dir,
  });
}

function validPackageSecurityEvidence(smoke, packageUi) {
  const checks = [
    'PACKAGE_EXECUTABLE_HASH_MATCH',
    'PACKAGE_APP_CONTENT_HASH_MATCH',
    'PACKAGE_MAIN_BUNDLE_HASH_VALID',
    'NAVIGATION_SECURITY_MARKER_PRESENT',
    'LEGACY_LOGIN_MIGRATION_MARKER_PRESENT',
    'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT',
    'NAVIGATION_GUARDS_WIRED',
    'LEGACY_SAVED_PASSWORD_IPC_ABSENT',
    'DIRECT_EXTERNAL_URL_FORWARDING_ABSENT',
    'PLAINTEXT_CREDENTIAL_WRITER_ABSENT',
    'SQLITE_VERBOSE_LOGGING_ABSENT',
  ].map((code) => ({ code, passed: true }));
  return {
    kind: 'package-security-boundaries',
    schemaVersion: 1,
    generatedAt: '2026-07-16T08:09:30.000Z',
    passed: true,
    package: {
      executableSha256: smoke.artifacts.unpacked.sha256,
      appContentSha256: packageUi.artifactsAfter.appContent.sha256,
      mainBundleSha256: PACKAGE_MAIN_BUNDLE_SHA256,
    },
    summary: { total: checks.length, passed: checks.length, failed: 0 },
    checks,
  };
}

function validProcessIsolation(profilePath = null) {
  const snapshot = {
    error: null,
    matching: [],
    matchingCount: 0,
    observedCount: 0,
    passed: true,
    unresolved: [],
    unresolvedCount: 0,
    ...(profilePath ? { profilePath } : {}),
  };
  return {
    before: snapshot,
    after: { ...snapshot, attempts: 1 },
    passed: true,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validLogicalSqliteArtifact(sha256 = HASH_A, sizeBytes = 4096) {
  return {
    method: 'readonly-sqlite-online-backup',
    remainingPages: 0,
    schemaVersion: 'sqlite-authority-currentness-proof/v1',
    sha256,
    sizeBytes,
    totalPages: 1,
  };
}

function validProfileLineageState(logicalDatabase) {
  return {
    capturedAt: '2026-07-16T08:08:20.100Z',
    logicalDatabase: structuredClone(logicalDatabase),
    profileContent: {
      fileCount: 3,
      sha256: HASH_B,
      sizeBytes: 8192,
    },
  };
}

function validAttemptArtifacts(dir, profileId) {
  const attemptRoot = path.join(dir, 'package-ui-attempts', profileId);
  fs.mkdirSync(attemptRoot, { recursive: true });
  fs.writeFileSync(
    path.join(attemptRoot, `${profileId}-runtime.json`),
    `${JSON.stringify({ profileId, status: 'completed' })}\n`,
    'utf8',
  );
  writePng(path.join(attemptRoot, `${profileId}-workspace.png`));
  return buildPackageUiAttemptArtifactManifest(attemptRoot);
}

function validChromiumLineage(profileBrowserUserDataDir, chromiumArtifact) {
  const profilePathBindingSha256 = sha256Text(path.resolve(profileBrowserUserDataDir));
  const profileBindingSha256 = sha256Text(canonicalJson([profilePathBindingSha256]));
  const chromiumPath = path.join(
    path.dirname(path.dirname(profileBrowserUserDataDir)),
    'release',
    'win-unpacked',
    'resources',
    'app',
    'playwright-browsers',
    'chrome-win64',
    'chrome.exe',
  );
  return {
    chromium: {
      relativePath: 'playwright-browsers/chrome-win64/chrome.exe',
      sha256: chromiumArtifact.sha256,
      sizeBytes: chromiumArtifact.sizeBytes,
    },
    cleanup: {
      error: null,
      matching: [],
      matchingCount: 0,
      observedCount: 0,
      passed: true,
      unresolved: [],
      unresolvedCount: 0,
      attempts: 1,
    },
    descendantProcessIds: [902],
    expectedProfileRootSha256: HASH_B,
    observedAt: '2026-07-16T08:08:19.500Z',
    passed: true,
    profileBindingSha256,
    profileBindingTokenCount: 1,
    rootProcessIds: [901],
    snapshot: {
      error: null,
      expectedProfileRootSha256: HASH_B,
      matching: [
        {
          executablePath: chromiumPath,
          name: 'chrome.exe',
          parentProcessId: 900,
          processId: 901,
          profileMatched: true,
          profilePathBindingSha256,
        },
        {
          executablePath: chromiumPath,
          name: 'chrome.exe',
          parentProcessId: 901,
          processId: 902,
          profileMatched: false,
          profilePathBindingSha256: null,
        },
      ],
      matchingCount: 2,
      observedCount: 2,
      passed: true,
      profileBindingSha256,
      profileBindingTokenCount: 1,
      rootProcessIds: [901],
      unresolved: [],
      unresolvedCount: 0,
    },
  };
}

function validCheckpointComposition(
  dir,
  runGroupId,
  runnerContractSha256,
  finalProfileState,
  packageLineage,
) {
  const checkpointDir = path.join(dir, 'package-ui-checkpoints');
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
      path.join(checkpointDir, `${profileId}.json`),
      payload,
    );
    const envelope = JSON.parse(fs.readFileSync(file.path, 'utf8'));
    return {
      file,
      payloadSha256: envelope.payloadSha256,
      profileId,
    };
  });
  return {
    checkpointRecords,
    finalProfileState: structuredClone(finalProfileState),
    packageLineage: structuredClone(packageLineage),
    passed: true,
    runGroupId,
    runnerContractSha256,
  };
}

function validOperatorHandoff() {
  return {
    automationReadSecrets: false,
    automationTypedSecrets: false,
    completedAt: '2026-07-16T08:08:09.400Z',
    durationClock: 'performance.now',
    elapsedMs: 300,
    finalPhase: 'authorization',
    kind: 'visible-user-handoff',
    maximumTotalTimeoutMs: 1_200_000,
    outcome: 'workspace-reached',
    phaseTimeoutMs: 600_000,
    phaseTransitions: [
      { elapsedMs: 0, phase: 'preparation', startedAt: '2026-07-16T08:08:09.110Z' },
      { elapsedMs: 90, phase: 'authorization', startedAt: '2026-07-16T08:08:09.200Z' },
    ],
    startedAt: '2026-07-16T08:08:09.100Z',
  };
}

function validInteractiveConnectionBootstrap() {
  const operatorHandoff = validOperatorHandoff();
  return {
    completedAt: operatorHandoff.completedAt,
    outcome: 'operator-established-lingxing-connection-and-session',
    startedAt: operatorHandoff.startedAt,
  };
}

function validRunDiagnostics(profileId) {
  const connectionBootstrap = validInteractiveConnectionBootstrap();
  const operatorHandoff = validOperatorHandoff();
  const selectedStore = {
    displayName: null,
    idLength: 12,
    idSha256: HASH_A,
  };
  return {
    cleanupErrors: [],
    completedAt: '2026-07-16T08:08:20.000Z',
    failure: null,
    login: {
      attempts: [],
      completedAt: '2026-07-16T08:08:10.000Z',
      connectionBootstrap,
      operatorHandoff,
      outcome: 'interactive-operator-login',
      savedCredentials: null,
      startedAt: '2026-07-16T08:08:09.000Z',
    },
    lifecycle: {
      droppedCount: 0,
      events: [
        { at: '2026-07-16T08:08:00.100Z', kind: 'window-attached', phase: 'electron-launch', runnerCloseRequested: false, windowId: 1 },
        { at: '2026-07-16T08:08:19.600Z', kind: 'runner-close-requested', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-16T08:08:19.700Z', kind: 'window-closed', phase: 'electron-close', runnerCloseRequested: true, windowId: 1 },
        { at: '2026-07-16T08:08:19.750Z', kind: 'electron-context-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-16T08:08:19.800Z', kind: 'electron-app-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-16T08:08:19.900Z', code: 0, kind: 'electron-process-exit', phase: 'electron-close', runnerCloseRequested: true, signal: null },
      ],
      limit: 100,
      processExit: {
        at: '2026-07-16T08:08:19.900Z',
        code: 0,
        runnerCloseRequested: true,
        signal: null,
      },
      runnerCloseRequestedAt: '2026-07-16T08:08:19.600Z',
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
    startedAt: '2026-07-16T08:08:00.000Z',
    storeGate: {
      completedAt: '2026-07-16T08:08:08.900Z',
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'selected-existing-store',
      resultingSurface: 'login',
      selectedStore,
      startedAt: '2026-07-16T08:08:08.800Z',
    },
    timeline: [
      { at: '2026-07-16T08:08:00.000Z', phase: 'created' },
      { at: '2026-07-16T08:08:20.000Z', phase: 'completed' },
    ],
  };
}

function validPackageUiSession(profileId, { firstRun = false } = {}) {
  const diagnostics = validRunDiagnostics(profileId);
  return {
    connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
    loginSessionAttestation: firstRun
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

const SCHEDULER_CONTEXT = {
  storeId: 'store-us-001',
  browserProfileId: 'profile-us-001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-16',
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
    schemaVersion: 9,
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
        capturedAt: '2026-07-16T08:08:09.500Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
      {
        sequence: 2,
        phase: 'post-navigation',
        capturedAt: '2026-07-16T08:08:19.000Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
      {
        sequence: 3,
        phase: 'pre-close-terminal',
        capturedAt: '2026-07-16T08:08:19.500Z',
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

function schedulerAuditSnapshot(userDataDir, { counts = {}, events = [], pid = 321 } = {}) {
  const mergedCounts = { ...EMPTY_SCHEDULER_COUNTS, ...counts };
  return {
    kind: 'package-ui-scheduler-audit',
    schemaVersion: 1,
    generatedAt: '2026-07-16T08:08:09.500Z',
    pid,
    evidenceMode: 'package-ui',
    userDataDir,
    policies: { runNow: 'reject' },
    counts: mergedCounts,
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
    databaseMutationAudit: validDatabaseMutationAudit(),
    events,
  };
}

function validSchedulerSubviewEvidence(userDataDir) {
  const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const requestId = 'renderer-bootstrap-1784786120654-1';
  const events = [
    {
      sequence: 1,
      at: '2026-07-16T08:08:10.100Z',
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
      at: '2026-07-16T08:08:10.200Z',
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
      at: '2026-07-16T08:08:10.300Z',
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
    ledgerBefore: schedulerAuditSnapshot(userDataDir),
    ledgerAfter: schedulerAuditSnapshot(userDataDir, {
      counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
      events,
    }),
  };
}

function validPackageUiReadOnlyRuntime(dir, profileId, userDataDir) {
  const marker = validSchedulerSubviewEvidence(userDataDir).ledgerAfter;
  const artifactPath = path.join(dir, 'package-ui-artifacts', `${profileId}-scheduler-audit.json`);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(marker), 'utf8');
  return validatePackageUiReadOnlyRuntimeEvidence({
    artifact: artifactRecord(artifactPath),
    main: {
      evidenceMode: 'package-ui',
      pid: marker.pid,
      userDataDir,
    },
    marker,
    processExitConfirmed: true,
  });
}

function validPackageUiSubviewCheck(dir, scale, userDataDir) {
  const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const screenshotPath = path.join(
    dir,
    'package-ui-artifacts',
    `${expected.workspace}-${expected.subview}-${scale.scalePercent}.png`,
  );
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, `scheduler-${scale.scalePercent}`, 'utf8');
  return {
    ...expected,
    compositeEvidence: { passed: true },
    identityCapabilityEvidence: validateSchedulerSubviewEvidence(
      validSchedulerSubviewEvidence(userDataDir),
      expected,
    ),
    passed: true,
    screenshot: {
      ...artifactRecord(screenshotPath),
      subview: expected.subview,
      workspace: expected.workspace,
    },
    settleEvidence: { passed: true },
    violations: [],
  };
}

function validPackageUiRun(
  dir,
  scale,
  userDataDir,
  profileBrowserUserDataDir,
  chromiumArtifact,
) {
  const profileId = `${scale.scalePercent}-compact`;
  const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(dir, profileId, userDataDir);
  return {
    actualDeviceScaleFactor: scale.deviceScaleFactor,
    attemptArtifacts: validAttemptArtifacts(dir, profileId),
    chromiumProcessLineage: validChromiumLineage(
      profileBrowserUserDataDir,
      chromiumArtifact,
    ),
    consoleErrors: [],
    databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
    diagnostics: validRunDiagnostics(profileId),
    identity: { passed: true },
    overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => ({
      compositeEvidence: { passed: true },
      id,
      overlayVisibleAfterCapture: true,
      overlayVisibleBeforeCapture: true,
      passed: true,
      screenshot: artifactRecord(writePng(path.join(
        dir,
        'package-ui-artifacts',
        `${profileId}-${id}.png`,
      ))),
    })),
    packageProcessIsolation: validProcessIsolation(),
    pageErrors: [],
    passed: true,
    profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
    scalePercent: scale.scalePercent,
    schedulerReadOnlyRuntime,
    screenshots: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace) => ({
      ...artifactRecord(writePng(path.join(
        dir,
        'package-ui-artifacts',
        `${profileId}-${workspace.workspace}-${workspace.subview}.png`,
      ))),
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    session: validPackageUiSession(profileId, {
      firstRun: scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent,
    }),
    subviewChecks: [validPackageUiSubviewCheck(dir, scale, userDataDir)],
    viewport: { width: 1200, height: 700 },
    viewportContract: {
      actual: { width: 1200, height: 700, deviceScaleFactor: scale.deviceScaleFactor },
      delta: { width: 0, height: 0, deviceScaleFactor: 0 },
      passed: true,
      requested: { width: 1200, height: 700, deviceScaleFactor: scale.deviceScaleFactor },
      tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
      violations: [],
    },
    workspaceChecks: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace) => {
      const objectWorkspace = workspace.workspace === 'product' || workspace.workspace === 'diagnosis';
      return {
        compositeEvidence: { passed: true },
        experienceEvidence: objectWorkspace ? { passed: true } : null,
        inspectorEvidence: objectWorkspace ? {
          passed: true,
          inspector: { mode: 'drawer', ariaModal: 'true' },
          screenshot: { sha256: HASH_B },
        } : null,
        keyboardEvidence: { passed: true },
        passed: true,
        settleEvidence: { passed: true },
        subview: workspace.subview,
        workspace: workspace.workspace,
      };
    }),
  };
}

function validWidePackageUiRun(
  dir,
  userDataDir,
  profileBrowserUserDataDir,
  chromiumArtifact,
) {
  const profileId = PACKAGE_UI_WIDE_PROFILE.id;
  const schedulerReadOnlyRuntime = validPackageUiReadOnlyRuntime(
    dir,
    profileId,
    userDataDir,
  );
  return {
    actualDeviceScaleFactor: 1,
    attemptArtifacts: validAttemptArtifacts(dir, profileId),
    chromiumProcessLineage: validChromiumLineage(
      profileBrowserUserDataDir,
      chromiumArtifact,
    ),
    consoleErrors: [],
    databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
    diagnostics: validRunDiagnostics(profileId),
    identity: { passed: true, violations: [] },
    packageProcessIsolation: validProcessIsolation(),
    pageErrors: [],
    passed: true,
    profileId,
    profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
    schedulerReadOnlyRuntime,
    screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
      ...artifactRecord(writePng(path.join(
        dir,
        'package-ui-artifacts',
        `${profileId}-${workspace.workspace}-${workspace.subview}.png`,
      ))),
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    session: validPackageUiSession(profileId),
    viewport: { width: 1400, height: 900 },
    viewportContract: {
      actual: { width: 1400, height: 900, deviceScaleFactor: 1 },
      delta: { width: 0, height: 0, deviceScaleFactor: 0 },
      passed: true,
      requested: { width: 1400, height: 900, deviceScaleFactor: 1 },
      tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
      violations: [],
    },
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

function validPackageUiEvidence(dir, smoke, authorityDbPath) {
  const protectedDbStat = fs.statSync(authorityDbPath);
  const protectedDatabaseSha256 = sha256File(authorityDbPath);
  const protectedDatabaseArtifact = {
    path: authorityDbPath,
    sha256: protectedDatabaseSha256,
    sizeBytes: protectedDbStat.size,
    mtime: protectedDbStat.mtime.toISOString(),
    mtimeMs: protectedDbStat.mtimeMs,
  };
  const appContentPath = path.join(dir, 'release', 'win-unpacked', 'resources', 'app');
  const profileDatabasePath = path.join(dir, 'profile', 'amazon-ai-ops.db');
  const userDataDir = path.dirname(profileDatabasePath);
  const profileBrowserUserDataDir = path.join(userDataDir, 'stores');
  fs.mkdirSync(path.dirname(profileDatabasePath), { recursive: true });
  fs.mkdirSync(profileBrowserUserDataDir, { recursive: true });
  fs.copyFileSync(authorityDbPath, profileDatabasePath);
  const profileDatabaseArtifact = {
    path: profileDatabasePath,
    sha256: sha256File(profileDatabasePath),
    sizeBytes: fs.statSync(profileDatabasePath).size,
  };
  const appContentSha256 = 'A'.repeat(64);
  const chromiumPath = path.join(
    appContentPath,
    'playwright-browsers',
    'chrome-win64',
    'chrome.exe',
  );
  fs.mkdirSync(path.dirname(chromiumPath), { recursive: true });
  fs.writeFileSync(chromiumPath, 'bundled Playwright Chromium fixture\n', 'utf8');
  const chromiumArtifact = artifactRecord(chromiumPath);
  const appContentArtifact = {
    kind: 'unpacked-app-content-manifest',
    rootPath: appContentPath,
    fileCount: 2,
    totalSizeBytes: 1 + chromiumArtifact.sizeBytes,
    sha256: appContentSha256,
    files: [
      {
        path: 'dist/main/index.js',
        sizeBytes: 1,
        sha256: PACKAGE_MAIN_BUNDLE_SHA256,
      },
      {
        path: 'playwright-browsers/chrome-win64/chrome.exe',
        sizeBytes: chromiumArtifact.sizeBytes,
        sha256: chromiumArtifact.sha256,
      },
    ],
  };
  const runGroupId = 'v15-non-ready-package-ui-run-group';
  const runnerContract = buildPackageUiRunnerContract();
  const logicalDatabase = validLogicalSqliteArtifact(
    protectedDatabaseSha256,
    protectedDbStat.size,
  );
  const finalProfileState = validProfileLineageState(logicalDatabase);
  const packageLineage = {
    appContentSha256,
    chromium: {
      relativePath: 'playwright-browsers/chrome-win64/chrome.exe',
      sha256: chromiumArtifact.sha256,
      sizeBytes: chromiumArtifact.sizeBytes,
    },
    executableSha256: smoke.artifacts.unpacked.sha256,
    profileBindingSha256: HASH_A,
    profileBrowserBindingSha256: HASH_B,
  };
  const runGroupMetadata = writeImmutableEnvelope(
    path.join(dir, 'package-ui-checkpoints', 'run-group.json'),
    {
      genesisProfileState: finalProfileState,
      kind: 'package-ui-run-group',
      packageLineage,
      profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
      protectedDatabaseLogical: logicalDatabase,
      runGroupId,
      runnerContract,
      runnerContractSha256: runnerContract.sha256,
      schemaVersion: 'package-ui-run-group/v1',
    },
  );
  const checkpointComposition = validCheckpointComposition(
    dir,
    runGroupId,
    runnerContract.sha256,
    finalProfileState,
    packageLineage,
  );
  const packageUi = {
    kind: 'package-ui-evidence',
    schemaVersion: 8,
    generatedAt: '2026-07-16T08:08:00.000Z',
    completedAt: '2026-07-16T08:09:00.000Z',
    passed: true,
    violations: [],
    interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
    isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    requested: {
      allowInteractiveLogin: true,
      allowSavedLogin: false,
      appContentPath,
      executablePath: smoke.artifacts.unpacked.path,
      expectedAppContentSha256: appContentSha256,
      expectedExeSha256: smoke.artifacts.unpacked.sha256,
      evidenceMode: 'package-ui',
      interactiveLoginMaximumTotalMs: 1_200_000,
      interactiveLoginTimeoutMs: 600_000,
      loginMode: 'interactive-operator-each-run',
      protectedDatabasePath: authorityDbPath,
      profileBrowserUserDataDir,
      resumeRunGroupId: null,
      runGroupId,
      userDataDir,
      scales: EXPECTED_PACKAGE_UI_SCALES,
      subviewChecks: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
      viewport: { width: 1200, height: 700 },
      wideProfile: {
        id: PACKAGE_UI_WIDE_PROFILE.id,
        viewport: { width: 1400, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    runs: EXPECTED_PACKAGE_UI_SCALES.map((scale) => validPackageUiRun(
      dir,
      scale,
      userDataDir,
      profileBrowserUserDataDir,
      chromiumArtifact,
    )),
    wideProfile: validWidePackageUiRun(
      dir,
      userDataDir,
      profileBrowserUserDataDir,
      chromiumArtifact,
    ),
    runGroup: {
      attemptId: 'v15-non-ready-package-ui-attempt',
      metadata: runGroupMetadata,
      profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
      resumed: false,
      runGroupId,
      runnerContractSha256: runnerContract.sha256,
    },
    checkpointComposition,
    profileLineage: {
      final: structuredClone(checkpointComposition.finalProfileState),
      passed: true,
    },
    protectedDatabase: {
      before: protectedDatabaseArtifact,
      after: protectedDatabaseArtifact,
      passed: true,
      unchanged: true,
    },
    protectedDatabaseLogical: {
      after: structuredClone(logicalDatabase),
      before: structuredClone(logicalDatabase),
      passed: true,
      unchanged: true,
    },
    profileDatabaseProvenance: {
      hashMatches: true,
      passed: true,
      pathsDistinct: true,
      profileDatabase: profileDatabaseArtifact,
      protectedDatabase: protectedDatabaseArtifact,
      sizeMatches: true,
      violations: [],
    },
    profileDatabaseFileIsolation: { passed: true },
    packageProcessIsolation: validProcessIsolation(),
    profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
    artifactsBefore: {
      exe: smoke.artifacts.unpacked,
      appContent: appContentArtifact,
    },
    artifactsAfter: {
      exe: smoke.artifacts.unpacked,
      appContent: appContentArtifact,
    },
    artifactHashesStable: true,
    freshness: { passed: true, violations: [] },
  };
  packageUi.completeness = evaluatePackageUiEvidenceCompleteness(packageUi);
  packageUi.passed = packageUi.completeness.passed;
  packageUi.violations = packageUi.completeness.violations;
  return packageUi;
}

const strictNonReadyGates = () => [
  { id: 'report-collection-delivery', name: 'Report collection delivery', ok: true, status: 'passed' },
  { id: 'lingxing-listing-full-read', name: 'Lingxing Listing full read', ok: true, status: 'passed' },
  { id: 'ai-live-provider', name: 'AI live provider', ok: true, status: 'passed' },
  { id: 'ad-recommendation-ai-explanation', name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
  { id: 'listing-ai-draft', name: 'Listing AI draft', ok: true, status: 'passed' },
  { id: 'real-ad-execution-readback', name: 'Real ad execution readback', ok: false, status: 'needs_work' },
  { id: 'release-package-hash', name: 'Release package hash', ok: true, status: 'passed' },
  { id: 'package-launch-smoke', name: 'Package launch smoke', ok: true, status: 'passed' },
];

function bundlePackageUiReferencedArtifacts(packageUi, bundleManifest) {
  const artifacts = [];
  const pushArtifact = (artifact) => {
    if (artifact?.path) artifacts.push(artifact);
  };
  for (const run of packageUi.runs || []) {
    for (const screenshot of run.screenshots || []) pushArtifact(screenshot);
    for (const overlay of run.overlayChecks || []) pushArtifact(overlay?.screenshot);
    for (const workspace of run.workspaceChecks || []) {
      pushArtifact(workspace?.inspectorEvidence?.screenshot);
    }
    for (const subview of run.subviewChecks || []) pushArtifact(subview?.screenshot);
    pushArtifact(run.schedulerReadOnlyRuntime?.artifact);
  }
  for (const screenshot of packageUi.wideProfile?.screenshots || []) pushArtifact(screenshot);
  for (const workspace of packageUi.wideProfile?.workspaceChecks || []) {
    pushArtifact(workspace?.inspectorEvidence?.screenshot);
  }
  pushArtifact(packageUi.wideProfile?.schedulerReadOnlyRuntime?.artifact);

  const bundleDir = path.dirname(bundleManifest);
  const targetDir = path.join(bundleDir, 'evidence', 'package-ui-referenced');
  fs.mkdirSync(targetDir, { recursive: true });
  return [...new Map(artifacts.map((artifact) => [path.resolve(artifact.path), artifact])).values()]
    .map((artifact, index) => {
      const targetPath = path.join(targetDir, `${index + 1}-${path.basename(artifact.path)}`);
      fs.copyFileSync(artifact.path, targetPath);
      return {
        label: `package-ui-referenced:${path.basename(artifact.path)}`,
        sourcePath: artifact.path,
        bundlePath: path.relative(bundleDir, targetPath),
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      };
    });
}

function writeStrictNonReadyFixture(options) {
  const {
    artifactDir,
    evidenceManifest,
    finalReadiness,
    packageSmoke,
    packageUiManifest = path.join(artifactDir, 'package-ui-manifest.json'),
    packageSecurityEvidence = path.join(artifactDir, 'package-security-boundaries.json'),
    packageAdversarialNodeEnvEvidence = path.join(artifactDir, 'package-adversarial-node-env.json'),
    bundleManifest,
    readme,
    mutateFinalReadiness = () => {},
  } = options;
  fs.mkdirSync(artifactDir, { recursive: true });
  const packageIndex = finalPackageIndex(path.join(artifactDir, 'release'));
  const portablePackage = packageIndex.packages.find((item) => item.kind === 'portable');
  const smoke = validPackageLaunchSmoke(path.join(artifactDir, 'release'), portablePackage);
  const authorityDbPath = path.join(artifactDir, 'authority.db');
  fs.writeFileSync(authorityDbPath, 'authority database identity fixture\n', 'utf8');
  writeReadme(readme);
  writeJson(packageSmoke, smoke);
  const packageUi = validPackageUiEvidence(artifactDir, smoke, authorityDbPath);
  writeJson(packageUiManifest, packageUi);
  const packageSecurity = validPackageSecurityEvidence(smoke, packageUi);
  writeJson(packageSecurityEvidence, packageSecurity);
  const adversarialFixture = writeValidAdversarialNodeEnvEvidence(
    packageAdversarialNodeEnvEvidence,
    {
      executableSha256: smoke.artifacts.unpacked.sha256,
      appContentSha256: packageUi.artifactsAfter.appContent.sha256,
      mainBundleSha256: PACKAGE_MAIN_BUNDLE_SHA256,
      rendererEntryPath: path.join(
        packageUi.artifactsAfter.appContent.rootPath,
        'dist',
        'renderer',
        'index.html',
      ),
    },
  );
  writeJson(evidenceManifest, {
    kind: 'v15-final-readiness-evidence-manifest',
    evidence: { packageAdversarialNodeEnv: adversarialFixture.manifestEntry },
  });
  const finalReadinessJson = {
    status: 'APP_NEEDS_WORK',
    appReady: false,
    reportCollectionReady: true,
    listingReadReady: true,
    evidenceSelection: {
      mode: 'manifest',
      manifestPath: evidenceManifest,
      authorityDbPath,
    },
    packageIndex,
    packageLaunchSmoke: {
      present: true,
      evidencePath: packageSmoke,
      selectedBy: 'explicit-arg',
      generatedAt: smoke.generatedAt,
      passed: true,
      artifacts: smoke.artifacts,
      checks: smoke.checks,
    },
    gates: strictNonReadyGates(),
    packageAdversarialNodeEnv: adversarialFixture.selection,
  };
  finalReadinessJson.gates.find((gate) => gate.id === 'package-launch-smoke').evidencePath = packageSmoke;
  mutateFinalReadiness(finalReadinessJson);
  writeJson(finalReadiness, finalReadinessJson);
  const bundlePackageIndexPath = path.join(path.dirname(bundleManifest), 'evidence', 'release-package-index.json');
  const bundledPackageUiManifestPath = path.join(path.dirname(bundleManifest), 'evidence', 'package-ui-manifest.json');
  const bundledPackageSecurityEvidencePath = path.join(path.dirname(bundleManifest), 'evidence', 'package-security-boundaries.json');
  const bundledPackageUiReferencedArtifacts = bundlePackageUiReferencedArtifacts(
    packageUi,
    bundleManifest,
  );
  const bundledAdversarial = bundleAdversarialNodeEnvEvidence(
    bundleManifest,
    packageAdversarialNodeEnvEvidence,
  );
  writeJson(bundlePackageIndexPath, {
    generatedAt: packageIndex.generatedAt,
    releaseDir: packageIndex.releaseDir,
    copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle; this index records local paths, existence, size, and SHA-256.',
    packages: packageIndex.packages,
  });
  writeJson(bundledPackageUiManifestPath, packageUi);
  writeJson(bundledPackageSecurityEvidencePath, packageSecurity);
  writeJson(bundleManifest, {
    status: 'APP_NEEDS_WORK',
    appReady: false,
    warning: 'Do not present this bundle as final READY until every gate passes.',
    authorityDatabase: {
      sourcePath: authorityDbPath,
      existsAtExport: true,
      copied: false,
    },
    files: [
      {
        label: 'release-package-index',
        sourcePath: 'generated',
        bundlePath: path.relative(path.dirname(bundleManifest), bundlePackageIndexPath),
        sizeBytes: fs.statSync(bundlePackageIndexPath).size,
        sha256: sha256File(bundlePackageIndexPath),
      },
      {
        label: 'evidence:package-ui-manifest.json',
        sourcePath: packageUiManifest,
        bundlePath: path.relative(path.dirname(bundleManifest), bundledPackageUiManifestPath),
        sizeBytes: fs.statSync(bundledPackageUiManifestPath).size,
        sha256: sha256File(bundledPackageUiManifestPath),
      },
      {
        label: 'evidence:package-security-boundaries.json',
        sourcePath: packageSecurityEvidence,
        bundlePath: path.relative(path.dirname(bundleManifest), bundledPackageSecurityEvidencePath),
        sizeBytes: fs.statSync(bundledPackageSecurityEvidencePath).size,
        sha256: sha256File(bundledPackageSecurityEvidencePath),
      },
      ...bundledPackageUiReferencedArtifacts,
      bundledAdversarial.file,
    ],
    packageIndex: {
      present: true,
      count: packageIndex.count,
      existingCount: packageIndex.existingCount,
      missingCount: packageIndex.missingCount,
      bundleJson: path.relative(path.dirname(bundleManifest), bundlePackageIndexPath),
    },
    uiEvidence: {
      packageUiManifest: {
        sourcePath: packageUiManifest,
        present: true,
      },
    },
    securityEvidence: {
      packageSecurityBoundaries: {
        sourcePath: packageSecurityEvidence,
        present: true,
        bundlePath: path.relative(path.dirname(bundleManifest), bundledPackageSecurityEvidencePath),
        sha256: sha256File(bundledPackageSecurityEvidencePath),
      },
      packageAdversarialNodeEnvSmoke: bundledAdversarial.summary,
    },
  });
  return {
    authorityDbPath,
    bundledPackageUiManifestPath,
    bundledPackageSecurityEvidencePath,
    bundlePackageIndexPath,
    packageIndex,
    packageUi,
    packageUiManifest,
    packageSecurity,
    packageSecurityEvidence,
    packageAdversarialNodeEnvEvidence,
    bundledPackageAdversarialNodeEnvEvidencePath: bundledAdversarial.targetPath,
    smoke,
  };
}

function runStrictNonReadySafetyFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-strict-'));
  const paths = {
    evidenceManifest: path.join(dir, 'evidence-manifest.json'),
    finalReadiness: path.join(dir, 'final-readiness.json'),
    packageSmoke: path.join(dir, 'package-launch-smoke.json'),
    packageUiManifest: path.join(dir, 'package-ui-manifest.json'),
    packageSecurityEvidence: path.join(dir, 'package-security-boundaries.json'),
    packageAdversarialNodeEnvEvidence: path.join(dir, 'package-adversarial-node-env.json'),
    bundleManifest: path.join(dir, 'delivery-bundle-manifest.json'),
    readme: path.join(dir, 'README.md'),
  };
  try {
    const fixture = writeStrictNonReadyFixture({
      artifactDir: dir,
      ...paths,
      mutateFinalReadiness: options.mutateFinalReadiness,
    });
    const context = { dir, paths, fixture };
    options.mutateAfterWrite?.(context);
    const extraArgs = typeof options.extraArgs === 'function'
      ? options.extraArgs(context)
      : options.extraArgs || [];
    return runNode('scripts/verify-v15-non-ready-safety.js', [
      '--final-readiness', paths.finalReadiness,
      '--bundle-manifest', paths.bundleManifest,
      '--package-launch-smoke', paths.packageSmoke,
      ...(options.omitPackageUiManifest ? [] : ['--package-ui-manifest', paths.packageUiManifest]),
      ...(options.omitPackageSecurityEvidence ? [] : ['--package-security-evidence', paths.packageSecurityEvidence]),
      ...(options.omitPackageAdversarialNodeEnvEvidence
        ? []
        : ['--package-adversarial-node-env-evidence', paths.packageAdversarialNodeEnvEvidence]),
      '--readme', paths.readme,
      ...extraArgs,
    ]);
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mutatePackageUiFixture(context, mutate) {
  const packageUi = JSON.parse(fs.readFileSync(context.paths.packageUiManifest, 'utf8'));
  mutate(packageUi);
  writeJson(context.paths.packageUiManifest, packageUi);
  writeJson(context.fixture.bundledPackageUiManifestPath, packageUi);
  const bundle = JSON.parse(fs.readFileSync(context.paths.bundleManifest, 'utf8'));
  const packageUiFile = bundle.files.find((file) => file.sourcePath === context.paths.packageUiManifest);
  packageUiFile.sizeBytes = fs.statSync(context.fixture.bundledPackageUiManifestPath).size;
  packageUiFile.sha256 = sha256File(context.fixture.bundledPackageUiManifestPath);
  writeJson(context.paths.bundleManifest, bundle);
}

function mutatePackageSecurityFixture(context, mutate) {
  const evidence = JSON.parse(fs.readFileSync(context.paths.packageSecurityEvidence, 'utf8'));
  mutate(evidence);
  writeJson(context.paths.packageSecurityEvidence, evidence);
  writeJson(context.fixture.bundledPackageSecurityEvidencePath, evidence);
  const bundle = JSON.parse(fs.readFileSync(context.paths.bundleManifest, 'utf8'));
  const record = bundle.files.find((file) => file.sourcePath === context.paths.packageSecurityEvidence);
  record.sizeBytes = fs.statSync(context.fixture.bundledPackageSecurityEvidencePath).size;
  record.sha256 = sha256File(context.fixture.bundledPackageSecurityEvidencePath);
  bundle.securityEvidence.packageSecurityBoundaries.sha256 = record.sha256;
  writeJson(context.paths.bundleManifest, bundle);
}

function validReadbackEvidence(dir) {
  const now = '2026-06-10T00:00:00.000Z';
  return {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    createdAt: now,
    authority: {
      recommendationId: 1,
      recommendationRevision: 1,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-10',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_1',
      checkedAt: now,
    },
    realWriteApproved: true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      operatorConfirmed: true,
      scope: 'FT-US-US / US / Campaign A / Ad Group A / close match / lower_bid',
      confirmedAt: now,
      approverName: 'Ops Owner',
      approvalArtifactPath: 'approval-ticket-123',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'keyword',
      entityId: 'keyword-123',
      entityName: 'close match',
      identityProofPath: writePng(path.join(dir, 'target-identity.png')),
      actionType: 'lower_bid',
    },
    risk: {
      level: 'low',
      allowedByPolicy: true,
      rationale: 'Small reversible bid decrease on one target.',
    },
    before: {
      value: '2.40',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'before.png')),
      liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
    },
    after: {
      value: '2.16',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: now,
      actualValue: '2.16',
      evidencePath: writePng(path.join(dir, 'readback.png')),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-123',
      executedAt: now,
      channel: 'manual_ads_ui',
      performedBy: 'operator@example.com',
      appExecutorUsed: false,
    },
    source: {
      recommendationId: '1',
      recommendationRevision: 1,
      batchId: 'batch_1',
      sourceFiles: [writeReport(path.join(dir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'search_term',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
  };
}

describe('verify v15 non-ready safety', () => {
  it('binds every schema v8 scheduler screenshot and runtime attestation to its bundle copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-package-ui-bundle-binding-'));
    try {
      const bundleDir = path.join(dir, 'bundle');
      const sourceDir = path.join(dir, 'source');
      const bundledEvidenceDir = path.join(bundleDir, 'evidence');
      const bundledScreenshotDir = path.join(bundleDir, 'screenshots');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(bundledEvidenceDir, { recursive: true });
      fs.mkdirSync(bundledScreenshotDir, { recursive: true });
      const sourceScreenshot = path.join(sourceDir, 'settings-scheduler.png');
      const sourceRuntime = path.join(sourceDir, 'scheduler-runtime.json');
      const bundledScreenshot = path.join(bundledScreenshotDir, 'settings-scheduler.png');
      const bundledRuntime = path.join(bundledEvidenceDir, 'scheduler-runtime.json');
      fs.writeFileSync(sourceScreenshot, 'current scheduler screenshot bytes', 'utf8');
      fs.writeFileSync(sourceRuntime, '{"kind":"scheduler-read-only-runtime"}\n', 'utf8');
      fs.copyFileSync(sourceScreenshot, bundledScreenshot);
      fs.copyFileSync(sourceRuntime, bundledRuntime);
      const screenshot = artifactRecord(sourceScreenshot);
      const runtime = artifactRecord(sourceRuntime);
      const manifestPath = path.join(bundleDir, 'delivery-bundle-manifest.json');
      const manifest = {
        files: [
          {
            sourcePath: sourceScreenshot,
            bundlePath: path.relative(bundleDir, bundledScreenshot),
            sizeBytes: screenshot.sizeBytes,
            sha256: screenshot.sha256,
          },
          {
            sourcePath: sourceRuntime,
            bundlePath: path.relative(bundleDir, bundledRuntime),
            sizeBytes: runtime.sizeBytes,
            sha256: runtime.sha256,
          },
        ],
      };
      const packageUi = {
        schemaVersion: 8,
        runs: [{
          screenshots: [],
          overlayChecks: [],
          workspaceChecks: [],
          subviewChecks: [{ screenshot }],
          schedulerReadOnlyRuntime: { artifact: runtime },
        }],
        wideProfile: {
          screenshots: [],
          workspaceChecks: [],
        },
      };

      expect(packageUiReferencedArtifactsAreBundled(
        packageUi,
        manifest,
        manifestPath,
      )).toBe(true);

      fs.rmSync(bundledScreenshot);
      expect(packageUiReferencedArtifactsAreBundled(
        packageUi,
        manifest,
        manifestPath,
      )).toBe(false);

      fs.copyFileSync(sourceScreenshot, bundledScreenshot);
      fs.appendFileSync(bundledRuntime, 'tampered', 'utf8');
      expect(packageUiReferencedArtifactsAreBundled(
        packageUi,
        manifest,
        manifestPath,
      )).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts the current IN_PROGRESS README delivery state as non-ready', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const packageSmoke = path.join(dir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(dir, 'package-ui-manifest.json');
    const packageSecurityEvidence = path.join(dir, 'package-security-boundaries.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');

    const fixture = writeStrictNonReadyFixture({
      artifactDir: dir,
      evidenceManifest,
      finalReadiness,
      packageSmoke,
      packageUiManifest,
      packageSecurityEvidence,
      bundleManifest,
      readme,
    });

    const result = runNode('scripts/verify-v15-non-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--bundle-manifest', bundleManifest,
      '--package-launch-smoke', packageSmoke,
      '--package-ui-manifest', packageUiManifest,
      '--package-security-evidence', packageSecurityEvidence,
      '--package-adversarial-node-env-evidence', fixture.packageAdversarialNodeEnvEvidence,
      '--readme', readme,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work');
    expect(result.stdout).toContain('README top-level delivery line is non-ready');
    expect(result.stdout).toContain('NON_READY_SAFETY verified');
  });

  it('accepts a 125% package UI viewport within the recorded two-pixel tolerance', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          const run125 = packageUi.runs.find((run) => run.scalePercent === 125);
          run125.viewport.height = 702;
          run125.viewportContract = {
            actual: { width: 1200, height: 702, deviceScaleFactor: 1.25 },
            delta: { width: 0, height: 2, deviceScaleFactor: 0 },
            passed: true,
            requested: { width: 1200, height: 700, deviceScaleFactor: 1.25 },
            tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
            violations: [],
          };
        });
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NON_READY_SAFETY verified');
  });

  it('rejects strict APP_NEEDS_WORK when the adversarial NODE_ENV contract is deleted', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        delete finalReadiness.packageAdversarialNodeEnv;
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`)
      .toContain('current NON_READY safety requires package-adversarial-node-env/v1');
  });

  it('rejects strict APP_NEEDS_WORK when the adversarial NODE_ENV contract version is changed', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        finalReadiness.packageAdversarialNodeEnv.contractVersion = 'package-adversarial-node-env/v0';
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`)
      .toContain('current NON_READY safety requires package-adversarial-node-env/v1');
  });

  it('rejects a package UI viewport outside the recorded two-pixel tolerance', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          const run125 = packageUi.runs.find((run) => run.scalePercent === 125);
          run125.viewport.height = 703;
          run125.viewportContract = {
            actual: { width: 1200, height: 703, deviceScaleFactor: 1.25 },
            delta: { width: 0, height: 3, deviceScaleFactor: 0 },
            passed: true,
            requested: { width: 1200, height: 700, deviceScaleFactor: 1.25 },
            tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
            violations: [],
          };
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('rejects strict APP_NEEDS_WORK verification without an explicit package UI manifest', () => {
    const result = runStrictNonReadySafetyFixture({ omitPackageUiManifest: true });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('strict APP_NEEDS_WORK requires an explicit package UI manifest');
  });

  it('rejects strict APP_NEEDS_WORK verification without explicit package security evidence', () => {
    const result = runStrictNonReadySafetyFixture({ omitPackageSecurityEvidence: true });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('strict APP_NEEDS_WORK requires explicit passing package security evidence');
  });

  it('rejects strict APP_NEEDS_WORK verification when a package security boundary check failed', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageSecurityFixture(context, (evidence) => {
          evidence.checks.find((check) => check.code === 'NAVIGATION_SECURITY_MARKER_PRESENT').passed = false;
          evidence.summary.passed -= 1;
          evidence.summary.failed += 1;
          evidence.passed = false;
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package security evidence is schema-valid, fully passing, package-hash-bound, and bundled byte-for-byte');
  });

  it('rejects strict APP_NEEDS_WORK verification when the security main-bundle hash is detached from package UI evidence', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageSecurityFixture(context, (evidence) => {
          evidence.package.mainBundleSha256 = 'D'.repeat(64);
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package security evidence is schema-valid, fully passing, package-hash-bound, and bundled byte-for-byte');
  });

  it('rejects APP_NEEDS_WORK when release package hash evidence is stale', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        const portable = finalReadiness.packageIndex.packages.find((item) => item.kind === 'portable');
        portable.sha256 = '0'.repeat(64);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('release-package-hash gate is passed with current package index evidence');
    expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
  });

  it('rejects APP_NEEDS_WORK when the bundled release package index differs from final readiness', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ paths, fixture }) {
        const bundleIndex = JSON.parse(fs.readFileSync(fixture.bundlePackageIndexPath, 'utf8'));
        bundleIndex.packages.find((item) => item.kind === 'portable').modifiedAt = '2000-01-01T00:00:00.000Z';
        writeJson(fixture.bundlePackageIndexPath, bundleIndex);
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        const indexFile = bundle.files.find((file) => file.label === 'release-package-index');
        indexFile.sizeBytes = fs.statSync(fixture.bundlePackageIndexPath).size;
        indexFile.sha256 = sha256File(fixture.bundlePackageIndexPath);
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bundle release-package-index exactly matches final readiness and current package files');
  });

  it('rejects APP_NEEDS_WORK when explicit package UI freshness failed', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          packageUi.freshness = { passed: false, violations: [{ code: 'STALE_BUILD' }] };
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('rejects APP_NEEDS_WORK when explicit package UI completeness failed', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          packageUi.completeness = { passed: false, violations: [{ code: 'SCALE_RUN_MISSING' }] };
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it.each([
    ['historical schema v5 cannot satisfy the current production safety gate', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.schemaVersion = 5;
      });
    }],
    ['historical schema v6 cannot satisfy the current production safety gate', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.schemaVersion = 6;
      });
    }],
    ['interactive operator login request is downgraded to saved-login automation', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.requested.allowInteractiveLogin = false;
        packageUi.requested.allowSavedLogin = true;
        packageUi.requested.loginMode = 'app-owned-saved-login';
      });
    }],
    ['first 100% handoff lacks typed-and-saved fresh identity proof', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs.find((run) => run.scalePercent === 100).session.loginSessionAttestation = {
          adsSessionReady: true,
          credentialPersistence: 'main_managed',
          credentialSource: 'saved',
          erpSessionReady: true,
          erpSessionReused: true,
          ok: true,
          sessionIdentityVerified: false,
        };
      });
    }],
    ['125% run omits its interactive operator handoff mode', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs.find((run) => run.scalePercent === 125).session.mode = 'existing-authenticated-session';
      });
    }],
    ['wide run omits its interactive operator handoff mode', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.session.mode = 'existing-authenticated-session';
      });
    }],
    ['operator handoff claims automation read secrets', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].session.operatorHandoff.automationReadSecrets = true;
      });
    }],
    ['EXE hash is not bound to package smoke', (context) => {
      const alternateExe = path.join(context.dir, 'alternate-unpacked.exe');
      const content = 'alternate unpacked executable\n';
      fs.writeFileSync(alternateExe, content, 'utf8');
      const artifact = {
        path: alternateExe,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        sha256: sha256Text(content),
      };
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.requested.executablePath = alternateExe;
        packageUi.requested.expectedExeSha256 = artifact.sha256;
        packageUi.artifactsBefore.exe = artifact;
        packageUi.artifactsAfter.exe = artifact;
      });
    }],
    ['authority DB isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.protectedDatabase.unchanged = false;
      });
    }],
    ['package process isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.packageProcessIsolation.after.matchingCount = 1;
      });
    }],
    ['package process isolation omits strict current snapshot fields', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.packageProcessIsolation.before = {
          error: null,
          matchingCount: 0,
          passed: true,
          unresolvedCount: 0,
        };
      });
    }],
    ['package process isolation reports inconsistent snapshot counts', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].packageProcessIsolation.after.matching = [{ processId: 42 }];
      });
    }],
    ['top-level profile browser isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.profileProcessIsolation.after.matchingCount = 1;
      });
    }],
    ['per-scale profile browser isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].profileProcessIsolation.before.unresolvedCount = 1;
      });
    }],
    ['wide product process isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.packageProcessIsolation.after.passed = false;
      });
    }],
    ['per-run structured diagnostics are missing', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        delete packageUi.runs[1].diagnostics;
      });
    }],
    ['Electron lifecycle diagnostics are missing', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        delete packageUi.runs[0].diagnostics.lifecycle;
      });
    }],
    ['Electron lifecycle observed an unrequested close', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.diagnostics.lifecycle.unexpectedCloseObserved = true;
      });
    }],
    ['Electron exited non-zero', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[1].diagnostics.lifecycle.processExit.code = 1;
        packageUi.runs[1].diagnostics.lifecycle.events.find(
          (event) => event.kind === 'electron-process-exit',
        ).code = 1;
      });
    }],
    ['Electron lifecycle markers are duplicated', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        const lifecycle = packageUi.runs[0].diagnostics.lifecycle;
        const marker = lifecycle.events.find((event) => event.kind === 'runner-close-requested');
        lifecycle.events.splice(2, 0, { ...marker });
      });
    }],
    ['Electron lifecycle exit receipt is detached', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.diagnostics.lifecycle.processExit.at =
          '2026-07-16T08:08:19.901Z';
      });
    }],
    ['Electron window is attached only after close was requested', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        const events = packageUi.runs[0].diagnostics.lifecycle.events;
        const attached = events.shift();
        attached.at = '2026-07-16T08:08:19.650Z';
        attached.runnerCloseRequested = true;
        events.splice(1, 0, attached);
      });
    }],
    ['Electron lifecycle records an event after process exit', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[1].diagnostics.lifecycle.events.push({
          at: '2026-07-16T08:08:19.950Z',
          kind: 'main-frame-navigated',
          phase: 'electron-close',
          runnerCloseRequested: true,
          windowId: 1,
        });
      });
    }],
    ['diagnostics retain a raw credential', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.diagnostics.login.failureMessage = 'password=hunter2';
      });
    }],
    ['diagnostics retain raw CLI credentials', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].diagnostics.login.failureMessage = '--username operator@example.com --password hunter2';
      });
    }],
    ['diagnostics retain a raw account email', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].diagnostics.login.failureMessage = 'operator@example.com';
      });
    }],
    ['diagnostics retain a user-name field', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].diagnostics['user-name'] = '[REDACTED_ACCOUNT]';
      });
    }],
    ['diagnostics retain raw authorization, cookie, or session tokens', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[1].diagnostics.login.failureMessage = [
          'Authorization: Bearer abcdef123456',
          'Cookie: sid=cookie-secret',
          'session_token=session-secret',
        ].join('\n');
      });
    }],
    ['renderer diagnostics report dropped errors', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.diagnostics.renderer.droppedCount.consoleErrors = 1;
      });
    }],
    ['profile browser path is not bound to the isolated user data directory', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.requested.profileBrowserUserDataDir = path.join(context.dir, 'other-browser-profile');
      });
    }],
    ['profile browser isolation persists a command line', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.profileProcessIsolation.after.CommandLine = '--user-data-dir=D:\\secret-profile';
      });
    }],
    ['profile database provenance is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.profileDatabaseProvenance.passed = false;
        packageUi.profileDatabaseProvenance.hashMatches = false;
      });
    }],
    ['wide canonical Decisions/Objects profile is incomplete', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.workspaceChecks.find((item) => item.workspace === 'objects').passed = false;
      });
    }],
  ])('rejects APP_NEEDS_WORK when package UI %s', (_label, mutate) => {
    const result = runStrictNonReadySafetyFixture({ mutateAfterWrite: mutate });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('rejects APP_NEEDS_WORK when bundle package UI sourcePath does not match the explicit manifest', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ paths }) {
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        bundle.uiEvidence.packageUiManifest.sourcePath = path.join(path.dirname(paths.packageUiManifest), 'other-package-ui.json');
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('does not allow explicit strict verification to substitute historical APP_READY records', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        finalReadiness.status = 'APP_READY';
        finalReadiness.appReady = true;
      },
      mutateAfterWrite({ paths }) {
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        bundle.status = 'APP_READY';
        bundle.appReady = true;
        bundle.warning = 'APP_READY evidence bundle.';
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness remains APP_NEEDS_WORK with appReady=false');
    expect(result.stdout).not.toContain('historical APP_READY final readiness is baseline only');
  });

  it('rejects APP_NEEDS_WORK when explicit package launch smoke is invalid', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ paths }) {
        const smoke = JSON.parse(fs.readFileSync(paths.packageSmoke, 'utf8'));
        delete smoke.checks.find((check) => check.kind === 'portable').runtimeProcess;
        writeJson(paths.packageSmoke, smoke);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index');
    expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
  });

  it('rejects APP_NEEDS_WORK when explicit package launch smoke does not match its final readiness record', () => {
    let alternateSmokePath = '';
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        alternateSmokePath = path.join(path.dirname(finalReadiness.evidenceSelection.manifestPath), 'other-package-launch-smoke.json');
        finalReadiness.packageLaunchSmoke.evidencePath = alternateSmokePath;
        finalReadiness.gates.find((gate) => gate.id === 'package-launch-smoke').evidencePath = alternateSmokePath;
      },
      mutateAfterWrite({ paths }) {
        fs.copyFileSync(paths.packageSmoke, alternateSmokePath);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index');
  });

  it('rejects APP_NEEDS_WORK when any gate besides real ad readback also fails', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        const aiGate = finalReadiness.gates.find((gate) => gate.id === 'ai-live-provider');
        aiGate.ok = false;
        aiGate.status = 'needs_work';
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work');
  });

  it('rejects APP_NEEDS_WORK when the recorded authority database path no longer exists', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ fixture }) {
        fs.rmSync(fixture.authorityDbPath, { force: true });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bind the same existing SQLite authority database identity');
  });

  it('rejects APP_NEEDS_WORK when explicit --db selects another existing database without leaking its path', () => {
    let otherDbPath = '';
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ dir }) {
        otherDbPath = path.join(dir, 'other-authority.db');
        fs.writeFileSync(otherDbPath, 'other authority database identity fixture\n', 'utf8');
      },
      extraArgs() {
        return ['--db', otherDbPath];
      },
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('bind the same existing SQLite authority database identity');
    expect(output).not.toContain(otherDbPath);
  });

  it('rejects APP_NEEDS_WORK when the delivery bundle records another authority database', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ dir, paths }) {
        const otherDbPath = path.join(dir, 'bundle-authority.db');
        fs.writeFileSync(otherDbPath, 'bundle authority database identity fixture\n', 'utf8');
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        bundle.authorityDatabase.sourcePath = otherDbPath;
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bind the same existing SQLite authority database identity');
  });

  it('ignores newer smoke final-readiness files when selecting default evidence', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-non-ready-smoke-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-01.json');
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-smoke-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-default-smoke-'));
    const packageSmoke = path.join(fixtureDir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(fixtureDir, 'package-ui-manifest.json');
    const packageSecurityEvidence = path.join(fixtureDir, 'package-security-boundaries.json');

    try {
      const fixture = writeStrictNonReadyFixture({
        artifactDir: fixtureDir,
        evidenceManifest,
        finalReadiness,
        packageSmoke,
        packageUiManifest,
        packageSecurityEvidence,
        bundleManifest,
        readme,
      });
      writeJson(smokeReadiness, {
        status: 'APP_READY',
        appReady: true,
        evidenceSelection: { mode: 'smoke' },
        gates: [],
      });
      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--package-launch-smoke', packageSmoke,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', fixture.packageAdversarialNodeEnvEvidence,
        '--readme', readme,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('selects timestamp-named final-readiness evidence by default without selecting smoke artifacts', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-timestamp-default-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, `final-readiness-${runId}.json`);
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-timestamp-default-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-timestamp-default-'));
    const packageSmoke = path.join(fixtureDir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(fixtureDir, 'package-ui-manifest.json');
    const packageSecurityEvidence = path.join(fixtureDir, 'package-security-boundaries.json');

    try {
      const fixture = writeStrictNonReadyFixture({
        artifactDir: fixtureDir,
        evidenceManifest,
        finalReadiness,
        packageSmoke,
        packageUiManifest,
        packageSecurityEvidence,
        bundleManifest,
        readme,
      });
      writeJson(smokeReadiness, {
        status: 'APP_READY',
        appReady: true,
        evidenceSelection: { mode: 'smoke' },
        gates: [],
      });
      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--package-launch-smoke', packageSmoke,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', fixture.packageAdversarialNodeEnvEvidence,
        '--readme', readme,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('final readiness remains APP_NEEDS_WORK with appReady=false');
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('treats default historical APP_READY evidence as baseline only when README is IN_PROGRESS', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-02.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-history-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('historical APP_READY final readiness is baseline only');
      expect(result.stdout).toContain('historical APP_READY delivery bundle is baseline only');
      expect(result.stdout).toContain('README top-level delivery line is non-ready');

      const otherDbPath = writeAdReadbackAuthorityDb(
        path.join(fixtureDir, 'other-authority-db'),
        JSON.parse(fs.readFileSync(adReadback, 'utf8')),
      );
      const mismatch = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', otherDbPath,
      ]);
      expect(mismatch.status).not.toBe(0);
      expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when package hash evidence is missing', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-no-package-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-05.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-no-package-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-no-package-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-no-package-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
        ],
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--package-launch-smoke', path.join(path.dirname(finalReadiness), 'missing-package-launch-smoke.json'),
        '--readme', readme,
      ]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
      expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('accepts a historical APP_READY baseline when current package launch smoke supersedes stale package hashes', () => {
    const runId = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-package-smoke-'));
    const evidenceManifest = path.join(dir, `v15-final-readiness-evidence-manifest-package-smoke-${runId}.json`);
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const packageSmoke = path.join(dir, 'package-launch-smoke.json');
    const adReadback = path.join(dir, `real-ad-execution-readback-package-smoke-${runId}.json`);
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = writeReadme(path.join(dir, 'README.md'));

    try {
      const dbPath = writeValidReadbackWithDb(dir, adReadback);
      writeJson(packageSmoke, validPackageLaunchSmoke(path.join(dir, 'release')));
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex: {
          present: true,
          count: 1,
          existingCount: 1,
          missingCount: 0,
          packages: [
            {
              kind: 'installer',
              sourcePath: path.join(dir, 'old-installer.exe'),
              fileName: 'old-installer.exe',
              exists: true,
              sizeBytes: 123,
              sha256: '0'.repeat(64),
            },
          ],
        },
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--package-launch-smoke', packageSmoke,
        '--readme', readme,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when old readback evidence lacks current source report authority', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-legacy-readback-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-04.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-legacy-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-legacy-readback-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-legacy-authority-'));

    try {
      writeReadme(readme);
      const legacyReadback = createValidAdReadbackEvidence(fixtureDir);
      const dbPath = writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), legacyReadback);
      delete legacyReadback.source.sourceFiles;
      delete legacyReadback.source.sourceRow;
      writeJson(adReadback, legacyReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
      expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when selected readback evidence fails verify:ad-readback', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-bad-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-03.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-bad-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-bad-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-bad-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(adReadback, { kind: 'real-ad-execution-readback', status: 'PASS', readback: { verified: true } });
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
