import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from '../db';
import {
  EXECUTION_AUTHORITY_MIGRATION_CHECKSUM,
  EXECUTION_AUTHORITY_MIGRATION_VERSION,
  EXECUTION_AUTHORITY_TABLES,
  ExecutionAuthorityMigrationError,
} from './0008-execution-authority';
import type { UpgradeBackupManifest } from './types';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-execution-v8-'));
  tempDirs.push(directory);
  return path.join(directory, 'app.db');
}

describe('Execution authority migration v8', () => {
  it('installs the Stage 6 registry and append-only execution ledger idempotently', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    let first: unknown;
    try {
      first = database.prepare(`
        SELECT checksum, status, manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(EXECUTION_AUTHORITY_MIGRATION_VERSION);
      expect(first).toEqual(expect.objectContaining({
        checksum: EXECUTION_AUTHORITY_MIGRATION_CHECKSUM,
        status: 'applied',
      }));
      const parsedManifest = JSON.parse((first as { manifestJson: string }).manifestJson) as {
        upgradeBackup: UpgradeBackupManifest;
      };
      expect(parsedManifest.upgradeBackup).toMatchObject({
        kind: 'schema-upgrade-backup',
        targetVersion: 9,
      });
      const tables = new Set((database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `).all() as Array<{ name: string }>).map((row) => row.name));
      expect(EXECUTION_AUTHORITY_TABLES.every((table) => tables.has(table))).toBe(true);
      const evidenceColumns = (database.pragma('table_info(ad_execution_evidence)') as Array<{ name: string }>)
        .map((column) => column.name);
      expect(evidenceColumns).not.toContain('file_path');
      expect(evidenceColumns).not.toContain('page_url');
      expect(evidenceColumns).not.toContain('html');
      const identityColumns = (database.pragma('table_info(ad_keyword_identity_versions)') as Array<{ name: string }>)
        .map((column) => column.name);
      expect(identityColumns).toEqual(expect.arrayContaining([
        'source_authority_id', 'source_authority_proof_sha256', 'resolution_proof_sha256',
      ]));
      const jobColumns = (database.pragma('table_info(ad_execution_jobs)') as Array<{ name: string }>)
        .map((column) => column.name);
      expect(jobColumns).toEqual(expect.arrayContaining([
        'submit_intent_id', 'command_fingerprint',
      ]));
      const jobTableSql = String((database.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ad_execution_jobs'
      `).get() as { sql: string }).sql);
      expect(jobTableSql).toMatch(/ordinal\s+INTEGER\s+NOT\s+NULL\s+CHECK\s*\(ordinal\s+BETWEEN\s+1\s+AND\s+10\)/i);
      expect(jobTableSql).toMatch(
        /FOREIGN KEY\s*\(\s*store_id,\s*canonical_keyword_id,\s*object_revision,\s*ads_account_id,\s*campaign_id,\s*ad_group_id,\s*keyword_id\s*\)\s*REFERENCES\s+ad_keyword_identity_versions/i,
      );
      const reconciliationColumns = (database.pragma(
        'table_info(ad_execution_domain_reconciliations)',
      ) as Array<{ name: string }>).map((column) => column.name);
      expect(reconciliationColumns).toEqual(expect.arrayContaining([
        'store_id', 'batch_id', 'batch_status', 'evidence_ref_count',
        'completed_session_generation', 'completed_at',
      ]));
      expect(database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name = 'trg_ad_execution_domain_reconciliations_append_only_update'
      `).get()).toEqual({
        name: 'trg_ad_execution_domain_reconciliations_append_only_update',
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get())
        .toEqual({ count: 9 });
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      expect(reopened.prepare(`
        SELECT checksum, status, manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(EXECUTION_AUTHORITY_MIGRATION_VERSION)).toEqual(first);
    } finally {
      reopened.close();
    }
  });

  it('fails closed when an append-only trigger is removed after application', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.exec('DROP TRIGGER trg_ad_execution_events_append_only_update');
    } finally {
      database.close();
    }
    expect(() => initSqlite(databasePath)).toThrow(ExecutionAuthorityMigrationError);
  });

  it('fails closed when a required trigger name is reused with weaker SQL', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.exec(`
        DROP TRIGGER trg_ad_execution_events_append_only_update;
        CREATE TRIGGER trg_ad_execution_events_append_only_update
        AFTER UPDATE ON ad_execution_events BEGIN SELECT 1; END;
      `);
    } finally {
      database.close();
    }
    expect(() => initSqlite(databasePath)).toThrow(/trigger definition changed/i);
  });

  it('rejects a mismatched migration checksum without rewriting history', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.prepare(`UPDATE schema_migrations SET checksum = 'tampered-v8' WHERE version = 8`).run();
    } finally {
      database.close();
    }
    expect(() => initSqlite(databasePath)).toThrow(/checksum/i);
    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(inspected.prepare(`SELECT checksum FROM schema_migrations WHERE version = 8`).get())
        .toEqual({ checksum: 'tampered-v8' });
    } finally {
      inspected.close();
    }
  });
});
