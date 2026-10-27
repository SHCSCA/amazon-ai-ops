// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, StoreRepository, StoreRepositoryError, expect, fs, normalizeBrowserProfileId, normalizeStoreId, os, path, tempDirs } from './store-repository-test-environment';
function tempDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-repo-'));
    tempDirs.push(dir);
    return path.join(dir, 'app.db');
}

function createStore(repo: StoreRepository, suffix = 'a') {
    return repo.createStore({
        storeId: normalizeStoreId(`store-${suffix}`),
        browserProfileId: normalizeBrowserProfileId(`profile-${suffix}`),
        displayName: `US Store ${suffix.toUpperCase()}`,
    });
}

function createLingxingConnection(repo: StoreRepository, input: Omit<Parameters<StoreRepository['createConnection']>[0], 'provider'> & {
    provider?: 'lingxing';
}) {
    const { externalAccountId, provider: _provider, ...connectionInput } = input;
    const created = repo.createConnection({
        ...connectionInput,
        provider: 'lingxing',
    });
    if (externalAccountId === undefined || externalAccountId.trim() === '')
        return created;
    return repo.enrollLingxingStableExternalAccount({
        id: created.id,
        storeId: created.storeId,
        provider: 'lingxing',
        externalAccountId,
        expectedUpdatedAt: created.updatedAt,
    });
}

function expectStoreError(action: () => unknown, code: StoreRepositoryError['code']): void {
    let thrown: unknown;
    try {
        action();
    }
    catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreRepositoryError);
    expect((thrown as StoreRepositoryError).code).toBe(code);
}

function insertPendingQuarantine(database: Database.Database, sourceTable: string, sourceRowId: string | number): number {
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
export { tempDbPath, createStore, createLingxingConnection, expectStoreError, insertPendingQuarantine };
