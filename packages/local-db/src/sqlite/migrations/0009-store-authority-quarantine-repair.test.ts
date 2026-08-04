import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeSqlite, initSqlite } from '../db';
import {
  STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
  STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
  runStoreAuthorityRepairMigration,
} from '.';

const NOW = '2026-07-27T00:00:00.000Z';

afterEach(() => {
  closeSqlite();
});

function historicalV8Database() {
  const database = initSqlite(':memory:');
  database.prepare(`
    DELETE FROM schema_migrations
    WHERE version = ?
  `).run(STORE_AUTHORITY_REPAIR_MIGRATION_VERSION);
  return database;
}

function insertStore(database: ReturnType<typeof historicalV8Database>, storeId: string, name: string) {
  database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      legacy_store_name_normalized, legacy_marketplace_code_normalized,
      created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, 'US', ?, ?)
  `).run(storeId, `profile-${storeId}`, name, name.toLowerCase(), NOW, NOW);
}

function insertHistoricalUnownedListing(
  database: ReturnType<typeof historicalV8Database>,
  id: number,
  asin: string,
) {
  database.exec('DROP TRIGGER IF EXISTS trg_listing_content_require_store_authority_insert');
  database.prepare(`
    INSERT INTO listing_content (
      id, store_id, asin, title, store_authority_quarantined
    ) VALUES (?, NULL, ?, 'Historical listing', 1)
  `).run(id, asin);
  database.exec(`
    CREATE TRIGGER trg_listing_content_require_store_authority_insert
    BEFORE INSERT ON listing_content
    WHEN NEW.store_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'listing content store_id is required');
    END;
  `);
  database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      candidate_store_ids_json, source_identity_json,
      status, created_at, updated_at
    ) VALUES (
      1, 'listing_content', ?, 'missing_parent_store',
      '[]', ?, 'pending', ?, ?
    )
  `).run(String(id), JSON.stringify({ asin }), NOW, NOW);
}

describe('store authority quarantine repair migration v9', () => {
  it('repairs an already-applied v1 row and remains valid after close and reopen', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-repair-v9-'));
    const dbPath = path.join(directory, 'authority.db');
    try {
      const database = initSqlite(dbPath);
      database.prepare(`
        DELETE FROM schema_migrations
        WHERE version = ?
      `).run(STORE_AUTHORITY_REPAIR_MIGRATION_VERSION);
      insertStore(database, 'store-a', 'Historical Shop');
      insertHistoricalUnownedListing(database, 101, 'B-HISTORICAL');
      database.prepare(`
        INSERT INTO listing_drafts (
          id, store_id, asin, store_name, marketplace_code, section, drafted_text
        ) VALUES (
          201, 'store-a', 'B-HISTORICAL', 'Historical Shop', 'US', 'title', 'Owned draft'
        )
      `).run();

      const beforeV1 = database.prepare(`
        SELECT checksum, status
        FROM schema_migrations
        WHERE version = 1
      `).get();
      const result = runStoreAuthorityRepairMigration(database);

      expect(result).toMatchObject({
        version: 9,
        status: 'applied',
        examinedRows: 1,
        repairedRows: 1,
        remainingPendingRows: 0,
      });
      expect(database.prepare(`
        SELECT store_id, store_authority_quarantined
        FROM listing_content
        WHERE id = 101
      `).get()).toEqual({
        store_id: 'store-a',
        store_authority_quarantined: 0,
      });
      expect(database.prepare(`
        SELECT status, resolved_store_id AS resolvedStoreId, resolution_note AS resolutionNote
        FROM store_migration_quarantine
        WHERE migration_version = 1
          AND source_table = 'listing_content'
          AND source_row_id = '101'
      `).get()).toEqual({
        status: 'resolved',
        resolvedStoreId: 'store-a',
        resolutionNote: expect.stringMatching(/repair v9/i),
      });
      expect(database.prepare(`
        SELECT checksum, status
        FROM schema_migrations
        WHERE version = 1
      `).get()).toEqual(beforeV1);
      expect(database.prepare(`
        SELECT checksum, status
        FROM schema_migrations
        WHERE version = 9
      `).get()).toEqual({
        checksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
        status: 'applied',
      });
      expect(runStoreAuthorityRepairMigration(database)).toEqual(result);

      closeSqlite();
      const reopened = initSqlite(dbPath);
      expect(reopened.prepare(`
        SELECT checksum, status
        FROM schema_migrations
        WHERE version = 1
      `).get()).toEqual(beforeV1);
      expect(reopened.prepare(`
        SELECT checksum, status
        FROM schema_migrations
        WHERE version = 9
      `).get()).toEqual({
        checksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
        status: 'applied',
      });
    } finally {
      closeSqlite();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps ambiguous cross-store ASIN ownership pending for operator resolution', () => {
    const database = historicalV8Database();
    insertStore(database, 'store-a', 'Shop A');
    insertStore(database, 'store-b', 'Shop B');
    insertHistoricalUnownedListing(database, 102, 'B-AMBIGUOUS');
    database.prepare(`
      INSERT INTO listing_drafts (
        id, store_id, asin, store_name, marketplace_code, section, drafted_text
      ) VALUES
        (202, 'store-a', 'B-AMBIGUOUS', 'Shop A', 'US', 'title', 'Draft A'),
        (203, 'store-b', 'B-AMBIGUOUS', 'Shop B', 'US', 'title', 'Draft B')
    `).run();

    const result = runStoreAuthorityRepairMigration(database);

    expect(result).toMatchObject({
      status: 'applied',
      examinedRows: 1,
      repairedRows: 0,
      remainingPendingRows: 1,
    });
    expect(database.prepare(`
      SELECT store_id
      FROM listing_content
      WHERE id = 102
    `).get()).toEqual({ store_id: null });
    expect(database.prepare(`
      SELECT status
      FROM store_migration_quarantine
      WHERE migration_version = 1
        AND source_table = 'listing_content'
        AND source_row_id = '102'
    `).get()).toEqual({ status: 'pending' });
  });

  it('leaves a same-store Listing uniqueness collision pending without partial marker writes', () => {
    const database = historicalV8Database();
    insertStore(database, 'store-a', 'Shop A');
    database.prepare(`
      INSERT INTO listing_content (
        id, store_id, asin, title, store_authority_quarantined
      ) VALUES (
        103, 'store-a', 'B-COLLISION', 'Owned listing', 0
      )
    `).run();
    insertHistoricalUnownedListing(database, 104, 'B-COLLISION');
    database.prepare(`
      INSERT INTO listing_drafts (
        id, store_id, asin, store_name, marketplace_code, section, drafted_text
      ) VALUES (
        204, 'store-a', 'B-COLLISION', 'Shop A', 'US', 'title', 'Owned draft'
      )
    `).run();

    const result = runStoreAuthorityRepairMigration(database);

    expect(result).toMatchObject({
      status: 'applied',
      repairedRows: 0,
      remainingPendingRows: 1,
    });
    expect(database.prepare(`
      SELECT store_id, store_authority_quarantined
      FROM listing_content
      WHERE id = 104
    `).get()).toEqual({
      store_id: null,
      store_authority_quarantined: 1,
    });
    expect(database.prepare(`
      SELECT status
      FROM store_migration_quarantine
      WHERE migration_version = 1
        AND source_table = 'listing_content'
        AND source_row_id = '104'
    `).get()).toEqual({ status: 'pending' });
  });

  it('does not trust an ASIN candidate that a later migration still quarantines', () => {
    const database = historicalV8Database();
    insertStore(database, 'store-a', 'Shop A');
    database.prepare(`
      INSERT INTO listing_content (
        id, store_id, asin, title, store_authority_quarantined
      ) VALUES (
        105, 'store-a', 'B-LATER-PENDING', 'Later-quarantined listing', 1
      )
    `).run();
    database.prepare(`
      INSERT INTO listing_drafts (
        id, store_id, asin, section, drafted_text
      ) VALUES (
        205, NULL, 'B-LATER-PENDING', 'title', 'Unowned draft'
      )
    `).run();
    database.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json,
        status, created_at, updated_at
      ) VALUES
        (4, 'listing_content', '105', 'identity_content_conflict',
         '["store-a"]', '{"asin":"B-LATER-PENDING"}', 'pending', ?, ?),
        (1, 'listing_drafts', '205', 'missing_parent_store',
         '[]', '{"asin":"B-LATER-PENDING"}', 'pending', ?, ?)
    `).run(NOW, NOW, NOW, NOW);

    const result = runStoreAuthorityRepairMigration(database);

    expect(result).toMatchObject({
      status: 'applied',
      examinedRows: 1,
      repairedRows: 0,
      remainingPendingRows: 1,
    });
    expect(database.prepare(`
      SELECT store_id
      FROM listing_drafts
      WHERE id = 205
    `).get()).toEqual({ store_id: null });
    expect(database.prepare(`
      SELECT status
      FROM store_migration_quarantine
      WHERE migration_version = 1
        AND source_table = 'listing_drafts'
        AND source_row_id = '205'
    `).get()).toEqual({ status: 'pending' });
  });

  it('does not repair a target row while any other migration still quarantines that target', () => {
    const database = historicalV8Database();
    insertStore(database, 'store-a', 'Shop A');
    insertHistoricalUnownedListing(database, 106, 'B-TARGET-PENDING');
    database.prepare(`
      INSERT INTO listing_drafts (
        id, store_id, asin, store_name, marketplace_code, section, drafted_text
      ) VALUES (
        206, 'store-a', 'B-TARGET-PENDING', 'Shop A', 'US', 'title', 'Owned draft'
      )
    `).run();
    database.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json,
        status, created_at, updated_at
      ) VALUES (
        4, 'listing_content', '106', 'identity_content_conflict',
        '["store-a"]', '{"asin":"B-TARGET-PENDING"}', 'pending', ?, ?
      )
    `).run(NOW, NOW);

    const result = runStoreAuthorityRepairMigration(database);

    expect(result).toMatchObject({
      status: 'applied',
      examinedRows: 1,
      repairedRows: 0,
      remainingPendingRows: 1,
    });
    expect(database.prepare(`
      SELECT store_id, store_authority_quarantined
      FROM listing_content
      WHERE id = 106
    `).get()).toEqual({
      store_id: null,
      store_authority_quarantined: 1,
    });
    expect(database.prepare(`
      SELECT migration_version AS migrationVersion, status
      FROM store_migration_quarantine
      WHERE source_table = 'listing_content'
        AND source_row_id = '106'
      ORDER BY migration_version
    `).all()).toEqual([
      { migrationVersion: 1, status: 'pending' },
      { migrationVersion: 4, status: 'pending' },
    ]);
  });

  it('rejects changed v9 history instead of silently rerunning a different repair', () => {
    const database = historicalV8Database();
    database.prepare(`
      INSERT INTO schema_migrations (
        version, name, checksum, status, started_at, applied_at,
        error_message, manifest_json, result_json
      ) VALUES (
        9, 'store-authority-quarantine-repair-v9', 'changed-checksum',
        'applied', ?, ?, NULL, '{}', '{}'
      )
    `).run(NOW, NOW);

    expect(() => runStoreAuthorityRepairMigration(database)).toThrow(/checksum/i);
  });
});
