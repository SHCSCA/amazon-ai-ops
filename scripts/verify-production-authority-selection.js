const { KIND, PACKAGED_APP_NAME, SCHEMA_VERSION, TARGET_MIGRATION_VERSION, REQUIRED_TABLES, V11_STORE_PROVIDER_IDENTITY_COLUMNS, V11_STORE_PROVIDER_IDENTITY_INDEX, V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS, V11_STORE_PROVIDER_IDENTITY_TRIGGERS } = require('./production-authority-selection-contracts.js');
const { assertStoreProviderIdentityV11Schema, inspectStoreProviderIdentityV11Schema, storeProviderIdentityV11SchemaContract } = require('./production-authority-selection-schema.js');
const { assertSafeOutputPath, parseArgs, run, usage, writeJsonAtomicExclusive } = require('./production-authority-selection-publication.js');
const { inspectProductionAuthoritySelection } = require('./production-authority-selection-inspection.js');
const { legacyV1Checksum, migrationContract, migrationInspection, migrationRowsMatchProductionContract, migrationV1ChecksumWhitelist } = require('./production-authority-selection-migrations.js');

if (require.main === module) {
  run().then(result => { process.exitCode = result.exitCode; }).catch((error) => { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'production.authority.selection.failed', { error })) + '\n'); process.exitCode = 1; });
}

module.exports = { KIND, PACKAGED_APP_NAME, SCHEMA_VERSION, TARGET_MIGRATION_VERSION, REQUIRED_TABLES, V11_STORE_PROVIDER_IDENTITY_COLUMNS, V11_STORE_PROVIDER_IDENTITY_INDEX, V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS, V11_STORE_PROVIDER_IDENTITY_TRIGGERS, assertStoreProviderIdentityV11Schema, assertSafeOutputPath, inspectStoreProviderIdentityV11Schema, inspectProductionAuthoritySelection, legacyV1Checksum, migrationContract, migrationInspection, migrationRowsMatchProductionContract, migrationV1ChecksumWhitelist, parseArgs, run, storeProviderIdentityV11SchemaContract, usage, writeJsonAtomicExclusive };
