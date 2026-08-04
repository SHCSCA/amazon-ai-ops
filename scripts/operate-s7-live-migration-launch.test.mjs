import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP,
  EXCLUSIVE_WINDOW_HELPER_SCRIPT,
  REQUIRED_MIGRATION_VERIFICATION_CODES,
  defaultAcquireLaunchExclusiveWindow,
  defaultInspectWindowsPathSecurity,
  defaultProtectWindowsDirectory,
  defaultProtectWindowsFile,
  postMigrationAuthorityContract,
  resolveTrustedWindowsPowerShell,
  run,
} = require('./operate-s7-live-migration-launch.js');
const {
  evaluatePackageUiEvidenceCompleteness,
} = require('./package-ui-evidence.js');
const {
  REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES,
  validateS7LiveMigrationAcceptanceReceipt,
} = require('./verify-s7-live-migration-acceptance.js');
const { TARGET_VERSION } = require('./migrate-current-user-db.js');
const { legacyV1Checksum } = require('./verify-production-authority-selection.js');

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

function sha(value) {
  return require('node:crypto').createHash('sha256').update(value).digest('hex').toUpperCase();
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function gateArtifact(filePath) {
  const stat = fs.lstatSync(filePath, { bigint: true });
  return {
    path: path.resolve(filePath),
    realPath: fs.realpathSync.native(filePath),
    sha256: sha(fs.readFileSync(filePath)),
    sizeBytes: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    identity: {
      deviceId: stat.dev.toString(),
      fileId: stat.ino.toString(),
      hardLinkCount: Number(stat.nlink),
    },
  };
}

function gateBinding(artifact) {
  return {
    realPath: artifact.realPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    identity: { ...artifact.identity },
  };
}

function passingVerification(manifest) {
  return {
    kind: 's7-migration-backup-restore-verification',
    schemaVersion: 1,
    generatedAt: '2026-07-29T00:30:00.000Z',
    sourceManifestPath: manifest,
    sourceManifestSha256: sha(fs.readFileSync(manifest)),
    passed: true,
    checks: REQUIRED_MIGRATION_VERIFICATION_CODES.map((code) => ({
      code,
      passed: true,
      detail: 'synthetic-readonly-proof',
    })),
    summary: {
      total: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
      passed: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
      failed: 0,
    },
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-launch-'));
  roots.push(root);
  const roaming = path.join(root, 'Roaming');
  const userData = path.join(roaming, '@amazon-ai-ops', 'desktop');
  const db = path.join(userData, 'amazon-ai-ops.db');
  write(db, 'v0-db');

  const exe = path.join(root, 'package', 'AmazonAIOpsAgent.exe');
  const main = path.join(
    root,
    'package',
    'resources',
    'app',
    'dist',
    'main',
    'index.js',
  );
  const app = path.dirname(path.dirname(path.dirname(main)));
  write(exe, 'exe');
  write(main, 'main');
  const exeStat = fs.statSync(exe);
  const mainStat = fs.statSync(main);
  const identity = {
    exe: {
      path: exe,
      realPath: fs.realpathSync.native(exe),
      sha256: sha('exe'),
      sizeBytes: 3,
      mtimeMs: fs.statSync(exe).mtimeMs,
      identity: {
        synthetic: 'exe',
        dev: Number(exeStat.dev),
        ino: Number(exeStat.ino),
        nlink: Number(exeStat.nlink),
      },
    },
    appContent: {
      path: app,
      realPath: fs.realpathSync.native(app),
      sha256: sha('app'),
      fileCount: 1,
      sizeBytes: 4,
    },
    main: {
      path: main,
      realPath: fs.realpathSync.native(main),
      sha256: sha('main'),
      sizeBytes: 4,
      mtimeMs: fs.statSync(main).mtimeMs,
      identity: {
        synthetic: 'main',
        dev: Number(mainStat.dev),
        ino: Number(mainStat.ino),
        nlink: Number(mainStat.nlink),
      },
    },
  };
  const trustedShellIdentity = {
    realPath: identity.exe.realPath,
    sha256: identity.exe.sha256,
    sizeBytes: identity.exe.sizeBytes,
    identity: {
      deviceId: String(identity.exe.identity.dev),
      fileId: String(identity.exe.identity.ino),
      hardLinkCount: 1,
    },
    hardlinkPaths: [identity.exe.realPath],
    signature: {
      status: 'Valid',
      subject: 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond',
      thumbprint: sha('synthetic-shell-thumbprint'),
    },
    version: {
      companyName: 'Microsoft Corporation',
      fileVersion: '10.0.0.0',
      originalFilename: 'PowerShell.EXE',
      productName: 'Microsoft Windows',
    },
  };

  const evidence = path.join(root, 'evidence');
  const approvalOutputRoot = path.join(root, 'approval-output');
  const launchOutputRoot = path.join(root, 'launch-output');
  const acceptanceOutputRoot = path.join(root, 'acceptance-output');
  const finalizationOutputRoot = path.join(root, 'finalization-output');
  fs.mkdirSync(approvalOutputRoot);
  fs.mkdirSync(launchOutputRoot);
  fs.mkdirSync(acceptanceOutputRoot);
  fs.mkdirSync(finalizationOutputRoot);
  const manifest = path.join(evidence, 'offline.json');
  const selection = path.join(evidence, 'selection.json');
  const verification = path.join(evidence, 'verification.json');
  const ui = path.join(evidence, 'package-ui.json');
  const dbStat = fs.statSync(db);
  const dbRecord = {
    path: fs.realpathSync.native(db),
    sha256: sha('v0-db'),
    sizeBytes: dbStat.size,
    mtimeMs: dbStat.mtimeMs,
  };
  const selectionValue = {
    kind: 'production-authority-selection-preflight',
    schemaVersion: 'production-authority-selection-preflight/v1',
    generatedAt: '2026-07-29T00:10:00.000Z',
    status: 'SELECTED_MIGRATION_REQUIRED',
    formalEvidence: false,
    authorityDatabaseMutated: false,
    adsExecutionInvoked: false,
    selection: {
      expectedUserDataDir: fs.realpathSync.native(userData),
      expectedDatabasePath: fs.realpathSync.native(db),
      storesRoot: path.join(fs.realpathSync.native(userData), 'stores'),
      storesRootExists: false,
      expectedMainSha256: sha('v0-db'),
      defaultCandidateCount: 2,
      existingCandidateCount: 1,
      selected: {
        role: 'selected',
        absolutePath: fs.realpathSync.native(db),
        realPath: fs.realpathSync.native(db),
        offlineMigrationEligible: true,
        mainFile: { ...dbRecord },
        mainFileSha256: sha('v0-db'),
        logicalBackupSha256: sha('logical-v0'),
        sidecars: {
          wal: { exists: false },
          shm: { exists: false },
          journal: { exists: false },
        },
        sqlite: { state: 'MIGRATION_REQUIRED', appliedVersion: 0 },
      },
      nonAuthority: [],
    },
  };
  write(selection, selectionValue);
  write(manifest, {
    kind: 's7-offline-db-upgrade',
    schemaVersion: 1,
    generatedAt: '2026-07-29T00:20:00.000Z',
    passed: true,
    targetVersion: TARGET_VERSION,
    source: {
      path: fs.realpathSync.native(db),
      sha256: sha('v0-db'),
      version: 0,
    },
  });
  const verificationValue = passingVerification(manifest);
  write(verification, verificationValue);
  const uiValue = {
    kind: 'package-ui-evidence',
    schemaVersion: 8,
    generatedAt: '2026-07-29T00:00:00.000Z',
    completedAt: '2026-07-29T00:05:00.000Z',
    passed: true,
    requested: {
      executablePath: exe,
      expectedExeSha256: identity.exe.sha256,
      appContentPath: app,
      expectedAppContentSha256: identity.appContent.sha256,
    },
    artifactsBefore: {
      exe: { sha256: identity.exe.sha256 },
      appContent: { sha256: identity.appContent.sha256 },
    },
    artifactsAfter: {
      exe: { sha256: identity.exe.sha256 },
      appContent: { sha256: identity.appContent.sha256 },
    },
    artifactHashesStable: true,
    protectedDatabase: {
      before: dbRecord,
      after: dbRecord,
      passed: true,
      unchanged: true,
    },
    runGroup: { runGroupId: 'synthetic-v8' },
  };
  write(ui, uiValue);

  let schema = 0;
  let spawns = 0;
  let detachCalls = 0;
  let abortCalls = 0;
  let packageIdentityCalls = 0;
  let exclusiveCalls = 0;
  let targetEnvironment = null;
  let startupGatePlan = null;
  let startupGateArtifacts = null;
  let suspendedCreated = false;
  let resumed = false;
  let closed = false;
  const launchObservationOrder = [];
  const protocol = 's7-live-migration-exclusive-window/v1';
  const helperPid = 7001;
  const packagePid = 8123;
  const openedAt = '2026-07-29T01:00:01.000Z';
  const createdAt = '2026-07-29T01:00:02.000Z';
  const finalSameNameInventoryAt = '2026-07-29T01:00:02.500Z';
  const resumedAt = '2026-07-29T01:00:03.000Z';
  const releasedAt = '2026-07-29T01:00:04.000Z';
  const closedAt = '2026-07-29T01:00:05.000Z';
  const environmentSentinelKey = `S7_SENTINEL_${require('node:crypto')
    .randomUUID()
    .replace(/-/g, '_')}`;
  const context = {
    platform: 'win32',
    env: {
      APPDATA: 'C:\\untrusted',
      USERPROFILE: 'C:\\untrusted-profile',
      AMAZON_AI_OPS_EVIDENCE_MODE: 'package-ui',
      AMAZON_AI_OPS_USER_DATA_DIR: 'D:\\Temp\\untrusted',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_ENABLE_LOGGING: '1',
      amazon_ai_ops_user_data: 'D:\\wrong',
      NODE_OPTIONS: '--require bad.js',
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
      FINAL_READINESS_PATH: 'D:\\untrusted-ready.json',
      PORTABLE_EXECUTABLE_DIR: 'D:\\untrusted-portable',
      OPENAI_API_KEY: 'must-not-reach-child',
      LINGXING_PASSWORD: 'must-not-reach-child',
      CUSTOM_TOKEN: 'must-not-reach-child',
      AWS_SESSION_TOKEN: 'must-not-reach-child',
      BROWSER_COOKIE: 'must-not-reach-child',
      [environmentSentinelKey]: 'must-not-reach-child',
      SAFE_VALUE: 'kept',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATH: 'C:\\Windows\\System32',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      TEMP: path.join(root, 'temp'),
      TMP: path.join(root, 'temp'),
      LANG: 'en_US.UTF-8',
      COMPUTERNAME: 'SYNTHETIC-S7-HOST',
    },
    now: () => new Date('2026-07-29T01:00:00.000Z'),
    resolveRoamingAppData: () => roaming,
    resolveUserProfile: () => root,
    packageIdentity: () => {
      packageIdentityCalls += 1;
      return clone(identity);
    },
    trustedPowerShellIdentity: () => clone(trustedShellIdentity),
    readSchemaVersion: () => schema,
    inspectPostMigrationAuthority: () => clone(postMigrationAuthorityContract()),
    inspectAuthority: () => clone(selectionValue),
    verifyMigration: () => clone(verificationValue),
    evaluatePackageUiEvidence: () => ({ passed: true, violations: [] }),
    listProcesses: () => ({
      passed: true,
      matching: suspendedCreated && !closed
        ? [{
            pid: packagePid,
            parentPid: helperPid,
            executablePath: identity.exe.realPath,
          }]
        : [],
      unresolved: [],
    }),
    listSuspendedProcesses: () => context.listProcesses(),
    exclusiveDbPreflight: () => {
      exclusiveCalls += 1;
      return { method: 'windows-fileshare-none', passed: true };
    },
    inspectWindowsPathSecurity: (value, options = {}) => ({
      passed: true,
      path: fs.realpathSync.native(value),
      ownerSid: 'S-1-5-21-synthetic',
      currentUserSid: 'S-1-5-21-synthetic',
      inheritanceProtected: options.requireProtected === true,
      protectedInheritanceRequired: options.requireProtected === true,
      highRiskWritePrincipalCount: 0,
      rules: [],
    }),
    protectWindowsDirectory: (value) => fs.realpathSync.native(value),
    protectWindowsFile: (value) => fs.realpathSync.native(value),
    writeStdout: () => {},
    acquireLaunchExclusiveWindow: async (databasePath, executablePath, env) => {
      launchObservationOrder.push('ready');
      targetEnvironment = env;
      return {
        helperPid,
        synthetic: true,
        proof: {
          protocol,
          status: 'READY',
          helperPid,
          path: databasePath,
          sha256: sha('v0-db'),
          sizeBytes: fs.statSync(db).size,
          openedAt,
          databaseHandleExclusive: true,
        },
        executablePath,
      };
    },
    createSuspendedPackage: async (_windowHandle, _timeoutMs, gatePlan) => {
      spawns += 1;
      expect(
        fs.readdirSync(path.join(userData, '.s7-live-migration-launch-intents')),
      ).toHaveLength(1);
      launchObservationOrder.push('intent-before-suspended-create');
      startupGatePlan = clone(gatePlan);
      write(startupGatePlan.activePath, startupGatePlan.activeDocument);
      const active = gateArtifact(startupGatePlan.activePath);
      write(startupGatePlan.boundPath, {
        kind: 's7-main-startup-gate-bound',
        schemaVersion: 's7-main-startup-gate-bound/v2',
        status: 'BOUND_SUSPENDED',
        gateId: startupGatePlan.gateId,
        invocationId: startupGatePlan.invocationId,
        boundAt: createdAt,
        pid: packagePid,
        threadId: 9001,
        activeGate: gateBinding(active),
        bindings: startupGatePlan.activeDocument.bindings,
      });
      const bound = gateArtifact(startupGatePlan.boundPath);
      startupGateArtifacts = { active, bound };
      suspendedCreated = true;
      launchObservationOrder.push('pid-image-verified');
      return {
        protocol,
        status: 'SPAWNED',
        helperPid,
        pid: packagePid,
        threadId: 9001,
        executablePath: identity.exe.realPath,
        queriedExecutablePath: identity.exe.realPath,
        processImageQueryPassed: true,
        createdSuspended: true,
        databaseHandleExclusive: true,
        createdAt,
        startupGateId: startupGatePlan.gateId,
        startupGateInvocationId: startupGatePlan.invocationId,
        startupGateActivePath: active.realPath,
        startupGateActiveSha256: active.sha256,
        startupGateActiveDeviceId: active.identity.deviceId,
        startupGateActiveFileId: active.identity.fileId,
        startupGateBoundPath: bound.realPath,
        startupGateBoundSha256: bound.sha256,
        startupGateBoundDeviceId: bound.identity.deviceId,
        startupGateBoundFileId: bound.identity.fileId,
        startupGateHandoffReadyPath: startupGatePlan.handoffReadyPath,
        startupGateHandoffReleasedPath: startupGatePlan.handoffReleasedPath,
        startupGateAdmissionPath: startupGatePlan.admissionPath,
        startupGateClosedPath: startupGatePlan.closedPath,
        startupGateFinalizedPath: startupGatePlan.finalizedPath,
        trustedShellPath: trustedShellIdentity.realPath,
        trustedShellSha256: trustedShellIdentity.sha256,
        trustedShellDeviceId: trustedShellIdentity.identity.deviceId,
        trustedShellFileId: trustedShellIdentity.identity.fileId,
        trustedShellHardLinkCount: trustedShellIdentity.identity.hardLinkCount,
        startupGateWindowsSecurityPassed: true,
      };
    },
    releaseAndResumePackage: async () => {
      launchObservationOrder.push('released-and-resumed');
      resumed = true;
      write(startupGatePlan.handoffReadyPath, {
        kind: 's7-main-startup-handoff-ready',
        schemaVersion: 's7-main-startup-handoff-ready/v1',
        status: 'READY_FOR_DB_HANDOFF',
        readyAt: resumedAt,
        pid: packagePid,
        gateId: startupGatePlan.gateId,
        invocationId: startupGatePlan.invocationId,
        singleInstanceLockAcquired: true,
        canonicalUserDataDir: startupGatePlan.activeDocument.canonicalUserDataDir,
        activeGate: gateBinding(startupGateArtifacts.active),
        boundGate: gateBinding(startupGateArtifacts.bound),
        executable: startupGatePlan.activeDocument.bindings.executable,
        main: startupGatePlan.activeDocument.bindings.package.main,
        intent: startupGatePlan.activeDocument.bindings.intent,
        package: startupGatePlan.activeDocument.bindings.package,
        shell: startupGatePlan.activeDocument.bindings.shell,
      });
      const handoffReady = gateArtifact(startupGatePlan.handoffReadyPath);
      write(startupGatePlan.handoffReleasedPath, {
        kind: 's7-main-startup-handoff-released',
        schemaVersion: 's7-main-startup-handoff-released/v1',
        status: 'DB_HANDLE_RELEASED',
        releasedAt,
        helperPid,
        pid: packagePid,
        gateId: startupGatePlan.gateId,
        invocationId: startupGatePlan.invocationId,
        activeGate: gateBinding(startupGateArtifacts.active),
        boundGate: gateBinding(startupGateArtifacts.bound),
        handoffReady: gateBinding(handoffReady),
        database: startupGatePlan.activeDocument.bindings.database,
        shell: startupGatePlan.activeDocument.bindings.shell,
      });
      const handoffReleased = gateArtifact(startupGatePlan.handoffReleasedPath);
      startupGateArtifacts = {
        ...startupGateArtifacts,
        handoffReady,
        handoffReleased,
      };
      return {
        protocol,
        status: 'RESUMED',
        helperPid,
        pid: packagePid,
        finalSameNameInventoryPassed: true,
        finalSameNameProcessCount: 1,
        finalSameNameInventoryAt,
        finalQueriedExecutablePath: identity.exe.realPath,
        finalProcessImageQueryPassed: true,
        releasedAt,
        resumedAt,
        databaseHandleExclusive: false,
        resumeResult: 1,
        startupGateId: startupGatePlan.gateId,
        startupGateInvocationId: startupGatePlan.invocationId,
        startupGateActiveSha256: startupGateArtifacts.active.sha256,
        startupGateBoundSha256: startupGateArtifacts.bound.sha256,
        startupGateHandoffReadyPath: handoffReady.realPath,
        startupGateHandoffReadySha256: handoffReady.sha256,
        startupGateHandoffReadyDeviceId: handoffReady.identity.deviceId,
        startupGateHandoffReadyFileId: handoffReady.identity.fileId,
        startupGateHandoffReleasedPath: handoffReleased.realPath,
        startupGateHandoffReleasedSha256: handoffReleased.sha256,
        startupGateHandoffReleasedDeviceId: handoffReleased.identity.deviceId,
        startupGateHandoffReleasedFileId: handoffReleased.identity.fileId,
        trustedShellSha256: trustedShellIdentity.sha256,
      };
    },
    waitForManagedPackageClose: async () => {
      launchObservationOrder.push('close-monitor');
      write(startupGatePlan.admissionPath, {
        kind: 's7-main-startup-admission',
        schemaVersion: 's7-main-startup-admission/v2',
        status: 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK',
        admittedAt: '2026-07-29T01:00:04.500Z',
        pid: packagePid,
        gateId: startupGatePlan.gateId,
        invocationId: startupGatePlan.invocationId,
        singleInstanceLockAcquired: true,
        canonicalUserDataDir: startupGatePlan.activeDocument.canonicalUserDataDir,
        activeGate: gateBinding(startupGateArtifacts.active),
        boundGate: gateBinding(startupGateArtifacts.bound),
        handoffReady: gateBinding(startupGateArtifacts.handoffReady),
        handoffReleased: gateBinding(startupGateArtifacts.handoffReleased),
        executable: startupGatePlan.activeDocument.bindings.executable,
        main: startupGatePlan.activeDocument.bindings.package.main,
        database: startupGatePlan.activeDocument.bindings.database,
        intent: startupGatePlan.activeDocument.bindings.intent,
        package: startupGatePlan.activeDocument.bindings.package,
        shell: startupGatePlan.activeDocument.bindings.shell,
        sqliteTakeover: {
          connectionPath: db,
          fileMustExist: true,
          busyTimeoutMs: 0,
          lockingMode: 'exclusive',
          beginMode: 'exclusive',
          transactionActive: true,
          sameConnectionRequiredForMigration: true,
          schemaVersionBefore: 0,
        },
      });
      const admission = gateArtifact(startupGatePlan.admissionPath);
      write(startupGatePlan.closedPath, {
        kind: 's7-main-startup-gate-closed',
        schemaVersion: 's7-main-startup-gate-closed/v2',
        status: 'CLOSED_AFTER_GUARDED_MIGRATION',
        closedAt,
        helperPid,
        pid: packagePid,
        exitCode: 0,
        gateId: startupGatePlan.gateId,
        invocationId: startupGatePlan.invocationId,
        activeGate: gateBinding(startupGateArtifacts.active),
        boundGate: gateBinding(startupGateArtifacts.bound),
        handoffReady: gateBinding(startupGateArtifacts.handoffReady),
        handoffReleased: gateBinding(startupGateArtifacts.handoffReleased),
        admission: gateBinding(admission),
        databaseAfterClose: gateBinding(gateArtifact(db)),
        shell: startupGatePlan.activeDocument.bindings.shell,
      });
      const gateClosed = gateArtifact(startupGatePlan.closedPath);
      schema = TARGET_VERSION;
      closed = true;
      return {
        outcome: 'close',
        code: 0,
        signal: null,
        closedAt,
        proof: {
          protocol,
          status: 'CLOSED',
          helperPid,
          pid: packagePid,
          exitCode: 0,
          signal: null,
          closedAt,
          databaseHandleExclusive: false,
          startupGateId: startupGatePlan.gateId,
          startupGateInvocationId: startupGatePlan.invocationId,
          startupGateActivePath: startupGateArtifacts.active.realPath,
          startupGateActiveSha256: startupGateArtifacts.active.sha256,
          startupGateActiveDeviceId: startupGateArtifacts.active.identity.deviceId,
          startupGateActiveFileId: startupGateArtifacts.active.identity.fileId,
          startupGateBoundPath: startupGateArtifacts.bound.realPath,
          startupGateBoundSha256: startupGateArtifacts.bound.sha256,
          startupGateBoundDeviceId: startupGateArtifacts.bound.identity.deviceId,
          startupGateBoundFileId: startupGateArtifacts.bound.identity.fileId,
          startupGateHandoffReadyPath: startupGateArtifacts.handoffReady.realPath,
          startupGateHandoffReadySha256: startupGateArtifacts.handoffReady.sha256,
          startupGateHandoffReadyDeviceId: startupGateArtifacts.handoffReady.identity.deviceId,
          startupGateHandoffReadyFileId: startupGateArtifacts.handoffReady.identity.fileId,
          startupGateHandoffReleasedPath: startupGateArtifacts.handoffReleased.realPath,
          startupGateHandoffReleasedSha256: startupGateArtifacts.handoffReleased.sha256,
          startupGateHandoffReleasedDeviceId: startupGateArtifacts.handoffReleased.identity.deviceId,
          startupGateHandoffReleasedFileId: startupGateArtifacts.handoffReleased.identity.fileId,
          startupGateAdmissionPath: admission.realPath,
          startupGateAdmissionSha256: admission.sha256,
          startupGateAdmissionDeviceId: admission.identity.deviceId,
          startupGateAdmissionFileId: admission.identity.fileId,
          startupGateClosedPath: gateClosed.realPath,
          startupGateClosedSha256: gateClosed.sha256,
          startupGateClosedDeviceId: gateClosed.identity.deviceId,
          startupGateClosedFileId: gateClosed.identity.fileId,
          startupGateAdmissionVerified: true,
          databaseAfterCloseSha256: gateArtifact(db).sha256,
          trustedShellSha256: trustedShellIdentity.sha256,
          startupGateWindowsSecurityPassed: true,
        },
        helperClose: { outcome: 'close', code: 0, signal: null },
      };
    },
    detachManagedLaunch: () => {
      detachCalls += 1;
      return {
        detachedFromOperator: true,
        helperInputState: 'CLOSE_REQUESTED',
        helperInputCloseError: null,
        helperProcessUnrefRequested: true,
        helperStdinUnrefRequested: true,
        helperStdoutUnrefRequested: true,
        processKillInvoked: false,
        helperPid,
      };
    },
    abortUnlaunchedExclusiveWindow: () => {
      abortCalls += 1;
      return {
        helperInputState: 'CLOSE_REQUESTED',
        helperInputCloseError: null,
        helperProcessUnrefRequested: true,
        helperStdinUnrefRequested: true,
        helperStdoutUnrefRequested: true,
        processKillInvoked: false,
        packageProcessCreated: false,
      };
    },
  };
  return {
    root,
    roaming,
    userData,
    db,
    exe,
    manifest,
    selection,
    verification,
    ui,
    approvalOutputRoot,
    launchOutputRoot,
    acceptanceOutputRoot,
    finalizationOutputRoot,
    identity,
    selectionValue,
    verificationValue,
    uiValue,
    context,
    getSpawns: () => spawns,
    getDetachCalls: () => detachCalls,
    getAbortCalls: () => abortCalls,
    getPackageIdentityCalls: () => packageIdentityCalls,
    getExclusiveCalls: () => exclusiveCalls,
    getTargetEnvironment: () => targetEnvironment,
    getStartupGatePlan: () => startupGatePlan,
    getStartupGateArtifacts: () => startupGateArtifacts,
    environmentSentinelKey,
    getLaunchObservationOrder: () => [...launchObservationOrder],
    getManagedState: () => ({ suspendedCreated, resumed, closed }),
    getProtocolFixture: () => ({
      protocol,
      helperPid,
      packagePid,
      openedAt,
      createdAt,
      finalSameNameInventoryAt,
      releasedAt,
      resumedAt,
      closedAt,
    }),
    setSchema: (value) => {
      schema = value;
    },
    setManagedClosed: (value) => {
      closed = value;
    },
  };
}

function prepareArgs(s, out, db = s.db) {
  return [
    '--prepare',
    '--db',
    db,
    '--authority-selection',
    s.selection,
    '--migration-manifest',
    s.manifest,
    '--migration-verification',
    s.verification,
    '--package-ui-manifest',
    s.ui,
    '--recovery-root',
    path.dirname(out),
    '--out',
    out,
  ];
}

async function prepare(s, name = 'approval.json') {
  const packetPath = path.join(s.approvalOutputRoot, name);
  await run(prepareArgs(s, packetPath), s.context);
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  return { packet, packetPath, token: packet.confirmation.token };
}

function executeArgs(packetPath, token, out) {
  return [
    '--execute-approved',
    '--approval-packet',
    packetPath,
    '--confirm-live-migration',
    token,
    '--recovery-root',
    path.dirname(out),
    '--out',
    out,
  ];
}

function writePassingAcceptance(s, packet, name = 'acceptance.json') {
  const database = gateArtifact(s.db);
  const inputArtifact = (value) => ({
    path: value.realPath,
    realPath: value.realPath,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
  });
  const offlineArtifact = (kind) => ({
    path: path.join(s.root, `${kind}.db`),
    identity: {
      realPath: path.join(s.root, `${kind}.db`),
      dev: kind === 'offline-working' ? 101 : 102,
      ino: kind === 'offline-working' ? 201 : 202,
      birthtimeMs: 1_785_307_800_000,
      nlink: 1,
    },
    sha256: sha(`${kind}-sha`),
    sizeBytes: 8192,
    openedReadOnly: true,
    queryOnly: true,
    integrityCheck: 'ok',
    ...(kind === 'offline-working'
      ? {
          foreignKeyViolationCount: 0,
          migrationCount: TARGET_VERSION,
          businessRowPreservationPassed: true,
          recoveryCanRestore: true,
        }
      : {
          version: 0,
          sourceBaselineRowsMatch: true,
        }),
    mtimeMs: 1_785_307_800_000,
    sidecarsAbsentBeforeAndAfter: true,
  });
  const acceptancePath = path.join(s.acceptanceOutputRoot, name);
  const receipt = {
    kind: 's7-live-migration-acceptance',
    schemaVersion: 's7-live-migration-acceptance/v1',
    generatedAt: '2026-07-29T01:10:00.000Z',
    status: 'PASSED',
    passed: true,
    formalEvidence: true,
    authorityDatabaseMutated: false,
    adsExecutionInvoked: false,
    inputs: {
      database: {
        path: database.realPath,
        realPath: database.realPath,
        sha256: database.sha256,
        sizeBytes: database.sizeBytes,
        logicalSnapshotSha256: sha(`synthetic-logical-v${TARGET_VERSION}`),
        logicalSnapshotSizeBytes: database.sizeBytes,
      },
      authoritySelection: inputArtifact(packet.bindings.authoritySelection),
      migrationManifest: inputArtifact(packet.bindings.migrationManifest),
      migrationVerification: inputArtifact(packet.bindings.migrationVerification),
    },
    checks: REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.map((code) => ({
      code,
      passed: true,
      detail: 'production acceptance contract fixture',
    })),
    summary: {
      total: REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.length,
      passed: REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.length,
      failed: 0,
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      migrationCount: TARGET_VERSION,
      requiredTableCount: postMigrationAuthorityContract().requiredTables.length,
      offlineArtifacts: {
        pathsDistinct: true,
        working: offlineArtifact('offline-working'),
        restore: offlineArtifact('offline-restore'),
      },
      businessRowPreservation: {
        passed: true,
        failureCount: 0,
        listingCurrentToHistoryTransferApplied: true,
        listingCurrentToHistoryTransferPassed: true,
      },
      recovery: {
        sourceVersion: 0,
        targetVersion: TARGET_VERSION,
        backupPath: path.join(s.root, `accepted-v${TARGET_VERSION}-backup.db`),
        backupSha256: sha(`accepted-v${TARGET_VERSION}-backup`),
        backupSizeBytes: 8192,
        manifestPath: path.join(s.root, `accepted-v${TARGET_VERSION}-backup.manifest.json`),
        manifestSha256: sha(`accepted-v${TARGET_VERSION}-backup-manifest`),
        backupIntegrityCheck: 'ok',
        schemaFingerprintMatches: true,
        tableRowCountsMatch: true,
        embeddedManifestMatchesAdjacentFile: true,
        canRestore: true,
        blockerCount: 0,
      },
    },
    safety: {
      liveDatabaseAccess: 'readonly-sqlite-online-backup',
      liveDatabaseOpenedReadOnly: true,
      liveDatabaseQueryOnly: true,
      logicalSnapshotInspectedReadOnly: true,
      walAwareSnapshotProofCount: 2,
      authorityDatabaseMutated: false,
      adsExecutionInvoked: false,
      businessRowContentIncluded: false,
      rawSecretsIncluded: false,
    },
  };
  expect(validateS7LiveMigrationAcceptanceReceipt(receipt)).toEqual(receipt);
  write(acceptancePath, receipt);
  return acceptancePath;
}

function prepareFinalizationArgs(
  s,
  approvalPacket,
  launchReceipt,
  acceptanceReceipt,
  out,
) {
  return [
    '--prepare-finalization',
    '--approval-packet',
    approvalPacket,
    '--launch-receipt',
    launchReceipt,
    '--acceptance-receipt',
    acceptanceReceipt,
    '--recovery-root',
    s.finalizationOutputRoot,
    '--out',
    out,
  ];
}

function finalizeArgs(finalizationPacket, token) {
  return [
    '--finalize-approved',
    '--finalization-packet',
    finalizationPacket,
    '--confirm-finalization',
    token,
  ];
}

describe('operate-s7-live-migration-launch', () => {
  it.runIf(process.platform === 'win32')(
    'keeps the Windows suspended-launch helper syntactically valid without executing it',
    () => {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_SCRIPT_B64));[void][scriptblock]::Create($s);[Console]::Out.Write('OK')",
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            AAO_SCRIPT_B64: Buffer.from(EXCLUSIVE_WINDOW_HELPER_SCRIPT, 'utf8').toString('base64'),
          },
          windowsHide: true,
          timeout: 20_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('OK');
    },
  );

  it.runIf(process.platform === 'win32')(
    'fails closed on inherited or high-risk Windows ACLs and accepts an explicitly protected user-owned root',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-acl-'));
      roots.push(root);
      const protectedRoot = path.join(root, 'protected');
      const inheritedRoot = path.join(root, 'inherited');
      const highRiskRoot = path.join(root, 'high-risk');
      fs.mkdirSync(protectedRoot);
      fs.mkdirSync(inheritedRoot);
      fs.mkdirSync(highRiskRoot);

      defaultProtectWindowsDirectory(protectedRoot);
      expect(
        defaultInspectWindowsPathSecurity(protectedRoot, {
          label: 'Synthetic protected recovery root',
          type: 'directory',
          requireProtected: true,
        }),
      ).toMatchObject({
        passed: true,
        inheritanceProtected: true,
        highRiskWritePrincipalCount: 0,
      });
      expect(() => defaultInspectWindowsPathSecurity(inheritedRoot, {
        label: 'Synthetic inherited recovery root',
        type: 'directory',
        requireProtected: true,
      })).toThrow(/inheritance|high-risk principal|unapproved principal/i);

      defaultProtectWindowsDirectory(highRiskRoot);
      const addEveryone = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:S7_ACL_PATH_B64))",
            '$acl=[System.IO.Directory]::GetAccessControl($p)',
            '$sid=[System.Security.Principal.SecurityIdentifier]::new("S-1-1-0")',
            '$rule=[System.Security.AccessControl.FileSystemAccessRule]::new(',
            '  $sid,',
            '  [System.Security.AccessControl.FileSystemRights]::FullControl,',
            '  [System.Security.AccessControl.InheritanceFlags]::None,',
            '  [System.Security.AccessControl.PropagationFlags]::None,',
            '  [System.Security.AccessControl.AccessControlType]::Allow',
            ')',
            '[void]$acl.AddAccessRule($rule)',
            '[System.IO.Directory]::SetAccessControl($p,$acl)',
          ].join('\n'),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            S7_ACL_PATH_B64: Buffer.from(highRiskRoot, 'utf8').toString('base64'),
          },
          windowsHide: true,
          timeout: 20_000,
        },
      );
      expect(addEveryone.error).toBeUndefined();
      expect(addEveryone.status, addEveryone.stderr).toBe(0);
      expect(() => defaultInspectWindowsPathSecurity(highRiskRoot, {
        label: 'Synthetic high-risk recovery root',
        type: 'directory',
        requireProtected: true,
      })).toThrow(/high-risk principal/i);

      const wired = setup();
      wired.context.inspectWindowsPathSecurity = defaultInspectWindowsPathSecurity;
      defaultProtectWindowsFile(wired.db);
      await expect(
        run(
          prepareArgs(
            wired,
            path.join(wired.approvalOutputRoot, 'acl-rejected.json'),
          ),
          wired.context,
        ),
      ).rejects.toThrow(/inheritance|high-risk principal|unapproved principal/i);
      defaultProtectWindowsDirectory(wired.approvalOutputRoot);
      const passedOutput = path.join(wired.approvalOutputRoot, 'acl-passed.json');
      await expect(
        run(prepareArgs(wired, passedOutput), wired.context),
      ).resolves.toMatchObject({ exitCode: 0, outputPath: passedOutput });
      expect(defaultInspectWindowsPathSecurity(passedOutput, {
        label: 'Synthetic protected approval packet',
        type: 'file',
        requireProtected: false,
      })).toMatchObject({ passed: true, ownerSid: expect.any(String) });
    },
    60_000,
  );

  it.runIf(process.platform === 'win32')(
    'retains helper identity, script hash, late proof buffer, and cleanup state when READY acquisition times out',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-ready-timeout-'));
      roots.push(root);
      const db = path.join(root, 'synthetic.db');
      const exe = path.join(root, 'never-created.exe');
      write(db, 'synthetic-ready-timeout-db');
      write(exe, 'not-an-executable');
      let captured;
      try {
        await defaultAcquireLaunchExclusiveWindow(
          db,
          exe,
          {
            SYSTEMROOT: process.env.SystemRoot || 'C:\\Windows',
            WINDIR: process.env.WINDIR || 'C:\\Windows',
            COMSPEC: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
            PATH: process.env.PATH || '',
            PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
            TEMP: root,
            TMP: root,
          },
          1,
        );
      } catch (error) {
        captured = error;
      }
      expect(captured).toBeInstanceOf(Error);
      expect(captured.proof).toMatchObject({
        protocol: 's7-live-migration-exclusive-window/v1',
        status: 'ACQUISITION_UNTRUSTED',
        phase: 'await-ready',
        helperInputState: 'CLOSE_REQUESTED',
        helperProcessUnrefRequested: true,
        helperStdinUnrefRequested: true,
        helperStdoutUnrefRequested: true,
      });
      expect(captured.proof.helperPid).toBeGreaterThan(0);
      expect(captured.proof.scriptSha256).toMatch(/^[A-F0-9]{64}$/);
      expect(captured.proof.lateProofBuffer).toMatchObject({
        queuedProofs: expect.any(Array),
        partialBytes: expect.any(Number),
      });
    },
    60_000,
  );

  it.runIf(process.platform === 'win32')(
    'runs the native CREATE_SUSPENDED -> SPAWNED -> RESUMED -> CLOSED chain only against a synthetic target and DB',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-helper-ready-'));
      const db = path.join(root, 'synthetic.db');
      const fakeExe = path.join(root, `S7T-${process.pid}.exe`);
      write(db, 'synthetic-exclusive-db');
      const targetSource = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class S7SyntheticTarget {
  [StructLayout(LayoutKind.Sequential)]
  public struct FILETIME { public UInt32 Low; public UInt32 High; }

  [StructLayout(LayoutKind.Sequential)]
  public struct BY_HANDLE_FILE_INFORMATION {
    public UInt32 FileAttributes;
    public FILETIME CreationTime;
    public FILETIME LastAccessTime;
    public FILETIME LastWriteTime;
    public UInt32 VolumeSerialNumber;
    public UInt32 FileSizeHigh;
    public UInt32 FileSizeLow;
    public UInt32 NumberOfLinks;
    public UInt32 FileIndexHigh;
    public UInt32 FileIndexLow;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetFileInformationByHandle(
    SafeFileHandle handle,
    out BY_HANDLE_FILE_INFORMATION information
  );

  private static Dictionary<string, object> ObjectAt(
    Dictionary<string, object> value,
    string key
  ) {
    return (Dictionary<string, object>)value[key];
  }

  private static Dictionary<string, object> Artifact(string filePath) {
    using (FileStream stream = File.Open(
      filePath,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read | FileShare.Delete
    )) {
      BY_HANDLE_FILE_INFORMATION information;
      if (!GetFileInformationByHandle(stream.SafeFileHandle, out information)) {
        throw new System.ComponentModel.Win32Exception();
      }
      UInt64 fileId = ((UInt64)information.FileIndexHigh << 32) | information.FileIndexLow;
      string hash;
      using (SHA256 sha = SHA256.Create()) {
        hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
      }
      return new Dictionary<string, object> {
        { "realPath", Path.GetFullPath(filePath) },
        { "sha256", hash },
        { "sizeBytes", stream.Length },
        { "identity", new Dictionary<string, object> {
          { "deviceId", ((UInt64)information.VolumeSerialNumber).ToString() },
          { "fileId", fileId.ToString() },
          { "hardLinkCount", (int)information.NumberOfLinks }
        }}
      };
    }
  }

  private static void ProtectFile(string filePath) {
    SecurityIdentifier current = WindowsIdentity.GetCurrent().User;
    SecurityIdentifier system = new SecurityIdentifier("S-1-5-18");
    SecurityIdentifier admins = new SecurityIdentifier("S-1-5-32-544");
    FileSecurity acl = new FileSecurity();
    acl.SetOwner(current);
    acl.SetAccessRuleProtection(true, false);
    foreach (SecurityIdentifier sid in new [] { current, system, admins }) {
      acl.AddAccessRule(new FileSystemAccessRule(
        sid,
        FileSystemRights.FullControl,
        InheritanceFlags.None,
        PropagationFlags.None,
        AccessControlType.Allow
      ));
    }
    new FileInfo(filePath).SetAccessControl(acl);
  }

  private static void WriteExclusiveJson(
    string filePath,
    Dictionary<string, object> value,
    JavaScriptSerializer serializer
  ) {
    byte[] bytes = new UTF8Encoding(false).GetBytes(serializer.Serialize(value) + Environment.NewLine);
    using (FileStream stream = File.Open(
      filePath,
      FileMode.CreateNew,
      FileAccess.Write,
      FileShare.None
    )) {
      stream.Write(bytes, 0, bytes.Length);
      stream.Flush(true);
    }
    ProtectFile(filePath);
  }

  [STAThread]
  public static void Main() {
    JavaScriptSerializer serializer = new JavaScriptSerializer();
    string activePath = Encoding.UTF8.GetString(Convert.FromBase64String(
      Environment.GetEnvironmentVariable("AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64")
    ));
    Dictionary<string, object> active = (Dictionary<string, object>)
      serializer.DeserializeObject(File.ReadAllText(activePath, new UTF8Encoding(false)));
    Dictionary<string, object> paths = ObjectAt(active, "paths");
    Dictionary<string, object> bindings = ObjectAt(active, "bindings");
    Dictionary<string, object> package = ObjectAt(bindings, "package");
    Dictionary<string, object> database = ObjectAt(bindings, "database");
    string databasePath = (string)database["realPath"];
    string boundPath = (string)paths["bound"];
    string handoffReadyPath = (string)paths["handoffReady"];
    string handoffReleasedPath = (string)paths["handoffReleased"];
    string admissionPath = (string)paths["admission"];
    string resultPath = Path.Combine(Path.GetDirectoryName(activePath), "SYNTHETIC-RESULT.json");
    bool helperPrivateEnvironmentAbsent =
      Environment.GetEnvironmentVariable("AAO_S7_EXCLUSIVE_DB_B64") == null &&
      Environment.GetEnvironmentVariable("AAO_S7_EXECUTABLE_B64") == null &&
      Environment.GetEnvironmentVariable("AAO_S7_WORKING_DIRECTORY_B64") == null;
    Dictionary<string, object> handoffReady = new Dictionary<string, object> {
      { "kind", "s7-main-startup-handoff-ready" },
      { "schemaVersion", "s7-main-startup-handoff-ready/v1" },
      { "status", "READY_FOR_DB_HANDOFF" },
      { "readyAt", DateTime.UtcNow.ToString("o") },
      { "pid", Process.GetCurrentProcess().Id },
      { "gateId", (string)active["gateId"] },
      { "invocationId", (string)active["invocationId"] },
      { "singleInstanceLockAcquired", true },
      { "canonicalUserDataDir", (string)active["canonicalUserDataDir"] },
      { "activeGate", Artifact(activePath) },
      { "boundGate", Artifact(boundPath) },
      { "executable", ObjectAt(bindings, "executable") },
      { "main", ObjectAt(package, "main") },
      { "intent", ObjectAt(bindings, "intent") },
      { "package", package },
      { "shell", ObjectAt(bindings, "shell") }
    };
    WriteExclusiveJson(handoffReadyPath, handoffReady, serializer);
    Stopwatch handoffWait = Stopwatch.StartNew();
    while (!File.Exists(handoffReleasedPath) && handoffWait.ElapsedMilliseconds < 30000) {
      System.Threading.Thread.Sleep(25);
    }
    if (!File.Exists(handoffReleasedPath)) throw new Exception("handoff-release-timeout");
    Dictionary<string, object> handoffReleased = (Dictionary<string, object>)
      serializer.DeserializeObject(File.ReadAllText(
        handoffReleasedPath,
        new UTF8Encoding(false)
      ));
    bool databaseExclusiveOpenPassed = false;
    try {
      using (FileStream stream = File.Open(
        databasePath,
        FileMode.Open,
        FileAccess.Read,
        FileShare.None
      )) {
        databaseExclusiveOpenPassed = stream.Length > 0;
      }
    } catch {
      databaseExclusiveOpenPassed = false;
    }
    Dictionary<string, object> admission = new Dictionary<string, object> {
      { "kind", "s7-main-startup-admission" },
      { "schemaVersion", "s7-main-startup-admission/v2" },
      { "status", "ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK" },
      { "admittedAt", DateTime.UtcNow.ToString("o") },
      { "pid", Process.GetCurrentProcess().Id },
      { "gateId", (string)active["gateId"] },
      { "invocationId", (string)active["invocationId"] },
      { "singleInstanceLockAcquired", true },
      { "canonicalUserDataDir", (string)active["canonicalUserDataDir"] },
      { "activeGate", Artifact(activePath) },
      { "boundGate", Artifact(boundPath) },
      { "handoffReady", Artifact(handoffReadyPath) },
      { "handoffReleased", Artifact(handoffReleasedPath) },
      { "executable", ObjectAt(bindings, "executable") },
      { "main", ObjectAt(package, "main") },
      { "database", database },
      { "intent", ObjectAt(bindings, "intent") },
      { "package", package },
      { "shell", ObjectAt(bindings, "shell") },
      { "sqliteTakeover", new Dictionary<string, object> {
        { "connectionPath", databasePath },
        { "fileMustExist", true },
        { "busyTimeoutMs", 0 },
        { "lockingMode", "exclusive" },
        { "beginMode", "exclusive" },
        { "transactionActive", true },
        { "sameConnectionRequiredForMigration", true },
        { "schemaVersionBefore", 0 }
      }}
    };
    WriteExclusiveJson(admissionPath, admission, serializer);
    File.WriteAllText(resultPath, serializer.Serialize(new Dictionary<string, object> {
      { "helperPrivateEnvironmentAbsent", helperPrivateEnvironmentAbsent },
      { "databaseExclusiveOpenPassed", databaseExclusiveOpenPassed },
      { "gateEnvironmentPresent",
        Environment.GetEnvironmentVariable("AAO_S7_STARTUP_GATE_ID") != null }
    }), new UTF8Encoding(false));
  }
}
`;
      const compile = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:S7_TARGET_SOURCE_B64));Add-Type -TypeDefinition $s -Language CSharp -ReferencedAssemblies System.Web.Extensions -OutputAssembly $env:S7_TARGET_EXE -OutputType WindowsApplication',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            S7_TARGET_SOURCE_B64: Buffer.from(targetSource, 'utf8').toString('base64'),
            S7_TARGET_EXE: fakeExe,
          },
          windowsHide: true,
          timeout: 30_000,
        },
      );
      expect(compile.error).toBeUndefined();
      expect(compile.status, compile.stderr).toBe(0);
      expect(fs.existsSync(fakeExe)).toBe(true);

      const gateDirectory = path.join(root, '.s7-main-startup-gate');
      const activePath = path.join(gateDirectory, 'ACTIVE.json');
      const boundPath = path.join(gateDirectory, 'BOUND.json');
      const handoffReadyPath = path.join(gateDirectory, 'HANDOFF_READY.json');
      const handoffReleasedPath = path.join(gateDirectory, 'HANDOFF_RELEASED.json');
      const admissionPath = path.join(gateDirectory, 'ADMISSION.json');
      const closedPath = path.join(gateDirectory, 'CLOSED.json');
      const finalizedPath = path.join(gateDirectory, 'FINALIZED.json');
      const targetResult = path.join(gateDirectory, 'SYNTHETIC-RESULT.json');
      const intentPath = path.join(root, 'synthetic.intent.json');
      const mainPath = path.join(root, 'synthetic-main.js');
      fs.mkdirSync(gateDirectory);
      defaultProtectWindowsDirectory(gateDirectory);
      defaultProtectWindowsFile(db);
      write(intentPath, '{"approved":true}\n');
      defaultProtectWindowsFile(intentPath);
      write(mainPath, 'synthetic-main');
      const executable = gateArtifact(fakeExe);
      const main = gateArtifact(mainPath);
      const database = gateArtifact(db);
      const intent = gateArtifact(intentPath);
      const trustedShell = resolveTrustedWindowsPowerShell(process.env);
      const gatePlan = {
        gateDirectory,
        activePath,
        boundPath,
        handoffReadyPath,
        handoffReleasedPath,
        admissionPath,
        closedPath,
        finalizedPath,
        gateId: 'gate-native-helper-synthetic',
        invocationId: 'invocation-native-helper-synthetic',
        activeDocument: {
          kind: 's7-main-startup-gate-active',
          schemaVersion: 's7-main-startup-gate-active/v2',
          status: 'ACTIVE_AWAITING_BOUND_CHILD',
          gateId: 'gate-native-helper-synthetic',
          invocationId: 'invocation-native-helper-synthetic',
          createdAt: new Date().toISOString(),
          canonicalUserDataDir: root,
          paths: {
            active: activePath,
            bound: boundPath,
            handoffReady: handoffReadyPath,
            handoffReleased: handoffReleasedPath,
            admission: admissionPath,
            closed: closedPath,
            finalized: finalizedPath,
          },
          bindings: {
            executable: gateBinding(executable),
            package: {
              exe: gateBinding(executable),
              appContent: {
                realPath: root,
                sha256: sha('synthetic-app-content'),
                fileCount: 2,
                sizeBytes: executable.sizeBytes + main.sizeBytes,
              },
              main: gateBinding(main),
            },
            database: gateBinding(database),
            intent: gateBinding(intent),
            shell: {
              realPath: trustedShell.realPath,
              sha256: trustedShell.sha256,
              sizeBytes: trustedShell.sizeBytes,
              identity: { ...trustedShell.identity },
              hardlinkPaths: [...trustedShell.hardlinkPaths],
              signature: { ...trustedShell.signature },
              version: { ...trustedShell.version },
            },
          },
        },
      };

      const encode = (value) => Buffer.from(value, 'utf8').toString('base64');
      const nativeRuntimeEnvironment = {};
      const nativeRuntimeAllowlist = new Set([
        'COMSPEC',
        'LANG',
        'LC_ALL',
        'LC_CTYPE',
        'PATHEXT',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'WINDIR',
      ]);
      for (const [key, value] of Object.entries(process.env)) {
        if (nativeRuntimeAllowlist.has(key.toUpperCase()) && typeof value === 'string') {
          nativeRuntimeEnvironment[key.toUpperCase()] = value;
        }
      }
      const nativeWindowsRoot = process.env.WINDIR || 'C:\\Windows';
      const nativeSystem32 = path.join(nativeWindowsRoot, 'System32');
      nativeRuntimeEnvironment.SYSTEMROOT = nativeWindowsRoot;
      nativeRuntimeEnvironment.WINDIR = nativeWindowsRoot;
      nativeRuntimeEnvironment.SYSTEMDRIVE = path.parse(nativeWindowsRoot).root.replace(
        /[\\/]$/,
        '',
      );
      nativeRuntimeEnvironment.COMSPEC = path.join(nativeSystem32, 'cmd.exe');
      nativeRuntimeEnvironment.PATH = [
        nativeSystem32,
        path.join(nativeSystem32, 'Wbem'),
        path.join(nativeSystem32, 'WindowsPowerShell', 'v1.0'),
      ].join(';');
      const child = spawn(
        path.join(
          nativeWindowsRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        ['-NoProfile', '-NonInteractive', '-Command', EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP],
        {
          env: {
            ...nativeRuntimeEnvironment,
            AAO_S7_EXCLUSIVE_DB_B64: encode(db),
            AAO_S7_EXECUTABLE_B64: encode(fakeExe),
            AAO_S7_WORKING_DIRECTORY_B64: encode(root),
          },
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      child.stdout.setEncoding('utf8');
      const closePromise = new Promise((resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      const stderr = [];
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      const iterator = lines[Symbol.asyncIterator]();
      let lastProtocolProof = null;
      const nextProof = async (status) => {
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`synthetic helper ${status} timeout: ${stderr.join('')}`)),
            20_000,
          );
        });
        try {
          const item = await Promise.race([iterator.next(), timeout]);
          expect(item.done, `synthetic helper ${status} closed early: ${stderr.join('')}`).toBe(
            false,
          );
          const proof = JSON.parse(item.value);
          lastProtocolProof = proof;
          if (proof.status !== status) {
            throw new Error(
              `synthetic helper expected ${status} but received ${JSON.stringify(proof)}`,
            );
          }
          return proof;
        } finally {
          clearTimeout(timer);
        }
      };

      let spawnedPid = null;
      let releaseSent = false;
      let closedObserved = false;
      try {
        const ready = await nextProof('READY');
        expect(ready).toMatchObject({
          protocol: 's7-live-migration-exclusive-window/v1',
          status: 'READY',
          path: fs.realpathSync.native(db),
          sha256: sha('synthetic-exclusive-db'),
          databaseHandleExclusive: true,
        });
        expect(() => fs.openSync(db, fs.constants.O_RDONLY)).toThrow();

        child.stdin.write(
          `S7_CREATE_SUSPENDED ${encode(JSON.stringify(gatePlan))}\n`,
        );
        const spawned = await nextProof('SPAWNED');
        spawnedPid = spawned.pid;
        expect(spawned).toMatchObject({
          protocol: 's7-live-migration-exclusive-window/v1',
          createdSuspended: true,
          databaseHandleExclusive: true,
          queriedExecutablePath: fs.realpathSync.native(fakeExe),
          processImageQueryPassed: true,
          startupGateId: gatePlan.gateId,
          startupGateInvocationId: gatePlan.invocationId,
          startupGateAdmissionPath: admissionPath,
          startupGateClosedPath: closedPath,
          startupGateWindowsSecurityPassed: true,
        });
        expect(fs.existsSync(targetResult)).toBe(false);
        expect(fs.existsSync(activePath)).toBe(true);
        expect(fs.existsSync(boundPath)).toBe(true);
        expect(fs.existsSync(admissionPath)).toBe(false);
        expect(fs.existsSync(closedPath)).toBe(false);
        expect(() => fs.openSync(db, fs.constants.O_RDONLY)).toThrow();
        const pidInspection = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `@(Get-CimInstance Win32_Process -Filter "ProcessId=${spawned.pid}" | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`,
          ],
          {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 20_000,
          },
        );
        expect(pidInspection.error).toBeUndefined();
        expect(pidInspection.status, pidInspection.stderr).toBe(0);
        const inspected = JSON.parse(String(pidInspection.stdout).trim());
        expect(Number(inspected.ProcessId)).toBe(spawned.pid);
        expect(String(inspected.Name).toLowerCase()).toBe(path.basename(fakeExe).toLowerCase());

        child.stdin.write('S7_RELEASE_AND_RESUME\n');
        releaseSent = true;
        const resumed = await nextProof('RESUMED');
        expect(resumed).toMatchObject({
          protocol: 's7-live-migration-exclusive-window/v1',
          pid: spawned.pid,
          databaseHandleExclusive: false,
          resumeResult: 1,
          finalSameNameInventoryPassed: true,
          finalSameNameProcessCount: 1,
          finalQueriedExecutablePath: fs.realpathSync.native(fakeExe),
          finalProcessImageQueryPassed: true,
          startupGateId: gatePlan.gateId,
          startupGateInvocationId: gatePlan.invocationId,
        });
        const closed = await nextProof('CLOSED');
        closedObserved = true;
        expect(closed).toMatchObject({
          protocol: 's7-live-migration-exclusive-window/v1',
          pid: spawned.pid,
          exitCode: 0,
          databaseHandleExclusive: false,
          startupGateId: gatePlan.gateId,
          startupGateInvocationId: gatePlan.invocationId,
          startupGateAdmissionVerified: true,
          startupGateWindowsSecurityPassed: true,
          startupGateAdmissionPath: fs.realpathSync.native(admissionPath),
          startupGateClosedPath: fs.realpathSync.native(closedPath),
        });
        expect(fs.existsSync(activePath)).toBe(true);
        expect(fs.existsSync(boundPath)).toBe(true);
        expect(fs.existsSync(admissionPath)).toBe(true);
        expect(fs.existsSync(closedPath)).toBe(true);
        await expect(closePromise).resolves.toEqual({ code: 0, signal: null });
        expect(JSON.parse(fs.readFileSync(targetResult, 'utf8').replace(/^\uFEFF/, ''))).toEqual({
          helperPrivateEnvironmentAbsent: true,
          databaseExclusiveOpenPassed: true,
          gateEnvironmentPresent: true,
        });
        const reopened = fs.openSync(db, fs.constants.O_RDONLY);
        fs.closeSync(reopened);
        expect(fs.readFileSync(db, 'utf8')).toBe('synthetic-exclusive-db');
      } finally {
        lines.close();
        if (
          !closedObserved
          && Number.isInteger(spawnedPid)
          && !releaseSent
          && !child.stdin.destroyed
        ) {
          try {
            child.stdin.write('S7_RELEASE_AND_RESUME\n');
            releaseSent = true;
          } catch {
            // The bounded close check below remains authoritative.
          }
        } else if (!Number.isInteger(spawnedPid) && !child.stdin.destroyed) {
          try {
            child.stdin.end();
          } catch {
            // The bounded close check below remains authoritative.
          }
        }
        const boundedHelperClose = await Promise.race([
          closePromise,
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ outcome: 'timeout' }), 10_000);
            timer.unref?.();
          }),
        ]);
        child.stdin.unref?.();
        child.stdout.unref?.();
        child.stderr.unref?.();
        child.unref();
        if (boundedHelperClose?.outcome === 'timeout') {
          throw new Error(`synthetic helper did not close; preserved ${root}`);
        }
        if (Number.isInteger(spawnedPid)) {
          const remaining = spawnSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `@(Get-CimInstance Win32_Process -Filter "ProcessId=${spawnedPid}" | Select-Object ProcessId) | ConvertTo-Json -Compress`,
            ],
            { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
          );
          const remainingText = String(remaining.stdout || '').trim();
          if (
            remaining.error
            || remaining.status !== 0
            || !['', '[]', 'null'].includes(remainingText)
          ) {
            throw new Error(
              `synthetic child close was not proven; preserved ${root}: `
                + String(remaining.stdout || remaining.stderr || '')
                + ` lastProtocolProof=${JSON.stringify(lastProtocolProof)}`,
            );
          }
        }
        fs.rmSync(root, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
    60_000,
  );

  it('keeps help side-effect free and prepares a full-payload, v0-only approval packet', async () => {
    const s = setup();
    const before = fs.readdirSync(s.root, { recursive: true });
    await expect(run([], { ...s.context, platform: 'linux' })).resolves.toMatchObject({
      exitCode: 0,
      outputPath: null,
    });
    expect(fs.readdirSync(s.root, { recursive: true })).toEqual(before);
    const { packet } = await prepare(s);
    expect(packet.schemaVersion).toBe('s7-live-migration-approval-packet/v2');
    expect(packet.confirmation.token).toMatch(/^LIVE-MIGRATION-[A-F0-9]{64}$/);
    expect(packet.safety).toMatchObject({
      packageLaunched: 'NOT_LAUNCHED',
      requiresExplicitUserApproval: true,
      replayGuard: 'COMPLETE_INTENT_FILE_PRESENT',
      absoluteAdministratorReplayPrevention: false,
      intentLossRequiresHoldAndNewApproval: true,
      packageAdsExecutionState: 'NOT_LAUNCHED',
    });
    expect(packet.bindings.schemaVersion).toBe(0);
    expect(packet.bindings.offlineProof).toEqual({
      method: 'windows-fileshare-none',
      passed: true,
    });
    expect(packet.bindings.migrationVerificationRerun).toMatchObject({
      verifier: 'verifyS7MigrationBackupRestore',
      passed: true,
      checkCodes: REQUIRED_MIGRATION_VERIFICATION_CODES,
      summary: { total: 19, passed: 19, failed: 0 },
    });
    expect(packet.bindings.packageUi).toMatchObject({
      formalEvaluation: {
        evaluator: 'evaluatePackageUiEvidenceCompleteness',
        passed: true,
        violationCount: 0,
      },
      protectedDatabaseBinding: {
        path: fs.realpathSync.native(s.db),
        sha256: sha('v0-db'),
        beforeMatches: true,
        afterMatches: true,
      },
    });
    expect(packet.bindings.processPreflight).toEqual({
      query: 'all-AmazonAIOpsAgent.exe-processes',
      passed: true,
      matchingCount: 0,
      unresolvedCount: 0,
    });
    expect(fs.existsSync(path.join(s.userData, '.s7-live-migration-launch-intents'))).toBe(false);
  });

  it('requires an isolated recovery root outside package, userData, and every input artifact tree', async () => {
    const packageCase = setup();
    await expect(
      run(
        prepareArgs(
          packageCase,
          path.join(path.dirname(packageCase.exe), 'forbidden-package-output.json'),
        ),
        packageCase.context,
      ),
    ).rejects.toThrow(/isolated from package root/i);

    const userDataCase = setup();
    await expect(
      run(
        prepareArgs(
          userDataCase,
          path.join(userDataCase.userData, 'forbidden-user-data-output.json'),
        ),
        userDataCase.context,
      ),
    ).rejects.toThrow(/canonical packaged userData/i);

    const inputTreeCase = setup();
    await expect(
      run(
        prepareArgs(
          inputTreeCase,
          path.join(path.dirname(inputTreeCase.selection), 'forbidden-input-output.json'),
        ),
        inputTreeCase.context,
      ),
    ).rejects.toThrow(/input artifact tree/i);

    const executeCase = setup();
    const prepared = await prepare(executeCase);
    await expect(
      run(
        executeArgs(
          prepared.packetPath,
          prepared.token,
          path.join(executeCase.approvalOutputRoot, 'forbidden-launch-receipt.json'),
        ),
        executeCase.context,
      ),
    ).rejects.toThrow(/input artifact tree/i);
    expect(executeCase.getSpawns()).toBe(0);
  });

  it('rejects a self-asserted Package UI manifest that fails the formal v8 evaluator', async () => {
    const s = setup();
    s.context.evaluatePackageUiEvidence = evaluatePackageUiEvidenceCompleteness;
    await expect(
      run(prepareArgs(s, path.join(s.approvalOutputRoot, 'invalid-package-ui.json')), s.context),
    ).rejects.toThrow(/formal Package UI/i);
  });

  it('binds Package UI before and after evidence to the exact current live DB', async () => {
    const s = setup();
    const ui = clone(s.uiValue);
    ui.protectedDatabase.after.sha256 = sha('another-db');
    write(s.ui, ui);
    await expect(
      run(prepareArgs(s, path.join(s.approvalOutputRoot, 'wrong-protected-db.json')), s.context),
    ).rejects.toThrow(/live authority DB/i);
  });

  it('requires the exact 19-code receipt and an independent passing rerun', async () => {
    const s = setup();
    const receipt = clone(s.verificationValue);
    receipt.checks = [{ code: 'X', passed: true }];
    receipt.summary = { total: 1, passed: 1, failed: 0 };
    write(s.verification, receipt);
    await expect(
      run(prepareArgs(s, path.join(s.approvalOutputRoot, 'truncated.json')), s.context),
    ).rejects.toThrow(/exact 19/i);

    const s2 = setup();
    s2.context.verifyMigration = () => ({
      ...clone(s2.verificationValue),
      passed: false,
    });
    await expect(
      run(prepareArgs(s2, path.join(s2.approvalOutputRoot, 'rerun-failed.json')), s2.context),
    ).rejects.toThrow(/independently recomputed/i);
  });

  it('requires Windows, the Known-Folder canonical DB, exact v0, and current authority inventory', async () => {
    const s = setup();
    await expect(
      run(prepareArgs(s, path.join(s.approvalOutputRoot, 'linux.json')), {
        ...s.context,
        platform: 'linux',
      }),
    ).rejects.toThrow(/only on Windows/i);

    const alternate = path.join(s.root, 'alternate', 'amazon-ai-ops.db');
    write(alternate, 'v0-db');
    await expect(
      run(prepareArgs(s, path.join(s.approvalOutputRoot, 'alternate.json'), alternate), s.context),
    ).rejects.toThrow(/canonical packaged AppData/i);

    const s2 = setup();
    s2.setSchema(1);
    await expect(
      run(prepareArgs(s2, path.join(s2.approvalOutputRoot, 'v1.json')), s2.context),
    ).rejects.toThrow(/exactly v0/i);

    const s3 = setup();
    s3.context.inspectAuthority = () => {
      const current = clone(s3.selectionValue);
      current.selection.existingCandidateCount = 2;
      return current;
    };
    await expect(
      run(prepareArgs(s3, path.join(s3.approvalOutputRoot, 'stale-authority.json')), s3.context),
    ).rejects.toThrow(/current strict canonical/i);
  });

  it('fails closed for any same-name process, unresolved process, or FileShare.None failure', async () => {
    const s = setup();
    s.context.listProcesses = () => ({
      passed: true,
      matching: [{ pid: 1, executablePath: 'C:\\installed\\AmazonAIOpsAgent.exe' }],
      unresolved: [],
    });
    await expect(
      run(prepareArgs(s, path.join(s.approvalOutputRoot, 'process.json')), s.context),
    ).rejects.toThrow(/existing or unresolved/i);

    const s2 = setup();
    s2.context.listProcesses = () => ({
      passed: true,
      matching: [],
      unresolved: ['path-unresolved'],
    });
    await expect(
      run(prepareArgs(s2, path.join(s2.approvalOutputRoot, 'unresolved.json')), s2.context),
    ).rejects.toThrow(/existing or unresolved/i);

    const s3 = setup();
    s3.context.exclusiveDbPreflight = () => ({
      method: 'windows-fileshare-none',
      passed: false,
    });
    await expect(
      run(prepareArgs(s3, path.join(s3.approvalOutputRoot, 'shared-db.json')), s3.context),
    ).rejects.toThrow(/FileShare.None/i);
  });

  it.runIf(process.platform === 'win32')(
    'obtains the real Windows FileShare.None proof against only a synthetic DB file',
    async () => {
      const s = setup();
      const {
        exclusiveDbPreflight: _syntheticExclusiveDbPreflight,
        ...contextWithRealExclusiveDbPreflight
      } = s.context;
      await expect(
        run(
          prepareArgs(s, path.join(s.approvalOutputRoot, 'real-fileshare-none.json')),
          contextWithRealExclusiveDbPreflight,
        ),
      ).resolves.toMatchObject({ exitCode: 0 });
    },
  );

  it('binds instructions into the confirmation token and rejects packet edits before spawn', async () => {
    const s = setup();
    const { packet, token } = await prepare(s);
    const originalPacket = clone(packet);
    packet.instructions.requiredNextStepAfterExit = 'claim READY';
    const edited = path.join(s.approvalOutputRoot, 'edited-approval.json');
    write(edited, packet);
    const result = await run(
      executeArgs(edited, token, path.join(s.launchOutputRoot, 'edited-hold.json')),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(s.getSpawns()).toBe(0);
    expect(result.receipt.reason).toMatch(/immutable approval|full approval payload/i);

    const wrongKind = clone(originalPacket);
    wrongKind.kind = 'lookalike-live-migration-packet';
    const wrongKindPath = path.join(s.approvalOutputRoot, 'wrong-kind-approval.json');
    write(wrongKindPath, wrongKind);
    const wrongKindResult = await run(
      executeArgs(wrongKindPath, token, path.join(s.launchOutputRoot, 'wrong-kind-hold.json')),
      s.context,
    );
    expect(wrongKindResult.exitCode).toBe(1);
    expect(s.getSpawns()).toBe(0);
    expect(wrongKindResult.receipt.reason).toMatch(/schema|immutable approval/i);
  });

  it('persists an untrusted READY-acquisition container even when no helper handle reaches the caller', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.acquireLaunchExclusiveWindow = async () => {
      const error = new Error('synthetic READY timeout');
      error.code = 'PROTOCOL_TIMEOUT';
      error.proof = {
        protocol: 's7-live-migration-exclusive-window/v1',
        status: 'ACQUISITION_UNTRUSTED',
        helperPid: 7331,
        phase: 'await-ready',
        scriptSha256: sha(EXCLUSIVE_WINDOW_HELPER_SCRIPT),
        lateProofBuffer: {
          queuedProofs: [],
          partialText: '',
          partialBytes: 0,
          terminalCode: 'PROTOCOL_TIMEOUT',
          closeOutcome: { outcome: 'close', code: 1, signal: null },
        },
        helperInputState: 'CLOSE_REQUESTED',
        helperInputCloseError: null,
        helperProcessUnrefRequested: true,
        helperStdinUnrefRequested: true,
        helperStdoutUnrefRequested: true,
      };
      throw error;
    };
    const result = await run(
      executeArgs(
        packetPath,
        token,
        path.join(s.launchOutputRoot, 'ready-acquisition-hold.json'),
      ),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(result.receipt.packageLaunched).toBe('NOT_LAUNCHED');
    expect(result.receipt.untrustedCandidate).toMatchObject({
      trust: 'UNTRUSTED_CANDIDATE_ONLY',
      source: 'HELPER_ERROR_PROOF',
      helperPid: 7331,
      phase: 'await-ready',
      scriptSha256: sha(EXCLUSIVE_WINDOW_HELPER_SCRIPT),
      helperInputState: 'CLOSE_REQUESTED',
      helperProcessUnrefRequested: true,
      lateProofBuffer: {
        queuedProofs: [],
        partialBytes: 0,
        terminalCode: 'PROTOCOL_TIMEOUT',
        closeOutcome: { outcome: 'close', code: 1, signal: null },
      },
    });
  });

  it('records CLOSE_FAILED instead of claiming helper input closed during pre-handoff abort', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.ensureIntentDirectory = () => {
      throw new Error('synthetic intent directory failure');
    };
    s.context.abortUnlaunchedExclusiveWindow = () => ({
      helperInputState: 'CLOSE_FAILED',
      helperInputCloseError: {
        name: 'SyntheticCloseError',
        message: 'stdin close failed',
      },
      helperProcessUnrefRequested: true,
      helperStdinUnrefRequested: true,
      helperStdoutUnrefRequested: true,
      processKillInvoked: false,
      packageProcessCreated: false,
    });
    const result = await run(
      executeArgs(
        packetPath,
        token,
        path.join(s.launchOutputRoot, 'abort-close-failed-hold.json'),
      ),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(result.receipt.packageLaunched).toBe('NOT_LAUNCHED');
    expect(result.receipt.launchExclusiveWindow.abort).toMatchObject({
      helperInputState: 'CLOSE_FAILED',
      helperInputCloseError: {
        name: 'SyntheticCloseError',
        message: 'stdin close failed',
      },
      processKillInvoked: false,
      packageProcessCreated: false,
    });
  });

  it('consumes the packet before spawn, blocks replay, and preserves a durable intent', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.createSuspendedPackage = () => {
      throw new Error('synthetic spawn failure');
    };
    const first = await run(
      executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'first-hold.json')),
      s.context,
    );
    expect(first.exitCode).toBe(1);
    expect(first.receipt.launchIntent).not.toBeNull();
    expect(first.receipt.packageLaunchAttempted).toBe(true);
    expect(first.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    const intentPath = first.receipt.launchIntent.realPath;
    expect(fs.existsSync(intentPath)).toBe(true);

    let replaySpawned = false;
    s.context.createSuspendedPackage = () => {
      replaySpawned = true;
      throw new Error('must not run');
    };
    const replay = await run(
      executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'replay-hold.json')),
      s.context,
    );
    expect(replay.exitCode).toBe(1);
    expect(replaySpawned).toBe(false);
    expect(replay.receipt.reason).toMatch(/already exists|overwritten/i);
  });

  it('keeps launch state UNKNOWN after a lost RESUMED proof and retains only bounded untrusted candidate facts', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const fixture = s.getProtocolFixture();
    s.context.releaseAndResumePackage = async () => {
      const error = new Error('synthetic helper release failure');
      error.code = 'PROTOCOL_SEQUENCE_MISMATCH';
      error.proof = {
        protocol: fixture.protocol,
        status: 'ERROR',
        helperPid: fixture.helperPid,
        pid: fixture.packagePid,
        phase: 'release-database-and-resume',
        processCreated: true,
        processResumed: false,
        databaseHandleExclusive: true,
        databaseHandleAcquired: true,
        databaseHandleReleased: false,
        releaseState: 'NOT_RELEASED',
        errorType: 'SyntheticFailure',
        observedAt: fixture.releasedAt,
        ignoredUnboundedField: 'must-not-be-copied',
      };
      throw error;
    };
    const result = await run(
      executeArgs(
        packetPath,
        token,
        path.join(s.launchOutputRoot, 'release-proof-hold.json'),
      ),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(result.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(result.receipt.launch.resumed).toBe(false);
    expect(result.receipt.untrustedCandidate).toMatchObject({
      trust: 'UNTRUSTED_CANDIDATE_ONLY',
      trustedForDecision: false,
      source: 'HELPER_ERROR_PROOF',
      protocol: fixture.protocol,
      status: 'ERROR',
      candidatePid: fixture.packagePid,
      helperPid: fixture.helperPid,
      phase: 'release-database-and-resume',
      processCreated: true,
      processResumed: false,
      databaseHandleExclusive: true,
      databaseHandleAcquired: true,
      databaseHandleReleased: false,
      releaseState: 'NOT_RELEASED',
      errorType: 'SyntheticFailure',
      observedAt: fixture.releasedAt,
      knownErrorProofFieldsPreserved: true,
    });
    expect(result.receipt.untrustedCandidate).not.toHaveProperty('ignoredUnboundedField');

    const timeoutCase = setup();
    const timeoutPacket = await prepare(timeoutCase);
    timeoutCase.context.releaseAndResumePackage = async () => {
      const error = new Error('synthetic RESUMED proof timeout');
      error.code = 'PROTOCOL_TIMEOUT';
      throw error;
    };
    const timedOut = await run(
      executeArgs(
        timeoutPacket.packetPath,
        timeoutPacket.token,
        path.join(timeoutCase.launchOutputRoot, 'resume-timeout-hold.json'),
      ),
      timeoutCase.context,
    );
    expect(timedOut.exitCode).toBe(1);
    expect(timedOut.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(timedOut.receipt.untrustedCandidate).toMatchObject({
      trust: 'UNTRUSTED_CANDIDATE_ONLY',
      trustedForDecision: false,
      source: 'LOCAL_HANDOFF_STATE',
      candidatePid: timeoutCase.getProtocolFixture().packagePid,
      processCreated: true,
      processResumed: null,
    });
  });

  it('requires ResumeThread == 1 and rejects out-of-order or future helper protocol timestamps', async () => {
    const resumeCountCase = setup();
    const resumeCountPacket = await prepare(resumeCountCase);
    const resumeFixture = resumeCountCase.getProtocolFixture();
    resumeCountCase.context.releaseAndResumePackage = async () => ({
      protocol: resumeFixture.protocol,
      status: 'RESUMED',
      helperPid: resumeFixture.helperPid,
      pid: resumeFixture.packagePid,
      finalSameNameInventoryPassed: true,
      finalSameNameProcessCount: 1,
      finalSameNameInventoryAt: resumeFixture.finalSameNameInventoryAt,
      finalQueriedExecutablePath: resumeCountCase.identity.exe.realPath,
      finalProcessImageQueryPassed: true,
      releasedAt: resumeFixture.releasedAt,
      resumedAt: resumeFixture.resumedAt,
      databaseHandleExclusive: false,
      resumeResult: 2,
    });
    const invalidCount = await run(
      executeArgs(
        resumeCountPacket.packetPath,
        resumeCountPacket.token,
        path.join(resumeCountCase.launchOutputRoot, 'resume-count-hold.json'),
      ),
      resumeCountCase.context,
    );
    expect(invalidCount.exitCode).toBe(1);
    expect(invalidCount.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(invalidCount.receipt.reason).toMatch(/resume-under-lock|process resume/i);

    const futureCase = setup();
    const futurePacket = await prepare(futureCase);
    const futureFixture = futureCase.getProtocolFixture();
    futureCase.context.releaseAndResumePackage = async () => ({
      protocol: futureFixture.protocol,
      status: 'RESUMED',
      helperPid: futureFixture.helperPid,
      pid: futureFixture.packagePid,
      finalSameNameInventoryPassed: true,
      finalSameNameProcessCount: 1,
      finalSameNameInventoryAt: futureFixture.finalSameNameInventoryAt,
      finalQueriedExecutablePath: futureCase.identity.exe.realPath,
      finalProcessImageQueryPassed: true,
      releasedAt: futureFixture.releasedAt,
      resumedAt: '2026-07-29T01:02:00.000Z',
      databaseHandleExclusive: false,
      resumeResult: 1,
    });
    const future = await run(
      executeArgs(
        futurePacket.packetPath,
        futurePacket.token,
        path.join(futureCase.launchOutputRoot, 'future-proof-hold.json'),
      ),
      futureCase.context,
    );
    expect(future.exitCode).toBe(1);
    expect(future.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(future.receipt.reason).toMatch(/future-dated/i);

    const orderCase = setup();
    const orderPacket = await prepare(orderCase);
    const orderFixture = orderCase.getProtocolFixture();
    orderCase.context.releaseAndResumePackage = async () => ({
      protocol: orderFixture.protocol,
      status: 'RESUMED',
      helperPid: orderFixture.helperPid,
      pid: orderFixture.packagePid,
      finalSameNameInventoryPassed: true,
      finalSameNameProcessCount: 1,
      finalSameNameInventoryAt: '2026-07-29T01:00:03.500Z',
      finalQueriedExecutablePath: orderCase.identity.exe.realPath,
      finalProcessImageQueryPassed: true,
      releasedAt: orderFixture.releasedAt,
      resumedAt: orderFixture.resumedAt,
      databaseHandleExclusive: false,
      resumeResult: 1,
    });
    const outOfOrder = await run(
      executeArgs(
        orderPacket.packetPath,
        orderPacket.token,
        path.join(orderCase.launchOutputRoot, 'out-of-order-proof-hold.json'),
      ),
      orderCase.context,
    );
    expect(outOfOrder.exitCode).toBe(1);
    expect(outOfOrder.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(outOfOrder.receipt.reason).toMatch(/out of order/i);
  });

  it('verifies actual PID/path, package triple, sanitizes env, and never claims Ads state', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const result = await run(
      executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'launch.json')),
      s.context,
    );
    expect(result.exitCode, result.receipt?.reason).toBe(0);
    expect(s.getSpawns()).toBe(1);
    expect(s.getExclusiveCalls()).toBeGreaterThanOrEqual(3);
    expect(result.receipt.status).toBe('LAUNCHED_AWAITING_READONLY_ACCEPTANCE');
    expect(result.receipt.formalAcceptance).toBe(false);
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
    expect(result.receipt.adsExecutionInvoked).toBeNull();
    expect(result.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(result.receipt.operatorDirectAdsExecutionInvoked).toBe(false);
    expect(result.receipt.launch.executablePath).toBe(s.identity.exe.realPath);
    expect(result.receipt.launch).toMatchObject({
      createdSuspended: true,
      resumed: true,
      state: 'CLOSED_EVIDENCE_COLLECTED',
    });
    expect(result.receipt.launchExclusiveWindow.sequence.map((item) => item.step)).toEqual([
      'READY',
      'INTENT_PERSISTED',
      'SPAWNED_SUSPENDED',
      'STARTUP_GATE_ACTIVE_AND_BOUND',
      'PID_IMAGE_VERIFIED',
      'SAME_NAME_PROCESS_SET_VERIFIED',
      'DB_RELEASED_AND_PROCESS_RESUMED',
      'CLOSE_OBSERVED',
      'POST_CLOSE_EVIDENCE_COLLECTED',
      'MAIN_ADMISSION_AND_HELPER_CLOSED_BOUND',
    ]);
    expect(result.receipt.launchExclusiveWindow.sameNameRaceBoundary).toEqual({
      operatorAdjacentInventory: true,
      helperAdjacentInventory: true,
      helperMatchingCount: 1,
      absoluteStartPrevention: true,
      packagedMainStartupGateRequiredForFormalAcceptance: false,
      packagedMainStartupGate: 'INTEGRATED_AND_PROVEN',
    });
    expect(result.receipt.remainingAcceptanceDependencies).toEqual({
      packagedMainStartupSameNameGate: 'INTEGRATED_AND_PROVEN',
      formalAcceptanceBlocked: true,
      separateReadonlyAcceptanceRequired: true,
    });
    expect(result.receipt.formalAcceptance).toBe(false);
    expect(result.receipt.startupGate).toMatchObject({
      gateId: expect.stringMatching(/^gate-/),
      invocationId: expect.stringMatching(/^invocation-/),
      admissionVerified: true,
      windowsSecurityPassed: true,
      active: { identity: { hardLinkCount: 1 } },
      bound: { identity: { hardLinkCount: 1 } },
      admission: { identity: { hardLinkCount: 1 } },
      closed: { identity: { hardLinkCount: 1 } },
    });
    expect(result.receipt.recoveryOutputSecurity).toMatchObject({
      passed: true,
      ownerSid: 'S-1-5-21-synthetic',
      inheritanceProtected: true,
      highRiskWritePrincipalCount: 0,
    });
    expect(result.receipt.launchIntent.windowsSecurity).toMatchObject({
      passed: true,
      ownerSid: 'S-1-5-21-synthetic',
      highRiskWritePrincipalCount: 0,
    });
    expect(result.receipt.launch.packageIdentities).toMatchObject({
      preSpawn: {
        exe: {
          sha256: s.identity.exe.sha256,
          sizeBytes: s.identity.exe.sizeBytes,
          identity: { synthetic: 'exe' },
        },
      },
      postSpawn: {
        main: {
          sha256: s.identity.main.sha256,
          sizeBytes: s.identity.main.sizeBytes,
          identity: { synthetic: 'main' },
        },
      },
      postExit: {
        appContent: {
          sha256: s.identity.appContent.sha256,
          fileCount: s.identity.appContent.fileCount,
          sizeBytes: s.identity.appContent.sizeBytes,
        },
      },
    });
    expect(result.receipt.postCloseEvidence.database).toMatchObject({
      passed: true,
      method: 'bracketed-stable-main-file-and-readonly-schema',
      schemaVersion: TARGET_VERSION,
      snapshot: {
        database: { sha256: sha('v0-db') },
        schemaVersion: TARGET_VERSION,
      },
    });
    const env = s.getTargetEnvironment();
    expect(env.APPDATA).toBe(fs.realpathSync.native(s.roaming));
    expect(env.USERPROFILE).toBe(fs.realpathSync.native(s.root));
    expect(env.SYSTEMROOT).toBe('C:\\Windows');
    expect(env.COMSPEC).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(env.PATH).toBe([
      'C:\\Windows\\System32',
      'C:\\Windows\\System32\\Wbem',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
    ].join(path.delimiter));
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env).not.toHaveProperty('SAFE_VALUE');
    expect(env).not.toHaveProperty('AMAZON_AI_OPS_EVIDENCE_MODE');
    expect(env).not.toHaveProperty('AMAZON_AI_OPS_USER_DATA_DIR');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(env).not.toHaveProperty('ELECTRON_ENABLE_LOGGING');
    expect(env).not.toHaveProperty('amazon_ai_ops_user_data');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('VITE_DEV_SERVER_URL');
    expect(env).not.toHaveProperty('FINAL_READINESS_PATH');
    expect(env).not.toHaveProperty('PORTABLE_EXECUTABLE_DIR');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('LINGXING_PASSWORD');
    expect(env).not.toHaveProperty('CUSTOM_TOKEN');
    expect(env).not.toHaveProperty('AWS_SESSION_TOKEN');
    expect(env).not.toHaveProperty('BROWSER_COOKIE');
    expect(env).not.toHaveProperty(s.environmentSentinelKey);
    expect(s.getLaunchObservationOrder()).toEqual([
      'ready',
      'intent-before-suspended-create',
      'pid-image-verified',
      'released-and-resumed',
      'close-monitor',
    ]);
  });

  it('publishes HOLD when the suspended PID path or post-resume package identity differs', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const originalCreateSuspendedPackage = s.context.createSuspendedPackage;
    s.context.createSuspendedPackage = async (...args) => ({
      ...(await originalCreateSuspendedPackage(...args)),
      queriedExecutablePath: path.join(s.root, 'other', 'AmazonAIOpsAgent.exe'),
    });
    const mismatch = await run(
      executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'pid-hold.json')),
      s.context,
    );
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(mismatch.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(mismatch.receipt.reason).toMatch(/approved package suspended/i);
    expect(mismatch.receipt.launch).toMatchObject({
      createdSuspended: false,
      resumed: false,
      detach: { processKillInvoked: false },
    });
    expect(s.getLaunchObservationOrder()).not.toContain('released-and-resumed');
    expect(mismatch.receipt.launchExclusiveWindow.manualRecovery).toMatchObject({
      required: true,
      reason: 'SUSPENDED_PROCESS_NOT_CONFIRMED_RESUMED',
      automaticResumeInvoked: false,
      processKillInvoked: false,
    });

    const s2 = setup();
    const prepared = await prepare(s2);
    const original = s2.context.packageIdentity;
    s2.context.packageIdentity = () => {
      const value = original();
      if (s2.getManagedState().resumed) value.main.sha256 = sha('drifted-main');
      return value;
    };
    const drift = await run(
      executeArgs(
        prepared.packetPath,
        prepared.token,
        path.join(s2.launchOutputRoot, 'package-hold.json'),
      ),
      s2.context,
    );
    expect(drift.exitCode).toBe(1);
    expect(drift.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(drift.receipt.postCloseEvidence.status).toBe('COLLECTED_AFTER_OBSERVED_CLOSE');
    expect(drift.receipt.reason).toMatch(/post-resume package identity/i);
  });

  it('keeps the DB lock and suspended process when a foreign same-name EXE appears before resume', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const normalList = s.context.listProcesses;
    s.context.listProcesses = () => {
      const state = normalList();
      if (s.getManagedState().suspendedCreated && !s.getManagedState().resumed) {
        state.matching.push({
          pid: 9911,
          parentPid: 4,
          executablePath: 'C:\\foreign\\AmazonAIOpsAgent.exe',
        });
      }
      return state;
    };
    const result = await run(
      executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'foreign-before-resume.json')),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(s.getManagedState()).toEqual({
      suspendedCreated: true,
      resumed: false,
      closed: false,
    });
    expect(result.receipt.launchExclusiveWindow.sequence.map((item) => item.step)).toEqual([
      'READY',
      'INTENT_PERSISTED',
      'SPAWNED_SUSPENDED',
      'STARTUP_GATE_ACTIVE_AND_BOUND',
      'PID_IMAGE_VERIFIED',
    ]);
    expect(result.receipt.launchExclusiveWindow.manualRecovery).toMatchObject({
      required: true,
      reason: 'SUSPENDED_PROCESS_NOT_CONFIRMED_RESUMED',
    });
    expect(result.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(result.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
  });

  it('keeps ACTIVE/HOLD and refuses CLOSED when the approved child exits abnormally', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.waitForManagedPackageClose = async () => {
      s.setManagedClosed(true);
      return {
        outcome: 'process-monitor-error',
        errorCode: 'PROTOCOL_SEQUENCE_MISMATCH',
        errorProof: {
          status: 'ERROR',
          phase: 'child-exit-failed-before-closed-receipt',
          processCreated: true,
          processResumed: true,
        },
      };
    };
    const result = await run(
      executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'abnormal-close.json')),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(result.receipt.reason).toMatch(/close could not be observed/i);
    expect(result.receipt.postCloseEvidence).toBeNull();
    expect(result.receipt.startupGate).toMatchObject({
      gateId: expect.stringMatching(/^gate-/),
      invocationId: expect.stringMatching(/^invocation-/),
    });
    expect(fs.existsSync(s.getStartupGatePlan().activePath)).toBe(true);
    expect(fs.existsSync(s.getStartupGatePlan().boundPath)).toBe(true);
    expect(fs.existsSync(s.getStartupGatePlan().closedPath)).toBe(false);
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
  });

  it('keeps ACTIVE/BOUND and enters HOLD when Main admission is missing', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.waitForManagedPackageClose = async () => {
      s.setManagedClosed(true);
      return {
        outcome: 'process-monitor-error',
        errorCode: 'PROTOCOL_SEQUENCE_MISMATCH',
        errorProof: {
          status: 'ERROR',
          phase: 'validate-main-admission-receipt',
          processCreated: true,
          processResumed: true,
        },
      };
    };
    const result = await run(
      executeArgs(
        packetPath,
        token,
        path.join(s.launchOutputRoot, 'missing-main-admission.json'),
      ),
      s.context,
    );
    const gate = s.getStartupGatePlan();
    expect(result.exitCode).toBe(1);
    expect(result.receipt.status).toBe('HOLD');
    expect(result.receipt.formalAcceptance).toBe(false);
    expect(result.receipt.reason).toMatch(/close could not be observed/i);
    expect(fs.existsSync(gate.activePath)).toBe(true);
    expect(fs.existsSync(gate.boundPath)).toBe(true);
    expect(fs.existsSync(gate.admissionPath)).toBe(false);
    expect(fs.existsSync(gate.closedPath)).toBe(false);
    expect(result.receipt.startupGate).toMatchObject({
      activePath: gate.activePath,
      boundPath: gate.boundPath,
      admissionPath: gate.admissionPath,
      closedPath: gate.closedPath,
    });
  });

  it('closes helper input and detaches after package CLOSED when helper-close proof times out', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const originalWaitForManagedPackageClose = s.context.waitForManagedPackageClose;
    s.context.waitForManagedPackageClose = async () => {
      const result = await originalWaitForManagedPackageClose();
      return {
        ...result,
        helperClose: { outcome: 'timeout' },
      };
    };
    const result = await run(
      executeArgs(
        packetPath,
        token,
        path.join(s.launchOutputRoot, 'helper-close-timeout.json'),
      ),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(s.getDetachCalls()).toBe(1);
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
    expect(result.receipt.launchExclusiveWindow.helperLifecycle).toMatchObject({
      packageCloseObserved: true,
      helperClose: { outcome: 'timeout' },
      helperConfirmedClosed: false,
      cleanup: {
        detachedFromOperator: true,
        helperInputState: 'CLOSE_REQUESTED',
        processKillInvoked: false,
      },
    });
    expect(result.receipt.launchExclusiveWindow.manualRecovery).toMatchObject({
      required: true,
      processKillInvoked: false,
      automaticResumeInvoked: false,
    });
    expect(result.receipt.reason).toMatch(/helper did not close normally/i);
  });

  it('detaches safely on timeout without kill, retry, rollback, or stdout persistence', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.waitForManagedPackageClose = async () => ({ outcome: 'timeout' });
    const result = await run(
      executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'timeout.json')),
      s.context,
    );
    expect(result.exitCode).toBe(1);
    expect(s.getDetachCalls()).toBe(1);
    expect(result.receipt.authorityDatabaseMutationState).toBe(
      'UNKNOWN_AFTER_CONSUMED_LAUNCH_ATTEMPT',
    );
    expect(result.receipt.launch).toMatchObject({
      processKillInvoked: false,
      automaticRetryInvoked: false,
      rollbackInvoked: false,
      stdout: { captured: false, persisted: false },
      stderr: { captured: false, persisted: false },
      detach: { detachedFromOperator: true, processKillInvoked: false },
      state: 'RUNNING_UNRESOLVED',
    });
    expect(result.receipt.postCloseEvidence).toBeNull();
    expect(result.receipt.packageAdsExecutionState).toBe('UNKNOWN');
    expect(result.receipt.packageLaunched).toBe('CONFIRMED_LAUNCHED');
  });

  it('requires a second explicit confirmation and atomically publishes FINALIZED exactly once', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'launch.json');
    const launched = await run(
      executeArgs(approved.packetPath, approved.token, launchReceipt),
      s.context,
    );
    expect(launched.exitCode).toBe(0);
    const currentDatabaseBinding = gateBinding(gateArtifact(s.db));
    const closedDocument = JSON.parse(
      fs.readFileSync(s.getStartupGatePlan().closedPath, 'utf8'),
    );
    expect(closedDocument.databaseAfterClose).toEqual(currentDatabaseBinding);
    expect(gateBinding(launched.receipt.startupGate.databaseAfterClose)).toEqual(
      currentDatabaseBinding,
    );
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet);
    const finalizationPacket = path.join(
      s.finalizationOutputRoot,
      'finalization.json',
    );
    const prepared = await run(
      prepareFinalizationArgs(
        s,
        approved.packetPath,
        launchReceipt,
        acceptanceReceipt,
        finalizationPacket,
      ),
      s.context,
    );
    expect(prepared.exitCode).toBe(0);
    expect(prepared.receipt).toMatchObject({
      kind: 's7-live-migration-finalization-packet',
      schemaVersion: 's7-live-migration-finalization-packet/v1',
      status: 'AWAITING_EXPLICIT_FINALIZATION_CONFIRMATION',
      safety: {
        authorityDatabaseMutated: false,
        packageLaunched: false,
        adsExecutionInvoked: false,
        formalAppReadiness: false,
        explicitConfirmationRequired: true,
        finalizedReceiptCreatesStartupEligibilityOnly: true,
      },
    });

    const gate = s.getStartupGatePlan();
    expect(fs.existsSync(gate.finalizedPath)).toBe(false);
    await expect(
      run(finalizeArgs(finalizationPacket, 'FINALIZE-S7-WRONG'), s.context),
    ).rejects.toThrow(/confirmation token/i);
    expect(fs.existsSync(gate.finalizedPath)).toBe(false);

    const finalized = await run(
      finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token),
      s.context,
    );
    expect(finalized.exitCode).toBe(0);
    expect(finalized.outputPath).toBe(fs.realpathSync.native(gate.finalizedPath));
    expect(finalized.receipt).toMatchObject({
      kind: 's7-main-startup-gate-finalized',
      schemaVersion: 's7-main-startup-gate-finalized/v1',
      status: 'FINALIZED_FOR_POST_MIGRATION_STARTUP',
      gateId: gate.gateId,
      invocationId: gate.invocationId,
      formalAppReadiness: false,
      adsExecutionAuthorized: false,
    });
    expect(finalized.receipt.finalizationPayloadSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(fs.existsSync(gate.finalizedPath)).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          path.dirname(gate.finalizedPath),
          'POST_MIGRATION_ADMITTED.json',
        ),
      ),
    ).toBe(false);

    await expect(
      run(finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token), s.context),
    ).rejects.toThrow(/FINALIZED|one-time|replay/i);
  });

  it('blocks finalization when the current authority no longer matches the exact v11 schema contract', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'launch.json');
    await run(
      executeArgs(approved.packetPath, approved.token, launchReceipt),
      s.context,
    );
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet);
    s.context.inspectPostMigrationAuthority = () => {
      const contract = clone(postMigrationAuthorityContract());
      contract.storeProviderIdentityV11.triggers.pop();
      return contract;
    };
    const finalizationPacket = path.join(
      s.finalizationOutputRoot,
      'invalid-v11-schema-finalization.json',
    );

    await expect(run(
      prepareFinalizationArgs(
        s,
        approved.packetPath,
        launchReceipt,
        acceptanceReceipt,
        finalizationPacket,
      ),
      s.context,
    )).rejects.toThrow(/exact production v11 contract/i);
    expect(fs.existsSync(finalizationPacket)).toBe(false);
    expect(fs.existsSync(s.getStartupGatePlan().finalizedPath)).toBe(false);
  });

  it('allows the explicit legacy v1 checksum through finalization while rejecting unknown v1', async () => {
    const s = setup();
    const legacyRows = clone(postMigrationAuthorityContract().migrationRows);
    legacyRows[0].checksum = legacyV1Checksum();
    const legacyAuthority = postMigrationAuthorityContract(legacyRows);
    s.context.inspectPostMigrationAuthority = () => clone(legacyAuthority);
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'legacy-v1-launch.json');
    await run(executeArgs(approved.packetPath, approved.token, launchReceipt), s.context);
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet, 'legacy-v1.json');
    const finalizationPacket = path.join(s.finalizationOutputRoot, 'legacy-v1.json');
    const prepared = await run(prepareFinalizationArgs(
      s,
      approved.packetPath,
      launchReceipt,
      acceptanceReceipt,
      finalizationPacket,
    ), s.context);
    const finalized = await run(
      finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token),
      s.context,
    );
    expect(finalized.exitCode).toBe(0);
    expect(finalized.receipt.authority.migrationRows[0].checksum).toBe(legacyV1Checksum());

    const unknownRows = clone(postMigrationAuthorityContract().migrationRows);
    unknownRows[0].checksum = 'unknown-v1-checksum';
    expect(() => postMigrationAuthorityContract(unknownRows))
      .toThrow(/exact allowed v1/i);
  });

  it('blocks finalization when the authority contract hash is not self-bound to its rows', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'hash-drift-launch.json');
    await run(executeArgs(approved.packetPath, approved.token, launchReceipt), s.context);
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet, 'hash-drift.json');
    s.context.inspectPostMigrationAuthority = () => ({
      ...clone(postMigrationAuthorityContract()),
      contractSha256: 'A'.repeat(64),
    });
    const finalizationPacket = path.join(s.finalizationOutputRoot, 'hash-drift.json');

    await expect(run(prepareFinalizationArgs(
      s,
      approved.packetPath,
      launchReceipt,
      acceptanceReceipt,
      finalizationPacket,
    ), s.context)).rejects.toThrow(/exact production v11 contract/i);
    expect(fs.existsSync(finalizationPacket)).toBe(false);
  });

  it('rejects incomplete or internally inconsistent acceptance receipts before finalization', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'launch.json');
    await run(
      executeArgs(approved.packetPath, approved.token, launchReceipt),
      s.context,
    );
    const cases = [
      ['missing', (receipt) => {
        receipt.checks.pop();
        receipt.summary.total -= 1;
        receipt.summary.passed -= 1;
      }, /exact complete.*check/i],
      ['duplicate', (receipt) => {
        receipt.checks[1] = structuredClone(receipt.checks[0]);
      }, /exact complete.*check/i],
      ['extra', (receipt) => {
        receipt.checks.push({
          code: 'UNRECOGNIZED_ACCEPTANCE_CHECK',
          passed: true,
          detail: 'must be rejected',
        });
        receipt.summary.total += 1;
        receipt.summary.passed += 1;
      }, /exact complete.*check/i],
      ['failed', (receipt) => {
        receipt.checks[0].passed = false;
        receipt.summary.passed -= 1;
        receipt.summary.failed = 1;
      }, /all-passed check/i],
      ['summary', (receipt) => {
        receipt.summary.total -= 1;
      }, /summary.*complete passed proof/i],
      ['safety', (receipt) => {
        receipt.safety.liveDatabaseQueryOnly = false;
      }, /safety proof/i],
      ['offline-proof', (receipt) => {
        receipt.summary.offlineArtifacts.restore.sourceBaselineRowsMatch = false;
      }, /restore artifact.*proof/i],
      ['recovery', (receipt) => {
        receipt.summary.recovery.canRestore = false;
      }, /recovery proof/i],
    ];

    for (const [label, mutate, message] of cases) {
      const acceptanceReceipt = writePassingAcceptance(
        s,
        approved.packet,
        `acceptance-${label}.json`,
      );
      const receipt = JSON.parse(fs.readFileSync(acceptanceReceipt, 'utf8'));
      mutate(receipt);
      write(acceptanceReceipt, receipt);
      await expect(
        run(
          prepareFinalizationArgs(
            s,
            approved.packetPath,
            launchReceipt,
            acceptanceReceipt,
            path.join(s.finalizationOutputRoot, `finalization-${label}.json`),
          ),
          s.context,
        ),
        label,
      ).rejects.toThrow(message);
    }
    expect(fs.existsSync(s.getStartupGatePlan().finalizedPath)).toBe(false);
  }, 30_000);

  it('blocks finalization when readonly acceptance or immutable packet bindings drift', async () => {
    const acceptanceDrift = setup();
    const approved = await prepare(acceptanceDrift);
    const launchReceipt = path.join(acceptanceDrift.launchOutputRoot, 'launch.json');
    await run(
      executeArgs(approved.packetPath, approved.token, launchReceipt),
      acceptanceDrift.context,
    );
    const acceptanceReceipt = writePassingAcceptance(acceptanceDrift, approved.packet);
    const acceptance = JSON.parse(fs.readFileSync(acceptanceReceipt, 'utf8'));
    acceptance.inputs.database.sha256 = sha('different-database');
    write(acceptanceReceipt, acceptance);
    await expect(
      run(
        prepareFinalizationArgs(
          acceptanceDrift,
          approved.packetPath,
          launchReceipt,
          acceptanceReceipt,
          path.join(acceptanceDrift.finalizationOutputRoot, 'acceptance-drift.json'),
        ),
        acceptanceDrift.context,
      ),
    ).rejects.toThrow(/acceptance.*database|bind.*database/i);
    expect(
      fs.existsSync(acceptanceDrift.getStartupGatePlan().finalizedPath),
    ).toBe(false);

    const packetDrift = setup();
    const secondApproval = await prepare(packetDrift);
    const secondLaunch = path.join(packetDrift.launchOutputRoot, 'launch.json');
    await run(
      executeArgs(secondApproval.packetPath, secondApproval.token, secondLaunch),
      packetDrift.context,
    );
    const secondAcceptance = writePassingAcceptance(packetDrift, secondApproval.packet);
    const finalizationPacket = path.join(
      packetDrift.finalizationOutputRoot,
      'packet-drift.json',
    );
    const prepared = await run(
      prepareFinalizationArgs(
        packetDrift,
        secondApproval.packetPath,
        secondLaunch,
        secondAcceptance,
        finalizationPacket,
      ),
      packetDrift.context,
    );
    const packet = JSON.parse(fs.readFileSync(finalizationPacket, 'utf8'));
    packet.bindings.machine.computerName = 'DIFFERENT-HOST';
    write(finalizationPacket, packet);
    await expect(
      run(
        finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token),
        packetDrift.context,
      ),
    ).rejects.toThrow(/confirmation token|full payload/i);
    expect(fs.existsSync(packetDrift.getStartupGatePlan().finalizedPath)).toBe(false);
  });
});
