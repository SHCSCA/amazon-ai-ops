import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const Database = createRequire(
  path.join(process.cwd(), 'packages', 'local-db', 'package.json'),
)('better-sqlite3');
const {
  assertMatchingAuthorityCurrentnessProofs,
  captureAuthoritySnapshotCurrentness,
  runReadonlySqliteOnlineBackupSync,
} = require('./sqlite-authority-currentness.js');

const tempRoots = new Set();

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { force: true, recursive: true });
  }
  tempRoots.clear();
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-currentness-test-'));
  tempRoots.add(root);
  return root;
}

function artifact(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    sizeBytes: bytes.length,
  };
}

describe('SQLite authority currentness helper', () => {
  it('captures and cleans a read-only online backup that matches the selected snapshot', () => {
    const root = tempRoot();
    const sourcePath = path.join(root, 'amazon-ai-ops.db');
    const snapshotPath = path.join(root, 'authority-snapshot.db');
    const captureRoot = path.join(root, 'captures');
    fs.mkdirSync(captureRoot);
    const database = new Database(sourcePath);
    database.exec(`
      CREATE TABLE authority_state (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      INSERT INTO authority_state VALUES ('grant-1', 1);
    `);
    database.close();

    const backup = runReadonlySqliteOnlineBackupSync({
      sourceDatabasePath: sourcePath,
      destinationPath: snapshotPath,
      ownedTempRoot: root,
    });
    expect(backup).toMatchObject({
      method: 'readonly-sqlite-online-backup',
      source: { openedReadOnly: true, queryOnly: true },
      observedBackup: { remainingPages: 0 },
    });
    const proof = captureAuthoritySnapshotCurrentness({
      sourceDatabasePath: sourcePath,
      expectedSnapshotArtifact: artifact(snapshotPath),
      captureLabel: 'before-work',
    }, {
      now: () => new Date('2026-07-28T00:00:00.000Z'),
      randomUUID: () => 'capture-one',
      tempRoot: captureRoot,
    });
    expect(proof).toMatchObject({
      captureLabel: 'before-work',
      capturedAt: '2026-07-28T00:00:00.000Z',
      matchesSelectedSnapshot: true,
    });
    expect(assertMatchingAuthorityCurrentnessProofs(
      [proof],
      artifact(snapshotPath),
      'test currentness',
    )).toMatchObject({ proofCount: 1 });
    expect(fs.readdirSync(captureRoot)).toEqual([]);
  });

  it('rejects an old snapshot after a committed WAL-only authority change', () => {
    const root = tempRoot();
    const sourcePath = path.join(root, 'amazon-ai-ops.db');
    const snapshotPath = path.join(root, 'authority-snapshot.db');
    const captureRoot = path.join(root, 'captures');
    fs.mkdirSync(captureRoot);
    const database = new Database(sourcePath);
    database.pragma('journal_mode = WAL');
    database.pragma('wal_autocheckpoint = 0');
    database.exec(`
      CREATE TABLE authority_state (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      INSERT INTO authority_state VALUES ('grant-1', 1);
    `);
    database.pragma('wal_checkpoint(TRUNCATE)');
    runReadonlySqliteOnlineBackupSync({
      sourceDatabasePath: sourcePath,
      destinationPath: snapshotPath,
      ownedTempRoot: root,
    });
    const expectedSnapshot = artifact(snapshotPath);
    const mainBefore = artifact(sourcePath);
    const mainStatBefore = fs.statSync(sourcePath);

    database.prepare(`
      UPDATE authority_state SET revision = 2 WHERE id = 'grant-1'
    `).run();
    const walPath = `${sourcePath}-wal`;
    expect(fs.statSync(walPath).size).toBeGreaterThan(0);
    expect(artifact(sourcePath)).toEqual(mainBefore);
    expect(fs.statSync(sourcePath).mtimeMs).toBe(mainStatBefore.mtimeMs);
    expect(() => captureAuthoritySnapshotCurrentness({
      sourceDatabasePath: sourcePath,
      expectedSnapshotArtifact: expectedSnapshot,
      captureLabel: 'after-wal-commit',
    }, {
      randomUUID: () => 'capture-wal-drift',
      tempRoot: captureRoot,
    })).toThrow(/does not match the selected authority snapshot/i);
    expect(fs.readdirSync(captureRoot)).toEqual([]);
    database.close();
  });
});
