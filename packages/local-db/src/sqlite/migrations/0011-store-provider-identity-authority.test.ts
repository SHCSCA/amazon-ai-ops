import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeBrowserProfileId,
  normalizeStoreCapabilityId,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';
import { closeSqlite, initSqlite } from '../db';
import { StoreRepository } from '../repositories/store-repo';
import {
  STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
  STORE_PROVIDER_IDENTITY_UNIQUE_INDEX,
  StoreProviderIdentityAuthorityMigrationError,
  runStoreProviderIdentityAuthorityMigration,
  verifyStoreProviderIdentityAuthoritySchema,
} from '.';

const tempDirs: string[] = [];

function tempDbPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-provider-v11-'));
  tempDirs.push(directory);
  return path.join(directory, 'authority.db');
}

function resetSchemaToV10(database: ReturnType<typeof initSqlite>): void {
  database.exec(`
    DROP TRIGGER IF EXISTS trg_stores_v1_authority_insert;
    DROP TRIGGER IF EXISTS trg_stores_v1_authority_update;
    DROP TRIGGER IF EXISTS trg_store_connections_external_identity_insert;
    DROP TRIGGER IF EXISTS trg_store_connections_external_identity_update;
    DROP TRIGGER IF EXISTS trg_store_connections_collection_store_name_insert;
    DROP TRIGGER IF EXISTS trg_store_connections_collection_store_name_update;
    DROP INDEX IF EXISTS ${STORE_PROVIDER_IDENTITY_UNIQUE_INDEX};
    DELETE FROM schema_migrations
    WHERE version = ${STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION};
    ALTER TABLE store_connections DROP COLUMN normalized_collection_store_name;
    ALTER TABLE store_connections DROP COLUMN collection_store_name;
    ALTER TABLE store_connections DROP COLUMN normalized_external_account_id;
  `);
}

function createStore(repo: StoreRepository, suffix: string) {
  return repo.createStore({
    storeId: normalizeStoreId(`store-${suffix}`),
    browserProfileId: normalizeBrowserProfileId(`profile-${suffix}`),
    displayName: `Store ${suffix}`,
  });
}

afterEach(() => {
  closeSqlite();
  while (tempDirs.length) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('store provider identity authority migration v11', () => {
  it('backfills canonical identities and preserves the exact schema across reopen', () => {
    const dbPath = tempDbPath();
    let database = initSqlite(dbPath);
    const repo = new StoreRepository(database);
    const store = createStore(repo, 'canonical');
    const selectorInsertStore = createStore(repo, 'selector-insert');
    const created = repo.createConnection({
      id: normalizeStoreCapabilityId('cap-canonical'),
      storeId: store.storeId,
      provider: 'lingxing',
      collectionStoreName: '  Ｍｙ　ＵＳ　Ｓｔｏｒｅ  ',
    });
    repo.enrollLingxingStableExternalAccount({
      id: created.id,
      storeId: store.storeId,
      provider: 'lingxing',
      externalAccountId: 'Ｓｔｏｒｅ－ＡＢＣ',
      expectedUpdatedAt: created.updatedAt,
    });

    expect(repo.getConnection(store.storeId, 'lingxing')).toMatchObject({
      externalAccountId: 'Ｓｔｏｒｅ－ＡＢＣ',
      normalizedExternalAccountId: 'store-abc',
      collectionStoreName: 'Ｍｙ　ＵＳ　Ｓｔｏｒｅ',
      normalizedCollectionStoreName: 'my us store',
    });
    expect(() => database.prepare(`
      UPDATE store_connections
      SET normalized_external_account_id = 'forged'
      WHERE store_id = ? AND provider = 'lingxing'
    `).run(store.storeId)).toThrow(/raw\/normalized mismatch/);
    expect(() => database.prepare(`
      INSERT INTO store_connections (
        id, store_id, provider, status, external_account_id,
        normalized_external_account_id, created_at, updated_at
      ) VALUES (
        'cap-parity-forged', ?, 'amazon_ads', 'not_configured',
        'profile-1', NULL, ?, ?
      )
    `).run(store.storeId, new Date().toISOString(), new Date().toISOString()))
      .toThrow(/raw\/normalized mismatch/);
    expect(() => database.prepare(`
      INSERT INTO store_connections (
        id, store_id, provider, status, external_account_id,
        normalized_external_account_id, created_at, updated_at
      ) VALUES (
        'cap-external-whitespace-insert', ?, 'amazon_ads', 'not_configured',
        '   ', 'forged', ?, ?
      )
    `).run(store.storeId, new Date().toISOString(), new Date().toISOString()))
      .toThrow(/raw\/normalized mismatch/);
    expect(() => database.prepare(`
      UPDATE store_connections
      SET external_account_id = '   ', normalized_external_account_id = 'forged'
      WHERE store_id = ? AND provider = 'lingxing'
    `).run(store.storeId)).toThrow(/raw\/normalized mismatch/);
    expect(() => database.prepare(`
      UPDATE store_connections
      SET normalized_collection_store_name = 'forged'
      WHERE store_id = ? AND provider = 'lingxing'
    `).run(store.storeId)).toThrow(/selector raw\/normalized\/provider mismatch/);
    expect(() => database.prepare(`
      INSERT INTO store_connections (
        id, store_id, provider, status, collection_store_name,
        normalized_collection_store_name, created_at, updated_at
      ) VALUES (
        'cap-selector-whitespace-insert', ?, 'lingxing', 'not_configured',
        '   ', 'forged', ?, ?
      )
    `).run(
      selectorInsertStore.storeId,
      new Date().toISOString(),
      new Date().toISOString(),
    )).toThrow(/selector raw\/normalized\/provider mismatch/);
    expect(() => database.prepare(`
      UPDATE store_connections
      SET collection_store_name = '   ', normalized_collection_store_name = 'forged'
      WHERE store_id = ? AND provider = 'lingxing'
    `).run(store.storeId)).toThrow(/selector raw\/normalized\/provider mismatch/);
    expect(() => database.prepare(`
      INSERT INTO store_connections (
        id, store_id, provider, status, collection_store_name,
        normalized_collection_store_name, created_at, updated_at
      ) VALUES (
        'cap-ads-selector-forged', ?, 'amazon_ads', 'not_configured',
        'Lingxing-only selector', 'lingxing-only selector', ?, ?
      )
    `).run(store.storeId, new Date().toISOString(), new Date().toISOString()))
      .toThrow(/selector raw\/normalized\/provider mismatch/);
    expect(() => database.prepare(`
      UPDATE stores SET business_timezone = 'UTC' WHERE store_id = ?
    `).run(store.storeId)).toThrow(/US\/USD\/America\/Los_Angeles/);

    closeSqlite();
    database = initSqlite(dbPath);
    expect(() => verifyStoreProviderIdentityAuthoritySchema(database)).not.toThrow();
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('rejects quoted provider literal case drift in an existing authority trigger', () => {
    const database = initSqlite(tempDbPath());
    const triggerName = 'trg_store_connections_collection_store_name_insert';
    const trigger = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
    `).get(triggerName) as { sql: string };
    database.exec(`DROP TRIGGER ${triggerName}`);
    database.exec(trigger.sql.replace("'amazon_ads'", "'AMAZON_ADS'"));

    expect(() => verifyStoreProviderIdentityAuthoritySchema(database))
      .toThrow(/authority trigger.*missing or invalid/i);
  });

  it('fails atomically when historical identities collide after whitespace, case, or NFKC normalization', () => {
    const database = initSqlite(tempDbPath());
    const repo = new StoreRepository(database);
    const first = createStore(repo, 'duplicate-a');
    const second = createStore(repo, 'duplicate-b');
    resetSchemaToV10(database);
    const insert = database.prepare(`
      INSERT INTO store_connections (
        id, store_id, provider, status, external_account_id, created_at, updated_at
      ) VALUES (?, ?, 'amazon_ads', 'not_configured', ?, ?, ?)
    `);
    const now = new Date().toISOString();
    insert.run('cap-duplicate-a', first.storeId, '  ＡＢＣ  ', now, now);
    insert.run('cap-duplicate-b', second.storeId, 'abc', now, now);

    expect(() => runStoreProviderIdentityAuthorityMigration(database))
      .toThrow(StoreProviderIdentityAuthorityMigrationError);
    expect(database.prepare(`
      SELECT status FROM schema_migrations WHERE version = ?
    `).get(STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION)).toEqual({ status: 'failed' });
    expect((database.pragma("table_info('store_connections')") as Array<{ name: string }>)
      .some((column) => column.name === 'normalized_external_account_id')).toBe(false);
    expect(database.prepare(`SELECT COUNT(*) AS count FROM store_connections`).get())
      .toEqual({ count: 2 });
  });

  it('migrates legacy Lingxing selectors without treating them as stable identities', () => {
    const database = initSqlite(tempDbPath());
    const repo = new StoreRepository(database);
    const first = createStore(repo, 'provider-a');
    const second = createStore(repo, 'provider-b');
    resetSchemaToV10(database);
    const insert = database.prepare(`
      INSERT INTO store_connections (
        id, store_id, provider, status, external_account_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'not_configured', ?, ?, ?)
    `);
    const now = new Date().toISOString();
    insert.run('cap-provider-a', first.storeId, 'lingxing', 'Shared-ID', now, now);
    insert.run('cap-provider-b', second.storeId, 'amazon_ads', ' shared-id ', now, now);

    expect(runStoreProviderIdentityAuthorityMigration(database)).toMatchObject({
      status: 'applied',
      backfilledConnections: 2,
      migratedLingxingSelectors: 1,
      backfilledStableExternalIdentities: 1,
    });
    expect(database.prepare(`
      SELECT provider,
        external_account_id AS externalAccountId,
        normalized_external_account_id AS normalizedExternalAccountId,
        collection_store_name AS collectionStoreName,
        normalized_collection_store_name AS normalizedCollectionStoreName
      FROM store_connections ORDER BY provider
    `).all()).toEqual([
      {
        provider: 'amazon_ads',
        externalAccountId: 'shared-id',
        normalizedExternalAccountId: 'shared-id',
        collectionStoreName: null,
        normalizedCollectionStoreName: null,
      },
      {
        provider: 'lingxing',
        externalAccountId: null,
        normalizedExternalAccountId: null,
        collectionStoreName: 'Shared-ID',
        normalizedCollectionStoreName: 'shared-id',
      },
    ]);
  });

  it('fails atomically when a historical store is outside fixed V1 US authority', () => {
    const database = initSqlite(tempDbPath());
    const repo = new StoreRepository(database);
    const store = createStore(repo, 'timezone');
    resetSchemaToV10(database);
    database.prepare(`UPDATE stores SET business_timezone = 'UTC' WHERE store_id = ?`)
      .run(store.storeId);

    expect(() => runStoreProviderIdentityAuthorityMigration(database))
      .toThrow(/unsupported authority/);
    expect((database.pragma("table_info('store_connections')") as Array<{ name: string }>)
      .some((column) => column.name === 'normalized_external_account_id')).toBe(false);
    expect(database.prepare(`SELECT business_timezone FROM stores WHERE store_id = ?`)
      .get(store.storeId)).toEqual({ business_timezone: 'UTC' });
  });

  it('fails atomically when a historical provider identity exceeds the shared authority boundary', () => {
    const database = initSqlite(tempDbPath());
    const repo = new StoreRepository(database);
    const store = createStore(repo, 'invalid-identity');
    resetSchemaToV10(database);
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO store_connections (
        id, store_id, provider, status, external_account_id, created_at, updated_at
      ) VALUES (
        'cap-invalid-history', ?, 'lingxing', 'not_configured', ?, ?, ?
      )
    `).run(store.storeId, 'x'.repeat(257), now, now);

    expect(() => runStoreProviderIdentityAuthorityMigration(database))
      .toThrow(/at most 256/);
    expect((database.pragma("table_info('store_connections')") as Array<{ name: string }>)
      .some((column) => column.name === 'normalized_external_account_id')).toBe(false);
    expect(database.prepare(`SELECT external_account_id FROM store_connections`)
      .get()).toEqual({ external_account_id: 'x'.repeat(257) });
  });
});
