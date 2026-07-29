import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import {
  createValidAdReadbackEvidence,
  writeAdReadbackAuthorityDb,
} from './ad-readback-authority-db.test-fixture.mjs';
import {
  writeValidAdversarialNodeEnvEvidence,
} from './package-adversarial-node-env.test-fixture.mjs';
import { writeValidPackageLaunchSmoke } from './package-launch-smoke.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageUiEvidence = require('./package-ui-evidence');
const {
  EXPECTED_OVERLAY_CHECK_IDS,
  EXPECTED_PACKAGE_UI_SCALES,
  EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  EXPECTED_PACKAGE_UI_WORKSPACES,
  INTERACTIVE_LOGIN_CONTRACT,
  ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
  PACKAGE_UI_PROFILE_SEQUENCE,
  PACKAGE_UI_WIDE_PROFILE,
} = packageUiEvidence;
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

const cleanupPaths = [];

function ensureCurrentAdversarialNodeEnvContract(args) {
  const finalReadinessIndex = args.indexOf('--final-readiness');
  if (finalReadinessIndex < 0 || !args[finalReadinessIndex + 1]) return args;
  const finalReadinessPath = path.resolve(args[finalReadinessIndex + 1]);
  if (!fs.existsSync(finalReadinessPath)) return args;
  const finalReadiness = JSON.parse(fs.readFileSync(finalReadinessPath, 'utf8'));
  const fixturePath = path.join(path.dirname(finalReadinessPath), 'package-adversarial-node-env.json');
  const fixture = writeValidAdversarialNodeEnvEvidence(fixturePath, {
    executableSha256: 'A'.repeat(64),
    appContentSha256: 'B'.repeat(64),
    mainBundleSha256: 'C'.repeat(64),
    rendererEntryPath: path.join(path.dirname(finalReadinessPath), 'dist', 'renderer', 'index.html'),
  });
  finalReadiness.packageAdversarialNodeEnv = fixture.selection;
  fs.writeFileSync(finalReadinessPath, `${JSON.stringify(finalReadiness, null, 2)}\n`, 'utf8');
  const manifestPath = finalReadiness.evidenceSelection?.manifestPath;
  if (manifestPath && fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.evidence = manifest.evidence || {};
    manifest.evidence.packageAdversarialNodeEnv = fixture.manifestEntry;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  if (args.includes('--package-adversarial-node-env-evidence')) return args;
  return [...args, '--package-adversarial-node-env-evidence', fixturePath];
}

function runNode(script, args = [], options = {}) {
  const effectiveArgs = script === 'scripts/export-v15-delivery-bundle.js'
    && options.currentAdversarialContract !== false
    ? ensureCurrentAdversarialNodeEnvContract(args)
    : args;
  return spawnSync(process.execPath, [path.join(root, script), ...effectiveArgs], {
    cwd: root,
    encoding: 'utf8',
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  cleanupPaths.push(filePath);
}

function writeValidReadbackWithDb(runDir, evidencePath) {
  const evidence = createValidAdReadbackEvidence(runDir);
  writeJson(evidencePath, evidence);
  return writeAdReadbackAuthorityDb(path.join(runDir, 'authority-db'), evidence);
}

function writeAuthorityDbForInvalidReadback(runDir) {
  const fixtureDir = path.join(runDir, 'authority-fixture');
  const evidence = createValidAdReadbackEvidence(fixtureDir);
  return writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), evidence);
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(path.basename(filePath), 'utf8'),
  ]));
  cleanupPaths.push(filePath);
  return filePath;
}

function hashBoundFile(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    sizeBytes: stat.size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(),
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

function schedulerAuditSnapshot(pid, { counts = {}, events = [] } = {}) {
  return {
    kind: 'package-ui-scheduler-audit',
    schemaVersion: 1,
    generatedAt: '2026-07-23T01:00:00.000Z',
    pid,
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

function schedulerIdentityEvidence(pid) {
  const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const requestId = `renderer-bootstrap-${pid}-1`;
  const events = [
    {
      sequence: 1,
      at: '2026-07-23T01:00:00.100Z',
      source: 'mission-control:query',
      outcome: 'succeeded',
      context: SCHEDULER_CONTEXT,
      request: { query: 'workspace-bootstrap', requestId, contextEpoch: 1, context: SCHEDULER_CONTEXT },
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
        storeId: SCHEDULER_CONTEXT.storeId,
        businessDate: SCHEDULER_CONTEXT.businessDate,
        enabled: true,
        state: 'waiting',
        detail: '等待当前店铺配置的采集时间。',
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
        schemaVersion: 1,
        mode: 'dry-run',
        deletionSupported: false,
        applyable: false,
        storeId: SCHEDULER_CONTEXT.storeId,
        profileId: SCHEDULER_CONTEXT.browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        candidateCount: 0,
        blockerCount: 0,
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
    ledgerBefore: schedulerAuditSnapshot(pid),
    ledgerAfter: schedulerAuditSnapshot(pid, {
      counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
      events,
    }),
  };
}

function packageUiReadOnlyRuntime(filePath, pid) {
  const marker = schedulerIdentityEvidence(pid).ledgerAfter;
  writeText(filePath, JSON.stringify(marker));
  return packageUiEvidence.validatePackageUiReadOnlyRuntimeEvidence({
    artifact: hashBoundFile(filePath),
    main: {
      evidenceMode: 'package-ui',
      pid,
      userDataDir: PACKAGE_UI_USER_DATA_DIR,
    },
    marker,
    processExitConfirmed: true,
  });
}

function validProcessSnapshot(extra = {}) {
  return {
    error: null,
    matching: [],
    matchingCount: 0,
    observedCount: 0,
    passed: true,
    unresolved: [],
    unresolvedCount: 0,
    ...extra,
  };
}

function validProcessIsolation() {
  return {
    before: validProcessSnapshot(),
    after: validProcessSnapshot({ attempts: 1 }),
    passed: true,
  };
}

function validPackageUiDiagnostics(profileId) {
  const connectionBootstrap = {
    completedAt: '2026-07-23T01:00:00.400Z',
    outcome: 'existing-lingxing-connection',
    startedAt: '2026-07-23T01:00:00.300Z',
  };
  const operatorHandoff = {
    automationReadSecrets: false,
    automationTypedSecrets: false,
    completedAt: '2026-07-23T01:00:00.450Z',
    kind: 'visible-user-handoff',
    outcome: 'workspace-reached',
    startedAt: '2026-07-23T01:00:00.200Z',
  };
  const selectedStore = {
    displayName: null,
    idLength: 12,
    idSha256: 'A'.repeat(64),
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

function validPackageUiSession(profileId) {
  const diagnostics = validPackageUiDiagnostics(profileId);
  return {
    connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
    loginSessionAttestation: {
      adsSessionReady: true,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
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
      actualIdSha256: 'A'.repeat(64),
      currency: 'USD',
      expectedIdSha256: 'A'.repeat(64),
      marketplace: 'US',
      passed: true,
    },
  };
}

function validPackageUiLogicalArtifact() {
  return {
    method: 'readonly-sqlite-online-backup',
    remainingPages: 0,
    schemaVersion: 'sqlite-authority-currentness-proof/v1',
    sha256: 'A'.repeat(64),
    sizeBytes: 4_096,
    totalPages: 1,
  };
}

function validPackageUiProfileLineageState() {
  return {
    capturedAt: '2026-07-23T01:00:01.100Z',
    logicalDatabase: validPackageUiLogicalArtifact(),
    profileContent: {
      fileCount: 10,
      sha256: 'B'.repeat(64),
      sizeBytes: 8_192,
    },
  };
}

function validPackageUiAttemptArtifacts(runDir, profileId) {
  const attemptRoot = path.join(runDir, 'package-ui-attempts', profileId);
  writeText(path.join(attemptRoot, 'runtime-proof.txt'), `immutable-${profileId}`);
  return packageUiEvidence.buildPackageUiAttemptArtifactManifest(attemptRoot);
}

function validPackageUiChromiumLineage() {
  const profilePathBindingSha256 = 'A'.repeat(64);
  const profileBindingSha256 = packageUiEvidence.sha256Buffer(
    Buffer.from(JSON.stringify([profilePathBindingSha256]), 'utf8'),
  );
  return {
    chromium: { sha256: 'C'.repeat(64), sizeBytes: 1_234 },
    cleanup: validProcessSnapshot({ attempts: 1 }),
    descendantProcessIds: [902],
    expectedProfileRootSha256: 'B'.repeat(64),
    observedAt: '2026-07-23T01:00:00.600Z',
    passed: true,
    profileBindingSha256,
    profileBindingTokenCount: 1,
    rootProcessIds: [901],
    snapshot: validProcessSnapshot({
      expectedProfileRootSha256: 'B'.repeat(64),
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

function validPackageUiCheckpointComposition(runDir, runGroupId, runnerContractSha256) {
  const checkpointRecords = PACKAGE_UI_PROFILE_SEQUENCE.map((profileId, index) => {
    const payload = {
      kind: 'package-ui-profile-checkpoint',
      profileId,
      runGroupId,
      runnerContractSha256,
      schemaVersion: 'package-ui-profile-checkpoint/v1',
      sequence: index + 1,
    };
    const file = packageUiEvidence.writeImmutableEnvelope(
      path.join(runDir, 'package-ui-checkpoints', `${profileId}.json`),
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
    finalProfileState: validPackageUiProfileLineageState(),
    packageLineage: { chromium: { sha256: 'C'.repeat(64) } },
    passed: true,
    runGroupId,
    runnerContractSha256,
  };
}

function writeValidPackageUiBundleManifest(manifestPath, runDir, extraScreenshot = null) {
  const runGroupId = `package-ui-${path.basename(runDir)}`;
  const runnerContract = packageUiEvidence.buildPackageUiRunnerContract();
  const checkpointComposition = validPackageUiCheckpointComposition(
    runDir,
    runGroupId,
    runnerContract.sha256,
  );
  const runtimes = [100, 125, 'wide'].map((profile, index) => (
    packageUiReadOnlyRuntime(
      path.join(runDir, `${profile}-package-ui-scheduler-audit-v7.json`),
      1_000 + index,
    )
  ));
  writeJson(manifestPath, {
    kind: 'package-ui-evidence',
    schemaVersion: 7,
    generatedAt: '2026-07-23T01:00:00.000Z',
    interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
    isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    checkpointComposition,
    passed: true,
    requested: {
      allowInteractiveLogin: true,
      allowSavedLogin: false,
      interactiveLoginTimeoutMs: 600_000,
      loginMode: 'interactive-operator-each-run',
      resumeRunGroupId: null,
      runGroupId,
    },
    runGroup: {
      profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
      runGroupId,
      runnerContractSha256: runnerContract.sha256,
    },
    artifactHashesStable: true,
    protectedDatabase: { passed: true },
    protectedDatabaseLogical: {
      after: validPackageUiLogicalArtifact(),
      before: validPackageUiLogicalArtifact(),
      passed: true,
    },
    profileDatabaseFileIsolation: { passed: true },
    profileDatabaseProvenance: { passed: true },
    profileLineage: {
      final: structuredClone(checkpointComposition.finalProfileState),
      passed: true,
    },
    packageProcessIsolation: validProcessIsolation(),
    profileProcessIsolation: validProcessIsolation(),
    runs: EXPECTED_PACKAGE_UI_SCALES.map((scale, index) => ({
      actualDeviceScaleFactor: scale.deviceScaleFactor,
      attemptArtifacts: validPackageUiAttemptArtifacts(
        runDir,
        `${scale.scalePercent}-compact`,
      ),
      chromiumProcessLineage: validPackageUiChromiumLineage(),
      consoleErrors: [],
      diagnostics: validPackageUiDiagnostics(`${scale.scalePercent}-compact`),
      identity: { passed: true },
      pageErrors: [],
      packageProcessIsolation: validProcessIsolation(),
      profileProcessIsolation: validProcessIsolation(),
      passed: true,
      databaseAuditCheckpoints: {
        postBootstrap: runtimes[index].marker.databaseMutationAudit.checkpoints[0],
        postNavigation: runtimes[index].marker.databaseMutationAudit.checkpoints[1],
      },
      session: validPackageUiSession(`${scale.scalePercent}-compact`),
      viewport: { width: 1200, height: 700 },
      scalePercent: scale.scalePercent,
      schedulerReadOnlyRuntime: runtimes[index],
      screenshots: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace, workspaceIndex) => {
        const screenshotPath = index === 0 && workspaceIndex === 0 && extraScreenshot
          ? extraScreenshot
          : writePng(path.join(
              runDir,
              `${scale.scalePercent}-${workspace.workspace}-${workspace.subview}.png`,
            ));
        return {
          ...hashBoundFile(screenshotPath),
          workspace: workspace.workspace,
          subview: workspace.subview,
        };
      }),
      workspaceChecks: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace) => ({
        ...workspace,
        compositeEvidence: { passed: true },
        keyboardEvidence: { passed: true },
        passed: true,
        settleEvidence: { passed: true },
      })),
      overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => ({
        id,
        passed: true,
        compositeEvidence: { passed: true },
        overlayVisibleBeforeCapture: true,
        overlayVisibleAfterCapture: true,
        screenshot: hashBoundFile(writePng(path.join(runDir, `${scale.scalePercent}-${id}.png`))),
      })),
      subviewChecks: [{
        ...EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0],
        compositeEvidence: { passed: true },
        settleEvidence: { passed: true },
        identityCapabilityEvidence: packageUiEvidence.validateSchedulerSubviewEvidence(
          schedulerIdentityEvidence(1_000 + index),
        ),
        passed: true,
        workspace: 'settings',
        subview: 'scheduler',
        screenshot: hashBoundFile(writePng(path.join(
          runDir,
          `${scale.scalePercent}-settings-scheduler-v7.png`,
        ))),
      }],
    })),
    wideProfile: {
      actualDeviceScaleFactor: 1,
      attemptArtifacts: validPackageUiAttemptArtifacts(runDir, PACKAGE_UI_WIDE_PROFILE.id),
      chromiumProcessLineage: validPackageUiChromiumLineage(),
      consoleErrors: [],
      diagnostics: validPackageUiDiagnostics(PACKAGE_UI_WIDE_PROFILE.id),
      identity: { passed: true },
      pageErrors: [],
      packageProcessIsolation: validProcessIsolation(),
      profileId: PACKAGE_UI_WIDE_PROFILE.id,
      profileProcessIsolation: validProcessIsolation(),
      passed: true,
      schedulerReadOnlyRuntime: runtimes[2],
      databaseAuditCheckpoints: {
        postBootstrap: runtimes[2].marker.databaseMutationAudit.checkpoints[0],
        postNavigation: runtimes[2].marker.databaseMutationAudit.checkpoints[1],
      },
      session: validPackageUiSession(PACKAGE_UI_WIDE_PROFILE.id),
      screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => {
        const screenshotPath = writePng(path.join(
          runDir,
          `wide-${workspace.workspace}-${workspace.subview}.png`,
        ));
        return {
          ...hashBoundFile(screenshotPath),
          subview: workspace.subview,
          workspace: workspace.workspace,
        };
      }),
      viewport: { width: 1400, height: 900 },
      workspaceChecks: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
        ...workspace,
        compositeEvidence: { passed: true },
        keyboardEvidence: { passed: true },
        passed: true,
        settleEvidence: { passed: true },
      })),
    },
  });
}

function writeReport(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'placeholder report file for delivery bundle verifier\n', 'utf8');
  cleanupPaths.push(filePath);
  return filePath;
}

function writeReleaseFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  cleanupPaths.push(filePath);
  return filePath;
}

function writeReadme(filePath, status = 'APP_READY') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      '# Amazon AI Ops',
      '',
      `**DELIVERY: ${status}.** Test delivery status line.`,
      '',
    ].join('\n'),
    'utf8',
  );
  cleanupPaths.push(filePath);
  return filePath;
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
  cleanupPaths.push(filePath);
  return filePath;
}

function writeNonReadyFinalReadiness(runDir) {
  const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
  const finalReadiness = path.join(runDir, 'final-readiness.json');
  writeJson(evidenceManifest, {
    kind: 'v15-final-readiness-evidence-manifest',
    evidence: {},
  });
  writeJson(finalReadiness, {
    status: 'APP_NEEDS_WORK',
    appReady: false,
    evidenceSelection: {
      mode: 'manifest',
      manifestPath: evidenceManifest,
    },
    gates: [],
  });
  return { evidenceManifest, finalReadiness };
}

function sha256Text(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function validPackageSecurityEvidence() {
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
    generatedAt: '2026-07-17T00:00:00.000Z',
    passed: true,
    package: {
      executableSha256: 'A'.repeat(64),
      appContentSha256: 'B'.repeat(64),
      mainBundleSha256: 'C'.repeat(64),
    },
    summary: { total: checks.length, passed: checks.length, failed: 0 },
    checks,
  };
}

function packageIndexFromArtifacts(artifacts) {
  return {
    present: artifacts.length > 0,
    count: artifacts.length,
    existingCount: artifacts.length,
    missingCount: 0,
    packages: artifacts.map((artifact) => ({
      kind: artifact.kind,
      sourcePath: artifact.filePath,
      fileName: path.basename(artifact.filePath),
      exists: true,
      sizeBytes: Buffer.byteLength(artifact.content, 'utf8'),
      sha256: sha256Text(artifact.content),
    })),
  };
}

function validReadbackEvidence(runDir) {
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
      identityProofPath: writePng(path.join(runDir, 'target-identity.png')),
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
      screenshotPath: writePng(path.join(runDir, 'before.png')),
      liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
    },
    after: {
      value: '2.16',
      capturedAt: now,
      screenshotPath: writePng(path.join(runDir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: now,
      actualValue: '2.16',
      evidencePath: writePng(path.join(runDir, 'readback.png')),
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
      sourceFiles: [writeReport(path.join(runDir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'search_term',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
  };
}

describe('export v15 delivery bundle', () => {
  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0).reverse()) {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
  });

  it('refuses to re-export legacy final readiness without adversarial NODE_ENV contract evidence', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-legacy-adversarial-contract-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ], { currentAdversarialContract: false });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`)
      .toContain('current adversarial NODE_ENV package evidence contract');
  });

  it('refuses to export a bundle when selected package launch evidence loses a required proof field', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-launch-contract-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const launchPath = path.join(runDir, 'package-launch-smoke.json');
    const launch = writeValidPackageLaunchSmoke(runDir, {
      evidencePath: launchPath,
      generatedAt: new Date().toISOString(),
    });
    delete launch.checks.find((check) => check.kind === 'portable').windowReadyEvidence;
    writeJson(launchPath, launch);
    const final = JSON.parse(fs.readFileSync(finalReadiness, 'utf8'));
    final.packageLaunchSmoke = {
      present: true,
      evidencePath: launchPath,
      passed: true,
      checks: launch.checks,
      artifacts: launch.artifacts,
    };
    final.gates.push({
      id: 'package-launch-smoke',
      name: 'Package launch smoke',
      ok: true,
      status: 'passed',
      evidencePath: launchPath,
    });
    writeJson(finalReadiness, final);

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--readme', writeReadme(path.join(runDir, 'README.md'), 'IN_PROGRESS'),
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', path.join(runDir, 'bundle'),
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /Package launch strict contract failed.*PACKAGE_LAUNCH_WINDOW_READY_INVALID/s,
    );
  });

  it('copies the validated package launch marker artifacts into a non-ready bundle', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-launch-artifacts-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const launchPath = path.join(runDir, 'package-launch-smoke.json');
    const launch = writeValidPackageLaunchSmoke(runDir, {
      evidencePath: launchPath,
      generatedAt: new Date().toISOString(),
    });
    const final = JSON.parse(fs.readFileSync(finalReadiness, 'utf8'));
    final.packageLaunchSmoke = {
      present: true,
      evidencePath: launchPath,
      passed: true,
      checks: launch.checks,
      artifacts: launch.artifacts,
    };
    final.gates.push({
      id: 'package-launch-smoke',
      name: 'Package launch smoke',
      ok: true,
      status: 'passed',
      evidencePath: launchPath,
    });
    writeJson(finalReadiness, final);
    const outDir = path.join(runDir, 'bundle');

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--readme', writeReadme(path.join(runDir, 'README.md'), 'IN_PROGRESS'),
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'),
    );
    const expectedArtifacts = launch.checks.flatMap((check) => [
      check.userDataEvidence.markerPath,
      check.windowReadyEvidence.markerPath,
    ]);
    expect(manifest.files).toEqual(expect.arrayContaining(
      expectedArtifacts.map((sourcePath) => expect.objectContaining({ sourcePath })),
    ));
  });

  it('refuses APP_READY bundle export when manifest-selected readback evidence fails verify:ad-readback', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-readback-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const badReadback = path.join(runDir, 'real-ad-execution-readback-bad.json');
    const outDir = path.join(runDir, 'bundle');
    const dbPath = writeAuthorityDbForInvalidReadback(runDir);

    writeJson(badReadback, {
      kind: 'real-ad-execution-readback',
      status: 'PASS',
      readback: { verified: true },
    });
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: badReadback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: badReadback },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('verify:ad-readback');
  });

  it('refuses APP_READY bundle export when data reconciliation references missing real report files', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-missing-report-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const installerContent = 'installer artifact for missing report test\n';
    const portableContent = 'portable artifact for missing report test\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const packageUiScreenshot = path.join(runDir, 'package-ui.png');
    const workspaceUiScreenshot = path.join(runDir, 'workspace-ui.png');
    const workspaceTargetJson = path.join(runDir, 'workspace-target.json');
    fs.writeFileSync(packageUiScreenshot, 'package ui screenshot');
    fs.writeFileSync(workspaceUiScreenshot, 'workspace ui screenshot');
    writeJson(workspaceTargetJson, { passed: true });
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir, packageUiScreenshot);
    writeJson(workspaceUiManifest, {
      passed: true,
      targets: [{
        screenshot: { path: workspaceUiScreenshot },
        jsonPath: workspaceTargetJson,
      }],
    });
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [
        {
          reportType: 'user_search_term',
          filePath: path.join(runDir, 'missing-user-search-term.xlsx'),
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--package-ui-manifest', packageUiManifest,
      '--workspace-ui-manifest', workspaceUiManifest,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('real report index has missing source reports');
  });

  it('refuses APP_READY bundle export when data reconciliation reports blockers', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-data-blocker-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: ['user_search_term report is missing required metric columns: spend, orders, sales.'],
      reportFiles: [
        {
          reportType: 'user_search_term',
          filePath: reportPath,
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('data reconciliation has blockers');
  });

  it('refuses APP_READY bundle export when data reconciliation has no positive canonical ad spend', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-zero-spend-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 0, orders: 0, sales: 0 },
      blockers: [],
      reportFiles: [
        {
          reportType: 'user_search_term',
          filePath: reportPath,
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('positive canonical ad spend');
  });

  it('records installer and portable exe hashes in APP_READY delivery bundle without copying binaries', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-package-index-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for package index\n';
    const portableContent = 'portable artifact for package index\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const packageUiScreenshot = path.join(runDir, 'package-ui.png');
    const workspaceUiScreenshot = path.join(runDir, 'workspace-ui.png');
    const workspaceTargetJson = path.join(runDir, 'workspace-target.json');
    fs.writeFileSync(packageUiScreenshot, 'package ui screenshot');
    fs.writeFileSync(workspaceUiScreenshot, 'workspace ui screenshot');
    writeJson(workspaceTargetJson, { passed: true });
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir, packageUiScreenshot);
    writeJson(workspaceUiManifest, {
      passed: true,
      targets: [{
        screenshot: { path: workspaceUiScreenshot },
        jsonPath: workspaceTargetJson,
      }],
    });
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed', evidencePath: releaseDir },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--package-ui-manifest', packageUiManifest,
      '--workspace-ui-manifest', workspaceUiManifest,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.packageIndex).toMatchObject({
      present: true,
      count: 2,
      existingCount: 2,
      missingCount: 0,
      copyPolicy: expect.stringContaining('not copied'),
    });
    expect(manifest.missing).not.toContainEqual({
      label: 'evidence:release',
      sourcePath: releaseDir,
    });
    expect(manifest.packageIndex.bundleJson).toBeTruthy();
    expect(manifest.authorityDatabase).toMatchObject({
      sourcePath: fs.realpathSync.native(dbPath),
      existsAtExport: true,
      copied: false,
    });
    const packageIndex = JSON.parse(fs.readFileSync(path.join(outDir, manifest.packageIndex.bundleJson), 'utf8'));
    expect(packageIndex.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'installer',
        sourcePath: installerPath,
        sha256: sha256Text(installerContent),
      }),
      expect.objectContaining({
        kind: 'portable',
        sourcePath: portablePath,
        sha256: sha256Text(portableContent),
      }),
    ]));
    for (const file of manifest.files) {
      expect(file.bundlePath).not.toMatch(/\.exe$/i);
      expect(file.bundlePath).not.toMatch(/\.db$/i);
    }
    const bundledReadme = fs.readFileSync(path.join(outDir, 'docs', 'README.md'), 'utf8');
    expect(bundledReadme).toContain('**DELIVERY: APP_READY.');
    expect(manifest.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'AGENTS.md' }),
    ]));
    expect(fs.existsSync(path.join(outDir, 'docs', 'AGENTS.md'))).toBe(false);
    expect(manifest.uiEvidence).toMatchObject({
      packageUiManifest: { sourcePath: packageUiManifest, present: true },
      workspaceUiManifest: { sourcePath: workspaceUiManifest, present: true },
    });
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: packageUiManifest }),
      expect.objectContaining({ sourcePath: packageUiScreenshot }),
      expect.objectContaining({ sourcePath: workspaceUiManifest }),
      expect.objectContaining({ sourcePath: workspaceUiScreenshot }),
      expect.objectContaining({ sourcePath: workspaceTargetJson }),
    ]));

    const otherDbPath = writeAdReadbackAuthorityDb(
      path.join(runDir, 'other-authority-db'),
      JSON.parse(fs.readFileSync(readback, 'utf8')),
    );
    const mismatch = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--db', otherDbPath,
      '--skip-latest-extras', 'true',
      '--out', path.join(runDir, 'mismatch-bundle'),
    ]);
    expect(mismatch.status).not.toBe(0);
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
  });

  it('does not treat basename text or UI smoke mock source files as real report index entries', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-report-index-noise-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const uiSmoke = path.join(runDir, `business-ui-ad-execution-smoke-${runId}.json`);
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for report-index noise test\n';
    const portableContent = 'portable artifact for report-index noise test\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(uiSmoke, {
      kind: 'business-ui-ad-execution-smoke',
      actionLog: [
        {
          input: {
            decision: {
              sourceFiles: ['C:/reports/mock-user-search-term.xlsx'],
              sourceRow: 12,
            },
          },
        },
      ],
    });
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Business UI smoke', ok: true, evidencePath: uiSmoke },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
      filenameDateRangeAnalyses: [
        {
          basename: 'AAO_20260601_20260612_search_term.xlsx',
          analysis: { filename: 'AAO_20260601_20260612_search_term.xlsx' },
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.realReportIndex).toMatchObject({
      present: true,
      count: 2,
      existingCount: 2,
      missingCount: 0,
    });
    const realReportIndex = JSON.parse(fs.readFileSync(path.join(outDir, manifest.realReportIndex.bundleJson), 'utf8'));
    const sourcePaths = realReportIndex.reports.map((item) => item.sourcePath);
    expect(sourcePaths).toContain(reportPath);
    expect(sourcePaths).toContain(path.join(runDir, 'keyword.xlsx'));
    expect(sourcePaths).not.toContain(path.resolve('C:/reports/mock-user-search-term.xlsx'));
    expect(sourcePaths).not.toContain(path.resolve('AAO_20260601_20260612_search_term.xlsx'));
  });

  it('refuses APP_READY bundle export when README delivery line is not APP_READY', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-non-ready-readme-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const nonReadyReadme = writeReadme(path.join(runDir, 'README.md'), 'IN_PROGRESS');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for readme gate\n';
    const portableContent = 'portable artifact for readme gate\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', nonReadyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('README delivery line is not APP_READY');
  });

  it('refuses APP_READY bundle export when final readiness lacks package hash gate evidence', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-stale-final-package-gate-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), 'installer artifact\n');
    writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), 'portable artifact\n');

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness package hash gate evidence is missing');
  });

  it('refuses APP_READY bundle export when portable no-install exe hash evidence is missing', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-missing-portable-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact only\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
        },
      },
    });
    writeJson(finalReadiness, {
      status: 'APP_READY',
      appReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('portable no-install package hash evidence is missing');
  });

  it('excludes smoke and test fixture reconciliation files from default discovery', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-reconciliation-discovery-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const releaseDir = path.join(runDir, 'release');
    const productionJson = path.join(evidenceDir, `data-reconciliation-live-${runId}.json`);
    const productionMarkdown = path.join(evidenceDir, `data-reconciliation-live-${runId}.md`);
    const smokeJson = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.json`);
    const smokeMarkdown = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.md`);
    const fixtureJson = path.join(evidenceDir, `data-reconciliation-test-fixture-${runId}.json`);
    const fixtureMarkdown = path.join(evidenceDir, `data-reconciliation-test-fixture-${runId}.md`);

    writeJson(productionJson, {
      canonicalSource: 'current-live-scope',
      canonical: { spend: 125.5 },
      blockers: [],
    });
    writeText(productionMarkdown, '# Current live reconciliation\n');
    writeJson(smokeJson, {
      canonicalSource: 'smoke-fixture',
      canonical: { spend: 999 },
      blockers: [],
    });
    writeText(smokeMarkdown, '# Smoke fixture\n');
    writeJson(fixtureJson, {
      canonicalSource: 'test-fixture',
      canonical: { spend: 888 },
      blockers: [],
    });
    writeText(fixtureMarkdown, '# Test fixture\n');

    const productionTime = new Date('2099-01-01T00:00:00.000Z');
    const smokeTime = new Date('2099-01-02T00:00:00.000Z');
    const fixtureTime = new Date('2099-01-03T00:00:00.000Z');
    for (const filePath of [productionJson, productionMarkdown]) fs.utimesSync(filePath, productionTime, productionTime);
    for (const filePath of [smokeJson, smokeMarkdown]) fs.utimesSync(filePath, smokeTime, smokeTime);
    for (const filePath of [fixtureJson, fixtureMarkdown]) fs.utimesSync(filePath, fixtureTime, fixtureTime);

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--release-dir', releaseDir,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.dataReconciliation).toMatchObject({
      sourceJsonPath: productionJson,
      sourceMarkdownPath: productionMarkdown,
      canonicalSource: 'current-live-scope',
    });
  });

  it('does not pair an explicit reconciliation JSON with an unrelated latest Markdown', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-explicit-reconciliation-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const releaseDir = path.join(runDir, 'release');
    const explicitJson = path.join(runDir, 'selected-reconciliation.json');
    const unrelatedMarkdown = path.join(evidenceDir, `data-reconciliation-unrelated-${runId}.md`);

    writeJson(explicitJson, {
      canonicalSource: 'explicit-current-scope',
      canonical: { spend: 321.5 },
      blockers: [],
    });
    writeText(unrelatedMarkdown, '# Unrelated latest reconciliation\n');
    const futureTime = new Date('2099-01-04T00:00:00.000Z');
    fs.utimesSync(unrelatedMarkdown, futureTime, futureTime);

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', explicitJson,
      '--release-dir', releaseDir,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.dataReconciliation).toMatchObject({
      sourceJsonPath: explicitJson,
      sourceMarkdownPath: null,
      canonicalSource: 'explicit-current-scope',
      bundleMarkdown: null,
    });
    expect(manifest.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: unrelatedMarkdown }),
    ]));
  });

  it('preserves final-readiness blockers in APP_NEEDS_WORK bundle manifest', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-blocker-summary-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const dbPath = path.join(runDir, 'amazon-ai-ops.db');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(dbPath, 'non-ready-authority-identity-only');

    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {},
    });
    writeJson(finalReadiness, {
      status: 'APP_NEEDS_WORK',
      appReady: false,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      missing: [
        'AI 阶段判断引用的指标证据缺少产品 ASIN。',
      ],
      actionItems: [
        '补齐真实广告报表 sourceFile/sourceRow 后重新生成建议。',
      ],
      recommendationReviewReasons: [
        'AI 候选动作无法绑定当前范围内的真实广告对象。',
      ],
      gates: [
        {
          name: 'Recommendations review blockers',
          ok: false,
          status: 'needs_work',
          message: '当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
        },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: null,
      canonical: null,
      blockers: ['数据对账尚未完成。'],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.appReady).toBe(false);
    expect(manifest.authorityDatabase).toMatchObject({
      sourcePath: fs.realpathSync.native(dbPath),
      existsAtExport: true,
      copied: false,
    });
    expect(manifest.finalReadinessBlockers).toEqual(expect.arrayContaining([
      'AI 阶段判断引用的指标证据缺少产品 ASIN。',
      '补齐真实广告报表 sourceFile/sourceRow 后重新生成建议。',
      'AI 候选动作无法绑定当前范围内的真实广告对象。',
      'Recommendations review blockers: 当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
    ]));
  });

  it('always bundles the manifest selected by final readiness when latest extras are skipped', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-selected-manifest-${runId}`);
    cleanupPaths.push(runDir);
    const { evidenceManifest, finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    const selectedManifestFile = manifest.files.find((file) => file.sourcePath === evidenceManifest);
    expect(selectedManifestFile).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(outDir, selectedManifestFile.bundlePath), 'utf8'))).toMatchObject({
      kind: 'v15-final-readiness-evidence-manifest',
    });
  });

  it('bundles explicitly selected workspace, source-test, and package-security evidence when latest extras are skipped', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-explicit-source-evidence-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    const businessUiSmoke = path.join(runDir, 'current-business-ui-smoke.json');
    const fullTestEvidence = path.join(runDir, 'full-vitest.json');
    const packageSecurityEvidence = path.join(runDir, 'package-security-boundaries.json');
    const outDir = path.join(runDir, 'bundle');
    writeJson(workspaceUiManifest, { kind: 'workspace-ui-evidence', passed: true, targets: [] });
    writeJson(businessUiSmoke, { kind: 'current-business-ui-smoke-summary', passed: true, scripts: [] });
    writeJson(fullTestEvidence, { kind: 'vitest-json-report', success: true, numPassedTests: 1882 });
    writeJson(packageSecurityEvidence, validPackageSecurityEvidence());

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--workspace-ui-manifest', workspaceUiManifest,
      '--business-ui-smoke', businessUiSmoke,
      '--full-test-evidence', fullTestEvidence,
      '--package-security-evidence', packageSecurityEvidence,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.uiEvidence.workspaceUiManifest).toMatchObject({ sourcePath: workspaceUiManifest, present: true });
    expect(manifest.sourceEvidence).toMatchObject({
      businessUiSmoke: { sourcePath: businessUiSmoke, present: true },
      fullTestEvidence: { sourcePath: fullTestEvidence, present: true },
    });
    expect(manifest.securityEvidence.packageSecurityBoundaries).toMatchObject({
      sourcePath: packageSecurityEvidence,
      present: true,
    });
    for (const sourcePath of [workspaceUiManifest, businessUiSmoke, fullTestEvidence, packageSecurityEvidence]) {
      const copied = manifest.files.find((file) => file.sourcePath === sourcePath);
      expect(copied).toBeTruthy();
      expect(fs.existsSync(path.join(outDir, copied.bundlePath))).toBe(true);
    }
  });

  it('bundles regular, read-only subview and wide screenshots referenced by explicit package UI evidence', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-package-ui-wide-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const regularInspector = writePng(path.join(runDir, 'regular-product-inspector.png'));
    const wideWorkspace = writePng(path.join(runDir, 'wide-diagnosis.png'));
    const wideInspector = writePng(path.join(runDir, 'wide-diagnosis-inspector.png'));
    const outDir = path.join(runDir, 'bundle');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir);
    const packageUi = JSON.parse(fs.readFileSync(packageUiManifest, 'utf8'));
    packageUi.runs[0].workspaceChecks[0].inspectorEvidence = {
      screenshot: hashBoundFile(regularInspector),
    };
    packageUi.wideProfile.screenshots[0] = {
      ...packageUi.wideProfile.screenshots[0],
      ...hashBoundFile(wideWorkspace),
    };
    packageUi.wideProfile.workspaceChecks[0].inspectorEvidence = {
      screenshot: hashBoundFile(wideInspector),
    };
    writeJson(packageUiManifest, packageUi);
    const schedulerSubviews = packageUi.runs.map((run) => run.subviewChecks[0].screenshot.path);
    const schedulerRuntimes = packageUi.runs.map((run) => run.schedulerReadOnlyRuntime);
    const wideSchedulerRuntime = packageUi.wideProfile.schedulerReadOnlyRuntime;

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--package-ui-manifest', packageUiManifest,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    for (const sourcePath of [
      regularInspector,
      ...schedulerSubviews,
      ...schedulerRuntimes.map((item) => item.artifact.path),
      wideSchedulerRuntime.artifact.path,
      wideWorkspace,
      wideInspector,
    ]) {
      expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ sourcePath })]));
    }
  });

  it('refuses schema v7 package UI evidence without the bounded interactive-login attestation', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-package-ui-login-attestation-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir);
    const manifest = JSON.parse(fs.readFileSync(packageUiManifest, 'utf8'));
    delete manifest.runs[0].session.loginSessionAttestation;
    writeJson(packageUiManifest, manifest);

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--package-ui-manifest', packageUiManifest,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', path.join(runDir, 'bundle'),
    ]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /SCALE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED/i,
    );
  });

  it('refuses legacy or stale scheduler subview package UI evidence before bundle copy', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-package-ui-stale-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir);
    const manifest = JSON.parse(fs.readFileSync(packageUiManifest, 'utf8'));
    fs.appendFileSync(manifest.runs[0].subviewChecks[0].screenshot.path, Buffer.from('tampered'));

    const stale = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--package-ui-manifest', packageUiManifest,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', path.join(runDir, 'stale-bundle'),
    ]);
    expect(stale.status).toBe(1);
    expect(`${stale.stdout}${stale.stderr}`).toMatch(/SUBVIEW_SCREENSHOT_MISSING_OR_STALE|settings\/scheduler screenshot/i);

    for (const historicalSchemaVersion of [5, 6]) {
      manifest.schemaVersion = historicalSchemaVersion;
      writeJson(packageUiManifest, manifest);
      const historical = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--package-ui-manifest', packageUiManifest,
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', path.join(runDir, `historical-v${historicalSchemaVersion}-bundle`),
      ]);
      expect(historical.status).toBe(1);
      expect(`${historical.stdout}${historical.stderr}`).toMatch(
        /schema v7.*schemas v5\/v6 are historical/i,
      );
    }
  });
});
