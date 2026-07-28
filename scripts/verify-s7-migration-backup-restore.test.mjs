import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  executeOfflineMigration,
  loadLocalDbRuntime,
  parseOfflineMigrationArgs,
  sha256File,
} = require('./migrate-current-user-db.js');
const {
  parseS7VerifierArgs,
  verifyS7MigrationBackupRestore,
} = require('./verify-s7-migration-backup-restore.js');

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('S7 offline migration and recovery verifier', () => {
  it('requires explicit absolute source, SHA, and isolated work directory', () => {
    expect(() => parseOfflineMigrationArgs(['node', 'script'])).toThrow(/--db is required/i);
    expect(() => parseOfflineMigrationArgs([
      'node', 'script', '--db', 'relative.db', '--expected-sha256', 'a'.repeat(64),
      '--work-dir', 'relative-work',
    ])).toThrow(/absolute path/i);
    expect(() => parseS7VerifierArgs(['node', 'script', '--manifest', 'relative.json']))
      .toThrow(/absolute path/i);
  });

  it('upgrades only a bound v7 copy and independently verifies its pre-v9 restore', () => {
    const root = tempDirectory();
    const sourceDirectory = path.join(root, 'source');
    const workDir = path.join(root, 'work');
    fs.mkdirSync(sourceDirectory);
    const sourcePath = path.join(sourceDirectory, 'amazon-ai-ops.db');
    createV7Source(sourcePath);
    const sourceSha256 = sha256File(sourcePath);
    const manifestPath = path.join(workDir, 'offline-upgrade-evidence.json');

    const evidence = executeOfflineMigration({
      db: sourcePath,
      expectedSha256: sourceSha256,
      workDir,
      out: manifestPath,
      execute: true,
    });
    expect(evidence).toMatchObject({
      kind: 's7-offline-db-upgrade',
      passed: true,
      source: { version: 7, sha256: sourceSha256 },
      targetVersion: 9,
      preservationFailures: [],
      recoveryPreflight: { canRestore: true, sourceVersion: 7, targetVersion: 9 },
      restore: { version: 7, integrityCheck: 'ok' },
    });
    expect(sha256File(sourcePath)).toBe(sourceSha256);
    expect(fs.existsSync(manifestPath)).toBe(true);

    const verification = verifyS7MigrationBackupRestore(manifestPath);
    expect(verification.passed).toBe(true);
    expect(verification.summary.failed).toBe(0);
    expect(verification.checks.map((check) => check.code)).toContain('MIGRATIONS_1_TO_9_APPLIED');

    fs.appendFileSync(evidence.restore.destinationPath, 'tampered');
    const tampered = verifyS7MigrationBackupRestore(manifestPath);
    expect(tampered.passed).toBe(false);
    expect(tampered.checks).toContainEqual(expect.objectContaining({
      code: 'RESTORED_COPY_HASH_MATCH',
      passed: false,
    }));
  }, 30_000);
});

function createV7Source(databasePath) {
  const runtime = loadLocalDbRuntime();
  const database = runtime.initSqlite(databasePath);
  try {
    database.pragma('foreign_keys = OFF');
    const executionTables = [
      'ad_execution_domain_reconciliations',
      'ad_execution_evidence',
      'ad_execution_events',
      'ad_execution_jobs',
      'ad_execution_batches',
      'ad_keyword_alias_resolutions',
      'ad_keyword_identity_versions',
    ];
    for (const table of executionTables) database.exec(`DROP TABLE IF EXISTS "${table}"`);
    database.prepare('DELETE FROM schema_migrations WHERE version IN (8, 9)').run();
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('s7-script-sentinel', 'preserve-me', '2026-07-23T00:00:00.000Z')
    `).run();
    database.pragma('foreign_keys = ON');
  } finally {
    database.close();
  }
}

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-s7-script-'));
  tempDirectories.push(directory);
  return directory;
}
