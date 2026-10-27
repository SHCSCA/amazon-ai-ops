// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES,
    PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES,
    PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const exactObjectKeys = (...args) => dependencies.exactObjectKeys(...args);
  const packageProcessIsolationEvidencePassed = (...args) => dependencies.packageProcessIsolationEvidencePassed(...args);
  const processIsolationEvidencePassed = (...args) => dependencies.processIsolationEvidencePassed(...args);
  const processSnapshotEvidencePassed = (...args) => dependencies.processSnapshotEvidencePassed(...args);

function packageUiProfileLockSnapshotPassed(snapshot, expectedBinding = null) {
  if (
    !exactObjectKeys(snapshot, [
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
    || !exactObjectKeys(snapshot?.binding, [
      'invocationIdSha256',
      'profileId',
      'rootPathSha256',
    ])
    || !exactObjectKeys(snapshot?.exclusiveOpen, [
      'allEntriesHeld',
      'closeFailureCount',
      'closeFailures',
      'directoryCount',
      'entryCount',
      'fileCount',
      'heldHandleCount',
      'method',
    ])
    || !exactObjectKeys(snapshot?.exclusiveProbe, ['created', 'removed'])
    || !exactObjectKeys(snapshot?.tree, [
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
    || !exactObjectKeys(snapshot?.tree?.limits, [
      'maxCriticalEntries',
      'maxEntries',
      'maxPathCharacters',
    ])
    || snapshot?.kind !== 'package-ui-profile-lock-snapshot'
    || snapshot?.schemaVersion !== 'package-ui-profile-lock-snapshot/v2'
    || snapshot?.claim !== 'bounded-quiescent-exclusive-open-attestation'
    || snapshot?.passed !== true
    || !Number.isFinite(Date.parse(snapshot?.observedAt))
    || snapshot?.rootIdentityStable !== true
    || snapshot?.exclusiveProbe?.created !== true
    || snapshot?.exclusiveProbe?.removed !== true
    || snapshot?.unresolvedCount !== 0
    || !Array.isArray(snapshot?.unresolved)
    || snapshot.unresolved.length !== 0
    || typeof snapshot?.binding?.profileId !== 'string'
    || snapshot.binding.profileId.length < 1
    || !/^[A-F0-9]{64}$/.test(String(
      snapshot?.binding?.invocationIdSha256 || '',
    ))
    || !/^[A-F0-9]{64}$/.test(String(
      snapshot?.binding?.rootPathSha256 || '',
    ))
    || snapshot?.exclusiveOpen?.method
      !== 'win32-createfile-share-none-stable-tree/v1'
    || snapshot.exclusiveOpen.allEntriesHeld !== true
    || !Number.isInteger(snapshot.exclusiveOpen.entryCount)
    || snapshot.exclusiveOpen.entryCount < 2
    || snapshot.exclusiveOpen.entryCount > PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES
    || !Number.isInteger(snapshot.exclusiveOpen.fileCount)
    || snapshot.exclusiveOpen.fileCount < 1
    || !Number.isInteger(snapshot.exclusiveOpen.directoryCount)
    || snapshot.exclusiveOpen.directoryCount < 1
    || snapshot.exclusiveOpen.fileCount
      + snapshot.exclusiveOpen.directoryCount
      !== snapshot.exclusiveOpen.entryCount
    || snapshot.exclusiveOpen.heldHandleCount
      !== snapshot.exclusiveOpen.entryCount
    || snapshot.exclusiveOpen.closeFailureCount !== 0
    || !Array.isArray(snapshot.exclusiveOpen.closeFailures)
    || snapshot.exclusiveOpen.closeFailures.length !== 0
    || snapshot?.tree?.treeStable !== true
    || snapshot.tree.secondSnapshotEntryCount
      !== snapshot.exclusiveOpen.entryCount
    || !/^[A-F0-9]{64}$/.test(String(snapshot.tree.pathSetSha256 || ''))
    || !/^[A-F0-9]{64}$/.test(String(
      snapshot.tree.identitySetSha256 || '',
    ))
    || snapshot.tree.attestationSha256 !== envelopePayloadSha256({
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
    })
    || snapshot.tree.limits?.maxEntries
      !== PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES
    || snapshot.tree.limits?.maxPathCharacters
      !== PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS
    || snapshot.tree.limits?.maxCriticalEntries
      !== PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES
    || !Number.isInteger(snapshot.tree.totalPathCharacters)
    || snapshot.tree.totalPathCharacters < 1
    || snapshot.tree.totalPathCharacters
      > PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS
    || !Number.isInteger(snapshot.tree.criticalEntryCount)
    || snapshot.tree.criticalEntryCount < 0
    || snapshot.tree.criticalEntryCount
      > PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES
    || !Array.isArray(snapshot.tree.criticalEntries)
    || snapshot.tree.criticalEntries.length
      !== snapshot.tree.criticalEntryCount
    || snapshot.tree.criticalEntries.some((entry) => (
      !exactObjectKeys(entry, [
        'identitySha256',
        'kind',
        'linkCount',
        'pathSha256',
        'sizeBytes',
      ])
      || !['directory', 'file'].includes(entry?.kind)
      || !/^[A-F0-9]{64}$/.test(String(entry?.pathSha256 || ''))
      || !/^[A-F0-9]{64}$/.test(String(entry?.identitySha256 || ''))
      || !Number.isInteger(entry?.linkCount)
      || entry.linkCount < 1
      || (entry.kind === 'file' && entry.linkCount !== 1)
      || !Number.isInteger(entry?.sizeBytes)
      || entry.sizeBytes < 0
    ))
  ) {
    return false;
  }
  if (
    expectedBinding
    && (
      snapshot.binding.profileId !== expectedBinding.profileId
      || snapshot.binding.invocationIdSha256
        !== expectedBinding.invocationIdSha256
      || snapshot.binding.rootPathSha256 !== expectedBinding.rootPathSha256
    )
  ) {
    return false;
  }
  return true;
}

function packageUiProfileLockIsolationPassed(input, expectedBinding = null) {
  return Boolean(
    input?.passed === true
    && packageUiProfileLockSnapshotPassed(input.before, expectedBinding)
    && packageUiProfileLockSnapshotPassed(input.after, expectedBinding)
    && canonicalJson(input.before.binding) === canonicalJson(input.after.binding),
  );
}

function packageUiAttemptCleanupPassed(runEvidence) {
  if (
    !packageProcessIsolationEvidencePassed(runEvidence?.packageProcessIsolation)
    || !processIsolationEvidencePassed(runEvidence?.profileProcessIsolation)
    || !packageUiProfileLockIsolationPassed(
      runEvidence?.profileLockIsolation,
      runEvidence?.evidenceBinding?.profileLockBinding || null,
    )
  ) {
    return false;
  }
  if (runEvidence?.chromiumProcessLineage == null) return true;
  return processSnapshotEvidencePassed(runEvidence.chromiumProcessLineage.cleanup)
    && runEvidence.chromiumProcessLineage.cleanup.matchingCount === 0
    && runEvidence.chromiumProcessLineage.cleanup.unresolvedCount === 0;
}

function packageUiAttemptCleanupEvidencePassed(cleanupEvidence) {
  return packageUiAttemptCleanupPassed({
    chromiumProcessLineage: cleanupEvidence?.chromiumProcessLineage,
    packageProcessIsolation: cleanupEvidence?.packageProcessIsolation,
    profileLockIsolation: cleanupEvidence?.profileLockIsolation,
    profileProcessIsolation: cleanupEvidence?.profileProcessIsolation,
  });
}

  return {
    packageUiProfileLockSnapshotPassed,
    packageUiProfileLockIsolationPassed,
    packageUiAttemptCleanupPassed,
    packageUiAttemptCleanupEvidencePassed,
  };
};
