const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { fileURLToPath } = require('node:url');
const sqlite = require('./sqlite-authority-currentness');
const temp = require('./protected-sqlite-temp');
const selection = require('./verify-production-authority-selection');
const evidence = require('./evidence-user-data');

// 只组合既有校验工厂；不加载浏览器、执行入口或动态源码目录。
const factories = Object.freeze([
  require('./package-ui-arguments'),
  require('./package-ui-attempt-artifacts'),
  require('./package-ui-authentication'),
  require('./package-ui-authority-artifacts'),
  require('./package-ui-build-content'),
  require('./package-ui-chromium-lineage'),
  require('./package-ui-completeness'),
  require('./package-ui-diagnostic-format'),
  require('./package-ui-diagnostics'),
  require('./package-ui-envelopes'),
  require('./package-ui-file-identity'),
  require('./package-ui-identity-viewport'),
  require('./package-ui-interaction-validation'),
  require('./package-ui-login-probes'),
  require('./package-ui-package-lineage'),
  require('./package-ui-profile-attempt'),
  require('./package-ui-profile-exact-set'),
  require('./package-ui-profile-lock-contract'),
  require('./package-ui-profile-processes'),
  require('./package-ui-run-group'),
  require('./package-ui-runtime-database'),
  require('./package-ui-scheduler-validation'),
  require('./package-ui-screenshots'),
]);

function createPackageUiVerificationContract(options) {
  if (!options?.desktopPackage || !options.runnerContract) throw new Error('FROZEN_PACKAGE_UI_CONTRACT_REQUIRED');
  const dependencies = {
    ...require('./package-ui-contracts')({
      crypto, fs, os, path, performance, fileURLToPath,
      root: options.sourceRoot,
      desktopPackage: options.desktopPackage,
      CURRENTNESS_METHOD: sqlite.CURRENTNESS_METHOD,
      SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION: sqlite.SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
      runReadonlySqliteOnlineBackupSync: options.runReadonlySqliteOnlineBackupSync ?? sqlite.runReadonlySqliteOnlineBackupSync,
      cleanupOwnedSqliteTempRoot: temp.cleanupOwnedSqliteTempRoot,
      restrictWindowsTempAcl: temp.restrictWindowsTempAcl,
      PRODUCTION_AUTHORITY_SELECTION_KIND: selection.KIND,
      PRODUCTION_AUTHORITY_SELECTION_SCHEMA_VERSION: selection.SCHEMA_VERSION,
      inspectProductionAuthoritySelection: options.inspectProductionAuthoritySelection ?? selection.inspectProductionAuthoritySelection,
      ...evidence,
    }),
    collectPackageUiRunnerSourceBinding: () => options.runnerContract.evidenceScript,
  };
  for (const factory of factories) Object.assign(dependencies, factory(dependencies));
  const artifactInfo = dependencies.artifactInfo;
  const protectedScript = path.resolve(__dirname, 'protected-sqlite-temp.js');
  dependencies.artifactInfo = file => path.resolve(file) === protectedScript
    ? { path: protectedScript, ...options.runnerContract.protectedSqliteTempScript }
    : artifactInfo(file);
  if (!dependencies.validPackageUiRunnerContract(options.runnerContract)
    || dependencies.buildPackageUiRunnerContract().sha256 !== options.runnerContract.sha256) {
    throw new Error('FROZEN_PACKAGE_UI_RUNNER_CONTRACT_INVALID');
  }
  const names = [
    'buildAppContentManifest', 'evaluatePackageUiEvidenceCompleteness',
    'validateSchedulerSubviewEvidence', 'validatePackageUiReadOnlyRuntimeEvidence',
    'EXPECTED_PACKAGE_UI_ENTRIES', 'EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS', 'EXPECTED_OVERLAY_CHECK_IDS',
  ];
  return Object.freeze(Object.fromEntries(names.map(name => [name, dependencies[name]])));
}

module.exports = { createPackageUiVerificationContract };
