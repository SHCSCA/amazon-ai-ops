// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_TABLES, ROOT, getTargetMigrationVersion, fail } = require('./production-authority-selection-contracts.js');
const { inspectStoreProviderIdentityV11Schema } = require('./production-authority-selection-schema.js');

const { getMigrationPlan, readMigrationMetadataSource } = require('./migration-contract-source');

function migrationContract(migrationsRoot = path.join(ROOT, 'packages', 'local-db', 'src', 'sqlite', 'migrations')) {
    return getMigrationPlan({ migrationsRoot, targetVersion: getTargetMigrationVersion() }).migrations;
}

function legacyV1Checksum(migrationsRoot = path.join(ROOT, 'packages', 'local-db', 'src', 'sqlite', 'migrations')) {
    const source = readMigrationMetadataSource(path.join(migrationsRoot, '0001-store-authority.ts'));
    const match = source.match(/export const LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM = '([^']+)';/);
    if (!match)
        fail('Could not read the explicit legacy v1 migration checksum contract.');
    return match[1];
}

function migrationV1ChecksumWhitelist(contract = migrationContract()) {
    if (!Array.isArray(contract) || contract[0]?.version !== 1) {
        fail('Production migration v1 checksum policy requires a complete migration contract.');
    }
    return new Set([contract[0].checksum, legacyV1Checksum()]);
}

function migrationRowsMatchProductionContract(actual, expected = migrationContract(), allowedV1Checksums = migrationV1ChecksumWhitelist(expected)) {
    return Array.isArray(actual)
        && actual.length === expected.length
        && actual.every((row, index) => (Number(row?.version) === expected[index].version
            && String(row?.name ?? '') === expected[index].name
            && (expected[index].version === 1
                ? allowedV1Checksums.has(String(row?.checksum ?? ''))
                : String(row?.checksum ?? '') === expected[index].checksum)
            && String(row?.status ?? '').toLowerCase() === 'applied'));
}

function migrationInspection(database, tables, contract = migrationContract()) {
    if (!tables.has('schema_migrations')) {
        const presentTargetTables = REQUIRED_TABLES.filter((name) => name !== 'schema_migrations' && tables.has(name));
        const cleanV0 = presentTargetTables.length === 0;
        return {
            family: cleanV0
                ? 'PRE_SCHEMA_MIGRATIONS'
                : 'PARTIAL_SCHEMA_WITHOUT_MIGRATION_LEDGER',
            state: cleanV0 ? 'MIGRATION_REQUIRED' : 'RECOVERY_REQUIRED',
            tablePresent: false,
            cleanV0,
            presentTargetTables,
            columns: [],
            recordedVersions: [],
            appliedVersions: [],
            highestVersion: 0,
            highestAppliedVersion: 0,
            targetVersion: contract.at(-1)?.version,
            targetReady: false,
        };
    }
    const columns = database.prepare('PRAGMA table_info("schema_migrations")')
        .all()
        .map((row) => String(row.name));
    if (!columns.includes('version')) {
        return {
            family: 'UNRECOGNIZED_SCHEMA_MIGRATIONS',
            state: 'RECOVERY_REQUIRED',
            tablePresent: true,
            columns,
            recordedVersions: [],
            appliedVersions: [],
            highestVersion: null,
            highestAppliedVersion: null,
            targetVersion: contract.at(-1)?.version,
            targetReady: false,
        };
    }
    const hasStatus = columns.includes('status');
    const hasName = columns.includes('name');
    const hasChecksum = columns.includes('checksum');
    const fields = [
        'version',
        hasName ? 'name' : 'NULL AS name',
        hasChecksum ? 'checksum' : 'NULL AS checksum',
        hasStatus ? 'status' : 'NULL AS status',
    ];
    const rows = database.prepare(`SELECT ${fields.join(', ')} FROM schema_migrations ORDER BY version`).all();
    const normalizedRows = rows.map((row) => ({
        version: Number(row.version),
        name: hasName ? String(row.name ?? '') : null,
        checksum: hasChecksum ? String(row.checksum ?? '') : null,
        status: hasStatus ? String(row.status ?? '').toLowerCase() : null,
    }));
    const invalidVersionCount = normalizedRows.filter((row) => !Number.isInteger(row.version) || row.version < 1).length;
    if (invalidVersionCount > 0) {
        return {
            family: 'UNRECOGNIZED_SCHEMA_MIGRATIONS',
            state: 'RECOVERY_REQUIRED',
            tablePresent: true,
            columns,
            recordedVersions: [],
            appliedVersions: [],
            highestVersion: null,
            highestAppliedVersion: null,
            invalidVersionCount,
            targetVersion: contract.at(-1)?.version,
            targetReady: false,
        };
    }
    const recordedVersions = [...new Set(normalizedRows.map((row) => row.version))]
        .sort((left, right) => left - right);
    const appliedVersions = hasStatus
        ? [...new Set(normalizedRows
                .filter((row) => row.status === 'applied')
                .map((row) => row.version))]
            .sort((left, right) => left - right)
        : [];
    const currentColumns = ['version', 'name', 'checksum', 'status', 'result_json', 'manifest_json'];
    const family = hasStatus && currentColumns.every((column) => columns.includes(column))
        ? 'S7_SCHEMA_MIGRATIONS'
        : 'LEGACY_SCHEMA_MIGRATIONS';
    const rowsByVersion = new Map(normalizedRows.map((row) => [row.version, row]));
    const duplicateVersions = normalizedRows.length !== rowsByVersion.size;
    const allowedV1Checksums = migrationV1ChecksumWhitelist(contract);
    const migrations = contract.map((expected) => {
        const actual = rowsByVersion.get(expected.version);
        const status = actual
            && actual.status === 'applied'
            && actual.name === expected.name
            && (expected.version === 1
                ? allowedV1Checksums.has(actual.checksum)
                : actual.checksum === expected.checksum)
            ? 'APPLIED'
            : actual
                ? 'MISMATCH'
                : 'MISSING';
        return { version: expected.version, status };
    });
    const extraVersions = recordedVersions.filter((version) => !contract.some((expected) => expected.version === version));
    const ledgerTargetReady = !duplicateVersions
        && extraVersions.length === 0
        && migrations.every((row) => row.status === 'APPLIED');
    const upgradeFromV11 = family === 'S7_SCHEMA_MIGRATIONS'
        && migrationRowsMatchProductionContract(normalizedRows, contract.filter((row) => row.version <= 11), allowedV1Checksums);
    const v11Schema = (ledgerTargetReady || upgradeFromV11)
        ? inspectStoreProviderIdentityV11Schema(database)
        : null;
    const targetReady = ledgerTargetReady && v11Schema?.passed === true;
    return {
        family,
        state: targetReady ? 'READY'
            : upgradeFromV11 && v11Schema?.passed === true ? 'MIGRATION_REQUIRED' : 'RECOVERY_REQUIRED',
        tablePresent: true,
        columns,
        recordedVersions,
        appliedVersions,
        highestVersion: recordedVersions.at(-1) ?? 0,
        highestAppliedVersion: appliedVersions.at(-1) ?? 0,
        targetVersion: contract.at(-1)?.version,
        targetReady,
        duplicateVersions,
        extraVersions,
        migrations,
        ledgerTargetReady,
        v11Schema,
    };
}

module.exports = { readMigrationMetadataSource, migrationContract, legacyV1Checksum, migrationV1ChecksumWhitelist, migrationRowsMatchProductionContract, migrationInspection };
