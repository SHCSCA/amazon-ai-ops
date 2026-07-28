const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const {
  computeCanonicalPackageIdentity,
} = require('./export-mission-control-authority-snapshot');
const {
  assertMatchingAuthorityCurrentnessProofs,
  captureAuthoritySnapshotCurrentness,
} = require('./sqlite-authority-currentness');
const path = require('node:path');

const requireLocalDbDependency = createRequire(
  path.join(__dirname, '..', 'packages', 'local-db', 'package.json'),
);

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = 's7-continuous-operation-evidence/v1';
const ACCEPTANCE_CONTRACT_VERSION = 's7-continuous-operation-success-only/v2';
const US_BUSINESS_CALENDAR_VERSION = 'us-federal-business-day/v1';
const BUSINESS_TIMEZONE = 'America/Los_Angeles';
const MAX_TERMINAL_TAIL_MS = 6 * 60 * 60 * 1000;
const AUTHORITY_SNAPSHOT_KIND = 'mission-control-authority-database-snapshot';
const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 'mission-control-authority-database-snapshot/v2';
const AUTHORITY_SNAPSHOT_ROOT = path.join(ROOT, 'output', 'codex-evidence', 'authority-snapshots');
const PACKAGE_IDENTITY_FIELDS = Object.freeze([
  'executableSha256',
  'appContentSha256',
  'mainBundleSha256',
]);
const SOURCE_DATABASE_NAME = 'amazon-ai-ops.db';
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
const TERMINAL_BLOCKED_STATES = new Set([
  'completed_with_errors',
  'failed',
  'cancelled',
  'stale_authority',
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv, { now = () => new Date() } = {}) {
  const result = { stores: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help') return { help: true, stores: [] };
    const value = argv[index + 1];
    if (!name.startsWith('--') || !value || value.startsWith('--')) fail(`Invalid argument ${name}.`);
    index += 1;
    if (name === '--authority-snapshot-manifest') result.authoritySnapshotManifestPath = path.resolve(value);
    else if (name === '--store') result.stores.push(value.trim().toLowerCase());
    else if (name === '--date-from') result.dateFrom = value;
    else if (name === '--date-to') result.dateTo = value;
    else if (name === '--output') result.outputPath = path.resolve(value);
    else fail(`Unknown argument ${name}.`);
  }
  if (!result.authoritySnapshotManifestPath) {
    fail('--authority-snapshot-manifest is required; raw live --database input is not accepted.');
  }
  if (result.stores.length !== 2 || new Set(result.stores).size !== 2) fail('Exactly two distinct --store values are required.');
  if (!validIsoDate(result.dateFrom) || !validIsoDate(result.dateTo)) fail('--date-from and --date-to must use YYYY-MM-DD.');
  const calendarDates = inclusiveDates(result.dateFrom, result.dateTo);
  if (calendarDates.length === 0 || calendarDates.at(-1) !== result.dateTo) {
    fail('The continuous acceptance window must be ascending and no longer than 31 calendar days.');
  }
  const dates = usFederalBusinessDates(result.dateFrom, result.dateTo);
  if (dates.length !== 7) {
    fail(`The continuous acceptance window must contain exactly seven US federal business dates under ${US_BUSINESS_CALENDAR_VERSION}.`);
  }
  const generatedAtDate = now();
  if (!(generatedAtDate instanceof Date) || !Number.isFinite(generatedAtDate.valueOf())) {
    fail('Continuous-operation generation clock is invalid.');
  }
  const generatedAt = generatedAtDate.toISOString();
  const expectedDates = recentCompletedUsBusinessDates(generatedAt);
  if (JSON.stringify(dates) !== JSON.stringify(expectedDates)) {
    fail(`The continuous acceptance window must be the most recent seven completed US federal business dates in ${BUSINESS_TIMEZONE}.`);
  }
  return {
    ...result,
    dates,
    generatedAt,
    businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
  };
}

function inclusiveDates(dateFrom, dateTo) {
  if (!validIsoDate(dateFrom) || !validIsoDate(dateTo) || dateFrom > dateTo) return [];
  const dates = [];
  const cursor = new Date(`${dateFrom}T12:00:00.000Z`);
  const end = new Date(`${dateTo}T12:00:00.000Z`);
  while (cursor <= end && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isoDate(year, monthIndex, dayOfMonth) {
  return new Date(Date.UTC(year, monthIndex, dayOfMonth, 12)).toISOString().slice(0, 10);
}

function observedFixedHoliday(year, monthIndex, dayOfMonth) {
  const actual = new Date(Date.UTC(year, monthIndex, dayOfMonth, 12));
  const weekday = actual.getUTCDay();
  if (weekday === 6) actual.setUTCDate(actual.getUTCDate() - 1);
  else if (weekday === 0) actual.setUTCDate(actual.getUTCDate() + 1);
  return actual.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(year, monthIndex, weekday, occurrence) {
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return isoDate(year, monthIndex, 1 + offset + ((occurrence - 1) * 7));
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0, 12));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return isoDate(year, monthIndex, last.getUTCDate() - offset);
}

/**
 * Deterministic US federal holiday calendar. Fixed-date holidays use the
 * federal Friday/Monday observed rule. Juneteenth begins in 2021 and Martin
 * Luther King Jr. Day begins in 1986, matching their federal effective years.
 */
function usFederalHolidayDates(year) {
  const holidays = new Set([
    observedFixedHoliday(year, 0, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    lastWeekdayOfMonth(year, 4, 1),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 9, 1, 2),
    observedFixedHoliday(year, 10, 11),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ]);
  if (year >= 1986) holidays.add(nthWeekdayOfMonth(year, 0, 1, 3));
  if (year >= 2021) holidays.add(observedFixedHoliday(year, 5, 19));
  return holidays;
}

function usFederalBusinessDates(dateFrom, dateTo) {
  const calendarDates = inclusiveDates(dateFrom, dateTo);
  if (calendarDates.length === 0) return [];
  const firstYear = Number(calendarDates[0].slice(0, 4));
  const lastYear = Number(calendarDates.at(-1).slice(0, 4));
  const holidays = new Set();
  // Adjacent years are required because a Saturday January 1 is observed on
  // December 31 of the preceding calendar year.
  for (let year = firstYear - 1; year <= lastYear + 1; year += 1) {
    for (const holiday of usFederalHolidayDates(year)) holidays.add(holiday);
  }
  return calendarDates.filter((value) => {
    const day = new Date(`${value}T12:00:00.000Z`).getUTCDay();
    return day >= 1 && day <= 5 && !holidays.has(value);
  });
}

// Kept for the production-readiness verifier's existing import surface. Its
// semantics are the versioned federal-business-day contract above.
function usWeekdayBusinessDates(dateFrom, dateTo) {
  return usFederalBusinessDates(dateFrom, dateTo);
}

function businessDateInTimezone(value, timeZone = BUSINESS_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function previousIsoDate(value) {
  if (!validIsoDate(value)) return '';
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function recentCompletedUsBusinessDates(generatedAt) {
  const currentBusinessDate = businessDateInTimezone(generatedAt);
  if (!currentBusinessDate) fail('Continuous-operation generatedAt is invalid.');
  const dates = [];
  let cursor = previousIsoDate(currentBusinessDate);
  for (let index = 0; dates.length < 7 && index < 31; index += 1) {
    if (usFederalBusinessDates(cursor, cursor).length === 1) dates.unshift(cursor);
    cursor = previousIsoDate(cursor);
  }
  if (dates.length !== 7) fail('Unable to resolve the most recent seven completed US federal business dates.');
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

function fileArtifact(filePath) {
  const stat = fs.statSync(filePath);
  return {
    mtimeMs: stat.mtimeMs,
    sha256: sha256File(filePath),
    sizeBytes: stat.size,
  };
}

function isSha256(value) {
  return typeof value === 'string' && /^[A-F0-9]{64}$/i.test(value);
}

function isPathContained(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function requestedPathEqualsRealpath(candidatePath) {
  try {
    return path.resolve(candidatePath).toLowerCase()
      === fs.realpathSync.native(candidatePath).toLowerCase();
  } catch {
    return false;
  }
}

function samePath(left, right) {
  return typeof left === 'string'
    && typeof right === 'string'
    && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function assertDirectDirectory(directoryPath, label) {
  const resolved = path.resolve(directoryPath);
  if (!fs.existsSync(resolved)) fail(`${label} does not exist: ${resolved}`);
  const linkStat = fs.lstatSync(resolved);
  const stat = fs.statSync(resolved);
  if (linkStat.isSymbolicLink() || !stat.isDirectory() || !requestedPathEqualsRealpath(resolved)) {
    fail(`${label} must be a direct real directory without symlink, junction, or reparse traversal.`);
  }
  return resolved;
}

function defaultRuntimeContext() {
  const releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release');
  const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
  const canonicalEvidenceRoot = path.join(ROOT, 'output', 'codex-evidence');
  return {
    appContentPath,
    authoritySnapshotRoot: AUTHORITY_SNAPSHOT_ROOT,
    canonicalEvidenceRoot,
    continuousOperationOutputRoot: path.join(canonicalEvidenceRoot, 'continuous-operation'),
    executablePath: path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe'),
    mainBundlePath: path.join(appContentPath, 'dist', 'main', 'index.js'),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
    releaseRoot,
    writeStdout: (value) => process.stdout.write(value),
  };
}

function assertUniqueRegularFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) fail(`${label} does not exist: ${resolved}`);
  const linkStat = fs.lstatSync(resolved);
  const stat = fs.statSync(resolved);
  if (linkStat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !requestedPathEqualsRealpath(resolved)) {
    fail(`${label} must be one unique regular file without symlink, reparse, or hardlink traversal.`);
  }
  return { resolved, stat };
}

function normalizePackageIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Authority snapshot packageIdentity is missing.');
  }
  const normalized = {};
  for (const field of PACKAGE_IDENTITY_FIELDS) {
    if (!isSha256(value[field])) fail(`Authority snapshot packageIdentity.${field} is invalid.`);
    normalized[field] = String(value[field]).toUpperCase();
  }
  return normalized;
}

function normalizedArtifactDescriptor(value, label) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !isSha256(value.sha256)
    || !Number.isInteger(Number(value.sizeBytes))
    || Number(value.sizeBytes) <= 0
    || !Number.isFinite(Number(value.mtimeMs))
  ) {
    fail(`${label} is invalid.`);
  }
  return {
    mtimeMs: Number(value.mtimeMs),
    sha256: String(value.sha256).toUpperCase(),
    sizeBytes: Number(value.sizeBytes),
  };
}

function sameArtifact(left, right) {
  return left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.mtimeMs === right.mtimeMs;
}

function loadAuthoritySnapshotManifest(
  manifestPath,
  injectedContext = {},
) {
  const context = { ...defaultRuntimeContext(), ...injectedContext };
  const authoritySnapshotRoot = context.authoritySnapshotRoot;
  const rootPath = path.resolve(authoritySnapshotRoot);
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory() || !requestedPathEqualsRealpath(rootPath)) {
    fail(`Canonical authority snapshot root is missing or unsafe: ${rootPath}`);
  }
  const { resolved: resolvedManifestPath } = assertUniqueRegularFile(
    manifestPath,
    'Authority snapshot manifest',
  );
  if (!isPathContained(rootPath, resolvedManifestPath)) {
    fail('Authority snapshot manifest is outside the canonical snapshot root.');
  }
  const manifestArtifactBefore = fileArtifact(resolvedManifestPath);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8'));
  } catch (error) {
    fail(`Authority snapshot manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest?.kind !== AUTHORITY_SNAPSHOT_KIND) fail('Authority snapshot manifest kind is invalid.');
  if (manifest?.schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION) {
    fail(`Authority snapshot manifest must use ${AUTHORITY_SNAPSHOT_SCHEMA_VERSION}.`);
  }
  if (!Number.isFinite(Date.parse(manifest?.exportedAt))) {
    fail('Authority snapshot exportedAt is invalid.');
  }
  const packageIdentity = normalizePackageIdentity(manifest.packageIdentity);
  const sourcePath = manifest?.source?.absolutePath;
  if (
    typeof sourcePath !== 'string'
    || sourcePath !== sourcePath.trim()
    || !path.isAbsolute(sourcePath)
    || sourcePath.includes('\0')
    || path.basename(sourcePath).toLowerCase() !== SOURCE_DATABASE_NAME
  ) {
    fail('Authority snapshot source must be the canonical absolute amazon-ai-ops.db path.');
  }
  const { resolved: authorityDbPath } = assertUniqueRegularFile(
    sourcePath,
    'Authority snapshot source database',
  );
  if (!samePath(authorityDbPath, manifest.source.realPath)) {
    fail('Authority snapshot source realPath binding is invalid.');
  }
  const sourceArtifactBefore = normalizedArtifactDescriptor(
    manifest.source.artifactBefore,
    'Authority snapshot source artifactBefore',
  );
  const sourceArtifactAfter = normalizedArtifactDescriptor(
    manifest.source.artifactAfter,
    'Authority snapshot source artifactAfter',
  );
  if (!sameArtifact(sourceArtifactBefore, sourceArtifactAfter)) {
    fail('Authority snapshot source changed during snapshot export.');
  }
  const sourceArtifactCurrent = fileArtifact(authorityDbPath);
  if (!sameArtifact(sourceArtifactCurrent, sourceArtifactAfter)) {
    fail('Authority snapshot source current bytes do not match artifactAfter.');
  }
  const userDataDir = assertDirectDirectory(
    path.dirname(authorityDbPath),
    'Authority snapshot USER_DATA_DIR',
  );
  const storesRoot = assertDirectDirectory(
    path.join(userDataDir, 'stores'),
    'Authority snapshot stores root',
  );
  const snapshotPath = manifest?.snapshot?.absolutePath;
  if (typeof snapshotPath !== 'string' || !path.isAbsolute(snapshotPath)) {
    fail('Authority snapshot absolutePath is missing.');
  }
  const { resolved: databasePath, stat } = assertUniqueRegularFile(
    snapshotPath,
    'Authority database snapshot',
  );
  if (!isPathContained(rootPath, databasePath)) {
    fail('Authority database snapshot is outside the canonical snapshot root.');
  }
  if (
    typeof manifest.snapshot.realPath !== 'string'
    || fs.realpathSync.native(databasePath).toLowerCase() !== path.resolve(manifest.snapshot.realPath).toLowerCase()
  ) {
    fail('Authority database snapshot realPath binding is invalid.');
  }
  if (
    !isSha256(manifest.snapshot.sha256)
    || sha256File(databasePath) !== String(manifest.snapshot.sha256).toUpperCase()
    || Number(manifest.snapshot.sizeBytes) !== stat.size
  ) {
    fail('Authority database snapshot bytes do not match the manifest.');
  }
  if (
    manifest?.backup?.method !== 'sqlite-online-backup'
    || manifest?.backup?.completed !== true
    || !Number.isFinite(Date.parse(manifest.backup.startedAt))
    || !Number.isFinite(Date.parse(manifest.backup.completedAt))
    || !Number.isInteger(manifest.backup.totalPages)
    || manifest.backup.totalPages <= 0
    || manifest.backup.remainingPages !== 0
    || Date.parse(manifest.backup.startedAt) > Date.parse(manifest.backup.completedAt)
    || manifest.exportedAt !== manifest.backup.completedAt
  ) {
    fail('Authority snapshot does not prove a completed SQLite online backup.');
  }
  if (
    manifest?.source?.openedReadOnly !== true
    || manifest.source.queryOnly !== true
    || JSON.stringify(manifest.source.integrityCheck) !== JSON.stringify(['ok'])
    || !Array.isArray(manifest.source.foreignKeyCheck)
    || manifest.source.foreignKeyCheck.length !== 0
  ) {
    fail('Authority snapshot source was not opened read-only.');
  }
  if (
    manifest.snapshot.openedReadOnly !== true
    || manifest.snapshot.queryOnly !== true
    || JSON.stringify(manifest.snapshot.integrityCheck) !== JSON.stringify(['ok'])
    || !Array.isArray(manifest.snapshot.foreignKeyCheck)
    || manifest.snapshot.foreignKeyCheck.length !== 0
  ) {
    fail('Authority database snapshot did not pass its read-only integrity contract.');
  }
  const verifyPackageIdentity = injectedContext.verifyPackageIdentity === undefined
    ? samePath(rootPath, AUTHORITY_SNAPSHOT_ROOT)
    : injectedContext.verifyPackageIdentity === true;
  const packageIdentityCurrent = verifyPackageIdentity
    ? normalizePackageIdentity(
      computeCanonicalPackageIdentity(context),
    )
    : packageIdentity;
  if (JSON.stringify(packageIdentityCurrent) !== JSON.stringify(packageIdentity)) {
    fail('Authority snapshot packageIdentity does not match the current canonical package.');
  }
  const manifestArtifact = fileArtifact(resolvedManifestPath);
  if (!sameArtifact(manifestArtifact, manifestArtifactBefore)) {
    fail('Authority snapshot manifest changed while it was being loaded.');
  }
  const snapshotArtifact = fileArtifact(databasePath);
  return {
    authorityDbPath,
    databasePath,
    manifest,
    manifestArtifact,
    manifestPath: resolvedManifestPath,
    packageIdentity,
    packageIdentityVerified: verifyPackageIdentity,
    snapshotArtifact,
    sourceArtifact: sourceArtifactCurrent,
    snapshotManifestSha256: sha256File(resolvedManifestPath),
    storesRoot,
  };
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
  return { stores, jobs, checkpoints, imports, importFiles, reconciliations };
}

function evaluateContinuousOperationSnapshot(snapshot, input) {
  const violations = [];
  const storeResults = [];
  const storeById = new Map(snapshot.stores.map((store) => [String(store.storeId).toLowerCase(), store]));
  const addViolation = (code, message, detail = {}) => violations.push({ code, message, ...detail });
  let canonicalDates = [];
  try {
    canonicalDates = recentCompletedUsBusinessDates(input.generatedAt);
  } catch {
    // Converted into the explicit fail-closed violation below.
  }
  if (
    canonicalDates.length !== 7
    || JSON.stringify(input.dates) !== JSON.stringify(canonicalDates)
  ) {
    addViolation(
      'WINDOW_NOT_RECENT_COMPLETED',
      `Window must be the most recent seven completed US federal business dates in ${BUSINESS_TIMEZONE}.`,
    );
  }
  const importProof = validateGlobalImportProofs(snapshot, input, addViolation);

  for (const storeId of input.stores) {
    const store = storeById.get(storeId);
    if (!store) {
      addViolation('STORE_NOT_FOUND', `Store ${storeId} is missing from the authority database.`, { storeId });
      continue;
    }
    if (
      store.status !== 'active'
      || store.marketplace !== 'US'
      || store.currency !== 'USD'
      || store.businessTimezone !== BUSINESS_TIMEZONE
    ) {
      addViolation(
        'STORE_AUTHORITY_INVALID',
        `Store ${storeId} must be active US/USD authority in ${BUSINESS_TIMEZONE}.`,
        { storeId },
      );
    }
    const days = input.dates.map((businessDate) => (
      evaluateStoreDay(snapshot, store, businessDate, input, importProof)
    ));
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

  detectCrossStoreLeakage(snapshot, storeById, addViolation);
  const result = {
    passed: violations.length === 0 && storeResults.length === 2 && storeResults.every((store) => store.acceptedDayCount === 7),
    acceptanceContractVersion: ACCEPTANCE_CONTRACT_VERSION,
    businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
    expectedStoreCount: 2,
    expectedDayCountPerStore: 7,
    expectedReportCountPerSuccessfulDay: EXPECTED_REPORT_TYPES.length,
    stores: storeResults,
    violations,
  };
  Object.defineProperty(result, '_verifiedFileArtifacts', {
    configurable: false,
    enumerable: false,
    value: importProof.verifiedFileArtifacts,
    writable: false,
  });
  return result;
}

function evaluateStoreDay(snapshot, store, businessDate, input = {}, importProof = { invalidRunKeys: new Set() }) {
  const jobs = snapshot.jobs
    .filter((job) => lower(job.storeId) === lower(store.storeId) && job.businessDate === businessDate)
    .sort(compareNewestRecord('updatedAt', 'jobId'));
  const violations = [];
  if (jobs.length === 0) {
    violations.push({ code: 'SILENT_MISSING_DAY', message: 'No collection job or explicit blocker exists for this business date.', detail: {} });
    return { businessDate, outcome: 'MISSING', accepted: false, jobId: null, reportCount: 0, importRunId: null, violations };
  }
  const latestJob = jobs[0];
  const latestTimestamp = normalizedTimestamp(latestJob.updatedAt);
  const equallyLatestJobs = jobs.filter((job) => normalizedTimestamp(job.updatedAt) === latestTimestamp);
  if (!latestTimestamp || equallyLatestJobs.length !== 1) {
    violations.push({
      code: 'LATEST_JOB_IDENTITY_AMBIGUOUS',
      message: 'The latest store/day collection job must have one unique durable updatedAt.',
      detail: { jobIds: equallyLatestJobs.map((job) => job.jobId), updatedAt: latestTimestamp || null },
    });
    return {
      businessDate,
      outcome: 'INCOMPLETE',
      accepted: false,
      jobId: latestJob?.jobId ?? null,
      reportCount: 0,
      importRunId: null,
      violations,
    };
  }
  const jobTime = validateJobTime(latestJob, store, businessDate, input.generatedAt, violations);
  const jobIdentityValid = validateJobIdentity(latestJob, store, businessDate, violations);
  if (latestJob.state === 'completed') {
    const checkpoints = snapshot.checkpoints.filter((row) => lower(row.storeId) === lower(store.storeId) && row.jobId === latestJob.jobId);
    const checkpointTimesValid = checkpoints.every((row) => {
      const valid = timestampWithin(row.updatedAt, jobTime.createdAtMs, jobTime.updatedAtMs);
      if (!valid) {
        violations.push({
          code: 'CHECKPOINT_TIME_INVALID',
          message: 'Downloaded checkpoint updatedAt must fall inside the durable job lifetime.',
          detail: { reportType: row.reportType, updatedAt: row.updatedAt },
        });
      }
      return valid;
    });
    const downloaded = new Set(checkpoints.filter((row) => row.state === 'downloaded').map((row) => row.reportType));
    const missingReports = EXPECTED_REPORT_TYPES.filter((reportType) => !downloaded.has(reportType));
    const unexpectedReports = [...downloaded].filter((reportType) => !EXPECTED_REPORT_TYPES.includes(reportType));
    const lineageImports = snapshot.imports
      .filter((row) => lower(row.storeId) === lower(store.storeId)
        && row.businessDate === businessDate
        && row.batchId === latestJob.jobId)
      .sort(compareNewestRecord('completedAt', 'runId'));
    const latestImport = lineageImports[0];
    const latestImportTimestamp = normalizedTimestamp(latestImport?.completedAt);
    const equallyLatestImports = latestImport
      ? lineageImports.filter((run) => normalizedTimestamp(run.completedAt) === latestImportTimestamp)
      : [];
    if (latestImport && (!latestImportTimestamp || equallyLatestImports.length !== 1)) {
      violations.push({
        code: 'LATEST_IMPORT_IDENTITY_AMBIGUOUS',
        message: 'The latest import for the completed job/batch lineage must have one unique durable completedAt.',
        detail: { runIds: equallyLatestImports.map((run) => run.runId), completedAt: latestImportTimestamp || null },
      });
    }
    const acceptedImport = latestImport && latestImportTimestamp && equallyLatestImports.length === 1 && (() => {
      const run = latestImport;
      if (run.status !== 'completed') return false;
      const runKey = importRunKey(run.storeId, run.runId);
      const fileRows = snapshot.importFiles.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId);
      const types = new Set(snapshot.importFiles.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId).map((row) => row.reportType));
      const reconciliations = snapshot.reconciliations.filter((row) => lower(row.storeId) === lower(store.storeId) && row.runId === run.runId);
      const matchedReconciliationTypes = new Set(reconciliations
        .filter((row) => row.status === 'matched' && Number(row.withinTolerance) === 1)
        .map((row) => row.reportType));
      const importTime = validateImportTime(run, jobTime, violations);
      const batchIdentityValid = validateBatchIdentity(run, latestJob, businessDate, violations);
      const fileTimesValid = fileRows.every((row) => {
        const valid = timestampWithin(row.capturedAt, importTime.startedAtMs, importTime.completedAtMs)
          && timestampWithin(row.capturedAt, jobTime.createdAtMs, jobTime.updatedAtMs);
        if (!valid) {
          violations.push({
            code: 'FILE_SNAPSHOT_TIME_INVALID',
            message: 'Imported file snapshot capturedAt must fall inside the import and job lifetime.',
            detail: { reportType: row.reportType, capturedAt: row.capturedAt },
          });
        }
        return valid;
      });
      const reconciliationTimesValid = reconciliations.every((row) => {
        const valid = timestampWithin(row.reconciledAt, importTime.startedAtMs, importTime.completedAtMs)
          && timestampWithin(row.reconciledAt, jobTime.createdAtMs, jobTime.updatedAtMs);
        if (!valid) {
          violations.push({
            code: 'RECONCILIATION_TIME_INVALID',
            message: 'Import reconciliation reconciledAt must fall inside the import and job lifetime.',
            detail: { reportType: row.reportType, reconciledAt: row.reconciledAt },
          });
        }
        return valid;
      });
      return jobTime.valid
        && jobIdentityValid
        && batchIdentityValid
        && !importProof.invalidRunKeys.has(runKey)
        && checkpointTimesValid
        && importTime.valid
        && fileTimesValid
        && reconciliationTimesValid
        && fileRows.length === EXPECTED_REPORT_TYPES.length
        && types.size === EXPECTED_REPORT_TYPES.length
        && reconciliations.length === EXPECTED_REPORT_TYPES.length
        && matchedReconciliationTypes.size === EXPECTED_REPORT_TYPES.length
        && EXPECTED_REPORT_TYPES.every((reportType) => types.has(reportType))
        && EXPECTED_REPORT_TYPES.every((reportType) => matchedReconciliationTypes.has(reportType))
        && Number(run.sourceFileCount) === EXPECTED_REPORT_TYPES.length
        && Number(run.reconciliationCount) === EXPECTED_REPORT_TYPES.length
        && Number(run.metricRowCount) > 0;
    })();
    if (missingReports.length > 0 || unexpectedReports.length > 0 || checkpoints.length !== EXPECTED_REPORT_TYPES.length) {
      violations.push({
        code: 'REPORT_SET_INCOMPLETE',
        message: 'Latest completed job does not have exactly eight downloaded report checkpoints.',
        detail: { missingReports, unexpectedReports, checkpointCount: checkpoints.length },
      });
    }
    if (!acceptedImport) {
      const sameDayBatchIds = snapshot.imports
        .filter((row) => lower(row.storeId) === lower(store.storeId) && row.businessDate === businessDate)
        .map((row) => row.batchId);
      violations.push({
        code: lineageImports.length === 0 && sameDayBatchIds.length > 0 ? 'IMPORT_LINEAGE_MISMATCH' : 'IMPORT_NOT_VERIFIED',
        message: lineageImports.length === 0 && sameDayBatchIds.length > 0
          ? 'Latest completed job cannot be combined with an import from another batch lineage.'
          : 'Latest completed job/batch has no latest exact eight-report import with matched reconciliation.',
        detail: { expectedBatchId: latestJob.jobId, actualBatchIds: [...new Set(sameDayBatchIds)] },
      });
    }
    return {
      businessDate,
      outcome: violations.length === 0 ? 'SUCCESS_8_OF_8' : 'INVALID_SUCCESS',
      accepted: violations.length === 0,
      jobId: latestJob.jobId,
      reportCount: downloaded.size,
      importRunId: acceptedImport ? latestImport.runId : null,
      violations,
    };
  }
  const blocked = TERMINAL_BLOCKED_STATES.has(latestJob.state)
    && nonEmpty(latestJob.blockerCode)
    && nonEmpty(latestJob.detail)
    ? latestJob
    : null;
  if (blocked) {
    violations.push({
      code: 'DAY_BLOCKED',
      message: 'An actionable blocked day is durable evidence, but it cannot satisfy the production continuous-operation gate.',
      detail: { state: blocked.state, blockerCode: blocked.blockerCode },
    });
  } else {
    violations.push({
      code: 'BLOCKER_NOT_ACTIONABLE',
      message: 'Latest non-success job must persist a terminal state, blockerCode and repair detail.',
      detail: { state: latestJob.state },
    });
  }
  return {
    businessDate,
    outcome: blocked ? 'EXPLICIT_BLOCKED' : 'INCOMPLETE',
    accepted: false,
    jobId: latestJob.jobId,
    reportCount: blocked
      ? snapshot.checkpoints.filter((row) => lower(row.storeId) === lower(store.storeId) && row.jobId === blocked.jobId && row.state === 'downloaded').length
      : 0,
    importRunId: null,
    blockerCode: blocked?.blockerCode,
    blockerDetail: blocked?.detail,
    violations,
  };
}

function validateJobIdentity(job, store, businessDate, violations) {
  let valid = true;
  if (
    !nonEmpty(job.requestId)
    || job.browserProfileId !== store.browserProfileId
    || job.marketplace !== 'US'
    || job.currency !== 'USD'
    || job.businessTimezone !== BUSINESS_TIMEZONE
    || job.businessDate !== businessDate
  ) {
    valid = false;
    violations.push({
      code: 'JOB_AUTHORITY_MISMATCH',
      message: 'Completed job identity must match its US/USD Store Capsule authority.',
      detail: { jobId: job.jobId },
    });
  }
  if (!Number.isInteger(Number(job.sessionGeneration)) || Number(job.sessionGeneration) < 0) {
    valid = false;
    violations.push({
      code: 'JOB_SESSION_INVALID',
      message: 'Completed job sessionGeneration must be one non-negative integer.',
      detail: { jobId: job.jobId, sessionGeneration: job.sessionGeneration },
    });
  }
  let reportTypes;
  try {
    reportTypes = JSON.parse(job.reportTypesJson);
  } catch {
    reportTypes = null;
  }
  if (
    !Array.isArray(reportTypes)
    || reportTypes.length !== EXPECTED_REPORT_TYPES.length
    || new Set(reportTypes).size !== EXPECTED_REPORT_TYPES.length
    || EXPECTED_REPORT_TYPES.some((reportType) => !reportTypes.includes(reportType))
  ) {
    valid = false;
    violations.push({
      code: 'JOB_REPORT_CONTRACT_INVALID',
      message: 'Completed job must be authorized for the exact eight report types.',
      detail: { jobId: job.jobId },
    });
  }
  return valid;
}

function validateBatchIdentity(run, job, businessDate, violations) {
  let valid = true;
  if (run.batchBrowserProfileId !== job.browserProfileId) {
    valid = false;
    violations.push({
      code: 'BATCH_PROFILE_MISMATCH',
      message: 'Import batch browser Profile must match the completed job.',
      detail: { batchId: run.batchId, browserProfileId: run.batchBrowserProfileId },
    });
  }
  if (
    !Number.isInteger(Number(run.batchSessionGeneration))
    || Number(run.batchSessionGeneration) !== Number(job.sessionGeneration)
  ) {
    valid = false;
    violations.push({
      code: 'BATCH_SESSION_MISMATCH',
      message: 'Import batch sessionGeneration must match the completed job.',
      detail: { batchId: run.batchId, sessionGeneration: run.batchSessionGeneration },
    });
  }
  if (
    run.batchId !== job.jobId
    || run.batchRequestId !== job.requestId
    || run.batchBusinessDate !== businessDate
    || run.batchStatus !== 'completed'
  ) {
    valid = false;
    violations.push({
      code: 'BATCH_AUTHORITY_MISMATCH',
      message: 'Import batch request, job, business date and terminal status must match.',
      detail: { batchId: run.batchId, jobId: job.jobId },
    });
  }
  const batchCreatedAtMs = timestampMs(run.batchCreatedAt);
  const batchCompletedAtMs = timestampMs(run.batchCompletedAt);
  if (
    !Number.isFinite(batchCreatedAtMs)
    || !Number.isFinite(batchCompletedAtMs)
    || batchCreatedAtMs > batchCompletedAtMs
    || !timestampWithin(run.batchCreatedAt, timestampMs(job.createdAt), timestampMs(job.updatedAt))
    || !timestampWithin(run.batchCompletedAt, timestampMs(job.createdAt), timestampMs(job.updatedAt))
  ) {
    valid = false;
    violations.push({
      code: 'BATCH_TIME_INVALID',
      message: 'Import batch timestamps must be ordered inside the durable job lifetime.',
      detail: { batchId: run.batchId },
    });
  }
  return valid;
}

function timestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  return Date.parse(value);
}

function timestampWithin(value, lowerBoundMs, upperBoundMs) {
  const valueMs = timestampMs(value);
  return Number.isFinite(valueMs)
    && Number.isFinite(lowerBoundMs)
    && Number.isFinite(upperBoundMs)
    && valueMs >= lowerBoundMs
    && valueMs <= upperBoundMs;
}

function validateJobTime(job, store, businessDate, generatedAt, violations) {
  const createdAtMs = timestampMs(job.createdAt);
  const completedAtMs = timestampMs(job.completedAt);
  const updatedAtMs = timestampMs(job.updatedAt);
  const generatedAtMs = generatedAt === undefined ? Number.POSITIVE_INFINITY : timestampMs(generatedAt);
  const ordered = Number.isFinite(createdAtMs)
    && Number.isFinite(completedAtMs)
    && Number.isFinite(updatedAtMs)
    && createdAtMs <= completedAtMs
    && completedAtMs <= updatedAtMs
    && updatedAtMs <= generatedAtMs;
  if (!ordered) {
    violations.push({
      code: 'JOB_TIME_INVALID',
      message: 'Completed job timestamps must satisfy createdAt <= completedAt <= updatedAt <= generatedAt.',
      detail: {
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        updatedAt: job.updatedAt,
      },
    });
  }
  const terminalTailValid = ordered && updatedAtMs - completedAtMs <= MAX_TERMINAL_TAIL_MS;
  if (ordered && !terminalTailValid) {
    violations.push({
      code: 'JOB_TERMINAL_TAIL_EXCEEDED',
      message: 'Completed job updatedAt may trail completedAt by at most six hours.',
      detail: { completedAt: job.completedAt, updatedAt: job.updatedAt },
    });
  }
  const businessDateValid = Number.isFinite(completedAtMs)
    && store.businessTimezone === BUSINESS_TIMEZONE
    && job.businessTimezone === BUSINESS_TIMEZONE
    && businessDateInTimezone(job.completedAt, BUSINESS_TIMEZONE) === businessDate;
  if (!businessDateValid) {
    violations.push({
      code: 'JOB_BUSINESS_DATE_MISMATCH',
      message: `Completed job must terminate on its ${BUSINESS_TIMEZONE} businessDate.`,
      detail: { businessDate, completedAt: job.completedAt, businessTimezone: job.businessTimezone },
    });
  }
  return {
    completedAtMs,
    createdAtMs,
    updatedAtMs,
    valid: ordered && terminalTailValid && businessDateValid,
  };
}

function validateImportTime(run, jobTime, violations) {
  const startedAtMs = timestampMs(run.startedAt);
  const completedAtMs = timestampMs(run.completedAt);
  const createdAtMs = timestampMs(run.createdAt);
  const valid = Number.isFinite(startedAtMs)
    && Number.isFinite(completedAtMs)
    && Number.isFinite(createdAtMs)
    && startedAtMs <= completedAtMs
    && startedAtMs <= createdAtMs
    && timestampWithin(run.startedAt, jobTime.createdAtMs, jobTime.updatedAtMs)
    && timestampWithin(run.completedAt, jobTime.createdAtMs, jobTime.updatedAtMs)
    && timestampWithin(run.createdAt, jobTime.createdAtMs, jobTime.updatedAtMs);
  if (!valid) {
    violations.push({
      code: 'IMPORT_TIME_INVALID',
      message: 'Import createdAt/startedAt/completedAt must be ordered inside the durable job lifetime.',
      detail: {
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
    });
  }
  return { completedAtMs, createdAtMs, startedAtMs, valid };
}

function normalizedTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const timestamp = new Date(value).valueOf();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function compareNewestRecord(timestampField, identityField) {
  return (left, right) => {
    const timestampOrder = normalizedTimestamp(right?.[timestampField])
      .localeCompare(normalizedTimestamp(left?.[timestampField]));
    if (timestampOrder !== 0) return timestampOrder;
    return String(right?.[identityField] ?? '').localeCompare(String(left?.[identityField] ?? ''));
  };
}

function normalizedDirectPath(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function realpathIsContained(rootPath, candidatePath) {
  try {
    return isPathContained(
      fs.realpathSync.native(rootPath),
      fs.realpathSync.native(candidatePath),
    );
  } catch {
    return false;
  }
}

function importRunKey(storeId, runId) {
  return `${lower(storeId)}|${String(runId ?? '')}`;
}

function validateGlobalImportProofs(snapshot, input, addViolation) {
  const invalidRunKeys = new Set();
  const verifiedFileArtifacts = [];
  const runByKey = new Map(snapshot.imports.map((run) => [importRunKey(run.storeId, run.runId), run]));
  let storesRoot = null;
  try {
    storesRoot = path.resolve(input.storesRoot);
    const rootLstat = fs.lstatSync(storesRoot);
    const rootStat = fs.statSync(storesRoot);
    if (
      rootLstat.isSymbolicLink()
      || !rootStat.isDirectory()
      || !requestedPathEqualsRealpath(storesRoot)
    ) {
      throw new Error('not one canonical direct directory');
    }
  } catch (error) {
    addViolation(
      'STORES_ROOT_INVALID',
      'Store Capsule root must be the canonical direct USER_DATA_DIR/stores directory.',
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }

  const seenFingerprints = new Map();
  for (const run of snapshot.imports) {
    const runKey = importRunKey(run.storeId, run.runId);
    const fingerprint = typeof run.inputFingerprint === 'string'
      ? run.inputFingerprint.toUpperCase()
      : '';
    if (!isSha256(fingerprint)) {
      invalidRunKeys.add(runKey);
      addViolation(
        'IMPORT_FINGERPRINT_INVALID',
        'Every import inputFingerprint must be one non-empty SHA-256.',
        { storeId: lower(run.storeId), businessDate: run.businessDate, runId: run.runId },
      );
      continue;
    }
    const existing = seenFingerprints.get(fingerprint);
    if (existing) {
      invalidRunKeys.add(runKey);
      invalidRunKeys.add(existing.runKey);
      addViolation(
        'DUPLICATE_IMPORT_FINGERPRINT',
        'One inputFingerprint may appear only once across the complete two-store seven-day window.',
        {
          storeId: lower(run.storeId),
          businessDate: run.businessDate,
          runIds: [existing.runId, run.runId],
        },
      );
    } else {
      seenFingerprints.set(fingerprint, { runId: run.runId, runKey });
    }
  }

  const seenHashes = new Map();
  const seenPaths = new Map();
  for (const file of snapshot.importFiles) {
    const runKey = importRunKey(file.storeId, file.runId);
    const run = runByKey.get(runKey);
    if (!run || file.batchId !== run.batchId) {
      invalidRunKeys.add(runKey);
      addViolation(
        'IMPORT_FILE_LINEAGE_INVALID',
        'Every imported file snapshot must bind to its exact store/run/batch.',
        { storeId: lower(file.storeId), runId: file.runId, batchId: file.batchId },
      );
    }
    const fileHash = typeof file.fileHash === 'string' ? file.fileHash.toUpperCase() : '';
    if (!isSha256(fileHash)) {
      invalidRunKeys.add(runKey);
      addViolation(
        'IMPORT_FILE_HASH_INVALID',
        'Every imported file snapshot must contain one non-empty SHA-256.',
        { storeId: lower(file.storeId), runId: file.runId, reportType: file.reportType },
      );
    } else {
      const existing = seenHashes.get(fileHash);
      if (existing) {
        invalidRunKeys.add(runKey);
        invalidRunKeys.add(existing.runKey);
        addViolation(
          'DUPLICATE_IMPORT_FILE_HASH',
          'One report file SHA-256 may appear only once across all stores, days and report types.',
          {
            storeId: lower(file.storeId),
            runId: file.runId,
            otherRunId: existing.runId,
            reportType: file.reportType,
          },
        );
        // Preserve the established public violation code consumed by existing
        // acceptance reports while strengthening its scope globally.
        addViolation(
          'DUPLICATE_IMPORT_FILE',
          'The same report file bytes were reused in the continuous-operation window.',
          { storeId: lower(file.storeId), runIds: [existing.runId, file.runId] },
        );
      } else {
        seenHashes.set(fileHash, { runId: file.runId, runKey });
      }
    }

    let resolvedFilePath = null;
    try {
      if (
        typeof file.filePath !== 'string'
        || file.filePath !== file.filePath.trim()
        || !path.isAbsolute(file.filePath)
        || file.filePath.includes('\0')
      ) {
        throw new Error('filePath is not a clean absolute path');
      }
      resolvedFilePath = path.resolve(file.filePath);
      const storeRoot = storesRoot && path.join(storesRoot, lower(file.storeId));
      if (
        !storesRoot
        || !storeRoot
        || !isPathContained(storeRoot, resolvedFilePath)
        || !realpathIsContained(storeRoot, resolvedFilePath)
      ) {
        invalidRunKeys.add(runKey);
        addViolation(
          'FILE_PATH_OUTSIDE_STORE_CAPSULE',
          'Imported report file must remain inside USER_DATA_DIR/stores/<storeId>/....',
          { storeId: lower(file.storeId), runId: file.runId, filePath: file.filePath },
        );
      }
      const { resolved, stat } = assertUniqueRegularFile(
        resolvedFilePath,
        'Imported report file',
      );
      if (String(file.fileName ?? '') !== path.basename(resolved)) {
        throw new Error('fileName does not match the canonical filePath basename');
      }
      const actualHash = sha256File(resolved);
      if (
        !Number.isInteger(Number(file.fileSizeBytes))
        || Number(file.fileSizeBytes) <= 0
        || stat.size !== Number(file.fileSizeBytes)
        || actualHash !== fileHash
      ) {
        invalidRunKeys.add(runKey);
        addViolation(
          'IMPORT_FILE_BYTES_MISMATCH',
          'Imported report file size/SHA-256 must match the current unique regular file.',
          { storeId: lower(file.storeId), runId: file.runId, filePath: resolved },
        );
      } else {
        verifiedFileArtifacts.push({
          filePath: resolved,
          runKey,
          sha256: actualHash,
          sizeBytes: stat.size,
        });
      }
    } catch (error) {
      invalidRunKeys.add(runKey);
      addViolation(
        'IMPORT_FILE_PATH_INVALID',
        'Imported report file must be one canonical unique regular file.',
        {
          storeId: lower(file.storeId),
          runId: file.runId,
          filePath: file.filePath,
          detail: error instanceof Error ? error.message : String(error),
        },
      );
    }

    if (resolvedFilePath) {
      const normalizedPath = normalizedDirectPath(resolvedFilePath);
      const existing = seenPaths.get(normalizedPath);
      if (existing) {
        invalidRunKeys.add(runKey);
        invalidRunKeys.add(existing.runKey);
        addViolation(
          'DUPLICATE_IMPORT_FILE_PATH',
          'One canonical report file path may appear only once across all stores, days and report types.',
          { storeId: lower(file.storeId), runId: file.runId, otherRunId: existing.runId },
        );
      } else {
        seenPaths.set(normalizedPath, { runId: file.runId, runKey });
      }
    }
  }
  return { invalidRunKeys, verifiedFileArtifacts };
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

function buildEvidenceManifest(databasePath, input, result, integrityCheck, authoritySnapshot) {
  const stat = fs.statSync(databasePath);
  const packageIdentity = normalizePackageIdentity(authoritySnapshot?.packageIdentity);
  return {
    kind: 's7-continuous-operation-evidence',
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: result.passed ? 'PASSED' : 'BLOCKED',
    readinessImpact: 'CONTINUOUS_OPERATION_GATE_ONLY',
    finalReadinessCredit: false,
    packageIdentity,
    storesRoot: authoritySnapshot.storesRoot,
    storeCapsule: {
      storesRoot: authoritySnapshot.storesRoot,
      verifiedFileCount: result._verifiedFileArtifacts?.length ?? 0,
    },
    database: {
      absolutePath: databasePath,
      sha256: sha256File(databasePath),
      sizeBytes: stat.size,
      integrityCheck,
      openedReadOnly: true,
      packageIdentity,
      snapshotManifestSha256: authoritySnapshot.snapshotManifestSha256,
    },
    authoritySnapshotManifest: {
      absolutePath: authoritySnapshot.manifestPath,
      sha256: authoritySnapshot.snapshotManifestSha256,
    },
    authorityCurrentness: input.authorityCurrentness,
    window: {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      businessDates: input.dates,
      businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
    },
    ...result,
  };
}

function assertSafeExistingAncestor(candidatePath, label) {
  let cursor = path.resolve(candidatePath);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) fail(`${label} has no existing filesystem ancestor.`);
    cursor = parent;
  }
  assertDirectDirectory(cursor, `${label} ancestor`);
}

function pathsOverlap(left, right) {
  return isPathContained(left, right) || isPathContained(right, left);
}

function resolveCanonicalOutputPath(outputPath, context, authoritySnapshot) {
  if (
    typeof outputPath !== 'string'
    || outputPath !== outputPath.trim()
    || !path.isAbsolute(outputPath)
    || outputPath.includes('\0')
  ) {
    fail('Continuous-operation output must be one clean absolute JSON path.');
  }
  const canonicalEvidenceRoot = path.resolve(context.canonicalEvidenceRoot);
  const expectedOutputRoot = path.join(canonicalEvidenceRoot, 'continuous-operation');
  const configuredOutputRoot = path.resolve(
    context.continuousOperationOutputRoot ?? expectedOutputRoot,
  );
  if (!samePath(configuredOutputRoot, expectedOutputRoot)) {
    fail('Continuous-operation output root must be canonical output/codex-evidence/continuous-operation.');
  }
  const resolved = path.resolve(outputPath);
  if (!samePath(path.dirname(resolved), configuredOutputRoot)) {
    fail('Continuous-operation output must be a direct child of the canonical continuous-operation evidence root.');
  }
  const basename = path.basename(resolved);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(basename)) {
    fail('Continuous-operation output filename must be one safe <new-file>.json name.');
  }
  for (const [label, protectedRoot] of [
    ['authority snapshot root', context.authoritySnapshotRoot],
    ['canonical package root', context.releaseRoot],
    ['live USER_DATA_DIR', path.dirname(authoritySnapshot.authorityDbPath)],
    ['Store Capsule root', authoritySnapshot.storesRoot],
  ]) {
    if (pathsOverlap(configuredOutputRoot, protectedRoot)) {
      fail(`Continuous-operation output root overlaps the protected ${label}.`);
    }
  }
  if (fs.existsSync(resolved)) {
    fail(`Continuous-operation output already exists and will not be overwritten: ${resolved}`);
  }
  return { outputPath: resolved, outputRoot: configuredOutputRoot };
}

function verifyAuthorityInputsUnchanged(authoritySnapshot, context, verifiedFileArtifacts = []) {
  for (const [label, candidatePath, expected] of [
    ['authority snapshot manifest', authoritySnapshot.manifestPath, authoritySnapshot.manifestArtifact],
    ['authority database snapshot', authoritySnapshot.databasePath, authoritySnapshot.snapshotArtifact],
    ['live authority database main file', authoritySnapshot.authorityDbPath, authoritySnapshot.sourceArtifact],
  ]) {
    assertUniqueRegularFile(candidatePath, label);
    const current = fileArtifact(candidatePath);
    if (!sameArtifact(current, expected)) {
      fail(`${label} bytes changed during continuous-operation verification.`);
    }
  }
  for (const artifact of verifiedFileArtifacts) {
    const { resolved, stat } = assertUniqueRegularFile(
      artifact.filePath,
      'Verified Store Capsule report file',
    );
    if (stat.size !== artifact.sizeBytes || sha256File(resolved) !== artifact.sha256) {
      fail(`Verified Store Capsule report file changed during verification: ${resolved}`);
    }
  }
  if (authoritySnapshot.packageIdentityVerified) {
    const packageIdentityCurrent = normalizePackageIdentity(
      computeCanonicalPackageIdentity(context),
    );
    if (JSON.stringify(packageIdentityCurrent) !== JSON.stringify(authoritySnapshot.packageIdentity)) {
      fail('Canonical package identity changed during continuous-operation verification.');
    }
  }
}

function captureLiveAuthorityCurrentness(authoritySnapshot, context, captureLabel) {
  const capture = context.captureAuthoritySnapshotCurrentness
    ?? captureAuthoritySnapshotCurrentness;
  if (typeof capture !== 'function') {
    fail('Authority currentness capture implementation is invalid.');
  }
  return capture({
    sourceDatabasePath: authoritySnapshot.authorityDbPath,
    expectedSnapshotArtifact: authoritySnapshot.snapshotArtifact,
    captureLabel,
  }, {
    ...(context.authorityCurrentnessContext ?? {}),
    now: context.now,
  });
}

function writeExclusiveAtomic(outputBoundary, serialized, context, verifyAfterWrite) {
  const { outputPath, outputRoot } = outputBoundary;
  assertSafeExistingAncestor(outputRoot, 'Continuous-operation output root');
  fs.mkdirSync(outputRoot, { recursive: true });
  assertDirectDirectory(outputRoot, 'Continuous-operation output root');
  if (fs.existsSync(outputPath)) {
    fail(`Continuous-operation output already exists and will not be overwritten: ${outputPath}`);
  }
  const tempPath = path.join(
    outputRoot,
    `.${path.basename(outputPath)}.${context.randomUUID()}.tmp`,
  );
  let finalLinked = false;
  try {
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    const handle = fs.openSync(tempPath, 'r+');
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.linkSync(tempPath, outputPath);
    finalLinked = true;
    fs.unlinkSync(tempPath);
    assertUniqueRegularFile(outputPath, 'Continuous-operation evidence output');
    verifyAfterWrite();
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (finalLinked && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw error;
  }
}

function run(argv = process.argv.slice(2), injectedContext = {}) {
  const context = { ...defaultRuntimeContext(), ...injectedContext };
  const input = parseArgs(argv, { now: context.now });
  if (input.help) {
    context.writeStdout('Usage: node scripts/verify-s7-continuous-operation.js --authority-snapshot-manifest <snapshot-manifest.json> --store <id> --store <id> --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--output output/codex-evidence/continuous-operation/<new-file>.json]\n');
    return 0;
  }
  const authoritySnapshot = loadAuthoritySnapshotManifest(
    input.authoritySnapshotManifestPath,
    { ...context, verifyPackageIdentity: true },
  );
  const currentnessBeforeWork = captureLiveAuthorityCurrentness(
    authoritySnapshot,
    context,
    'continuous-before-work',
  );
  input.databasePath = authoritySnapshot.databasePath;
  input.storesRoot = authoritySnapshot.storesRoot;
  const outputBoundary = input.outputPath
    ? resolveCanonicalOutputPath(input.outputPath, context, authoritySnapshot)
    : null;
  // Loaded lazily so --help works even before native dependencies are prepared.
  const Database = context.Database ?? requireLocalDbDependency('better-sqlite3');
  const database = new Database(input.databasePath, { readonly: true, fileMustExist: true });
  let integrityCheck;
  let manifest;
  let result;
  try {
    database.pragma('query_only = ON');
    const integrityRows = database.pragma('integrity_check');
    integrityCheck = integrityRows.map((row) => String(
      row.integrity_check ?? row[Object.keys(row)[0]],
    ));
    const foreignKeyViolations = database.pragma('foreign_key_check');
    const snapshot = readContinuousOperationSnapshot(database, input);
    result = evaluateContinuousOperationSnapshot(snapshot, input);
    if (integrityCheck.length !== 1 || integrityCheck[0] !== 'ok') {
      result.passed = false;
      result.violations.unshift({ code: 'DATABASE_INTEGRITY_FAILED', message: 'PRAGMA integrity_check did not return ok.', actual: integrityCheck });
    }
    if (!Array.isArray(foreignKeyViolations) || foreignKeyViolations.length > 0) {
      result.passed = false;
      result.violations.unshift({
        code: 'DATABASE_FOREIGN_KEY_FAILED',
        message: 'PRAGMA foreign_key_check returned violations.',
        actual: foreignKeyViolations,
      });
    }
  } finally {
    database.close();
  }
  verifyAuthorityInputsUnchanged(
    authoritySnapshot,
    context,
    result._verifiedFileArtifacts,
  );
  const currentnessBeforeFinalOutput = captureLiveAuthorityCurrentness(
    authoritySnapshot,
    context,
    'continuous-before-final-output',
  );
  const currentnessValidation = assertMatchingAuthorityCurrentnessProofs(
    [currentnessBeforeWork, currentnessBeforeFinalOutput],
    authoritySnapshot.snapshotArtifact,
    'Continuous-operation authority currentness',
  );
  input.authorityCurrentness = {
    method: currentnessValidation.method,
    expectedSnapshot: currentnessValidation.expectedSnapshot,
    captures: [currentnessBeforeWork, currentnessBeforeFinalOutput],
    passed: true,
  };
  manifest = buildEvidenceManifest(
    input.databasePath,
    input,
    result,
    integrityCheck,
    authoritySnapshot,
  );
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (outputBoundary && manifest.status === 'PASSED') {
    writeExclusiveAtomic(outputBoundary, serialized, context, () => {
      if (context.afterOutputWritten !== undefined && context.afterOutputWritten !== null) {
        if (typeof context.afterOutputWritten !== 'function') {
          fail('afterOutputWritten must be null or a function.');
        }
        context.afterOutputWritten({
          authoritySnapshot,
          outputPath: outputBoundary.outputPath,
        });
      }
      verifyAuthorityInputsUnchanged(
        authoritySnapshot,
        context,
        result._verifiedFileArtifacts,
      );
      const currentnessAfterFinalOutput = captureLiveAuthorityCurrentness(
        authoritySnapshot,
        context,
        'continuous-after-final-output',
      );
      assertMatchingAuthorityCurrentnessProofs(
        [
          currentnessBeforeWork,
          currentnessBeforeFinalOutput,
          currentnessAfterFinalOutput,
        ],
        authoritySnapshot.snapshotArtifact,
        'Continuous-operation final authority currentness',
      );
    });
  }
  context.writeStdout(serialized);
  return manifest.status === 'PASSED' ? 0 : 2;
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
  ACCEPTANCE_CONTRACT_VERSION,
  AUTHORITY_SNAPSHOT_KIND,
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  BUSINESS_TIMEZONE,
  EXPECTED_REPORT_TYPES,
  SCHEMA_VERSION,
  US_BUSINESS_CALENDAR_VERSION,
  buildEvidenceManifest,
  evaluateContinuousOperationSnapshot,
  inclusiveDates,
  loadAuthoritySnapshotManifest,
  parseArgs,
  recentCompletedUsBusinessDates,
  readContinuousOperationSnapshot,
  run,
  usFederalBusinessDates,
  usFederalHolidayDates,
  usWeekdayBusinessDates,
};
