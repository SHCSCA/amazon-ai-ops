import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from '../db';
import {
  ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM,
  ANALYSIS_AUTHORITY_MIGRATION_VERSION,
  ANALYSIS_AUTHORITY_TABLES,
  AnalysisAuthorityMigrationError,
} from './0007-analysis-authority';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-analysis-v7-'));
  tempDirs.push(directory);
  return path.join(directory, 'app.db');
}

describe('Analysis authority migration v7', () => {
  it('installs five append-only authority tables and reopens idempotently', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    let first: unknown;
    try {
      first = database.prepare(`
        SELECT checksum, status, manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(ANALYSIS_AUTHORITY_MIGRATION_VERSION);
      expect(first).toEqual(expect.objectContaining({
        checksum: ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM,
        status: 'applied',
      }));
      const tables = new Set((database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `).all() as Array<{ name: string }>).map((row) => row.name));
      expect(ANALYSIS_AUTHORITY_TABLES.every((table) => tables.has(table))).toBe(true);
      const columns = (database.pragma('table_info(analysis_evidence_packages)') as Array<{ name: string }>)
        .map((column) => column.name);
      expect(columns).not.toContain('file_path');
      expect(columns).not.toContain('source_file');
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get())
        .toEqual({ count: 8 });
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      expect(reopened.prepare(`
        SELECT checksum, status, manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(ANALYSIS_AUTHORITY_MIGRATION_VERSION)).toEqual(first);
    } finally {
      reopened.close();
    }
  });

  it('fails closed when an append-only trigger is removed after application', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.exec('DROP TRIGGER trg_analysis_proposal_snapshots_append_only_update');
    } finally {
      database.close();
    }
    expect(() => initSqlite(databasePath)).toThrow(AnalysisAuthorityMigrationError);
  });

  it('rejects a mismatched migration checksum without rewriting history', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.prepare(`
        UPDATE schema_migrations SET checksum = 'tampered-v7' WHERE version = 7
      `).run();
    } finally {
      database.close();
    }
    expect(() => initSqlite(databasePath)).toThrow(/checksum/i);
    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(inspected.prepare(`
        SELECT checksum FROM schema_migrations WHERE version = 7
      `).get()).toEqual({ checksum: 'tampered-v7' });
    } finally {
      inspected.close();
    }
  });
});
