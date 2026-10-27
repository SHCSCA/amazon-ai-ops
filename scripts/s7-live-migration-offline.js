// 按职责复用原有严格校验，公共入口继续保持兼容。
const { TARGET_VERSION, collectRowCounts, evaluateBusinessRowPreservation, loadLocalDbRuntime, readAppliedVersion, requireSqlite, } = require('./migrate-current-user-db.js');
const { REQUIRED_TABLES, inspectStoreProviderIdentityV11Schema, legacyV1Checksum, migrationContract, migrationRowsMatchProductionContract, migrationV1ChecksumWhitelist, } = require('./verify-production-authority-selection.js');
const { assertCleanAbsolutePath, assertOfflineSidecarsAbsent, fileArtifact, normalizeSha256, openOfflineReadOnly, sameFileArtifact } = require('./s7-live-migration-artifacts.js');
const { addRequiredCheck, sameNumericRecord, samePath, stableJson } = require('./s7-live-migration-contracts.js');
const { normalizeMigrationRows } = require('./s7-live-migration-snapshot.js');

function verifyOfflineMigrationArtifacts(manifest, context, checks) {
    const sourcePath = assertCleanAbsolutePath(manifest.source?.path, 'Offline source database path');
    const workingPath = assertCleanAbsolutePath(manifest.workingDatabase?.path, 'Offline working database path');
    const restorePath = assertCleanAbsolutePath(manifest.restore?.destinationPath, 'Offline restored database path');
    addRequiredCheck(checks, 'OFFLINE_ARTIFACT_PATHS_DISTINCT', !samePath(sourcePath, workingPath)
        && !samePath(sourcePath, restorePath)
        && !samePath(workingPath, restorePath), 'offline source, working, and restored database paths must be distinct');
    assertOfflineSidecarsAbsent(workingPath, 'Offline working database');
    assertOfflineSidecarsAbsent(restorePath, 'Offline restored database');
    const workingArtifact = fileArtifact(workingPath, 'Offline working database');
    const restoreArtifact = fileArtifact(restorePath, 'Offline restored database');
    if (typeof context.afterOfflineWorkingArtifactHash === 'function') {
        context.afterOfflineWorkingArtifactHash({
            artifact: workingArtifact,
            path: workingPath,
        });
    }
    if (typeof context.afterOfflineRestoreArtifactHash === 'function') {
        context.afterOfflineRestoreArtifactHash({
            artifact: restoreArtifact,
            path: restorePath,
        });
    }
    assertOfflineSidecarsAbsent(workingPath, 'Offline working database');
    assertOfflineSidecarsAbsent(restorePath, 'Offline restored database');
    const workingArtifactForOpen = fileArtifact(workingPath, 'Offline working database before read-only open');
    const restoreArtifactForOpen = fileArtifact(restorePath, 'Offline restored database before read-only open');
    addRequiredCheck(checks, 'OFFLINE_WORKING_ARTIFACT_IDENTITY_BOUND', sameFileArtifact(workingArtifact, workingArtifactForOpen), 'working database identity, SHA-256, size, and mtime must remain stable before SQLite open');
    addRequiredCheck(checks, 'OFFLINE_RESTORE_ARTIFACT_IDENTITY_BOUND', sameFileArtifact(restoreArtifact, restoreArtifactForOpen), 'restored database identity, SHA-256, size, and mtime must remain stable before SQLite open');
    addRequiredCheck(checks, 'OFFLINE_WORKING_ARTIFACT_HASH_BOUND', workingArtifact.sha256 === normalizeSha256(manifest.workingDatabase?.upgradedSha256, 'Offline working upgraded SHA-256'), 'current working database SHA-256 must match the offline manifest');
    addRequiredCheck(checks, 'OFFLINE_RESTORE_ARTIFACT_HASH_BOUND', restoreArtifact.sha256 === normalizeSha256(manifest.restore?.sha256, 'Offline restored SHA-256'), 'current restored database SHA-256 must match the offline manifest');
    const working = openOfflineReadOnly(context.Database, workingArtifactForOpen.realPath);
    let workingSummary;
    try {
        const workingArtifactAfterOpen = fileArtifact(workingPath, 'Offline working database after read-only open');
        addRequiredCheck(checks, 'OFFLINE_WORKING_OPEN_IDENTITY_BOUND', sameFileArtifact(workingArtifactForOpen, workingArtifactAfterOpen), 'working database path identity and main-file hash must match the file opened read-only');
        working.pragma('query_only = ON');
        const queryOnly = Number(working.pragma('query_only', { simple: true })) === 1;
        const integrityCheck = working.pragma('integrity_check', { simple: true });
        const foreignKeyViolationCount = working.pragma('foreign_key_check').length;
        addRequiredCheck(checks, 'OFFLINE_WORKING_QUERY_ONLY_INTEGRITY', queryOnly && integrityCheck === 'ok' && foreignKeyViolationCount === 0, `queryOnly=${queryOnly}; integrity=${integrityCheck}; foreignKeyViolationCount=${foreignKeyViolationCount}`);
        const rawMigrationRows = working.prepare(`
      SELECT version, name, checksum, status
      FROM schema_migrations
      ORDER BY version
    `).all();
        const actualMigrations = normalizeMigrationRows(rawMigrationRows);
        const manifestMigrations = normalizeMigrationRows(Array.isArray(manifest.migrations) ? manifest.migrations : []);
        addRequiredCheck(checks, 'OFFLINE_WORKING_MIGRATIONS_CURRENT', migrationRowsMatchProductionContract(actualMigrations, context.migrationContract, context.allowedV1Checksums)
            && stableJson(actualMigrations) === stableJson(manifestMigrations), `migrationRecordCount=${actualMigrations.length}`);
        const workingRowCounts = collectRowCounts(working);
        const preservation = evaluateBusinessRowPreservation(working, manifest.source.tableRowCounts, workingRowCounts, manifest.source.listingMergeBaseline);
        addRequiredCheck(checks, 'OFFLINE_WORKING_ROW_PRESERVATION_BOUND', sameNumericRecord(workingRowCounts, manifest.workingDatabase?.tableRowCounts)
            && preservation.passed === true
            && preservation.failures.length === 0
            && stableJson(preservation) === stableJson(manifest.businessRowPreservation), `preservationFailureCount=${preservation.failures.length}`);
        const recovery = new context.runtime.StoreRepository(working)
            .getMigrationRecoveryPreflight(TARGET_VERSION);
        addRequiredCheck(checks, 'OFFLINE_WORKING_V9_RECOVERY_PREFLIGHT', recovery.canRestore === true
            && recovery.sourceVersion === manifest.source.version
            && recovery.targetVersion === TARGET_VERSION
            && recovery.backupIntegrityCheck === 'ok'
            && recovery.schemaFingerprintMatches === true
            && recovery.tableRowCountsMatch === true
            && Array.isArray(recovery.blockers)
            && recovery.blockers.length === 0, `canRestore=${recovery.canRestore}; blockerCount=${recovery.blockers?.length ?? -1}`);
        workingSummary = {
            path: workingArtifact.realPath,
            sha256: workingArtifact.sha256,
            sizeBytes: workingArtifact.sizeBytes,
            openedReadOnly: true,
            queryOnly,
            integrityCheck,
            foreignKeyViolationCount,
            migrationCount: actualMigrations.length,
            businessRowPreservationPassed: preservation.passed === true,
            recoveryCanRestore: recovery.canRestore === true,
        };
    }
    finally {
        working.close();
    }
    assertOfflineSidecarsAbsent(workingPath, 'Offline working database');
    const workingArtifactAfter = fileArtifact(workingPath, 'Offline working database after read-only verification');
    addRequiredCheck(checks, 'OFFLINE_WORKING_ARTIFACT_STABLE_AFTER_READ', sameFileArtifact(workingArtifact, workingArtifactAfter), 'working database identity, SHA-256, size, and mtime must remain unchanged after read-only verification');
    workingSummary = {
        ...workingSummary,
        path: workingArtifactAfter.realPath,
        identity: workingArtifactAfter.identity,
        sha256: workingArtifactAfter.sha256,
        sizeBytes: workingArtifactAfter.sizeBytes,
        mtimeMs: workingArtifactAfter.mtimeMs,
        sidecarsAbsentBeforeAndAfter: true,
    };
    const restored = openOfflineReadOnly(context.Database, restoreArtifactForOpen.realPath);
    let restoreSummary;
    try {
        const restoreArtifactAfterOpen = fileArtifact(restorePath, 'Offline restored database after read-only open');
        addRequiredCheck(checks, 'OFFLINE_RESTORE_OPEN_IDENTITY_BOUND', sameFileArtifact(restoreArtifactForOpen, restoreArtifactAfterOpen), 'restored database path identity and main-file hash must match the file opened read-only');
        restored.pragma('query_only = ON');
        const queryOnly = Number(restored.pragma('query_only', { simple: true })) === 1;
        const integrityCheck = restored.pragma('integrity_check', { simple: true });
        addRequiredCheck(checks, 'OFFLINE_RESTORE_QUERY_ONLY_INTEGRITY', queryOnly && integrityCheck === 'ok', `queryOnly=${queryOnly}; integrity=${integrityCheck}`);
        const restoredVersion = readAppliedVersion(restored);
        const restoredRowCounts = collectRowCounts(restored);
        addRequiredCheck(checks, 'OFFLINE_RESTORE_SOURCE_BASELINE_BOUND', restoredVersion === manifest.source.version
            && sameNumericRecord(restoredRowCounts, manifest.source.tableRowCounts)
            && sameNumericRecord(restoredRowCounts, manifest.restore?.tableRowCounts), `sourceVersion=${manifest.source.version}; restoredVersion=${restoredVersion}`);
        restoreSummary = {
            path: restoreArtifact.realPath,
            sha256: restoreArtifact.sha256,
            sizeBytes: restoreArtifact.sizeBytes,
            openedReadOnly: true,
            queryOnly,
            integrityCheck,
            version: restoredVersion,
            sourceBaselineRowsMatch: true,
        };
    }
    finally {
        restored.close();
    }
    assertOfflineSidecarsAbsent(restorePath, 'Offline restored database');
    const restoreArtifactAfter = fileArtifact(restorePath, 'Offline restored database after read-only verification');
    addRequiredCheck(checks, 'OFFLINE_RESTORE_ARTIFACT_STABLE_AFTER_READ', sameFileArtifact(restoreArtifact, restoreArtifactAfter), 'restored database identity, SHA-256, size, and mtime must remain unchanged after read-only verification');
    restoreSummary = {
        ...restoreSummary,
        path: restoreArtifactAfter.realPath,
        identity: restoreArtifactAfter.identity,
        sha256: restoreArtifactAfter.sha256,
        sizeBytes: restoreArtifactAfter.sizeBytes,
        mtimeMs: restoreArtifactAfter.mtimeMs,
        sidecarsAbsentBeforeAndAfter: true,
    };
    return {
        pathsDistinct: true,
        working: workingSummary,
        restore: restoreSummary,
    };
}

module.exports = { verifyOfflineMigrationArtifacts };
