#!/usr/bin/env node
// 只读复核恢复游标；受保护临时目录的在线备份不改变原库，也不启动应用。
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  CURRENTNESS_METHOD,
  SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
  runReadonlySqliteOnlineBackupSync,
} = require('./sqlite-authority-currentness');
const {
  cleanupOwnedSqliteTempRoot,
  restrictWindowsTempAcl,
} = require('./protected-sqlite-temp');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');
const { collectPackageUiRunnerSourceBinding } = require('./package-ui-source-identity');

const dependencies = require('./inspect-package-ui-contracts')({
  crypto,
  fs,
  os,
  path,
  spawnSync,
  CURRENTNESS_METHOD,
  SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
  runReadonlySqliteOnlineBackupSync,
  cleanupOwnedSqliteTempRoot,
  restrictWindowsTempAcl,
  validateEvidenceUserDataPath,
  collectPackageUiRunnerSourceBinding,
});
const moduleNames = [
  './inspect-package-ui-paths.js',
  './inspect-package-ui-sqlite-authority.js',
  './inspect-package-ui-artifact-membership.js',
  './inspect-package-ui-diagnostics.js',
  './inspect-package-ui-process-contract.js',
  './inspect-package-ui-pure-runner.js',
  './inspect-package-ui-manifests.js',
  './inspect-package-ui-attempts.js',
  './inspect-package-ui-arguments.js',
  './inspect-package-ui-resume.js',
  './inspect-package-ui-inspection.js',
  './inspect-package-ui-cli.js',
];
for (const moduleName of moduleNames) Object.assign(dependencies, require(moduleName)(dependencies));
Object.freeze(dependencies);
const {
  ATTEMPT_SCHEMA,
  BUNDLED_CHROMIUM_RELATIVE_PATH,
  CHECKPOINT_SCHEMA,
  DEFAULT_APP_CONTENT,
  DEFAULT_EXE,
  PROFILE_SEQUENCE,
  RUN_GROUP_SCHEMA,
  USAGE,
  appContentManifest,
  attemptArtifactManifest,
  attemptArtifactMembershipMatches,
  canonicalJson,
  canonicalAuthorityPaths,
  cleanupProven,
  cloneSecretBlindDiagnosticRecord,
  diagnosticsMatch,
  inspect,
  main,
  parseArgs,
  processSnapshotEvidencePassed,
  profileManifest,
  resolveWindowsKnownFolder,
  runnerFactsFromPureChild,
  sha256Buffer,
  sqliteLogicalArtifact,
  validateInvocationCollections,
  validateAuthoritySelectionFromPureChild,
  validateProfileDatabaseProvenanceFromPureChild,
  validateProfileEvidenceFromPureChild,
  validateManifestEvidenceFromPureChild,
  writeResumeInspectionIntent,
  defaultProtectedDatabasePath,
  violation,
} = dependencies;

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'package-ui-run-group-inspection/v1',
      status: 'ARGUMENT_ERROR',
      violations: [violation('ARGUMENT_ERROR', 'Invalid inspection arguments; use --help for the fixed production contract.')],
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ATTEMPT_SCHEMA,
  BUNDLED_CHROMIUM_RELATIVE_PATH,
  CHECKPOINT_SCHEMA,
  DEFAULT_APP_CONTENT,
  DEFAULT_EXE,
  PROFILE_SEQUENCE,
  RUN_GROUP_SCHEMA,
  USAGE,
  appContentManifest,
  attemptArtifactManifest,
  attemptArtifactMembershipMatches,
  canonicalJson,
  canonicalAuthorityPaths,
  cleanupProven,
  cloneSecretBlindDiagnosticRecord,
  diagnosticsMatch,
  inspect,
  main,
  parseArgs,
  processSnapshotEvidencePassed,
  profileManifest,
  resolveWindowsKnownFolder,
  runnerFactsFromPureChild,
  sha256Buffer,
  sqliteLogicalArtifact,
  validateInvocationCollections,
  validateAuthoritySelectionFromPureChild,
  validateProfileDatabaseProvenanceFromPureChild,
  validateProfileEvidenceFromPureChild,
  validateManifestEvidenceFromPureChild,
  writeResumeInspectionIntent,
};

Object.defineProperty(module.exports, 'DEFAULT_PROTECTED_DB', {
  enumerable: true,
  get: defaultProtectedDatabasePath,
});
