import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UpgradeBackupError,
  getUpgradeBackupRecoveryPreflight,
  prepareUpgradeBackup,
  restoreUpgradeBackupTo,
} from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

const tempDirectories: string[] = [];
const target = {
  targetVersion: 8,
  targetName: 'execution-authority-v8',
  targetChecksum: 'execution-authority-v8-test',
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('whole-chain schema upgrade backup', () => {
  it('binds a v7 source snapshot by schema, row counts, integrity, and SHA then reuses it', () => {
    const { database, databasePath } = createVersionedDatabase();
    let first: UpgradeBackupManifest;
    try {
      first = prepareUpgradeBackup(database, target);
      expect(first).toMatchObject({
        status: 'created',
        sourceVersion: 7,
        targetVersion: 8,
        integrityCheck: 'ok',
        backupIntegrityCheck: 'ok',
        tableRowCounts: { payload: 2, schema_migrations: 1 },
      });
      expect(first.schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(first.backupPath!)).toBe(true);
      expect(fs.existsSync(first.manifestPath!)).toBe(true);

      const reused = prepareUpgradeBackup(database, target);
      expect(reused.status).toBe('reused');
      expect(reused.sha256).toBe(first.sha256);
      expect(getUpgradeBackupRecoveryPreflight(reused)).toMatchObject({
        canRestore: true,
        sourceVersion: 7,
        targetVersion: 8,
        schemaFingerprintMatches: true,
        tableRowCountsMatch: true,
      });
    } finally {
      database.close();
    }

    const destinationPath = path.join(path.dirname(databasePath), 'restored-v7.db');
    const restored = restoreUpgradeBackupTo(first, destinationPath);
    expect(restored).toMatchObject({ version: 8, destinationPath: path.resolve(destinationPath) });
    const inspected = new Database(destinationPath, { readonly: true, fileMustExist: true });
    try {
      expect(inspected.prepare('SELECT value FROM payload ORDER BY id').all()).toEqual([
        { value: 'preserve-one' },
        { value: 'preserve-two' },
      ]);
      expect(inspected.prepare(`SELECT MAX(version) AS version FROM schema_migrations`).get())
        .toEqual({ version: 7 });
    } finally {
      inspected.close();
    }
  });

  it('refuses an unbound backup artifact instead of claiming or replacing it', () => {
    const { database, databasePath } = createVersionedDatabase();
    const backupPath = `${path.resolve(databasePath)}.pre-upgrade-to-v8.bak`;
    const sentinel = Buffer.from('foreign operator backup');
    fs.writeFileSync(backupPath, sentinel);
    try {
      expect(() => prepareUpgradeBackup(database, target)).toThrow(/unbound/i);
      expect(fs.readFileSync(backupPath)).toEqual(sentinel);
    } finally {
      database.close();
    }
  });

  it('fails before writing a pending manifest when disk headroom is insufficient', () => {
    const { database, databasePath } = createVersionedDatabase();
    try {
      expect(() => prepareUpgradeBackup(database, { ...target, availableBytes: 0 }))
        .toThrow(/insufficient disk space/i);
      expect(fs.existsSync(`${path.resolve(databasePath)}.pre-upgrade-to-v8.bak`)).toBe(false);
      expect(fs.existsSync(`${path.resolve(databasePath)}.pre-upgrade-to-v8.manifest.json.pending`)).toBe(false);
    } finally {
      database.close();
    }
  });

  it('detects backup tampering and never publishes a corrupt restore destination', () => {
    const { database, databasePath } = createVersionedDatabase();
    let manifest: UpgradeBackupManifest;
    try {
      manifest = prepareUpgradeBackup(database, target);
    } finally {
      database.close();
    }
    fs.appendFileSync(manifest.backupPath!, 'tampered');
    const preflight = getUpgradeBackupRecoveryPreflight(manifest);
    expect(preflight.canRestore).toBe(false);
    expect(preflight.blockers.join(' ')).toMatch(/SHA-256/i);
    const destinationPath = path.join(path.dirname(databasePath), 'must-not-exist.db');
    expect(() => restoreUpgradeBackupTo(manifest, destinationPath)).toThrow(UpgradeBackupError);
    expect(fs.existsSync(destinationPath)).toBe(false);
  });

  it('treats memory, empty, and already-current databases as non-applicable', () => {
    const memory = new Database(':memory:');
    try {
      memory.exec('CREATE TABLE payload (id INTEGER PRIMARY KEY)');
      expect(prepareUpgradeBackup(memory, target)).toMatchObject({
        status: 'not_applicable',
        reason: 'memory_database',
      });
    } finally {
      memory.close();
    }

    const emptyPath = tempDatabasePath();
    const empty = new Database(emptyPath);
    try {
      expect(prepareUpgradeBackup(empty, target)).toMatchObject({
        status: 'not_applicable',
        reason: 'empty_database',
      });
    } finally {
      empty.close();
    }

    const current = new Database(tempDatabasePath());
    try {
      createMigrationTable(current, 8);
      expect(prepareUpgradeBackup(current, target)).toMatchObject({
        status: 'not_applicable',
        reason: 'target_already_applied',
      });
    } finally {
      current.close();
    }
  });

  it('rejects a final sidecar whose target checksum no longer matches', () => {
    const { database } = createVersionedDatabase();
    try {
      const manifest = prepareUpgradeBackup(database, target);
      expect(createHash('sha256').update(fs.readFileSync(manifest.backupPath!)).digest('hex'))
        .toBe(manifest.sha256);
      expect(() => prepareUpgradeBackup(database, {
        ...target,
        targetChecksum: 'different-target-contract',
      })).toThrow(/not bound/i);
    } finally {
      database.close();
    }
  });
});

function createVersionedDatabase(): { database: Database.Database; databasePath: string } {
  const databasePath = tempDatabasePath();
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  createMigrationTable(database, 7);
  database.exec(`
    CREATE TABLE payload (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO payload (id, value) VALUES (1, 'preserve-one'), (2, 'preserve-two');
  `);
  return { database, databasePath };
}

function createMigrationTable(database: Database.Database, version: number): void {
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      applied_at TEXT,
      error_message TEXT,
      manifest_json TEXT NOT NULL,
      result_json TEXT
    );
  `);
  database.prepare(`
    INSERT INTO schema_migrations (
      version, name, checksum, status, started_at, applied_at, manifest_json
    ) VALUES (?, ?, ?, 'applied', ?, ?, '{}')
  `).run(version, `migration-v${version}`, `checksum-v${version}`, '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:01.000Z');
}

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-upgrade-backup-'));
  tempDirectories.push(directory);
  return path.join(directory, 'app.db');
}
