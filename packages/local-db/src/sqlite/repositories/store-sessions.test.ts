// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, StoreRepository, describe, expect, initSqlite, it, normalizeStoreCapabilityId } from './store-repository-test-environment';
import { createLingxingConnection, createStore, expectStoreError, tempDbPath } from './store-repository-test-fixture';
describe('StoreRepository', () => {
it('persists a normalized expected Amazon Ads profile id before login without accepting forged verification state', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, 'pre-login-ads-identity');
        const connectionId = normalizeStoreCapabilityId('cap-pre-login-ads-identity');
        const created = repo.createConnection({
            id: connectionId,
            storeId: store.storeId,
            provider: 'amazon_ads',
            status: 'not_configured',
            accountLabel: 'US Ads',
        });
        const updated = repo.updateConnection({
            id: connectionId,
            storeId: store.storeId,
            expectedUpdatedAt: created.updatedAt,
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
        expect(updated.lastFailureCode).toBe('connection_identity_changed');
        expect(updated.session).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 0,
            failureCode: 'connection_identity_changed',
        });
        expect(repo.getConnection(store.storeId, 'amazon_ads')).toEqual(updated);
    }
    finally {
        database.close();
    }
});

it('keeps normalized-equivalent connection identity updates idempotent', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, 'identity-idempotent');
        const connectionId = normalizeStoreCapabilityId('cap-identity-idempotent');
        const created = repo.createConnection({
            id: connectionId,
            storeId: store.storeId,
            provider: 'amazon_ads',
            status: 'ready',
            accountLabel: 'identity-a',
            externalAccountId: 'external-a',
            lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        });
        repo.saveSessionMetadata({
            storeId: store.storeId,
            browserProfileId: store.browserProfileId,
            provider: 'amazon_ads',
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
            expectedUpdatedAt: created.updatedAt,
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
    }
    finally {
        database.close();
    }
});

it('invalidates only the matching store/provider session when a Lingxing selector changes', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const targetStore = createStore(repo, 'identity-isolation-target');
        const otherStore = createStore(repo, 'identity-isolation-other');
        const targetConnectionId = normalizeStoreCapabilityId('cap-identity-isolation-target');
        const targetConnection = createLingxingConnection(repo, {
            id: targetConnectionId,
            storeId: targetStore.storeId,
            status: 'ready',
            accountLabel: 'target',
            externalAccountId: 'external-a',
            collectionStoreName: 'Target Store A',
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
        createLingxingConnection(repo, {
            id: normalizeStoreCapabilityId('cap-identity-isolation-other'),
            storeId: otherStore.storeId,
            status: 'ready',
            accountLabel: 'other',
            externalAccountId: 'external-other',
            collectionStoreName: 'Other Store',
            lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        });
        for (const [store, provider, accountLabel, externalAccountId] of [
            [targetStore, 'lingxing', 'target', 'external-a'],
            [targetStore, 'amazon_ads', 'target-ads', 'ads-a'],
            [otherStore, 'lingxing', 'other', 'external-other'],
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
        const selectorChanged = repo.updateConnection({
            id: targetConnectionId,
            storeId: targetStore.storeId,
            expectedUpdatedAt: targetConnection.updatedAt,
            collectionStoreName: 'Target Store B',
        });
        expect(repo.getConnection(targetStore.storeId, 'lingxing')).toMatchObject({
            externalAccountId: undefined,
            normalizedExternalAccountId: undefined,
            collectionStoreName: 'Target Store B',
            status: 'not_configured',
        });
        expect(repo.getSessionMetadata(targetStore.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 4,
            failureCode: 'connection_identity_changed',
            accountLabel: undefined,
            externalAccountId: undefined,
        });
        expect(repo.getSessionMetadata(targetStore.storeId, 'amazon_ads')).toEqual(expect.objectContaining({ externalAccountId: 'ads-a', status: 'ready' }));
        expect(repo.getSessionMetadata(otherStore.storeId, 'lingxing')).toEqual(expect.objectContaining({ externalAccountId: 'external-other', status: 'ready' }));
        const reenrolled = repo.enrollLingxingStableExternalAccount({
            id: targetConnectionId,
            storeId: targetStore.storeId,
            provider: 'lingxing',
            externalAccountId: 'external-b',
            expectedUpdatedAt: selectorChanged.updatedAt,
        });
        expect(reenrolled).toMatchObject({
            externalAccountId: 'external-b',
            normalizedExternalAccountId: 'external-b',
            collectionStoreName: 'Target Store B',
            status: 'not_configured',
        });
        expect(reenrolled.session).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 4,
            failureCode: 'connection_identity_changed',
        });
    }
    finally {
        database.close();
    }
});

it('rolls back external identity reset and session invalidation with the authority transaction', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, 'identity-rebind-rollback');
        const connectionId = normalizeStoreCapabilityId('cap-identity-rebind-rollback');
        const created = repo.createConnection({
            id: connectionId,
            storeId: store.storeId,
            provider: 'amazon_ads',
            status: 'ready',
            accountLabel: 'identity-a',
            externalAccountId: 'external-a',
            lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        });
        repo.saveSessionMetadata({
            storeId: store.storeId,
            browserProfileId: store.browserProfileId,
            provider: 'amazon_ads',
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
                expectedUpdatedAt: created.updatedAt,
                externalAccountId: 'external-b',
            });
            throw new Error('injected authority failure');
        })).toThrow('injected authority failure');
        expect(repo.getConnection(store.storeId, 'amazon_ads')).toEqual(expect.objectContaining({
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
    }
    finally {
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
    }
    finally {
        concurrentDatabase.close();
        database.close();
    }
});

it('rejects stale connection removal without creating a session tombstone', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, 'remove-cas');
        const created = repo.createConnection({
            id: normalizeStoreCapabilityId('cap-remove-cas'),
            storeId: store.storeId,
            provider: 'lingxing',
            collectionStoreName: 'US Store',
        });
        const session = repo.saveSessionMetadata({
            storeId: store.storeId,
            browserProfileId: store.browserProfileId,
            provider: 'lingxing',
            status: 'ready',
            sessionGeneration: 4,
            observedAt: '2026-08-04T02:00:00.000Z',
        });
        const current = repo.updateConnection({
            id: created.id,
            storeId: store.storeId,
            expectedUpdatedAt: created.updatedAt,
            status: 'ready',
        });
        expectStoreError(() => repo.removeConnection({
            id: created.id,
            storeId: store.storeId,
            expectedUpdatedAt: created.updatedAt,
        }), 'CONNECTION_CONFLICT');
        expect(repo.getConnection(store.storeId, 'lingxing')).toEqual(current);
        expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toEqual(session);
        repo.removeConnection({
            id: current.id,
            storeId: store.storeId,
            expectedUpdatedAt: current.updatedAt,
        });
        expect(repo.getConnection(store.storeId, 'lingxing')).toBeUndefined();
        expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 5,
            failureCode: 'connection_removed',
        });
    }
    finally {
        database.close();
    }
});

it('keeps a generation tombstone across connection removal and recreation', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, 'connection-aba');
        const originalConnectionId = normalizeStoreCapabilityId('cap-connection-aba-old');
        const originalConnection = repo.createConnection({
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
        repo.removeConnection({
            id: originalConnectionId,
            storeId: store.storeId,
            expectedUpdatedAt: originalConnection.updatedAt,
        });
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
    }
    finally {
        database.close();
    }
});
});
