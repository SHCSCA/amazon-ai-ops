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

function insertPendingQuarantine(
  database: Database.Database,
  sourceTable: string,
  sourceRowId: string | number,
): number {
  const now = new Date().toISOString();
  const result = database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      candidate_store_ids_json, source_identity_json, status,
      created_at, updated_at
    ) VALUES (1, ?, ?, 'ambiguous_parent_store', '[]', '{}', 'pending', ?, ?)
  `).run(sourceTable, String(sourceRowId), now, now);
  return Number(result.lastInsertRowid);
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

  it('rejects unbounded provider identity text at the repository authority boundary', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo, 'identity-bounds');
      expectStoreError(() => repo.createConnection({
        id: normalizeStoreCapabilityId('cap-invalid-long'),
        storeId: store.storeId,
        provider: 'amazon_ads',
        externalAccountId: 'a'.repeat(257),
      }), 'INVALID_STORE_INPUT');
      expectStoreError(() => repo.createConnection({
        id: normalizeStoreCapabilityId('cap-invalid-control'),
        storeId: store.storeId,
        provider: 'lingxing',
        accountLabel: 'operator\u0000account',
      }), 'INVALID_STORE_INPUT');

      const valid = repo.createConnection({
        id: normalizeStoreCapabilityId('cap-valid-identity'),
        storeId: store.storeId,
        provider: 'amazon_ads',
        externalAccountId: 'profile-1',
      });
      expectStoreError(() => repo.updateConnection({
        id: valid.id,
        storeId: store.storeId,
        externalAccountId: `profile-${'x'.repeat(257)}`,
      }), 'INVALID_STORE_INPUT');
      expect(repo.getConnection(store.storeId, 'amazon_ads')?.externalAccountId).toBe('profile-1');
    } finally {
      database.close();
    }
  });

  it.each([
    ['omits the external account id', {}],
    ['submits a normalized-equivalent external account id', { externalAccountId: '  external-a  ' }],
  ])('resets verified provider identity and session metadata when the account label changes and %s', (
    _externalIdentityCase,
    externalIdentityPatch,
  ) => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo, 'identity-rebind');
      const connectionId = normalizeStoreCapabilityId('cap-identity-rebind');
      repo.createConnection({
        id: connectionId,
        storeId: store.storeId,
        provider: 'lingxing',
        status: 'ready',
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        lastFailureCode: 'old-failure',
      });
      repo.saveSessionMetadata({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: 3,
        observedAt: '2026-07-22T02:00:00.000Z',
        verifiedAt: '2026-07-22T02:00:00.000Z',
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
      });

      const rebound = repo.updateConnection({
        id: connectionId,
        storeId: store.storeId,
        accountLabel: 'identity-b',
        ...externalIdentityPatch,
        status: 'ready',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        lastFailureCode: 'forged-ready',
      });

      expect(rebound).toEqual(expect.objectContaining({
        id: connectionId,
        accountLabel: 'identity-b',
        status: 'not_configured',
      }));
      expect(rebound.externalAccountId).toBeUndefined();
      expect(rebound.lastVerifiedAt).toBeUndefined();
      expect(rebound.lastFailureCode).toBeUndefined();
      expect(rebound.session).toBeUndefined();
      expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toBeUndefined();
      expect(JSON.stringify(rebound)).not.toContain('external-a');
    } finally {
      database.close();
    }
  });

  it.each([
    ['sets', undefined, 'external-b', 'external-b'],
    ['replaces', 'external-a', 'external-b', 'external-b'],
    ['clears', 'external-a', '   ', undefined],
  ])(
    'resets verification while persisting the new expected external account id when it %s',
    (_operation, initialExternalAccountId, submittedExternalAccountId, expectedExternalAccountId) => {
      const database = initSqlite(tempDbPath());
      try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, `external-identity-${_operation}`);
        const connectionId = normalizeStoreCapabilityId(`cap-external-identity-${_operation}`);
        repo.createConnection({
          id: connectionId,
          storeId: store.storeId,
          provider: 'lingxing',
          status: 'ready',
          accountLabel: 'identity-a',
          externalAccountId: initialExternalAccountId,
          lastVerifiedAt: '2026-07-22T02:00:00.000Z',
          lastFailureCode: 'old-failure',
        });
        repo.saveSessionMetadata({
          storeId: store.storeId,
          browserProfileId: store.browserProfileId,
          provider: 'lingxing',
          status: 'ready',
          sessionGeneration: 3,
          observedAt: '2026-07-22T02:00:00.000Z',
          verifiedAt: '2026-07-22T02:00:00.000Z',
          accountLabel: 'identity-a',
          externalAccountId: initialExternalAccountId,
        });

        const rebound = repo.updateConnection({
          id: connectionId,
          storeId: store.storeId,
          externalAccountId: submittedExternalAccountId,
          status: 'ready',
          lastVerifiedAt: '2026-07-22T03:00:00.000Z',
          lastFailureCode: 'forged-ready',
        });

        expect(rebound).toEqual(expect.objectContaining({
          accountLabel: 'identity-a',
          status: 'not_configured',
        }));
        expect(rebound.externalAccountId).toBe(expectedExternalAccountId);
        expect(rebound.lastVerifiedAt).toBeUndefined();
        expect(rebound.lastFailureCode).toBeUndefined();
        expect(rebound.session).toBeUndefined();
        expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toBeUndefined();
      } finally {
        database.close();
      }
    },
  );

  it('persists a normalized expected Amazon Ads profile id before login without accepting forged verification state', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo, 'pre-login-ads-identity');
      const connectionId = normalizeStoreCapabilityId('cap-pre-login-ads-identity');
      repo.createConnection({
        id: connectionId,
        storeId: store.storeId,
        provider: 'amazon_ads',
        status: 'not_configured',
        accountLabel: 'US Ads',
      });

      const updated = repo.updateConnection({
        id: connectionId,
        storeId: store.storeId,
        externalAccountId: '  1234567890  ',
        status: 'ready',
        lastVerifiedAt: '2026-07-22T03:00:00.000Z',
        lastFailureCode: 'forged-ready',
      });

      expect(updated).toEqual(expect.objectContaining({
        provider: 'amazon_ads',
        accountLabel: 'US Ads',
        externalAccountId: '1234567890',
        status: 'not_configured',
      }));
      expect(updated.lastVerifiedAt).toBeUndefined();
      expect(updated.lastFailureCode).toBeUndefined();
      expect(updated.session).toBeUndefined();
      expect(repo.getConnection(store.storeId, 'amazon_ads')).toEqual(updated);
    } finally {
      database.close();
    }
  });

  it('keeps normalized-equivalent connection identity updates idempotent', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo, 'identity-idempotent');
      const connectionId = normalizeStoreCapabilityId('cap-identity-idempotent');
      repo.createConnection({
        id: connectionId,
        storeId: store.storeId,
        provider: 'lingxing',
        status: 'ready',
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
      });
      repo.saveSessionMetadata({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: 3,
        observedAt: '2026-07-22T02:00:00.000Z',
        verifiedAt: '2026-07-22T02:00:00.000Z',
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
      });

      const unchanged = repo.updateConnection({
        id: connectionId,
        storeId: store.storeId,
        accountLabel: '  identity-a  ',
        externalAccountId: '  external-a  ',
      });

      expect(unchanged).toEqual(expect.objectContaining({
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
        status: 'ready',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        session: expect.objectContaining({
          externalAccountId: 'external-a',
          status: 'ready',
        }),
      }));
    } finally {
      database.close();
    }
  });

  it('invalidates only the matching store/provider session on external identity replacement', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const targetStore = createStore(repo, 'identity-isolation-target');
      const otherStore = createStore(repo, 'identity-isolation-other');
      const targetConnectionId = normalizeStoreCapabilityId('cap-identity-isolation-target');
      repo.createConnection({
        id: targetConnectionId,
        storeId: targetStore.storeId,
        provider: 'lingxing',
        status: 'ready',
        accountLabel: 'target',
        externalAccountId: 'external-a',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
      });
      repo.createConnection({
        id: normalizeStoreCapabilityId('cap-identity-isolation-target-ads'),
        storeId: targetStore.storeId,
        provider: 'amazon_ads',
        status: 'ready',
        accountLabel: 'target-ads',
        externalAccountId: 'ads-a',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
      });
      repo.createConnection({
        id: normalizeStoreCapabilityId('cap-identity-isolation-other'),
        storeId: otherStore.storeId,
        provider: 'lingxing',
        status: 'ready',
        accountLabel: 'other',
        externalAccountId: 'external-a',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
      });
      for (const [store, provider, accountLabel, externalAccountId] of [
        [targetStore, 'lingxing', 'target', 'external-a'],
        [targetStore, 'amazon_ads', 'target-ads', 'ads-a'],
        [otherStore, 'lingxing', 'other', 'external-a'],
      ] as const) {
        repo.saveSessionMetadata({
          storeId: store.storeId,
          browserProfileId: store.browserProfileId,
          provider,
          status: 'ready',
          sessionGeneration: 3,
          observedAt: '2026-07-22T02:00:00.000Z',
          verifiedAt: '2026-07-22T02:00:00.000Z',
          accountLabel,
          externalAccountId,
        });
      }

      repo.updateConnection({
        id: targetConnectionId,
        storeId: targetStore.storeId,
        externalAccountId: 'external-b',
      });

      expect(repo.getSessionMetadata(targetStore.storeId, 'lingxing')).toBeUndefined();
      expect(repo.getSessionMetadata(targetStore.storeId, 'amazon_ads')).toEqual(
        expect.objectContaining({ externalAccountId: 'ads-a', status: 'ready' }),
      );
      expect(repo.getSessionMetadata(otherStore.storeId, 'lingxing')).toEqual(
        expect.objectContaining({ externalAccountId: 'external-a', status: 'ready' }),
      );
    } finally {
      database.close();
    }
  });

  it('rolls back external identity reset and session invalidation with the authority transaction', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo, 'identity-rebind-rollback');
      const connectionId = normalizeStoreCapabilityId('cap-identity-rebind-rollback');
      repo.createConnection({
        id: connectionId,
        storeId: store.storeId,
        provider: 'lingxing',
        status: 'ready',
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
      });
      repo.saveSessionMetadata({
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: 3,
        observedAt: '2026-07-22T02:00:00.000Z',
        verifiedAt: '2026-07-22T02:00:00.000Z',
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
      });

      expect(() => repo.transaction(() => {
        repo.updateConnection({
          id: connectionId,
          storeId: store.storeId,
          externalAccountId: 'external-b',
        });
        throw new Error('injected authority failure');
      })).toThrow('injected authority failure');

      expect(repo.getConnection(store.storeId, 'lingxing')).toEqual(expect.objectContaining({
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
        status: 'ready',
        lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        session: expect.objectContaining({
          accountLabel: 'identity-a',
          externalAccountId: 'external-a',
          status: 'ready',
        }),
      }));
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
      expect(repo.listSchemaMigrations().map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
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

  it('keeps a duplicate Listing quarantine pending when marker clearance would violate store identity', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    let pendingId = 0;
    let pendingListingId = 0;
    try {
      const repo = new StoreRepository(database);
      const store = createStore(repo, 'listing-collision');
      database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, title, store_authority_quarantined
        ) VALUES (?, 'B000TEST001', 'Authoritative listing', 0)
      `).run(store.storeId);
      const pending = database.prepare(`
        INSERT INTO listing_content (
          store_id, asin, title, store_authority_quarantined
        ) VALUES (?, 'B000TEST001', 'Pending duplicate', 1)
      `).run(store.storeId);
      pendingListingId = Number(pending.lastInsertRowid);
      pendingId = insertPendingQuarantine(database, 'listing_content', pendingListingId);

      expectStoreError(() => repo.resolveMigrationQuarantine({
        quarantineId: pendingId,
        storeId: store.storeId,
        resolutionNote: 'Operator chose the already occupied store identity.',
      }), 'QUARANTINE_TARGET_CONFLICT');

      expect(database.prepare(`
        SELECT store_id AS storeId, store_authority_quarantined AS quarantined
        FROM listing_content WHERE id = ?
      `).get(pendingListingId)).toEqual({ storeId: store.storeId, quarantined: 1 });
      expect(database.prepare(`
        SELECT status, resolved_store_id AS resolvedStoreId
        FROM store_migration_quarantine WHERE id = ?
      `).get(pendingId)).toEqual({ status: 'pending', resolvedStoreId: null });
    } finally {
      database.close();
    }

    const reopened = initSqlite(dbPath);
    try {
      expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(reopened.prepare(`
        SELECT store_authority_quarantined AS quarantined
        FROM listing_content WHERE id = ?
      `).get(pendingListingId)).toEqual({ quarantined: 1 });
      expect(reopened.prepare(`
        SELECT status FROM store_migration_quarantine WHERE id = ?
      `).get(pendingId)).toEqual({ status: 'pending' });
    } finally {
      reopened.close();
    }
  });

  it('rejects resolving a pending Listing version into a different store than its parent', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const parentStore = createStore(repo, 'listing-parent');
      const otherStore = createStore(repo, 'listing-other');
      const listing = database.prepare(`
        INSERT INTO listing_content (store_id, asin, title)
        VALUES (?, 'B000TEST002', 'Parent listing')
      `).run(parentStore.storeId);
      const version = database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, title, store_authority_quarantined
        ) VALUES (?, ?, 'B000TEST002', 'Pending cross-store version', 1)
      `).run(otherStore.storeId, Number(listing.lastInsertRowid));
      const quarantineId = insertPendingQuarantine(
        database,
        'listing_content_versions',
        Number(version.lastInsertRowid),
      );

      expectStoreError(() => repo.resolveMigrationQuarantine({
        quarantineId,
        storeId: otherStore.storeId,
        resolutionNote: 'Attempted cross-store child assignment.',
      }), 'QUARANTINE_TARGET_CONFLICT');
      expect(database.prepare(`
        SELECT status FROM store_migration_quarantine WHERE id = ?
      `).get(quarantineId)).toEqual({ status: 'pending' });

      const matchingVersion = database.prepare(`
        INSERT INTO listing_content_versions (
          store_id, listing_content_id, asin, title, store_authority_quarantined
        ) VALUES (?, ?, 'B000TEST002', 'Pending matching-store version', 1)
      `).run(parentStore.storeId, Number(listing.lastInsertRowid));
      const matchingQuarantineId = insertPendingQuarantine(
        database,
        'listing_content_versions',
        Number(matchingVersion.lastInsertRowid),
      );
      expect(repo.resolveMigrationQuarantine({
        quarantineId: matchingQuarantineId,
        storeId: parentStore.storeId,
        resolutionNote: 'Verified against the authoritative parent listing.',
      })).toMatchObject({ status: 'resolved', resolvedStoreId: parentStore.storeId });
      expect(database.prepare(`
        SELECT store_id AS storeId, store_authority_quarantined AS quarantined
        FROM listing_content_versions WHERE id = ?
      `).get(Number(matchingVersion.lastInsertRowid))).toEqual({
        storeId: parentStore.storeId,
        quarantined: 0,
      });
    } finally {
      database.close();
    }
  });

  it('rejects report-file and ad-metric quarantine resolution that disagrees with the batch store', () => {
    const database = initSqlite(tempDbPath());
    try {
      const repo = new StoreRepository(database);
      const batchStore = createStore(repo, 'batch-parent');
      const otherStore = createStore(repo, 'batch-other');
      database.prepare(`
        INSERT INTO lingxing_report_batches (
          id, store_id, date_start, date_end, status, download_dir
        ) VALUES ('batch-parent-a', ?, '2026-07-20', '2026-07-20', 'completed', 'D:/reports')
      `).run(batchStore.storeId);
      const reportFile = database.prepare(`
        INSERT INTO report_files (
          store_id, batch_id, report_type, file_path, file_name, status
        ) VALUES (NULL, 'batch-parent-a', 'campaign', 'D:/reports/campaign.xlsx', 'campaign.xlsx', 'downloaded')
      `).run();
      const reportQuarantineId = insertPendingQuarantine(
        database,
        'report_files',
        Number(reportFile.lastInsertRowid),
      );
      const metric = database.prepare(`
        INSERT INTO ad_daily_metrics (
          store_id, batch_id, report_type, date, asin,
          source_file, source_row, store_authority_quarantined
        ) VALUES (
          NULL, 'batch-parent-a', 'campaign', '2026-07-20', 'B000TEST003',
          'D:/reports/campaign.xlsx', 2, 1
        )
      `).run();
      const metricQuarantineId = insertPendingQuarantine(
        database,
        'ad_daily_metrics',
        Number(metric.lastInsertRowid),
      );

      for (const quarantineId of [reportQuarantineId, metricQuarantineId]) {
        expectStoreError(() => repo.resolveMigrationQuarantine({
          quarantineId,
          storeId: otherStore.storeId,
          resolutionNote: 'Attempted cross-store batch child assignment.',
        }), 'QUARANTINE_TARGET_CONFLICT');
      }
      expect(database.prepare(`
        SELECT store_id AS storeId FROM report_files WHERE id = ?
      `).get(Number(reportFile.lastInsertRowid))).toEqual({ storeId: null });
      expect(database.prepare(`
        SELECT store_id AS storeId, store_authority_quarantined AS quarantined
        FROM ad_daily_metrics WHERE id = ?
      `).get(Number(metric.lastInsertRowid))).toEqual({ storeId: null, quarantined: 1 });
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
