// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { fs, os, path, tempRoots } from './stage8-operator-test-environment.mjs';
function tempRoot(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(root);
    return root;
}

function createOperationalReadSchema(database) {
    database.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      currency TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      business_timezone TEXT NOT NULL
    );
    CREATE TABLE store_connections (
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      last_verified_at TEXT,
      last_failure_code TEXT
    );
    CREATE TABLE store_session_metadata (
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      verified_at TEXT,
      expires_at TEXT,
      failure_code TEXT
    );
    CREATE TABLE lingxing_collection_jobs (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      currency TEXT NOT NULL,
      business_timezone TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      report_types_json TEXT NOT NULL,
      state TEXT NOT NULL,
      blocker_code TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE lingxing_collection_report_checkpoints (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      state TEXT NOT NULL,
      file_size_bytes INTEGER,
      error_code TEXT,
      detail TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE lingxing_report_batches (
      store_id TEXT NOT NULL,
      id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE report_import_runs (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source_file_count INTEGER NOT NULL,
      metric_row_count INTEGER NOT NULL,
      reconciliation_count INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE report_import_file_snapshots (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE report_import_reconciliations (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      status TEXT NOT NULL,
      within_tolerance INTEGER NOT NULL,
      reconciled_at TEXT NOT NULL
    );
  `);
}

function seedTwoStores(database) {
    const insertStore = database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency,
      display_name, status, business_timezone
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles')
  `);
    insertStore.run('secret-store-alpha', 'secret-profile-alpha', 'Alpha');
    insertStore.run('secret-store-beta', 'secret-profile-beta', 'Beta');
    const insertConnection = database.prepare(`
    INSERT INTO store_connections (
      store_id, provider, status, last_verified_at
    ) VALUES (?, ?, 'ready', '2026-07-28T00:00:00.000Z')
  `);
    const insertSession = database.prepare(`
    INSERT INTO store_session_metadata (
      store_id, provider, browser_profile_id, status, session_generation,
      observed_at, verified_at, expires_at
    ) VALUES (?, ?, ?, 'ready', 3, '2026-07-28T00:00:00.000Z',
              '2026-07-28T00:00:00.000Z', '2026-07-29T00:00:00.000Z')
  `);
    for (const [storeId, profileId] of [
        ['secret-store-alpha', 'secret-profile-alpha'],
        ['secret-store-beta', 'secret-profile-beta'],
    ]) {
        for (const provider of ['lingxing', 'amazon_ads']) {
            insertConnection.run(storeId, provider);
            insertSession.run(storeId, provider, profileId);
        }
    }
}
export { tempRoot, createOperationalReadSchema, seedTwoStores };
