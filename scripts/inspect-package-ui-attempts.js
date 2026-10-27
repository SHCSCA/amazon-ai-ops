module.exports = function createInspectorModule(dependencies) {
  const {
    ATTEMPT_INVOCATION_SCHEMA,
    ATTEMPT_SCHEMA,
    PROFILE_SEQUENCE,
    fs,
    path,
  } = dependencies;
  const attemptArtifactManifest = (...args) => dependencies.attemptArtifactManifest(...args);
  const attemptArtifactMembershipMatches = (...args) => dependencies.attemptArtifactMembershipMatches(...args);
  const attemptOutcomeMatches = (...args) => dependencies.attemptOutcomeMatches(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const cleanupProven = (...args) => dependencies.cleanupProven(...args);
  const diagnosticsMatch = (...args) => dependencies.diagnosticsMatch(...args);
  const fail = (...args) => dependencies.fail(...args);
  const fileRecordMatches = (...args) => dependencies.fileRecordMatches(...args);
  const hasOnlyKeys = (...args) => dependencies.hasOnlyKeys(...args);
  const readEnvelope = (...args) => dependencies.readEnvelope(...args);
  const safeDirectory = (...args) => dependencies.safeDirectory(...args);
  const safeFileArtifact = (...args) => dependencies.safeFileArtifact(...args);
  const samePath = (...args) => dependencies.samePath(...args);
  const stateMatches = (...args) => dependencies.stateMatches(...args);
  const validIsoDate = (...args) => dependencies.validIsoDate(...args);
  const validProfileState = (...args) => dependencies.validProfileState(...args);

function loadAttemptRecords({ metadata, profileId, root, startCursor }) {
  const directory = path.join(root, 'attempts', profileId);
  const artifactProfileRoot = path.join(root, 'profile-attempt-artifacts', profileId);
  if (!fs.existsSync(directory)) {
    if (fs.existsSync(artifactProfileRoot)) {
      fail('ATTEMPT_ARTIFACT_INVALID', 'Attempt artifacts exist without immutable attempt receipts.');
    }
    return { cleanupBindingProven: true, cursor: startCursor, records: [] };
  }
  const attemptRoot = safeDirectory(directory, 'Attempt receipt directory');
  const names = fs.readdirSync(attemptRoot).sort((a, b) => a.localeCompare(b, 'en'));
  const records = [];
  let cursor = startCursor;
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (!name.endsWith('.json')) fail('ATTEMPT_RECORD_INVALID', 'Attempt directory contains a non-JSON entry.');
    const record = readEnvelope(path.join(attemptRoot, name), 'package-ui-profile-attempt', ATTEMPT_SCHEMA, root);
    const receipt = record.payload;
    const ordinal = index + 1;
    const expectedArtifactRoot = path.join(
      root,
      'profile-attempt-artifacts',
      profileId,
      `${String(ordinal).padStart(4, '0')}-${receipt.attemptId}`,
    );
    const expectedInvocationManifest = path.join(
      root,
      'invocations',
      String(receipt.invocationId || ''),
      `${profileId}-${String(ordinal).padStart(4, '0')}-${receipt.attemptId}.json`,
    );
    if (
      !hasOnlyKeys(receipt, ['attemptArtifacts', 'attemptInvocationManifest', 'attemptId', 'artifactReferences', 'authorityBinding', 'cleanupEvidence', 'completedAt', 'diagnostics', 'failure', 'invocationId', 'kind', 'lease', 'manifestSha256', 'packageLineage', 'ordinal', 'passed', 'profileId', 'profileState', 'resumable', 'runGroupId', 'runnerContractSha256', 'schemaVersion'])
      || receipt.ordinal !== ordinal
      || name !== `${String(ordinal).padStart(4, '0')}-${receipt.attemptId}.json`
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(receipt.attemptId || ''))
      || !validIsoDate(receipt.completedAt)
      || receipt.profileId !== profileId
      || receipt.runGroupId !== metadata.runGroupId
      || receipt.runnerContractSha256 !== metadata.runnerContractSha256
      || canonicalJson(receipt.packageLineage) !== canonicalJson(metadata.packageLineage)
      || canonicalJson(receipt.authorityBinding) !== canonicalJson(metadata.authorityBinding)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(receipt.invocationId || ''))
      || !hasOnlyKeys(receipt.lease, ['generation', 'payloadSha256'])
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(receipt.lease.generation || ''))
      || !/^[A-F0-9]{64}$/.test(String(receipt.lease.payloadSha256 || ''))
      || !diagnosticsMatch(receipt.diagnostics, profileId)
      || !validProfileState(receipt.profileState?.before)
      || !stateMatches(cursor, receipt.profileState.before)
      || (receipt.resumable === true ? !validProfileState(receipt.profileState?.after) : receipt.profileState?.after !== null)
      || typeof receipt.passed !== 'boolean'
      || typeof receipt.resumable !== 'boolean'
      || !attemptOutcomeMatches(receipt)
      || (receipt.passed === true && receipt.resumable !== true)
      || !receipt.attemptArtifacts
      || !samePath(String(receipt.attemptArtifacts.rootPath || ''), expectedArtifactRoot)
      || canonicalJson(attemptArtifactManifest(expectedArtifactRoot)) !== canonicalJson(receipt.attemptArtifacts)
      || !attemptArtifactMembershipMatches(
        receipt.attemptArtifacts,
        receipt.artifactReferences,
        {
          attemptId: receipt.attemptId,
          invocationId: receipt.invocationId,
          profileId: receipt.profileId,
          runGroupId: receipt.runGroupId,
          runnerContractSha256: receipt.runnerContractSha256,
          scalePercent: receipt.profileId === 'wide-1400x900-100'
            ? 100
            : Number.parseInt(receipt.profileId.split('-')[0], 10),
        },
        receipt.passed,
      )
      || !fileRecordMatches(
        receipt.attemptInvocationManifest,
        safeFileArtifact(
          expectedInvocationManifest,
          'Attempt invocation manifest',
          'ATTEMPT_RECORD_INVALID',
        ),
      )
      || receipt.manifestSha256 !== receipt.attemptInvocationManifest.sha256
    ) fail('ATTEMPT_RECORD_INVALID', 'Attempt receipt is malformed, detached, secret-bearing, or cursor-inconsistent.');
    const invocationManifest = readEnvelope(
      expectedInvocationManifest,
      'package-ui-attempt-invocation',
      ATTEMPT_INVOCATION_SCHEMA,
      root,
    );
    if (
      invocationManifest.file.sha256 !== receipt.manifestSha256
      || invocationManifest.payload.attemptId !== receipt.attemptId
      || invocationManifest.payload.invocationId !== receipt.invocationId
      || invocationManifest.payload.ordinal !== receipt.ordinal
      || invocationManifest.payload.profileId !== receipt.profileId
      || canonicalJson(invocationManifest.payload.attemptArtifacts)
        !== canonicalJson(receipt.attemptArtifacts)
      || canonicalJson(invocationManifest.payload.artifactReferences)
        !== canonicalJson(receipt.artifactReferences)
      || canonicalJson(invocationManifest.payload.cleanupEvidence)
        !== canonicalJson(receipt.cleanupEvidence)
      || canonicalJson(invocationManifest.payload.profileState)
        !== canonicalJson(receipt.profileState)
      || canonicalJson(invocationManifest.payload.lease)
        !== canonicalJson(receipt.lease)
      || invocationManifest.payload.resumable !== receipt.resumable
      || invocationManifest.payload.passed !== receipt.passed
    ) fail('ATTEMPT_RECORD_INVALID', 'Attempt receipt is detached from its invocation manifest.');
    const cleanupPassed = cleanupProven(receipt.cleanupEvidence);
    if (
      (receipt.resumable === true && !cleanupPassed)
      || (receipt.resumable !== true && cleanupPassed)
    ) fail('CLEANUP_UNPROVEN', 'Attempt resumability disagrees with full process/profile cleanup evidence.');
    if (receipt.resumable !== true) fail('CLEANUP_UNPROVEN', 'Attempt receipt records non-resumable target cleanup.');
    cursor = receipt.profileState.after;
    records.push(record);
  }
  const expectedArtifactDirectories = records.map((record) =>
    `${String(record.payload.ordinal).padStart(4, '0')}-${record.payload.attemptId}`);
  const actualArtifactDirectories = fs.existsSync(artifactProfileRoot)
    ? fs.readdirSync(safeDirectory(artifactProfileRoot, 'Attempt artifact profile directory')).sort((a, b) =>
      a.localeCompare(b, 'en'))
    : [];
  if (canonicalJson(actualArtifactDirectories) !== canonicalJson(expectedArtifactDirectories)) {
    fail('ATTEMPT_ARTIFACT_INVALID', 'Attempt artifact directories do not exactly match immutable attempt receipts.');
  }
  return {
    cleanupBindingProven: true,
    cursor,
    records,
  };
}

function expectedCheckpointEvidenceBinding(attemptPayload) {
  const profileId = attemptPayload?.profileId;
  return {
    attemptId: attemptPayload?.attemptId,
    invocationId: attemptPayload?.invocationId,
    profileId,
    profileLockBinding:
      attemptPayload?.cleanupEvidence?.profileLockIsolation?.before?.binding,
    runGroupId: attemptPayload?.runGroupId,
    runnerContractSha256: attemptPayload?.runnerContractSha256,
    scalePercent: profileId === 'wide-1400x900-100'
      ? 100
      : Number.parseInt(String(profileId || '').split('-')[0], 10),
  };
}

function checkpointRunEvidenceMatchesTerminalAttempt(
  runEvidence,
  attemptPayload,
) {
  const expectedBinding = expectedCheckpointEvidenceBinding(attemptPayload);
  const cleanupEvidence = {
    chromiumProcessLineage: runEvidence?.chromiumProcessLineage ?? null,
    packageProcessIsolation: runEvidence?.packageProcessIsolation ?? null,
    profileLockIsolation: runEvidence?.profileLockIsolation ?? null,
    profileProcessIsolation: runEvidence?.profileProcessIsolation ?? null,
  };
  return attemptPayload?.passed === true
    && attemptPayload?.resumable === true
    && runEvidence?.passed === attemptPayload.passed
    && runEvidence?.profileId === attemptPayload.profileId
    && canonicalJson(runEvidence?.evidenceBinding)
      === canonicalJson(expectedBinding)
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
    && attemptOutcomeMatches(attemptPayload);
}

function checkpointMatches({
  checkpoint,
  lineageStart,
  metadata,
  profileId,
  records,
  root,
  runnerPath,
  sequence,
  validateProfileEvidence,
}) {
  const payload = checkpoint.payload;
  const terminal = records[records.length - 1];
  if (
    !terminal
    || terminal.payload.passed !== true
    || !hasOnlyKeys(payload, ['attemptReceipt', 'attemptReceipts', 'completedAt', 'kind', 'lineageStart', 'packageLineage', 'profileId', 'profileState', 'runEvidence', 'runGroupId', 'runnerContractSha256', 'schemaVersion', 'sequence'])
    || payload.profileId !== profileId
    || payload.runGroupId !== metadata.runGroupId
    || payload.sequence !== sequence
    || !validIsoDate(payload.completedAt)
    || Date.parse(payload.completedAt) < Date.parse(terminal?.payload?.completedAt || '')
    || payload.runnerContractSha256 !== metadata.runnerContractSha256
    || canonicalJson(payload.packageLineage) !== canonicalJson(metadata.packageLineage)
    || !stateMatches(lineageStart, payload.lineageStart)
    || canonicalJson(payload.profileState) !== canonicalJson(terminal.payload.profileState)
    || !stateMatches(payload.profileState.after, terminal.payload.profileState.after)
    || payload.runEvidence?.passed !== true
    || !cleanupProven(payload.runEvidence)
    || !checkpointRunEvidenceMatchesTerminalAttempt(
      payload.runEvidence,
      terminal.payload,
    )
    || !fileRecordMatches(payload.attemptReceipt, terminal.file)
    || canonicalJson(payload.attemptReceipts)
      !== canonicalJson(records.map((record) => ({
        attemptId: record.payload.attemptId,
        file: record.file,
        invocationId: record.payload.invocationId,
        ordinal: record.payload.ordinal,
        payloadSha256: record.payloadSha256,
      })))
  ) fail('CHECKPOINT_CURSOR_MISMATCH', 'Checkpoint is not bound to its complete terminal successful attempt chain.');
  const expectedCheckpoint = path.join(root, 'checkpoints', `${profileId}.json`);
  if (!samePath(checkpoint.file.path, expectedCheckpoint)) {
    fail('CHECKPOINT_CURSOR_MISMATCH', 'Checkpoint path is detached from its profile.');
  }
  const fullValidation = validateProfileEvidence({
    profileId,
    runEvidence: payload.runEvidence,
    runnerPath,
  });
  if (
    fullValidation?.passed !== true
    || fullValidation?.cleanupPassed !== true
    || fullValidation?.diagnosticsPassed !== true
    || fullValidation?.shapePassed !== true
  ) {
    fail(
      'CHECKPOINT_EVIDENCE_INCOMPLETE',
      'Checkpoint runEvidence does not satisfy the current profile-specific schema-v9 validator.',
    );
  }
}

function ensureNoFutureRecords(root, startIndex) {
  for (const profileId of PROFILE_SEQUENCE.slice(startIndex + 1)) {
    for (const candidate of [
      path.join(root, 'attempts', profileId),
      path.join(root, 'checkpoints', `${profileId}.json`),
      path.join(root, 'profile-attempt-artifacts', profileId),
    ]) {
      if (fs.existsSync(candidate)) fail('CHECKPOINT_CURSOR_MISMATCH', 'Run group contains out-of-order future profile records.');
    }
  }
}

  return {
    loadAttemptRecords,
    expectedCheckpointEvidenceBinding,
    checkpointRunEvidenceMatchesTerminalAttempt,
    checkpointMatches,
    ensureNoFutureRecords,
  };
};
