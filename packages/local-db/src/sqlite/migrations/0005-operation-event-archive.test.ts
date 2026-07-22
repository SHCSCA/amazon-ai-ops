import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoreId } from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { OperationEventRepository } from '../repositories/operation-event-repo';
import {
  OPERATION_EVENT_ARCHIVE_INDEX,
  OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM,
  OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
  OperationEventArchiveMigrationError,
} from './0005-operation-event-archive';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-event-archive-'));
  tempDirs.push(directory);
  return path.join(directory, 'app.db');
}

function createLegacyOperationEventsTable(
  databasePath: string,
  options: { withLazyArchiveColumns?: boolean } = {},
): void {
  const legacy = new Database(databasePath);
  try {
    legacy.exec(`
      CREATE TABLE operation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_date TEXT NOT NULL,
        store_name TEXT NOT NULL,
        marketplace_code TEXT NOT NULL,
        asin TEXT,
        campaign_name TEXT,
        ad_group_name TEXT,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        impact_expectation TEXT,
        notes TEXT,
        evidence_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
        ${options.withLazyArchiveColumns ? `,
          archived_at TEXT,
          archive_revision INTEGER NOT NULL DEFAULT 0
        ` : ''}
      );
      INSERT INTO operation_events (
        id, event_date, store_name, marketplace_code, asin, event_type,
        title, notes, evidence_path, created_at, updated_at
        ${options.withLazyArchiveColumns ? ', archived_at, archive_revision' : ''}
      ) VALUES (
        7, '2026-07-20', 'Legacy US Store', 'US', 'B0EVENT001', 'promotion',
        'Legacy promotion', 'Preserve these notes', 'C:/legacy/evidence.png',
        '2026-07-20 10:00:00', '2026-07-20 11:00:00'
        ${options.withLazyArchiveColumns ? ", '2026-07-21 09:00:00', 1" : ''}
      );
    `);
  } finally {
    legacy.close();
  }
}

describe('operation event archive migration v5', () => {
  it('installs verified archive authority, records v5, and survives reopen', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    let firstMigration: unknown;
    try {
      firstMigration = database.prepare(`
        SELECT checksum, status, started_at AS startedAt, applied_at AS appliedAt,
               manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION);
      expect(firstMigration).toEqual(expect.objectContaining({
        checksum: OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM,
        status: 'applied',
      }));
      expect(database.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?
      `).get(OPERATION_EVENT_ARCHIVE_INDEX)).toEqual(expect.objectContaining({
        sql: expect.stringMatching(/store_id, archived_at, event_date DESC, id DESC/i),
      }));
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get())
        .toEqual({ count: 6 });
    } finally {
      database.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      expect(reopened.prepare(`
        SELECT checksum, status, started_at AS startedAt, applied_at AS appliedAt,
               manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION)).toEqual(firstMigration);
    } finally {
      reopened.close();
    }
  });

  it('upgrades a pre-archive database without changing or deleting any event row', () => {
    const databasePath = tempDatabasePath();
    createLegacyOperationEventsTable(databasePath);

    const upgraded = initSqlite(databasePath);
    let storeId: StoreId;
    try {
      const rows = upgraded.prepare(`
        SELECT id, store_id AS storeId, title, notes, evidence_path AS evidencePath,
               archived_at AS archivedAt, archive_revision AS archiveRevision
        FROM operation_events
      `).all();
      expect(rows).toEqual([{
        id: 7,
        storeId: expect.stringMatching(/^legacy-/),
        title: 'Legacy promotion',
        notes: 'Preserve these notes',
        evidencePath: 'C:/legacy/evidence.png',
        archivedAt: null,
        archiveRevision: 0,
      }]);
      storeId = (rows[0] as { storeId: StoreId }).storeId;
      const migration = upgraded.prepare(`
        SELECT manifest_json AS manifestJson, result_json AS resultJson
        FROM schema_migrations WHERE version = 5
      `).get() as { manifestJson: string; resultJson: string };
      expect(JSON.parse(migration.manifestJson)).toEqual(expect.objectContaining({
        operationEventRowCount: 1,
      }));
      expect(JSON.parse(migration.resultJson)).toEqual(expect.objectContaining({
        status: 'applied',
        preservedEventRows: 1,
      }));
    } finally {
      upgraded.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      const events = new OperationEventRepository(reopened);
      expect(events.archiveForStore(storeId!, 7)).toBe(true);
      expect(events.findByScopeForStore(storeId!)).toEqual([]);
      expect(events.restoreForStore(storeId!, 7)).toBe(true);
      expect(events.findByScopeForStore(storeId!)).toEqual([
        expect.objectContaining({
          id: 7,
          title: 'Legacy promotion',
          archiveRevision: 2,
          archivedAt: undefined,
        }),
      ]);
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM operation_events').get())
        .toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  });

  it('adopts archive columns previously installed by the lazy repository upgrade', () => {
    const databasePath = tempDatabasePath();
    createLegacyOperationEventsTable(databasePath, { withLazyArchiveColumns: true });

    const upgraded = initSqlite(databasePath);
    try {
      expect(upgraded.prepare(`
        SELECT id, title, archived_at AS archivedAt, archive_revision AS archiveRevision
        FROM operation_events
      `).all()).toEqual([{
        id: 7,
        title: 'Legacy promotion',
        archivedAt: '2026-07-21 09:00:00',
        archiveRevision: 1,
      }]);
      expect(upgraded.prepare(`
        SELECT status FROM schema_migrations WHERE version = 5
      `).get()).toEqual({ status: 'applied' });
    } finally {
      upgraded.close();
    }
  });

  it('fails closed on reopen when the applied archive index is missing', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.exec(`DROP INDEX ${OPERATION_EVENT_ARCHIVE_INDEX}`);
    } finally {
      database.close();
    }

    expect(() => initSqlite(databasePath)).toThrow(OperationEventArchiveMigrationError);
    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(inspected.prepare(`
        SELECT status FROM schema_migrations WHERE version = 5
      `).get()).toEqual({ status: 'applied' });
      expect(inspected.prepare('SELECT COUNT(*) AS count FROM operation_events').get())
        .toEqual({ count: 0 });
    } finally {
      inspected.close();
    }
  });

  it('rejects a mismatched recorded checksum instead of rewriting migration history', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      database.prepare(`
        UPDATE schema_migrations SET checksum = 'tampered-v5' WHERE version = 5
      `).run();
    } finally {
      database.close();
    }

    expect(() => initSqlite(databasePath)).toThrow(OperationEventArchiveMigrationError);
  });
});
