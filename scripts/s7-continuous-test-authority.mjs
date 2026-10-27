// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, Database, computeCanonicalPackageIdentity, dates, fs, generatedAt, os, path, runReadonlySqliteOnlineBackupSync } from './s7-continuous-test-environment.mjs';
import { sha256File } from './s7-continuous-test-artifacts.mjs';
import { seedContinuousDatabase } from './s7-continuous-test-lineage.mjs';
function createAuthoritySnapshotFixture() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-continuous-'));
    const userDataDir = path.join(tempDir, 'AppData', 'Amazon AI Ops');
    const sourcePath = path.join(userDataDir, 'amazon-ai-ops.db');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(path.join(userDataDir, 'stores'), { recursive: true });
    fs.writeFileSync(sourcePath, 'immutable live authority source');
    const sourceStat = fs.statSync(sourcePath);
    const sourceArtifact = {
        sha256: sha256File(sourcePath),
        sizeBytes: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
    };
    const releaseRoot = path.join(tempDir, 'release');
    const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
    const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
    const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.mkdirSync(path.dirname(mainBundlePath), { recursive: true });
    fs.writeFileSync(executablePath, 'fixture executable');
    fs.writeFileSync(mainBundlePath, 'fixture main bundle');
    for (const [relativePath, contents] of [
        ['dist/preload/index.js', 'fixture preload'],
        ['dist/renderer/index.html', '<!doctype html><title>fixture</title>'],
        ['playwright-browsers/chrome-win64/chrome.exe', 'fixture chromium'],
    ]) {
        const targetPath = path.join(appContentPath, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, contents);
    }
    fs.writeFileSync(path.join(appContentPath, 'package.json'), `${JSON.stringify({
        main: 'dist/main/index.js',
        name: '@amazon-ai-ops/desktop',
        version: JSON.parse(fs.readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')).version,
    })}\n`);
    const packageContext = {
        appContentPath,
        executablePath,
        mainBundlePath,
        releaseRoot,
        verifyPackageIdentity: true,
    };
    const fixturePackageIdentity = computeCanonicalPackageIdentity(packageContext);
    const authoritySnapshotRoot = path.join(tempDir, 'authority-snapshots');
    const runDir = path.join(authoritySnapshotRoot, 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    const databasePath = path.join(runDir, 'authority-snapshot.db');
    fs.writeFileSync(databasePath, 'immutable authority snapshot');
    const stat = fs.statSync(databasePath);
    const now = new Date().toISOString();
    const manifestPath = path.join(runDir, 'snapshot-manifest.json');
    const manifest = {
        kind: AUTHORITY_SNAPSHOT_KIND,
        schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
        exportedAt: now,
        backup: {
            method: 'sqlite-online-backup',
            startedAt: now,
            completedAt: now,
            completed: true,
            totalPages: 1,
            remainingPages: 0,
        },
        source: {
            absolutePath: sourcePath,
            realPath: fs.realpathSync.native(sourcePath),
            openedReadOnly: true,
            queryOnly: true,
            integrityCheck: ['ok'],
            foreignKeyCheck: [],
            artifactBefore: { ...sourceArtifact },
            artifactAfter: { ...sourceArtifact },
        },
        snapshot: {
            absolutePath: databasePath,
            realPath: fs.realpathSync.native(databasePath),
            openedReadOnly: true,
            queryOnly: true,
            integrityCheck: ['ok'],
            foreignKeyCheck: [],
            sha256: sha256File(databasePath),
            sizeBytes: stat.size,
        },
        packageIdentity: fixturePackageIdentity,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return {
        authoritySnapshotRoot,
        cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
        databasePath,
        manifest,
        manifestPath,
        packageContext,
        packageIdentity: fixturePackageIdentity,
        sourcePath,
    };
}

function rewriteSnapshotManifestArtifact(fixture) {
    const stat = fs.statSync(fixture.databasePath);
    fixture.manifest.snapshot.sha256 = sha256File(fixture.databasePath);
    fixture.manifest.snapshot.sizeBytes = stat.size;
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
}

function createRunnableAuthoritySnapshotFixture() {
    const fixture = createAuthoritySnapshotFixture();
    fs.rmSync(fixture.sourcePath);
    let database = new Database(fixture.sourcePath);
    try {
        seedContinuousDatabase(database, path.join(path.dirname(fixture.sourcePath), 'stores'));
    }
    finally {
        database.close();
    }
    fs.rmSync(fixture.databasePath);
    const onlineBackup = runReadonlySqliteOnlineBackupSync({
        sourceDatabasePath: fixture.sourcePath,
        destinationPath: fixture.databasePath,
        ownedTempRoot: path.dirname(fixture.databasePath),
    });
    const sourceStat = fs.statSync(fixture.sourcePath);
    const sourceArtifact = {
        sha256: sha256File(fixture.sourcePath),
        sizeBytes: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
    };
    fixture.manifest.exportedAt = '2026-07-22T19:59:00.000Z';
    fixture.manifest.backup.startedAt = '2026-07-22T19:58:00.000Z';
    fixture.manifest.backup.completedAt = fixture.manifest.exportedAt;
    fixture.manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
    fixture.manifest.backup.remainingPages = onlineBackup.observedBackup.remainingPages;
    fixture.manifest.source.realPath = fs.realpathSync.native(fixture.sourcePath);
    fixture.manifest.source.artifactBefore = { ...sourceArtifact };
    fixture.manifest.source.artifactAfter = { ...sourceArtifact };
    fixture.manifest.snapshot.realPath = fs.realpathSync.native(fixture.databasePath);
    rewriteSnapshotManifestArtifact(fixture);
    const canonicalEvidenceRoot = path.join(fixture.authoritySnapshotRoot, '..', 'codex-evidence');
    return {
        ...fixture,
        canonicalEvidenceRoot,
        context: {
            ...fixture.packageContext,
            Database,
            authoritySnapshotRoot: fixture.authoritySnapshotRoot,
            canonicalEvidenceRoot,
            continuousOperationOutputRoot: path.join(canonicalEvidenceRoot, 'continuous-operation'),
            now: () => new Date(generatedAt),
            randomUUID: () => '00000000-0000-4000-8000-000000000001',
            writeStdout: () => { },
        },
    };
}

function runnableArgs(fixture, outputPath) {
    return [
        '--authority-snapshot-manifest', fixture.manifestPath,
        '--store', 'shc001',
        '--store', 'shc002',
        '--date-from', dates[0],
        '--date-to', dates.at(-1),
        ...(outputPath ? ['--output', outputPath] : []),
    ];
}
export { createAuthoritySnapshotFixture, rewriteSnapshotManifestArtifact, createRunnableAuthoritySnapshotFixture, runnableArgs };
