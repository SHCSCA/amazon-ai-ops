import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import evidenceModule from './package-ui-evidence.js';
const { buildPackageUiAttemptArtifactManifest, buildPackageUiAttemptArtifactReferences, buildPackageUiRunnerContract, PACKAGE_UI_WIDE_PROFILE, PACKAGE_UI_PROFILE_SEQUENCE, writeImmutableEnvelope } = evidenceModule;
const HASH_A = 'A'.repeat(64), HASH_B = 'B'.repeat(64);

// Synthetic verifier inputs only; never use these as runtime acceptance evidence.
export function validPackageUiWorkspaceCheck(expected, viewport = evidenceModule.PACKAGE_UI_VIEWPORT) {
  const module = evidenceModule.EXPECTED_PACKAGE_UI_MODULES.find((item) => item.workspaces.includes(expected.workspace));
  const snapshot = (subview) => ({ activeSubview: subview, focusedSubview: subview,
    selectedCount: 1, selectedSubview: subview, tabCount: expected.tabs.length });
  return {
    metrics: {
      activeNavigation: {
        count: 1, label: expected.label, view: `${expected.workspace}/${expected.subview}`,
        moduleIds: evidenceModule.EXPECTED_PACKAGE_UI_MODULES.map((item) => item.id),
        activeModuleIds: [module.id],
        entryIds: module.workspaces.flatMap((workspace) => evidenceModule.EXPECTED_PACKAGE_UI_ENTRIES
          .filter((item) => item.workspace === workspace).map((item) => `${workspace}/${item.subview}`)),
      },
      aria: { brokenReferences: [], duplicateIds: [] },
      h1: { count: 1, labels: [expected.heading] },
      horizontalOverflow: { violations: [] },
      operatorCopy: { forbiddenMatches: [], textLength: 128, textSha256: HASH_A },
      primaryAction: { count: 1, labels: ['继续'] }, previewMarkers: [],
      rendererUrl: 'file:///D:/resources/app/dist/renderer/index.html',
      root: { count: 1, subview: expected.subview, workspace: expected.workspace },
      scrollOwnership: { defaultOwner: { declared: true, matchCount: 1, scrollTop: 0 }, unlabelledActiveOwners: [] },
      viewport,
    },
    keyboardEvidence: {
      initial: snapshot(expected.subview), end: snapshot(expected.tabs.at(-1)), restored: snapshot(expected.subview), passed: true,
    },
  };
}

export function validPackageUiMinimumWindow(root) {
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, 'minimum-window-fixture-'));
  const viewport = { width: 1184, height: 661, deviceScaleFactor: 1 };
  const screenshots = evidenceModule.EXPECTED_PACKAGE_UI_ENTRIES.map((entry) => {
    const file = path.join(directory, `${entry.workspace}-${entry.subview}.png`);
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    writeFileSync(file, bytes);
    return { path: file, sha256: evidenceModule.sha256File(file), sizeBytes: bytes.length,
      profileId: '100-compact', scalePercent: 100, workspace: entry.workspace, subview: entry.subview };
  });
  return {
    nativeWindow: { minimum: { width: 1200, height: 700 }, attempted: { width: 1199, height: 699 },
      bounds: { width: 1200, height: 700 }, content: { width: 1184, height: 661 }, maximized: false, fullScreen: false },
    viewport, passed: true, screenshots,
    workspaceChecks: evidenceModule.EXPECTED_PACKAGE_UI_ENTRIES.map((entry, index) => ({
      ...entry, ...validPackageUiWorkspaceCheck(entry, viewport),
      passed: true, settleEvidence: { passed: true }, compositeEvidence: { passed: true }, screenshot: screenshots[index],
    })),
  };
}

// Synthetic verifier inputs only. These fixtures are never runtime acceptance evidence.
export function packageUiBindingFixture(CURRENT_ARTIFACT_ROOT, USER_DATA_DIR = 'D:\\Temp\\amazon-ai-ops-package-ui\\profile-copy') {
function validProfileLockIsolation(
  profileId = 'fixture-profile',
  invocationId = 'fixture-invocation',
) {
  const binding = {
    invocationIdSha256: evidenceModule.sha256Buffer(
      Buffer.from(invocationId, 'utf8'),
    ),
    profileId,
    rootPathSha256: evidenceModule.sha256Buffer(Buffer.from(
      path.resolve(USER_DATA_DIR).replace(/\\/g, '/').toLowerCase(),
      'utf8',
    )),
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
    observedAt: '2026-07-17T06:00:00.000Z',
    passed: true,
    rootIdentityStable: true,
    schemaVersion: 'package-ui-profile-lock-snapshot/v2',
    tree: {
      criticalEntries: [],
      criticalEntryCount: 0,
      identitySetSha256: HASH_B,
      limits: {
        maxCriticalEntries: 1_024,
        maxEntries: 20_000,
        maxPathCharacters: 2_000_000,
      },
      pathSetSha256: HASH_A,
      secondSnapshotEntryCount: 2,
      totalPathCharacters: 42,
      treeStable: true,
    },
    unresolved: [],
    unresolvedCount: 0,
  };
  snapshot.tree.attestationSha256 = evidenceModule.sha256Buffer(Buffer.from(
    canonicalJsonForTest({
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

function validRunEvidenceBinding(
  profileId,
  {
    attemptId = `test-attempt-${profileId}`,
    invocationId = `test-invocation-${profileId}`,
    runGroupId = 'package-ui-test-run-group',
    runnerContractSha256 = buildPackageUiRunnerContract().sha256,
  } = {},
) {
  return {
    attemptId,
    invocationId,
    profileId,
    profileLockBinding:
      validProfileLockIsolation(profileId, invocationId).before.binding,
    runGroupId,
    runnerContractSha256,
    scalePercent: profileId === PACKAGE_UI_WIDE_PROFILE.id
      ? PACKAGE_UI_WIDE_PROFILE.scalePercent
      : Number.parseInt(profileId.split('-')[0], 10),
  };
}

function validAuthorityBinding() {
  return {
    authoritySelectionReceiptSha256: HASH_A,
    canonicalDatabasePathSha256: HASH_B,
    databaseFileIdentity: {
      deviceId: '1',
      fileId: '2',
      hardLinkCount: 1,
      stabilityTokenSha256: HASH_A,
    },
  };
}

function bindRunAttemptArtifacts(run, label, preserveBytes = false) {
  const binding = run.evidenceBinding;
  const profileRoot = mkdtempSync(path.join(
    CURRENT_ARTIFACT_ROOT,
    'profile-attempt-artifacts-',
  ));
  const root = path.join(
    profileRoot,
    binding.profileId,
    `0001-${binding.attemptId}`,
  );
  mkdirSync(root, { recursive: true });
  const records = [];
  const seenRecords = new Set();
  const add = (record, role) => {
    if (!record || seenRecords.has(record)) return;
    seenRecords.add(record);
    records.push({ record, role });
  };
  for (const screenshot of run.screenshots || []) add(screenshot, 'workspace');
  for (const screenshot of run.minimumWindow?.screenshots || []) add(screenshot, 'minimum-window');
  for (const check of run.workspaceChecks || []) {
    add(check.screenshot, 'workspace-check');
    add(check.inspectorEvidence?.screenshot, 'inspector');
  }
  for (const check of run.subviewChecks || []) {
    add(check.screenshot, 'subview');
    add(check.inspectorEvidence?.screenshot, 'subview-inspector');
  }
  for (const check of run.overlayChecks || []) add(check.screenshot, 'overlay');
  add(run.schedulerReadOnlyRuntime?.artifact, 'main-runtime');
  records.forEach(({ record, role }, index) => {
    const filePath = path.join(
      root,
      `${String(index + 1).padStart(3, '0')}-${preserveBytes ? path.basename(record.path) : role + '-' + label + '.bin'}`,
    );
    const bytes = preserveBytes && record.path && existsSync(record.path)
      ? readFileSync(record.path)
      : role === 'main-runtime'
      ? Buffer.from(JSON.stringify(run.schedulerReadOnlyRuntime.marker), 'utf8')
      : Buffer.from(`${role}-${label}-${index + 1}`);
    writeFileSync(filePath, bytes);
    record.path = filePath;
    record.sha256 = evidenceModule.sha256File(filePath);
    record.sizeBytes = readFileSync(filePath).byteLength;
  });
  run.attemptArtifacts = buildPackageUiAttemptArtifactManifest(root);
  run.artifactReferences = buildPackageUiAttemptArtifactReferences(
    run.attemptArtifacts,
    run,
  );
  return run;
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
    capturedAt: '2026-07-17T06:00:01.100Z',
    logicalDatabase: validLogicalArtifact(),
    profileContent: {
      fileCount: 10,
      sha256: HASH_B,
      sizeBytes: 8192,
    },
  };
}

function canonicalJsonForTest(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJsonForTest(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validCheckpointComposition(
  runGroupId,
  runnerContractSha256,
  profileRuns,
  existing = {},
) {
  const root = mkdtempSync(path.join(CURRENT_ARTIFACT_ROOT, 'checkpoints-'));
  const checkpointRecords = PACKAGE_UI_PROFILE_SEQUENCE.map((profileId, index) => {
    const runEvidence = profileRuns.find(
      (candidate) => candidate.profileId === profileId,
    );
    const profileState = existing.finalProfileState ?? validProfileLineageState();
    const attemptPayload = {
      attemptArtifacts: runEvidence.attemptArtifacts,
      artifactReferences: runEvidence.artifactReferences,
      attemptId: runEvidence.evidenceBinding.attemptId,
      cleanupEvidence: {
        chromiumProcessLineage: runEvidence.chromiumProcessLineage ?? null,
        packageProcessIsolation: runEvidence.packageProcessIsolation,
        profileLockIsolation: runEvidence.profileLockIsolation,
        profileProcessIsolation: runEvidence.profileProcessIsolation,
      },
      diagnostics: runEvidence.diagnostics,
      failure: runEvidence.failure,
      invocationId: runEvidence.evidenceBinding.invocationId,
      kind: 'package-ui-profile-attempt',
      passed: true,
      profileId,
      profileState,
      resumable: true,
      runGroupId,
      runnerContractSha256,
      schemaVersion: 'package-ui-profile-attempt/v3',
    };
    const attemptReceipt = writeImmutableEnvelope(
      path.join(root, 'attempts', profileId, '0001-attempt.json'),
      attemptPayload,
    );
    const payload = {
      attemptReceipt,
      kind: 'package-ui-profile-checkpoint',
      profileId,
      profileState,
      runEvidence,
      runGroupId,
      runnerContractSha256,
      schemaVersion: 'package-ui-profile-checkpoint/v2',
      sequence: index + 1,
    };
    const file = writeImmutableEnvelope(
      path.join(root, 'checkpoints', `${profileId}.json`),
      payload,
    );
    const envelope = JSON.parse(readFileSync(file.path, 'utf8'));
    return {
      file,
      payloadSha256: envelope.payloadSha256,
      profileId,
    };
  });
  return {
    checkpointRecords,
    finalProfileState: existing.finalProfileState ?? validProfileLineageState(),
    packageLineage: existing.packageLineage ?? { chromium: { sha256: HASH_A } },
    passed: true,
    runGroupId,
    runnerContractSha256,
  };
}
return { validProfileLockIsolation, validRunEvidenceBinding, validAuthorityBinding, bindRunAttemptArtifacts, validLogicalArtifact, validProfileLineageState, canonicalJsonForTest, validCheckpointComposition };
}

export function bindPackageUiTestManifest(manifest, root) {
  mkdirSync(root, { recursive: true });
  const userDataDir = manifest.requested.userDataDir ?? path.join(root, 'profile-copy');
  manifest.requested.userDataDir = userDataDir;
  const fixture = packageUiBindingFixture(root, userDataDir);
  const runGroupId = manifest.runGroup.runGroupId;
  const runnerContractSha256 = manifest.runGroup.runnerContractSha256;
  const invocationId = 'test-invocation-' + runGroupId;
  manifest.failure = null;
  manifest.authority = { binding: fixture.validAuthorityBinding() };
  manifest.invocation = { attemptReceipts: [], invocationId, lease: { generation: 'test-generation', payloadSha256: HASH_A } };
  Object.assign(manifest.runGroup, { authorityBinding: manifest.authority.binding, invocationId });
  manifest.profileLockIsolation = fixture.validProfileLockIsolation('run-group', invocationId);
  const runs = [...manifest.runs, manifest.wideProfile];
  for (const run of runs) {
    const profileId = run.profileId ?? run.scalePercent + '-compact';
    run.profileId = profileId;
    run.failure = null;
    run.evidenceBinding = fixture.validRunEvidenceBinding(profileId, { invocationId, runGroupId, runnerContractSha256 });
    run.profileLockIsolation = fixture.validProfileLockIsolation(profileId, invocationId);
    for (const screenshot of run.screenshots) Object.assign(screenshot, { profileId, scalePercent: run.scalePercent ?? 100 });
    for (const check of run.workspaceChecks) check.screenshot = run.screenshots.find(s => s.workspace === check.workspace && s.subview === check.subview);
    for (const check of run.minimumWindow?.workspaceChecks || []) check.screenshot = run.minimumWindow.screenshots.find(s => s.workspace === check.workspace && s.subview === check.subview);
    for (const check of run.subviewChecks ?? []) Object.assign(check.screenshot, { scalePercent: run.scalePercent, profileId });
    for (const check of run.overlayChecks ?? []) Object.assign(check.screenshot, { overlayId: check.id, scalePercent: run.scalePercent, profileId });
    fixture.bindRunAttemptArtifacts(run, profileId, true);
  }
  manifest.checkpointComposition = fixture.validCheckpointComposition(runGroupId, runnerContractSha256, runs, manifest.checkpointComposition);
  return manifest;
}
