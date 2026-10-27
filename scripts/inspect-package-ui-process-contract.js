module.exports = function createInspectorModule(dependencies) {
  const {
    PROFILE_LOCK_MAX_CRITICAL_ENTRIES,
    PROFILE_LOCK_MAX_ENTRIES,
    PROFILE_LOCK_MAX_PATH_CHARACTERS,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const hasOnlyKeys = (...args) => dependencies.hasOnlyKeys(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const validIsoDate = (...args) => dependencies.validIsoDate(...args);

function processSnapshotEvidencePassed(snapshot) {
  return snapshot?.passed === true
    && snapshot.error === null
    && Number.isInteger(snapshot.observedCount)
    && snapshot.observedCount >= 0
    && Array.isArray(snapshot.matching)
    && Number.isInteger(snapshot.matchingCount)
    && snapshot.matchingCount === snapshot.matching.length
    && Array.isArray(snapshot.unresolved)
    && Number.isInteger(snapshot.unresolvedCount)
    && snapshot.unresolvedCount === snapshot.unresolved.length
    && (!Array.isArray(snapshot.mismatched)
      || (
        Number.isInteger(snapshot.mismatchedCount)
        && snapshot.mismatchedCount === snapshot.mismatched.length
        && snapshot.mismatchedCount === 0
      ))
    && (
      snapshot.ignoredUnresolvedCount === undefined
      || snapshot.ignoredUnresolvedCount === 0
    )
    && snapshot.observedCount >= snapshot.matchingCount + snapshot.unresolvedCount;
}

function processIsolationEvidencePassed(evidence) {
  return evidence?.passed === true
    && processSnapshotEvidencePassed(evidence.before)
    && evidence.before.matchingCount === 0
    && evidence.before.unresolvedCount === 0
    && processSnapshotEvidencePassed(evidence.after)
    && evidence.after.matchingCount === 0
    && evidence.after.unresolvedCount === 0;
}

function profileLockSnapshotPassed(snapshot, expectedBinding = null) {
  if (
    !hasOnlyKeys(snapshot, [
      'binding',
      'claim',
      'exclusiveOpen',
      'exclusiveProbe',
      'kind',
      'observedAt',
      'passed',
      'rootIdentityStable',
      'schemaVersion',
      'tree',
      'unresolved',
      'unresolvedCount',
    ])
    || !hasOnlyKeys(snapshot?.binding, [
      'invocationIdSha256',
      'profileId',
      'rootPathSha256',
    ])
    || !hasOnlyKeys(snapshot?.exclusiveOpen, [
      'allEntriesHeld',
      'closeFailureCount',
      'closeFailures',
      'directoryCount',
      'entryCount',
      'fileCount',
      'heldHandleCount',
      'method',
    ])
    || !hasOnlyKeys(snapshot?.exclusiveProbe, ['created', 'removed'])
    || !hasOnlyKeys(snapshot?.tree, [
      'attestationSha256',
      'criticalEntries',
      'criticalEntryCount',
      'identitySetSha256',
      'limits',
      'pathSetSha256',
      'secondSnapshotEntryCount',
      'totalPathCharacters',
      'treeStable',
    ])
    || !hasOnlyKeys(snapshot?.tree?.limits, [
      'maxCriticalEntries',
      'maxEntries',
      'maxPathCharacters',
    ])
    || snapshot.kind !== 'package-ui-profile-lock-snapshot'
    || snapshot.schemaVersion !== 'package-ui-profile-lock-snapshot/v2'
    || snapshot.claim !== 'bounded-quiescent-exclusive-open-attestation'
    || snapshot.passed !== true
    || !validIsoDate(snapshot.observedAt)
    || snapshot.rootIdentityStable !== true
    || snapshot.exclusiveProbe?.created !== true
    || snapshot.exclusiveProbe?.removed !== true
    || snapshot.unresolvedCount !== 0
    || !Array.isArray(snapshot.unresolved)
    || snapshot.unresolved.length !== 0
    || typeof snapshot.binding?.profileId !== 'string'
    || snapshot.binding.profileId.length < 1
    || !/^[A-F0-9]{64}$/.test(String(snapshot.binding?.invocationIdSha256 || ''))
    || !/^[A-F0-9]{64}$/.test(String(snapshot.binding?.rootPathSha256 || ''))
    || snapshot.exclusiveOpen?.method
      !== 'win32-createfile-share-none-stable-tree/v1'
    || snapshot.exclusiveOpen.allEntriesHeld !== true
    || !Number.isInteger(snapshot.exclusiveOpen.entryCount)
    || snapshot.exclusiveOpen.entryCount < 2
    || snapshot.exclusiveOpen.entryCount > PROFILE_LOCK_MAX_ENTRIES
    || !Number.isInteger(snapshot.exclusiveOpen.fileCount)
    || snapshot.exclusiveOpen.fileCount < 1
    || !Number.isInteger(snapshot.exclusiveOpen.directoryCount)
    || snapshot.exclusiveOpen.directoryCount < 1
    || snapshot.exclusiveOpen.fileCount + snapshot.exclusiveOpen.directoryCount
      !== snapshot.exclusiveOpen.entryCount
    || snapshot.exclusiveOpen.heldHandleCount
      !== snapshot.exclusiveOpen.entryCount
    || snapshot.exclusiveOpen.closeFailureCount !== 0
    || !Array.isArray(snapshot.exclusiveOpen.closeFailures)
    || snapshot.exclusiveOpen.closeFailures.length !== 0
    || snapshot.tree?.treeStable !== true
    || snapshot.tree.secondSnapshotEntryCount
      !== snapshot.exclusiveOpen.entryCount
    || !/^[A-F0-9]{64}$/.test(String(snapshot.tree.pathSetSha256 || ''))
    || !/^[A-F0-9]{64}$/.test(String(snapshot.tree.identitySetSha256 || ''))
    || snapshot.tree.attestationSha256 !== sha256Buffer(Buffer.from(
      canonicalJson({
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
    ))
    || snapshot.tree.limits?.maxEntries !== PROFILE_LOCK_MAX_ENTRIES
    || snapshot.tree.limits?.maxPathCharacters
      !== PROFILE_LOCK_MAX_PATH_CHARACTERS
    || snapshot.tree.limits?.maxCriticalEntries
      !== PROFILE_LOCK_MAX_CRITICAL_ENTRIES
    || !Number.isInteger(snapshot.tree.totalPathCharacters)
    || snapshot.tree.totalPathCharacters < 1
    || snapshot.tree.totalPathCharacters > PROFILE_LOCK_MAX_PATH_CHARACTERS
    || !Number.isInteger(snapshot.tree.criticalEntryCount)
    || snapshot.tree.criticalEntryCount < 0
    || snapshot.tree.criticalEntryCount > PROFILE_LOCK_MAX_CRITICAL_ENTRIES
    || !Array.isArray(snapshot.tree.criticalEntries)
    || snapshot.tree.criticalEntries.length !== snapshot.tree.criticalEntryCount
    || snapshot.tree.criticalEntries.some((entry) => (
      !hasOnlyKeys(entry, [
        'identitySha256',
        'kind',
        'linkCount',
        'pathSha256',
        'sizeBytes',
      ])
      || !['directory', 'file'].includes(entry.kind)
      || !/^[A-F0-9]{64}$/.test(String(entry.identitySha256 || ''))
      || !/^[A-F0-9]{64}$/.test(String(entry.pathSha256 || ''))
      || !Number.isInteger(entry.linkCount)
      || entry.linkCount < 1
      || (entry.kind === 'file' && entry.linkCount !== 1)
      || !Number.isInteger(entry.sizeBytes)
      || entry.sizeBytes < 0
    ))
  ) return false;
  return !expectedBinding
    || canonicalJson(snapshot.binding) === canonicalJson(expectedBinding);
}

function profileLockIsolationPassed(evidence, expectedBinding = null) {
  return evidence?.passed === true
    && profileLockSnapshotPassed(evidence.before, expectedBinding)
    && profileLockSnapshotPassed(evidence.after, expectedBinding)
    && canonicalJson(evidence.before.binding)
      === canonicalJson(evidence.after.binding);
}

function cleanupProven(runEvidence) {
  if (
    !processIsolationEvidencePassed(runEvidence?.packageProcessIsolation)
    || !processIsolationEvidencePassed(runEvidence?.profileProcessIsolation)
    || runEvidence?.packageProcessIsolation?.before?.observedCount !== 0
    || runEvidence?.packageProcessIsolation?.after?.observedCount !== 0
    || !profileLockIsolationPassed(
      runEvidence?.profileLockIsolation,
      runEvidence?.evidenceBinding?.profileLockBinding || null,
    )
  ) return false;
  if (runEvidence?.chromiumProcessLineage == null) return true;
  return processSnapshotEvidencePassed(runEvidence.chromiumProcessLineage.cleanup)
    && runEvidence.chromiumProcessLineage.cleanup.matchingCount === 0
    && runEvidence.chromiumProcessLineage.cleanup.unresolvedCount === 0;
}

  return {
    processSnapshotEvidencePassed,
    processIsolationEvidencePassed,
    profileLockSnapshotPassed,
    profileLockIsolationPassed,
    cleanupProven,
  };
};
