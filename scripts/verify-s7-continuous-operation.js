const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 's7-continuous-operation-evidence/v1';
const EXPECTED_REPORT_TYPES = Object.freeze([
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
]);
const ACCEPTED_BLOCKED_STATES = new Set([
  'completed_with_errors',
  'failed',
  'cancelled',
  'stale_authority',
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const result = { stores: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help') return { help: true, stores: [] };
    const value = argv[index + 1];
    if (!name.startsWith('--') || !value || value.startsWith('--')) fail(`Invalid argument ${name}.`);
    index += 1;
    if (name === '--database') result.databasePath = path.resolve(value);
    else if (name === '--store') result.stores.push(value.trim().toLowerCase());
    else if (name === '--date-from') result.dateFrom = value;
    else if (name === '--date-to') result.dateTo = value;
    else if (name === '--output') result.outputPath = path.resolve(value);
    else fail(`Unknown argument ${name}.`);
  }
  if (!result.databasePath) fail('--database is required.');
  if (result.stores.length !== 2 || new Set(result.stores).size !== 2) fail('Exactly two distinct --store values are required.');
  if (!validIsoDate(result.dateFrom) || !validIsoDate(result.dateTo)) fail('--date-from and --date-to must use YYYY-MM-DD.');
  const dates = inclusiveDates(result.dateFrom, result.dateTo);
  if (dates.length !== 7) fail('The continuous acceptance window must contain exactly seven US business dates.');
  return { ...result, dates };
}

function inclusiveDates(dateFrom, dateTo) {
  if (!validIsoDate(dateFrom) || !validIsoDate(dateTo) || dateFrom > dateTo) return [];
  const dates = [];
  const cursor = new Date(`${dateFrom}T12:00:00.000Z`);
  const end = new Date(`${dateTo}T12:00:00.000Z`);
  while (cursor <= end && dates.length <= 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function readContinuousOperationSnapshot(database, input) {
  const storePlaceholders = placeholders(input.stores);
  const datePlaceholders = placeholders(input.dates);
  const scope = [...input.stores, ...input.dates];
  const stores = database.prepare(`
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, status, business_timezone AS businessTimezone
    FROM stores WHERE store_id IN (${storePlaceholders})
    ORDER BY store_id
  `).all(...input.stores);
  const jobs = database.prepare(`
    SELECT store_id AS storeId, job_id AS jobId, request_id AS requestId,
           browser_profile_id AS browserProfileId, marketplace, currency,
           business_date AS businessDate, state, blocker_code AS blockerCode,
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
           run.completed_at AS completedAt,
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
           file.report_type AS reportType, file.file_hash AS fileHash,
           file.imported_rows AS importedRows
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
           reconciliation.report_type AS reportType,
           reconciliation.status,
           reconciliation.within_tolerance AS withinTolerance
    FROM report_import_reconciliations reconciliation
    JOIN report_import_runs run
      ON run.store_id = reconciliation.store_id AND run.run_id = reconciliation.run_id
    JOIN lingxing_report_batches batch
      ON batch.store_id = run.store_id AND batch.id = run.batch_id
    WHERE reconciliation.store_id IN (${storePlaceholders})
      AND batch.business_date IN (${datePlaceholders})
  `).all(...scope);
  return { stores, jobs, checkpoints, imports, importFiles, reconciliations };
}

function evaluateContinuousOperationSnapshot(snapshot, input) {
  const violations = [];
  const storeResults = [];
  const storeById = new Map(snapshot.stores.map((store) => [String(store.storeId).toLowerCase(), store]));
  const addViolation = (code, message, detail = {}) => violations.push({ code, message, ...detail });

  for (const storeId of input.stores) {
    const store = storeById.get(storeId);
    if (!store) {
      addViolation('STORE_NOT_FOUND', `Store ${storeId} is missing from the authority database.`, { storeId });
      continue;
    }
    if (store.status !== 'active' || store.marketplace !== 'US' || store.currency !== 'USD') {
      addViolation('STORE_AUTHORITY_INVALID', `Store ${storeId} must be active US/USD authority.`, { storeId });
    }
    const days = input.dates.map((businessDate) => evaluateStoreDay(snapshot, store, businessDate));
    for (const day of days) {
      for (const dayViolation of day.violations) addViolation(dayViolation.code, dayViolation.message, { storeId, businessDate: day.businessDate, ...dayViolation.detail });
    }
    storeResults.push({
      storeId,
      marketplace: store.marketplace,
      currency: store.currency,
      businessTimezone: store.businessTimezone,
      days: days.map(({ violations: _violations, ...day }) => day),
      acceptedDayCount: days.filter((day) => day.accepted).length,
    });
  }

  detectDuplicateImports(snapshot, input, addViolation);
  detectCrossStoreLeakage(snapshot, storeById, addViolation);
  return {
    passed: violations.length === 0 && storeResults.length === 2 && storeResults.every((store) => store.acceptedDayCount === 7),
    expectedStoreCount: 2,
    expectedDayCountPerStore: 7,
    expectedReportCountPerSuccessfulDay: EXPECTED_REPORT_TYPES.length,
    stores: storeResults,
    violations,
  };
}

function evaluateStoreDay(snapshot, store, businessDate) {
  const jobs = snapshot.jobs.filter((job) => lower(job.storeId) === lower(store.storeId) && job.businessDate === businessDate);
  const violations = [];
  if (jobs.length === 0) {
    violations.push({ code: 'SILENT_MISSING_DAY', message: 'No collection job or explicit blocker exists for this business date.', detail: {} });
    return { businessDate, outcome: 'MISSING', accepted: false, jobId: null, reportCount: 0, importRunId: null, violations };
  }
  const successful = jobs.find((job) => job.state === 'completed');
  if (successful) {
    const checkpoints = snapshot.checkpoints.filter((row) => lower(row.storeId) === lower(store.storeId) && row.jobId === successful.jobId);
    const downloaded = new Set(checkpoints.filter((row) => row.state === 'downloaded').map((row) => row.reportType));
    const missingReports = EXPECTED_REPORT_TYPES.filter((reportType) => !downloaded.has(reportType));
    const imports = snapshot.imports.filter((row) => lower(row.storeId) === lower(store.storeId) && row.businessDate === businessDate && row.status === 'completed');
    const acceptedImport = imports.find((run) => {
      const types = new Set(snapshot.importFiles.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId).map((row) => row.reportType));
      const reconciliations = snapshot.reconciliations.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId);
      const matchedReconciliationTypes = new Set(reconciliations
        .filter((row) => row.status === 'matched' && Number(row.withinTolerance) === 1)
        .map((row) => row.reportType));
      return EXPECTED_REPORT_TYPES.every((reportType) => types.has(reportType))
        && EXPECTED_REPORT_TYPES.every((reportType) => matchedReconciliationTypes.has(reportType))
        && Number(run.sourceFileCount) >= EXPECTED_REPORT_TYPES.length
        && Number(run.reconciliationCount) >= EXPECTED_REPORT_TYPES.length
        && Number(run.metricRowCount) > 0;
    });
    if (missingReports.length > 0) {
      violations.push({ code: 'REPORT_SET_INCOMPLETE', message: 'Completed day does not have eight downloaded report checkpoints.', detail: { missingReports } });
    }
    if (!acceptedImport) {
      violations.push({ code: 'IMPORT_NOT_VERIFIED', message: 'Completed day has no eight-report idempotent import with matched reconciliation.', detail: {} });
    }
    return {
      businessDate,
      outcome: violations.length === 0 ? 'SUCCESS_8_OF_8' : 'INVALID_SUCCESS',
      accepted: violations.length === 0,
      jobId: successful.jobId,
      reportCount: downloaded.size,
      importRunId: acceptedImport?.runId ?? null,
      violations,
    };
  }
  const blocked = jobs.find((job) => ACCEPTED_BLOCKED_STATES.has(job.state) && nonEmpty(job.blockerCode) && nonEmpty(job.detail));
  if (!blocked) {
    violations.push({ code: 'BLOCKER_NOT_ACTIONABLE', message: 'Non-success day must persist a terminal state, blockerCode and repair detail.', detail: { states: jobs.map((job) => job.state) } });
  }
  return {
    businessDate,
    outcome: blocked ? 'EXPLICIT_BLOCKED' : 'INCOMPLETE',
    accepted: Boolean(blocked),
    jobId: blocked?.jobId ?? jobs[0]?.jobId ?? null,
    reportCount: blocked
      ? snapshot.checkpoints.filter((row) => lower(row.storeId) === lower(store.storeId) && row.jobId === blocked.jobId && row.state === 'downloaded').length
      : 0,
    importRunId: null,
    blockerCode: blocked?.blockerCode,
    blockerDetail: blocked?.detail,
    violations,
  };
}

function detectDuplicateImports(snapshot, input, addViolation) {
  const seenFingerprints = new Map();
  const seenFiles = new Map();
  for (const run of snapshot.imports) {
    if (!input.stores.includes(lower(run.storeId)) || !input.dates.includes(run.businessDate)) continue;
    const fingerprintKey = `${lower(run.storeId)}|${run.businessDate}|${run.inputFingerprint}`;
    if (seenFingerprints.has(fingerprintKey)) {
      addViolation('DUPLICATE_IMPORT_FINGERPRINT', 'The same input fingerprint was imported more than once for one store/day.', { storeId: lower(run.storeId), businessDate: run.businessDate, runIds: [seenFingerprints.get(fingerprintKey), run.runId] });
    } else seenFingerprints.set(fingerprintKey, run.runId);
  }
  const runDate = new Map(snapshot.imports.map((run) => [`${lower(run.storeId)}|${run.runId}`, run.businessDate]));
  for (const file of snapshot.importFiles) {
    const businessDate = runDate.get(`${lower(file.storeId)}|${file.runId}`);
    if (!businessDate) continue;
    const fileKey = `${lower(file.storeId)}|${businessDate}|${file.reportType}|${file.fileHash}`;
    if (seenFiles.has(fileKey)) {
      addViolation('DUPLICATE_IMPORT_FILE', 'The same report file hash was imported more than once for one store/day/report type.', { storeId: lower(file.storeId), businessDate, reportType: file.reportType, runIds: [seenFiles.get(fileKey), file.runId] });
    } else seenFiles.set(fileKey, file.runId);
  }
}

function detectCrossStoreLeakage(snapshot, storeById, addViolation) {
  const profileOwners = new Map();
  for (const store of storeById.values()) {
    const profileId = String(store.browserProfileId ?? '').trim();
    const existingOwner = profileOwners.get(profileId);
    if (!profileId || (existingOwner && existingOwner !== lower(store.storeId))) {
      addViolation('CROSS_STORE_PROFILE_IDENTITY', 'Each store must own one distinct non-empty browser Profile identity.', {
        storeId: lower(store.storeId),
        browserProfileId: profileId,
        otherStoreId: existingOwner,
      });
    } else profileOwners.set(profileId, lower(store.storeId));
  }
  for (const job of snapshot.jobs) {
    const store = storeById.get(lower(job.storeId));
    if (!store || job.browserProfileId !== store.browserProfileId || job.marketplace !== 'US' || job.currency !== 'USD') {
      addViolation('CROSS_STORE_JOB_IDENTITY', 'Collection job identity does not match its store authority.', { storeId: lower(job.storeId), jobId: job.jobId });
    }
  }
  const runStores = new Map(snapshot.imports.map((run) => [String(run.runId), lower(run.storeId)]));
  const fingerprintOwners = new Map();
  for (const run of snapshot.imports) {
    const fingerprint = String(run.inputFingerprint ?? '').trim();
    const owner = fingerprintOwners.get(fingerprint);
    if (fingerprint && owner && owner !== lower(run.storeId)) {
      addViolation('CROSS_STORE_IMPORT_FINGERPRINT', 'One import fingerprint cannot be shared by different stores.', {
        storeId: lower(run.storeId),
        otherStoreId: owner,
        runId: run.runId,
      });
    } else if (fingerprint) fingerprintOwners.set(fingerprint, lower(run.storeId));
  }
  const fileHashOwners = new Map();
  for (const file of snapshot.importFiles) {
    if (runStores.get(String(file.runId)) !== lower(file.storeId)) {
      addViolation('CROSS_STORE_IMPORT_FILE', 'Import file snapshot references a run owned by another store.', { storeId: lower(file.storeId), runId: file.runId });
    }
    const fileHash = String(file.fileHash ?? '').trim();
    const owner = fileHashOwners.get(fileHash);
    if (fileHash && owner && owner !== lower(file.storeId)) {
      addViolation('CROSS_STORE_IMPORT_FILE_HASH', 'One imported report file hash cannot be shared by different stores.', {
        storeId: lower(file.storeId),
        otherStoreId: owner,
        runId: file.runId,
      });
    } else if (fileHash) fileHashOwners.set(fileHash, lower(file.storeId));
  }
}

function lower(value) {
  return String(value ?? '').trim().toLowerCase();
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildEvidenceManifest(databasePath, input, result, integrityCheck) {
  const stat = fs.statSync(databasePath);
  return {
    kind: 's7-continuous-operation-evidence',
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: result.passed ? 'PASSED' : 'BLOCKED',
    readinessImpact: 'CONTINUOUS_OPERATION_GATE_ONLY',
    finalReadinessCredit: false,
    database: {
      absolutePath: databasePath,
      sha256: sha256File(databasePath),
      sizeBytes: stat.size,
      integrityCheck,
      openedReadOnly: true,
    },
    window: { dateFrom: input.dateFrom, dateTo: input.dateTo, businessDates: input.dates },
    ...result,
  };
}

function run(argv = process.argv.slice(2)) {
  const input = parseArgs(argv);
  if (input.help) {
    process.stdout.write('Usage: node scripts/verify-s7-continuous-operation.js --database <sqlite> --store <id> --store <id> --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--output manifest.json]\n');
    return 0;
  }
  if (!fs.existsSync(input.databasePath)) fail(`Database does not exist: ${input.databasePath}`);
  // Loaded lazily so --help works even before native dependencies are prepared.
  const Database = require('better-sqlite3');
  const database = new Database(input.databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrityRows = database.pragma('integrity_check');
    const integrityCheck = integrityRows.map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
    const snapshot = readContinuousOperationSnapshot(database, input);
    const result = evaluateContinuousOperationSnapshot(snapshot, input);
    if (integrityCheck.length !== 1 || integrityCheck[0] !== 'ok') {
      result.passed = false;
      result.violations.unshift({ code: 'DATABASE_INTEGRITY_FAILED', message: 'PRAGMA integrity_check did not return ok.', actual: integrityCheck });
    }
    const manifest = buildEvidenceManifest(input.databasePath, input, result, integrityCheck);
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    if (input.outputPath) {
      fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
      fs.writeFileSync(input.outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    return manifest.status === 'PASSED' ? 0 : 2;
  } finally {
    database.close();
  }
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_REPORT_TYPES,
  SCHEMA_VERSION,
  buildEvidenceManifest,
  evaluateContinuousOperationSnapshot,
  inclusiveDates,
  parseArgs,
  readContinuousOperationSnapshot,
  run,
};
