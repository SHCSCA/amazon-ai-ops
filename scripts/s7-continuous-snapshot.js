// 按职责复用原有严格校验，公共入口继续保持兼容。



function placeholders(values) {
    return values.map(() => '?').join(', ');
}

function readContinuousOperationSnapshot(database, input) {
    const storePlaceholders = placeholders(input.stores);
    const datePlaceholders = placeholders(input.dates);
    const scope = [...input.stores, ...input.dates];
    const globalActiveUsUsdStoreCount = Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM stores
    WHERE status = 'active' AND marketplace = 'US' AND currency = 'USD'
  `).get().count);
    const stores = database.prepare(`
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, status, business_timezone AS businessTimezone
    FROM stores WHERE store_id IN (${storePlaceholders})
    ORDER BY store_id
  `).all(...input.stores);
    const jobs = database.prepare(`
    SELECT store_id AS storeId, job_id AS jobId, request_id AS requestId,
           browser_profile_id AS browserProfileId, marketplace, currency,
           business_timezone AS businessTimezone,
           business_date AS businessDate, session_generation AS sessionGeneration,
           date_start AS dateStart, date_end AS dateEnd,
           report_types_json AS reportTypesJson,
           state, blocker_code AS blockerCode,
           detail, created_at AS createdAt, updated_at AS updatedAt,
           completed_at AS completedAt
    FROM lingxing_collection_jobs
    WHERE store_id IN (${storePlaceholders})
      AND business_date IN (${datePlaceholders})
    ORDER BY store_id, business_date, updated_at DESC, job_id
  `).all(...scope);
    const checkpoints = database.prepare(`
    SELECT checkpoint.store_id AS storeId, checkpoint.job_id AS jobId,
           checkpoint.report_type AS reportType, checkpoint.state,
           checkpoint.file_size_bytes AS fileSizeBytes,
           checkpoint.error_code AS errorCode, checkpoint.detail,
           checkpoint.updated_at AS updatedAt
    FROM lingxing_collection_report_checkpoints checkpoint
    JOIN lingxing_collection_jobs job
      ON job.store_id = checkpoint.store_id AND job.job_id = checkpoint.job_id
    WHERE job.store_id IN (${storePlaceholders})
      AND job.business_date IN (${datePlaceholders})
    ORDER BY checkpoint.store_id, checkpoint.job_id, checkpoint.report_type
  `).all(...scope);
    const imports = database.prepare(`
    SELECT run.store_id AS storeId, run.run_id AS runId,
           run.idempotency_key AS idempotencyKey,
           run.input_fingerprint AS inputFingerprint,
           run.batch_id AS batchId, run.status,
           run.source_file_count AS sourceFileCount,
           run.metric_row_count AS metricRowCount,
           run.reconciliation_count AS reconciliationCount,
           run.started_at AS startedAt,
           run.completed_at AS completedAt,
           run.created_at AS createdAt,
           batch.request_id AS batchRequestId,
           batch.browser_profile_id AS batchBrowserProfileId,
           batch.business_date AS batchBusinessDate,
           batch.session_generation AS batchSessionGeneration,
           batch.status AS batchStatus,
           batch.created_at AS batchCreatedAt,
           batch.completed_at AS batchCompletedAt,
           batch.business_date AS businessDate
    FROM report_import_runs run
    JOIN lingxing_report_batches batch
      ON batch.store_id = run.store_id AND batch.id = run.batch_id
    WHERE run.store_id IN (${storePlaceholders})
      AND batch.business_date IN (${datePlaceholders})
    ORDER BY run.store_id, batch.business_date, run.completed_at DESC, run.run_id
  `).all(...scope);
    const importFiles = database.prepare(`
    SELECT file.store_id AS storeId, file.run_id AS runId,
           file.batch_id AS batchId,
           file.report_type AS reportType, file.file_hash AS fileHash,
           file.file_path AS filePath, file.file_name AS fileName,
           file.file_size_bytes AS fileSizeBytes,
           file.imported_rows AS importedRows,
           file.captured_at AS capturedAt
    FROM report_import_file_snapshots file
    JOIN report_import_runs run
      ON run.store_id = file.store_id AND run.run_id = file.run_id
    JOIN lingxing_report_batches batch
      ON batch.store_id = run.store_id AND batch.id = run.batch_id
    WHERE file.store_id IN (${storePlaceholders})
      AND batch.business_date IN (${datePlaceholders})
    ORDER BY file.store_id, file.run_id, file.report_type
  `).all(...scope);
    const reconciliations = database.prepare(`
    SELECT reconciliation.store_id AS storeId,
           reconciliation.run_id AS runId,
           reconciliation.batch_id AS batchId,
           reconciliation.report_type AS reportType,
           reconciliation.status,
           reconciliation.within_tolerance AS withinTolerance,
           reconciliation.reconciled_at AS reconciledAt
    FROM report_import_reconciliations reconciliation
    JOIN report_import_runs run
      ON run.store_id = reconciliation.store_id AND run.run_id = reconciliation.run_id
    JOIN lingxing_report_batches batch
      ON batch.store_id = run.store_id AND batch.id = run.batch_id
    WHERE reconciliation.store_id IN (${storePlaceholders})
      AND batch.business_date IN (${datePlaceholders})
  `).all(...scope);
    return {
        globalActiveUsUsdStoreCount,
        stores,
        jobs,
        checkpoints,
        imports,
        importFiles,
        reconciliations,
    };
}

module.exports = { placeholders, readContinuousOperationSnapshot };
