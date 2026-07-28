import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from '../db';
import {
  MISSION_DOMAIN_MIGRATION_CHECKSUM,
  MISSION_DOMAIN_MIGRATION_VERSION,
  MISSION_DOMAIN_TABLES,
  MissionDomainMigrationError,
} from './0006-mission-domain';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-mission-v6-'));
  tempDirs.push(directory);
  return path.join(directory, 'app.db');
}

describe('Mission domain migration v6', () => {
  it('installs the complete authority schema, records v6, and reopens idempotently', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    let first: unknown;
    try {
      first = database.prepare(`
        SELECT checksum, status, started_at AS startedAt, applied_at AS appliedAt,
               manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(MISSION_DOMAIN_MIGRATION_VERSION);
      expect(first).toEqual(expect.objectContaining({
        checksum: MISSION_DOMAIN_MIGRATION_CHECKSUM,
        status: 'applied',
      }));
      const tables = new Set((database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `).all() as Array<{ name: string }>).map((row) => row.name));
      expect(MISSION_DOMAIN_TABLES.every((table) => tables.has(table))).toBe(true);
      expect(database.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'decisions'
      `).get()).toEqual(expect.objectContaining({
        sql: expect.not.stringMatching(/UNIQUE\s*\(store_id,\s*mission_id,\s*action_revision\)/i),
      }));
      expect((database.pragma('table_info(mission_grants)') as Array<{ name: string }>)
        .map((column) => column.name)).toContain('decision_ids_json');
      expect(database.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mission_grants'
      `).get()).toEqual(expect.objectContaining({
        sql: expect.stringMatching(/UNIQUE\s*\(store_id,\s*mission_id,\s*action_revision\)/i),
      }));
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get())
        .toEqual({ count: 9 });
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      expect(reopened.prepare(`
        SELECT checksum, status, started_at AS startedAt, applied_at AS appliedAt,
               manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(MISSION_DOMAIN_MIGRATION_VERSION)).toEqual(first);
    } finally {
      reopened.close();
    }
  });

  it('fails closed if an append-only trigger is removed after application', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.exec('DROP TRIGGER trg_causal_events_append_only_update');
    } finally {
      database.close();
    }

    expect(() => initSqlite(databasePath)).toThrow(MissionDomainMigrationError);
    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(inspected.prepare(`
        SELECT status FROM schema_migrations WHERE version = 6
      `).get()).toEqual({ status: 'applied' });
    } finally {
      inspected.close();
    }
  });

  it('rejects a mismatched checksum instead of rewriting migration history', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.prepare(`
        UPDATE schema_migrations SET checksum = 'tampered-v6' WHERE version = 6
      `).run();
    } finally {
      database.close();
    }

    expect(() => initSqlite(databasePath)).toThrow(/checksum/i);
    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(inspected.prepare(`
        SELECT checksum FROM schema_migrations WHERE version = 6
      `).get()).toEqual({ checksum: 'tampered-v6' });
    } finally {
      inspected.close();
    }
  });
});
