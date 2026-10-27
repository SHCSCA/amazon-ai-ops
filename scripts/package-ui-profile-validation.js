// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    INTERACTIVE_LOGIN_CONTRACT,
    ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_SEQUENCE,
    PACKAGE_UI_WIDE_PROFILE,
  } = dependencies;
  const buildPackageUiRunnerContract = (...args) => dependencies.buildPackageUiRunnerContract(...args);
  const evaluatePackageUiEvidenceCompleteness = (...args) => dependencies.evaluatePackageUiEvidenceCompleteness(...args);
  const packageUiAttemptCleanupPassed = (...args) => dependencies.packageUiAttemptCleanupPassed(...args);
  const packageUiAttemptDiagnosticsSnapshotMatches = (...args) => dependencies.packageUiAttemptDiagnosticsSnapshotMatches(...args);
  const violation = (...args) => dependencies.violation(...args);

function evaluatePackageUiProfileEvidence(profileId, runEvidence) {
  const compactScale = profileId === '100-compact'
    ? 100
    : profileId === '125-compact'
      ? 125
      : null;
  const wide = profileId === PACKAGE_UI_WIDE_PROFILE.id;
  if (compactScale === null && !wide) {
    return {
      cleanupPassed: false,
      diagnosticsPassed: false,
      passed: false,
      relevantViolations: [violation(
        'PROFILE_ID_INVALID',
        'Profile evidence validator received an unknown canonical profile id.',
        profileId,
      )],
      shapePassed: false,
    };
  }
  const timeout = Number(
    runEvidence?.session?.operatorHandoff?.phaseTimeoutMs,
  );
  const syntheticRunGroupId = runEvidence?.evidenceBinding?.runGroupId
    || 'profile-evidence-validation';
  const runnerContract = buildPackageUiRunnerContract();
  const evaluated = evaluatePackageUiEvidenceCompleteness({
    checkpointComposition: {
      checkpointRecords: [],
      passed: false,
      runGroupId: syntheticRunGroupId,
      runnerContractSha256: runnerContract.sha256,
    },
    interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
    isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    packageProcessIsolation: runEvidence?.packageProcessIsolation,
    profileLockIsolation: runEvidence?.profileLockIsolation,
    profileValidationOnly: true,
    profileProcessIsolation: runEvidence?.profileProcessIsolation,
    requested: {
      allowInteractiveLogin: true,
      allowSavedLogin: false,
      interactiveLoginMaximumTotalMs: Number.isFinite(timeout) ? timeout * 2 : null,
      interactiveLoginTimeoutMs: Number.isFinite(timeout) ? timeout : null,
      loginMode: 'interactive-operator-each-run',
      resumeRunGroupId: syntheticRunGroupId,
      runGroupId: syntheticRunGroupId,
    },
    runGroup: {
      profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
      runGroupId: syntheticRunGroupId,
      runnerContractSha256: runnerContract.sha256,
    },
    runs: compactScale === null ? [] : [runEvidence],
    schemaVersion: PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    wideProfile: wide ? runEvidence : null,
  });
  const relevantViolations = (evaluated.violations || [])
    .filter((entry) => entry?.profileId === profileId)
    .map((entry) => ({
      code: String(entry?.code || 'UNKNOWN'),
      details: entry?.details ?? null,
      message: String(entry?.message || ''),
      profileId,
    }));
  const shapePassed = compactScale !== null
    ? runEvidence?.scalePercent === compactScale
    : runEvidence?.profileId === profileId;
  const cleanupPassed = packageUiAttemptCleanupPassed(runEvidence);
  const diagnosticsPassed = packageUiAttemptDiagnosticsSnapshotMatches(
    runEvidence?.diagnostics,
    profileId,
  );
  return {
    cleanupPassed,
    diagnosticsPassed,
    passed: shapePassed
      && runEvidence?.passed === true
      && cleanupPassed
      && diagnosticsPassed
      && relevantViolations.length === 0,
    relevantViolations,
    shapePassed,
  };
}

  return {
    evaluatePackageUiProfileEvidence,
  };
};
