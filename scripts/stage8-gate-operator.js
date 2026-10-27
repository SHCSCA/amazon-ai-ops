const { EXPECTED_REPORT_TYPES } = require('./verify-s7-continuous-operation');
const { EXPORT_SEQUENCE, LEDGER_KIND, LEDGER_SCHEMA_VERSION, PACKAGE_EVIDENCE_OPTIONS, REQUIRED_TABLES, parseArgs, stableRef } = require('./stage8-operator-contracts.js');
const { buildOrchestrationPlan, diagnose, inspectOpenedDatabase } = require('./stage8-operator-inspection.js');
const { inspectContinuous, reportMatrix } = require('./stage8-operator-continuous.js');
const { inspectImmutableSnapshotStoreGate, executeFormalExports } = require('./stage8-operator-execution.js');
const { inspectSchema, migrationContract } = require('./stage8-operator-schema.js');
const { inspectStores } = require('./stage8-operator-stores.js');
const { publicCanaryCandidates, rawCanaryCandidates } = require('./stage8-operator-canaries.js');
const { run, writeAtomicLedger } = require('./stage8-operator-publication.js');
const { validateExecuteInputs, deepFormalPreflight } = require('./stage8-operator-preflight.js');
if (require.main === module) {
  const report = error => { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'stage8.operator.failed', { error })) + '\n'); process.exitCode = 1; };
  run().then(result => { process.exitCode = result.exitCode; }).catch(error => { report(error); });
}

module.exports = { EXPECTED_REPORT_TYPES, EXPORT_SEQUENCE, LEDGER_KIND, LEDGER_SCHEMA_VERSION, PACKAGE_EVIDENCE_OPTIONS, REQUIRED_TABLES, buildOrchestrationPlan, diagnose, inspectContinuous, inspectImmutableSnapshotStoreGate, inspectOpenedDatabase, inspectSchema, inspectStores, migrationContract, parseArgs, publicCanaryCandidates, reportMatrix, rawCanaryCandidates, run, stableRef, validateExecuteInputs, deepFormalPreflight, executeFormalExports, writeAtomicLedger };
