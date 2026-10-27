const { legacyV1Checksum } = require('./verify-production-authority-selection');
const { openOfflineReadOnly, readJsonArtifact } = require('./s7-live-migration-artifacts.js');
const { KIND, LIVE_MIGRATION_ACCEPTANCE_USAGE, REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES, REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES, SCHEMA_VERSION } = require('./s7-live-migration-contracts.js');
const { parseLiveMigrationAcceptanceArgs, run, verifyS7LiveMigrationAcceptance, writeJsonAtomicExclusive } = require('./s7-live-migration-runner.js');
const { removeCaptureRoot } = require('./s7-live-migration-capture.js');
const { validateS7LiveMigrationAcceptanceReceipt } = require('./s7-live-migration-receipts.js');

if (require.main === module) {
  try { run().then(result => { process.exitCode = result.exitCode; }).catch(error => { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 's7.live_migration_acceptance_failed', { error })) + '\n'); process.exitCode = 1; }); }
  catch (error) { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 's7.live_migration_acceptance_failed', { error })) + '\n'); process.exitCode = 1; }
}

module.exports = { openOfflineReadOnly, KIND, LIVE_MIGRATION_ACCEPTANCE_USAGE, REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES, REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES, SCHEMA_VERSION, legacyV1Checksum, parseLiveMigrationAcceptanceArgs, readJsonArtifact, removeCaptureRoot, run, validateS7LiveMigrationAcceptanceReceipt, verifyS7LiveMigrationAcceptance, writeJsonAtomicExclusive };
