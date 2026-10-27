// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { collectFixedPackageHashes, evaluatePackageUiEvidenceCompleteness, } = require('./package-ui-evidence');
const { PACKAGED_APP_NAME, inspectProductionAuthoritySelection, migrationContract, migrationRowsMatchProductionContract, } = require('./verify-production-authority-selection');
const { TARGET_VERSION, requireSqlite, readAppliedVersion, collectRowCounts, } = require('./migrate-current-user-db');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');
const { validatePackageLaunchWindowReadyMarker } = require('./smoke-package-launch');
const { CANONICAL_APP, CANONICAL_EXE, CANONICAL_MAIN, MAX_PACKAGE_UI_AGE_MS, REQUIRED_MIGRATION_VERIFICATION_CODES, ROOT, SUPPORTED_SOURCE_VERSIONS, exactPassingChecks, fail, normalizeSha, pathsOverlap, publicArtifact, samePath, stableJson } = require('./s7-launch-operator-contracts.js');
const { assertTreeSingleLinked, directPath, fileArtifact, noSidecars, readJsonStable } = require('./s7-launch-operator-filesystem.js');
const { minimalWindowsRuntimeEnvironment, spawnTrustedWindowsPowerShell } = require('./s7-launch-operator-security.js');

let mainStartupGateRuntime;

function defaultPackageIdentity() {
    const hashes = collectFixedPackageHashes();
    const app = assertTreeSingleLinked(CANONICAL_APP);
    const exe = fileArtifact(CANONICAL_EXE, 'Canonical package EXE');
    const main = fileArtifact(CANONICAL_MAIN, 'Canonical package Main bundle');
    if (!samePath(hashes.executablePath, CANONICAL_EXE)
        || !samePath(hashes.appContentPath, CANONICAL_APP)
        || exe.sha256 !== normalizeSha(hashes.exeSha256, 'Package EXE hash')) {
        fail('Fixed package hash helper did not return the canonical package identity.');
    }
    return {
        exe: publicArtifact(exe),
        appContent: {
            path: CANONICAL_APP,
            realPath: app.realPath,
            sha256: normalizeSha(hashes.appContentSha256, 'Package app-content hash'),
            fileCount: hashes.appContentFileCount,
            sizeBytes: hashes.appContentSizeBytes,
        },
        main: publicArtifact(main),
    };
}

function samePackageIdentity(left, right) {
    return stableJson(left) === stableJson(right);
}

function assertPacketPackageIdentity(packet, current) {
    const expected = packet?.bindings?.package;
    if (!expected || !samePackageIdentity(expected, current)) {
        fail('Canonical package identity drifted since approval packet creation.');
    }
}

function defaultReadSchema(dbPath) {
    const Database = requireSqlite();
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('query_only = ON');
        return Number(readAppliedVersion(db));
    }
    finally {
        db.close();
    }
}

function loadMainStartupGateRuntime() {
    if (mainStartupGateRuntime)
        return mainStartupGateRuntime;
    const cache = path.join(ROOT, 'apps', 'desktop', 'node_modules', '.cache', 's7-migration');
    fs.mkdirSync(cache, { recursive: true });
    const outfile = path.join(cache, `startup-gate-${process.pid}.cjs`);
    require(path.join(ROOT, 'apps', 'desktop', 'node_modules', 'esbuild')).buildSync({
        entryPoints: [path.join(ROOT, 'apps', 'desktop', 'src', 'main', 's7-migration-startup-gate.ts')],
        tsconfig: path.join(ROOT, 'apps', 'desktop', 'tsconfig.json'),
        bundle: true, platform: 'node', format: 'cjs', outfile,
        external: ['better-sqlite3'], logLevel: 'silent',
    });
    mainStartupGateRuntime = require(outfile);
    return mainStartupGateRuntime;
}

function postMigrationAuthorityContract(actualRows) {
    const contract = loadMainStartupGateRuntime().s7PostMigrationAuthorityContract();
    const rows = (actualRows ?? contract.migrationRows).map((row) => ({
        version: Number(row.version), name: String(row.name), checksum: String(row.checksum),
        status: String(row.status ?? 'applied').toLowerCase(),
    }));
    if (!migrationRowsMatchProductionContract(rows, migrationContract())) {
        fail(`Post-migration authority ledger is not the exact allowed v1..v${TARGET_VERSION} contract.`);
    }
    return { ...contract, migrationRows: rows };
}

function defaultInspectPostMigrationAuthority(dbPath) {
    return loadMainStartupGateRuntime().defaultInspectPostMigrationAuthority(dbPath);
}

function defaultResolveKnownFolder(specialFolder, label) {
    const result = spawnTrustedWindowsPowerShell([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Environment]::GetFolderPath([Environment+SpecialFolder]::${specialFolder})`,
    ], {
        encoding: 'utf8',
        env: minimalWindowsRuntimeEnvironment(process.env),
        windowsHide: true,
        timeout: 20000,
    });
    const value = String(result.stdout || '').trim();
    if (result.error || result.status !== 0 || !value) {
        fail(`Windows Known Folder lookup for ${label} failed.`);
    }
    return value;
}

function defaultResolveRoamingAppData() {
    return defaultResolveKnownFolder('ApplicationData', 'Roaming AppData');
}

function defaultResolveUserProfile() {
    return defaultResolveKnownFolder('UserProfile', 'User Profile');
}

function resolveCanonicalPaths(context) {
    const roaming = directPath(context.resolveRoamingAppData(), 'Windows Roaming AppData Known Folder', 'directory');
    const userProfile = directPath(context.resolveUserProfile(), 'Windows User Profile Known Folder', 'directory');
    const userDataPath = path.join(roaming.realPath, ...PACKAGED_APP_NAME.split('/'));
    const userData = directPath(userDataPath, 'Canonical packaged userData', 'directory');
    const databasePath = path.join(userData.realPath, 'amazon-ai-ops.db');
    return {
        roamingAppData: roaming.realPath,
        userProfile: userProfile.realPath,
        userDataDir: userData.realPath,
        databasePath,
    };
}

function defaultInspectAuthority({ dbPath, userDataDir, sha256: expectedSha256, roamingAppData, userProfile, }) {
    return inspectProductionAuthoritySelection({
        dbPath,
        expectedUserDataDir: userDataDir,
        expectedMainSha256: expectedSha256,
    }, {
        env: { APPDATA: roamingAppData, USERPROFILE: userProfile },
        writeStdout: () => { },
    });
}

function validateAuthoritySelection(receipt, current, db, canonical, now) {
    const generatedAt = Date.parse(receipt?.generatedAt || '');
    if (receipt?.kind !== 'production-authority-selection-preflight'
        || receipt?.schemaVersion !== 'production-authority-selection-preflight/v1'
        || receipt?.status !== 'SELECTED_MIGRATION_REQUIRED'
        || receipt?.formalEvidence !== false
        || receipt?.authorityDatabaseMutated !== false
        || receipt?.adsExecutionInvoked !== false
        || !Number.isFinite(generatedAt)
        || generatedAt > now().valueOf() + 60000
        || current?.kind !== receipt.kind
        || current?.schemaVersion !== receipt.schemaVersion
        || current?.status !== receipt.status
        || current?.formalEvidence !== false
        || current?.authorityDatabaseMutated !== false
        || current?.adsExecutionInvoked !== false
        || stableJson(current.selection) !== stableJson(receipt.selection)
        || !samePath(current.selection?.expectedUserDataDir, canonical.userDataDir)
        || !samePath(current.selection?.expectedDatabasePath, canonical.databasePath)
        || !samePath(current.selection?.selected?.absolutePath, db.realPath)
        || !samePath(current.selection?.selected?.realPath, db.realPath)
        || current.selection?.selected?.offlineMigrationEligible !== true
        || normalizeSha(current.selection?.selected?.mainFileSha256, 'Authority selection SHA')
            !== db.sha256) {
        fail('Authority selection is not the current strict canonical AppData authority preflight.');
    }
}

function validateMigrationInputs(migration, verification, db, context) {
    const manifest = migration.value;
    if (manifest?.kind !== 's7-offline-db-upgrade'
        || Number(manifest?.schemaVersion) !== 1
        || manifest?.passed !== true
        || Number(manifest?.targetVersion) !== TARGET_VERSION
        || !samePath(manifest?.source?.path, db.realPath)
        || normalizeSha(manifest?.source?.sha256, 'Offline migration source SHA') !== db.sha256
        || !SUPPORTED_SOURCE_VERSIONS.includes(manifest?.source?.version)
        || manifest.source.version !== context.readSchemaVersion(db.realPath)) {
        fail(`Offline migration manifest is not a passing bound v0/v11-to-v${TARGET_VERSION} rehearsal for this DB.`);
    }
    exactPassingChecks(verification.value, 'Supplied migration verification receipt');
    if (!samePath(verification.value.sourceManifestPath, migration.artifact.realPath)
        || normalizeSha(verification.value.sourceManifestSha256, 'Migration verification source manifest SHA') !== migration.artifact.sha256) {
        fail('Migration verification receipt is not bound to the supplied manifest.');
    }
    const recomputed = context.verifyMigration(migration.artifact.realPath);
    exactPassingChecks(recomputed, 'Independently recomputed migration verification');
    if (!samePath(recomputed.sourceManifestPath, migration.artifact.realPath)
        || normalizeSha(recomputed.sourceManifestSha256, 'Recomputed migration verification source manifest SHA') !== migration.artifact.sha256) {
        fail('Independent migration verification did not bind the supplied manifest.');
    }
    return {
        verifier: 'verifyS7MigrationBackupRestore',
        sourceManifestPath: recomputed.sourceManifestPath,
        sourceManifestSha256: recomputed.sourceManifestSha256,
        passed: true,
        checkCodes: [...REQUIRED_MIGRATION_VERIFICATION_CODES],
        summary: {
            total: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
            passed: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
            failed: 0,
        },
    };
}

function sqliteLogicalDigest(filePath) {
    const database = new (requireSqlite())(filePath, { readonly: true, fileMustExist: true });
    try {
        database.pragma('query_only = ON');
        database.defaultSafeIntegers(true);
        const schema = database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
        const hash = crypto.createHash('sha256').update(stableJson(schema));
        for (const table of schema.filter((row) => row.type === 'table')) {
            const name = String(table.name).replaceAll('"', '""');
            const rows = database.prepare(`SELECT * FROM "${name}"`).raw().all().map((row) => stableJson(row.map((value) => (typeof value === 'bigint' ? { integer: value.toString() }
                : Buffer.isBuffer(value) ? { blob: value.toString('hex') } : value)))).sort();
            hash.update(stableJson([table.name, rows]));
        }
        return hash.digest('hex').toUpperCase();
    }
    finally {
        database.close();
    }
}

function validatePackageUpgradeSmoke(receipt, artifact, currentPackage, db, context) {
    const generatedAt = Date.parse(receipt?.generatedAt || '');
    if (receipt?.kind !== 's7-package-upgrade-smoke' || receipt.schemaVersion !== 1
        || receipt.formalAppReadiness !== false || !Number.isFinite(generatedAt)
        || generatedAt > context.now().valueOf() + 60000
        || context.now().valueOf() - generatedAt > MAX_PACKAGE_UI_AGE_MS) {
        fail('Package upgrade smoke receipt is invalid or stale.');
    }
    for (const key of ['exe', 'main', 'appContent']) {
        const bound = receipt.package?.[key];
        if (!samePath(bound?.realPath, currentPackage[key].realPath)
            || normalizeSha(bound?.sha256, `Upgrade smoke ${key}`) !== currentPackage[key].sha256
            || Number(bound?.sizeBytes) !== currentPackage[key].sizeBytes) {
            fail('Package upgrade smoke does not bind the current package.');
        }
    }
    const boundFile = (binding, label) => {
        const actual = fileArtifact(binding?.path, label);
        if (actual.sha256 !== normalizeSha(binding.sha256, label) || actual.sizeBytes !== binding.sizeBytes) {
            fail(`${label} file changed since smoke capture.`);
        }
        return actual;
    };
    const source = boundFile(receipt.sourceSnapshot, 'Upgrade source snapshot');
    const authoritySnapshot = receipt.authoritySnapshot
        ? boundFile(receipt.authoritySnapshot, 'Original authority snapshot') : source;
    context.captureAuthorityCurrentness({ sourceDatabasePath: db.realPath, expectedSnapshotArtifact: authoritySnapshot });
    const logicalDigest = sqliteLogicalDigest(source.realPath);
    if (authoritySnapshot.sha256 !== source.sha256 && sqliteLogicalDigest(authoritySnapshot.realPath) !== logicalDigest) {
        fail('Rehearsal source logical contents differ from the authority snapshot.');
    }
    const rehearsal = readJsonStable(receipt.rehearsalManifestPath, 'Upgrade smoke rehearsal');
    const verified = context.verifyMigration(rehearsal.artifact.realPath);
    exactPassingChecks(verified, 'Upgrade smoke rehearsal verification');
    if (!samePath(verified.sourceManifestPath, rehearsal.artifact.realPath)
        || normalizeSha(verified.sourceManifestSha256, 'Upgrade smoke rehearsal hash') !== rehearsal.artifact.sha256
        || !samePath(rehearsal.value.source?.path, source.realPath)
        || normalizeSha(rehearsal.value.source?.sha256, 'Rehearsal source') !== source.sha256
        || rehearsal.value.source?.version !== 11 || rehearsal.value.targetVersion !== TARGET_VERSION
        || normalizeSha(receipt.isolatedGenesisSha256, 'Isolated genesis') !== normalizeSha(rehearsal.value.workingDatabase?.upgradedSha256, 'Rehearsal upgraded database')) {
        fail('Package smoke is not bound to the verified v11 rehearsal and isolated genesis.');
    }
    const profile = validateEvidenceUserDataPath(receipt.isolatedUserDataDir);
    const isolated = boundFile(receipt.isolatedDatabase, 'Smoke isolated database');
    if (!samePath(isolated.realPath, path.join(profile, 'amazon-ai-ops.db')) || pathsOverlap(profile, path.dirname(db.realPath))) {
        fail('Package smoke database must be in its isolated profile.');
    }
    noSidecars(isolated.realPath, 'Closed smoke database');
    const authority = context.inspectPostMigrationAuthority(isolated.realPath);
    if (stableJson(authority) !== stableJson(postMigrationAuthorityContract(authority.migrationRows))) {
        fail('Package smoke isolated database contract is not current.');
    }
    const Database = requireSqlite();
    const snapshot = new Database(source.realPath, { readonly: true, fileMustExist: true });
    const upgraded = new Database(isolated.realPath, { readonly: true, fileMustExist: true });
    let sourceRows;
    try {
        snapshot.pragma('query_only = ON');
        upgraded.pragma('query_only = ON');
        sourceRows = collectRowCounts(snapshot);
        const rowsAfter = collectRowCounts(upgraded);
        if (stableJson(sourceRows) !== stableJson(receipt.sourceSnapshot.tableRowCounts)
            || Object.entries(sourceRows).some(([table, count]) => table !== 'schema_migrations' && !(rowsAfter[table] >= count))) {
            fail('Package smoke logical summary or preserved business rows differ.');
        }
    }
    finally {
        snapshot.close();
        upgraded.close();
    }
    if (!Array.isArray(receipt.launches) || receipt.launches.length !== 2)
        fail('Package smoke requires startup and reopen.');
    let previousClose = 0;
    const pids = new Set();
    for (const launch of receipt.launches) {
        const startedAt = Date.parse(launch.startedAt || '');
        const closedAt = Date.parse(launch.closedAt || '');
        const runtimeFile = boundFile(launch.runtimeMarker, 'Smoke runtime marker');
        const readyFile = boundFile(launch.windowReadyMarker, 'Smoke window marker');
        const runtime = JSON.parse(fs.readFileSync(runtimeFile.realPath, 'utf8'));
        const ready = JSON.parse(fs.readFileSync(readyFile.realPath, 'utf8'));
        const process = launch.processObservation;
        const window = validatePackageLaunchWindowReadyMarker(ready, {
            expectedPid: launch.pid, expectedRendererPath: path.join(currentPackage.appContent.realPath, 'dist', 'renderer', 'index.html'),
            expectedUserDataDir: profile, notBeforeMs: startedAt, runtimeMarkerGeneratedAt: runtime.generatedAt,
        });
        if (!Number.isFinite(startedAt) || !Number.isFinite(closedAt) || startedAt < previousClose
            || closedAt < Date.parse(ready.generatedAt) || closedAt > generatedAt
            || launch.exitCode !== 0 || pids.has(launch.pid) || !window.passed
            || runtime.pid !== launch.pid || runtime.mode !== 'package-launch-smoke' || !samePath(runtime.userDataDir, profile)
            || process?.ProcessId !== launch.pid || !samePath(process?.ExecutablePath, currentPackage.exe.realPath)
            || !(process?.MainWindowHandle > 0) || process?.WindowVisible !== true
            || !Number.isFinite(Date.parse(process?.CreationDate)) || Date.parse(process.CreationDate) < startedAt - 2000) {
            fail('Package smoke startup/reopen window, process, timing or close proof is invalid.');
        }
        previousClose = closedAt;
        pids.add(launch.pid);
    }
    return { artifact: publicArtifact(artifact), mode: 'package-upgrade-smoke', generatedAt: new Date(generatedAt).toISOString(),
        formalAppReadiness: false, sourceSnapshot: publicArtifact(source), authoritySnapshot: publicArtifact(authoritySnapshot),
        sourceLogicalDigest: logicalDigest, isolatedDatabase: publicArtifact(isolated),
        rehearsal: publicArtifact(rehearsal.artifact), authorityContractSha256: authority.contractSha256, launchCount: 2 };
}

function packageUiFileMatchesDb(record, db) {
    return samePath(record?.path, db.realPath)
        && normalizeSha(record?.sha256, 'Package UI protected DB SHA') === db.sha256
        && Number(record?.sizeBytes) === db.sizeBytes
        && Number(record?.mtimeMs) === db.mtimeMs;
}

function validatePackageUi(manifest, artifact, currentPackage, db, context) {
    const generatedAt = Date.parse(manifest?.generatedAt || '');
    const currentTime = context.now();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.valueOf())) {
        fail('Package UI validation clock returned an invalid date.');
    }
    if (manifest?.kind !== 'package-ui-evidence'
        || Number(manifest?.schemaVersion) !== 9
        || manifest?.passed !== true
        || !Number.isFinite(generatedAt)
        || generatedAt > currentTime.valueOf() + 60000
        || currentTime.valueOf() - generatedAt > MAX_PACKAGE_UI_AGE_MS) {
        fail('Package UI manifest is invalid, failed, future-dated, or stale.');
    }
    const formal = context.evaluatePackageUiEvidence(manifest);
    if (formal?.passed !== true
        || !Array.isArray(formal?.violations)
        || formal.violations.length !== 0) {
        fail('Formal Package UI v9 completeness evaluation failed.');
    }
    const requested = manifest.requested || {};
    const before = manifest.artifactsBefore || {};
    const after = manifest.artifactsAfter || {};
    if (manifest.artifactHashesStable !== true
        || !samePath(requested.executablePath, currentPackage.exe.realPath)
        || normalizeSha(requested.expectedExeSha256, 'Package UI expected EXE hash')
            !== currentPackage.exe.sha256
        || !samePath(requested.appContentPath, currentPackage.appContent.realPath)
        || normalizeSha(requested.expectedAppContentSha256, 'Package UI expected app-content hash') !== currentPackage.appContent.sha256
        || normalizeSha(before.exe?.sha256, 'Package UI before EXE hash')
            !== currentPackage.exe.sha256
        || normalizeSha(before.appContent?.sha256, 'Package UI before app-content hash')
            !== currentPackage.appContent.sha256
        || normalizeSha(after.exe?.sha256, 'Package UI after EXE hash')
            !== currentPackage.exe.sha256
        || normalizeSha(after.appContent?.sha256, 'Package UI after app-content hash')
            !== currentPackage.appContent.sha256
        || manifest.protectedDatabase?.passed !== true
        || manifest.protectedDatabase?.unchanged !== true
        || !packageUiFileMatchesDb(manifest.protectedDatabase?.before, db)
        || !packageUiFileMatchesDb(manifest.protectedDatabase?.after, db)) {
        fail('Passed Package UI manifest does not bind the current package and live authority DB.');
    }
    return {
        artifact: publicArtifact(artifact),
        generatedAt: new Date(generatedAt).toISOString(),
        schemaVersion: 9,
        passed: true,
        runGroupId: manifest.runGroup?.runGroupId ?? null,
        formalEvaluation: {
            evaluator: 'evaluatePackageUiEvidenceCompleteness',
            passed: true,
            violationCount: 0,
        },
        protectedDatabaseBinding: {
            path: db.realPath,
            sha256: db.sha256,
            sizeBytes: db.sizeBytes,
            mtimeMs: db.mtimeMs,
            beforeMatches: true,
            afterMatches: true,
        },
    };
}

function defaultExclusiveDbPreflight(dbPath) {
    const escaped = String(dbPath).replace(/'/g, "''");
    const command = [
        `$p='${escaped}'`,
        '$s=$null',
        'try {',
        '  $s=[System.IO.File]::Open($p,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None)',
        "  [Console]::Out.Write('OK')",
        '} finally { if ($null -ne $s) { $s.Dispose() } }',
    ].join('\n');
    const result = spawnTrustedWindowsPowerShell(['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        env: minimalWindowsRuntimeEnvironment(process.env),
        windowsHide: true,
        timeout: 20000,
    });
    return {
        method: 'windows-fileshare-none',
        passed: !result.error && result.status === 0 && String(result.stdout || '').trim() === 'OK',
    };
}

function validateExclusiveDbPreflight(result, label) {
    if (result?.passed !== true || result?.method !== 'windows-fileshare-none') {
        fail(`${label} could not obtain the Windows FileShare.None offline proof.`);
    }
    return { method: result.method, passed: true };
}

module.exports = { defaultPackageIdentity, samePackageIdentity, assertPacketPackageIdentity, defaultReadSchema, loadMainStartupGateRuntime, postMigrationAuthorityContract, defaultInspectPostMigrationAuthority, defaultResolveKnownFolder, defaultResolveRoamingAppData, defaultResolveUserProfile, resolveCanonicalPaths, defaultInspectAuthority, validateAuthoritySelection, validateMigrationInputs, sqliteLogicalDigest, validatePackageUpgradeSmoke, packageUiFileMatchesDb, validatePackageUi, defaultExclusiveDbPreflight, validateExclusiveDbPreflight, mainStartupGateRuntime };
