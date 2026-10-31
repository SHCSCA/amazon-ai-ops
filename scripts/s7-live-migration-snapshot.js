// 按职责复用原有严格校验，公共入口继续保持兼容。
const { getTargetVersion, collectRowCounts, evaluateBusinessRowPreservation, loadLocalDbRuntime, readAppliedVersion, requireSqlite, } = require('./migrate-current-user-db.js');
const { REQUIRED_TABLES, inspectStoreProviderIdentityV11Schema, legacyV1Checksum, migrationContract, migrationRowsMatchProductionContract, migrationV1ChecksumWhitelist, } = require('./verify-production-authority-selection.js');
const { fileArtifact, normalizeSha256, readJsonArtifact } = require('./s7-live-migration-artifacts.js');
const { addRequiredCheck, fail, samePath, stableJson } = require('./s7-live-migration-contracts.js');

function tableNames(database) {
    return new Set(database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all().map((row) => String(row.name)));
}

function normalizeMigrationRows(rows) {
    return rows.map((row) => ({
        version: Number(row.version),
        name: String(row.name ?? ''),
        checksum: String(row.checksum ?? ''),
        status: String(row.status ?? '').toLowerCase(),
    }));
}

function validateUpgradeBackup(database, databaseArtifact, offlineManifest, targetMigrationRow, context, checks) {
    let migrationManifest;
    try {
        migrationManifest = JSON.parse(String(targetMigrationRow.manifestJson ?? ''));
    }
    catch {
        fail(`LIVE_V9_UPGRADE_BACKUP_EMBEDDED: migration ${getTargetVersion()} manifest_json is malformed.`);
    }
    const upgradeBackup = migrationManifest?.upgradeBackup;
    const targetContract = context.migrationContract.find((migration) => migration.version === getTargetVersion());
    const fixedBackupPath = `${databaseArtifact.realPath}.pre-upgrade-to-v${getTargetVersion()}.bak`;
    const fixedManifestPath = `${databaseArtifact.realPath}.pre-upgrade-to-v${getTargetVersion()}.manifest.json`;
    addRequiredCheck(checks, 'LIVE_V9_UPGRADE_BACKUP_EMBEDDED', upgradeBackup?.kind === 'schema-upgrade-backup'
        && upgradeBackup?.schemaVersion === 1
        && ['created', 'reused'].includes(upgradeBackup?.status)
        && upgradeBackup?.targetVersion === getTargetVersion()
        && upgradeBackup?.targetName === targetContract?.name
        && upgradeBackup?.targetChecksum === targetContract?.checksum, `migration ${getTargetVersion()} must embed the current recoverable schema-upgrade-backup contract`);
    addRequiredCheck(checks, 'LIVE_V9_UPGRADE_BACKUP_PATHS_BOUND', samePath(upgradeBackup.databasePath, databaseArtifact.realPath)
        && samePath(upgradeBackup.backupPath, fixedBackupPath)
        && samePath(upgradeBackup.manifestPath, fixedManifestPath), 'upgrade database, backup, and manifest paths must be canonical fixed adjacent live-db paths');
    addRequiredCheck(checks, 'LIVE_V9_UPGRADE_BACKUP_SOURCE_BOUND', upgradeBackup.sourceVersion === offlineManifest.source.version, 'upgrade backup sourceVersion must equal the offline source version');
    const backupArtifact = fileArtifact(fixedBackupPath, `Migration ${getTargetVersion()} upgrade backup`);
    const sidecarManifest = readJsonArtifact(fixedManifestPath, `Migration ${getTargetVersion()} upgrade backup manifest`);
    addRequiredCheck(checks, 'LIVE_V9_UPGRADE_BACKUP_MANIFEST_MATCH', sameUpgradeBackupContract(upgradeBackup, sidecarManifest.value), `embedded migration ${getTargetVersion()} upgradeBackup must match its adjacent manifest contract`);
    const repository = new context.runtime.StoreRepository(database);
    const preflight = repository.getMigrationRecoveryPreflight(getTargetVersion());
    const expectedBackupSha256 = normalizeSha256(upgradeBackup.sha256, 'Embedded upgrade backup SHA-256');
    addRequiredCheck(checks, 'LIVE_V9_RECOVERY_PREFLIGHT_CAN_RESTORE', preflight.canRestore === true
        && Array.isArray(preflight.blockers)
        && preflight.blockers.length === 0
        && preflight.version === getTargetVersion()
        && preflight.targetVersion === getTargetVersion()
        && preflight.sourceVersion === offlineManifest.source.version, `StoreRepository recovery preflight must allow restore for the bound v${getTargetVersion()} backup`);
    addRequiredCheck(checks, 'LIVE_V9_RECOVERY_BACKUP_SHA_INTEGRITY', preflight.backupIntegrityCheck === 'ok'
        && normalizeSha256(preflight.backupSha256, 'Recovery preflight backup SHA-256') === expectedBackupSha256
        && backupArtifact.sha256 === expectedBackupSha256
        && Number(upgradeBackup.sizeBytes) === backupArtifact.sizeBytes, 'backup SHA-256, size, and integrity must match the embedded manifest');
    addRequiredCheck(checks, 'LIVE_V9_RECOVERY_SCHEMA_ROWS', preflight.schemaFingerprintMatches === true
        && preflight.tableRowCountsMatch === true, 'backup schema fingerprint and table row counts must match the embedded manifest');
    return {
        sourceVersion: preflight.sourceVersion,
        targetVersion: preflight.targetVersion,
        backupPath: backupArtifact.realPath,
        backupSha256: backupArtifact.sha256,
        backupSizeBytes: backupArtifact.sizeBytes,
        manifestPath: sidecarManifest.artifact.realPath,
        manifestSha256: sidecarManifest.artifact.sha256,
        backupIntegrityCheck: preflight.backupIntegrityCheck,
        schemaFingerprintMatches: preflight.schemaFingerprintMatches === true,
        tableRowCountsMatch: preflight.tableRowCountsMatch === true,
        embeddedManifestMatchesAdjacentFile: true,
        canRestore: preflight.canRestore === true,
        blockerCount: preflight.blockers.length,
    };
}

function sameUpgradeBackupContract(embedded, adjacent) {
    if (!embedded || !adjacent || typeof embedded !== 'object' || typeof adjacent !== 'object') {
        return false;
    }
    if (!['created', 'reused'].includes(embedded.status)
        || adjacent.status !== 'created') {
        return false;
    }
    const normalize = (value) => {
        const copy = { ...value };
        delete copy.status;
        return stableJson(copy);
    };
    return normalize(embedded) === normalize(adjacent);
}

function inspectLogicalSnapshot(snapshotPath, databaseArtifact, offlineManifest, context, checks) {
    const Database = context.Database;
    const database = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    try {
        database.pragma('query_only = ON');
        addRequiredCheck(checks, 'LIVE_LOGICAL_SNAPSHOT_QUERY_ONLY', Number(database.pragma('query_only', { simple: true })) === 1, 'logical snapshot must be opened readonly with PRAGMA query_only=ON');
        const integrityCheck = database.pragma('integrity_check', { simple: true });
        const foreignKeyViolationCount = database.pragma('foreign_key_check').length;
        addRequiredCheck(checks, 'LIVE_LOGICAL_SNAPSHOT_INTEGRITY', integrityCheck === 'ok' && foreignKeyViolationCount === 0, `integrity=${integrityCheck}; foreignKeyViolationCount=${foreignKeyViolationCount}`);
        const tables = tableNames(database);
        const missingTables = context.requiredTables.filter((table) => !tables.has(table));
        addRequiredCheck(checks, 'LIVE_REQUIRED_TABLES_PRESENT', missingTables.length === 0, `missingTableCount=${missingTables.length}`);
        const rawMigrationRows = database.prepare(`
      SELECT version, name, checksum, status, manifest_json AS manifestJson
      FROM schema_migrations
      ORDER BY version
    `).all();
        const normalizedRows = normalizeMigrationRows(rawMigrationRows);
        addRequiredCheck(checks, 'LIVE_MIGRATIONS_1_TO_9_CURRENT', migrationRowsMatchProductionContract(normalizedRows, context.migrationContract, context.allowedV1Checksums), `migrationRecordCount=${normalizedRows.length}`);
        const v11Schema = inspectStoreProviderIdentityV11Schema(database);
        addRequiredCheck(checks, 'LIVE_V11_STORE_PROVIDER_IDENTITY_SCHEMA_CURRENT', v11Schema.passed === true, v11Schema.passed
            ? '3 columns, one unique partial index, and all 6 authority triggers match v11'
            : v11Schema.violations.join('; '));
        const liveRowCounts = collectRowCounts(database);
        const preservation = evaluateBusinessRowPreservation(database, offlineManifest.source.tableRowCounts, liveRowCounts, offlineManifest.source.listingMergeBaseline);
        addRequiredCheck(checks, 'LIVE_BUSINESS_ROWS_PRESERVED', preservation.passed === true && preservation.failures.length === 0, `failureCount=${preservation.failures.length}`);
        const targetMigrationRow = rawMigrationRows.find((row) => Number(row.version) === getTargetVersion());
        const recovery = validateUpgradeBackup(database, databaseArtifact, offlineManifest, targetMigrationRow, context, checks);
        return {
            integrityCheck,
            foreignKeyViolationCount,
            migrationCount: normalizedRows.length,
            requiredTableCount: context.requiredTables.length,
            businessRowPreservation: {
                passed: preservation.passed === true,
                failureCount: preservation.failures.length,
                listingCurrentToHistoryTransferApplied: preservation.listingCurrentToHistoryTransfer.applied === true,
                listingCurrentToHistoryTransferPassed: preservation.listingCurrentToHistoryTransfer.passed === true,
            },
            recovery,
        };
    }
    finally {
        database.close();
    }
}

module.exports = { tableNames, normalizeMigrationRows, validateUpgradeBackup, sameUpgradeBackupContract, inspectLogicalSnapshot };
