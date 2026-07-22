import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeBrowserProfileId,
  normalizeStoreCapabilityId,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { StoreRepository, StoreRepositoryError } from './store-repo';

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-repo-'));
  tempDirs.push(dir);
  return path.join(dir, 'app.db');
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createStore(repo: StoreRepository, suffix = 'a') {
  return repo.createStore({
    storeId: normalizeStoreId(`store-${suffix}`),
    browserProfileId: normalizeBrowserProfileId(`profile-${suffix}`),
    displayName: `US Store ${suffix.toUpperCase()}`,
  });
}

function expectStoreError(
  action: () => unknown,
  code: StoreRepositoryError['code'],
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(StoreRepositoryError);
  expect((thrown as StoreRepositoryError).code).toBe(code);
}

describe('StoreRepository', () => {
  it('supports authoritative CRUD as update plus recoverable archive/restore without deleting rows', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const created = createStore(repo);
      expect(created).toMatchObject({
        storeId: 'store-a',
        browserProfileId: 'profile-a',
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
        status: 'active',
      });
      expect(repo.listStores()).toEqual([created]);

      const updated = repo.updateStore({
        storeId: created.storeId,
        expectedUpdatedAt: created.updatedAt,
        patch: { displayName: 'Renamed Store', status: 'inactive' },
      });
      expect(updated).toMatchObject({ displayName: 'Renamed Store', status: 'inactive' });
      expectStoreError(() => repo.updateStore({
        storeId: created.storeId,
        expectedUpdatedAt: created.updatedAt,
        patch: { displayName: 'Stale edit' },
      }), 'STORE_CONFLICT');

      database.prepare(`
        INSERT INTO products (store_id, store_name, marketplace_code, asin, title)
        VALUES (?, 'Renamed Store', 'US', 'B-KEEP', 'Retained product')
      `).run(created.storeId);
      const preflight = repo.getArchivePreflight(created.storeId);
      expect(preflight).toMatchObject({ canArchive: true, alreadyArchived: false });
      expect(preflight.scopedRowCounts.products).toBe(1);

      const archived = repo.archiveStore({ storeId: created.storeId });
      expect(archived.status).toBe('archived');
      expect(archived.archivedAt).toBeTruthy();
      expect(repo.listStores()).toEqual([]);
      expect(repo.listStores({ includeArchived: true })).toHaveLength(1);
      expect(repo.deleteStore({ storeId: created.storeId })).toEqual(archived);
      expect(database.prepare(`SELECT COUNT(*) AS count FROM stores`).get()).toEqual({ count: 1 });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM products`).get()).toEqual({ count: 1 });

      const restored = repo.restoreStore({ storeId: created.storeId });
      expect(restored).toMatchObject({ status: 'active', archivedAt: undefined });
      expect(repo.getRestorePreflight(created.storeId)).toMatchObject({
        canRestore: true,
        alreadyActive: true,
      });
    } finally {
      database.close();
    }
  });

  it('rejects an update when another database connection wins after the revision read', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    const concurrentDatabase = new Database(dbPath);
    concurrentDatabase.pragma('journal_mode = WAL');
    concurrentDatabase.pragma('foreign_keys = ON');
    try {
      const repo = new StoreRepository(database);
      const concurrentRepo = new StoreRepository(concurrentDatabase);
      const created = createStore(repo, 'cas');
      let raced = false;
      const patch = {} as { displayName: string };
      Object.defineProperty(patch, 'displayName', {
        enumerable: true,
        get: () => {
          if (!raced) {
            raced = true;
            concurrentRepo.updateStore({
              storeId: created.storeId,
              expectedUpdatedAt: created.updatedAt,
              patch: { displayName: 'Concurrent winner' },
            });
          }
          return 'Stale writer';
        },
      });

      expectStoreError(() => repo.updateStore({
        storeId: created.storeId,
        expectedUpdatedAt: created.updatedAt,
        patch,
      }), 'STORE_CONFLICT');
      expect(repo.getStore(created.storeId)?.displayName).toBe('Concurrent winner');
    } finally {
      concurrentDatabase.close();
      database.close();
    }
  });

  it('enforces unique browser profiles and rejects unsupported market identity', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      createStore(repo);
      expectStoreError(() => repo.createStore({
        storeId: normalizeStoreId('store-b'),
        browserProfileId: normalizeBrowserProfileId('PROFILE-A'),
        displayName: 'Duplicate profile store',
      }), 'STORE_ALREADY_EXISTS');
      expect(() => repo.createStore({
        storeId: normalizeStoreId('store-c'),
        browserProfileId: normalizeBrowserProfileId('profile-c'),
        displayName: 'Unsupported marketplace',
        marketplace: 'CA' as 'US',
      })).toThrow(/US/);
      expect(database.prepare(`SELECT COUNT(*) AS count FROM stores`).get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('persists provider connections and monotonic non-secret session metadata', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo);
      const connectionId = normalizeStoreCapabilityId('cap-lingxing-a');
      const connection = repo.createConnection({
        id: connectionId,
        storeId: store.storeId,
        provider: 'lingxing',
        status: 'checking',
        accountLabel: 'Operator account',
      });
      expect(connection).toMatchObject({
        id: connectionId,
        storeId: store.storeId,
        provider: 'lingxing',
        status: 'checking',
      });

      const session = repo.saveSessionMetadata({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: 3,
        observedAt: '2026-07-22T02:00:00.000Z',
        verifiedAt: '2026-07-22T02:00:00.000Z',
        accountLabel: 'Operator account',
      });
      expect(session).toMatchObject({ status: 'ready', sessionGeneration: 3 });
      expect(repo.getConnection(store.storeId, 'lingxing')?.session).toEqual(session);
      expectStoreError(() => repo.saveSessionMetadata({
        ...session,
        status: 'expired',
        sessionGeneration: 2,
        observedAt: '2026-07-22T03:00:00.000Z',
      }), 'SESSION_GENERATION_STALE');
      expectStoreError(() => repo.saveSessionMetadata({
        ...session,
        browserProfileId: normalizeBrowserProfileId('profile-wrong'),
        sessionGeneration: 4,
        observedAt: '2026-07-22T03:00:00.000Z',
      }), 'SESSION_PROFILE_MISMATCH');

      const advanced = repo.advanceSessionGeneration(store.storeId, 'lingxing');
      expect(advanced).toMatchObject({ status: 'checking', sessionGeneration: 4 });

      const archived = repo.archiveStore({ storeId: store.storeId });
      expect(archived.status).toBe('archived');
      expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toMatchObject({
        status: 'signed_out',
        sessionGeneration: 5,
      });
      expect(repo.getConnection(store.storeId, 'lingxing')).toMatchObject({
        status: 'attention_required',
        lastFailureCode: 'store_archived',
      });
      expectStoreError(() => repo.updateConnection({
        id: connectionId,
        storeId: store.storeId,
        status: 'ready',
      }), 'STORE_NOT_ACTIVE');

      repo.restoreStore({ storeId: store.storeId });
      repo.updateStore({ storeId: store.storeId, patch: { status: 'inactive' } });
      expectStoreError(
        () => repo.advanceSessionGeneration(store.storeId, 'lingxing'),
        'STORE_NOT_ACTIVE',
      );
      expectStoreError(
        () => repo.removeConnection({ id: connectionId, storeId: store.storeId }),
        'STORE_NOT_ACTIVE',
      );
    } finally {
      database.close();
    }
  });

  it('never lets a raced stale session write roll back the durable generation', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    const concurrentDatabase = new Database(dbPath);
    concurrentDatabase.pragma('journal_mode = WAL');
    concurrentDatabase.pragma('foreign_keys = ON');
    try {
      const repo = new StoreRepository(database);
      const concurrentRepo = new StoreRepository(concurrentDatabase);
      const store = createStore(repo, 'session-cas');
      repo.createConnection({
        id: normalizeStoreCapabilityId('cap-session-cas'),
        storeId: store.storeId,
        provider: 'lingxing',
      });
      repo.saveSessionMetadata({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing',
        status: 'checking',
        sessionGeneration: 0,
        observedAt: '2026-07-22T01:00:00.000Z',
      });

      let raced = false;
      const staleWrite = {
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing' as const,
        status: 'ready' as const,
        sessionGeneration: 1,
        observedAt: '2026-07-22T02:00:00.000Z',
      };
      Object.defineProperty(staleWrite, 'accountLabel', {
        enumerable: true,
        get: () => {
          if (!raced) {
            raced = true;
            concurrentRepo.saveSessionMetadata({
              storeId: store.storeId,
              browserProfileId: store.browserProfileId,
              provider: 'lingxing',
              status: 'ready',
              sessionGeneration: 2,
              observedAt: '2026-07-22T03:00:00.000Z',
              accountLabel: 'Concurrent winner',
            });
          }
          return 'Stale writer';
        },
      });

      expectStoreError(() => repo.saveSessionMetadata(staleWrite), 'SESSION_GENERATION_STALE');
      expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toMatchObject({
        sessionGeneration: 2,
        accountLabel: 'Concurrent winner',
      });
    } finally {
      concurrentDatabase.close();
      database.close();
    }
  });

  it('keeps a generation tombstone across connection removal and recreation', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo, 'connection-aba');
      const originalConnectionId = normalizeStoreCapabilityId('cap-connection-aba-old');
      repo.createConnection({
        id: originalConnectionId,
        storeId: store.storeId,
        provider: 'lingxing',
      });
      const oldSession = repo.saveSessionMetadata({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: 8,
        observedAt: '2026-07-22T04:00:00.000Z',
      });

      repo.removeConnection({ id: originalConnectionId, storeId: store.storeId });
      expect(repo.getConnection(store.storeId, 'lingxing')).toBeUndefined();
      expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toMatchObject({
        status: 'signed_out',
        sessionGeneration: 9,
        failureCode: 'connection_removed',
      });

      repo.createConnection({
        id: normalizeStoreCapabilityId('cap-connection-aba-new'),
        storeId: store.storeId,
        provider: 'lingxing',
      });
      expectStoreError(() => repo.saveSessionMetadata(oldSession), 'SESSION_GENERATION_STALE');
      expect(repo.advanceSessionGeneration(store.storeId, 'lingxing')).toMatchObject({
        sessionGeneration: 10,
      });
    } finally {
      database.close();
    }
  });

  it('exposes migration manifest/result/recovery and resolves quarantine only by explicit assignment', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE ai_call_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_key TEXT,
          prompt_version TEXT,
          model TEXT,
          input_hash TEXT,
          output_json TEXT,
          success INTEGER DEFAULT 1,
          error_message TEXT,
          created_at TEXT
        );
        INSERT INTO ai_call_logs (id, prompt_key, model, input_hash, output_json)
        VALUES (1, 'legacy', 'local', 'hash', '{}');
      `);
    } finally {
      legacy.close();
    }

    const database = initSqlite(dbPath);
    try {
      const repo = new StoreRepository(database);
      expect(repo.listSchemaMigrations()).toHaveLength(1);
      expect(repo.getMigrationManifest()).toMatchObject({ version: 1, integrityCheck: 'ok' });
      expect(repo.getMigrationResult()).toMatchObject({ status: 'applied' });
      expect(repo.getMigrationRecoveryPreflight()).toMatchObject({ canRestore: true });

      const [pending] = repo.listMigrationQuarantine({
        sourceTable: 'ai_call_logs',
        status: 'pending',
      });
      expect(pending).toMatchObject({
        sourceRowId: '1',
        reason: 'missing_store_identity',
        status: 'pending',
      });
      const store = createStore(repo, 'resolve');
      const resolved = repo.resolveMigrationQuarantine({
        quarantineId: pending.id,
        storeId: store.storeId,
        resolutionNote: 'Operator verified the historical AI run belongs to this store.',
      });
      expect(resolved).toMatchObject({
        status: 'resolved',
        resolvedStoreId: store.storeId,
      });
      expect(database.prepare(`SELECT store_id FROM ai_call_logs WHERE id = 1`).get()).toEqual({
        store_id: store.storeId,
      });
      expectStoreError(() => repo.resolveMigrationQuarantine({
        quarantineId: pending.id,
        storeId: store.storeId,
        resolutionNote: 'Duplicate resolution attempt.',
      }), 'QUARANTINE_ALREADY_RESOLVED');

      const restoredPath = path.join(path.dirname(dbPath), 'repo-restored-copy.db');
      expect(repo.restoreMigrationBackupTo(restoredPath)).toMatchObject({
        destinationPath: path.resolve(restoredPath),
        integrityCheck: 'ok',
      });
      expect(fs.existsSync(restoredPath)).toBe(true);
    } finally {
      database.close();
    }
  });

  it('requires a connection binding before accepting session metadata', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo);
      expectStoreError(() => repo.saveSessionMetadata({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'amazon_ads',
        status: 'checking',
        sessionGeneration: 0,
        observedAt: '2026-07-22T02:00:00.000Z',
      }), 'CONNECTION_NOT_FOUND');
    } finally {
      database.close();
    }
  });
});
