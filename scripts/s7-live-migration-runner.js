// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TARGET_VERSION, collectRowCounts, evaluateBusinessRowPreservation, loadLocalDbRuntime, readAppliedVersion, requireSqlite, } = require('./migrate-current-user-db.js');
const { REQUIRED_TABLES, inspectStoreProviderIdentityV11Schema, legacyV1Checksum, migrationContract, migrationRowsMatchProductionContract, migrationV1ChecksumWhitelist, } = require('./verify-production-authority-selection.js');
const { CURRENTNESS_METHOD, SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION, runReadonlySqliteOnlineBackupSync, } = require('./sqlite-authority-currentness.js');
const { assertCleanAbsolutePath, assertDirectExistingPath, assertOutputAvailable, entryExists, fileArtifact, normalizeSha256, readJsonArtifact, sameMainArtifact } = require('./s7-live-migration-artifacts.js');
const { createCaptureRoot, recordCaptureArtifact, recordExistingCaptureArtifacts, removeCaptureRoot } = require('./s7-live-migration-capture.js');
const { CAPTURE_FILE_NAMES, KIND, LIVE_MIGRATION_ACCEPTANCE_USAGE, REQUIRED_OPTIONS, SCHEMA_VERSION, SINGLE_VALUE_OPTIONS, addRequiredCheck, fail } = require('./s7-live-migration-contracts.js');
const { verifyOfflineMigrationArtifacts } = require('./s7-live-migration-offline.js');
const { validateAuthoritySelection, validateMigrationVerification, validateOfflineMigrationManifest, validateS7LiveMigrationAcceptanceReceipt } = require('./s7-live-migration-receipts.js');
const { inspectLogicalSnapshot } = require('./s7-live-migration-snapshot.js');

function parseLiveMigrationAcceptanceArgs(argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        return { help: true, values: {} };
    }
    const values = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--'))
            fail(`Unexpected positional argument: ${token}`);
        const name = token.slice(2);
        if (!SINGLE_VALUE_OPTIONS.has(name))
            fail(`Unknown argument: --${name}.`);
        if (Object.prototype.hasOwnProperty.call(values, name)) {
            fail(`Duplicate argument: --${name}.`);
        }
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
            fail(`--${name} requires a value.`);
        }
        values[name] = value;
        index += 1;
    }
    for (const required of REQUIRED_OPTIONS) {
        if (!values[required])
            fail(`--${required} is required.`);
    }
    for (const required of REQUIRED_OPTIONS) {
        values[required] = assertCleanAbsolutePath(values[required], `--${required}`);
    }
    return { help: false, values };
}

function defaultContext(injectedContext = {}) {
    const currentMigrationContract = migrationContract();
    return {
        allowedV1Checksums: migrationV1ChecksumWhitelist(currentMigrationContract),
        cleanupCaptureRoot: removeCaptureRoot,
        Database: requireSqlite(),
        migrationContract: currentMigrationContract,
        now: () => new Date(),
        requiredTables: REQUIRED_TABLES,
        runReadonlyBackup: runReadonlySqliteOnlineBackupSync,
        runtime: loadLocalDbRuntime(),
        tempRoot: undefined,
        writeStdout: process.stdout.write.bind(process.stdout),
        ...injectedContext,
    };
}

function validateContext(context) {
    for (const [label, value] of [
        ['Database', context.Database],
        ['cleanupCaptureRoot', context.cleanupCaptureRoot],
        ['now', context.now],
        ['runReadonlyBackup', context.runReadonlyBackup],
        ['writeStdout', context.writeStdout],
    ]) {
        if (typeof value !== 'function')
            fail(`Acceptance ${label} dependency is invalid.`);
    }
    if (!Array.isArray(context.migrationContract)
        || context.migrationContract.length !== TARGET_VERSION) {
        fail('Acceptance migrationContract dependency is invalid.');
    }
    if (!(context.allowedV1Checksums instanceof Set)
        || context.allowedV1Checksums.size !== 2
        || !context.allowedV1Checksums.has(context.migrationContract[0].checksum)) {
        fail('Acceptance legacy/current v1 checksum dependency is invalid.');
    }
    if (!Array.isArray(context.requiredTables) || context.requiredTables.length === 0) {
        fail('Acceptance requiredTables dependency is invalid.');
    }
    if (typeof context.runtime?.StoreRepository !== 'function') {
        fail('Acceptance StoreRepository runtime dependency is invalid.');
    }
    for (const hookName of [
        'afterOfflineWorkingArtifactHash',
        'afterOfflineRestoreArtifactHash',
    ]) {
        if (context[hookName] !== undefined && typeof context[hookName] !== 'function') {
            fail(`Acceptance ${hookName} dependency is invalid.`);
        }
    }
}

function verifyS7LiveMigrationAcceptance(options, injectedContext = {}) {
    const context = defaultContext(injectedContext);
    validateContext(context);
    const outputPath = assertOutputAvailable(options.out);
    const databaseArtifactBefore = fileArtifact(options.db, 'Live authority database');
    const authoritySelection = readJsonArtifact(options.authoritySelection, 'Authority selection evidence');
    const migrationManifest = readJsonArtifact(options.migrationManifest, 'Offline migration manifest');
    const migrationVerification = readJsonArtifact(options.migrationVerification, 'Migration verification evidence');
    const checks = [];
    validateOfflineMigrationManifest(migrationManifest.value, databaseArtifactBefore, checks);
    validateAuthoritySelection(authoritySelection.value, databaseArtifactBefore, migrationManifest.value, checks);
    validateMigrationVerification(migrationVerification.value, migrationVerification.artifact, migrationManifest.artifact, checks);
    const offlineArtifactInspection = verifyOfflineMigrationArtifacts(migrationManifest.value, context, checks);
    const captureState = createCaptureRoot(context);
    const snapshotPath = path.join(captureState.captureRoot, CAPTURE_FILE_NAMES[0]);
    const finalSnapshotPath = path.join(captureState.captureRoot, 'live-authority-logical-snapshot-final.db');
    let backupProof;
    let inspection;
    let logicalSnapshotArtifact;
    let receipt;
    let operationError;
    try {
        backupProof = context.runReadonlyBackup({
            sourceDatabasePath: databaseArtifactBefore.realPath,
            destinationPath: snapshotPath,
            ownedTempRoot: captureState.captureRoot,
        });
        recordCaptureArtifact(captureState, snapshotPath);
        addRequiredCheck(checks, 'LIVE_WAL_AWARE_READONLY_BACKUP', backupProof?.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
            && backupProof?.method === CURRENTNESS_METHOD
            && backupProof?.source?.openedReadOnly === true
            && backupProof?.source?.queryOnly === true
            && backupProof?.observedBackup?.remainingPages === 0
            && Number.isInteger(backupProof?.observedBackup?.totalPages)
            && backupProof.observedBackup.totalPages > 0, 'live authority must be captured by completed WAL-aware readonly online backup');
        logicalSnapshotArtifact = fileArtifact(snapshotPath, 'Live authority logical snapshot');
        addRequiredCheck(checks, 'LIVE_LOGICAL_SNAPSHOT_HASH_BOUND', logicalSnapshotArtifact.sha256
            === normalizeSha256(backupProof.observedBackup.sha256, 'WAL-aware backup SHA-256')
            && logicalSnapshotArtifact.sizeBytes === backupProof.observedBackup.sizeBytes, 'logical snapshot SHA-256 and size must match the online-backup proof');
        inspection = inspectLogicalSnapshot(logicalSnapshotArtifact.realPath, databaseArtifactBefore, migrationManifest.value, context, checks);
        recordExistingCaptureArtifacts(captureState);
        const finalBackupProof = context.runReadonlyBackup({
            sourceDatabasePath: databaseArtifactBefore.realPath,
            destinationPath: finalSnapshotPath,
            ownedTempRoot: captureState.captureRoot,
        });
        recordCaptureArtifact(captureState, finalSnapshotPath);
        addRequiredCheck(checks, 'LIVE_FINAL_WAL_AWARE_READONLY_BACKUP', finalBackupProof?.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
            && finalBackupProof?.method === CURRENTNESS_METHOD
            && finalBackupProof?.source?.openedReadOnly === true
            && finalBackupProof?.source?.queryOnly === true
            && finalBackupProof?.observedBackup?.remainingPages === 0
            && Number.isInteger(finalBackupProof?.observedBackup?.totalPages)
            && finalBackupProof.observedBackup.totalPages > 0, 'final live authority capture must be a completed WAL-aware readonly online backup');
        const finalLogicalSnapshotArtifact = fileArtifact(finalSnapshotPath, 'Final live authority logical snapshot');
        addRequiredCheck(checks, 'LIVE_LOGICAL_SNAPSHOT_STABLE', finalLogicalSnapshotArtifact.sha256 === logicalSnapshotArtifact.sha256
            && finalLogicalSnapshotArtifact.sizeBytes === logicalSnapshotArtifact.sizeBytes
            && finalLogicalSnapshotArtifact.sha256 === normalizeSha256(finalBackupProof.observedBackup.sha256, 'Final WAL-aware backup SHA-256')
            && finalLogicalSnapshotArtifact.sizeBytes
                === finalBackupProof.observedBackup.sizeBytes, 'initial and final WAL-aware logical snapshots must have identical SHA-256 and size');
        recordExistingCaptureArtifacts(captureState);
        const databaseArtifactAfter = fileArtifact(options.db, 'Live authority database');
        addRequiredCheck(checks, 'LIVE_MAIN_FILE_UNCHANGED', sameMainArtifact(databaseArtifactBefore, databaseArtifactAfter), 'live authority main file SHA-256, size, and mtime must remain unchanged');
        const generatedAt = context.now();
        if (!(generatedAt instanceof Date) || !Number.isFinite(generatedAt.valueOf())) {
            fail('Acceptance clock returned an invalid date.');
        }
        const passedCount = checks.filter((check) => check.passed).length;
        receipt = {
            kind: KIND,
            schemaVersion: SCHEMA_VERSION,
            generatedAt: generatedAt.toISOString(),
            status: 'PASSED',
            passed: passedCount === checks.length,
            formalEvidence: true,
            authorityDatabaseMutated: false,
            adsExecutionInvoked: false,
            inputs: {
                database: {
                    path: databaseArtifactBefore.path,
                    realPath: databaseArtifactBefore.realPath,
                    sha256: databaseArtifactBefore.sha256,
                    sizeBytes: databaseArtifactBefore.sizeBytes,
                    logicalSnapshotSha256: logicalSnapshotArtifact.sha256,
                    logicalSnapshotSizeBytes: logicalSnapshotArtifact.sizeBytes,
                },
                authoritySelection: publicInputArtifact(authoritySelection.artifact),
                migrationManifest: publicInputArtifact(migrationManifest.artifact),
                migrationVerification: publicInputArtifact(migrationVerification.artifact),
            },
            checks,
            summary: {
                total: checks.length,
                passed: passedCount,
                failed: checks.length - passedCount,
                integrityCheck: inspection.integrityCheck,
                foreignKeyViolationCount: inspection.foreignKeyViolationCount,
                migrationCount: inspection.migrationCount,
                requiredTableCount: inspection.requiredTableCount,
                offlineArtifacts: offlineArtifactInspection,
                businessRowPreservation: inspection.businessRowPreservation,
                recovery: inspection.recovery,
            },
            safety: {
                liveDatabaseAccess: CURRENTNESS_METHOD,
                liveDatabaseOpenedReadOnly: true,
                liveDatabaseQueryOnly: true,
                logicalSnapshotInspectedReadOnly: true,
                walAwareSnapshotProofCount: 2,
                authorityDatabaseMutated: false,
                adsExecutionInvoked: false,
                businessRowContentIncluded: false,
                rawSecretsIncluded: false,
            },
        };
        if (!receipt.passed)
            fail('Acceptance receipt cannot be published with failed checks.');
        validateS7LiveMigrationAcceptanceReceipt(receipt);
    }
    catch (error) {
        operationError = error;
    }
    let cleanupError;
    try {
        recordExistingCaptureArtifacts(captureState);
        context.cleanupCaptureRoot(captureState);
    }
    catch (error) {
        cleanupError = error;
    }
    if (cleanupError) {
        if (operationError && cleanupError instanceof Error)
            cleanupError.cause = operationError;
        throw cleanupError;
    }
    if (operationError)
        throw operationError;
    writeJsonAtomicExclusive(outputPath, receipt);
    return { receipt, outputPath };
}

function publicInputArtifact(artifact) {
    return {
        path: artifact.path,
        realPath: artifact.realPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
    };
}

function writeJsonAtomicExclusive(outputPath, value) {
    assertOutputAvailable(outputPath);
    const parent = path.dirname(outputPath);
    const temporaryPath = path.join(parent, `.tmp-${path.basename(outputPath)}-${crypto.randomUUID()}`);
    let handle = null;
    let published = false;
    let publicationError;
    try {
        handle = fs.openSync(temporaryPath, 'wx', 0o600);
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        handle = null;
        fs.linkSync(temporaryPath, outputPath);
        published = true;
    }
    catch (error) {
        publicationError = error;
    }
    finally {
        if (handle !== null)
            fs.closeSync(handle);
        if (entryExists(temporaryPath)) {
            const temporary = assertDirectExistingPath(temporaryPath, 'Acceptance temporary output', 'file');
            try {
                fs.unlinkSync(temporary.realPath);
            }
            catch (error) {
                if (!published && !publicationError)
                    publicationError = error;
            }
        }
    }
    if (published)
        return outputPath;
    if (entryExists(outputPath)) {
        fail(`Acceptance output collision prevented publication: ${outputPath}`);
    }
    throw publicationError;
}

async function run(argv = process.argv.slice(2), injectedContext = {}) {
    const parsed = parseLiveMigrationAcceptanceArgs(argv);
    const writeStdout = injectedContext.writeStdout ?? process.stdout.write.bind(process.stdout);
    if (typeof writeStdout !== 'function')
        fail('Acceptance writeStdout dependency is invalid.');
    if (parsed.help) {
        writeStdout(`${LIVE_MIGRATION_ACCEPTANCE_USAGE}\n`);
        return { exitCode: 0, receipt: null, outputPath: null };
    }
    const result = verifyS7LiveMigrationAcceptance({
        db: parsed.values.db,
        authoritySelection: parsed.values['authority-selection'],
        migrationManifest: parsed.values['migration-manifest'],
        migrationVerification: parsed.values['migration-verification'],
        out: parsed.values.out,
    }, {
        ...injectedContext,
        writeStdout,
    });
    writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
    return { exitCode: 0, receipt: result.receipt, outputPath: result.outputPath };
}

module.exports = { parseLiveMigrationAcceptanceArgs, defaultContext, validateContext, verifyS7LiveMigrationAcceptance, publicInputArtifact, writeJsonAtomicExclusive, run };
