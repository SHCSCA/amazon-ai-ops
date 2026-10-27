// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { Database, describe, expect, fs, it, path, run, runReadonlySqliteOnlineBackupSync } from './s7-continuous-test-environment.mjs';
import { createRunnableAuthoritySnapshotFixture, rewriteSnapshotManifestArtifact, runnableArgs } from './s7-continuous-test-authority.mjs';
import { sha256File } from './s7-continuous-test-artifacts.mjs';
describe('S7 continuous operation verifier', () => {
it('rejects protected or nested output paths without creating evidence', () => {
    const fixture = createRunnableAuthoritySnapshotFixture();
    try {
        const protectedOutput = path.join(path.dirname(fixture.sourcePath), 'stores', 'shc001', 'continuous.json');
        expect(() => run(runnableArgs(fixture, protectedOutput), fixture.context))
            .toThrow(/direct child|canonical continuous-operation/);
        expect(fs.existsSync(protectedOutput)).toBe(false);
        const nestedOutput = path.join(fixture.context.continuousOperationOutputRoot, 'nested', 'continuous.json');
        expect(() => run(runnableArgs(fixture, nestedOutput), fixture.context))
            .toThrow(/direct child/);
        expect(fs.existsSync(nestedOutput)).toBe(false);
    }
    finally {
        fixture.cleanup();
    }
});

it('never publishes final output when source, snapshot or package bytes change after the staging write', () => {
    for (const target of ['source', 'snapshot', 'package']) {
        const fixture = createRunnableAuthoritySnapshotFixture();
        try {
            const outputPath = path.join(fixture.context.continuousOperationOutputRoot, `changed-${target}.json`);
            const mutationPath = target === 'source'
                ? fixture.sourcePath
                : target === 'snapshot'
                    ? fixture.databasePath
                    : fixture.packageContext.executablePath;
            const context = {
                ...fixture.context,
                afterOutputWritten: ({ outputPath: finalPath, stagingPath, finalPathPublished }) => {
                    expect(fs.existsSync(stagingPath)).toBe(true);
                    expect(fs.existsSync(finalPath)).toBe(false);
                    expect(finalPathPublished).toBe(false);
                    fs.appendFileSync(mutationPath, `changed-${target}`);
                },
            };
            expect(() => run(runnableArgs(fixture, outputPath), context))
                .toThrow(/changed|package identity/i);
            expect(fs.existsSync(outputPath)).toBe(false);
            const outputRoot = path.dirname(outputPath);
            expect(fs.existsSync(outputRoot)
                ? fs.readdirSync(outputRoot).filter((name) => name.endsWith('.tmp'))
                : []).toEqual([]);
        }
        finally {
            fixture.cleanup();
        }
    }
});

it('fails closed on a missing authority table and leaves no output', () => {
    const fixture = createRunnableAuthoritySnapshotFixture();
    try {
        const database = new Database(fixture.sourcePath);
        database.exec('DROP TABLE report_import_reconciliations');
        database.close();
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
        fixture.manifest.source.artifactBefore = sourceArtifact;
        fixture.manifest.source.artifactAfter = sourceArtifact;
        fixture.manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
        rewriteSnapshotManifestArtifact(fixture);
        const outputPath = path.join(fixture.context.continuousOperationOutputRoot, 'missing-table.json');
        expect(() => run(runnableArgs(fixture, outputPath), fixture.context))
            .toThrow(/no such table/i);
        expect(fs.existsSync(outputPath)).toBe(false);
    }
    finally {
        fixture.cleanup();
    }
});

it('rejects a committed WAL-only live authority change after the selected snapshot', () => {
    const fixture = createRunnableAuthoritySnapshotFixture();
    let database;
    try {
        database = new Database(fixture.sourcePath);
        database.pragma('journal_mode = WAL');
        database.pragma('wal_autocheckpoint = 0');
        database.pragma('wal_checkpoint(TRUNCATE)');
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
        fixture.manifest.source.artifactBefore = sourceArtifact;
        fixture.manifest.source.artifactAfter = sourceArtifact;
        fixture.manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
        rewriteSnapshotManifestArtifact(fixture);
        const mainHashBefore = sha256File(fixture.sourcePath);
        const mainMtimeBefore = fs.statSync(fixture.sourcePath).mtimeMs;
        database.exec(`
        CREATE TABLE authority_currentness_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_currentness_drift VALUES ('grant-1', 1);
      `);
        expect(fs.statSync(`${fixture.sourcePath}-wal`).size).toBeGreaterThan(0);
        expect(sha256File(fixture.sourcePath)).toBe(mainHashBefore);
        expect(fs.statSync(fixture.sourcePath).mtimeMs).toBe(mainMtimeBefore);
        const outputPath = path.join(fixture.context.continuousOperationOutputRoot, 'wal-drift.json');
        expect(() => run(runnableArgs(fixture, outputPath), fixture.context))
            .toThrow(/online backup does not match the selected authority snapshot/i);
        expect(fs.existsSync(outputPath)).toBe(false);
    }
    finally {
        if (database)
            database.close();
        fixture.cleanup();
    }
});
});
