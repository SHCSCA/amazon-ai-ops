// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
    PACKAGE_UI_WIDE_PROFILE,
    path,
  } = dependencies;
  const buildPackageUiAttemptArtifactReferences = (...args) => dependencies.buildPackageUiAttemptArtifactReferences(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const canonicalPackageUiArtifactBinding = (...args) => dependencies.canonicalPackageUiArtifactBinding(...args);
  const cloneSecretBlindDiagnosticRecord = (...args) => dependencies.cloneSecretBlindDiagnosticRecord(...args);
  const fail = (...args) => dependencies.fail(...args);
  const loadPackageUiAttemptRecords = (...args) => dependencies.loadPackageUiAttemptRecords(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const packageUiAttemptArtifactManifestMatches = (...args) => dependencies.packageUiAttemptArtifactManifestMatches(...args);
  const packageUiAttemptDiagnosticsSnapshotMatches = (...args) => dependencies.packageUiAttemptDiagnosticsSnapshotMatches(...args);
  const packageUiAttemptOutcomeMatches = (...args) => dependencies.packageUiAttemptOutcomeMatches(...args);
  const packageUiProfileLockIsolationPassed = (...args) => dependencies.packageUiProfileLockIsolationPassed(...args);
  const profileLineageStateMatches = (...args) => dependencies.profileLineageStateMatches(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const validatePackageUiAttemptArtifactMembership = (...args) => dependencies.validatePackageUiAttemptArtifactMembership(...args);
  const writeImmutableEnvelope = (...args) => dependencies.writeImmutableEnvelope(...args);

function recordPackageUiProfileAttempt({
  attemptArtifacts,
  attemptContext,
  manager,
  profileId,
  profileState,
  resumable,
  runEvidence,
}) {
  const directory = path.join(manager.paths.attemptsDir, safeSegment(profileId));
  const expectedOrdinal = loadPackageUiAttemptRecords(manager, profileId).length + 1;
  if (
    attemptContext?.ordinal !== expectedOrdinal
    || typeof attemptContext?.attemptId !== 'string'
    || !attemptContext.attemptId
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(
      String(attemptContext?.invocationId || ''),
    )
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(
      String(attemptContext?.leaseGeneration || ''),
    )
    || !/^[A-F0-9]{64}$/.test(String(attemptContext?.leasePayloadSha256 || ''))
  ) {
    fail('Package UI attempt context is missing or out of order', profileId);
  }
  const expectedArtifactDir = path.join(
    manager.paths.root,
    'profile-attempt-artifacts',
    safeSegment(profileId),
    `${String(attemptContext.ordinal).padStart(4, '0')}-${attemptContext.attemptId}`,
  );
  if (
    !packageUiAttemptArtifactManifestMatches(attemptArtifacts)
    || normalizedWindowsPath(attemptArtifacts.rootPath)
      !== normalizedWindowsPath(attemptContext.artifactDir)
    || normalizedWindowsPath(attemptContext.artifactDir)
      !== normalizedWindowsPath(expectedArtifactDir)
  ) {
    fail('Package UI attempt artifact manifest is missing, stale, or detached', profileId);
  }
  if (
    !profileLineageStateMatches(profileState?.before, profileState?.before)
    || (
      resumable === true
        ? !profileLineageStateMatches(profileState?.after, profileState?.after)
        : profileState?.after !== null
    )
  ) {
    fail(
      resumable === true
        ? 'A resumable package UI attempt must bind a valid after profile state'
        : 'A non-resumable cleanup failure must not advance the profile cursor',
      profileId,
    );
  }
  const { attemptId, ordinal } = attemptContext;
  const runBinding = canonicalPackageUiArtifactBinding(runEvidence);
  const expectedRunBinding = {
    attemptId,
    invocationId: attemptContext.invocationId,
    profileId,
    runGroupId: manager.runGroupId,
    runnerContractSha256: manager.metadata.runnerContractSha256,
    scalePercent: profileId === PACKAGE_UI_WIDE_PROFILE.id
      ? PACKAGE_UI_WIDE_PROFILE.scalePercent
      : Number.parseInt(profileId.split('-')[0], 10),
  };
  if (
    canonicalJson(runBinding) !== canonicalJson(expectedRunBinding)
    || runEvidence?.profileId !== profileId
    || runEvidence?.evidenceBinding?.profileLockBinding?.profileId !== profileId
    || runEvidence.evidenceBinding.profileLockBinding.invocationIdSha256
      !== sha256Buffer(Buffer.from(attemptContext.invocationId, 'utf8'))
    || !packageUiProfileLockIsolationPassed(
      runEvidence?.profileLockIsolation,
      runEvidence.evidenceBinding.profileLockBinding,
    )
  ) {
    fail(
      'Package UI run evidence escaped its exact attempt/invocation/profile/scale/lock binding',
      profileId,
    );
  }
  const attemptDiagnostics = cloneSecretBlindDiagnosticRecord(runEvidence?.diagnostics ?? null);
  if (!packageUiAttemptDiagnosticsSnapshotMatches(attemptDiagnostics, profileId)) {
    fail('Package UI attempt diagnostics are missing, unsafe, or malformed', profileId);
  }
  const attemptFailure = cloneSecretBlindDiagnosticRecord(
    runEvidence?.failure || null,
  );
  const cleanupEvidence = {
    chromiumProcessLineage: cloneSecretBlindDiagnosticRecord(
      runEvidence?.chromiumProcessLineage ?? null,
    ),
    packageProcessIsolation: cloneSecretBlindDiagnosticRecord(
      runEvidence?.packageProcessIsolation ?? null,
    ),
    profileLockIsolation: cloneSecretBlindDiagnosticRecord(
      runEvidence?.profileLockIsolation ?? null,
    ),
    profileProcessIsolation: cloneSecretBlindDiagnosticRecord(
      runEvidence?.profileProcessIsolation ?? null,
    ),
  };
  const artifactReferences = buildPackageUiAttemptArtifactReferences(
    attemptArtifacts,
    runEvidence,
  );
  const artifactMembership = validatePackageUiAttemptArtifactMembership(
    attemptArtifacts,
    {
      ...runEvidence,
      artifactReferences,
    },
  );
  if (!artifactMembership.passed) {
    fail(
      'Package UI attempt artifact membership is incomplete or detached',
      JSON.stringify(artifactMembership.violations),
    );
  }
  const attemptOutcome = {
    cleanupEvidence,
    diagnostics: attemptDiagnostics,
    failure: attemptFailure,
    passed: runEvidence?.passed === true,
    resumable: resumable === true,
  };
  if (!packageUiAttemptOutcomeMatches(attemptOutcome)) {
    fail(
      'Package UI attempt outcome, failure, diagnostics, and cleanup evidence disagree',
      profileId,
    );
  }
  const invocationManifestPayload = {
    attemptArtifacts,
    artifactReferences,
    attemptId,
    authorityBinding: manager.metadata.authorityBinding,
    cleanupEvidence,
    completedAt: new Date().toISOString(),
    diagnostics: attemptDiagnostics,
    failure: attemptFailure,
    invocationId: attemptContext.invocationId,
    kind: 'package-ui-attempt-invocation',
    lease: {
      generation: attemptContext.leaseGeneration,
      payloadSha256: attemptContext.leasePayloadSha256,
    },
    ordinal,
    passed: attemptOutcome.passed,
    profileId,
    profileState,
    resumable: attemptOutcome.resumable,
    runGroupId: manager.runGroupId,
    runnerContractSha256: manager.metadata.runnerContractSha256,
    schemaVersion: PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION,
  };
  const invocationManifest = writeImmutableEnvelope(
    path.join(
      manager.paths.invocationsDir,
      safeSegment(attemptContext.invocationId),
      `${safeSegment(profileId)}-${String(ordinal).padStart(4, '0')}-${attemptId}.json`,
    ),
    invocationManifestPayload,
  );
  const payload = {
    attemptArtifacts,
    attemptInvocationManifest: invocationManifest,
    attemptId,
    artifactReferences,
    authorityBinding: manager.metadata.authorityBinding,
    cleanupEvidence,
    completedAt: new Date().toISOString(),
    diagnostics: attemptDiagnostics,
    failure: attemptFailure,
    invocationId: attemptContext.invocationId,
    kind: 'package-ui-profile-attempt',
    lease: {
      generation: attemptContext.leaseGeneration,
      payloadSha256: attemptContext.leasePayloadSha256,
    },
    manifestSha256: invocationManifest.sha256,
    packageLineage: manager.metadata.packageLineage,
    ordinal,
    passed: attemptOutcome.passed,
    profileId,
    profileState,
    resumable: attemptOutcome.resumable,
    runGroupId: manager.runGroupId,
    runnerContractSha256: manager.metadata.runnerContractSha256,
    schemaVersion: PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
  };
  return writeImmutableEnvelope(
    path.join(directory, `${String(ordinal).padStart(4, '0')}-${attemptId}.json`),
    payload,
  );
}

function expectedPackageUiCheckpointEvidenceBinding(attemptPayload) {
  const profileId = attemptPayload?.profileId;
  return {
    attemptId: attemptPayload?.attemptId,
    invocationId: attemptPayload?.invocationId,
    profileId,
    profileLockBinding:
      attemptPayload?.cleanupEvidence?.profileLockIsolation?.before?.binding,
    runGroupId: attemptPayload?.runGroupId,
    runnerContractSha256: attemptPayload?.runnerContractSha256,
    scalePercent: profileId === PACKAGE_UI_WIDE_PROFILE.id
      ? PACKAGE_UI_WIDE_PROFILE.scalePercent
      : Number.parseInt(String(profileId || '').split('-')[0], 10),
  };
}

function packageUiCheckpointRunEvidenceMatchesTerminalAttempt(
  runEvidence,
  attemptPayload,
) {
  try {
    const expectedBinding =
      expectedPackageUiCheckpointEvidenceBinding(attemptPayload);
    const cleanupEvidence = {
      chromiumProcessLineage:
        runEvidence?.chromiumProcessLineage ?? null,
      packageProcessIsolation:
        runEvidence?.packageProcessIsolation ?? null,
      profileLockIsolation:
        runEvidence?.profileLockIsolation ?? null,
      profileProcessIsolation:
        runEvidence?.profileProcessIsolation ?? null,
    };
    return attemptPayload?.passed === true
      && attemptPayload?.resumable === true
      && runEvidence?.passed === attemptPayload.passed
      && runEvidence?.profileId === attemptPayload.profileId
      && canonicalJson(runEvidence?.evidenceBinding)
        === canonicalJson(expectedBinding)
      && canonicalJson(canonicalPackageUiArtifactBinding(runEvidence))
        === canonicalJson({
          attemptId: expectedBinding.attemptId,
          invocationId: expectedBinding.invocationId,
          profileId: expectedBinding.profileId,
          runGroupId: expectedBinding.runGroupId,
          runnerContractSha256: expectedBinding.runnerContractSha256,
          scalePercent: expectedBinding.scalePercent,
        })
      && canonicalJson(runEvidence?.attemptArtifacts)
        === canonicalJson(attemptPayload.attemptArtifacts)
      && canonicalJson(runEvidence?.artifactReferences)
        === canonicalJson(attemptPayload.artifactReferences)
      && canonicalJson(cleanupEvidence)
        === canonicalJson(attemptPayload.cleanupEvidence)
      && canonicalJson(runEvidence?.diagnostics)
        === canonicalJson(attemptPayload.diagnostics)
      && canonicalJson(runEvidence?.failure)
        === canonicalJson(attemptPayload.failure)
      && packageUiAttemptOutcomeMatches(attemptPayload);
  } catch {
    return false;
  }
}

  return {
    recordPackageUiProfileAttempt,
    expectedPackageUiCheckpointEvidenceBinding,
    packageUiCheckpointRunEvidenceMatchesTerminalAttempt,
  };
};
