// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_SEQUENCE,
    PACKAGE_UI_RUN_GROUP_SCHEMA_VERSION,
    PACKAGE_UI_WIDE_PROFILE,
    crypto,
    fs,
    path,
  } = dependencies;
  const buildPackageUiRunnerContract = (...args) => dependencies.buildPackageUiRunnerContract(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const currentFileRecordMatches = (...args) => dependencies.currentFileRecordMatches(...args);
  const fail = (...args) => dependencies.fail(...args);
  const logicalSqliteArtifactMatches = (...args) => dependencies.logicalSqliteArtifactMatches(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const packageUiAttemptArtifactManifestMatches = (...args) => dependencies.packageUiAttemptArtifactManifestMatches(...args);
  const packageUiAttemptCleanupEvidencePassed = (...args) => dependencies.packageUiAttemptCleanupEvidencePassed(...args);
  const packageUiAttemptDiagnosticsSnapshotMatches = (...args) => dependencies.packageUiAttemptDiagnosticsSnapshotMatches(...args);
  const packageUiAttemptOutcomeMatches = (...args) => dependencies.packageUiAttemptOutcomeMatches(...args);
  const packageUiCheckpointRunEvidenceMatchesTerminalAttempt = (...args) => dependencies.packageUiCheckpointRunEvidenceMatchesTerminalAttempt(...args);
  const packageUiRunGroupId = (...args) => dependencies.packageUiRunGroupId(...args);
  const packageUiRunGroupPaths = (...args) => dependencies.packageUiRunGroupPaths(...args);
  const profileLineageStateMatches = (...args) => dependencies.profileLineageStateMatches(...args);
  const readImmutableEnvelope = (...args) => dependencies.readImmutableEnvelope(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const timestampSegment = (...args) => dependencies.timestampSegment(...args);
  const validPackageUiAuthorityBinding = (...args) => dependencies.validPackageUiAuthorityBinding(...args);
  const validPackageUiRunnerContract = (...args) => dependencies.validPackageUiRunnerContract(...args);
  const validatePackageUiAttemptArtifactMembership = (...args) => dependencies.validatePackageUiAttemptArtifactMembership(...args);
  const writeImmutableEnvelope = (...args) => dependencies.writeImmutableEnvelope(...args);

function initializePackageUiRunGroup({
  authorityBinding,
  genesisProfileState,
  options,
  outputDir,
  packageLineage,
  protectedDatabaseLogical,
  runnerContract = buildPackageUiRunnerContract(),
}) {
  if (!validPackageUiRunnerContract(runnerContract)) {
    fail('Package UI evidence runner contract is malformed or internally inconsistent');
  }
  if (!validPackageUiAuthorityBinding(authorityBinding)) {
    fail('Package UI authority binding is malformed or incomplete');
  }
  const runGroupId = packageUiRunGroupId(options);
  const paths = packageUiRunGroupPaths(outputDir, runGroupId);
  const metadataExists = fs.existsSync(paths.metadataPath);
  if (options.resumeRunGroupId) {
    if (!metadataExists) fail('Requested package UI run group does not exist', paths.metadataPath);
    const record = readImmutableEnvelope(
      paths.metadataPath,
      'package-ui-run-group',
      PACKAGE_UI_RUN_GROUP_SCHEMA_VERSION,
    );
    const payload = record.payload;
    if (
      payload.runGroupId !== runGroupId
      || canonicalJson(payload.packageLineage) !== canonicalJson(packageLineage)
      || canonicalJson(payload.profileSequence) !== canonicalJson(PACKAGE_UI_PROFILE_SEQUENCE)
      || canonicalJson(payload.authorityBinding) !== canonicalJson(authorityBinding)
      || payload.runnerContractSha256 !== runnerContract.sha256
      || canonicalJson(payload.runnerContract) !== canonicalJson(runnerContract)
      || !logicalSqliteArtifactMatches(
        payload.protectedDatabaseLogical,
        protectedDatabaseLogical,
      )
    ) {
      fail('Package UI run-group package, protected DB, profile sequence, or runner contract lineage changed');
    }
    return { metadata: payload, metadataRecord: record, paths, resumed: true, runGroupId };
  }
  if (metadataExists || fs.existsSync(paths.root)) {
    fail('New package UI run group already exists; use --resume-run-group', paths.root);
  }
  fs.mkdirSync(paths.root, { recursive: true });
  const metadata = {
    authorityBinding,
    createdAt: new Date().toISOString(),
    genesisProfileState,
    kind: 'package-ui-run-group',
    packageLineage,
    profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
    protectedDatabaseLogical,
    runGroupId,
    runnerContract,
    runnerContractSha256: runnerContract.sha256,
    schemaVersion: PACKAGE_UI_RUN_GROUP_SCHEMA_VERSION,
  };
  const metadataRecord = writeImmutableEnvelope(paths.metadataPath, metadata);
  return { metadata, metadataRecord, paths, resumed: false, runGroupId };
}

function packageUiCheckpointPath(manager, profileId) {
  return path.join(manager.paths.checkpointsDir, `${safeSegment(profileId)}.json`);
}

function loadPackageUiCheckpoint(manager, profileId) {
  const filePath = packageUiCheckpointPath(manager, profileId);
  if (!fs.existsSync(filePath)) return null;
  const record = readImmutableEnvelope(
    filePath,
    'package-ui-profile-checkpoint',
    PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION,
  );
  if (
    record.payload.runGroupId !== manager.runGroupId
    || record.payload.profileId !== profileId
    || canonicalJson(record.payload.packageLineage) !== canonicalJson(manager.metadata.packageLineage)
    || record.payload.runnerContractSha256 !== manager.metadata.runnerContractSha256
  ) {
    fail('Package UI checkpoint escaped its run-group/package/profile/runner lineage', filePath);
  }
  return record;
}

function loadPackageUiAttemptRecords(manager, profileId) {
  const directory = path.join(manager.paths.attemptsDir, safeSegment(profileId));
  if (!fs.existsSync(directory)) return [];
  const names = fs.readdirSync(directory);
  if (names.some((name) => !name.endsWith('.json'))) {
    fail('Package UI attempt receipt directory contains an unexpected entry', directory);
  }
  const records = names
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((name) => {
      const record = readImmutableEnvelope(
        path.join(directory, name),
        'package-ui-profile-attempt',
        PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
      );
      if (
        record.payload.runGroupId !== manager.runGroupId
        || record.payload.profileId !== profileId
        || canonicalJson(record.payload.packageLineage) !== canonicalJson(manager.metadata.packageLineage)
        || canonicalJson(record.payload.authorityBinding)
          !== canonicalJson(manager.metadata.authorityBinding)
        || record.payload.runnerContractSha256 !== manager.metadata.runnerContractSha256
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(
          String(record.payload.invocationId || ''),
        )
        || record.payload.lease?.generation == null
        || !/^[A-F0-9]{64}$/.test(
          String(record.payload.lease?.payloadSha256 || ''),
        )
      ) {
        fail('Package UI attempt receipt escaped its run-group/package/profile/runner lineage', record.file.path);
      }
      if (!packageUiAttemptArtifactManifestMatches(record.payload.attemptArtifacts)) {
        fail('Package UI attempt artifacts are missing, changed, or escaped their immutable directory', record.file.path);
      }
      if (!validatePackageUiAttemptArtifactMembership(
        record.payload.attemptArtifacts,
        record.payload,
      ).passed) {
        fail('Package UI attempt artifact membership is incomplete or detached', record.file.path);
      }
      if (!packageUiAttemptDiagnosticsSnapshotMatches(record.payload.diagnostics, profileId)) {
        fail('Package UI attempt diagnostics are missing, unsafe, or malformed', record.file.path);
      }
      if (!packageUiAttemptOutcomeMatches(record.payload)) {
        fail('Package UI attempt outcome, failure, diagnostics, and cleanup evidence disagree', record.file.path);
      }
      if (
        !currentFileRecordMatches(record.payload.attemptInvocationManifest)
        || record.payload.manifestSha256
          !== record.payload.attemptInvocationManifest.sha256
        || normalizedWindowsPath(record.payload.attemptInvocationManifest.path)
          !== normalizedWindowsPath(path.join(
            manager.paths.invocationsDir,
            safeSegment(record.payload.invocationId),
            `${safeSegment(profileId)}-${String(record.payload.ordinal).padStart(4, '0')}-${record.payload.attemptId}.json`,
          ))
      ) {
        fail('Package UI attempt invocation manifest is missing or changed', record.file.path);
      }
      const invocationManifest = readImmutableEnvelope(
        record.payload.attemptInvocationManifest.path,
        'package-ui-attempt-invocation',
        PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION,
      );
      if (
        invocationManifest.file.sha256 !== record.payload.manifestSha256
        || invocationManifest.payload.attemptId !== record.payload.attemptId
        || invocationManifest.payload.invocationId !== record.payload.invocationId
        || invocationManifest.payload.profileId !== record.payload.profileId
        || invocationManifest.payload.ordinal !== record.payload.ordinal
        || canonicalJson(invocationManifest.payload.cleanupEvidence)
          !== canonicalJson(record.payload.cleanupEvidence)
        || canonicalJson(invocationManifest.payload.profileState)
          !== canonicalJson(record.payload.profileState)
        || canonicalJson(invocationManifest.payload.attemptArtifacts)
          !== canonicalJson(record.payload.attemptArtifacts)
        || canonicalJson(invocationManifest.payload.artifactReferences)
          !== canonicalJson(record.payload.artifactReferences)
        || invocationManifest.payload.resumable !== record.payload.resumable
        || invocationManifest.payload.passed !== record.payload.passed
        || canonicalJson(invocationManifest.payload.lease)
          !== canonicalJson(record.payload.lease)
      ) {
        fail('Package UI attempt receipt is detached from its exact invocation manifest', record.file.path);
      }
      const cleanupPassed = packageUiAttemptCleanupEvidencePassed(
        record.payload.cleanupEvidence,
      );
      if (
        (record.payload.resumable === true && !cleanupPassed)
        || (record.payload.resumable !== true && cleanupPassed)
      ) {
        fail('Package UI attempt resumability disagrees with full cleanup evidence', record.file.path);
      }
      return record;
    });
  records.forEach((record, index) => {
    if (record.payload.ordinal !== index + 1) {
      fail('Package UI attempt receipts are missing or out of order', record.file.path);
    }
  });
  return records;
}

function createPackageUiProfileAttemptContext(manager, profileId, invocation = {}) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(invocation.invocationId || ''))
    || invocation.lease?.payload?.invocationId !== invocation.invocationId
    || invocation.lease?.payload?.runGroupId !== manager.runGroupId
    || invocation.lease?.payload?.runnerContractSha256
      !== manager.metadata.runnerContractSha256
  ) {
    fail('Package UI attempt context requires the exact active invocation and lease.');
  }
  const ordinal = loadPackageUiAttemptRecords(manager, profileId).length + 1;
  const attemptId = `${timestampSegment()}-${crypto.randomUUID()}`;
  const artifactDir = path.join(
    manager.paths.root,
    'profile-attempt-artifacts',
    safeSegment(profileId),
    `${String(ordinal).padStart(4, '0')}-${attemptId}`,
  );
  if (fs.existsSync(artifactDir)) {
    fail('Package UI profile attempt artifact directory already exists', artifactDir);
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  return {
    artifactDir,
    attemptId,
    invocationId: invocation.invocationId,
    leaseGeneration: invocation.lease.payload.generation,
    leasePayloadSha256: invocation.lease.payloadSha256,
    ordinal,
  };
}

function resolvePackageUiProfileCursor(manager, targetProfileId) {
  let cursor = manager.metadata.genesisProfileState;
  for (const profileId of PACKAGE_UI_PROFILE_SEQUENCE) {
    const checkpoint = loadPackageUiCheckpoint(manager, profileId);
    if (profileId === targetProfileId) {
      if (checkpoint) return { checkpoint, cursor, lineageStart: cursor, receipts: [] };
      const lineageStart = cursor;
      const receipts = loadPackageUiAttemptRecords(manager, profileId);
      for (const receipt of receipts) {
        if (
          receipt.payload.resumable !== true
          || !receipt.payload.profileState?.after
        ) {
          fail(
            'Package UI run group is non-resumable because a target process cleanup attestation failed; create a fresh isolated profile/run group',
            receipt.file.path,
          );
        }
        if (!profileLineageStateMatches(cursor, receipt.payload.profileState.before)) {
          fail('Package UI attempt lineage is discontinuous before resume', receipt.file.path);
        }
        cursor = receipt.payload.profileState.after;
      }
      return { checkpoint: null, cursor, lineageStart, receipts };
    }
    if (!checkpoint) {
      fail('Package UI checkpoints are missing or out of profile order', profileId);
    }
    if (!profileLineageStateMatches(cursor, checkpoint.payload.lineageStart)) {
      fail('Package UI checkpoint lineage is discontinuous', checkpoint.file.path);
    }
    cursor = checkpoint.payload.profileState.after;
  }
  fail('Unknown package UI evidence profile', targetProfileId);
}

function writePackageUiProfileCheckpoint({
  attemptRecord,
  lineageStart,
  manager,
  profileId,
  profileState,
  runEvidence,
}) {
  if (runEvidence?.passed !== true) fail('A failed package UI run cannot become a profile checkpoint');
  const attemptRecords = loadPackageUiAttemptRecords(manager, profileId);
  const terminalAttempt = attemptRecords[attemptRecords.length - 1];
  if (
    attemptRecords.length < 1
    || canonicalJson(terminalAttempt?.file) !== canonicalJson(attemptRecord)
    || canonicalJson(profileState)
      !== canonicalJson(terminalAttempt?.payload?.profileState)
    || !packageUiCheckpointRunEvidenceMatchesTerminalAttempt(
      runEvidence,
      terminalAttempt?.payload,
    )
  ) {
    fail(
      'Package UI checkpoint terminal receipt, outcome, cleanup, artifacts, or exact invocation binding is detached from its full attempt chain',
    );
  }
  const payload = {
    attemptReceipt: attemptRecord,
    attemptReceipts: attemptRecords.map((record) => ({
      attemptId: record.payload.attemptId,
      file: record.file,
      invocationId: record.payload.invocationId,
      ordinal: record.payload.ordinal,
      payloadSha256: record.payloadSha256,
    })),
    completedAt: new Date().toISOString(),
    kind: 'package-ui-profile-checkpoint',
    lineageStart,
    packageLineage: manager.metadata.packageLineage,
    profileId,
    profileState,
    runEvidence,
    runGroupId: manager.runGroupId,
    runnerContractSha256: manager.metadata.runnerContractSha256,
    schemaVersion: PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION,
    sequence: PACKAGE_UI_PROFILE_SEQUENCE.indexOf(profileId) + 1,
  };
  return writeImmutableEnvelope(packageUiCheckpointPath(manager, profileId), payload);
}

function composePackageUiRunGroup(manager) {
  let cursor = manager.metadata.genesisProfileState;
  const checkpointRecords = [];
  for (const profileId of PACKAGE_UI_PROFILE_SEQUENCE) {
    const checkpoint = loadPackageUiCheckpoint(manager, profileId);
    if (!checkpoint) fail('Package UI run-group composition is incomplete', profileId);
    if (
      checkpoint.payload.sequence !== checkpointRecords.length + 1
      || !profileLineageStateMatches(cursor, checkpoint.payload.lineageStart)
    ) {
      fail('Package UI run-group composition rejected an out-of-order or detached checkpoint', checkpoint.file.path);
    }
    const receipts = loadPackageUiAttemptRecords(manager, profileId);
    let attemptCursor = cursor;
    for (const receipt of receipts) {
      if (receipt.payload.resumable !== true || !receipt.payload.profileState?.after) {
        fail('Package UI run-group composition rejected a non-resumable cleanup failure', receipt.file.path);
      }
      if (!profileLineageStateMatches(attemptCursor, receipt.payload.profileState.before)) {
        fail('Package UI run-group composition rejected a detached attempt receipt', receipt.file.path);
      }
      attemptCursor = receipt.payload.profileState.after;
    }
    if (
      receipts.length < 1
      || receipts[receipts.length - 1].payload.passed !== true
      || canonicalJson(checkpoint.payload.profileState)
        !== canonicalJson(receipts[receipts.length - 1].payload.profileState)
      || !profileLineageStateMatches(attemptCursor, checkpoint.payload.profileState.after)
      || canonicalJson(checkpoint.payload.attemptReceipt)
        !== canonicalJson(receipts[receipts.length - 1].file)
      || !packageUiCheckpointRunEvidenceMatchesTerminalAttempt(
        checkpoint.payload.runEvidence,
        receipts[receipts.length - 1].payload,
      )
      || canonicalJson(checkpoint.payload.attemptReceipts)
        !== canonicalJson(receipts.map((record) => ({
          attemptId: record.payload.attemptId,
          file: record.file,
          invocationId: record.payload.invocationId,
          ordinal: record.payload.ordinal,
          payloadSha256: record.payloadSha256,
        })))
    ) {
      fail('Package UI checkpoint is not bound to its terminal successful attempt lineage', checkpoint.file.path);
    }
    cursor = checkpoint.payload.profileState.after;
    checkpointRecords.push({
      file: checkpoint.file,
      payloadSha256: checkpoint.payloadSha256,
      profileId,
    });
  }
  const compactRuns = PACKAGE_UI_PROFILE_SEQUENCE.slice(0, -1).map((profileId) =>
    loadPackageUiCheckpoint(manager, profileId).payload.runEvidence);
  const wideProfile = loadPackageUiCheckpoint(
    manager,
    PACKAGE_UI_WIDE_PROFILE.id,
  ).payload.runEvidence;
  return {
    checkpointRecords,
    compactRuns,
    finalProfileState: cursor,
    packageLineage: manager.metadata.packageLineage,
    passed: true,
    runGroupId: manager.runGroupId,
    runnerContractSha256: manager.metadata.runnerContractSha256,
    wideProfile,
  };
}

function packageUiCheckpointRecordMatches(
  record,
  runGroupId,
  profileId,
  runnerContractSha256,
  expectedRunEvidence = null,
) {
  try {
    if (
      record?.profileId !== profileId
      || !currentFileRecordMatches(record?.file)
      || !/^[A-F0-9]{64}$/.test(String(record?.payloadSha256 || ''))
    ) {
      return false;
    }
    const checkpoint = readImmutableEnvelope(
      record.file.path,
      'package-ui-profile-checkpoint',
      PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION,
    );
    if (
      !currentFileRecordMatches(checkpoint.payload.attemptReceipt)
    ) {
      return false;
    }
    const terminalAttempt = readImmutableEnvelope(
      checkpoint.payload.attemptReceipt.path,
      'package-ui-profile-attempt',
      PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
    );
    const runGroupRoot = path.dirname(path.dirname(checkpoint.file.path));
    const expectedAttemptDirectory = path.join(
      runGroupRoot,
      'attempts',
      safeSegment(profileId),
    );
    return checkpoint.payloadSha256 === record.payloadSha256
      && checkpoint.payload.runGroupId === runGroupId
      && checkpoint.payload.profileId === profileId
      && checkpoint.payload.runnerContractSha256 === runnerContractSha256
      && checkpoint.payload.sequence === PACKAGE_UI_PROFILE_SEQUENCE.indexOf(profileId) + 1
      && expectedRunEvidence !== null
      && canonicalJson(checkpoint.payload.runEvidence)
        === canonicalJson(expectedRunEvidence)
      && canonicalJson(checkpoint.payload.attemptReceipt)
        === canonicalJson(terminalAttempt.file)
      && normalizedWindowsPath(path.dirname(terminalAttempt.file.path))
        === normalizedWindowsPath(expectedAttemptDirectory)
      && terminalAttempt.payload.runGroupId === runGroupId
      && terminalAttempt.payload.profileId === profileId
      && terminalAttempt.payload.runnerContractSha256
        === runnerContractSha256
      && canonicalJson(checkpoint.payload.profileState)
        === canonicalJson(terminalAttempt.payload.profileState)
      && packageUiCheckpointRunEvidenceMatchesTerminalAttempt(
        checkpoint.payload.runEvidence,
        terminalAttempt.payload,
      );
  } catch {
    return false;
  }
}

  return {
    initializePackageUiRunGroup,
    packageUiCheckpointPath,
    loadPackageUiCheckpoint,
    loadPackageUiAttemptRecords,
    createPackageUiProfileAttemptContext,
    resolvePackageUiProfileCursor,
    writePackageUiProfileCheckpoint,
    composePackageUiRunGroup,
    packageUiCheckpointRecordMatches,
  };
};
