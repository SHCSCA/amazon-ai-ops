// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    BUNDLED_CHROMIUM_RELATIVE_PATH,
    DEFAULT_APP_CONTENT_PATH,
    path,
    spawnSync,
  } = dependencies;
  const artifactInfo = (...args) => dependencies.artifactInfo(...args);
  const collectMatchingProfileBrowserProcesses = (...args) => dependencies.collectMatchingProfileBrowserProcesses(...args);
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const processSnapshotEvidencePassed = (...args) => dependencies.processSnapshotEvidencePassed(...args);

function collectActiveBundledChromiumLineage(options, run = spawnSync) {
  const profilePath = path.join(options.userDataDir, 'stores');
  const chromiumPath = path.join(
    options.appContentPath || DEFAULT_APP_CONTENT_PATH,
    BUNDLED_CHROMIUM_RELATIVE_PATH,
  );
  const chromiumArtifact = options.chromiumArtifact || artifactInfo(chromiumPath);
  const snapshot = collectMatchingProfileBrowserProcesses(
    profilePath,
    {
      baselineProcessIds: options.profileBrowserBaselineProcessIds,
      expectedExecutablePath: chromiumPath,
    },
    run,
  );
  const rootProcessIds = Array.isArray(snapshot.rootProcessIds)
    ? snapshot.rootProcessIds
    : [];
  const descendantProcessIds = Array.isArray(snapshot.descendantProcessIds)
    ? snapshot.descendantProcessIds
    : [];
  const baselineProcessIds = new Set(options.profileBrowserBaselineProcessIds || []);
  const passed = processSnapshotEvidencePassed(snapshot)
    && snapshot.matchingCount > 0
    && rootProcessIds.length > 0
    && rootProcessIds.every((processId) => !baselineProcessIds.has(processId))
    && rootProcessIds.length + descendantProcessIds.length === snapshot.matchingCount
    && chromiumArtifact.sha256 === options.chromiumArtifact?.sha256;
  return {
    chromium: {
      relativePath: BUNDLED_CHROMIUM_RELATIVE_PATH.split(path.sep).join('/'),
      sha256: chromiumArtifact.sha256,
      sizeBytes: chromiumArtifact.sizeBytes,
    },
    descendantProcessIds,
    expectedProfileRootSha256: snapshot.expectedProfileRootSha256,
    observedAt: new Date().toISOString(),
    passed,
    profileBindingSha256: snapshot.profileBindingSha256,
    profileBindingTokenCount: snapshot.profileBindingTokenCount,
    rootProcessIds,
    snapshot,
  };
}

async function waitForActiveBundledChromiumLineage(options, waitOptions = {}) {
  const collect = waitOptions.collect || collectActiveBundledChromiumLineage;
  const attempts = Number.isInteger(waitOptions.attempts) ? waitOptions.attempts : 20;
  const intervalMs = Number.isInteger(waitOptions.intervalMs) ? waitOptions.intervalMs : 250;
  let evidence = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    evidence = collect(options);
    if (chromiumLineageEvidencePassed(evidence)) {
      return { ...evidence, attempts: attempt, passed: true };
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return { ...evidence, attempts, passed: false };
}

function chromiumLineageEvidencePassed(evidence) {
  const cleanupPassed = evidence && Object.hasOwn(evidence, 'cleanup')
    ? processSnapshotEvidencePassed(evidence.cleanup)
      && evidence.cleanup.matchingCount === 0
      && evidence.cleanup.unresolvedCount === 0
    : true;
  const observedProfileBindingTokens = [...new Set(
    (evidence?.snapshot?.matching || [])
      .filter((item) => item?.profileMatched === true)
      .map((item) => item.profilePathBindingSha256)
      .filter((value) => /^[A-F0-9]{64}$/.test(String(value || ''))),
  )].sort((left, right) => left.localeCompare(right, 'en'));
  const derivedProfileBindingSha256 = observedProfileBindingTokens.length > 0
    ? envelopePayloadSha256(observedProfileBindingTokens)
    : null;
  return evidence?.passed === true
    && /^[A-F0-9]{64}$/.test(String(evidence?.chromium?.sha256 || ''))
    && Number.isInteger(evidence?.chromium?.sizeBytes)
    && evidence.chromium.sizeBytes > 0
    && /^[A-F0-9]{64}$/.test(String(evidence?.expectedProfileRootSha256 || ''))
    && /^[A-F0-9]{64}$/.test(String(evidence?.profileBindingSha256 || ''))
    && evidence.profileBindingSha256 === derivedProfileBindingSha256
    && evidence.profileBindingTokenCount === observedProfileBindingTokens.length
    && evidence.profileBindingTokenCount > 0
    && evidence.snapshot?.expectedProfileRootSha256 === evidence.expectedProfileRootSha256
    && evidence.snapshot?.profileBindingSha256 === evidence.profileBindingSha256
    && evidence.snapshot?.profileBindingTokenCount === evidence.profileBindingTokenCount
    && Array.isArray(evidence?.rootProcessIds)
    && evidence.rootProcessIds.length > 0
    && evidence.rootProcessIds.every((value) => Number.isInteger(value) && value > 0)
    && Array.isArray(evidence?.descendantProcessIds)
    && evidence.descendantProcessIds.length > 0
    && evidence.descendantProcessIds.every((value) => Number.isInteger(value) && value > 0)
    && processSnapshotEvidencePassed(evidence?.snapshot)
    && evidence.snapshot.matchingCount
      === evidence.rootProcessIds.length + evidence.descendantProcessIds.length
    && cleanupPassed;
}

function buildProcessIsolationEvidence(before, after) {
  return {
    after,
    before,
    passed: processSnapshotEvidencePassed(before)
      && before?.matchingCount === 0
      && before?.unresolvedCount === 0
      && processSnapshotEvidencePassed(after)
      && after?.matchingCount === 0
      && after?.unresolvedCount === 0,
  };
}

function processIsolationEvidencePassed(evidence) {
  return evidence?.passed === true
    && processSnapshotEvidencePassed(evidence.before)
    && evidence.before?.matchingCount === 0
    && evidence.before?.unresolvedCount === 0
    && processSnapshotEvidencePassed(evidence.after)
    && evidence.after?.matchingCount === 0
    && evidence.after?.unresolvedCount === 0;
}

function packageProcessAbsencePassed(snapshot) {
  return processSnapshotEvidencePassed(snapshot)
    && snapshot.observedCount === 0
    && snapshot.matchingCount === 0
    && snapshot.unresolvedCount === 0;
}

function packageProcessIsolationEvidencePassed(evidence) {
  return evidence?.passed === true
    && packageProcessAbsencePassed(evidence.before)
    && packageProcessAbsencePassed(evidence.after);
}

  return {
    collectActiveBundledChromiumLineage,
    waitForActiveBundledChromiumLineage,
    chromiumLineageEvidencePassed,
    buildProcessIsolationEvidence,
    processIsolationEvidencePassed,
    packageProcessAbsencePassed,
    packageProcessIsolationEvidencePassed,
  };
};
