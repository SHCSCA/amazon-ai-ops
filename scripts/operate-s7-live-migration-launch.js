const { CANONICAL_APP, CANONICAL_EXE, CANONICAL_MAIN, KIND, PACKET_KIND, PACKET_SCHEMA_VERSION, FINALIZATION_PACKET_KIND, FINALIZATION_PACKET_SCHEMA, REQUIRED_MIGRATION_VERIFICATION_CODES, SCHEMA_VERSION, USAGE, stableJson } = require('./s7-launch-operator-contracts.js');
const { EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP } = require('./s7-launch-operator-helper-bootstrap.js');
const { EXCLUSIVE_WINDOW_HELPER_SCRIPT } = require('./s7-launch-operator-helper-script.js');
const { createPacket, createFinalizationPacket, parseArgs } = require('./s7-launch-operator-packet.js');
const { defaultAcquireLaunchExclusiveWindow } = require('./s7-launch-operator-protocol.js');
const { defaultInspectWindowsPathSecurity, defaultProtectWindowsDirectory, defaultProtectWindowsFile, resolveTrustedWindowsPowerShell } = require('./s7-launch-operator-security.js');
const { defaultPackageIdentity, postMigrationAuthorityContract, validatePackageUi, validatePackageUpgradeSmoke } = require('./s7-launch-operator-authority.js');
const { executeApproved } = require('./s7-launch-operator-execution.js');
const { finalizeApproved, prepareFinalization } = require('./s7-launch-operator-finalization.js');
const { fileArtifact } = require('./s7-launch-operator-filesystem.js');
const { run } = require('./s7-launch-operator-cli.js');

if (require.main === module) {
  run().then(result => { process.exitCode = result.exitCode; }).catch((error) => { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 's7.launch_operator_failed', { error })) + '\n'); process.exitCode = 1; });
}

module.exports = { CANONICAL_APP, CANONICAL_EXE, CANONICAL_MAIN, EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP, EXCLUSIVE_WINDOW_HELPER_SCRIPT, KIND, PACKET_KIND, PACKET_SCHEMA_VERSION, FINALIZATION_PACKET_KIND, FINALIZATION_PACKET_SCHEMA, REQUIRED_MIGRATION_VERIFICATION_CODES, SCHEMA_VERSION, USAGE, createPacket, createFinalizationPacket, defaultAcquireLaunchExclusiveWindow, defaultInspectWindowsPathSecurity, defaultPackageIdentity, defaultProtectWindowsDirectory, defaultProtectWindowsFile, executeApproved, finalizeApproved, fileArtifact, parseArgs, postMigrationAuthorityContract, prepareFinalization, resolveTrustedWindowsPowerShell, run, stableJson, validatePackageUi, validatePackageUpgradeSmoke };
