import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const inspector = require('./inspect-package-ui-run-group.js');
const protectedSqliteTemp = require('./protected-sqlite-temp.js');
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
      path.resolve(canonicalDatabasePath).replace(/\\/g, '/').toLowerCase(),
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
  const runner = fs.readFileSync(path.resolve('scripts/package-ui-evidence.js'));
  const protectedTemp = fs.readFileSync(
    path.resolve('scripts/protected-sqlite-temp.js'),
  );
  const binding = {
    evidenceScript: { sha256: hash(runner), sizeBytes: runner.length },
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
    schemaVersion: 8,
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

describe('inspect-package-ui-run-group', () => {
  it('parses the documented CLI exactly once, forbids package overrides, and emits runner-parseable resume argv', () => {
    const parsed = inspector.parseArgs([
      '--output', 'output/codex-evidence/package-ui-evidence',
      '--resume-run-group', 'fixture-run-001',
      '--expected-exe-sha256', 'A'.repeat(64),
      '--expected-app-content-sha256', 'B'.repeat(64),
      '--user-data-dir', 'D:\\Temp\\amazon-ai-ops-fixture',
      '--protected-db', inspector.DEFAULT_PROTECTED_DB,
      '--authority-selection', 'D:\\Temp\\authority-selection.json',
    ]);
    expect(parsed.output).toBe(path.resolve('output/codex-evidence/package-ui-evidence'));
    expect(parsed.executable).toBe(inspector.DEFAULT_EXE);
    expect(parsed.appContent).toBe(inspector.DEFAULT_APP_CONTENT);
    expect(() => inspector.parseArgs(['--executable', 'x'])).toThrow(/unknown argument/i);

    const fixture = createFixture();
    const result = inspectFixture(fixture);
    expect(result.status).toBe('RESUME_SAFE');
    const runnableResumeArgs = result.resume.argv.slice(1).map((value) => (
      samePathForTest(value, fixture.profile)
        ? 'D:\\Temp\\amazon-ai-ops-fixture'
        : value
    ));
    const parsedResume = parseRunnerArgsWithoutPlaywright(runnableResumeArgs);
    expect(parsedResume).toEqual({
      allowInteractiveLogin: true,
      expectedExeSha256: fixture.expectedExe,
      resumeRunGroupId: fixture.runGroupId,
    });
    expect(result.resume.powershellDisplay).toContain("'--allow-interactive-login'");
    expect(result.resume.argv).toContain(path.resolve(fixture.profile));
    expect(result.resume.argv).toContain(path.resolve(fixture.protectedDb));
    expect(result.resume.argv).toContain(path.resolve(fixture.authoritySelection));
    expect(result.resume.pathInputsRequired).toEqual([]);
  });

  it('accepts a fully bound current v8 manifest without importing Playwright', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({ nextProfileId: '100-compact', status: 'RESUME_SAFE', violations: [] });
    expect(require.cache[require.resolve('./playwright-loader.js')]).toBeUndefined();
  });

  it('uses RECORD_ROOT_REQUIRED for a missing root and creates no evidence output', () => {
    const root = makeRoot();
    const result = inspector.inspect({
      appContent: inspector.DEFAULT_APP_CONTENT,
      executable: inspector.DEFAULT_EXE,
      output: path.join(root, 'missing'),
      'expected-app-content-sha256': 'B'.repeat(64),
      'expected-exe-sha256': 'A'.repeat(64),
      'authority-selection': path.join(root, 'authority.json'),
      'protected-db': path.join(root, 'missing.db'),
      'resume-run-group': 'fixture-run-001',
      'user-data-dir': path.join(root, 'profile'),
    }, { allowNonCanonicalAuthorityPath: true });
    expect(result).toMatchObject({
      status: 'RECORD_ROOT_REQUIRED',
      violations: [{ code: 'RECORD_ROOT_MISSING' }],
    });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each([
    ['protected DB', (fixture) => createDatabase(fixture.protectedDb, 'drift'), 'LINEAGE_CHANGED', 'PROTECTED_DB_DRIFT'],
    ['profile', (fixture) => fs.writeFileSync(path.join(fixture.profile, 'profile.txt'), 'changed'), 'FRESH_PROFILE_REQUIRED', 'PROFILE_CONTENT_DRIFT'],
    ['Chromium', (fixture) => fs.writeFileSync(fixture.chromium, 'drift'), 'LINEAGE_CHANGED', 'PACKAGE_APP_CONTENT_DRIFT'],
    ['package', (fixture) => fs.writeFileSync(fixture.exe, 'drift'), 'LINEAGE_CHANGED', 'PACKAGE_EXE_DRIFT'],
  ])('rejects %s lineage drift with a source-specific status', (_label, mutate, status, code) => {
    const fixture = createFixture();
    mutate(fixture);
    const result = inspectFixture(fixture);
    expect(result.status).toBe(status);
    expect(result.violations.map((item) => item.code)).toContain(code);
  });

  it('resumes from an uncheckpointed failed attempt only when its exact cleanup and invocation chain are proven', () => {
    const fixture = createFixture();
    writeRunManifest(fixture, {
      completedAt: '2026-07-29T00:10:00.000Z',
      generatedAt: '2026-07-29T00:00:00.000Z',
    });
    writeAttempt(fixture, { completedAt: '2026-07-29T00:05:00.000Z' });
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({
      nextProfileId: '100-compact',
      status: 'RESUME_SAFE',
      violations: [],
    });
  });

  it('rejects a run manifest detached from the exact userData/protected DB/package bindings', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const manifestPath = path.join(
      fixture.groupRoot,
      'manifests',
      '2026-07-29T00-00-00-000Z.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.requested.userDataDir = path.join(fixture.root, 'other-profile');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('RECORD_ROOT_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('MANIFEST_RECORD_INVALID');
  });

  it('rejects inconsistent or non-secret-blind attempt failure diagnostics', () => {
    const fixture = createFixture();
    const receipt = writeAttempt(fixture);
    const value = JSON.parse(fs.readFileSync(receipt.record.path, 'utf8'));
    value.payload.failure = {
      ...value.payload.failure,
      password: 'must-not-survive',
    };
    fs.writeFileSync(receipt.record.path, `${JSON.stringify(envelope(value.payload))}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('ATTEMPT_RECORD_INVALID');
  });

  it('rejects a forged semantic contract even when its outer hashes are self-consistent', () => {
    const fixture = createFixture();
    const file = path.join(fixture.groupRoot, 'run-group.json');
    const data = JSON.parse(fs.readFileSync(file));
    data.payload.runnerContract.semanticContractSha256 = 'C'.repeat(64);
    const binding = {
      evidenceScript: data.payload.runnerContract.evidenceScript,
      protectedSqliteTempScript:
        data.payload.runnerContract.protectedSqliteTempScript,
      semanticContractSha256: data.payload.runnerContract.semanticContractSha256,
    };
    data.payload.runnerContract.sha256 = hash(Buffer.from(inspector.canonicalJson(binding)));
    data.payload.runnerContractSha256 = data.payload.runnerContract.sha256;
    fs.writeFileSync(file, JSON.stringify(envelope(data.payload)));
    const result = inspectFixture(fixture);
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map((item) => item.code)).toContain('RUNNER_LINEAGE_DRIFT');
  });

  it('accepts a failed-then-successful retry chain bound to one exact immutable invocation', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const firstAfter = mutateProfileState(fixture, 'failed-attempt-session');
    const first = writeAttempt(fixture, { after: firstAfter });
    const secondAfter = mutateProfileState(fixture, 'successful-session');
    const second = writeAttempt(fixture, {
      after: secondAfter,
      before: firstAfter,
      completedAt: '2026-07-29T00:07:00.000Z',
      ordinal: 2,
      passed: true,
    });
    writeCheckpoint(fixture, { receipts: [first, second] });
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({
      nextProfileId: '125-compact',
      status: 'RESUME_SAFE',
      violations: [],
    });
  });

  it('accepts one fully bound successful checkpoint and advances to the next profile', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    writeCheckpoint(fixture, { receipts: [success] });
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({
      nextProfileId: '125-compact',
      status: 'RESUME_SAFE',
      violations: [],
    });
  });

  it('rejects a self-consistent checkpoint binding spliced from another invocation and run group', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    writeCheckpoint(fixture, { receipts: [success] });
    const checkpointPath = path.join(
      fixture.groupRoot,
      'checkpoints',
      '100-compact.json',
    );
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    const detachedInvocationId = 'detached-invocation-001';
    const detachedRunGroupId = 'detached-run-group-001';
    const detachedLock = profileLockIsolation(
      '100-compact',
      detachedInvocationId,
    );
    checkpoint.payload.runEvidence.evidenceBinding = {
      ...checkpoint.payload.runEvidence.evidenceBinding,
      invocationId: detachedInvocationId,
      profileLockBinding: detachedLock.before.binding,
      runGroupId: detachedRunGroupId,
    };
    checkpoint.payload.runEvidence.profileLockIsolation = detachedLock;
    checkpoint.payload.runEvidence.artifactReferences =
      checkpoint.payload.runEvidence.artifactReferences.map((reference) => {
        const binding = {
          ...reference.binding,
          invocationId: detachedInvocationId,
          runGroupId: detachedRunGroupId,
        };
        return {
          ...reference,
          binding,
          semanticKey: inspector.sha256Buffer(Buffer.from(
            inspector.canonicalJson({
              binding,
              role: reference.role,
              slot: reference.slot,
            }),
            'utf8',
          )),
        };
      });
    fs.writeFileSync(
      checkpointPath,
      `${JSON.stringify(envelope(checkpoint.payload))}\n`,
      'utf8',
    );

    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code))
      .toContain('CHECKPOINT_CURSOR_MISMATCH');
  });

  it('rejects duplicate semantic keys, reused paths, and lexical path aliases in immutable artifact references', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    const { attemptArtifacts, artifactReferences } = success.payload;
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      artifactReferences,
      artifactReferences[0].binding,
      true,
    )).toBe(true);
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      [...artifactReferences, structuredClone(artifactReferences[0])],
      artifactReferences[0].binding,
    )).toBe(false);
    const aliased = structuredClone(artifactReferences);
    aliased[0].path = `${path.dirname(aliased[0].path)}${path.sep}.${path.sep}${path.basename(aliased[0].path)}`;
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      aliased,
      artifactReferences[0].binding,
    )).toBe(false);
    const detachedBinding = structuredClone(artifactReferences[0].binding);
    detachedBinding.invocationId = 'detached-invocation-001';
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      artifactReferences,
      detachedBinding,
    )).toBe(false);
    const failedCaptureOnSuccess = structuredClone(artifactReferences);
    failedCaptureOnSuccess[0].role = 'failed-capture-artifact';
    failedCaptureOnSuccess[0].slot = {
      kind: 'failed-capture',
      overlayId: null,
      pathSha256: hash(Buffer.from(attemptArtifacts.files[0].path, 'utf8')),
      subview: null,
      workspace: null,
    };
    failedCaptureOnSuccess[0].semanticKey = inspector.sha256Buffer(Buffer.from(
      inspector.canonicalJson({
        binding: failedCaptureOnSuccess[0].binding,
        role: failedCaptureOnSuccess[0].role,
        slot: failedCaptureOnSuccess[0].slot,
      }),
      'utf8',
    ));
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      failedCaptureOnSuccess,
      artifactReferences[0].binding,
      true,
    )).toBe(false);

    const cleanup = {
      chromiumProcessLineage: null,
      packageProcessIsolation: isolation(),
      profileLockIsolation: profileLockIsolation(
        artifactReferences[0].binding.profileId,
        artifactReferences[0].binding.invocationId,
      ),
      profileProcessIsolation: isolation(),
    };
    expect(inspector.cleanupProven(cleanup)).toBe(true);
    cleanup.profileLockIsolation.before.tree.unexpected = true;
    expect(inspector.cleanupProven(cleanup)).toBe(false);
  });

  it('rejects a minimal passed checkpoint when the current profile-specific v8 validator fails', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    writeCheckpoint(fixture, { receipts: [success] });
    const result = inspectFixture(fixture, {
      validateProfileEvidence: () => ({
        cleanupPassed: true,
        diagnosticsPassed: true,
        passed: false,
        relevantViolations: [{ code: 'WORKSPACE_CHECK_MISSING_OR_FAILED' }],
        shapePassed: true,
      }),
    });
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('CHECKPOINT_EVIDENCE_INCOMPLETE');
  });

  it('loads the current runner in a pure child and rejects minimal runEvidence without importing Playwright', () => {
    const validation = inspector.validateProfileEvidenceFromPureChild({
      profileId: '100-compact',
      runEvidence: {
        diagnostics: validDiagnostics('100-compact'),
        packageProcessIsolation: isolation(),
        passed: true,
        profileId: '100-compact',
        profileProcessIsolation: isolation(),
        scalePercent: 100,
      },
      runnerPath: path.resolve('scripts/package-ui-evidence.js'),
    });
    expect(validation.passed).toBe(false);
    expect(validation.relevantViolations.length).toBeGreaterThan(0);
    expect(validation.relevantViolations.map((item) => item.code)).toContain(
      'V8_WORKSPACE_CHECKS_NOT_EXACT',
    );
    expect(require.cache[require.resolve('./playwright-loader.js')]).toBeUndefined();
  });

  it.each([
    ['non-resumable receipt', (fixture) => writeAttempt(fixture, { resumable: false }), 'CLEANUP_UNPROVEN'],
    ['detached artifact directory', (fixture) => {
      writeRunManifest(fixture);
      const receipt = writeAttempt(fixture);
      const file = receipt.record.path;
      const data = JSON.parse(fs.readFileSync(file));
      data.payload.attemptArtifacts.rootPath = path.join(fixture.groupRoot, 'profile-attempt-artifacts', '100-compact');
      fs.writeFileSync(file, JSON.stringify(envelope(data.payload)));
    }, 'ATTEMPT_RECORD_INVALID'],
  ])('requires a fresh profile for %s', (_label, arrange, code) => {
    const fixture = createFixture();
    arrange(fixture);
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain(code);
  });

  it('rejects a checkpoint bound to a failed terminal receipt and out-of-order future records', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const failed = writeAttempt(fixture);
    writeCheckpoint(fixture, { receipts: [failed] });
    let result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('CHECKPOINT_CURSOR_MISMATCH');

    const second = createFixture();
    fs.mkdirSync(path.join(second.groupRoot, 'attempts', '125-compact'), { recursive: true });
    result = inspectFixture(second);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('CHECKPOINT_CURSOR_MISMATCH');
  });

  it('rejects active package/profile processes before touching SQLite state', () => {
    const fixture = createFixture();
    const active = { ...zeroSnapshot(), matching: [{}], matchingCount: 1, observedCount: 1 };
    const capture = () => {
      throw new Error('SQLite capture must not run while a target process is active');
    };
    const result = inspectFixture(fixture, {
      captureSqliteLogicalArtifact: capture,
      getRunnerFacts: () => ({
        packageProcess: active,
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
    });
    expect(result.status).toBe('PROCESS_STOP_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('PROCESS_PACKAGE_ACTIVE');
  });

  it.each([
    ['canonical', {
      ...zeroSnapshot(),
      matching: [{ executablePath: 'canonical.exe', processId: 1 }],
      matchingCount: 1,
      observedCount: 1,
    }],
    ['installed-or-portable', {
      ...zeroSnapshot(),
      matching: [],
      matchingCount: 0,
      observedCount: 1,
    }],
    ['unresolvable', {
      ...zeroSnapshot(),
      observedCount: 1,
      passed: false,
      unresolved: [{ executablePath: null, processId: 1 }],
      unresolvedCount: 1,
    }],
  ])('requires observedCount=0 for every %s same-name AmazonAIOpsAgent.exe process', (_kind, packageProcess) => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      getRunnerFacts: () => ({
        packageProcess,
        profileProcess: zeroSnapshot(),
        runnerContract: fixture.contract,
        runnerLease: {
          activeRunnerCount: 0,
          passed: true,
          runGroupId: fixture.runGroupId,
          runnerContractSha256: fixture.contract.sha256,
          supported: true,
        },
      }),
    });
    expect(result.status).toBe('PROCESS_STOP_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('PROCESS_PACKAGE_ACTIVE');
  });

  it('recollects package/profile/runner state immediately before returning', () => {
    const fixture = createFixture();
    let calls = 0;
    const result = inspectFixture(fixture, {
      getRunnerFacts: () => {
        calls += 1;
        return {
          packageProcess: calls === 1
            ? zeroSnapshot()
            : { ...zeroSnapshot(), observedCount: 1 },
          profileProcess: zeroSnapshot(),
          runnerContract: fixture.contract,
          runnerLease: {
            activeRunnerCount: 0,
            passed: true,
            runGroupId: fixture.runGroupId,
            runnerContractSha256: fixture.contract.sha256,
            supported: true,
          },
        };
      },
    });
    expect(calls).toBe(2);
    expect(result.status).toBe('PROCESS_STOP_REQUIRED');
    expect(result.processAttestation.finalPackageObservedCount).toBe(1);
  });

  it('fails closed with a runner repair status when no contract-bound run-group lease exists', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      getRunnerFacts: () => ({
        packageProcess: zeroSnapshot(),
        profileProcess: zeroSnapshot(),
        runnerContract: fixture.contract,
        runnerLease: {
          activeRunnerCount: null,
          passed: false,
          reasonCode: 'RUNNER_LEASE_NOT_IMPLEMENTED',
          runGroupId: fixture.runGroupId,
          runnerContractSha256: fixture.contract.sha256,
          supported: false,
        },
      }),
    });
    expect(result.status).toBe('RUNNER_REPAIR_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('RUNNER_LEASE_UNSUPPORTED');
    expect(result.runnerLimitations).toEqual([]);
  });

  it('rejects the protected DB itself as the isolated profile DB', () => {
    const fixture = createFixture();
    fixture.options['protected-db'] = path.join(fixture.profile, 'amazon-ai-ops.db');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('PROFILE_DATABASE_NOT_ISOLATED');
  });

  it('requires genesis profile logical hash, size, and pages to equal protected logical authority', () => {
    const fixture = createFixture();
    const file = path.join(fixture.groupRoot, 'run-group.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.payload.genesisProfileState.logicalDatabase.totalPages += 1;
    fs.writeFileSync(file, `${JSON.stringify(envelope(value.payload))}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain(
      'PROFILE_GENESIS_PROVENANCE_INVALID',
    );
  });

  it('fails closed when runner-grade Windows file-ID/hardlink isolation is not proven', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      validateProfileProvenance: () => ({
        fileIsolation: {
          passed: false,
          sameFileIdentity: true,
          sharedHardLinkCount: 1,
        },
        provenance: { passed: true },
      }),
    });
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain(
      'PROFILE_DATABASE_FILE_ISOLATION_UNPROVEN',
    );
  });

  it('compares totalPages during current logical authority checks', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      captureSqliteLogicalArtifact: (filePath) => {
        const artifact = fastLogical(filePath);
        return samePathForTest(filePath, fixture.protectedDb)
          ? { ...artifact, totalPages: artifact.totalPages + 1 }
          : artifact;
      },
    });
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map((item) => item.code)).toContain('PROTECTED_DB_DRIFT');
  });

  it.each(['symlink', 'hardlink', 'path-escape', 'nested-extra-field', 'manifest-extra-entry'])('rejects immutable evidence %s', (mode) => {
    const fixture = createFixture();
    if (mode === 'symlink') {
      const link = `${fixture.profile}-junction`;
      fs.symlinkSync(fixture.profile, link, 'junction');
      fixture.options['user-data-dir'] = link;
    } else if (mode === 'hardlink') {
      fs.linkSync(path.join(fixture.groupRoot, 'run-group.json'), path.join(fixture.groupRoot, 'copy.json'));
    } else if (mode === 'path-escape') {
      fs.mkdirSync(path.join(fixture.groupRoot, 'attempts'), { recursive: true });
      fs.symlinkSync(path.dirname(fixture.protectedDb), path.join(fixture.groupRoot, 'attempts', '100-compact'), 'junction');
    } else if (mode === 'nested-extra-field') {
      const file = path.join(fixture.groupRoot, 'run-group.json');
      const data = JSON.parse(fs.readFileSync(file));
      data.payload.genesisProfileState.profileContent.unexpected = true;
      fs.writeFileSync(file, JSON.stringify(envelope(data.payload)));
    } else {
      fs.mkdirSync(path.join(fixture.groupRoot, 'manifests'), { recursive: true });
      fs.writeFileSync(path.join(fixture.groupRoot, 'manifests', 'unexpected.txt'), 'x');
    }
    expect(inspectFixture(fixture).status).not.toBe('RESUME_SAFE');
  });

  it('rejects parseable but non-canonical ISO timestamps in immutable records', () => {
    const fixture = createFixture();
    const file = path.join(fixture.groupRoot, 'run-group.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.payload.createdAt = '2026-07-29T00:00:00Z';
    fs.writeFileSync(file, `${JSON.stringify(envelope(value.payload))}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('RECORD_ROOT_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('RECORD_ROOT_INVALID');
  });

  it('uses the WAL-aware online-backup helper without changing a synthetic source DB or its sidecars', () => {
    const root = makeRoot();
    const dbPath = path.join(root, 'wal.db');
    const localRequire = createRequire(path.resolve('packages/local-db/package.json'));
    const Database = localRequire('better-sqlite3');
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE proof(value TEXT); INSERT INTO proof(value) VALUES (\'wal-row\');');
      const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((candidate) => fs.existsSync(candidate));
      const before = paths.map((candidate) => ({
        path: candidate,
        sha256: hash(fs.readFileSync(candidate)),
        size: fs.statSync(candidate).size,
      }));
      const proof = inspector.sqliteLogicalArtifact(dbPath);
      const after = paths.map((candidate) => ({
        path: candidate,
        sha256: hash(fs.readFileSync(candidate)),
        size: fs.statSync(candidate).size,
      }));
      expect(proof).toMatchObject({
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
      });
      expect(after).toEqual(before);
    } finally {
      db.close();
    }
  });

  it.runIf(process.platform === 'win32')('fails before any DB copy when the owned temp ACL cannot be restricted', () => {
    const root = makeRoot();
    const tempParent = path.join(root, 'bounded-temp');
    fs.mkdirSync(tempParent);
    const dbPath = path.join(root, 'source.db');
    createDatabase(dbPath);
    let backupCalls = 0;
    expect(() => inspector.sqliteLogicalArtifact(dbPath, 'acl-negative', {
      runReadonlySqliteOnlineBackupSync: () => {
        backupCalls += 1;
        throw new Error('backup must not run');
      },
      spawnSync: () => ({
        error: null,
        signal: null,
        status: 1,
        stderr: 'synthetic ACL denial',
      }),
      tempParent,
    })).toThrow(/ACL application\/readback failed before any DB copy/i);
    expect(backupCalls).toBe(0);
    expect(fs.readdirSync(tempParent)).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('rejects a real protected-root readback after an explicit Everyone ACE is added', () => {
    const root = makeRoot();
    const tempRoot = fs.mkdtempSync(path.join(
      root,
      'amazon-ai-ops-package-ui-inspector-acl-',
    ));
    protectedSqliteTemp.restrictWindowsTempAcl(tempRoot);
    const encodedRoot = Buffer.from(tempRoot, 'utf8').toString('base64');
    const mutation = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        "$ErrorActionPreference = 'Stop'",
        `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedRoot}'))`,
        '$directory=[IO.DirectoryInfo]::new($target)',
        '$acl=$directory.GetAccessControl()',
        '$everyone=[Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::WorldSid,$null)',
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new($everyone,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')",
        '$acl.AddAccessRule($rule) | Out-Null',
        '$directory.SetAccessControl($acl)',
      ].join('; '),
    ], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    expect(mutation.status).toBe(0);
    expect(() => protectedSqliteTemp.verifyWindowsTempAcl(tempRoot))
      .toThrow(/ACL application\/readback failed before any DB copy/i);
  });

  it('removes owned source/destination DB copies even when the backup helper leaves an unexpected entry and throws', () => {
    const root = makeRoot();
    const tempParent = path.join(root, 'bounded-temp');
    fs.mkdirSync(tempParent);
    const dbPath = path.join(root, 'source.db');
    createDatabase(dbPath);
    expect(() => inspector.sqliteLogicalArtifact(dbPath, 'cleanup-negative', {
      runReadonlySqliteOnlineBackupSync: ({
        destinationPath,
        ownedTempRoot,
        sourceDatabasePath,
      }) => {
        fs.copyFileSync(sourceDatabasePath, destinationPath);
        fs.copyFileSync(sourceDatabasePath, path.join(ownedTempRoot, 'unexpected-full-copy.db'));
        throw new Error('synthetic backup failure');
      },
      tempParent,
    })).toThrow(/synthetic backup failure/);
    expect(fs.readdirSync(tempParent)).toEqual([]);
  });

  it('rejects a stale or detached production authority-selection receipt', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      validateAuthoritySelection: () => ({
        logicalArtifact: fixture.metadata.protectedDatabaseLogical,
        passed: false,
        receiptSha256: hash(fs.readFileSync(fixture.authoritySelection)),
        status: 'SELECTED_RECOVERY_REQUIRED',
      }),
    });
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map((item) => item.code)).toContain('AUTHORITY_SELECTION_INVALID');
  });

  it('resolves the canonical authority through Windows Known Folder rather than a poisoned APPDATA variable', () => {
    const root = makeRoot();
    const child = spawnSync(process.execPath, [
      '-e',
      "const inspector=require('./scripts/inspect-package-ui-run-group.js');process.stdout.write(inspector.DEFAULT_PROTECTED_DB);",
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, APPDATA: path.join(root, 'poisoned-appdata') },
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    });
    expect(child.status).toBe(0);
    expect(samePathForTest(child.stdout, inspector.DEFAULT_PROTECTED_DB)).toBe(true);
    expect(samePathForTest(child.stdout, path.join(root, 'poisoned-appdata'))).toBe(false);
  });

  it('keeps --help pure and documents the no-browser boundary', () => {
    expect(inspector.main(['--help'])).toBe(0);
    expect(inspector.USAGE).toMatch(/never launches Electron, Playwright, Chromium/i);
  });
});
