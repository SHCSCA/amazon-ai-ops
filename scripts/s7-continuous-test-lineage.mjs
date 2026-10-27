// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { EXPECTED_REPORT_TYPES, dates, evaluationStoresRoot, fs, path } from './s7-continuous-test-environment.mjs';
import { sha256File, sha256Text } from './s7-continuous-test-artifacts.mjs';
function validSnapshot({ storesRoot = evaluationStoresRoot } = {}) {
    const stores = ['shc001', 'shc002'].map((storeId) => ({
        storeId,
        browserProfileId: `profile-${storeId}`,
        marketplace: 'US',
        currency: 'USD',
        status: 'active',
        businessTimezone: 'America/Los_Angeles',
    }));
    const jobs = [];
    const checkpoints = [];
    const imports = [];
    const importFiles = [];
    const reconciliations = [];
    for (const store of stores) {
        for (const [dayIndex, businessDate] of dates.entries()) {
            const jobId = `job-${store.storeId}-${businessDate}`;
            const runId = `run-${store.storeId}-${businessDate}`;
            const inputFingerprint = sha256Text(`fingerprint:${store.storeId}:${businessDate}`);
            jobs.push({
                storeId: store.storeId,
                jobId,
                requestId: `request-${store.storeId}-${businessDate}`,
                browserProfileId: store.browserProfileId,
                marketplace: 'US',
                currency: 'USD',
                businessTimezone: 'America/Los_Angeles',
                businessDate,
                sessionGeneration: 3,
                dateStart: businessDate,
                dateEnd: businessDate,
                reportTypesJson: JSON.stringify(EXPECTED_REPORT_TYPES),
                state: 'completed',
                blockerCode: null,
                detail: '8/8 reports downloaded and imported',
                createdAt: `${businessDate}T15:00:00.000Z`,
                completedAt: `${businessDate}T16:00:00.000Z`,
                updatedAt: `${businessDate}T16:30:00.000Z`,
            });
            imports.push({
                storeId: store.storeId,
                runId,
                idempotencyKey: `idem-${store.storeId}-${dayIndex}`,
                inputFingerprint,
                batchId: jobId,
                status: 'completed',
                sourceFileCount: 8,
                metricRowCount: 120,
                reconciliationCount: 8,
                startedAt: `${businessDate}T15:50:00.000Z`,
                completedAt: `${businessDate}T16:15:00.000Z`,
                createdAt: `${businessDate}T16:15:00.000Z`,
                businessDate,
                batchRequestId: `request-${store.storeId}-${businessDate}`,
                batchBrowserProfileId: store.browserProfileId,
                batchBusinessDate: businessDate,
                batchSessionGeneration: 3,
                batchStatus: 'completed',
                batchCreatedAt: `${businessDate}T15:05:00.000Z`,
                batchCompletedAt: `${businessDate}T16:00:00.000Z`,
            });
            for (const [reportIndex, reportType] of EXPECTED_REPORT_TYPES.entries()) {
                const filePath = path.join(storesRoot, store.storeId, 'downloads', businessDate, `${reportType}.csv`);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                const fileContents = `store=${store.storeId};date=${businessDate};type=${reportType}\n`;
                fs.writeFileSync(filePath, fileContents);
                const fileSizeBytes = fs.statSync(filePath).size;
                const fileHash = sha256File(filePath);
                checkpoints.push({
                    storeId: store.storeId,
                    jobId,
                    reportType,
                    state: 'downloaded',
                    fileSizeBytes,
                    updatedAt: `${businessDate}T15:45:00.000Z`,
                });
                importFiles.push({
                    storeId: store.storeId,
                    runId,
                    batchId: jobId,
                    reportType,
                    filePath,
                    fileName: path.basename(filePath),
                    fileSizeBytes,
                    fileHash,
                    importedRows: 15,
                    capturedAt: `${businessDate}T16:15:00.000Z`,
                });
                reconciliations.push({
                    storeId: store.storeId,
                    runId,
                    batchId: jobId,
                    reportType,
                    status: 'matched',
                    withinTolerance: 1,
                    reconciledAt: `${businessDate}T16:15:00.000Z`,
                });
            }
        }
    }
    return {
        globalActiveUsUsdStoreCount: 2,
        stores,
        jobs,
        checkpoints,
        imports,
        importFiles,
        reconciliations,
    };
}

function seedContinuousDatabase(database, storesRoot) {
    database.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      business_timezone TEXT NOT NULL
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
      completed_at TEXT,
      PRIMARY KEY (store_id, job_id)
    );
    CREATE TABLE lingxing_collection_report_checkpoints (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      state TEXT NOT NULL,
      file_size_bytes INTEGER,
      error_code TEXT,
      detail TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store_id, job_id, report_type)
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
      completed_at TEXT NOT NULL,
      PRIMARY KEY (store_id, id)
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
      created_at TEXT NOT NULL,
      PRIMARY KEY (store_id, run_id)
    );
    CREATE TABLE report_import_file_snapshots (
      store_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      imported_rows INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (store_id, snapshot_id)
    );
    CREATE TABLE report_import_reconciliations (
      store_id TEXT NOT NULL,
      reconciliation_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      status TEXT NOT NULL,
      within_tolerance INTEGER NOT NULL,
      reconciled_at TEXT NOT NULL,
      PRIMARY KEY (store_id, reconciliation_id)
    );
  `);
    const snapshot = validSnapshot({ storesRoot });
    const insertStore = database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, status, business_timezone
    ) VALUES (
      @storeId, @browserProfileId, @marketplace, @currency, @status, @businessTimezone
    )
  `);
    const insertJob = database.prepare(`
    INSERT INTO lingxing_collection_jobs (
      store_id, job_id, request_id, browser_profile_id, marketplace, currency,
      business_timezone, business_date, session_generation, date_start, date_end,
      report_types_json, state, blocker_code, detail, created_at, updated_at, completed_at
    ) VALUES (
      @storeId, @jobId, @requestId, @browserProfileId, @marketplace, @currency,
      @businessTimezone, @businessDate, @sessionGeneration, @dateStart, @dateEnd,
      @reportTypesJson, @state, @blockerCode, @detail, @createdAt, @updatedAt, @completedAt
    )
  `);
    const insertCheckpoint = database.prepare(`
    INSERT INTO lingxing_collection_report_checkpoints (
      store_id, job_id, report_type, state, file_size_bytes, error_code, detail, updated_at
    ) VALUES (
      @storeId, @jobId, @reportType, @state, @fileSizeBytes, NULL, NULL, @updatedAt
    )
  `);
    const insertBatch = database.prepare(`
    INSERT INTO lingxing_report_batches (
      store_id, id, request_id, browser_profile_id, business_date,
      session_generation, status, created_at, completed_at
    ) VALUES (
      @storeId, @batchId, @batchRequestId, @batchBrowserProfileId, @batchBusinessDate,
      @batchSessionGeneration, @batchStatus, @batchCreatedAt, @batchCompletedAt
    )
  `);
    const insertRun = database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (
      @storeId, @runId, @idempotencyKey, @inputFingerprint, @batchId, @status,
      @sourceFileCount, @metricRowCount, @reconciliationCount,
      @startedAt, @completedAt, @createdAt
    )
  `);
    const insertFile = database.prepare(`
    INSERT INTO report_import_file_snapshots (
      store_id, snapshot_id, run_id, batch_id, report_type, file_path, file_name,
      file_size_bytes, file_hash, imported_rows, captured_at
    ) VALUES (
      @storeId, @snapshotId, @runId, @batchId, @reportType, @filePath, @fileName,
      @fileSizeBytes, @fileHash, @importedRows, @capturedAt
    )
  `);
    const insertReconciliation = database.prepare(`
    INSERT INTO report_import_reconciliations (
      store_id, reconciliation_id, run_id, batch_id, report_type,
      status, within_tolerance, reconciled_at
    ) VALUES (
      @storeId, @reconciliationId, @runId, @batchId, @reportType,
      @status, @withinTolerance, @reconciledAt
    )
  `);
    database.transaction(() => {
        snapshot.stores.forEach((row) => insertStore.run(row));
        snapshot.jobs.forEach((row) => insertJob.run(row));
        snapshot.checkpoints.forEach((row) => insertCheckpoint.run(row));
        snapshot.imports.forEach((row) => {
            insertBatch.run(row);
            insertRun.run(row);
        });
        snapshot.importFiles.forEach((row, index) => insertFile.run({
            ...row,
            snapshotId: `snapshot-${index}`,
        }));
        snapshot.reconciliations.forEach((row, index) => insertReconciliation.run({
            ...row,
            reconciliationId: `reconciliation-${index}`,
        }));
    })();
}
export { validSnapshot, seedContinuousDatabase };
