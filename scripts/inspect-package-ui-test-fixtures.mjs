import crypto from 'node:crypto';

import fs from 'node:fs';

import os from 'node:os';

import path from 'node:path';

import { spawnSync } from 'node:child_process';

import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const inspector = require('./inspect-package-ui-run-group.js');
const sourceIdentity = require('./package-ui-source-identity.js');

const protectedSqliteTemp = require('./protected-sqlite-temp.js');

const authoritySelectionVerifier = require('./verify-production-authority-selection.js');

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-ui-resume-inspector-'));
  temporaryRoots.push(root);
  return root;
}

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function samePathForTest(left, right) {
  return path.resolve(left).replace(/\\/g, '/').toLowerCase()
    === path.resolve(right).replace(/\\/g, '/').toLowerCase();
}

function envelope(payload) {
  return {
    payload,
    payloadSha256: inspector.sha256Buffer(Buffer.from(inspector.canonicalJson(payload), 'utf8')),
  };
}

function writeEnvelope(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(envelope(payload))}\n`, 'utf8');
  return fileRecord(filePath);
}

function fileRecord(filePath) {
  const stat = fs.lstatSync(filePath);
  const bytes = fs.readFileSync(filePath);
  return {
    mtime: stat.mtime.toISOString(),
    mtimeMs: stat.mtimeMs,
    path: fs.realpathSync.native(filePath),
    sha256: hash(bytes),
    sizeBytes: bytes.length,
  };
}

function createDatabase(filePath, value = 'fixture') {
  const localRequire = createRequire(path.resolve('packages/local-db/package.json'));
  const Database = localRequire('better-sqlite3');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS fixture (value TEXT NOT NULL);');
    db.prepare('INSERT INTO fixture(value) VALUES (?)').run(value);
  } finally {
    db.close();
  }
}

function createWalAuthoritySelectionFixture() {
  const root = makeRoot();
  const roamingAppData = path.join(root, 'AppData', 'Roaming');
  const userDataDir = path.join(roamingAppData, '@amazon-ai-ops', 'desktop');
  const protectedDatabasePath = path.join(userDataDir, 'amazon-ai-ops.db');
  const tempRoot = path.join(root, 'authority-temp');
  const receiptPath = path.join(root, 'authority-selection.json');
  const localRequire = createRequire(path.resolve('packages/local-db/package.json'));
  const Database = localRequire('better-sqlite3');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  const database = new Database(protectedDatabasePath);
  try {
    database.pragma('journal_mode = WAL');
    database.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('current');");
    const expectedMainSha256 = hash(fs.readFileSync(protectedDatabasePath));
    const userProfile = path.join(root, 'Users', 'operator');
    const verifierOptions = {
      dbPath: protectedDatabasePath,
      expectedMainSha256,
      expectedUserDataDir: userDataDir,
    };
    const verifierContext = {
      env: { APPDATA: roamingAppData, USERPROFILE: userProfile },
      now: () => new Date('2026-08-14T00:00:00.000Z'),
      tempRoot,
      writeStdout() {},
    };
    authoritySelectionVerifier.inspectProductionAuthoritySelection(
      verifierOptions,
      verifierContext,
    );
    const receipt = authoritySelectionVerifier.inspectProductionAuthoritySelection(
      verifierOptions,
      verifierContext,
    );
    return {
      canonicalPaths: {
        databasePath: protectedDatabasePath,
        roamingAppData,
        userDataDir,
        userProfile,
      },
      database,
      protectedDatabasePath,
      receipt,
      receiptPath,
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

function validateWalAuthoritySelectionFixture(fixture) {
  fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(fixture.receipt)}\n`, 'utf8');
  return inspector.validateAuthoritySelectionFromPureChild({
    canonicalPaths: fixture.canonicalPaths,
    protectedDatabasePath: fixture.protectedDatabasePath,
    receiptPath: fixture.receiptPath,
  });
}

function fastLogical(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    method: 'readonly-sqlite-online-backup',
    remainingPages: 0,
    schemaVersion: 'sqlite-authority-currentness-proof/v1',
    sha256: hash(bytes),
    sizeBytes: bytes.length,
    totalPages: 1,
  };
}

function profileState(profile, capturedAt = '2026-07-29T00:00:00.000Z') {
  return {
    capturedAt,
    logicalDatabase: fastLogical(path.join(profile, 'amazon-ai-ops.db')),
    profileContent: inspector.profileManifest(profile),
  };
}

function zeroSnapshot() {
  return {
    error: null,
    matching: [],
    matchingCount: 0,
    observedCount: 0,
    passed: true,
    unresolved: [],
    unresolvedCount: 0,
  };
}

function isolation() {
  return { after: zeroSnapshot(), before: zeroSnapshot(), passed: true };
}

function profileLockIsolation(
  profileId = 'fixture-profile',
  invocationId = 'fixture-invocation',
) {
  const binding = {
    invocationIdSha256: hash(Buffer.from(invocationId, 'utf8')),
    profileId,
    rootPathSha256: 'A'.repeat(64),
  };
  const snapshot = {
    binding,
    claim: 'bounded-quiescent-exclusive-open-attestation',
    exclusiveOpen: {
      allEntriesHeld: true,
      closeFailureCount: 0,
      closeFailures: [],
      directoryCount: 1,
      entryCount: 2,
      fileCount: 1,
      heldHandleCount: 2,
      method: 'win32-createfile-share-none-stable-tree/v1',
    },
    exclusiveProbe: { created: true, removed: true },
    kind: 'package-ui-profile-lock-snapshot',
    observedAt: '2026-07-29T00:00:00.000Z',
    passed: true,
    rootIdentityStable: true,
    schemaVersion: 'package-ui-profile-lock-snapshot/v2',
    tree: {
      criticalEntries: [],
      criticalEntryCount: 0,
      identitySetSha256: 'B'.repeat(64),
      limits: {
        maxCriticalEntries: 1_024,
        maxEntries: 20_000,
        maxPathCharacters: 2_000_000,
      },
      pathSetSha256: 'A'.repeat(64),
      secondSnapshotEntryCount: 2,
      totalPathCharacters: 42,
      treeStable: true,
    },
    unresolved: [],
    unresolvedCount: 0,
  };
  snapshot.tree.attestationSha256 = inspector.sha256Buffer(Buffer.from(
    inspector.canonicalJson({
      binding: snapshot.binding,
      criticalEntries: snapshot.tree.criticalEntries,
      criticalEntryCount: snapshot.tree.criticalEntryCount,
      directoryCount: snapshot.exclusiveOpen.directoryCount,
      entryCount: snapshot.exclusiveOpen.entryCount,
      fileCount: snapshot.exclusiveOpen.fileCount,
      identitySetSha256: snapshot.tree.identitySetSha256,
      pathSetSha256: snapshot.tree.pathSetSha256,
      secondSnapshotEntryCount: snapshot.tree.secondSnapshotEntryCount,
      totalPathCharacters: snapshot.tree.totalPathCharacters,
    }),
    'utf8',
  ));
  return {
    after: structuredClone(snapshot),
    before: structuredClone(snapshot),
    passed: true,
  };
}

function authorityBinding(databasePath, receiptPath, canonicalDatabasePath = databasePath) {
  const stat = fs.statSync(databasePath, { bigint: true });
  const stabilityToken = [
    stat.dev,
    stat.ino,
    stat.nlink,
    stat.size,
    stat.ctimeNs,
    stat.mtimeNs,
  ].join(':');
  return {
    authoritySelectionReceiptSha256: hash(fs.readFileSync(receiptPath)),
    canonicalDatabasePathSha256: hash(Buffer.from(
      path.win32.normalize(String(canonicalDatabasePath || ''))
        .replace(/[\\/]+$/, '')
        .toLowerCase(),
      'utf8',
    )),
    databaseFileIdentity: {
      deviceId: stat.dev.toString(),
      fileId: stat.ino.toString(),
      hardLinkCount: Number(stat.nlink),
      stabilityTokenSha256: hash(Buffer.from(stabilityToken, 'utf8')),
    },
  };
}

function structuredFailure(message = 'synthetic failure') {
  return {
    at: '2026-07-29T00:00:30.000Z',
    message,
    name: 'Error',
    phase: 'workspace-capture',
    stack: `Error: ${message}`,
  };
}

function validDiagnostics(profileId, { failure = null, passed = true } = {}) {
  return {
    cleanupErrors: [],
    completedAt: '2026-07-29T00:01:00.000Z',
    failure,
    lifecycle: {
      droppedCount: 0,
      events: [],
      limit: 100,
      processExit: null,
      runnerCloseRequestedAt: null,
      unexpectedCloseObserved: false,
    },
    login: {
      operatorHandoff: {
        automationReadSecrets: false,
        automationTypedSecrets: false,
      },
    },
    phase: passed ? 'completed' : 'failed',
    profileId,
    renderer: {},
    schemaVersion: 'package-ui-run-diagnostics/v2',
    startedAt: '2026-07-29T00:00:00.000Z',
    storeGate: null,
    timeline: [],
  };
}

function runnerContract() {
  const protectedTemp = fs.readFileSync(
    path.resolve('scripts/protected-sqlite-temp.js'),
  );
  const binding = {
    evidenceScript: sourceIdentity.collectPackageUiRunnerSourceBinding(fileRecord),
    protectedSqliteTempScript: {
      sha256: hash(protectedTemp),
      sizeBytes: protectedTemp.length,
    },
    semanticContractSha256: hash('fixture-semantic-contract'),
  };
  return {
    ...binding,
    sha256: inspector.sha256Buffer(Buffer.from(inspector.canonicalJson(binding), 'utf8')),
  };
}

function createFixture() {
  const root = makeRoot();
  const output = path.join(root, 'evidence');
  const runGroupId = 'fixture-run-001';
  const app = path.join(root, 'app');
  const exe = path.join(root, 'AmazonAIOpsAgent.exe');
  const chromium = path.join(app, ...inspector.BUNDLED_CHROMIUM_RELATIVE_PATH.split('/'));
  fs.mkdirSync(path.dirname(chromium), { recursive: true });
  fs.writeFileSync(exe, 'exe-fixture');
  fs.writeFileSync(chromium, 'chromium-fixture');
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"fixture"}');
  fs.mkdirSync(path.join(app, 'dist', 'main'), { recursive: true });
  fs.writeFileSync(path.join(app, 'dist', 'main', 'index.js'), 'main');
  const profile = path.join(root, 'profile');
  createDatabase(path.join(profile, 'amazon-ai-ops.db'));
  fs.mkdirSync(path.join(profile, 'stores'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'profile.txt'), 'profile-fixture');
  const protectedDb = path.join(root, 'protected.db');
  fs.copyFileSync(path.join(profile, 'amazon-ai-ops.db'), protectedDb);
  const authoritySelection = path.join(root, 'authority-selection.json');
  fs.writeFileSync(authoritySelection, '{"fixture":true}\n', 'utf8');
  const appManifest = inspector.appContentManifest(app);
  const contract = runnerContract();
  const packageLineage = {
    appContentSha256: appManifest.sha256,
    chromium: {
      relativePath: inspector.BUNDLED_CHROMIUM_RELATIVE_PATH,
      sha256: hash(fs.readFileSync(chromium)),
      sizeBytes: fs.statSync(chromium).size,
    },
    executableSha256: hash(fs.readFileSync(exe)),
    profileBindingSha256: hash(Buffer.from(path.resolve(profile).replace(/\\/g, '/').toLowerCase(), 'utf8')),
    profileBrowserBindingSha256: hash(Buffer.from(path.resolve(profile, 'stores').replace(/\\/g, '/').toLowerCase(), 'utf8')),
  };
  const groupRoot = path.join(output, 'run-groups', runGroupId);
  const genesis = profileState(profile);
  const metadata = {
    authorityBinding: authorityBinding(protectedDb, authoritySelection),
    createdAt: '2026-07-29T00:00:00.000Z',
    genesisProfileState: genesis,
    kind: 'package-ui-run-group',
    packageLineage,
    profileSequence: inspector.PROFILE_SEQUENCE,
    protectedDatabaseLogical: fastLogical(protectedDb),
    runGroupId,
    runnerContract: contract,
    runnerContractSha256: contract.sha256,
    schemaVersion: inspector.RUN_GROUP_SCHEMA,
  };
  const metadataRecord = writeEnvelope(path.join(groupRoot, 'run-group.json'), metadata);
  const fixture = {
    app,
    authoritySelection,
    chromium,
    contract,
    exe,
    expectedApp: appManifest.sha256,
    expectedExe: packageLineage.executableSha256,
    genesis,
    groupRoot,
    metadata,
    metadataRecord,
    output,
    packageLineage,
    profile,
    protectedDb,
    root,
    runGroupId,
  };
  fixture.attempts = [];
  fixture.invocationId = 'fixture-invocation-001';
  fixture.lease = {
    generation: 'fixture-generation-001',
    payloadSha256: 'D'.repeat(64),
    processStartIdentitySha256: 'E'.repeat(64),
  };
  fixture.options = {
    appContent: app,
    'authority-selection': authoritySelection,
    executable: exe,
    output,
    'expected-app-content-sha256': fixture.expectedApp,
    'expected-exe-sha256': fixture.expectedExe,
    'protected-db': protectedDb,
    'resume-run-group': runGroupId,
    'user-data-dir': profile,
  };
  return fixture;
}

function dependencies(fixture, overrides = {}) {
  return {
    allowNonCanonicalAuthorityPath: true,
    allowNonCanonicalPackagePaths: true,
    canonicalAuthorityPaths: {
      databasePath: fixture.protectedDb,
      roamingAppData: fixture.root,
      userDataDir: path.dirname(fixture.protectedDb),
      userProfile: fixture.root,
    },
    captureSqliteLogicalArtifact: fastLogical,
    getRunnerFacts: () => ({
      packageProcess: zeroSnapshot(),
      profileProcess: zeroSnapshot(),
      runnerLease: {
        activeRunnerCount: 0,
        passed: true,
        runGroupId: fixture.runGroupId,
        runnerContractSha256: fixture.contract.sha256,
        supported: true,
      },
      runnerContract: fixture.contract,
    }),
    validateAuthoritySelection: () => ({
      logicalArtifact: fixture.metadata.protectedDatabaseLogical,
      passed: true,
      receiptSha256: hash(fs.readFileSync(fixture.authoritySelection)),
      status: 'SELECTED_SCHEMA_READY',
    }),
    validateProfileEvidence: () => ({
      cleanupPassed: true,
      diagnosticsPassed: true,
      passed: true,
      relevantViolations: [],
      shapePassed: true,
    }),
    validateProfileProvenance: () => ({
      fileIsolation: {
        passed: true,
        sameFileIdentity: false,
        sharedHardLinkCount: 0,
      },
      provenance: { passed: true },
    }),
    ...overrides,
  };
}

function inspectFixture(fixture, overrides = {}) {
  const manifestsDir = path.join(fixture.groupRoot, 'manifests');
  if (
    !fs.existsSync(manifestsDir)
    || !fs.readdirSync(manifestsDir).some((name) => name.endsWith('.json'))
  ) {
    writeRunManifest(fixture);
  }
  return inspector.inspect(fixture.options, dependencies(fixture, overrides));
}

function writeRunManifest(fixture, {
  completedAt = '2026-07-29T00:10:00.000Z',
  generatedAt = '2026-07-29T00:00:00.000Z',
  id = '2026-07-29T00-00-00-000Z',
} = {}) {
  const attemptReceipts = fixture.attempts
    .map(({ payload, record }) => ({
      attemptId: payload.attemptId,
      file: record,
      invocationId: fixture.invocationId,
      invocationManifest: payload.attemptInvocationManifest,
      ordinal: payload.ordinal,
      payloadSha256: envelope(payload).payloadSha256,
      profileId: payload.profileId,
    }))
    .sort((left, right) => (
      inspector.PROFILE_SEQUENCE.indexOf(left.profileId)
        - inspector.PROFILE_SEQUENCE.indexOf(right.profileId)
      || left.ordinal - right.ordinal
    ));
  const invocationReceiptPath = path.join(
    fixture.groupRoot,
    'invocation-receipts',
    `${fixture.invocationId}.json`,
  );
  const manifest = {
    completedAt,
    failure: structuredFailure('synthetic manifest failure'),
    generatedAt,
    kind: 'package-ui-evidence',
    packageProcessIsolation: isolation(),
    passed: false,
    profileProcessIsolation: isolation(),
    requested: {
      allowInteractiveLogin: true,
      allowSavedLogin: false,
      appContentPath: fixture.app,
      expectedAppContentSha256: fixture.expectedApp,
      expectedExeSha256: fixture.expectedExe,
      executablePath: fixture.exe,
      loginMode: 'interactive-operator-each-run',
      profileBrowserUserDataDir: path.join(fixture.profile, 'stores'),
      protectedDatabasePath: fixture.protectedDb,
      authoritySelectionPath: fixture.authoritySelection,
      resumeRunGroupId: null,
      runGroupId: fixture.runGroupId,
      userDataDir: fixture.profile,
    },
    invocation: {
      attemptReceipts,
      collection: {
        attemptCount: attemptReceipts.length,
        attemptInvocationManifestCount: attemptReceipts.length,
        passed: true,
      },
      invocationId: fixture.invocationId,
      lease: fixture.lease,
      leaseHeldThroughPersistence: true,
      receiptPath: invocationReceiptPath,
      resumeInspectionReceipt: null,
    },
    runGroup: {
      attemptId: id,
      authorityBinding: fixture.metadata.authorityBinding,
      invocationId: fixture.invocationId,
      metadata: fixture.metadataRecord,
      profileSequence: inspector.PROFILE_SEQUENCE,
      runGroupId: fixture.runGroupId,
      runnerContractSha256: fixture.contract.sha256,
    },
    schemaVersion: 9,
  };
  const manifestPath = path.join(fixture.groupRoot, 'manifests', `${id}.json`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  const manifestRecord = fileRecord(manifestPath);
  const summaryPath = path.join(
    fixture.output,
    'invocation-summaries',
    `${fixture.invocationId}.json`,
  );
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  const summaryRecord = fileRecord(summaryPath);
  writeEnvelope(invocationReceiptPath, {
    attemptReceipts,
    authorityBinding: fixture.metadata.authorityBinding,
    completedAt,
    failure: manifest.failure,
    invocationId: fixture.invocationId,
    kind: 'package-ui-invocation-receipt',
    lease: fixture.lease,
    manifest: manifestRecord,
    passed: false,
    resumeInspectionReceipt: null,
    runGroupId: fixture.runGroupId,
    runnerContractSha256: fixture.contract.sha256,
    schemaVersion: 'package-ui-invocation-receipt/v1',
    summary: summaryRecord,
  });
  fixture.manifest = manifest;
  return manifest;
}

function writeAttempt(fixture, {
  after = null,
  before = fixture.genesis,
  completedAt = '2026-07-29T00:05:00.000Z',
  failure = structuredFailure(),
  ordinal = 1,
  passed = false,
  profileId = '100-compact',
  resumable = true,
} = {}) {
  if (!fixture.manifest) writeRunManifest(fixture);
  const attemptId = `2026-07-29T00-0${ordinal}-00-000Z-${String(ordinal).padStart(6, '0')}`;
  const artifactRoot = path.join(
    fixture.groupRoot,
    'profile-attempt-artifacts',
    profileId,
    `${String(ordinal).padStart(4, '0')}-${attemptId}`,
  );
  fs.mkdirSync(artifactRoot, { recursive: true });
  const artifactPath = path.join(artifactRoot, 'screen.txt');
  fs.writeFileSync(artifactPath, `attempt-${ordinal}`);
  const attemptArtifacts = inspector.attemptArtifactManifest(artifactRoot);
  const artifactFile = attemptArtifacts.files[0];
  const scalePercent = profileId === 'wide-1400x900-100'
    ? 100
    : Number.parseInt(profileId.split('-')[0], 10);
  const binding = {
    attemptId,
    invocationId: fixture.invocationId,
    profileId,
    runGroupId: fixture.runGroupId,
    runnerContractSha256: fixture.contract.sha256,
    scalePercent,
  };
  const slot = passed
    ? {
        kind: 'workspace',
        overlayId: null,
        pathSha256: null,
        subview: 'overview',
        workspace: 'today',
      }
    : {
        kind: 'failed-capture',
        overlayId: null,
        pathSha256: hash(Buffer.from(artifactFile.path, 'utf8')),
        subview: null,
        workspace: null,
      };
  const role = passed ? 'workspace-screenshot' : 'failed-capture-artifact';
  const artifactReferences = [{
    binding,
    path: artifactPath,
    role,
    semanticKey: inspector.sha256Buffer(Buffer.from(inspector.canonicalJson({
      binding,
      role,
      slot,
    }), 'utf8')),
    sha256: artifactFile.sha256,
    sizeBytes: artifactFile.sizeBytes,
    slot,
  }];
  const diagnostics = validDiagnostics(profileId, {
    failure: passed ? null : failure,
    passed,
  });
  const profileAfter = resumable ? (after || before) : null;
  const cleanupEvidence = {
    chromiumProcessLineage: null,
    packageProcessIsolation: isolation(),
    profileLockIsolation: profileLockIsolation(
      profileId,
      fixture.invocationId,
    ),
    profileProcessIsolation: isolation(),
  };
  const lease = {
    generation: fixture.lease.generation,
    payloadSha256: fixture.lease.payloadSha256,
  };
  const invocationPayload = {
    attemptArtifacts,
    artifactReferences,
    attemptId,
    authorityBinding: fixture.metadata.authorityBinding,
    cleanupEvidence,
    completedAt,
    diagnostics,
    failure: passed ? null : failure,
    invocationId: fixture.invocationId,
    kind: 'package-ui-attempt-invocation',
    lease,
    ordinal,
    passed,
    profileId,
    profileState: { after: profileAfter, before },
    resumable,
    runGroupId: fixture.runGroupId,
    runnerContractSha256: fixture.contract.sha256,
    schemaVersion: 'package-ui-attempt-invocation/v1',
  };
  const invocationPath = path.join(
    fixture.groupRoot,
    'invocations',
    fixture.invocationId,
    `${profileId}-${String(ordinal).padStart(4, '0')}-${attemptId}.json`,
  );
  const invocationRecord = writeEnvelope(invocationPath, invocationPayload);
  const payload = {
    attemptArtifacts,
    attemptInvocationManifest: invocationRecord,
    attemptId,
    artifactReferences,
    authorityBinding: fixture.metadata.authorityBinding,
    cleanupEvidence,
    completedAt,
    diagnostics,
    failure: passed ? null : failure,
    invocationId: fixture.invocationId,
    kind: 'package-ui-profile-attempt',
    lease,
    manifestSha256: invocationRecord.sha256,
    packageLineage: fixture.packageLineage,
    ordinal,
    passed,
    profileId,
    profileState: { after: profileAfter, before },
    resumable,
    runGroupId: fixture.runGroupId,
    runnerContractSha256: fixture.contract.sha256,
    schemaVersion: inspector.ATTEMPT_SCHEMA,
  };
  const receiptPath = path.join(
    fixture.groupRoot,
    'attempts',
    profileId,
    `${String(ordinal).padStart(4, '0')}-${attemptId}.json`,
  );
  const record = writeEnvelope(receiptPath, payload);
  const attempt = { payload, record };
  fixture.attempts = fixture.attempts.filter(
    (candidate) => !(
      candidate.payload.profileId === profileId
      && candidate.payload.ordinal === ordinal
    ),
  );
  fixture.attempts.push(attempt);
  writeRunManifest(fixture);
  return attempt;
}

function writeCheckpoint(fixture, {
  lineageStart = fixture.genesis,
  profileId = '100-compact',
  receipts,
  sequence = 1,
} = {}) {
  const terminal = receipts[receipts.length - 1];
  const runEvidence = {
    attemptArtifacts: terminal.payload.attemptArtifacts,
    artifactReferences: terminal.payload.artifactReferences,
    chromiumProcessLineage: null,
    diagnostics: terminal.payload.diagnostics,
    evidenceBinding: {
      ...terminal.payload.artifactReferences[0].binding,
      profileLockBinding:
        terminal.payload.cleanupEvidence.profileLockIsolation.before.binding,
    },
    failure: null,
    packageProcessIsolation: isolation(),
    passed: true,
    profileId,
    profileLockIsolation: profileLockIsolation(
      profileId,
      terminal.payload.invocationId,
    ),
    profileProcessIsolation: isolation(),
  };
  writeEnvelope(path.join(fixture.groupRoot, 'checkpoints', `${profileId}.json`), {
    attemptReceipt: terminal.record,
    attemptReceipts: receipts.map(({ payload, record }) => ({
      attemptId: payload.attemptId,
      file: record,
      invocationId: payload.invocationId,
      ordinal: payload.ordinal,
      payloadSha256: envelope(payload).payloadSha256,
    })),
    completedAt: '2026-07-29T00:09:00.000Z',
    kind: 'package-ui-profile-checkpoint',
    lineageStart,
    packageLineage: fixture.packageLineage,
    profileId,
    profileState: terminal.payload.profileState,
    runEvidence,
    runGroupId: fixture.runGroupId,
    runnerContractSha256: fixture.contract.sha256,
    schemaVersion: inspector.CHECKPOINT_SCHEMA,
    sequence,
  });
}

function mutateProfileState(fixture, text) {
  fs.writeFileSync(path.join(fixture.profile, 'profile.txt'), text);
  return profileState(fixture.profile, '2026-07-29T00:06:00.000Z');
}

function parseRunnerArgsWithoutPlaywright(args) {
  const source = [
    "const Module=require('node:module');",
    'const original=Module._load;',
    "Module._load=function(request,parent,isMain){if(request==='./playwright-loader'&&/package-ui-evidence\\.js$/i.test(String(parent?.filename||'')))return {_electron:null};return original.apply(this,arguments);};",
    "const runner=require('./scripts/package-ui-evidence.js');",
    "const args=JSON.parse(process.env.INSPECTOR_TEST_ARGS||'[]');",
    'const parsed=runner.parsePackageUiEvidenceArgs(args);',
    'process.stdout.write(JSON.stringify({allowInteractiveLogin:parsed.allowInteractiveLogin,resumeRunGroupId:parsed.resumeRunGroupId,expectedExeSha256:parsed.expectedExeSha256}));',
  ].join('');
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: { ...process.env, INSPECTOR_TEST_ARGS: JSON.stringify(args) },
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || 'runner parse failed');
  return JSON.parse(result.stdout);
}

export {
  crypto,
  fs,
  os,
  path,
  spawnSync,
  createRequire,
  afterEach,
  describe,
  expect,
  it,
  require,
  inspector,
  protectedSqliteTemp,
  authoritySelectionVerifier,
  temporaryRoots,
  makeRoot,
  hash,
  samePathForTest,
  envelope,
  writeEnvelope,
  fileRecord,
  createDatabase,
  createWalAuthoritySelectionFixture,
  validateWalAuthoritySelectionFixture,
  fastLogical,
  profileState,
  zeroSnapshot,
  isolation,
  profileLockIsolation,
  authorityBinding,
  structuredFailure,
  validDiagnostics,
  runnerContract,
  createFixture,
  dependencies,
  inspectFixture,
  writeRunManifest,
  writeAttempt,
  writeCheckpoint,
  mutateProfileState,
  parseRunnerArgsWithoutPlaywright,
};
