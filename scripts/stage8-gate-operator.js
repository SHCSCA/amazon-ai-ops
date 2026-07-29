const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const {
  EXPECTED_REPORT_TYPES,
  BUSINESS_TIMEZONE,
  evaluateContinuousOperationSnapshot,
  loadAuthoritySnapshotManifest,
  readContinuousOperationSnapshot,
  recentCompletedUsBusinessDates,
} = require('./verify-s7-continuous-operation');
const {
  deterministicExecutionArtifactPath,
} = require('./verify-mission-control-production-readiness');
const {
  runReadonlySqliteOnlineBackupSync,
} = require('./sqlite-authority-currentness');
const {
  resolveAdReadbackAuthorityDbPath,
} = require('./ad-readback-authority-db');

const ROOT = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(
  path.join(ROOT, 'packages', 'local-db', 'package.json'),
);
const LEDGER_KIND = 'stage8-gate-operator-monitoring-ledger';
const LEDGER_SCHEMA_VERSION = 'stage8-gate-operator-monitoring-ledger/v1';
const EXPORT_SEQUENCE = Object.freeze([
  'authority-snapshot',
  'continuous-operation',
  'manual-canary',
  'policy-auto-canary',
  'production-readiness',
]);
const REQUIRED_TABLES = Object.freeze([
  'schema_migrations',
  'stores',
  'store_connections',
  'store_session_metadata',
  'lingxing_collection_jobs',
  'lingxing_collection_report_checkpoints',
  'report_import_runs',
  'report_import_file_snapshots',
  'report_import_reconciliations',
  'missions',
  'mission_grants',
  'mission_grant_events',
  'decisions',
  'decision_history',
  'policy_versions',
  'policy_runtime',
  'analysis_action_batches',
  'analysis_proposal_snapshots',
  'analysis_proposal_decision_links',
  'verified_ad_entity_authority',
  'ad_keyword_identity_versions',
  'ad_execution_batches',
  'ad_execution_jobs',
  'ad_execution_evidence',
]);
const PACKAGE_EVIDENCE_OPTIONS = Object.freeze([
  'v15-final-readiness',
  'package-launch-smoke',
  'package-ui-manifest',
  'package-security-evidence',
  'package-adversarial-node-env-evidence',
]);
const SINGLE_VALUE_OPTIONS = new Set([
  'db',
  'snapshot-manifest',
  'out',
  'export-root',
  ...PACKAGE_EVIDENCE_OPTIONS,
]);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedId(value) {
  return String(value ?? '').trim().toLowerCase();
}

function stableRef(prefix, value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  return `${prefix}-${digest}`;
}

function pathDescriptor(filePath) {
  if (!filePath) return null;
  return {
    basename: path.basename(filePath),
    ref: stableRef('path', path.resolve(filePath).toLowerCase()),
  };
}

function parseArgs(argv) {
  const values = { stores: [] };
  const errors = [];
  let help = false;
  let exportRequested = false;
  let executeExports = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') {
      help = true;
      continue;
    }
    if (token === '--export') {
      exportRequested = true;
      continue;
    }
    if (token === '--execute-exports') {
      exportRequested = true;
      executeExports = true;
      continue;
    }
    if (token === '--store') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        errors.push('Missing value for --store.');
      } else {
        values.stores.push(normalizedId(value));
        index += 1;
      }
      continue;
    }
    if (!token.startsWith('--')) {
      errors.push(`Unexpected argument: ${token}`);
      continue;
    }
    const key = token.slice(2);
    if (!SINGLE_VALUE_OPTIONS.has(key)) {
      errors.push(`Unexpected argument: ${token}`);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      errors.push(`Missing value for ${token}.`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      errors.push(`Duplicate argument: ${token}`);
    } else {
      values[key] = path.resolve(value);
    }
    index += 1;
  }
  if (values.stores.length !== 0
    && (values.stores.length !== 2 || new Set(values.stores).size !== 2)) {
    errors.push('Use either no --store values or exactly two distinct normalized --store values.');
  }
  if (exportRequested && !values.out) {
    errors.push('--export and --execute-exports require an explicit --out path.');
  }
  if (executeExports && !values['export-root']) {
    errors.push('--execute-exports requires --export-root.');
  }
  if (executeExports) {
    for (const option of PACKAGE_EVIDENCE_OPTIONS) {
      if (!values[option]) errors.push(`--execute-exports requires --${option}.`);
    }
  }
  return {
    errors,
    executeExports,
    exportRequested,
    help,
    values,
  };
}

function migrationContract(migrationsRoot = path.join(
  ROOT,
  'packages',
  'local-db',
  'src',
  'sqlite',
  'migrations',
)) {
  const rows = [];
  for (const fileName of fs.readdirSync(migrationsRoot)
    .filter((name) => /^000\d-.*\.ts$/.test(name) && !name.endsWith('.test.ts'))
    .sort()) {
    const source = fs.readFileSync(path.join(migrationsRoot, fileName), 'utf8');
    const versionMatch = source.match(
      /export const [A-Z0-9_]+_MIGRATION_VERSION = (\d+);/,
    );
    const nameMatch = source.match(
      /export const [A-Z0-9_]+_MIGRATION_NAME = '([^']+)';/,
    );
    const checksumMatches = [...source.matchAll(
      /export const (?!LEGACY_)[A-Z0-9_]+_MIGRATION_CHECKSUM = '([^']+)';/g,
    )];
    if (!versionMatch || !nameMatch || checksumMatches.length !== 1) {
      fail(`Could not read the current migration contract from ${fileName}.`);
    }
    rows.push({
      checksum: checksumMatches[0][1],
      name: nameMatch[1],
      version: Number(versionMatch[1]),
    });
  }
  rows.sort((left, right) => left.version - right.version);
  if (rows.length === 0 || rows.some((row, index) => row.version !== index + 1)) {
    fail('The current migration source contract is not contiguous.');
  }
  return rows;
}

function tableSet(database) {
  return new Set(database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => String(row.name)));
}

function inspectSchema(database, contract = migrationContract()) {
  database.pragma('query_only = ON');
  const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1;
  const integrityCheck = database.pragma('integrity_check')
    .map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
  const foreignKeyCheck = database.pragma('foreign_key_check');
  const tables = tableSet(database);
  const applied = tables.has('schema_migrations')
    ? database.prepare(`
      SELECT version, name, checksum, status
      FROM schema_migrations
      ORDER BY version
    `).all()
    : [];
  const appliedByVersion = new Map(applied.map((row) => [Number(row.version), row]));
  const migrations = contract.map((expected) => {
    const actual = appliedByVersion.get(expected.version);
    let status = 'MISSING';
    if (actual) {
      status = actual.status === 'applied'
        && actual.name === expected.name
        && actual.checksum === expected.checksum
        ? 'APPLIED'
        : 'MISMATCH';
    }
    return {
      status,
      version: expected.version,
    };
  });
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  const ready = queryOnly
    && integrityCheck.length === 1
    && integrityCheck[0] === 'ok'
    && foreignKeyCheck.length === 0
    && migrations.every((row) => row.status === 'APPLIED')
    && missingTables.length === 0;
  return {
    foreignKeyViolationCount: foreignKeyCheck.length,
    integrity: integrityCheck.length === 1 && integrityCheck[0] === 'ok'
      ? 'ok'
      : 'failed',
    latestExpectedVersion: contract.at(-1)?.version ?? null,
    migrations,
    missingTables,
    openedReadOnly: true,
    queryOnly,
    status: ready ? 'READY' : 'MIGRATION_REQUIRED',
  };
}

function businessDateInLosAngeles(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function storeRows(database, selectedIds) {
  const tables = tableSet(database);
  if (!tables.has('stores')) return [];
  const all = database.prepare(`
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, display_name AS displayName, status,
           business_timezone AS businessTimezone
    FROM stores
    ORDER BY lower(store_id)
  `).all();
  if (selectedIds.length === 0) {
    const active = all.filter((row) => (
      row.status === 'active'
      && row.marketplace === 'US'
      && row.currency === 'USD'
    ));
    return active.length === 2 ? active : [];
  }
  const selected = new Set(selectedIds);
  return all.filter((row) => selected.has(normalizedId(row.storeId)));
}

function storeAliasMap(stores) {
  return new Map(stores
    .slice()
    .sort((left, right) => normalizedId(left.storeId).localeCompare(normalizedId(right.storeId)))
    .map((store, index) => [normalizedId(store.storeId), `store-${index + 1}`]));
}

function providerGapPrefix(provider) {
  return provider === 'amazon_ads' ? 'AMAZON_ADS' : 'LINGXING';
}

function timestampAtOrBefore(value, upperBoundMs) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) && parsed <= upperBoundMs;
}

function sessionOperationalGaps(session, generatedAtMs) {
  const prefix = providerGapPrefix(session.provider);
  const gaps = [];
  if (!session.present) gaps.push(`${prefix}_SESSION_MISSING`);
  else {
    if (session.status !== 'ready') gaps.push(`${prefix}_SESSION_NOT_READY`);
    if (!session.profileMatchesStore) gaps.push(`${prefix}_SESSION_PROFILE_MISMATCH`);
    if (!timestampAtOrBefore(session.observedAt, generatedAtMs)) {
      gaps.push(`${prefix}_SESSION_OBSERVED_AT_INVALID`);
    }
    if (!timestampAtOrBefore(session.verifiedAt, generatedAtMs)) {
      gaps.push(`${prefix}_SESSION_VERIFIED_AT_INVALID`);
    }
    if (session.expiresAt !== null) {
      const expiresAtMs = Date.parse(String(session.expiresAt));
      if (!Number.isFinite(expiresAtMs)) gaps.push(`${prefix}_SESSION_EXPIRES_AT_INVALID`);
      else if (expiresAtMs <= generatedAtMs) gaps.push(`${prefix}_SESSION_EXPIRED`);
    }
  }
  return gaps;
}

function inspectStores(database, selectedIds, generatedAt = new Date().toISOString()) {
  const tables = tableSet(database);
  const generatedAtMs = Date.parse(generatedAt);
  const allStoreCount = tables.has('stores')
    ? Number(database.prepare('SELECT COUNT(*) AS count FROM stores').get().count)
    : 0;
  const activeUsUsdCount = tables.has('stores')
    ? Number(database.prepare(`
      SELECT COUNT(*) AS count FROM stores
      WHERE status = 'active' AND marketplace = 'US' AND currency = 'USD'
    `).get().count)
    : 0;
  const selected = storeRows(database, selectedIds);
  const aliases = storeAliasMap(selected);
  const connections = tables.has('store_connections')
    ? database.prepare(`
      SELECT store_id AS storeId, provider, status, last_verified_at AS lastVerifiedAt,
             last_failure_code AS lastFailureCode
      FROM store_connections
    `).all()
    : [];
  const sessions = tables.has('store_session_metadata')
    ? database.prepare(`
      SELECT store_id AS storeId, provider, browser_profile_id AS browserProfileId,
             status, session_generation AS sessionGeneration,
             observed_at AS observedAt, verified_at AS verifiedAt,
             expires_at AS expiresAt, failure_code AS failureCode
      FROM store_session_metadata
    `).all()
    : [];
  const items = selected.map((store) => {
    const storeConnections = connections.filter(
      (row) => normalizedId(row.storeId) === normalizedId(store.storeId),
    );
    const storeSessions = sessions.filter(
      (row) => normalizedId(row.storeId) === normalizedId(store.storeId),
    );
    return {
      alias: aliases.get(normalizedId(store.storeId)),
      authority: {
        active: store.status === 'active',
        businessTimezone: store.businessTimezone,
        currency: store.currency,
        marketplace: store.marketplace,
      },
      connections: ['lingxing', 'amazon_ads'].map((provider) => {
        const row = storeConnections.find((item) => item.provider === provider);
        return {
          hasFailureCode: Boolean(row?.lastFailureCode),
          lastVerifiedAt: row?.lastVerifiedAt || null,
          present: Boolean(row),
          provider,
          status: row?.status || 'not_configured',
        };
      }),
      profileRef: stableRef('profile', store.browserProfileId),
      sessions: ['lingxing', 'amazon_ads'].map((provider) => {
        const row = storeSessions.find((item) => item.provider === provider);
        return {
          expiresAt: row?.expiresAt || null,
          generation: Number(row?.sessionGeneration ?? 0),
          hasFailureCode: Boolean(row?.failureCode),
          observedAt: row?.observedAt || null,
          present: Boolean(row),
          profileMatchesStore: row
            ? normalizedId(row.browserProfileId) === normalizedId(store.browserProfileId)
            : false,
          provider,
          status: row?.status || 'unknown',
          verifiedAt: row?.verifiedAt || null,
        };
      }),
    };
  });
  for (const item of items) {
    const gaps = [];
    for (const connection of item.connections) {
      const prefix = providerGapPrefix(connection.provider);
      if (!connection.present) gaps.push(`${prefix}_CONNECTION_MISSING`);
      else if (connection.status !== 'ready') gaps.push(`${prefix}_CONNECTION_NOT_READY`);
    }
    for (const session of item.sessions) {
      gaps.push(...sessionOperationalGaps(session, generatedAtMs));
    }
    item.operationalStatus = {
      gaps,
      status: gaps.length === 0 ? 'READY' : 'BLOCKED',
    };
  }
  const profiles = selected.map((store) => normalizedId(store.browserProfileId)).filter(Boolean);
  const authorityValid = activeUsUsdCount === 2
    && selected.length === 2
    && new Set(profiles).size === 2
    && profiles.length === 2
    && items.every((item) => (
      item.authority.active
      && item.authority.marketplace === 'US'
      && item.authority.currency === 'USD'
      && item.authority.businessTimezone === BUSINESS_TIMEZONE
    ));
  const operationalReady = items.length === 2
    && items.every((item) => item.operationalStatus.status === 'READY');
  return {
    activeUsUsdCount,
    allStoreCount,
    aliases,
    items,
    operationalStatus: {
      status: operationalReady ? 'READY' : 'BLOCKED',
      stores: items.map((item) => ({
        gaps: item.operationalStatus.gaps,
        status: item.operationalStatus.status,
        storeAlias: item.alias,
      })),
    },
    rawStores: selected,
    selectedCount: selected.length,
    authorityStatus: authorityValid ? 'READY' : 'NEEDS_CONFIGURATION',
    status: authorityValid && operationalReady ? 'READY' : 'NEEDS_CONFIGURATION',
  };
}

function violationAction(code) {
  if (code === 'ACTIVE_US_USD_STORE_COUNT_NOT_TWO') {
    return 'Restore the global active US/USD authority set to exactly two stores, then rerun.';
  }
  if (code === 'STORE_NOT_FOUND' || code === 'STORE_AUTHORITY_INVALID') {
    return 'Repair the aliased store authority row before rerunning.';
  }
  if (code === 'SILENT_MISSING_DAY' || code === 'BLOCKER_NOT_ACTIONABLE') {
    return 'Create a durable collection result or actionable blocker for this aliased store and date.';
  }
  if (code === 'DAY_BLOCKED') {
    return 'Resolve the recorded blocker for this aliased store and date, then collect again.';
  }
  if (code.includes('IMPORT') || code.includes('RECONCILIATION')) {
    return 'Repair the selected import and reconciliation lineage for this aliased store and date.';
  }
  if (code.includes('REPORT') || code.includes('CHECKPOINT')) {
    return 'Repair the selected eight-report checkpoint set for this aliased store and date.';
  }
  if (code.includes('TIME') || code.includes('WINDOW')) {
    return 'Repair the durable timestamp or business-date window for this aliased store and date.';
  }
  return 'Inspect this code for the aliased store and date, repair the authority evidence, then rerun.';
}

function safeViolationDetail(violation) {
  const detail = {
    action: violationAction(String(violation?.code || 'UNKNOWN')),
  };
  const source = isRecord(violation?.detail)
    ? { ...violation, ...violation.detail }
    : violation;
  for (const key of [
    'actualCount',
    'checkpointCount',
    'expectedCount',
    'sessionGeneration',
  ]) {
    const value = source?.[key];
    if (value === null || (typeof value === 'number' && Number.isFinite(value))) {
      detail[key] = value;
    }
  }
  for (const key of [
    'completedAt',
    'observedAt',
    'reconciledAt',
    'startedAt',
    'updatedAt',
    'verifiedAt',
  ]) {
    const parsed = Date.parse(String(source?.[key] ?? ''));
    if (Number.isFinite(parsed)) detail[key] = new Date(parsed).toISOString();
  }
  if (Array.isArray(source?.missingReports)) {
    detail.missingReports = source.missingReports.filter(
      (reportType) => EXPECTED_REPORT_TYPES.includes(reportType),
    );
  }
  if (Array.isArray(source?.unexpectedReports)) {
    detail.unexpectedReportCount = source.unexpectedReports.length;
  }
  return detail;
}

function reportMatrix(snapshot, evaluation, stores, aliases, dates) {
  const resultByStore = new Map(
    (evaluation?.stores || []).map((row) => [normalizedId(row.storeId), row]),
  );
  const rows = [];
  for (const store of stores) {
    const storeId = normalizedId(store.storeId);
    const storeResult = resultByStore.get(storeId);
    for (const businessDate of dates) {
      const dayResult = storeResult?.days?.find(
        (day) => day.businessDate === businessDate,
      ) || null;
      const job = snapshot.jobs.find((row) => (
        normalizedId(row.storeId) === storeId
        && row.businessDate === businessDate
        && row.jobId === dayResult?.jobId
      )) || null;
      const checkpoints = job
        ? snapshot.checkpoints.filter((row) => (
          normalizedId(row.storeId) === storeId && row.jobId === job.jobId
        ))
        : [];
      const importRun = dayResult?.importRunId
        ? snapshot.imports.find((row) => (
          normalizedId(row.storeId) === storeId
          && row.runId === dayResult.importRunId
        ))
        : null;
      const reports = EXPECTED_REPORT_TYPES.map((reportType) => {
        const checkpoint = checkpoints.find((row) => row.reportType === reportType);
        const imported = importRun && snapshot.importFiles.some((row) => (
          normalizedId(row.storeId) === storeId
          && row.runId === importRun.runId
          && row.reportType === reportType
        ));
        const reconciled = importRun && snapshot.reconciliations.some((row) => (
          normalizedId(row.storeId) === storeId
          && row.runId === importRun.runId
          && row.reportType === reportType
          && row.status === 'matched'
          && Number(row.withinTolerance) === 1
        ));
        let status = 'MISSING';
        if (checkpoint?.state) status = String(checkpoint.state).toUpperCase();
        if (imported) status = 'IMPORTED';
        if (imported && reconciled) status = 'VERIFIED';
        return { reportType, status };
      });
      rows.push({
        accepted: dayResult?.accepted === true,
        businessDate,
        importRef: stableRef('import-run', dayResult?.importRunId),
        jobRef: stableRef('collection-job', dayResult?.jobId),
        outcome: dayResult?.outcome || 'MISSING',
        reports,
        storeAlias: aliases.get(storeId),
      });
    }
  }
  return rows;
}

function inspectContinuous(database, stores, aliases, generatedAt) {
  const dates = recentCompletedUsBusinessDates(generatedAt);
  const tables = tableSet(database);
  const required = [
    'stores',
    'lingxing_collection_jobs',
    'lingxing_collection_report_checkpoints',
    'report_import_runs',
    'report_import_file_snapshots',
    'report_import_reconciliations',
    'lingxing_report_batches',
  ];
  if (stores.length !== 2 || required.some((name) => !tables.has(name))) {
    return {
      acceptedStoreDays: 0,
      businessDates: dates,
      expectedStoreDays: 14,
      matrix: [],
      passed: false,
      status: 'BLOCKED_BY_SCHEMA_OR_STORE_SELECTION',
      violations: [{
        businessDate: null,
        code: 'CONTINUOUS_INPUT_NOT_READY',
        detail: safeViolationDetail({ code: 'CONTINUOUS_INPUT_NOT_READY' }),
        storeAlias: null,
      }],
    };
  }
  const input = {
    dateFrom: dates[0],
    dateTo: dates.at(-1),
    dates,
    generatedAt,
    stores: stores.map((store) => normalizedId(store.storeId)),
  };
  let snapshot;
  let evaluation;
  try {
    snapshot = readContinuousOperationSnapshot(database, input);
    evaluation = evaluateContinuousOperationSnapshot(snapshot, input);
  } catch {
    return {
      acceptedStoreDays: 0,
      businessDates: dates,
      expectedStoreDays: 14,
      matrix: [],
      passed: false,
      status: 'READ_ONLY_EVALUATION_FAILED',
      violations: [{
        businessDate: null,
        code: 'CONTINUOUS_READ_ONLY_EVALUATION_FAILED',
        detail: safeViolationDetail({ code: 'CONTINUOUS_READ_ONLY_EVALUATION_FAILED' }),
        storeAlias: null,
      }],
    };
  }
  const matrix = reportMatrix(snapshot, evaluation, stores, aliases, dates);
  const aliasByRawStore = new Map(
    stores.map((store) => [
      normalizedId(store.storeId),
      aliases.get(normalizedId(store.storeId)),
    ]),
  );
  const violations = evaluation.violations.map((violation) => ({
    businessDate: violation.businessDate || null,
    code: violation.code,
    detail: safeViolationDetail(violation),
    storeAlias: violation.storeId
      ? aliasByRawStore.get(normalizedId(violation.storeId)) || null
      : null,
  }));
  return {
    acceptedStoreDays: matrix.filter((row) => row.accepted).length,
    businessDates: dates,
    expectedReportsPerStoreDay: EXPECTED_REPORT_TYPES.length,
    expectedStoreDays: 14,
    matrix,
    passed: evaluation.passed === true,
    status: evaluation.passed ? 'PASSED' : 'PARTIAL',
    violations,
  };
}

function inspectToday(database, stores, aliases, generatedAt) {
  const tables = tableSet(database);
  const businessDate = businessDateInLosAngeles(generatedAt);
  if (!tables.has('lingxing_collection_jobs')
    || !tables.has('lingxing_collection_report_checkpoints')) {
    return {
      businessDate,
      tasks: stores.map((store) => ({
        gaps: ['COLLECTION_SCHEMA_MISSING'],
        reports: EXPECTED_REPORT_TYPES.map((reportType) => ({
          reportType,
          status: 'MISSING',
        })),
        state: 'NOT_AVAILABLE',
        storeAlias: aliases.get(normalizedId(store.storeId)),
      })),
    };
  }
  const tasks = stores.map((store) => {
    const jobs = database.prepare(`
      SELECT job_id AS jobId, state, blocker_code AS blockerCode,
             detail, updated_at AS updatedAt
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND business_date = ?
      ORDER BY updated_at DESC, job_id DESC
    `).all(store.storeId, businessDate);
    const job = jobs[0] || null;
    const checkpoints = job
      ? database.prepare(`
        SELECT report_type AS reportType, state, error_code AS errorCode
        FROM lingxing_collection_report_checkpoints
        WHERE store_id = ? AND job_id = ?
      `).all(store.storeId, job.jobId)
      : [];
    const reports = EXPECTED_REPORT_TYPES.map((reportType) => {
      const checkpoint = checkpoints.find((row) => row.reportType === reportType);
      return {
        errorCode: checkpoint?.errorCode || null,
        reportType,
        status: checkpoint?.state ? String(checkpoint.state).toUpperCase() : 'MISSING',
      };
    });
    const gaps = [];
    if (!job) gaps.push('COLLECTION_JOB_NOT_CREATED');
    else if (job.state !== 'completed') gaps.push('COLLECTION_JOB_NOT_COMPLETED');
    if (reports.some((report) => report.status !== 'DOWNLOADED')) {
      gaps.push('REPORT_SET_NOT_8_OF_8');
    }
    return {
      blockerCode: job?.blockerCode || null,
      gaps,
      jobRef: stableRef('collection-job', job?.jobId),
      reports,
      state: job?.state || 'missing',
      storeAlias: aliases.get(normalizedId(store.storeId)),
    };
  });
  return { businessDate, tasks };
}

function rawCanaryCandidates(database, stores, aliases, storesRoot) {
  const tables = tableSet(database);
  const required = [
    'mission_grants',
    'ad_execution_batches',
    'ad_execution_jobs',
    'analysis_proposal_snapshots',
    'verified_ad_entity_authority',
    'ad_execution_evidence',
  ];
  if (required.some((name) => !tables.has(name))) {
    return { manual_approval: [], policy_auto: [] };
  }
  const storeIds = stores.map((store) => normalizedId(store.storeId));
  if (storeIds.length === 0) return { manual_approval: [], policy_auto: [] };
  const placeholders = storeIds.map(() => '?').join(', ');
  const rows = database.prepare(`
    SELECT job.store_id AS storeId, grant.issuer_type AS issuerType,
           grant.id AS grantId, batch.id AS batchId, job.id AS jobId,
           proposal.ad_entity_authority_id AS authorityId,
           job.terminal_at AS terminalAt,
           (SELECT COUNT(*) FROM ad_execution_jobs sibling
             WHERE sibling.store_id = job.store_id
               AND sibling.batch_id = job.batch_id) AS batchJobCount,
           (SELECT COUNT(*) FROM ad_execution_evidence evidence
             WHERE evidence.store_id = job.store_id
               AND evidence.job_id = job.id) AS evidenceCount
    FROM ad_execution_jobs job
    JOIN ad_execution_batches batch
      ON batch.store_id = job.store_id AND batch.id = job.batch_id
    JOIN mission_grants grant
      ON grant.store_id = job.store_id AND grant.id = job.grant_id
    JOIN analysis_proposal_snapshots proposal
      ON proposal.store_id = job.store_id AND proposal.id = job.proposal_id
    WHERE job.store_id IN (${placeholders})
      AND job.status = 'succeeded'
      AND batch.status = 'succeeded'
      AND proposal.ad_entity_authority_id IS NOT NULL
    ORDER BY job.terminal_at DESC, job.id
  `).all(...storeIds);
  const result = { manual_approval: [], policy_auto: [] };
  for (const row of rows) {
    const mode = row.issuerType === 'human'
      ? 'manual_approval'
      : row.issuerType === 'policy'
        ? 'policy_auto'
        : null;
    if (!mode) continue;
    const artifactPaths = Object.fromEntries(['before', 'after', 'reload'].map((slot) => [
      slot,
      deterministicExecutionArtifactPath(
        storesRoot,
        normalizedId(row.storeId),
        row.batchId,
        row.jobId,
        slot,
      ),
    ]));
    const artifactsPresent = Object.values(artifactPaths).every((filePath) => (
      fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ));
    result[mode].push({
      artifactPaths,
      artifactsPresent,
      authorityId: row.authorityId,
      batchId: row.batchId,
      batchJobCount: Number(row.batchJobCount),
      evidenceCount: Number(row.evidenceCount),
      grantId: row.grantId,
      jobId: row.jobId,
      precheckPassed: Number(row.batchJobCount) === 1
        && Number(row.evidenceCount) === 3
        && artifactsPresent,
      storeAlias: aliases.get(normalizedId(row.storeId)),
      storeId: normalizedId(row.storeId),
      terminalAt: row.terminalAt,
    });
  }
  return result;
}

function publicCanaryCandidates(raw) {
  const project = (mode, rows) => ({
    candidateCount: rows.length,
    candidates: rows.map((row) => ({
      artifactsPresent: row.artifactsPresent,
      authorityRef: stableRef('authority', row.authorityId),
      batchRef: stableRef('batch', row.batchId),
      evidenceCount: row.evidenceCount,
      formalValidation: 'REQUIRED_BEFORE_EXPORT',
      grantRef: stableRef('grant', row.grantId),
      jobRef: stableRef('job', row.jobId),
      mode,
      precheckPassed: row.precheckPassed,
      storeAlias: row.storeAlias,
      terminalAt: row.terminalAt,
    })),
    precheckedCount: rows.filter((row) => row.precheckPassed).length,
  });
  return {
    manualApproval: project('manual_approval', raw.manual_approval),
    policyAuto: project('policy_auto', raw.policy_auto),
  };
}

function buildOrchestrationPlan(ledger, packageEvidence = {}) {
  const packageInputsPresent = PACKAGE_EVIDENCE_OPTIONS.every(
    (option) => Boolean(packageEvidence[option]),
  );
  const schemaReady = ledger.database.live.schema.status === 'READY';
  const storesReady = (ledger.stores.authorityStatus ?? ledger.stores.status) === 'READY';
  const operationalReady = (ledger.stores.operationalStatus?.status ?? ledger.stores.status)
    === 'READY';
  const continuousReady = ledger.continuous.passed === true;
  const manualReady = ledger.canaryCandidates.manualApproval.precheckedCount > 0;
  const policyReady = ledger.canaryCandidates.policyAuto.precheckedCount > 0;
  const readinessReady = packageInputsPresent
    && schemaReady
    && storesReady
    && operationalReady
    && continuousReady
    && manualReady
    && policyReady;
  const readinessById = {
    'authority-snapshot': schemaReady && storesReady && operationalReady,
    'continuous-operation': schemaReady && storesReady && operationalReady && continuousReady,
    'manual-canary': schemaReady && storesReady && operationalReady && continuousReady && manualReady,
    'policy-auto-canary': schemaReady && storesReady && operationalReady && continuousReady && policyReady,
    'production-readiness': readinessReady,
  };
  const prerequisites = {
    'authority-snapshot': ['schema-ready', 'two-active-us-usd-stores'],
    'continuous-operation': ['authority-snapshot', 'two-stores-x-seven-business-days-x-eight-reports'],
    'manual-canary': ['continuous-operation', 'one-formally-valid-human-authority-execution'],
    'policy-auto-canary': ['manual-canary', 'one-distinct-formally-valid-policy-authority-execution'],
    'production-readiness': ['policy-auto-canary', 'five-current-package-evidence-inputs'],
  };
  return {
    executesAds: false,
    mutatesAuthorityDatabase: false,
    sequence: EXPORT_SEQUENCE.map((id, index) => ({
      id,
      order: index + 1,
      prerequisites: prerequisites[id],
      readyForPreflight: readinessById[id],
      writesOnlyWhenExecuteExportsIsExplicit: true,
    })),
    status: readinessReady ? 'READY_FOR_FULL_PREFLIGHT' : 'PARTIAL',
  };
}

function inspectOpenedDatabase(database, options = {}, context = {}) {
  const generatedAt = (context.now ? context.now() : new Date()).toISOString();
  database.pragma('query_only = ON');
  const schema = inspectSchema(database, context.migrationContract || migrationContract());
  const stores = inspectStores(database, options.stores || [], generatedAt);
  const continuous = inspectContinuous(
    database,
    stores.rawStores,
    stores.aliases,
    generatedAt,
  );
  const today = inspectToday(
    database,
    stores.rawStores,
    stores.aliases,
    generatedAt,
  );
  for (const task of today.tasks) {
    const store = stores.items.find((item) => item.alias === task.storeAlias);
    task.gaps = [...new Set([
      ...(store?.operationalStatus.gaps || []),
      ...task.gaps,
    ])];
  }
  const storesRoot = path.resolve(options.storesRoot || path.join(
    path.dirname(options.dbPath || ROOT),
    'stores',
  ));
  const rawCandidates = rawCanaryCandidates(
    database,
    stores.rawStores,
    stores.aliases,
    storesRoot,
  );
  const publicStores = {
    activeUsUsdCount: stores.activeUsUsdCount,
    allStoreCount: stores.allStoreCount,
    authorityStatus: stores.authorityStatus,
    items: stores.items,
    operationalStatus: stores.operationalStatus,
    requiredCount: 2,
    selectedCount: stores.selectedCount,
    status: stores.status,
  };
  const ledger = {
    kind: LEDGER_KIND,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    generatedAt,
    formalEvidence: false,
    mode: options.mode || 'diagnose',
    status: schema.status === 'READY'
      && publicStores.authorityStatus === 'READY'
      && publicStores.operationalStatus.status === 'READY'
      && continuous.passed
      ? 'READY_FOR_EXPORT_PREFLIGHT'
      : 'PARTIAL_MONITORING',
    safety: {
      adsExecutionInvoked: false,
      authorityDatabaseMutated: false,
      defaultBehavior: 'READ_ONLY_DIAGNOSTIC',
      formalEvidenceClaimed: false,
    },
    database: {
      live: {
        source: pathDescriptor(options.dbPath),
        schema,
      },
      snapshot: {
        selected: false,
        status: 'NOT_SELECTED',
      },
    },
    stores: publicStores,
    continuous,
    today,
    canaryCandidates: publicCanaryCandidates(rawCandidates),
  };
  ledger.orchestration = buildOrchestrationPlan(ledger, options.packageEvidence);
  Object.defineProperty(ledger, '_internal', {
    enumerable: false,
    value: {
      rawCandidates,
      rawStoreIds: stores.rawStores.map((store) => normalizedId(store.storeId)),
      storesRoot,
    },
  });
  return ledger;
}

function makeInspectionCopy(dbPath, injectedContext = {}) {
  const baseRoot = path.resolve(
    injectedContext.tempRoot
      || path.join(os.tmpdir(), 'amazon-ai-ops-stage8-gate-operator'),
  );
  fs.mkdirSync(baseRoot, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(baseRoot, 'inspection-'));
  const destinationPath = path.join(tempRoot, 'authority-inspection.db');
  try {
    const backup = (injectedContext.runReadonlyBackup || runReadonlySqliteOnlineBackupSync)({
      sourceDatabasePath: dbPath,
      destinationPath,
      ownedTempRoot: tempRoot,
    }, injectedContext);
    return {
      backup,
      cleanup() {
        for (const candidate of [
          destinationPath,
          `${destinationPath}-wal`,
          `${destinationPath}-shm`,
        ]) {
          if (path.dirname(candidate) !== tempRoot) {
            fail('Refusing to clean an unexpected inspection database sidecar.');
          }
          if (fs.existsSync(candidate)) {
            const stat = fs.lstatSync(candidate);
            if (stat.isSymbolicLink() || !stat.isFile()) {
              fail('Inspection database cleanup encountered an unsafe sidecar.');
            }
            fs.unlinkSync(candidate);
          }
        }
        if (fs.existsSync(tempRoot)) fs.rmdirSync(tempRoot);
      },
      databasePath: destinationPath,
    };
  } catch (error) {
    if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
    if (fs.existsSync(tempRoot)) fs.rmdirSync(tempRoot);
    throw error;
  }
}

function inspectSnapshotManifest(ledger, manifestPath, context = {}) {
  try {
    const authoritySnapshot = loadAuthoritySnapshotManifest(manifestPath, {
      authoritySnapshotRoot: path.dirname(manifestPath),
      verifyPackageIdentity: false,
    });
    const Database = context.Database || requireFromLocalDb('better-sqlite3');
    const database = new Database(authoritySnapshot.databasePath, {
      fileMustExist: true,
      readonly: true,
    });
    try {
      const schema = inspectSchema(
        database,
        context.migrationContract || migrationContract(),
      );
      ledger.database.snapshot = {
        exportedAt: authoritySnapshot.manifest.exportedAt,
        schema,
        selected: true,
        source: pathDescriptor(manifestPath),
        status: schema.status,
      };
    } finally {
      database.close();
    }
  } catch {
    ledger.database.snapshot = {
      selected: true,
      source: pathDescriptor(manifestPath),
      status: 'INVALID_OR_STALE',
    };
  }
}

function diagnose(options = {}, injectedContext = {}) {
  const dbPath = resolveAdReadbackAuthorityDbPath(options.dbPath, injectedContext.env);
  const inspection = makeInspectionCopy(dbPath, injectedContext);
  const Database = injectedContext.Database || requireFromLocalDb('better-sqlite3');
  let database;
  try {
    database = new Database(inspection.databasePath, {
      fileMustExist: true,
      readonly: true,
    });
    const ledger = inspectOpenedDatabase(database, {
      dbPath,
      mode: options.mode,
      packageEvidence: options.packageEvidence,
      stores: options.stores,
      storesRoot: path.join(path.dirname(dbPath), 'stores'),
    }, injectedContext);
    ledger.database.live.onlineBackup = {
      method: 'readonly-sqlite-online-backup',
      pageCount: Number(inspection.backup?.observedBackup?.totalPages || 0),
      remainingPages: Number(inspection.backup?.observedBackup?.remainingPages || 0),
      sourceOpenedReadOnly: inspection.backup?.source?.openedReadOnly === true,
      sourceQueryOnly: inspection.backup?.source?.queryOnly === true,
    };
    if (options.snapshotManifestPath) {
      inspectSnapshotManifest(ledger, options.snapshotManifestPath, injectedContext);
    }
    ledger._internal.dbPath = dbPath;
    return ledger;
  } finally {
    if (database) database.close();
    inspection.cleanup();
  }
}

function assertSafeOutputPath(outputPath) {
  if (!path.isAbsolute(outputPath) || outputPath.includes('\0')) {
    fail('--out must be a clean absolute path.');
  }
  const resolved = path.resolve(outputPath);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    fail('--out must be a .json file.');
  }
  if (fs.existsSync(resolved)) {
    fail(`Monitoring ledger output already exists: ${resolved}`);
  }
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    fail('--out parent directory must already exist.');
  }
  const parentReal = fs.realpathSync.native(parent);
  if (path.resolve(parent).toLowerCase() !== path.resolve(parentReal).toLowerCase()) {
    fail('--out parent may not traverse a link or reparse point.');
  }
  return resolved;
}

function writeAtomicLedger(outputPath, ledger, context = {}) {
  const resolved = assertSafeOutputPath(outputPath);
  const tempPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${(
      context.randomUUID ? context.randomUUID() : crypto.randomUUID()
    )}.tmp`,
  );
  let linked = false;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    const handle = fs.openSync(tempPath, 'r+');
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.linkSync(tempPath, resolved);
    linked = true;
    fs.unlinkSync(tempPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (linked && fs.existsSync(resolved)) fs.unlinkSync(resolved);
    throw error;
  }
  return resolved;
}

function validateExecuteInputs(ledger, options, context = {}) {
  const blockers = [];
  const canonicalEvidenceRoot = path.resolve(
    context.canonicalEvidenceRoot
      || path.join(ROOT, 'output', 'codex-evidence'),
  );
  if (path.resolve(options.exportRoot || '').toLowerCase()
    !== canonicalEvidenceRoot.toLowerCase()) {
    blockers.push('EXPORT_ROOT_NOT_CANONICAL');
  }
  if (ledger.database.live.schema.status !== 'READY') {
    blockers.push('LIVE_SCHEMA_NOT_READY');
  }
  if ((ledger.stores.authorityStatus ?? ledger.stores.status) !== 'READY') {
    blockers.push('TWO_STORE_SCOPE_NOT_READY');
  }
  if ((ledger.stores.operationalStatus?.status ?? ledger.stores.status) !== 'READY') {
    blockers.push('STORE_OPERATIONAL_NOT_READY');
  }
  if (ledger.continuous.passed !== true) blockers.push('CONTINUOUS_OPERATION_NOT_PASSED');
  if (ledger.canaryCandidates.manualApproval.precheckedCount < 1) {
    blockers.push('MANUAL_CANARY_CANDIDATE_MISSING');
  }
  if (ledger.canaryCandidates.policyAuto.precheckedCount < 1) {
    blockers.push('POLICY_CANARY_CANDIDATE_MISSING');
  }
  for (const option of PACKAGE_EVIDENCE_OPTIONS) {
    const selected = options.packageEvidence[option];
    if (!selected || !fs.existsSync(selected) || !fs.statSync(selected).isFile()) {
      blockers.push(`PACKAGE_INPUT_MISSING_${option.toUpperCase().replace(/-/g, '_')}`);
    }
  }
  if (!fs.existsSync(canonicalEvidenceRoot)
    || !fs.statSync(canonicalEvidenceRoot).isDirectory()) {
    blockers.push('CANONICAL_EVIDENCE_ROOT_MISSING');
  } else {
    try {
      if (
        fs.lstatSync(canonicalEvidenceRoot).isSymbolicLink()
        || fs.realpathSync.native(canonicalEvidenceRoot).toLowerCase()
          !== canonicalEvidenceRoot.toLowerCase()
      ) {
        blockers.push('CANONICAL_EVIDENCE_ROOT_UNSAFE');
      }
      for (const childName of [
        'authority-snapshots',
        'continuous-operation',
        'execution-canaries',
      ]) {
        const child = path.join(canonicalEvidenceRoot, childName);
        if (fs.existsSync(child) && (
          fs.lstatSync(child).isSymbolicLink()
          || !fs.statSync(child).isDirectory()
          || fs.realpathSync.native(child).toLowerCase() !== child.toLowerCase()
        )) {
          blockers.push(`CANONICAL_${childName.toUpperCase().replace(/-/g, '_')}_ROOT_UNSAFE`);
        }
      }
    } catch {
      blockers.push('CANONICAL_EVIDENCE_ROOT_UNSAFE');
    }
  }
  return {
    blockers: [...new Set(blockers)],
    canonicalEvidenceRoot,
    passed: blockers.length === 0,
  };
}

function createOwnedPreflightRoot(context = {}) {
  const baseRoot = path.resolve(
    context.preflightTempRoot
      || path.join(os.tmpdir(), 'amazon-ai-ops-stage8-export-preflight'),
  );
  fs.mkdirSync(baseRoot, { recursive: true });
  const baseReal = fs.realpathSync.native(baseRoot);
  if (path.resolve(baseRoot).toLowerCase() !== path.resolve(baseReal).toLowerCase()) {
    fail('Stage 8 preflight temporary root may not traverse a link or reparse point.');
  }
  return fs.mkdtempSync(path.join(baseReal, 'preflight-'));
}

function cleanupOwnedPreflightRoot(tempRoot, context = {}) {
  const baseRoot = path.resolve(
    context.preflightTempRoot
      || path.join(os.tmpdir(), 'amazon-ai-ops-stage8-export-preflight'),
  );
  const resolved = path.resolve(tempRoot);
  const relative = path.relative(baseRoot, resolved);
  if (
    !path.basename(resolved).startsWith('preflight-')
    || relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    fail('Refusing to clean an unowned Stage 8 preflight directory.');
  }
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: false });
}

function writeTemporaryJson(tempRoot, name, value) {
  const outputPath = path.join(tempRoot, name);
  if (path.dirname(outputPath) !== path.resolve(tempRoot) || fs.existsSync(outputPath)) {
    fail('Temporary Stage 8 preflight JSON path is unsafe or already exists.');
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return outputPath;
}

function runtimeOverrides(context, authoritySnapshotRoot) {
  return {
    ...(context.Database ? { Database: context.Database } : {}),
    ...(context.appContentPath ? { appContentPath: context.appContentPath } : {}),
    ...(context.executablePath ? { executablePath: context.executablePath } : {}),
    ...(context.mainBundlePath ? { mainBundlePath: context.mainBundlePath } : {}),
    ...(context.releaseRoot ? { releaseRoot: context.releaseRoot } : {}),
    authoritySnapshotRoot,
    env: context.env || process.env,
    now: context.now || (() => new Date()),
    nowMs: (context.now ? context.now() : new Date()).getTime(),
    randomUUID: context.randomUUID || (() => crypto.randomUUID()),
  };
}

function canaryOptionsForCandidate(candidate, mode, authoritySnapshotManifestPath, outputPath) {
  return {
    artifactPaths: candidate.artifactPaths,
    authorityId: candidate.authorityId,
    authoritySnapshotManifestPath,
    batchId: candidate.batchId,
    jobId: candidate.jobId,
    missionGrantId: candidate.grantId,
    mode,
    outputPath: outputPath || null,
    storeId: candidate.storeId,
  };
}

function canonicalStoresRootForCandidate(candidate) {
  const marker = `${path.sep}${candidate.storeId}${path.sep}evidence${path.sep}ad-execution${path.sep}`;
  const before = path.resolve(candidate.artifactPaths.before);
  const index = before.toLowerCase().indexOf(marker.toLowerCase());
  if (index <= 0) fail('Canary candidate artifact path does not bind a Store Capsule root.');
  return before.slice(0, index);
}

function normalizedCanaryOptions(
  candidate,
  mode,
  authoritySnapshotManifestPath,
  outputPath,
) {
  return {
    ...canaryOptionsForCandidate(
      candidate,
      mode,
      authoritySnapshotManifestPath,
      outputPath,
    ),
    storesRoot: canonicalStoresRootForCandidate(candidate),
  };
}

function readinessArgs(input) {
  return [
    '--v15-final-readiness', input.packageEvidence['v15-final-readiness'],
    '--package-launch-smoke', input.packageEvidence['package-launch-smoke'],
    '--package-ui-manifest', input.packageEvidence['package-ui-manifest'],
    '--package-security-evidence', input.packageEvidence['package-security-evidence'],
    '--package-adversarial-node-env-evidence',
    input.packageEvidence['package-adversarial-node-env-evidence'],
    '--s7-continuous-operation-evidence', input.continuousPath,
    '--manual-canary-evidence', input.manualCanaryPath,
    '--policy-auto-canary-evidence', input.policyCanaryPath,
    '--authority-db', input.dbPath,
    '--authority-snapshot-manifest', input.authoritySnapshotManifestPath,
    '--out', input.outputPath,
  ];
}

async function deepFormalPreflight(ledger, options, context = {}) {
  let tempRoot = null;
  let outcome = null;
  try {
    tempRoot = createOwnedPreflightRoot(context);
    const {
      exportAuthoritySnapshot,
    } = require('./export-mission-control-authority-snapshot');
    const continuousVerifier = require('./verify-s7-continuous-operation');
    const {
      buildExecutionCanaryEvidence,
    } = require('./export-mission-control-execution-canary-evidence');
    const readinessVerifier = require('./verify-mission-control-production-readiness');
    const overrides = runtimeOverrides(context, tempRoot);
    const snapshotResult = await exportAuthoritySnapshot({
      dbPath: ledger._internal.dbPath,
      outputDirectory: path.join(tempRoot, 'authority-snapshot-preflight'),
    }, overrides);

    let continuousText = '';
    const dates = ledger.continuous.businessDates;
    const continuousExit = continuousVerifier.run([
      '--authority-snapshot-manifest', snapshotResult.manifestPath,
      '--store', ledger._internal.rawStoreIds[0],
      '--store', ledger._internal.rawStoreIds[1],
      '--date-from', dates[0],
      '--date-to', dates.at(-1),
    ], {
      ...overrides,
      writeStdout: (value) => {
        continuousText += value;
      },
    });
    if (continuousExit !== 0) fail('Continuous-operation formal preflight did not pass.');
    const continuousEvidence = JSON.parse(continuousText);
    const selectedCandidates = {};
    const canaryEvidence = {};
    for (const [mode, key] of [
      ['manual_approval', 'manual'],
      ['policy_auto', 'policy'],
    ]) {
      const candidates = ledger._internal.rawCandidates[mode]
        .filter((candidate) => candidate.precheckPassed);
      let selected = null;
      let evidence = null;
      for (const candidate of candidates) {
        try {
          evidence = buildExecutionCanaryEvidence(
            normalizedCanaryOptions(
              candidate,
              mode,
              snapshotResult.manifestPath,
              null,
            ),
            overrides,
          );
          selected = candidate;
          break;
        } catch {
          // Candidate rejection is intentionally reduced to a generic blocker;
          // raw IDs, paths, and provider diagnostics never enter the ledger.
        }
      }
      if (!selected || !evidence) {
        fail(`${mode} has no candidate accepted by the formal canary verifier.`);
      }
      selectedCandidates[key] = selected;
      canaryEvidence[key] = evidence;
    }
    const continuousPath = writeTemporaryJson(
      tempRoot,
      'continuous-operation-preflight.json',
      continuousEvidence,
    );
    const manualCanaryPath = writeTemporaryJson(
      tempRoot,
      'manual-canary-preflight.json',
      canaryEvidence.manual,
    );
    const policyCanaryPath = writeTemporaryJson(
      tempRoot,
      'policy-canary-preflight.json',
      canaryEvidence.policy,
    );
    const readinessOutputPath = path.join(tempRoot, 'readiness-preflight.json');
    const parsedReadiness = readinessVerifier.parseArgs(readinessArgs({
      authoritySnapshotManifestPath: snapshotResult.manifestPath,
      continuousPath,
      dbPath: ledger._internal.dbPath,
      manualCanaryPath,
      outputPath: readinessOutputPath,
      packageEvidence: options.packageEvidence,
      policyCanaryPath,
    }));
    const readinessReport = readinessVerifier.buildReport(parsedReadiness, {
      ...overrides,
      authoritySnapshotRoot: tempRoot,
    });
    if (readinessReport.appReady !== true || readinessReport.summary?.passed !== 8) {
      fail('Mission Control readiness formal preflight did not pass all eight gates.');
    }
    outcome = {
      blockers: [],
      passed: true,
      selectedCandidates,
    };
  } catch {
    outcome = {
      blockers: ['DEEP_FORMAL_PREFLIGHT_FAILED'],
      passed: false,
      selectedCandidates: null,
    };
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      try {
        cleanupOwnedPreflightRoot(tempRoot, context);
      } catch {
        outcome = {
          blockers: ['DEEP_FORMAL_PREFLIGHT_TEMP_CLEANUP_FAILED'],
          passed: false,
          selectedCandidates: null,
        };
      }
    }
  }
  return outcome;
}

function formalOutputPaths(exportRoot, context = {}) {
  const now = context.now ? context.now() : new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const nonce = String(
    context.randomUUID ? context.randomUUID() : crypto.randomUUID(),
  ).replace(/[^A-Za-z0-9-]/g, '').slice(0, 36);
  const suffix = `${stamp}-${nonce}`;
  return {
    authoritySnapshotDirectory: path.join(
      exportRoot,
      'authority-snapshots',
      `stage8-${suffix}`,
    ),
    continuousPath: path.join(
      exportRoot,
      'continuous-operation',
      `stage8-continuous-${suffix}.json`,
    ),
    manualCanaryPath: path.join(
      exportRoot,
      'execution-canaries',
      `stage8-manual-${suffix}.json`,
    ),
    policyCanaryPath: path.join(
      exportRoot,
      'execution-canaries',
      `stage8-policy-${suffix}.json`,
    ),
    readinessPath: path.join(
      exportRoot,
      `mission-control-production-readiness-stage8-${suffix}.json`,
    ),
  };
}

function ensureFormalOutputsAbsent(paths) {
  for (const candidate of Object.values(paths)) {
    if (fs.existsSync(candidate)) {
      fail('A planned Stage 8 formal output already exists; no export was started.');
    }
  }
}

function captureSynchronousStdout(callback) {
  const original = process.stdout.write;
  let captured = '';
  process.stdout.write = function patchedWrite(value, ...rest) {
    captured += String(value);
    const callbackArg = rest.find((item) => typeof item === 'function');
    if (callbackArg) callbackArg();
    return true;
  };
  try {
    return { captured, result: callback() };
  } finally {
    process.stdout.write = original;
  }
}

function inspectImmutableSnapshotStoreGate(databasePath, selectedIds, context = {}) {
  const Database = context.Database || requireFromLocalDb('better-sqlite3');
  const database = new Database(databasePath, { fileMustExist: true, readonly: true });
  try {
    database.pragma('query_only = ON');
    const generatedAt = (context.now ? context.now() : new Date()).toISOString();
    const stores = inspectStores(database, selectedIds, generatedAt);
    return {
      activeUsUsdCount: stores.activeUsUsdCount,
      authorityStatus: stores.authorityStatus,
      operationalStatus: stores.operationalStatus,
      requiredCount: 2,
      selectedCount: stores.selectedCount,
      status: stores.status,
    };
  } finally {
    database.close();
  }
}

async function executeFormalExports(ledger, options, preflight, context = {}) {
  const written = [];
  try {
    const exportAuthoritySnapshot = context.exportAuthoritySnapshot
      || require('./export-mission-control-authority-snapshot').exportAuthoritySnapshot;
    const continuousVerifier = context.continuousVerifier
      || require('./verify-s7-continuous-operation');
    const exportExecutionCanaryEvidence = context.exportExecutionCanaryEvidence
      || require('./export-mission-control-execution-canary-evidence')
        .exportExecutionCanaryEvidence;
    const readinessVerifier = context.readinessVerifier
      || require('./verify-mission-control-production-readiness');
    const paths = formalOutputPaths(options.exportRoot, context);
    ensureFormalOutputsAbsent(paths);
    const snapshot = await exportAuthoritySnapshot({
      dbPath: ledger._internal.dbPath,
      outputDirectory: paths.authoritySnapshotDirectory,
    }, runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)));
    written.push(snapshot.manifestPath, snapshot.snapshotPath);
    const formalStoreGate = inspectImmutableSnapshotStoreGate(
      snapshot.snapshotPath,
      ledger._internal.rawStoreIds,
      context,
    );
    ledger.executeExports.formalAuthorityStoreGate = formalStoreGate;
    if (
      formalStoreGate.authorityStatus !== 'READY'
      || formalStoreGate.operationalStatus.status !== 'READY'
      || formalStoreGate.status !== 'READY'
    ) {
      fail('Immutable formal authority snapshot store gate did not pass.');
    }
    fs.mkdirSync(path.dirname(paths.continuousPath), { recursive: true });
    let continuousText = '';
    const dates = ledger.continuous.businessDates;
    const continuousExit = continuousVerifier.run([
      '--authority-snapshot-manifest', snapshot.manifestPath,
      '--store', ledger._internal.rawStoreIds[0],
      '--store', ledger._internal.rawStoreIds[1],
      '--date-from', dates[0],
      '--date-to', dates.at(-1),
      '--output', paths.continuousPath,
    ], {
      ...runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)),
      continuousOperationOutputRoot: path.dirname(paths.continuousPath),
      writeStdout: (value) => {
        continuousText += value;
      },
    });
    if (continuousExit !== 0 || !fs.existsSync(paths.continuousPath)) {
      fail('Formal continuous-operation export did not pass.');
    }
    written.push(paths.continuousPath);
    fs.mkdirSync(path.dirname(paths.manualCanaryPath), { recursive: true });
    const manual = exportExecutionCanaryEvidence(
      normalizedCanaryOptions(
        preflight.selectedCandidates.manual,
        'manual_approval',
        snapshot.manifestPath,
        paths.manualCanaryPath,
      ),
      runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)),
    );
    written.push(manual.outputPath);
    const policy = exportExecutionCanaryEvidence(
      normalizedCanaryOptions(
        preflight.selectedCandidates.policy,
        'policy_auto',
        snapshot.manifestPath,
        paths.policyCanaryPath,
      ),
      runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)),
    );
    written.push(policy.outputPath);
    const formalReadinessArgs = readinessArgs({
      authoritySnapshotManifestPath: snapshot.manifestPath,
      continuousPath: paths.continuousPath,
      dbPath: ledger._internal.dbPath,
      manualCanaryPath: paths.manualCanaryPath,
      outputPath: paths.readinessPath,
      packageEvidence: options.packageEvidence,
      policyCanaryPath: paths.policyCanaryPath,
    });
    const readinessRun = captureSynchronousStdout(
      () => readinessVerifier.run(formalReadinessArgs),
    ).result;
    if (
      readinessRun.exitCode !== 0
      || readinessRun.report?.appReady !== true
      || readinessRun.report?.summary?.passed !== 8
    ) {
      fail('Final Mission Control readiness export did not pass all eight gates.');
    }
    written.push(readinessRun.outputPath);
    return {
      formalArtifacts: written.map(pathDescriptor),
      passed: true,
      status: 'COMPLETED',
    };
  } catch {
    return {
      formalArtifacts: written.map(pathDescriptor),
      passed: false,
      status: 'INTERRUPTED_FAIL_CLOSED',
    };
  }
}

function usage() {
  return [
    'Usage: node scripts/stage8-gate-operator.js [options]',
    '  [--db <absolute live amazon-ai-ops.db>]',
    '  [--snapshot-manifest <snapshot-manifest.json>]',
    '  [--store <normalized-id> --store <normalized-id>]',
    '  [--export --out <new-monitoring-ledger.json>]',
    '  [--execute-exports --export-root <output/codex-evidence> --out <new-ledger.json>',
    ...PACKAGE_EVIDENCE_OPTIONS.map((option) => `    --${option} <evidence.json>`),
    '  ]',
    '',
    'Default mode is read-only diagnosis and writes no artifact.',
    '--export writes only the non-formal atomic monitoring ledger and ordered plan.',
    '--execute-exports is separately gated and never executes Ads or migrates SQLite.',
  ].join('\n');
}

async function run(argv = process.argv.slice(2), injectedContext = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    (injectedContext.writeStdout || process.stdout.write.bind(process.stdout))(
      `${usage()}\n`,
    );
    return { exitCode: 0, ledger: null, outputPath: null };
  }
  if (parsed.errors.length > 0) fail(parsed.errors.join(' '));
  const packageEvidence = Object.fromEntries(
    PACKAGE_EVIDENCE_OPTIONS.map((option) => [option, parsed.values[option] || null]),
  );
  const ledger = (injectedContext.diagnose || diagnose)({
    dbPath: parsed.values.db,
    mode: parsed.executeExports
      ? 'execute-exports'
      : parsed.exportRequested
        ? 'export'
        : 'diagnose',
    packageEvidence,
    snapshotManifestPath: parsed.values['snapshot-manifest'],
    stores: parsed.values.stores,
  }, injectedContext);
  let exitCode = ledger.status === 'READY_FOR_EXPORT_PREFLIGHT' ? 0 : 2;
  if (parsed.executeExports) {
    // Validate the monitoring-ledger destination before any formal export can
    // begin. A bad or colliding --out therefore cannot leave a partial chain.
    assertSafeOutputPath(parsed.values.out);
    const preflight = validateExecuteInputs(ledger, {
      exportRoot: parsed.values['export-root'],
      packageEvidence,
    }, injectedContext);
    ledger.executeExports = {
      adsExecutionInvoked: false,
      authorityDatabaseMutated: false,
      blockers: preflight.blockers,
      formalArtifactsWritten: [],
      preflightPassed: preflight.passed,
      status: preflight.passed
        ? 'RUNNING_DEEP_FORMAL_PREFLIGHT'
        : 'BLOCKED_ZERO_FORMAL_ARTIFACTS',
    };
    if (preflight.passed) {
      const deepPreflight = await (injectedContext.deepFormalPreflight || deepFormalPreflight)(ledger, {
        exportRoot: parsed.values['export-root'],
        packageEvidence,
      }, injectedContext);
      ledger.executeExports.blockers = deepPreflight.blockers;
      ledger.executeExports.preflightPassed = deepPreflight.passed;
      ledger.executeExports.status = deepPreflight.passed
        ? 'FORMAL_EXPORT_RUNNING'
        : 'BLOCKED_ZERO_FORMAL_ARTIFACTS';
      if (deepPreflight.passed) {
        const exportResult = await executeFormalExports(ledger, {
          exportRoot: parsed.values['export-root'],
          packageEvidence,
        }, deepPreflight, injectedContext);
        ledger.executeExports.formalArtifactsWritten = exportResult.formalArtifacts;
        ledger.executeExports.status = exportResult.status;
        ledger.executeExports.completed = exportResult.passed;
        ledger.status = exportResult.passed
          ? 'EXPORT_CHAIN_COMPLETED'
          : 'EXPORT_CHAIN_INTERRUPTED';
        exitCode = exportResult.passed ? 0 : 1;
      } else {
        ledger.status = 'PARTIAL_MONITORING';
        exitCode = 2;
      }
    } else {
      ledger.status = 'PARTIAL_MONITORING';
      exitCode = 2;
    }
  }
  let outputPath = null;
  if (parsed.exportRequested) {
    outputPath = writeAtomicLedger(parsed.values.out, ledger, injectedContext);
  }
  const publicOutput = `${JSON.stringify(ledger, null, 2)}\n`;
  (injectedContext.writeStdout || process.stdout.write.bind(process.stdout))(publicOutput);
  return { exitCode, ledger, outputPath };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  EXPECTED_REPORT_TYPES,
  EXPORT_SEQUENCE,
  LEDGER_KIND,
  LEDGER_SCHEMA_VERSION,
  PACKAGE_EVIDENCE_OPTIONS,
  REQUIRED_TABLES,
  buildOrchestrationPlan,
  diagnose,
  inspectContinuous,
  inspectImmutableSnapshotStoreGate,
  inspectOpenedDatabase,
  inspectSchema,
  inspectStores,
  migrationContract,
  parseArgs,
  publicCanaryCandidates,
  reportMatrix,
  rawCanaryCandidates,
  run,
  stableRef,
  validateExecuteInputs,
  deepFormalPreflight,
  executeFormalExports,
  writeAtomicLedger,
};
