// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, StoreRepository, describe, expect, initSqlite, it, normalizeBrowserProfileId, normalizeStoreCapabilityId } from './store-repository-test-environment';
import { createLingxingConnection, createStore, expectStoreError, tempDbPath } from './store-repository-test-fixture';
describe('StoreRepository', () => {
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
        const archived = repo.archiveStore({
            storeId: store.storeId,
            expectedUpdatedAt: repo.getStore(store.storeId)!.updatedAt,
        });
        expect(archived.status).toBe('archived');
        expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 5,
            failureCode: 'store_archived',
            accountLabel: undefined,
        });
        expect(repo.getConnection(store.storeId, 'lingxing')).toMatchObject({
            status: 'attention_required',
            lastFailureCode: 'store_archived',
        });
        expectStoreError(() => repo.updateConnection({
            id: connectionId,
            storeId: store.storeId,
            expectedUpdatedAt: connection.updatedAt,
            status: 'ready',
        }), 'STORE_NOT_ACTIVE');
        const restored = repo.restoreStore({
            storeId: store.storeId,
            expectedUpdatedAt: archived.updatedAt,
        });
        expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 5,
            failureCode: 'store_archived',
        });
        repo.updateStore({
            storeId: store.storeId,
            expectedUpdatedAt: restored.updatedAt,
            patch: { status: 'inactive' },
        });
        expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 6,
            failureCode: 'store_inactive',
            accountLabel: undefined,
            externalAccountId: undefined,
            verifiedAt: undefined,
            expiresAt: undefined,
        });
        expect(repo.getConnection(store.storeId, 'lingxing')).toMatchObject({
            status: 'attention_required',
            lastFailureCode: 'store_inactive',
        });
        expectStoreError(() => repo.advanceSessionGeneration(store.storeId, 'lingxing'), 'STORE_NOT_ACTIVE');
        expectStoreError(() => repo.removeConnection({
            id: connectionId,
            storeId: store.storeId,
            expectedUpdatedAt: connection.updatedAt,
        }), 'STORE_NOT_ACTIVE');
    }
    finally {
        database.close();
    }
});

it('invalidates inactive and archived store sessions without changing another store', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const target = createStore(repo, 'lifecycle-target');
        const other = createStore(repo, 'lifecycle-other');
        for (const [store, externalAccountId] of [
            [target, 'lifecycle-target-id'],
            [other, 'lifecycle-other-id'],
        ] as const) {
            createLingxingConnection(repo, {
                id: normalizeStoreCapabilityId(`cap-${store.storeId}`),
                storeId: store.storeId,
                status: 'ready',
                accountLabel: store.displayName,
                externalAccountId,
                lastVerifiedAt: '2026-07-22T02:00:00.000Z',
            });
            repo.saveSessionMetadata({
                storeId: store.storeId,
                browserProfileId: store.browserProfileId,
                provider: 'lingxing',
                status: 'ready',
                sessionGeneration: 2,
                observedAt: '2026-07-22T02:00:00.000Z',
                accountLabel: store.displayName,
                externalAccountId,
                verifiedAt: '2026-07-22T02:00:00.000Z',
            });
        }
        const inactive = repo.updateStore({
            storeId: target.storeId,
            expectedUpdatedAt: target.updatedAt,
            patch: { status: 'inactive' },
        });
        expect(repo.getSessionMetadata(target.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 3,
            failureCode: 'store_inactive',
        });
        expect(repo.getSessionMetadata(other.storeId, 'lingxing')).toMatchObject({
            status: 'ready',
            sessionGeneration: 2,
            externalAccountId: 'lifecycle-other-id',
        });
        const activeAgain = repo.updateStore({
            storeId: target.storeId,
            expectedUpdatedAt: inactive.updatedAt,
            patch: { status: 'active' },
        });
        const archived = repo.archiveStore({
            storeId: target.storeId,
            expectedUpdatedAt: activeAgain.updatedAt,
        });
        expect(repo.getSessionMetadata(target.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 4,
            failureCode: 'store_archived',
            accountLabel: undefined,
            externalAccountId: undefined,
        });
        repo.restoreStore({ storeId: target.storeId, expectedUpdatedAt: archived.updatedAt });
        expect(repo.getSessionMetadata(target.storeId, 'lingxing')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 4,
            failureCode: 'store_archived',
        });
        expect(repo.getSessionMetadata(other.storeId, 'lingxing')).toMatchObject({
            status: 'ready',
            sessionGeneration: 2,
        });
    }
    finally {
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
        expectStoreError(() => repo.createConnection({
            id: normalizeStoreCapabilityId('cap-ads-invalid-selector'),
            storeId: store.storeId,
            provider: 'amazon_ads',
            collectionStoreName: 'Lingxing-only selector',
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
            status: 'ready',
        } as unknown as Parameters<StoreRepository['updateConnection']>[0]), 'INVALID_STORE_INPUT');
        expectStoreError(() => repo.removeConnection({
            id: valid.id,
            storeId: store.storeId,
        } as unknown as Parameters<StoreRepository['removeConnection']>[0]), 'INVALID_STORE_INPUT');
        expectStoreError(() => repo.updateConnection({
            id: valid.id,
            storeId: store.storeId,
            expectedUpdatedAt: valid.updatedAt,
            externalAccountId: `profile-${'x'.repeat(257)}`,
        }), 'INVALID_STORE_INPUT');
        expect(repo.getConnection(store.storeId, 'amazon_ads')?.externalAccountId).toBe('profile-1');
    }
    finally {
        database.close();
    }
});

it('enrolls Lingxing stable identity only from the trusted path and enforces global provider uniqueness', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const first = createStore(repo, 'unique-a');
        const second = createStore(repo, 'unique-b');
        expectStoreError(() => repo.createConnection({
            id: normalizeStoreCapabilityId('cap-unique-lingxing-a'),
            storeId: first.storeId,
            provider: 'lingxing',
            externalAccountId: '  ＳＴＯＲＥ－ＡＢＣ  ',
        }), 'INVALID_STORE_INPUT');
        const firstConnection = repo.createConnection({
            id: normalizeStoreCapabilityId('cap-unique-lingxing-a'),
            storeId: first.storeId,
            provider: 'lingxing',
            collectionStoreName: 'Visible Store A',
        });
        const enrolled = repo.enrollLingxingStableExternalAccount({
            id: firstConnection.id,
            storeId: first.storeId,
            provider: 'lingxing',
            externalAccountId: '  ＳＴＯＲＥ－ＡＢＣ  ',
            expectedUpdatedAt: firstConnection.updatedAt,
        });
        expect(repo.getConnection(first.storeId, 'lingxing')).toMatchObject({
            externalAccountId: 'ＳＴＯＲＥ－ＡＢＣ',
            normalizedExternalAccountId: 'store-abc',
            collectionStoreName: 'Visible Store A',
        });
        const secondConnection = repo.createConnection({
            id: normalizeStoreCapabilityId('cap-unique-lingxing-b'),
            storeId: second.storeId,
            provider: 'lingxing',
            collectionStoreName: 'Visible Store B',
        });
        expectStoreError(() => repo.enrollLingxingStableExternalAccount({
            id: secondConnection.id,
            storeId: second.storeId,
            provider: 'lingxing',
            externalAccountId: 'store-abc',
            expectedUpdatedAt: secondConnection.updatedAt,
        }), 'EXTERNAL_ACCOUNT_ALREADY_BOUND');
        expect(repo.getConnection(second.storeId, 'lingxing')).toEqual(secondConnection);
        expectStoreError(() => repo.enrollLingxingStableExternalAccount({
            id: enrolled.id,
            storeId: first.storeId,
            provider: 'lingxing',
            externalAccountId: 'store-revision-2',
            expectedUpdatedAt: firstConnection.updatedAt,
        }), 'CONNECTION_CONFLICT');
        expectStoreError(() => repo.updateConnection({
            id: enrolled.id,
            storeId: first.storeId,
            expectedUpdatedAt: enrolled.updatedAt,
            externalAccountId: 'operator-entered-rebind',
        }), 'INVALID_STORE_INPUT');
        expect(() => repo.createConnection({
            id: normalizeStoreCapabilityId('cap-unique-ads-b'),
            storeId: second.storeId,
            provider: 'amazon_ads',
            externalAccountId: 'STORE-ABC',
        })).not.toThrow();
        expect(repo.getConnection(second.storeId, 'amazon_ads')).toMatchObject({
            normalizedExternalAccountId: 'store-abc',
        });
    }
    finally {
        database.close();
    }
});

it('enrolls the first trusted Lingxing stable identity without invalidating session authority', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, 'trusted-enrollment');
        const connection = repo.createConnection({
            id: normalizeStoreCapabilityId('cap-trusted-enrollment'),
            storeId: store.storeId,
            provider: 'lingxing',
            status: 'ready',
            accountLabel: 'Lingxing operator',
            collectionStoreName: 'US Main Store',
            lastVerifiedAt: '2026-08-04T01:00:00.000Z',
        });
        const session = repo.saveSessionMetadata({
            storeId: store.storeId,
            browserProfileId: store.browserProfileId,
            provider: 'lingxing',
            status: 'ready',
            sessionGeneration: 5,
            observedAt: '2026-08-04T01:00:00.000Z',
            accountLabel: 'Lingxing operator',
            externalAccountId: 'seller-123',
            verifiedAt: '2026-08-04T01:00:00.000Z',
        });
        const enrolled = repo.enrollLingxingStableExternalAccount({
            id: connection.id,
            storeId: store.storeId,
            provider: 'lingxing',
            externalAccountId: ' SELLER-123 ',
            expectedUpdatedAt: connection.updatedAt,
        });
        expect(enrolled).toMatchObject({
            status: 'ready',
            externalAccountId: 'SELLER-123',
            normalizedExternalAccountId: 'seller-123',
            collectionStoreName: 'US Main Store',
            lastVerifiedAt: '2026-08-04T01:00:00.000Z',
        });
        expect(enrolled.updatedAt).not.toBe(connection.updatedAt);
        expect(repo.getSessionMetadata(store.storeId, 'lingxing')).toEqual(session);
        expect(enrolled.session).toEqual(session);
    }
    finally {
        database.close();
    }
});

it('applies connection revision CAS and rolls back a losing external identity claim with its session', () => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const owner = createStore(repo, 'claim-owner');
        const contender = createStore(repo, 'claim-contender');
        repo.createConnection({
            id: normalizeStoreCapabilityId('cap-claim-owner'),
            storeId: owner.storeId,
            provider: 'amazon_ads',
            externalAccountId: 'claimed-store',
        });
        const created = repo.createConnection({
            id: normalizeStoreCapabilityId('cap-claim-contender'),
            storeId: contender.storeId,
            provider: 'amazon_ads',
            status: 'ready',
            accountLabel: 'contender',
            externalAccountId: 'contender-store',
            lastVerifiedAt: '2026-07-22T02:00:00.000Z',
        });
        repo.saveSessionMetadata({
            storeId: contender.storeId,
            browserProfileId: contender.browserProfileId,
            provider: 'amazon_ads',
            status: 'ready',
            sessionGeneration: 7,
            observedAt: '2026-07-22T02:00:00.000Z',
            accountLabel: 'contender',
            externalAccountId: 'contender-store',
            verifiedAt: '2026-07-22T02:00:00.000Z',
        });
        const winner = repo.updateConnection({
            id: created.id,
            storeId: contender.storeId,
            expectedUpdatedAt: created.updatedAt,
            accountLabel: 'winner-label',
        });
        expectStoreError(() => repo.updateConnection({
            id: created.id,
            storeId: contender.storeId,
            expectedUpdatedAt: created.updatedAt,
            externalAccountId: 'stale-writer',
        }), 'CONNECTION_CONFLICT');
        expect(repo.getConnection(contender.storeId, 'amazon_ads')?.updatedAt).toBe(winner.updatedAt);
        expectStoreError(() => repo.updateConnection({
            id: created.id,
            storeId: contender.storeId,
            expectedUpdatedAt: winner.updatedAt,
            accountLabel: 'new-account',
            externalAccountId: ' CLAIMED-STORE ',
        }), 'EXTERNAL_ACCOUNT_ALREADY_BOUND');
        expect(repo.getConnection(contender.storeId, 'amazon_ads')).toEqual(winner);
        expect(repo.getSessionMetadata(contender.storeId, 'amazon_ads')).toEqual(winner.session);
    }
    finally {
        database.close();
    }
});

it('returns a connection CAS conflict when a competing database wins during patch normalization', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    const concurrentDatabase = new Database(dbPath);
    concurrentDatabase.pragma('journal_mode = WAL');
    concurrentDatabase.pragma('foreign_keys = ON');
    try {
        const repo = new StoreRepository(database);
        const concurrentRepo = new StoreRepository(concurrentDatabase);
        const store = createStore(repo, 'connection-race');
        const created = repo.createConnection({
            id: normalizeStoreCapabilityId('cap-connection-race'),
            storeId: store.storeId,
            provider: 'amazon_ads',
            accountLabel: 'initial',
            externalAccountId: 'initial-store',
        });
        let raced = false;
        const racedInput = {
            id: created.id,
            storeId: store.storeId,
            expectedUpdatedAt: created.updatedAt,
        } as Parameters<StoreRepository['updateConnection']>[0];
        Object.defineProperty(racedInput, 'accountLabel', {
            enumerable: true,
            get: () => {
                if (!raced) {
                    raced = true;
                    concurrentRepo.updateConnection({
                        id: created.id,
                        storeId: store.storeId,
                        expectedUpdatedAt: created.updatedAt,
                        accountLabel: 'concurrent-winner',
                        externalAccountId: 'winner-store',
                    });
                }
                return 'stale-writer';
            },
        });
        expectStoreError(() => repo.updateConnection(racedInput), 'CONNECTION_CONFLICT');
        expect(repo.getConnection(store.storeId, 'amazon_ads')).toMatchObject({
            accountLabel: 'concurrent-winner',
            externalAccountId: 'winner-store',
            normalizedExternalAccountId: 'winner-store',
        });
    }
    finally {
        concurrentDatabase.close();
        database.close();
    }
});

it.each([
    ['omits the external account id', {}, undefined],
    ['submits a normalized-equivalent external account id', { externalAccountId: '  external-a  ' }, 'external-a'],
])('resets verified provider identity and session metadata when the account label changes and %s', (_externalIdentityCase, externalIdentityPatch, expectedExternalAccountId) => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, 'identity-rebind');
        const connectionId = normalizeStoreCapabilityId('cap-identity-rebind');
        const created = repo.createConnection({
            id: connectionId,
            storeId: store.storeId,
            provider: 'amazon_ads',
            status: 'ready',
            accountLabel: 'identity-a',
            externalAccountId: 'external-a',
            lastVerifiedAt: '2026-07-22T02:00:00.000Z',
            lastFailureCode: 'old-failure',
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
        const rebound = repo.updateConnection({
            id: connectionId,
            storeId: store.storeId,
            expectedUpdatedAt: created.updatedAt,
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
        expect(rebound.externalAccountId).toBe(expectedExternalAccountId);
        expect(rebound.lastVerifiedAt).toBeUndefined();
        expect(rebound.lastFailureCode).toBe('connection_identity_changed');
        expect(rebound.session).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 4,
            failureCode: 'connection_identity_changed',
            accountLabel: undefined,
            externalAccountId: undefined,
            verifiedAt: undefined,
        });
    }
    finally {
        database.close();
    }
});

it.each([
    ['sets', undefined, 'external-b', 'external-b'],
    ['replaces', 'external-a', 'external-b', 'external-b'],
    ['clears', 'external-a', '   ', undefined],
])('resets verification while persisting the new expected external account id when it %s', (_operation, initialExternalAccountId, submittedExternalAccountId, expectedExternalAccountId) => {
    const database = initSqlite(tempDbPath());
    try {
        const repo = new StoreRepository(database);
        const store = createStore(repo, `external-identity-${_operation}`);
        const connectionId = normalizeStoreCapabilityId(`cap-external-identity-${_operation}`);
        const created = repo.createConnection({
            id: connectionId,
            storeId: store.storeId,
            provider: 'amazon_ads',
            status: 'ready',
            accountLabel: 'identity-a',
            externalAccountId: initialExternalAccountId,
            lastVerifiedAt: '2026-07-22T02:00:00.000Z',
            lastFailureCode: 'old-failure',
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
            externalAccountId: initialExternalAccountId,
        });
        const rebound = repo.updateConnection({
            id: connectionId,
            storeId: store.storeId,
            expectedUpdatedAt: created.updatedAt,
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
        expect(rebound.lastFailureCode).toBe('connection_identity_changed');
        expect(repo.getSessionMetadata(store.storeId, 'amazon_ads')).toMatchObject({
            status: 'signed_out',
            sessionGeneration: 4,
            failureCode: 'connection_identity_changed',
            accountLabel: undefined,
            externalAccountId: undefined,
            verifiedAt: undefined,
        });
    }
    finally {
        database.close();
    }
});
});
