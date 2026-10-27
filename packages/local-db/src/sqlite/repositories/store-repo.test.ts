// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, StoreRepository, describe, expect, initSqlite, it, normalizeBrowserProfileId, normalizeStoreId } from './store-repository-test-environment';
import { createStore, expectStoreError, tempDbPath } from './store-repository-test-fixture';
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
        expectStoreError(() => repo.updateStore({
            storeId: created.storeId,
            patch: { displayName: 'Missing revision' },
        } as never), 'STORE_CONFLICT');
        expectStoreError(() => repo.archiveStore({
            storeId: created.storeId,
        } as never), 'STORE_CONFLICT');
        const archived = repo.archiveStore({
            storeId: created.storeId,
            expectedUpdatedAt: updated.updatedAt,
        });
        expect(archived.status).toBe('archived');
        expect(archived.archivedAt).toBeTruthy();
        expect(repo.listStores()).toEqual([]);
        expect(repo.listStores({ includeArchived: true })).toHaveLength(1);
        expect(repo.deleteStore({
            storeId: created.storeId,
            expectedUpdatedAt: archived.updatedAt,
        })).toEqual(archived);
        expect(database.prepare(`SELECT COUNT(*) AS count FROM stores`).get()).toEqual({ count: 1 });
        expect(database.prepare(`SELECT COUNT(*) AS count FROM products`).get()).toEqual({ count: 1 });
        expectStoreError(() => repo.restoreStore({
            storeId: created.storeId,
        } as never), 'STORE_CONFLICT');
        const restored = repo.restoreStore({
            storeId: created.storeId,
            expectedUpdatedAt: archived.updatedAt,
        });
        expect(restored).toMatchObject({ status: 'active', archivedAt: undefined });
        expect(repo.getRestorePreflight(created.storeId)).toMatchObject({
            canRestore: true,
            alreadyActive: true,
        });
    }
    finally {
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
        const patch = {} as {
            displayName: string;
        };
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
    }
    finally {
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
        expectStoreError(() => repo.createStore({
            storeId: normalizeStoreId('store-timezone'),
            browserProfileId: normalizeBrowserProfileId('profile-timezone'),
            displayName: 'Wrong timezone',
            businessTimezone: 'UTC',
        }), 'INVALID_STORE_INPUT');
        const store = repo.getStore(normalizeStoreId('store-a'))!;
        expectStoreError(() => repo.updateStore({
            storeId: store.storeId,
            expectedUpdatedAt: store.updatedAt,
            patch: { businessTimezone: 'America/New_York' },
        }), 'INVALID_STORE_INPUT');
        expect(database.prepare(`SELECT COUNT(*) AS count FROM stores`).get()).toEqual({ count: 1 });
    }
    finally {
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
    }
    finally {
        database.close();
    }
});
});
