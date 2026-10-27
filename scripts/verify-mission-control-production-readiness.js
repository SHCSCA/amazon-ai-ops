const { EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, AUTHORITY_SNAPSHOT_BACKUP_METHOD, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, EXECUTION_CANARY_KIND, EXECUTION_CANARY_SCHEMA_VERSION, GATE_SPECS, OUTPUT_KIND, OUTPUT_SCHEMA_VERSION, S7_CONTINUOUS_OPERATION_KIND, S7_CONTINUOUS_OPERATION_SCHEMA_VERSION, V15_GATE_IDS, V15_SUPERSEDED_GATE_ID, V15_SUPERSEDING_GATE_IDS, parseArgs } = require('./mission-control-production-contracts.js');
const { buildReport } = require('./mission-control-production-report.js');
const { deterministicExecutionArtifactPath, deterministicExecutionArtifactRef, verifyExecutionCanaryLineage } = require('./mission-control-production-canary-artifacts.js');
const { isUsBusinessDate, validateContinuousOperation } = require('./mission-control-production-continuous.js');
const { run } = require('./mission-control-production-publication.js');
const { validateAuthoritySnapshotManifest } = require('./mission-control-production-authority.js');
const { validateExecutionCanary } = require('./mission-control-production-canary.js');
const { validatePackageAdversarialNodeEnv, validatePackageLaunch, validatePackageSecurity, validatePackageUi, validateV15FinalReadiness } = require('./mission-control-production-package.js');

if (require.main === module) {
  try { process.exitCode = run().exitCode; }
  catch (error) { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'mission_control.production_readiness_failed', { error })) + '\n'); process.exitCode = 1; }
}

module.exports = { EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, AUTHORITY_SNAPSHOT_BACKUP_METHOD, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, EXECUTION_CANARY_KIND, EXECUTION_CANARY_SCHEMA_VERSION, GATE_SPECS, OUTPUT_KIND, OUTPUT_SCHEMA_VERSION, S7_CONTINUOUS_OPERATION_KIND, S7_CONTINUOUS_OPERATION_SCHEMA_VERSION, V15_GATE_IDS, V15_SUPERSEDED_GATE_ID, V15_SUPERSEDING_GATE_IDS, buildReport, deterministicExecutionArtifactPath, deterministicExecutionArtifactRef, isUsBusinessDate, parseArgs, run, validateContinuousOperation, validateAuthoritySnapshotManifest, validateExecutionCanary, verifyExecutionCanaryLineage, validatePackageAdversarialNodeEnv, validatePackageLaunch, validatePackageSecurity, validatePackageUi, validateV15FinalReadiness };
