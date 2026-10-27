const { AUTHORITY_SNAPSHOT_SCHEMA_VERSION, BACKUP_METHOD, CANARY_MAX_AGE_MS, EXECUTION_SLOTS } = require('./execution-canary-export-contracts.js');
const { buildExecutionCanaryEvidence } = require('./execution-canary-export-evidence.js');
const { exportExecutionCanaryEvidence, run } = require('./execution-canary-export-publication.js');
const { parseOptions } = require('./execution-canary-export-options.js');

if (require.main === module) {
  try { process.exitCode = run().exitCode; }
  catch (error) { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'mission_control.execution_canary_export_failed', { error })) + '\n'); process.exitCode = 1; }
}

module.exports = { AUTHORITY_SNAPSHOT_SCHEMA_VERSION, BACKUP_METHOD, CANARY_MAX_AGE_MS, EXECUTION_SLOTS, buildExecutionCanaryEvidence, exportExecutionCanaryEvidence, parseOptions, run };
