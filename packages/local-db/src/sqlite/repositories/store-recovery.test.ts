// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, SQLITE_MIGRATION_CONTRACT, StoreRepository, describe, expect, fs, initSqlite, it, path } from './store-repository-test-environment';
import { createStore, expectStoreError, insertPendingQuarantine, tempDbPath } from './store-repository-test-fixture';
describe('StoreRepository', () => {
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
    }
    finally {
        legacy.close();
    }
    const database = initSqlite(dbPath);
    try {
        const repo = new StoreRepository(database);
        expect(repo.listSchemaMigrations().map((migration) => migration.version)).toEqual(SQLITE_MIGRATION_CONTRACT.map(row => row.version));
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
    }
    finally {
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
    }
    finally {
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
    }
    finally {
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
        const quarantineId = insertPendingQuarantine(database, 'listing_content_versions', Number(version.lastInsertRowid));
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
        const matchingQuarantineId = insertPendingQuarantine(database, 'listing_content_versions', Number(matchingVersion.lastInsertRowid));
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
    }
    finally {
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
        const reportQuarantineId = insertPendingQuarantine(database, 'report_files', Number(reportFile.lastInsertRowid));
        const metric = database.prepare(`
        INSERT INTO ad_daily_metrics (
          store_id, batch_id, report_type, date, asin,
          source_file, source_row, store_authority_quarantined
        ) VALUES (
          NULL, 'batch-parent-a', 'campaign', '2026-07-20', 'B000TEST003',
          'D:/reports/campaign.xlsx', 2, 1
        )
      `).run();
        const metricQuarantineId = insertPendingQuarantine(database, 'ad_daily_metrics', Number(metric.lastInsertRowid));
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
    }
    finally {
        database.close();
    }
});
});
