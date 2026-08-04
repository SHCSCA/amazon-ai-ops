import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import packageUiEvidence from './package-ui-evidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(path.join(root, 'packages', 'local-db', 'package.json'));
const Database = requireFromLocalDb('better-sqlite3');
const testTempRoot = path.join(root, 'output', 'codex-temp');

fs.mkdirSync(testTempRoot, { recursive: true });

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(testTempRoot, prefix));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function createCanonicalPackageFixture(tempDir) {
  const releaseRoot = path.join(tempDir, 'apps', 'desktop', 'release');
  const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
  const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
  fs.mkdirSync(path.join(appContentPath, 'dist', 'preload'), { recursive: true });
  fs.mkdirSync(path.join(appContentPath, 'dist', 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(appContentPath, 'playwright-browsers', 'chrome-win64'), { recursive: true });
  fs.writeFileSync(path.join(appContentPath, 'package.json'), JSON.stringify({
    name: '@amazon-ai-ops/desktop',
    version: '1.5.0',
    main: 'dist/main/index.js',
  }));
  fs.writeFileSync(executablePath, 'canonical-unpacked-package');
  fs.mkdirSync(path.dirname(mainBundlePath), { recursive: true });
  fs.writeFileSync(mainBundlePath, 'canonical-main-bundle');
  fs.writeFileSync(path.join(appContentPath, 'dist', 'preload', 'index.js'), 'canonical-preload');
  fs.writeFileSync(path.join(appContentPath, 'dist', 'renderer', 'index.html'), '<!doctype html>');
  fs.writeFileSync(
    path.join(appContentPath, 'playwright-browsers', 'chrome-win64', 'chrome.exe'),
    'canonical-chromium-runtime',
  );
  const appContent = packageUiEvidence.buildAppContentManifest(appContentPath);
  return {
    appContentPath,
    executablePath,
    mainBundlePath,
    packageIdentity: {
      executableSha256: sha256File(executablePath),
      appContentSha256: appContent.sha256.toUpperCase(),
      mainBundleSha256: sha256File(mainBundlePath),
    },
    releaseRoot,
  };
}

function createFixture(prefix = 'authority-snapshot-export-') {
  const tempDir = makeTempDir(prefix);
  const appData = path.join(tempDir, 'AppData', 'Roaming');
  const authorityDbPath = path.join(appData, '@amazon-ai-ops', 'desktop', 'amazon-ai-ops.db');
  const authoritySnapshotRoot = path.join(
    tempDir,
    'output',
    'codex-evidence',
    'authority-snapshots',
  );
  fs.mkdirSync(path.dirname(authorityDbPath), { recursive: true });
  const source = new Database(authorityDbPath);
  source.exec('CREATE TABLE authority_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  source.prepare('INSERT INTO authority_rows (value) VALUES (?)').run('canonical');
  source.close();
  const packageFixture = createCanonicalPackageFixture(tempDir);
  return {
    authorityDbPath,
    authoritySnapshotRoot,
    context: {
      ...packageFixture,
      authoritySnapshotRoot,
      env: { APPDATA: appData },
      now: () => new Date('2026-07-27T08:00:00.000Z'),
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    },
    packageFixture,
    tempDir,
  };
}

describe('Mission Control authority snapshot exporter', () => {
  it('exports the canonical AppData authority DB with online-backup, integrity, and package identity proof', async () => {
    const exporter = createRequire(import.meta.url)('./export-mission-control-authority-snapshot.js');
    const fixture = createFixture();
    const outputDirectory = path.join(fixture.authoritySnapshotRoot, 'accepted-export');

    const result = await exporter.exportAuthoritySnapshot({
      dbPath: fixture.authorityDbPath,
      outputDirectory,
    }, fixture.context);

    expect(result).toMatchObject({
      outputDirectory,
      manifestPath: path.join(outputDirectory, 'snapshot-manifest.json'),
      snapshotPath: path.join(outputDirectory, 'authority-snapshot.db'),
    });
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    expect(manifest).toMatchObject({
      kind: 'mission-control-authority-database-snapshot',
      schemaVersion: 'mission-control-authority-database-snapshot/v2',
      exportedAt: '2026-07-27T08:00:00.000Z',
      backup: {
        method: 'sqlite-online-backup',
        completed: true,
        remainingPages: 0,
      },
      source: {
        absolutePath: fixture.authorityDbPath,
        realPath: fixture.authorityDbPath,
        openedReadOnly: true,
        queryOnly: true,
        integrityCheck: ['ok'],
        foreignKeyCheck: [],
      },
      snapshot: {
        absolutePath: result.snapshotPath,
        realPath: result.snapshotPath,
        openedReadOnly: true,
        queryOnly: true,
        integrityCheck: ['ok'],
        foreignKeyCheck: [],
      },
      packageIdentity: fixture.packageFixture.packageIdentity,
    });
    expect(manifest.backup.totalPages).toBeGreaterThan(0);
    expect(manifest.snapshot.sha256).toBe(sha256File(result.snapshotPath));
    expect(manifest.snapshot.sizeBytes).toBe(fs.statSync(result.snapshotPath).size);
    const snapshot = new Database(result.snapshotPath, { readonly: true, fileMustExist: true });
    try {
      expect(snapshot.prepare('SELECT value FROM authority_rows ORDER BY id').pluck().all()).toEqual(['canonical']);
    } finally {
      snapshot.close();
    }
  });

  it('captures the latest committed WAL rows even when the source main file has not been checkpointed', async () => {
    const exporter = createRequire(import.meta.url)('./export-mission-control-authority-snapshot.js');
    const fixture = createFixture('authority-snapshot-wal-');
    const source = new Database(fixture.authorityDbPath);
    try {
      source.pragma('journal_mode = WAL');
      source.pragma('wal_autocheckpoint = 0');
      source.pragma('wal_checkpoint(TRUNCATE)');
      source.prepare('INSERT INTO authority_rows (value) VALUES (?)').run('latest-wal-commit');
      expect(fs.statSync(`${fixture.authorityDbPath}-wal`).size).toBeGreaterThan(0);

      const result = await exporter.exportAuthoritySnapshot({
        dbPath: fixture.authorityDbPath,
        outputDirectory: path.join(fixture.authoritySnapshotRoot, 'wal-export'),
      }, fixture.context);

      const snapshot = new Database(result.snapshotPath, { readonly: true, fileMustExist: true });
      try {
        expect(snapshot.prepare('SELECT value FROM authority_rows ORDER BY id').pluck().all()).toEqual([
          'canonical',
          'latest-wal-commit',
        ]);
      } finally {
        snapshot.close();
      }
      const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
      expect(manifest.source.artifactAfter.sha256).not.toBe(manifest.snapshot.sha256);
    } finally {
      source.close();
    }
  });

  it('rejects a --db path that is not one of the canonical AppData authority candidates', async () => {
    const exporter = createRequire(import.meta.url)('./export-mission-control-authority-snapshot.js');
    const fixture = createFixture('authority-snapshot-noncanonical-');
    const handMadeDb = path.join(fixture.tempDir, 'hand-made.db');
    fs.copyFileSync(fixture.authorityDbPath, handMadeDb);

    await expect(exporter.exportAuthoritySnapshot({
      dbPath: handMadeDb,
      outputDirectory: path.join(fixture.authoritySnapshotRoot, 'must-not-exist'),
    }, fixture.context)).rejects.toThrow(/not a canonical AppData authority candidate/i);
  });

  it('rejects source hard links and output roots that traverse a symbolic link or junction', async () => {
    const exporter = createRequire(import.meta.url)('./export-mission-control-authority-snapshot.js');
    const hardLinkFixture = createFixture('authority-snapshot-hardlink-');
    fs.linkSync(hardLinkFixture.authorityDbPath, path.join(hardLinkFixture.tempDir, 'authority-hardlink.db'));
    await expect(exporter.exportAuthoritySnapshot({
      dbPath: hardLinkFixture.authorityDbPath,
      outputDirectory: path.join(hardLinkFixture.authoritySnapshotRoot, 'must-not-exist'),
    }, hardLinkFixture.context)).rejects.toThrow(/exactly one hard link/i);

    const linkFixture = createFixture('authority-snapshot-reparse-');
    const realOutputRoot = path.join(linkFixture.tempDir, 'real-authority-snapshots');
    const linkedOutputRoot = path.join(linkFixture.tempDir, 'linked-authority-snapshots');
    fs.mkdirSync(realOutputRoot, { recursive: true });
    fs.symlinkSync(
      realOutputRoot,
      linkedOutputRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(exporter.exportAuthoritySnapshot({
      dbPath: linkFixture.authorityDbPath,
      outputDirectory: path.join(linkedOutputRoot, 'must-not-exist'),
    }, {
      ...linkFixture.context,
      authoritySnapshotRoot: linkedOutputRoot,
    })).rejects.toThrow(/symbolic link|junction|reparse point/i);
  });

  it('never overwrites an existing output target and rejects duplicate CLI options', async () => {
    const exporter = createRequire(import.meta.url)('./export-mission-control-authority-snapshot.js');
    const fixture = createFixture('authority-snapshot-existing-');
    const outputDirectory = path.join(fixture.authoritySnapshotRoot, 'existing-target');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'keep.txt'), 'preserve');

    await expect(exporter.exportAuthoritySnapshot({
      dbPath: fixture.authorityDbPath,
      outputDirectory,
    }, fixture.context)).rejects.toThrow(/already exists/i);
    expect(fs.readFileSync(path.join(outputDirectory, 'keep.txt'), 'utf8')).toBe('preserve');
    expect(() => exporter.parseArgs([
      '--db', fixture.authorityDbPath,
      '--db', fixture.authorityDbPath,
    ])).toThrow(/duplicate argument/i);
    await expect(exporter.run([], fixture.context)).rejects.toThrow(/--db/i);
  });

  it('removes its random temporary directory after an interrupted online backup', async () => {
    const exporter = createRequire(import.meta.url)('./export-mission-control-authority-snapshot.js');
    const fixture = createFixture('authority-snapshot-partial-cleanup-');
    class InterruptedDatabase {
      constructor(...args) {
        this.inner = new Database(...args);
      }

      pragma(...args) {
        return this.inner.pragma(...args);
      }

      async backup(destination) {
        fs.writeFileSync(destination, 'partial-snapshot');
        throw new Error('simulated online-backup interruption');
      }

      close() {
        this.inner.close();
      }
    }
    const outputDirectory = path.join(fixture.authoritySnapshotRoot, 'interrupted-export');

    await expect(exporter.exportAuthoritySnapshot({
      dbPath: fixture.authorityDbPath,
      outputDirectory,
    }, {
      ...fixture.context,
      Database: InterruptedDatabase,
    })).rejects.toThrow(/simulated online-backup interruption/i);
    expect(fs.existsSync(outputDirectory)).toBe(false);
    expect(fs.readdirSync(fixture.authoritySnapshotRoot)).toEqual([]);
  });

  it('opens the source read-only and leaves its database bytes and timestamp unchanged', async () => {
    const exporter = createRequire(import.meta.url)('./export-mission-control-authority-snapshot.js');
    const fixture = createFixture('authority-snapshot-source-readonly-');
    const before = {
      sha256: sha256File(fixture.authorityDbPath),
      mtimeMs: fs.statSync(fixture.authorityDbPath).mtimeMs,
    };

    const result = await exporter.exportAuthoritySnapshot({
      dbPath: fixture.authorityDbPath,
      outputDirectory: path.join(fixture.authoritySnapshotRoot, 'read-only-export'),
    }, fixture.context);

    const after = {
      sha256: sha256File(fixture.authorityDbPath),
      mtimeMs: fs.statSync(fixture.authorityDbPath).mtimeMs,
    };
    expect(after).toEqual(before);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    expect(manifest.source.artifactAfter).toEqual(manifest.source.artifactBefore);
  });
});
