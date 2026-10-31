// 按职责复用原有严格校验，公共入口继续保持兼容。
const { getTargetVersion, collectRowCounts, evaluateBusinessRowPreservation, loadLocalDbRuntime, readAppliedVersion, requireSqlite, } = require('./migrate-current-user-db.js');
const { REQUIRED_TABLES, inspectStoreProviderIdentityV11Schema, legacyV1Checksum, migrationContract, migrationRowsMatchProductionContract, migrationV1ChecksumWhitelist, } = require('./verify-production-authority-selection.js');
const { CURRENTNESS_METHOD, SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION, runReadonlySqliteOnlineBackupSync, } = require('./sqlite-authority-currentness.js');
const { normalizeSha256 } = require('./s7-live-migration-artifacts.js');
const { AUTHORITY_SELECTION_KIND, AUTHORITY_SELECTION_SCHEMA_VERSION, KIND, MIGRATION_VERIFICATION_KIND, MIGRATION_VERIFICATION_SCHEMA_VERSION, OFFLINE_MIGRATION_KIND, OFFLINE_MIGRATION_SCHEMA_VERSION, REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES, REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES, SCHEMA_VERSION, addRequiredCheck, fail, hasExactKeys, isCleanAbsolutePath, isListingMergeBaseline, isNumericRowCountRecord, isSha256, requireAcceptanceArtifact, requireAcceptanceOfflineArtifact, requireExactKeys, samePath, stableJson } = require('./s7-live-migration-contracts.js');

function validateS7LiveMigrationAcceptanceReceipt(receipt, targetVersion = getTargetVersion()) {
    if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) {
        fail('Live migration acceptance target version is invalid.');
    }
    requireExactKeys(receipt, [
        'kind',
        'schemaVersion',
        'generatedAt',
        'status',
        'passed',
        'formalEvidence',
        'authorityDatabaseMutated',
        'adsExecutionInvoked',
        'inputs',
        'checks',
        'summary',
        'safety',
    ], 'Live migration acceptance receipt');
    const generatedAt = new Date(receipt.generatedAt);
    if (receipt.kind !== KIND
        || receipt.schemaVersion !== SCHEMA_VERSION
        || receipt.status !== 'PASSED'
        || receipt.passed !== true
        || receipt.formalEvidence !== true
        || receipt.authorityDatabaseMutated !== false
        || receipt.adsExecutionInvoked !== false
        || !Number.isFinite(generatedAt.valueOf())
        || generatedAt.toISOString() !== receipt.generatedAt) {
        fail('Live migration acceptance receipt top-level contract is invalid.');
    }
    requireExactKeys(receipt.inputs, ['database', 'authoritySelection', 'migrationManifest', 'migrationVerification'], 'Live migration acceptance inputs');
    requireExactKeys(receipt.inputs.database, [
        'path',
        'realPath',
        'sha256',
        'sizeBytes',
        'logicalSnapshotSha256',
        'logicalSnapshotSizeBytes',
    ], 'Live migration acceptance database');
    if (!isCleanAbsolutePath(receipt.inputs.database.path)
        || !isCleanAbsolutePath(receipt.inputs.database.realPath)
        || !isSha256(receipt.inputs.database.sha256)
        || !Number.isSafeInteger(receipt.inputs.database.sizeBytes)
        || receipt.inputs.database.sizeBytes < 1
        || !isSha256(receipt.inputs.database.logicalSnapshotSha256)
        || !Number.isSafeInteger(receipt.inputs.database.logicalSnapshotSizeBytes)
        || receipt.inputs.database.logicalSnapshotSizeBytes < 1) {
        fail('Live migration acceptance database proof is invalid.');
    }
    requireAcceptanceArtifact(receipt.inputs.authoritySelection, 'Live migration acceptance authority selection');
    requireAcceptanceArtifact(receipt.inputs.migrationManifest, 'Live migration acceptance migration manifest');
    requireAcceptanceArtifact(receipt.inputs.migrationVerification, 'Live migration acceptance migration verification');
    const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
    const checkCodes = checks.map((check) => check?.code);
    const uniqueCodes = new Set(checkCodes);
    if (checks.length !== REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.length
        || uniqueCodes.size !== checks.length
        || stableJson(checkCodes) !== stableJson(REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES)
        || checks.some((check) => !hasExactKeys(check, ['code', 'passed', 'detail'])
            || check.passed !== true
            || typeof check.detail !== 'string'
            || check.detail.length === 0)) {
        fail('Live migration acceptance must contain the exact complete, unique, all-passed check set.');
    }
    const summary = receipt.summary;
    requireExactKeys(summary, [
        'total',
        'passed',
        'failed',
        'integrityCheck',
        'foreignKeyViolationCount',
        'migrationCount',
        'requiredTableCount',
        'offlineArtifacts',
        'businessRowPreservation',
        'recovery',
    ], 'Live migration acceptance summary');
    if (summary.total !== checks.length
        || summary.passed !== checks.length
        || summary.failed !== 0
        || summary.integrityCheck !== 'ok'
        || summary.foreignKeyViolationCount !== 0
        || summary.migrationCount !== targetVersion
        || summary.requiredTableCount !== REQUIRED_TABLES.length) {
        fail('Live migration acceptance summary does not match the complete passed proof.');
    }
    requireExactKeys(summary.offlineArtifacts, ['pathsDistinct', 'working', 'restore'], 'Live migration acceptance offline artifacts');
    if (summary.offlineArtifacts.pathsDistinct !== true) {
        fail('Live migration acceptance offline artifact paths are not distinct.');
    }
    requireAcceptanceOfflineArtifact(summary.offlineArtifacts.working, 'Live migration acceptance offline working artifact', 'working', targetVersion);
    requireAcceptanceOfflineArtifact(summary.offlineArtifacts.restore, 'Live migration acceptance offline restore artifact', 'restore', targetVersion);
    requireExactKeys(summary.businessRowPreservation, [
        'passed',
        'failureCount',
        'listingCurrentToHistoryTransferApplied',
        'listingCurrentToHistoryTransferPassed',
    ], 'Live migration acceptance business-row preservation');
    if (summary.businessRowPreservation.passed !== true
        || summary.businessRowPreservation.failureCount !== 0
        || typeof summary.businessRowPreservation.listingCurrentToHistoryTransferApplied !== 'boolean'
        || summary.businessRowPreservation.listingCurrentToHistoryTransferPassed !== true) {
        fail('Live migration acceptance business-row preservation proof is invalid.');
    }
    requireExactKeys(summary.recovery, [
        'sourceVersion',
        'targetVersion',
        'backupPath',
        'backupSha256',
        'backupSizeBytes',
        'manifestPath',
        'manifestSha256',
        'backupIntegrityCheck',
        'schemaFingerprintMatches',
        'tableRowCountsMatch',
        'embeddedManifestMatchesAdjacentFile',
        'canRestore',
        'blockerCount',
    ], 'Live migration acceptance recovery');
    if (!Number.isInteger(summary.recovery.sourceVersion)
        || summary.recovery.sourceVersion < 0
        || summary.recovery.sourceVersion >= targetVersion
        || summary.recovery.targetVersion !== targetVersion
        || !isCleanAbsolutePath(summary.recovery.backupPath)
        || !isSha256(summary.recovery.backupSha256)
        || !Number.isSafeInteger(summary.recovery.backupSizeBytes)
        || summary.recovery.backupSizeBytes < 1
        || !isCleanAbsolutePath(summary.recovery.manifestPath)
        || !isSha256(summary.recovery.manifestSha256)
        || summary.recovery.backupIntegrityCheck !== 'ok'
        || summary.recovery.schemaFingerprintMatches !== true
        || summary.recovery.tableRowCountsMatch !== true
        || summary.recovery.embeddedManifestMatchesAdjacentFile !== true
        || summary.recovery.canRestore !== true
        || summary.recovery.blockerCount !== 0) {
        fail('Live migration acceptance recovery proof is invalid.');
    }
    requireExactKeys(receipt.safety, [
        'liveDatabaseAccess',
        'liveDatabaseOpenedReadOnly',
        'liveDatabaseQueryOnly',
        'logicalSnapshotInspectedReadOnly',
        'walAwareSnapshotProofCount',
        'authorityDatabaseMutated',
        'adsExecutionInvoked',
        'businessRowContentIncluded',
        'rawSecretsIncluded',
    ], 'Live migration acceptance safety');
    if (receipt.safety.liveDatabaseAccess !== CURRENTNESS_METHOD
        || receipt.safety.liveDatabaseOpenedReadOnly !== true
        || receipt.safety.liveDatabaseQueryOnly !== true
        || receipt.safety.logicalSnapshotInspectedReadOnly !== true
        || receipt.safety.walAwareSnapshotProofCount !== 2
        || receipt.safety.authorityDatabaseMutated !== false
        || receipt.safety.adsExecutionInvoked !== false
        || receipt.safety.businessRowContentIncluded !== false
        || receipt.safety.rawSecretsIncluded !== false) {
        fail('Live migration acceptance safety proof is invalid.');
    }
    return receipt;
}

function validateAuthoritySelection(selection, databaseArtifact, migrationManifest, checks) {
    addRequiredCheck(checks, 'AUTHORITY_SELECTION_SCHEMA_BOUND', selection.kind === AUTHORITY_SELECTION_KIND
        && selection.schemaVersion === AUTHORITY_SELECTION_SCHEMA_VERSION, 'authority selection must use production-authority-selection-preflight/v1');
    const selected = selection.selection?.selected;
    addRequiredCheck(checks, 'AUTHORITY_SELECTION_PATH_BOUND', samePath(selection.selection?.expectedDatabasePath, databaseArtifact.realPath)
        && samePath(selected?.absolutePath, databaseArtifact.realPath)
        && samePath(selected?.realPath, databaseArtifact.realPath), 'expected, selected, and real authority paths must equal the canonical --db path');
    addRequiredCheck(checks, 'AUTHORITY_SELECTION_PRE_MIGRATION_STATE', selection.status === 'SELECTED_MIGRATION_REQUIRED'
        && selection.formalEvidence === false
        && selected?.role === 'selected'
        && selected?.offlineMigrationEligible === true
        && selected?.sqlite?.state === 'MIGRATION_REQUIRED'
        && selected?.sqlite?.migration?.targetReady === false, 'selection must be the offline-eligible pre-migration authority preflight');
    addRequiredCheck(checks, 'AUTHORITY_SELECTION_READONLY_SAFETY', selection.authorityDatabaseMutated === false
        && selection.adsExecutionInvoked === false
        && selected?.sqlite?.openedReadOnly === true
        && selected?.sqlite?.queryOnly === true
        && selected?.logicalCapture?.method === CURRENTNESS_METHOD
        && selected?.logicalCapture?.source?.openedReadOnly === true
        && selected?.logicalCapture?.source?.queryOnly === true
        && selected?.sidecarObservation?.walAndJournalUnchanged === true, 'preflight must attest read-only SQLite inspection, no authority mutation, and no Ads execution');
    const sourceSha256 = normalizeSha256(migrationManifest.source?.sha256, 'Offline migration source SHA-256');
    addRequiredCheck(checks, 'PRE_MIGRATION_MAIN_SHA_BOUND', normalizeSha256(selection.selection?.expectedMainSha256, 'Authority selection expected main SHA-256') === sourceSha256
        && normalizeSha256(selected?.mainFileSha256, 'Authority selection selected main SHA-256') === sourceSha256, 'authority selection pre-main SHA-256 must equal the offline migration source SHA-256');
}

function validateOfflineMigrationManifest(manifest, databaseArtifact, checks) {
    addRequiredCheck(checks, 'OFFLINE_MIGRATION_SCHEMA_PASSED', manifest.kind === OFFLINE_MIGRATION_KIND
        && manifest.schemaVersion === OFFLINE_MIGRATION_SCHEMA_VERSION
        && manifest.passed === true, 'offline migration manifest must be s7-offline-db-upgrade schema v1 and passed');
    addRequiredCheck(checks, 'OFFLINE_MIGRATION_SOURCE_PATH_BOUND', samePath(manifest.source?.path, databaseArtifact.realPath), 'offline migration source.path must equal the canonical live --db path');
    addRequiredCheck(checks, 'OFFLINE_MIGRATION_TARGET_V9', manifest.targetVersion === getTargetVersion(), `offline migration targetVersion must be ${getTargetVersion()}`);
    addRequiredCheck(checks, 'OFFLINE_MIGRATION_SOURCE_BASELINE_VALID', Number.isInteger(manifest.source?.version)
        && manifest.source.version >= 0
        && manifest.source.version < getTargetVersion()
        && isNumericRowCountRecord(manifest.source?.tableRowCounts)
        && isListingMergeBaseline(manifest.source?.listingMergeBaseline), 'offline source version, tableRowCounts, and listingMergeBaseline must be valid');
    const sourceSha256 = normalizeSha256(manifest.source?.sha256, 'Offline migration source SHA-256');
    addRequiredCheck(checks, 'OFFLINE_MIGRATION_LEASE_BOUND', manifest.offlineLease?.method === 'windows-file-share-none'
        && manifest.offlineLease?.lockHeldThroughFinalPublish === true
        && isSha256(manifest.offlineLease?.sourceSha256)
        && normalizeSha256(manifest.offlineLease.sourceSha256, 'Offline lease source SHA-256') === sourceSha256
        && isSha256(manifest.offlineLease?.workingCopySha256)
        && normalizeSha256(manifest.offlineLease.workingCopySha256, 'Offline lease working-copy SHA-256') === sourceSha256, 'offline migration must be bound to the Windows FileShare.None lease through final publication');
    addRequiredCheck(checks, 'OFFLINE_MIGRATION_ARTIFACT_HASHES_BOUND', isCleanAbsolutePath(manifest.workingDatabase?.path)
        && isSha256(manifest.workingDatabase?.sourceCopySha256)
        && normalizeSha256(manifest.workingDatabase.sourceCopySha256, 'Working source-copy SHA-256') === sourceSha256
        && isSha256(manifest.workingDatabase?.upgradedSha256)
        && manifest.workingDatabase?.integrityCheck === 'ok'
        && manifest.workingDatabase?.foreignKeyViolationCount === 0
        && isCleanAbsolutePath(manifest.restore?.destinationPath)
        && isSha256(manifest.restore?.sha256)
        && manifest.restore?.version === manifest.source.version
        && manifest.restore?.integrityCheck === 'ok', 'working and restored artifacts must expose bound absolute paths, hashes, and integrity results');
    const migrationRows = Array.isArray(manifest.migrations) ? manifest.migrations : [];
    addRequiredCheck(checks, 'OFFLINE_MIGRATION_RECORDS_PRESERVATION_PASSED', migrationRows.length === getTargetVersion()
        && migrationRows.every((row, index) => Number(row?.version) === index + 1 && row?.status === 'applied')
        && manifest.businessRowPreservation?.passed === true
        && Array.isArray(manifest.businessRowPreservation?.failures)
        && manifest.businessRowPreservation.failures.length === 0
        && Array.isArray(manifest.preservationFailures)
        && manifest.preservationFailures.length === 0, `offline manifest must bind ${getTargetVersion()} applied migrations and a passed business-row preservation proof`);
}

function validateMigrationVerification(verification, verificationArtifact, migrationManifestArtifact, checks) {
    const verificationChecks = Array.isArray(verification.checks)
        ? verification.checks
        : [];
    const verificationCodes = verificationChecks.map((check) => check?.code);
    const requiredCodes = new Set(REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES);
    const uniqueCodes = new Set(verificationCodes);
    addRequiredCheck(checks, 'MIGRATION_VERIFICATION_SCHEMA_PASSED', verification.kind === MIGRATION_VERIFICATION_KIND
        && verification.schemaVersion === MIGRATION_VERIFICATION_SCHEMA_VERSION
        && verification.passed === true
        && verificationChecks.length === REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES.length
        && uniqueCodes.size === verificationChecks.length
        && verificationChecks.every((check) => check?.passed === true && requiredCodes.has(check?.code))
        && REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES.every((code) => uniqueCodes.has(code))
        && verification.summary?.total === verificationChecks.length
        && verification.summary?.passed === verificationChecks.length
        && verification.summary?.failed === 0, 'migration verification must contain the exact complete, unique, all-passed verifier check set and matching summary');
    addRequiredCheck(checks, 'MIGRATION_VERIFICATION_MANIFEST_BOUND', samePath(verification.sourceManifestPath, migrationManifestArtifact.realPath)
        && normalizeSha256(verification.sourceManifestSha256, 'Migration verification source manifest SHA-256') === migrationManifestArtifact.sha256, 'migration verification sourceManifestPath/SHA-256 must bind the supplied offline manifest');
    addRequiredCheck(checks, 'MIGRATION_VERIFICATION_INPUT_HASHED', /^[A-F0-9]{64}$/.test(verificationArtifact.sha256), 'migration verification input must have a valid SHA-256');
}

module.exports = { validateS7LiveMigrationAcceptanceReceipt, validateAuthoritySelection, validateOfflineMigrationManifest, validateMigrationVerification };
