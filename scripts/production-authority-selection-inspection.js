// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaultDbCandidates, } = require('./ad-readback-authority-db');
const { CURRENTNESS_METHOD, SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION, runReadonlySqliteOnlineBackupSync, } = require('./sqlite-authority-currentness');
const { KIND, PACKAGED_APP_NAME, REQUIRED_TABLES, SCHEMA_VERSION, assertCleanAbsolutePath, assertExpectedSha256, entryExists, fail, requireFromLocalDb, samePath } = require('./production-authority-selection-contracts.js');
const { assertDirectExistingPath, fileArtifact, inspectSidecars, publicArtifact, sameMainArtifact } = require('./production-authority-selection-files.js');
const { migrationContract, migrationInspection } = require('./production-authority-selection-migrations.js');
const { tableNames } = require('./production-authority-selection-schema.js');
const { storeInspection } = require('./production-authority-selection-stores.js');

function sqliteInspection(databasePath, context, options = {}) {
    const Database = context.Database;
    const database = new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
    });
    try {
        database.pragma('query_only = ON');
        const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1;
        if (!queryOnly) {
            fail(`SQLite candidate did not enter query_only mode: ${databasePath}`);
        }
        const integrityRows = database.pragma('integrity_check')
            .map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
        const foreignKeyRows = database.pragma('foreign_key_check');
        const tables = tableNames(database);
        const migration = migrationInspection(database, tables, context.migrationContract);
        const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
        const stores = options.includeStores ? storeInspection(database, tables) : null;
        const integrity = integrityRows.length === 1 && integrityRows[0] === 'ok'
            ? 'ok'
            : 'failed';
        let state = migration.state;
        if (integrity !== 'ok'
            || foreignKeyRows.length > 0
            || (migration.tablePresent && missingTables.length > 0)
            || stores?.state === 'MALFORMED') {
            state = 'RECOVERY_REQUIRED';
        }
        return {
            openedReadOnly: true,
            queryOnly: true,
            integrity,
            integrityCheck: integrityRows,
            foreignKeyViolationCount: foreignKeyRows.length,
            migration,
            missingTables,
            stores,
            state,
        };
    }
    finally {
        database.close();
    }
}

function inspectCandidate(candidatePath, role, context) {
    const artifactReader = context.fileArtifact;
    const direct = assertDirectExistingPath(candidatePath, role === 'selected' ? 'Selected authority database' : 'Non-authority database candidate', 'file');
    if (role === 'selected' && direct.stat.nlink !== 1) {
        fail(`Selected authority database must have exactly one hard link: ${direct.realPath}`);
    }
    const before = artifactReader(direct.realPath);
    const sidecarsBefore = inspectSidecars(direct.realPath, artifactReader);
    const logicalCapture = captureLogicalState(direct.realPath, context, role === 'selected');
    const sidecarsAfter = inspectSidecars(direct.realPath, artifactReader);
    const after = artifactReader(direct.realPath);
    if (!sameMainArtifact(before, after)) {
        fail(`SQLite candidate main file changed during read-only inspection: ${direct.realPath}`);
    }
    for (const sidecarName of ['wal', 'journal']) {
        if (JSON.stringify(sidecarsBefore[sidecarName]) !== JSON.stringify(sidecarsAfter[sidecarName])) {
            fail(`SQLite candidate ${sidecarName} sidecar changed during read-only inspection: ${direct.realPath}`);
        }
    }
    if (sidecarsBefore.shm.exists && !sidecarsAfter.shm.exists) {
        fail(`SQLite candidate SHM sidecar disappeared during read-only inspection: ${direct.realPath}`);
    }
    return {
        role,
        absolutePath: path.resolve(candidatePath),
        realPath: direct.realPath,
        mainFile: publicArtifact(after),
        sidecars: sidecarsAfter,
        sidecarsBefore,
        sidecarObservation: {
            walAndJournalUnchanged: true,
            shmUnchanged: JSON.stringify(sidecarsBefore.shm) === JSON.stringify(sidecarsAfter.shm),
            shmMayChangeForReadonlyWalLocking: true,
        },
        sqlite: logicalCapture.sqlite,
        logicalCapture: logicalCapture.proof,
    };
}

function createCaptureRoot(context) {
    const randomUUID = context.randomUUID;
    const nonce = String(randomUUID()).replace(/[^A-Za-z0-9-]/g, '');
    if (!nonce)
        fail('Authority selection randomUUID returned an invalid value.');
    if (context.tempRoot) {
        const base = assertDirectExistingPath(assertCleanAbsolutePath(context.tempRoot, 'Injected temporary root'), 'Injected temporary root', 'directory');
        const captureRoot = path.join(base.realPath, `authority-selection-${nonce}`);
        fs.mkdirSync(captureRoot, { recursive: false });
        return {
            captureRoot,
            ownedBaseRoot: null,
        };
    }
    const osTemp = assertDirectExistingPath(path.resolve(os.tmpdir()), 'Operating-system temporary root', 'directory');
    const ownedBaseRoot = fs.mkdtempSync(path.join(osTemp.realPath, 'amazon-ai-ops-authority-selection-'));
    const captureRoot = path.join(ownedBaseRoot, `capture-${nonce}`);
    fs.mkdirSync(captureRoot, { recursive: false });
    return { captureRoot, ownedBaseRoot };
}

function removeOwnedFile(filePath, parentPath, label) {
    if (!entryExists(filePath))
        return;
    if (!samePath(path.dirname(filePath), parentPath)) {
        fail(`Refusing to clean ${label} outside its owned directory.`);
    }
    const direct = assertDirectExistingPath(filePath, label, 'file');
    fs.unlinkSync(direct.realPath);
}

function cleanupCaptureRoot(captureRoot, ownedBaseRoot) {
    for (const fileName of [
        'authority-logical-capture.db',
        'authority-logical-capture.db-wal',
        'authority-logical-capture.db-shm',
        'authority-logical-capture.db-journal',
    ]) {
        removeOwnedFile(path.join(captureRoot, fileName), captureRoot, 'Authority capture artifact');
    }
    if (entryExists(captureRoot)) {
        const entries = fs.readdirSync(captureRoot);
        if (entries.length !== 0) {
            fail(`Authority capture cleanup found unexpected entries: ${entries.join(', ')}`);
        }
        fs.rmdirSync(captureRoot);
    }
    if (ownedBaseRoot && entryExists(ownedBaseRoot)) {
        const entries = fs.readdirSync(ownedBaseRoot);
        if (entries.length !== 0) {
            fail(`Authority selection temporary root was not empty: ${ownedBaseRoot}`);
        }
        fs.rmdirSync(ownedBaseRoot);
    }
}

function captureLogicalState(databasePath, context, includeStores) {
    const { captureRoot, ownedBaseRoot } = createCaptureRoot(context);
    const destinationPath = path.join(captureRoot, 'authority-logical-capture.db');
    try {
        const backup = context.runReadonlyBackup({
            sourceDatabasePath: databasePath,
            destinationPath,
            ownedTempRoot: captureRoot,
        }, context);
        if (backup?.schemaVersion !== SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
            || backup?.method !== CURRENTNESS_METHOD
            || backup?.source?.openedReadOnly !== true
            || backup?.source?.queryOnly !== true
            || !Number.isInteger(backup?.observedBackup?.totalPages)
            || backup.observedBackup.totalPages <= 0
            || backup?.observedBackup?.remainingPages !== 0) {
            fail('WAL-aware authority currentness capture returned an invalid proof.');
        }
        const captured = context.fileArtifact(destinationPath);
        if (captured.sha256 !== String(backup.observedBackup.sha256).toUpperCase()
            || captured.sizeBytes !== backup.observedBackup.sizeBytes) {
            fail('WAL-aware authority currentness capture artifact does not match its proof.');
        }
        const capturedSqlite = sqliteInspection(destinationPath, context, { includeStores });
        return {
            proof: {
                schemaVersion: backup.schemaVersion,
                method: backup.method,
                source: {
                    openedReadOnly: true,
                    queryOnly: true,
                },
                logicalBackupSha256: captured.sha256,
                logicalBackupSizeBytes: captured.sizeBytes,
                totalPages: backup.observedBackup.totalPages,
                remainingPages: backup.observedBackup.remainingPages,
            },
            sqlite: capturedSqlite,
        };
    }
    finally {
        cleanupCaptureRoot(captureRoot, ownedBaseRoot);
    }
}

function defaultContext(injectedContext = {}) {
    return {
        Database: requireFromLocalDb('better-sqlite3'),
        env: process.env,
        fileArtifact,
        migrationContract: migrationContract(),
        now: () => new Date(),
        randomUUID: () => crypto.randomUUID(),
        runReadonlyBackup: runReadonlySqliteOnlineBackupSync,
        tempRoot: null,
        writeStdout: process.stdout.write.bind(process.stdout),
        ...injectedContext,
    };
}

function validateContext(context) {
    for (const [label, value] of [
        ['Database', context.Database],
        ['fileArtifact', context.fileArtifact],
        ['now', context.now],
        ['randomUUID', context.randomUUID],
        ['runReadonlyBackup', context.runReadonlyBackup],
        ['writeStdout', context.writeStdout],
    ]) {
        if (typeof value !== 'function')
            fail(`Authority selection ${label} dependency is invalid.`);
    }
    if (!Array.isArray(context.migrationContract)) {
        fail('Authority selection migrationContract dependency is invalid.');
    }
    if (!context.env || typeof context.env !== 'object') {
        fail('Authority selection environment dependency is invalid.');
    }
}

function inspectProductionAuthoritySelection(options = {}, injectedContext = {}) {
    const context = defaultContext(injectedContext);
    validateContext(context);
    const selectedInput = assertCleanAbsolutePath(options.dbPath, '--db');
    const expectedUserDataInput = assertCleanAbsolutePath(options.expectedUserDataDir, '--expected-user-data-dir');
    const expectedSha256 = assertExpectedSha256(options.expectedMainSha256);
    const userData = assertDirectExistingPath(expectedUserDataInput, 'Expected Electron userData directory', 'directory');
    const appDataRoot = assertDirectExistingPath(assertCleanAbsolutePath(context.env.APPDATA, 'APPDATA'), 'APPDATA directory', 'directory');
    const packagedUserDataPath = path.join(appDataRoot.realPath, ...PACKAGED_APP_NAME.split('/'));
    if (!samePath(userData.realPath, packagedUserDataPath)) {
        fail(`Expected Electron userData must resolve exactly to the packaged ${PACKAGED_APP_NAME} path: `
            + packagedUserDataPath);
    }
    const expectedDatabasePath = path.join(userData.realPath, 'amazon-ai-ops.db');
    const storesRoot = path.join(userData.realPath, 'stores');
    if (entryExists(storesRoot)) {
        assertDirectExistingPath(storesRoot, 'Derived stores root', 'directory');
    }
    const selected = assertDirectExistingPath(selectedInput, 'Selected authority database', 'file');
    if (selected.stat.nlink !== 1) {
        fail(`Selected authority database must have exactly one hard link: ${selected.realPath}`);
    }
    if (!samePath(selected.realPath, expectedDatabasePath)) {
        fail(`Selected authority database must resolve exactly to ${expectedDatabasePath}.`);
    }
    const candidates = defaultDbCandidates(context.env)
        .map((candidate) => path.resolve(candidate));
    const selectedCandidateMatches = candidates.filter((candidate) => samePath(candidate, selectedInput));
    if (selectedCandidateMatches.length !== 1) {
        fail('Selected authority database must be exactly one default AppData candidate.');
    }
    const existingCandidates = candidates.filter(entryExists);
    const selectedExistingMatches = existingCandidates.filter((candidate) => samePath(candidate, selectedInput));
    if (selectedExistingMatches.length !== 1) {
        fail('Authority selection must resolve to exactly one existing selected candidate.');
    }
    const selectedBefore = context.fileArtifact(selected.realPath);
    if (selectedBefore.sha256 !== expectedSha256) {
        fail(`Selected authority main SHA-256 mismatch: expected ${expectedSha256}, `
            + `observed ${selectedBefore.sha256}.`);
    }
    const inspectedCandidates = existingCandidates.map((candidate) => inspectCandidate(candidate, samePath(candidate, selectedInput) ? 'selected' : 'non-authority', context));
    const selectedRows = inspectedCandidates.filter((candidate) => candidate.role === 'selected');
    if (selectedRows.length !== 1) {
        fail('Authority candidate inventory did not contain exactly one selected database.');
    }
    const selectedAfter = context.fileArtifact(selected.realPath);
    if (!sameMainArtifact(selectedBefore, selectedAfter)) {
        fail('Selected authority main file changed during WAL-aware read-only preflight.');
    }
    if (selectedAfter.sha256 !== expectedSha256) {
        fail('Selected authority main SHA-256 drifted during read-only preflight.');
    }
    const selectedInspection = selectedRows[0];
    const status = selectedInspection.sqlite.state === 'READY'
        ? 'SELECTED_SCHEMA_READY'
        : selectedInspection.sqlite.state === 'MIGRATION_REQUIRED'
            ? 'SELECTED_MIGRATION_REQUIRED'
            : 'SELECTED_RECOVERY_REQUIRED';
    const generatedAt = context.now();
    if (!(generatedAt instanceof Date) || !Number.isFinite(generatedAt.valueOf())) {
        fail('Authority selection clock returned an invalid date.');
    }
    return {
        kind: KIND,
        schemaVersion: SCHEMA_VERSION,
        generatedAt: generatedAt.toISOString(),
        status,
        formalEvidence: false,
        authorityDatabaseMutated: false,
        adsExecutionInvoked: false,
        selection: {
            expectedUserDataDir: userData.realPath,
            expectedDatabasePath,
            storesRoot,
            storesRootExists: entryExists(storesRoot),
            expectedMainSha256: expectedSha256,
            defaultCandidateCount: candidates.length,
            existingCandidateCount: inspectedCandidates.length,
            selected: {
                ...selectedInspection,
                mainFileSha256: selectedInspection.mainFile.sha256,
                logicalBackupSha256: selectedInspection.logicalCapture.logicalBackupSha256,
                offlineMigrationEligible: selectedInspection.sqlite.state === 'MIGRATION_REQUIRED'
                    && !Object.values(selectedInspection.sidecars).some((sidecar) => sidecar.exists),
            },
            nonAuthority: inspectedCandidates.filter((candidate) => candidate.role === 'non-authority'),
        },
    };
}

module.exports = { sqliteInspection, inspectCandidate, createCaptureRoot, removeOwnedFile, cleanupCaptureRoot, captureLogicalState, defaultContext, validateContext, inspectProductionAuthoritySelection };
