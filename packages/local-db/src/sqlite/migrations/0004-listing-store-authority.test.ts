import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import {
  LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
  LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
  verifyListingStoreAuthoritySchema,
} from './0004-listing-store-authority';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-listing-migration-'));
  tempDirs.push(directory);
  return path.join(directory, 'app.db');
}

function preparePreV4Database(databasePath: string) {
  const storeId = normalizeStoreId('listing-v4-store');
  const database = initSqlite(databasePath);
  database.exec(`
    DROP INDEX IF EXISTS idx_listing_content_unique_store_asin;
    DROP TRIGGER IF EXISTS trg_listing_content_require_store_authority_insert;
    DROP TRIGGER IF EXISTS trg_listing_content_require_store_authority_update;
    DROP TRIGGER IF EXISTS trg_listing_content_versions_require_store_authority_insert;
    DROP TRIGGER IF EXISTS trg_listing_content_versions_require_store_authority_update;
    DELETE FROM schema_migrations WHERE version = 4;
  `);
  const backupPath = `${databasePath}.pre-listing-store-authority-v4.bak`;
  if (fs.existsSync(backupPath)) fs.rmSync(backupPath);
  database.prepare(`
    INSERT OR IGNORE INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES (?, 'listing-v4-profile', 'US', 'USD', 'Listing V4 Store',
      'active', 'America/Los_Angeles', datetime('now'), datetime('now'))
  `).run(storeId);
  return { database, storeId };
}

describe('listing store authority migration v4', () => {
  it('deterministically merges normalized duplicates and preserves loser evidence', () => {
    const databasePath = tempDatabasePath();
    const { database, storeId } = preparePreV4Database(databasePath);
    try {
      const older = database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, store_name, marketplace_code, title,
          bullets_json, version_label, created_at, updated_at
        ) VALUES (?, ' b0list0003 ', 'Listing V4 Store', 'US', 'Older current row',
          '["older bullet"]', 'older', '2026-07-20 01:00:00', '2026-07-20 01:00:00')
      `).run(storeId);
      const newer = database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, store_name, marketplace_code, title,
          bullets_json, version_label, created_at, updated_at
        ) VALUES (?, 'B0LIST0003', 'Listing V4 Store', 'US', 'Newer current row',
          '["newer bullet"]', 'newer', '2026-07-21 01:00:00', '2026-07-21 01:00:00')
      `).run(storeId);
      database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, store_name, marketplace_code,
          title, bullets_json, version_label, created_at
        ) VALUES (?, ?, 'B0LIST0003', 'Listing V4 Store', 'US',
          'Existing older version', '["existing version"]', 'v0', '2026-07-19 01:00:00')
      `).run(storeId, Number(older.lastInsertRowid));
      expect(Number(newer.lastInsertRowid)).toBeGreaterThan(Number(older.lastInsertRowid));
    } finally {
      database.close();
    }

    const upgraded = initSqlite(databasePath);
    try {
      const rows = upgraded.prepare(`
        SELECT id, asin, title FROM listing_content WHERE store_id = ?
      `).all(storeId);
      expect(rows).toEqual([
        { id: 2, asin: 'B0LIST0003', title: 'Newer current row' },
      ]);
      expect(upgraded.prepare(`
        SELECT listing_content_id AS listingContentId, title
        FROM listing_content_versions
        WHERE store_id = ?
        ORDER BY id
      `).all(storeId)).toEqual([
        { listingContentId: 2, title: 'Existing older version' },
        { listingContentId: 2, title: 'Older current row' },
      ]);
      expect(upgraded.prepare(`
        SELECT reason, status, resolved_store_id AS resolvedStoreId,
               resolution_note AS resolutionNote
        FROM store_migration_quarantine
        WHERE migration_version = 4 AND source_table = 'listing_content'
          AND source_row_id = '1'
      `).get()).toEqual(expect.objectContaining({
        reason: 'duplicate_normalized_asin_merged',
        status: 'resolved',
        resolvedStoreId: storeId,
        resolutionNote: expect.stringMatching(/listing 2/i),
      }));
      expect(upgraded.prepare(`
        SELECT checksum, status, result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(LISTING_STORE_AUTHORITY_MIGRATION_VERSION)).toEqual(expect.objectContaining({
        checksum: LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        status: 'applied',
        resultJson: expect.stringContaining('"mergedDuplicateRows":1'),
      }));
      expect(() => upgraded.prepare(`
        INSERT INTO listing_content (store_id, asin, store_name, marketplace_code, title)
        VALUES (?, ' b0list0003 ', 'Listing V4 Store', 'US', 'Duplicate')
      `).run(storeId)).toThrow(/unique/i);
    } finally {
      upgraded.close();
    }

  });

  it('preserves a non-NULL pending Listing duplicate while keeping the valid row authoritative', () => {
    const databasePath = tempDatabasePath();
    const { database, storeId } = preparePreV4Database(databasePath);
    let validId = 0;
    let pendingId = 0;
    let pendingVersionId = 0;
    try {
      validId = Number(database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, title, created_at, updated_at
        ) VALUES (?, 'B0PEND0001', 'Valid authoritative row',
          '2026-07-20 01:00:00', '2026-07-20 01:00:00')
      `).run(storeId).lastInsertRowid);
      pendingId = Number(database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, title, created_at, updated_at
        ) VALUES (?, ' b0pend0001 ', 'Newer but pending row',
          '2026-07-21 01:00:00', '2026-07-21 01:00:00')
      `).run(storeId).lastInsertRowid);
      pendingVersionId = Number(database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, title, created_at
        ) VALUES (?, ?, 'B0PEND0001', 'Pending version', '2026-07-21 01:00:00')
      `).run(storeId, pendingId).lastInsertRowid);
      const insertPending = database.prepare(`
        INSERT INTO store_migration_quarantine (
          migration_version, source_table, source_row_id, reason,
          candidate_store_ids_json, source_identity_json, status,
          created_at, updated_at
        ) VALUES (
          1, ?, ?, 'ambiguous_store_identity', ?, '{}', 'pending',
          datetime('now'), datetime('now')
        )
      `);
      insertPending.run('listing_content', String(pendingId), JSON.stringify([storeId, 'other-store']));
      insertPending.run(
        'listing_content_versions',
        String(pendingVersionId),
        JSON.stringify([storeId, 'other-store']),
      );
    } finally {
      database.close();
    }

    const upgraded = initSqlite(databasePath);
    try {
      expect(upgraded.prepare(`
        SELECT id, title, store_id AS storeId,
               store_authority_quarantined AS quarantined
        FROM listing_content
        ORDER BY id
      `).all()).toEqual([
        { id: validId, title: 'Valid authoritative row', storeId, quarantined: 0 },
        { id: pendingId, title: 'Newer but pending row', storeId, quarantined: 1 },
      ]);
      expect(upgraded.prepare(`
        SELECT listing_content_id AS listingContentId, store_id AS storeId,
               store_authority_quarantined AS quarantined
        FROM listing_content_versions
        WHERE id = ?
      `).get(pendingVersionId)).toEqual({
        listingContentId: pendingId,
        storeId,
        quarantined: 1,
      });
      expect(() => upgraded.prepare(`
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (?, 'b0pend0001', 'Conflicting valid row')
      `).run(storeId)).toThrow(/unique/i);
      expect(() => verifyListingStoreAuthoritySchema(upgraded)).not.toThrow();
    } finally {
      upgraded.close();
    }

  });

  it('does not claim a pending-quarantined ambiguous version while merging its parent', () => {
    const databasePath = tempDatabasePath();
    const { database, storeId } = preparePreV4Database(databasePath);
    let olderId = 0;
    let pendingVersionId = 0;
    try {
      olderId = Number(database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, title, created_at, updated_at
        ) VALUES (?, 'B0LIST0004', 'Older parent',
          '2026-07-20 01:00:00', '2026-07-20 01:00:00')
      `).run(storeId).lastInsertRowid);
      database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, title, created_at, updated_at
        ) VALUES (?, ' b0list0004 ', 'Newer parent',
          '2026-07-21 01:00:00', '2026-07-21 01:00:00')
      `).run(storeId);
      pendingVersionId = Number(database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, title, created_at
        ) VALUES (NULL, ?, 'B0LIST0004', 'Ambiguous historical version',
          '2026-07-19 01:00:00')
      `).run(olderId).lastInsertRowid);
      database.prepare(`
        INSERT INTO store_migration_quarantine (
          migration_version, source_table, source_row_id, reason,
          candidate_store_ids_json, source_identity_json, status,
          created_at, updated_at
        ) VALUES (
          1, 'listing_content_versions', ?, 'ambiguous_parent_store',
          ?, '{}', 'pending', datetime('now'), datetime('now')
        )
      `).run(String(pendingVersionId), JSON.stringify([storeId, 'another-store']));
    } finally {
      database.close();
    }

    const upgraded = initSqlite(databasePath);
    try {
      expect(upgraded.prepare(`
        SELECT listing_content_id AS listingContentId, store_id AS storeId
        FROM listing_content_versions
        WHERE id = ?
      `).get(pendingVersionId)).toEqual({
        listingContentId: olderId,
        storeId: null,
      });
      expect(upgraded.prepare(`
        SELECT status
        FROM store_migration_quarantine
        WHERE source_table = 'listing_content_versions'
          AND source_row_id = ?
      `).get(String(pendingVersionId))).toEqual({ status: 'pending' });
    } finally {
      upgraded.close();
    }
  });

  it('selects the newest keeper by SQLite time and uses id as a deterministic tie-breaker', () => {
    const databasePath = tempDatabasePath();
    const { database, storeId } = preparePreV4Database(databasePath);
    let actuallyNewestId = 0;
    let tieBreakerId = 0;
    try {
      database.prepare(`
        INSERT INTO listing_content (store_id, asin, title, updated_at)
        VALUES (?, 'B0MIXED001', 'ISO earlier but lexically later',
          '2026-07-21T01:00:00.000Z')
      `).run(storeId);
      actuallyNewestId = Number(database.prepare(`
        INSERT INTO listing_content (store_id, asin, title, updated_at)
        VALUES (?, ' b0mixed001 ', 'SQLite actually newer',
          '2026-07-21 23:00:00')
      `).run(storeId).lastInsertRowid);

      database.prepare(`
        INSERT INTO listing_content (store_id, asin, title, updated_at)
        VALUES (?, 'B0MIXED002', 'Equal timestamp lower id',
          '2026-07-21 12:00:00')
      `).run(storeId);
      tieBreakerId = Number(database.prepare(`
        INSERT INTO listing_content (store_id, asin, title, updated_at)
        VALUES (?, ' b0mixed002 ', 'Equal timestamp higher id',
          '2026-07-21 12:00:00')
      `).run(storeId).lastInsertRowid);
    } finally {
      database.close();
    }

    const upgraded = initSqlite(databasePath);
    try {
      expect(upgraded.prepare(`
        SELECT id, title
        FROM listing_content
        WHERE store_id = ? AND asin = 'B0MIXED001'
      `).get(storeId)).toEqual({
        id: actuallyNewestId,
        title: 'SQLite actually newer',
      });
      expect(upgraded.prepare(`
        SELECT id, title
        FROM listing_content
        WHERE store_id = ? AND asin = 'B0MIXED002'
      `).get(storeId)).toEqual({
        id: tieBreakerId,
        title: 'Equal timestamp higher id',
      });
    } finally {
      upgraded.close();
    }
  });

  it('isolates unowned duplicate rows instead of guessing an owner', () => {
    const databasePath = tempDatabasePath();
    const { database } = preparePreV4Database(databasePath);
    try {
      database.exec(`
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (NULL, 'B0LEGACY01', 'Unowned A');
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (NULL, ' b0legacy01 ', 'Unowned B');
      `);
    } finally {
      database.close();
    }

    const upgraded = initSqlite(databasePath);
    try {
      expect(upgraded.prepare(`
        SELECT COUNT(*) AS count FROM listing_content WHERE store_id IS NULL
      `).get()).toEqual({ count: 2 });
      expect(upgraded.prepare(`
        SELECT source_row_id AS sourceRowId, reason, status
        FROM store_migration_quarantine
        WHERE migration_version = 4 AND source_table = 'listing_content'
        ORDER BY source_row_id
      `).all()).toEqual([
        { sourceRowId: '1', reason: 'unowned_listing_duplicate_isolated', status: 'pending' },
        { sourceRowId: '2', reason: 'unowned_listing_duplicate_isolated', status: 'pending' },
      ]);
    } finally {
      upgraded.close();
    }
  });

  it('quarantines every remaining unowned historical object and version', () => {
    const databasePath = tempDatabasePath();
    const { database } = preparePreV4Database(databasePath);
    let listingId = 0;
    let versionId = 0;
    try {
      listingId = Number(database.prepare(`
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (NULL, 'B0LEGACY02', 'Single unowned Listing')
      `).run().lastInsertRowid);
      versionId = Number(database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, title
        ) VALUES (NULL, ?, 'B0LEGACY02', 'Single unowned version')
      `).run(listingId).lastInsertRowid);
    } finally {
      database.close();
    }

    const upgraded = initSqlite(databasePath);
    try {
      expect(upgraded.prepare(`
        SELECT source_table AS sourceTable, source_row_id AS sourceRowId, status
        FROM store_migration_quarantine
        WHERE status = 'pending'
          AND (
            (source_table = 'listing_content' AND source_row_id = ?)
            OR (source_table = 'listing_content_versions' AND source_row_id = ?)
          )
        ORDER BY source_table
      `).all(String(listingId), String(versionId))).toEqual([
        { sourceTable: 'listing_content', sourceRowId: String(listingId), status: 'pending' },
        { sourceTable: 'listing_content_versions', sourceRowId: String(versionId), status: 'pending' },
      ]);
      expect(() => verifyListingStoreAuthoritySchema(upgraded)).not.toThrow();
    } finally {
      upgraded.close();
    }

    const reopened = initSqlite(databasePath);
    try {
      expect(() => verifyListingStoreAuthoritySchema(reopened)).not.toThrow();
      expect(reopened.prepare(`
        SELECT store_authority_quarantined AS quarantined
        FROM listing_content
        WHERE id = ?
      `).get(listingId)).toEqual({ quarantined: 1 });
      expect(reopened.prepare(`
        SELECT store_authority_quarantined AS quarantined
        FROM listing_content_versions
        WHERE id = ?
      `).get(versionId)).toEqual({ quarantined: 1 });
    } finally {
      reopened.close();
    }
  });

  it('rejects unowned objects and versions that have no pending quarantine proof', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    try {
      const triggerRows = database.prepare(`
        SELECT name, sql
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name IN (
            'trg_listing_content_require_store_authority_insert',
            'trg_listing_content_versions_require_store_authority_insert'
          )
        ORDER BY name
      `).all() as Array<{ name: string; sql: string }>;
      for (const trigger of triggerRows) {
        database.exec(`DROP TRIGGER ${trigger.name}`);
      }

      const listingId = Number(database.prepare(`
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (NULL, 'B0ORPHAN01', 'Unproven unowned Listing')
      `).run().lastInsertRowid);
      const versionId = Number(database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, title
        ) VALUES (NULL, ?, 'B0ORPHAN01', 'Unproven unowned version')
      `).run(listingId).lastInsertRowid);

      for (const trigger of triggerRows) database.exec(trigger.sql);

      expect(() => verifyListingStoreAuthoritySchema(database))
        .toThrow(/listing_content.*not quarantined/i);

      database.prepare(`
        INSERT INTO store_migration_quarantine (
          migration_version, source_table, source_row_id, reason,
          candidate_store_ids_json, source_identity_json, status,
          created_at, updated_at
        ) VALUES (4, 'listing_content', ?, 'test_pending', '[]', '{}',
          'pending', datetime('now'), datetime('now'))
      `).run(String(listingId));
      const updateTrigger = database.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name = 'trg_listing_content_require_store_authority_update'
      `).get() as { sql: string };
      database.exec('DROP TRIGGER trg_listing_content_require_store_authority_update');
      database.prepare(`
        UPDATE listing_content
        SET store_authority_quarantined = 1
        WHERE id = ?
      `).run(listingId);
      database.exec(updateTrigger.sql);
      expect(() => verifyListingStoreAuthoritySchema(database))
        .toThrow(/listing_content_versions.*not quarantined/i);

      expect(versionId).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  it('rejects every new or updated Listing row that omits store authority', () => {
    const databasePath = tempDatabasePath();
    const database = initSqlite(databasePath);
    const storeId = normalizeStoreId('listing-trigger-store');
    try {
      database.prepare(`
        INSERT INTO stores (
          store_id, browser_profile_id, marketplace, currency, display_name,
          status, business_timezone, created_at, updated_at
        ) VALUES (?, 'listing-trigger-profile', 'US', 'USD', 'Trigger Store',
          'active', 'America/Los_Angeles', datetime('now'), datetime('now'))
      `).run(storeId);
      const listingId = Number(database.prepare(`
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (?, 'B0TRIGGER1', 'Owned Listing')
      `).run(storeId).lastInsertRowid);
      const versionId = Number(database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, title
        ) VALUES (?, ?, 'B0TRIGGER1', 'Owned version')
      `).run(storeId, listingId).lastInsertRowid);

      expect(() => database.prepare(`
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (NULL, 'B0TRIGGER2', 'Forbidden unowned Listing')
      `).run()).toThrow(/listing content store_id is required/i);
      expect(() => database.prepare(`
        INSERT INTO listing_content_versions (store_id, asin, title)
        VALUES (NULL, 'B0TRIGGER2', 'Forbidden unowned version')
      `).run()).toThrow(/listing content version store_id is required/i);
      expect(() => database.prepare(`
        UPDATE listing_content SET store_id = NULL WHERE id = ?
      `).run(listingId)).toThrow(/listing content store_id is required/i);
      expect(() => database.prepare(`
        UPDATE listing_content_versions SET store_id = NULL WHERE id = ?
      `).run(versionId)).toThrow(/listing content version store_id is required/i);
      expect(() => verifyListingStoreAuthoritySchema(database)).not.toThrow();
    } finally {
      database.close();
    }
  });
});
