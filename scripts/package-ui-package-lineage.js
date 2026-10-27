// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    BUNDLED_CHROMIUM_RELATIVE_PATH,
    DEFAULT_APP_CONTENT_PATH,
    EXPECTED_OVERLAY_CHECK_IDS,
    EXPECTED_PACKAGE_UI_ENTRIES,
    EXPECTED_PACKAGE_UI_MODULES,
    EXPECTED_PACKAGE_UI_SCALES,
    EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    INTERACTIVE_LOGIN_CONTRACT,
    ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION,
    PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    PACKAGE_UI_NATIVE_RUNTIME_CONTRACT,
    PACKAGE_UI_INVOCATION_RECEIPT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_SEQUENCE,
    PACKAGE_UI_RESUME_INSPECTION_SCHEMA_VERSION,
    PACKAGE_UI_RUNNER_LEASE_SCHEMA_VERSION,
    PACKAGE_UI_RUN_GROUP_SCHEMA_VERSION,
    PACKAGE_UI_WIDE_PROFILE,
    READ_ONLY_INTERACTION_PLAN,
    path,
  } = dependencies;
  const artifactInfo = (...args) => dependencies.artifactInfo(...args);
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

function createPackageLineage(options, artifacts) {
  const chromiumPath = path.join(
    options.appContentPath || DEFAULT_APP_CONTENT_PATH,
    BUNDLED_CHROMIUM_RELATIVE_PATH,
  );
  const chromium = artifacts.chromium || artifactInfo(chromiumPath);
  return {
    appContentSha256: artifacts.appContent.sha256,
    chromium: {
      relativePath: BUNDLED_CHROMIUM_RELATIVE_PATH.split(path.sep).join('/'),
      sha256: chromium.sha256,
      sizeBytes: chromium.sizeBytes,
    },
    executableSha256: artifacts.exe.sha256,
    profileBindingSha256: sha256Buffer(Buffer.from(
      normalizedWindowsPath(options.userDataDir),
      'utf8',
    )),
    profileBrowserBindingSha256: sha256Buffer(Buffer.from(
      normalizedWindowsPath(path.join(options.userDataDir, 'stores')),
      'utf8',
    )),
  };
}

function buildPackageUiRunnerContract() {
  const evidenceScript = packageUiRunnerSourceBinding();
  const protectedSqliteTempScript = artifactInfo(
    path.join(__dirname, 'protected-sqlite-temp.js'),
  );
  const semanticContract = {
    evidenceSchemaVersion: PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    runGroupSchemaVersion: PACKAGE_UI_RUN_GROUP_SCHEMA_VERSION,
    attemptSchemaVersion: PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
    checkpointSchemaVersion: PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION,
    attemptInvocationSchemaVersion: PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION,
    invocationReceiptSchemaVersion: PACKAGE_UI_INVOCATION_RECEIPT_SCHEMA_VERSION,
    runnerLeaseSchemaVersion: PACKAGE_UI_RUNNER_LEASE_SCHEMA_VERSION,
    resumeInspectionSchemaVersion: PACKAGE_UI_RESUME_INSPECTION_SCHEMA_VERSION,
    profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
    scales: EXPECTED_PACKAGE_UI_SCALES,
    workspaces: EXPECTED_PACKAGE_UI_ENTRIES,
    modules: EXPECTED_PACKAGE_UI_MODULES,
    minimumWindow: { nativeMinimum: { width: 1200, height: 700 }, profileId: '100-compact', entries: 22 },
    subviewChecks: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    wideProfile: PACKAGE_UI_WIDE_PROFILE,
    overlayCheckIds: EXPECTED_OVERLAY_CHECK_IDS,
    interactionPlan: READ_ONLY_INTERACTION_PLAN,
    interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
    isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    nativeRuntimeContract: PACKAGE_UI_NATIVE_RUNTIME_CONTRACT,
  };
  const binding = {
    evidenceScript: {
      sha256: evidenceScript.sha256,
      sizeBytes: evidenceScript.sizeBytes,
    },
    protectedSqliteTempScript: {
      sha256: protectedSqliteTempScript.sha256,
      sizeBytes: protectedSqliteTempScript.sizeBytes,
    },
    semanticContractSha256: envelopePayloadSha256(semanticContract),
  };
  return {
    ...binding,
    sha256: envelopePayloadSha256(binding),
  };
}

function validPackageUiRunnerContract(contract) {
  if (
    !/^[A-F0-9]{64}$/.test(String(contract?.evidenceScript?.sha256 || ''))
    || !Number.isInteger(contract?.evidenceScript?.sizeBytes)
    || contract.evidenceScript.sizeBytes < 1
    || !/^[A-F0-9]{64}$/.test(String(
      contract?.protectedSqliteTempScript?.sha256 || '',
    ))
    || !Number.isInteger(contract?.protectedSqliteTempScript?.sizeBytes)
    || contract.protectedSqliteTempScript.sizeBytes < 1
    || !/^[A-F0-9]{64}$/.test(String(contract?.semanticContractSha256 || ''))
    || !/^[A-F0-9]{64}$/.test(String(contract?.sha256 || ''))
  ) {
    return false;
  }
  const binding = {
    evidenceScript: contract.evidenceScript,
    protectedSqliteTempScript: contract.protectedSqliteTempScript,
    semanticContractSha256: contract.semanticContractSha256,
  };
  return contract.sha256 === envelopePayloadSha256(binding);
}

function validPackageUiAuthorityBinding(binding) {
  return Boolean(
    /^[A-F0-9]{64}$/.test(String(
      binding?.authoritySelectionReceiptSha256 || '',
    ))
    && /^[A-F0-9]{64}$/.test(String(
      binding?.canonicalDatabasePathSha256 || '',
    ))
    && /^[A-F0-9]{64}$/.test(String(
      binding?.databaseFileIdentity?.stabilityTokenSha256 || '',
    ))
    && typeof binding?.databaseFileIdentity?.deviceId === 'string'
    && binding.databaseFileIdentity.deviceId.length > 0
    && typeof binding?.databaseFileIdentity?.fileId === 'string'
    && binding.databaseFileIdentity.fileId.length > 0
    && binding.databaseFileIdentity.hardLinkCount === 1
  );
}

function packageUiRunnerSourceBinding() {
  return dependencies.collectPackageUiRunnerSourceBinding(artifactInfo, dependencies.runnerImplementationPaths);
}

  return {
    createPackageLineage,
    buildPackageUiRunnerContract,
    validPackageUiRunnerContract,
    validPackageUiAuthorityBinding,
  };
};
