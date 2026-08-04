const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const {
  defaultDbCandidates,
} = require('./ad-readback-authority-db');
const {
  CURRENTNESS_METHOD,
  SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
  runReadonlySqliteOnlineBackupSync,
} = require('./sqlite-authority-currentness');
const { TARGET_VERSION } = require('./migrate-current-user-db');

const ROOT = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(
  path.join(ROOT, 'packages', 'local-db', 'package.json'),
);
const KIND = 'production-authority-selection-preflight';
const SCHEMA_VERSION = 'production-authority-selection-preflight/v1';
const TARGET_MIGRATION_VERSION = TARGET_VERSION;
const PACKAGED_APP_NAME = '@amazon-ai-ops/desktop';
const SIDECAR_SUFFIXES = Object.freeze(['-wal', '-shm', '-journal']);
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
  'report_import_metric_evidence',
  'lingxing_collection_resume_attempts',
  'lingxing_collection_resume_active_claims',
  'lingxing_collection_resume_events',
]);
const V11_STORE_PROVIDER_IDENTITY_COLUMNS = Object.freeze([
  Object.freeze({
    name: 'normalized_external_account_id',
    type: 'TEXT',
    notNull: 0,
    defaultValue: null,
    primaryKey: 0,
  }),
  Object.freeze({
    name: 'collection_store_name',
    type: 'TEXT',
    notNull: 0,
    defaultValue: null,
    primaryKey: 0,
  }),
  Object.freeze({
    name: 'normalized_collection_store_name',
    type: 'TEXT',
    notNull: 0,
    defaultValue: null,
    primaryKey: 0,
  }),
]);
const V11_STORE_PROVIDER_IDENTITY_INDEX = Object.freeze({
  name: 'idx_store_connections_provider_external_identity_unique',
  table: 'store_connections',
  unique: 1,
  partial: 1,
  columns: Object.freeze(['provider', 'normalized_external_account_id']),
  sql: `
    CREATE UNIQUE INDEX idx_store_connections_provider_external_identity_unique
    ON store_connections(provider, normalized_external_account_id)
    WHERE normalized_external_account_id IS NOT NULL
  `,
});
const V11_STORE_PROVIDER_IDENTITY_TRIGGERS = Object.freeze({
  trg_stores_v1_authority_insert: `
    CREATE TRIGGER trg_stores_v1_authority_insert
    BEFORE INSERT ON stores
    WHEN NEW.marketplace <> 'US'
      OR NEW.currency <> 'USD'
      OR NEW.business_timezone <> 'America/Los_Angeles'
    BEGIN
      SELECT RAISE(ABORT, 'store authority must remain US/USD/America/Los_Angeles');
    END
  `,
  trg_stores_v1_authority_update: `
    CREATE TRIGGER trg_stores_v1_authority_update
    BEFORE UPDATE OF marketplace, currency, business_timezone ON stores
    WHEN NEW.marketplace <> 'US'
      OR NEW.currency <> 'USD'
      OR NEW.business_timezone <> 'America/Los_Angeles'
    BEGIN
      SELECT RAISE(ABORT, 'store authority must remain US/USD/America/Los_Angeles');
    END
  `,
  trg_store_connections_external_identity_insert: `
    CREATE TRIGGER trg_store_connections_external_identity_insert
    BEFORE INSERT ON store_connections
    WHEN (NEW.external_account_id IS NULL AND NEW.normalized_external_account_id IS NOT NULL)
      OR (NEW.external_account_id IS NOT NULL AND NEW.normalized_external_account_id IS NULL)
      OR (NEW.external_account_id IS NOT NULL
        AND (
          normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id) IS NULL
          OR NEW.normalized_external_account_id <>
            normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id)))
    BEGIN
      SELECT RAISE(ABORT, 'provider external identity raw/normalized mismatch');
    END
  `,
  trg_store_connections_external_identity_update: `
    CREATE TRIGGER trg_store_connections_external_identity_update
    BEFORE UPDATE OF provider, external_account_id, normalized_external_account_id
    ON store_connections
    WHEN (NEW.external_account_id IS NULL AND NEW.normalized_external_account_id IS NOT NULL)
      OR (NEW.external_account_id IS NOT NULL AND NEW.normalized_external_account_id IS NULL)
      OR (NEW.external_account_id IS NOT NULL
        AND (
          normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id) IS NULL
          OR NEW.normalized_external_account_id <>
            normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id)))
    BEGIN
      SELECT RAISE(ABORT, 'provider external identity raw/normalized mismatch');
    END
  `,
  trg_store_connections_collection_store_name_insert: `
    CREATE TRIGGER trg_store_connections_collection_store_name_insert
    BEFORE INSERT ON store_connections
    WHEN (NEW.provider = 'amazon_ads'
        AND (NEW.collection_store_name IS NOT NULL
          OR NEW.normalized_collection_store_name IS NOT NULL))
      OR (NEW.provider = 'lingxing' AND (
        (NEW.collection_store_name IS NULL
          AND NEW.normalized_collection_store_name IS NOT NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND NEW.normalized_collection_store_name IS NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND (
            normalize_lingxing_collection_store_name(NEW.collection_store_name) IS NULL
            OR NEW.normalized_collection_store_name <>
              normalize_lingxing_collection_store_name(NEW.collection_store_name)))))
    BEGIN
      SELECT RAISE(ABORT, 'Lingxing collection store selector raw/normalized/provider mismatch');
    END
  `,
  trg_store_connections_collection_store_name_update: `
    CREATE TRIGGER trg_store_connections_collection_store_name_update
    BEFORE UPDATE OF provider, collection_store_name, normalized_collection_store_name
    ON store_connections
    WHEN (NEW.provider = 'amazon_ads'
        AND (NEW.collection_store_name IS NOT NULL
          OR NEW.normalized_collection_store_name IS NOT NULL))
      OR (NEW.provider = 'lingxing' AND (
        (NEW.collection_store_name IS NULL
          AND NEW.normalized_collection_store_name IS NOT NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND NEW.normalized_collection_store_name IS NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND (
            normalize_lingxing_collection_store_name(NEW.collection_store_name) IS NULL
            OR NEW.normalized_collection_store_name <>
              normalize_lingxing_collection_store_name(NEW.collection_store_name)))))
    BEGIN
      SELECT RAISE(ABORT, 'Lingxing collection store selector raw/normalized/provider mismatch');
    END
  `,
});
const V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS = Object.freeze([
  'stores are US/USD/America/Los_Angeles',
  'provider external identity raw/normalized values are NFKC+trim+lower paired',
  'provider external identity ownership is unique per provider',
  'Lingxing selector raw/normalized values are NFKC+trim+lower paired',
  'amazon_ads connections do not carry Lingxing selectors',
]);
const SINGLE_VALUE_OPTIONS = new Set([
  'db',
  'expected-user-data-dir',
  'expected-main-sha256',
  'out',
]);

function fail(message) {
  throw new Error(message);
}

function normalizedPath(filePath) {
  const resolved = path.resolve(filePath).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function assertCleanAbsolutePath(candidatePath, label) {
  if (
    typeof candidatePath !== 'string'
    || candidatePath !== candidatePath.trim()
    || candidatePath.length === 0
    || candidatePath.includes('\0')
    || !path.isAbsolute(candidatePath)
  ) {
    fail(`${label} must be a clean absolute path.`);
  }
  return path.resolve(candidatePath);
}

function assertExpectedSha256(value) {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    fail('--expected-main-sha256 must be exactly 64 hexadecimal characters.');
  }
  return normalized;
}

function entryExists(candidatePath) {
  try {
    fs.lstatSync(candidatePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertDirectExistingPath(candidatePath, label, expectedKind) {
  const resolved = assertCleanAbsolutePath(candidatePath, label);
  let lstat;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(`${label} does not exist: ${resolved}`);
    }
    throw error;
  }
  if (lstat.isSymbolicLink()) {
    fail(`${label} may not be a symbolic link, junction, or reparse point: ${resolved}`);
  }
  const realPath = fs.realpathSync.native(resolved);
  if (!samePath(resolved, realPath)) {
    fail(`${label} may not traverse a symbolic link, junction, or reparse point: ${resolved}`);
  }
  const stat = fs.statSync(realPath);
  if (expectedKind === 'file' && !stat.isFile()) {
    fail(`${label} must be a regular file: ${realPath}`);
  }
  if (expectedKind === 'directory' && !stat.isDirectory()) {
    fail(`${label} must be a real directory: ${realPath}`);
  }
  return { realPath, stat };
}

function assertSafeExistingAncestor(candidatePath, label) {
  let cursor = path.resolve(candidatePath);
  while (!entryExists(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      fail(`${label} has no existing filesystem ancestor: ${candidatePath}`);
    }
    cursor = parent;
  }
  return assertDirectExistingPath(cursor, `${label} ancestor`, 'directory');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex').toUpperCase();
}

function fileArtifact(filePath) {
  const { realPath, stat } = assertDirectExistingPath(
    filePath,
    'SQLite file',
    'file',
  );
  return Object.freeze({
    realPath,
    sha256: sha256File(realPath),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  });
}

function sameMainArtifact(left, right) {
  return left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.mtimeMs === right.mtimeMs;
}

function publicArtifact(artifact) {
  return {
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    mtimeMs: artifact.mtimeMs,
  };
}

function inspectSidecars(databasePath, artifactReader = fileArtifact) {
  return Object.fromEntries(SIDECAR_SUFFIXES.map((suffix) => {
    const sidecarPath = `${databasePath}${suffix}`;
    if (!entryExists(sidecarPath)) {
      return [suffix.slice(1), {
        exists: false,
        absolutePath: sidecarPath,
      }];
    }
    const artifact = artifactReader(sidecarPath);
    return [suffix.slice(1), {
      exists: true,
      absolutePath: sidecarPath,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      mtimeMs: artifact.mtimeMs,
    }];
  }));
}

function tableNames(database) {
  return new Set(database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all().map((row) => String(row.name)));
}

function canonicalSql(value) {
  const source = String(value ?? '');
  let output = '';
  let quoted = false;
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      output += character;
      if (character === "'" && source[index + 1] === "'") {
        output += source[index + 1];
        index += 1;
      } else if (character === "'") {
        quoted = false;
      }
      continue;
    }
    if (character === "'") {
      if (pendingSpace && output.length > 0) output += ' ';
      pendingSpace = false;
      quoted = true;
      output += character;
    } else if (/\s/.test(character)) {
      pendingSpace = output.length > 0;
    } else {
      if (pendingSpace && output.length > 0) output += ' ';
      pendingSpace = false;
      output += character;
    }
  }
  return output.trim().replace(/;$/, '').trimEnd();
}

function storeProviderIdentityV11SchemaContract() {
  return {
    targetVersion: 11,
    columns: V11_STORE_PROVIDER_IDENTITY_COLUMNS.map((column) => ({ ...column })),
    uniquePartialIndex: {
      name: V11_STORE_PROVIDER_IDENTITY_INDEX.name,
      table: V11_STORE_PROVIDER_IDENTITY_INDEX.table,
      unique: true,
      partial: true,
      columns: [...V11_STORE_PROVIDER_IDENTITY_INDEX.columns],
      where: 'normalized_external_account_id IS NOT NULL',
    },
    triggers: Object.keys(V11_STORE_PROVIDER_IDENTITY_TRIGGERS),
    rowInvariants: [...V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS],
  };
}

function normalizeV11Identity(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or NULL`);
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.normalize('NFKC').trim();
  if (!normalized) return null;
  if (normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} exceeds the v11 identity boundary`);
  }
  return normalized.toLowerCase();
}

function inspectStoreProviderIdentityV11Rows(database) {
  const violations = [];
  const stores = database.prepare(`
    SELECT store_id, marketplace, currency, business_timezone
    FROM stores
    WHERE marketplace <> 'US'
       OR currency <> 'USD'
       OR business_timezone <> 'America/Los_Angeles'
    ORDER BY store_id
  `).all();
  for (const row of stores) {
    violations.push(
      `store ${row.store_id} has unsupported authority ${row.marketplace}/${row.currency}/${row.business_timezone}`,
    );
  }

  const rows = database.prepare(`
    SELECT id, store_id, provider, external_account_id,
      normalized_external_account_id, collection_store_name,
      normalized_collection_store_name
    FROM store_connections
    ORDER BY provider, id
  `).all();
  const owners = new Map();
  for (const row of rows) {
    try {
      if (row.provider !== 'lingxing' && row.provider !== 'amazon_ads') {
        violations.push(`connection ${row.id} has unsupported provider ${row.provider}`);
        continue;
      }
      const expectedExternal = normalizeV11Identity(
        row.external_account_id,
        `connection ${row.id} external identity`,
      );
      const persistedExternal = row.normalized_external_account_id ?? null;
      if ((row.external_account_id === null) !== (persistedExternal === null)
        || persistedExternal !== expectedExternal) {
        violations.push(`connection ${row.id} has inconsistent raw/normalized provider identity`);
      }
      const expectedSelector = normalizeV11Identity(
        row.collection_store_name,
        `connection ${row.id} Lingxing selector`,
      );
      const persistedSelector = row.normalized_collection_store_name ?? null;
      if (row.provider === 'amazon_ads'
        && (row.collection_store_name !== null || persistedSelector !== null)) {
        violations.push(`amazon_ads connection ${row.id} carries a Lingxing selector`);
      }
      if ((row.collection_store_name === null) !== (persistedSelector === null)
        || persistedSelector !== expectedSelector) {
        violations.push(`connection ${row.id} has inconsistent raw/normalized Lingxing selector`);
      }
      if (expectedExternal !== null) {
        const key = `${row.provider}\u0000${expectedExternal}`;
        const owner = owners.get(key);
        if (owner) {
          violations.push(
            `provider identity ${row.provider}/${expectedExternal} has multiple owners ${owner.id}/${row.id}`,
          );
        } else {
          owners.set(key, row);
        }
      }
    } catch (error) {
      violations.push(error instanceof Error ? error.message : String(error));
    }
  }
  return violations;
}

function inspectStoreProviderIdentityV11Schema(database) {
  const violations = [];
  const table = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_connections'
  `).get();
  if (!table) {
    return {
      ...storeProviderIdentityV11SchemaContract(),
      passed: false,
      violations: ['store_connections table is missing'],
      rowInvariantViolations: ['row invariants could not be evaluated'],
    };
  }

  const tableColumns = database.pragma('table_info("store_connections")');
  for (const expected of V11_STORE_PROVIDER_IDENTITY_COLUMNS) {
    const actual = tableColumns.find((column) => String(column.name) === expected.name);
    if (
      !actual
      || String(actual.type ?? '').toUpperCase() !== expected.type
      || Number(actual.notnull) !== expected.notNull
      || (actual.dflt_value ?? null) !== expected.defaultValue
      || Number(actual.pk) !== expected.primaryKey
    ) {
      violations.push(`column ${expected.name} is missing or differs from the v11 contract`);
    }
  }

  const index = database.prepare(`
    SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = ?
  `).get(V11_STORE_PROVIDER_IDENTITY_INDEX.name);
  const indexList = database.pragma('index_list("store_connections")');
  const indexFlags = indexList.find(
    (candidate) => String(candidate.name) === V11_STORE_PROVIDER_IDENTITY_INDEX.name,
  );
  const indexColumns = index
    ? database.pragma(`index_xinfo("${V11_STORE_PROVIDER_IDENTITY_INDEX.name}")`)
      .filter((column) => Number(column.key) === 1)
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map((column) => String(column.name))
    : [];
  if (
    !index
    || Number(indexFlags?.unique) !== V11_STORE_PROVIDER_IDENTITY_INDEX.unique
    || Number(indexFlags?.partial) !== V11_STORE_PROVIDER_IDENTITY_INDEX.partial
    || JSON.stringify(indexColumns) !== JSON.stringify(V11_STORE_PROVIDER_IDENTITY_INDEX.columns)
    || canonicalSql(index.sql) !== canonicalSql(V11_STORE_PROVIDER_IDENTITY_INDEX.sql)
  ) {
    violations.push(`index ${V11_STORE_PROVIDER_IDENTITY_INDEX.name} is missing or differs from the v11 contract`);
  }

  for (const [name, expectedSql] of Object.entries(V11_STORE_PROVIDER_IDENTITY_TRIGGERS)) {
    const trigger = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
    `).get(name);
    if (!trigger || canonicalSql(trigger.sql) !== canonicalSql(expectedSql)) {
      violations.push(`trigger ${name} is missing or differs from the v11 contract`);
    }
  }

  let rowInvariantViolations = [];
  if (violations.some((violation) => violation.startsWith('column '))) {
    rowInvariantViolations = ['row invariants could not be evaluated against incomplete v11 columns'];
  } else {
    try {
      rowInvariantViolations = inspectStoreProviderIdentityV11Rows(database);
    } catch (error) {
      rowInvariantViolations = [error instanceof Error ? error.message : String(error)];
    }
  }
  violations.push(...rowInvariantViolations);

  return {
    ...storeProviderIdentityV11SchemaContract(),
    passed: violations.length === 0,
    violations,
    rowInvariantViolations,
  };
}

function assertStoreProviderIdentityV11Schema(database, label = 'v11 store provider identity schema') {
  const inspection = inspectStoreProviderIdentityV11Schema(database);
  if (!inspection.passed) {
    fail(`${label} is invalid: ${inspection.violations.join('; ')}`);
  }
  return inspection;
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
    .filter((name) => /^\d{4}-.*\.ts$/.test(name) && !name.endsWith('.test.ts'))
    .sort()) {
    const source = fs.readFileSync(path.join(migrationsRoot, fileName), 'utf8');
    const version = source.match(
      /export const [A-Z0-9_]+_MIGRATION_VERSION = (\d+);/,
    );
    const name = source.match(
      /export const [A-Z0-9_]+_MIGRATION_NAME\s*=\s*'([^']+)';/,
    );
    const checksums = [...source.matchAll(
      /export const (?!LEGACY_)[A-Z0-9_]+_MIGRATION_CHECKSUM\s*=\s*'([^']+)';/g,
    )];
    if (!version || !name || checksums.length !== 1) {
      fail(`Could not read the production migration contract from ${fileName}.`);
    }
    rows.push({
      version: Number(version[1]),
      name: name[1],
      checksum: checksums[0][1],
    });
  }
  rows.sort((left, right) => left.version - right.version);
  if (
    rows.length !== TARGET_MIGRATION_VERSION
    || rows.some((row, index) => row.version !== index + 1)
  ) {
    fail(`Production migration contract must contain versions 1..${TARGET_MIGRATION_VERSION}.`);
  }
  return rows;
}

function legacyV1Checksum(migrationsRoot = path.join(
  ROOT,
  'packages',
  'local-db',
  'src',
  'sqlite',
  'migrations',
)) {
  const source = fs.readFileSync(
    path.join(migrationsRoot, '0001-store-authority.ts'),
    'utf8',
  );
  const match = source.match(
    /export const LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM = '([^']+)';/,
  );
  if (!match) fail('Could not read the explicit legacy v1 migration checksum contract.');
  return match[1];
}

function migrationV1ChecksumWhitelist(contract = migrationContract()) {
  if (!Array.isArray(contract) || contract[0]?.version !== 1) {
    fail('Production migration v1 checksum policy requires a complete migration contract.');
  }
  return new Set([contract[0].checksum, legacyV1Checksum()]);
}

function migrationRowsMatchProductionContract(
  actual,
  expected = migrationContract(),
  allowedV1Checksums = migrationV1ChecksumWhitelist(expected),
) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((row, index) => (
      Number(row?.version) === expected[index].version
      && String(row?.name ?? '') === expected[index].name
      && (expected[index].version === 1
        ? allowedV1Checksums.has(String(row?.checksum ?? ''))
        : String(row?.checksum ?? '') === expected[index].checksum)
      && String(row?.status ?? '').toLowerCase() === 'applied'
    ));
}

function migrationInspection(database, tables, contract = migrationContract()) {
  if (!tables.has('schema_migrations')) {
    const presentTargetTables = REQUIRED_TABLES.filter(
      (name) => name !== 'schema_migrations' && tables.has(name),
    );
    const cleanV0 = presentTargetTables.length === 0;
    return {
      family: cleanV0
        ? 'PRE_SCHEMA_MIGRATIONS'
        : 'PARTIAL_SCHEMA_WITHOUT_MIGRATION_LEDGER',
      state: cleanV0 ? 'MIGRATION_REQUIRED' : 'RECOVERY_REQUIRED',
      tablePresent: false,
      cleanV0,
      presentTargetTables,
      columns: [],
      recordedVersions: [],
      appliedVersions: [],
      highestVersion: 0,
      highestAppliedVersion: 0,
      targetVersion: TARGET_MIGRATION_VERSION,
      targetReady: false,
    };
  }

  const columns = database.prepare('PRAGMA table_info("schema_migrations")')
    .all()
    .map((row) => String(row.name));
  if (!columns.includes('version')) {
    return {
      family: 'UNRECOGNIZED_SCHEMA_MIGRATIONS',
      state: 'RECOVERY_REQUIRED',
      tablePresent: true,
      columns,
      recordedVersions: [],
      appliedVersions: [],
      highestVersion: null,
      highestAppliedVersion: null,
      targetVersion: TARGET_MIGRATION_VERSION,
      targetReady: false,
    };
  }

  const hasStatus = columns.includes('status');
  const hasName = columns.includes('name');
  const hasChecksum = columns.includes('checksum');
  const fields = [
    'version',
    hasName ? 'name' : 'NULL AS name',
    hasChecksum ? 'checksum' : 'NULL AS checksum',
    hasStatus ? 'status' : 'NULL AS status',
  ];
  const rows = database.prepare(
    `SELECT ${fields.join(', ')} FROM schema_migrations ORDER BY version`,
  ).all();
  const normalizedRows = rows.map((row) => ({
    version: Number(row.version),
    name: hasName ? String(row.name ?? '') : null,
    checksum: hasChecksum ? String(row.checksum ?? '') : null,
    status: hasStatus ? String(row.status ?? '').toLowerCase() : null,
  }));
  const invalidVersionCount = normalizedRows.filter(
    (row) => !Number.isInteger(row.version) || row.version < 1,
  ).length;
  if (invalidVersionCount > 0) {
    return {
      family: 'UNRECOGNIZED_SCHEMA_MIGRATIONS',
      state: 'RECOVERY_REQUIRED',
      tablePresent: true,
      columns,
      recordedVersions: [],
      appliedVersions: [],
      highestVersion: null,
      highestAppliedVersion: null,
      invalidVersionCount,
      targetVersion: TARGET_MIGRATION_VERSION,
      targetReady: false,
    };
  }
  const recordedVersions = [...new Set(normalizedRows.map((row) => row.version))]
    .sort((left, right) => left - right);
  const appliedVersions = hasStatus
    ? [...new Set(normalizedRows
      .filter((row) => row.status === 'applied')
      .map((row) => row.version))]
      .sort((left, right) => left - right)
    : [];
  const currentColumns = ['version', 'name', 'checksum', 'status', 'result_json', 'manifest_json'];
  const family = hasStatus && currentColumns.every((column) => columns.includes(column))
    ? 'S7_SCHEMA_MIGRATIONS'
    : 'LEGACY_SCHEMA_MIGRATIONS';
  const rowsByVersion = new Map(normalizedRows.map((row) => [row.version, row]));
  const duplicateVersions = normalizedRows.length !== rowsByVersion.size;
  const allowedV1Checksums = migrationV1ChecksumWhitelist(contract);
  const migrations = contract.map((expected) => {
    const actual = rowsByVersion.get(expected.version);
    const status = actual
      && actual.status === 'applied'
      && actual.name === expected.name
      && (expected.version === 1
        ? allowedV1Checksums.has(actual.checksum)
        : actual.checksum === expected.checksum)
      ? 'APPLIED'
      : actual
        ? 'MISMATCH'
        : 'MISSING';
    return { version: expected.version, status };
  });
  const extraVersions = recordedVersions.filter(
    (version) => !contract.some((expected) => expected.version === version),
  );
  const ledgerTargetReady = !duplicateVersions
    && extraVersions.length === 0
    && migrations.every((row) => row.status === 'APPLIED');
  const v11Schema = ledgerTargetReady
    ? inspectStoreProviderIdentityV11Schema(database)
    : null;
  const targetReady = ledgerTargetReady && v11Schema?.passed === true;

  return {
    family,
    state: targetReady ? 'READY' : 'RECOVERY_REQUIRED',
    tablePresent: true,
    columns,
    recordedVersions,
    appliedVersions,
    highestVersion: recordedVersions.at(-1) ?? 0,
    highestAppliedVersion: appliedVersions.at(-1) ?? 0,
    targetVersion: TARGET_MIGRATION_VERSION,
    targetReady,
    duplicateVersions,
    extraVersions,
    migrations,
    ledgerTargetReady,
    v11Schema,
  };
}

function storeInspection(database, tables) {
  if (!tables.has('stores')) {
    return {
      tablePresent: false,
      allStoreCount: 0,
      activeUsUsdCount: 0,
      distinctBrowserProfileCount: 0,
      configuredForTwoStoreProduction: false,
      state: 'NOT_AVAILABLE',
    };
  }
  const columns = database.prepare('PRAGMA table_info("stores")')
    .all()
    .map((row) => String(row.name));
  const required = [
    'store_id',
    'browser_profile_id',
    'marketplace',
    'currency',
    'status',
    'business_timezone',
  ];
  const missingColumns = required.filter((column) => !columns.includes(column));
  if (missingColumns.length > 0) {
    return {
      tablePresent: true,
      columns,
      missingColumns,
      allStoreCount: null,
      activeUsUsdCount: null,
      distinctBrowserProfileCount: null,
      configuredForTwoStoreProduction: false,
      state: 'MALFORMED',
    };
  }
  const counts = database.prepare(`
    SELECT
      COUNT(*) AS allStoreCount,
      SUM(
        CASE
          WHEN status = 'active' AND marketplace = 'US' AND currency = 'USD'
          THEN 1 ELSE 0
        END
      ) AS activeUsUsdCount,
      COUNT(
        DISTINCT CASE
          WHEN status = 'active' AND marketplace = 'US' AND currency = 'USD'
          THEN browser_profile_id ELSE NULL
        END
      ) AS distinctBrowserProfileCount,
      SUM(
        CASE
          WHEN status = 'active'
            AND marketplace = 'US'
            AND currency = 'USD'
            AND business_timezone = 'America/Los_Angeles'
          THEN 1 ELSE 0
        END
      ) AS losAngelesStoreCount
    FROM stores
  `).get();
  const allStoreCount = Number(counts.allStoreCount ?? 0);
  const activeUsUsdCount = Number(counts.activeUsUsdCount ?? 0);
  const distinctBrowserProfileCount = Number(counts.distinctBrowserProfileCount ?? 0);
  const losAngelesStoreCount = Number(counts.losAngelesStoreCount ?? 0);
  return {
    tablePresent: true,
    columns,
    missingColumns: [],
    allStoreCount,
    activeUsUsdCount,
    distinctBrowserProfileCount,
    configuredForTwoStoreProduction: activeUsUsdCount === 2
      && distinctBrowserProfileCount === 2
      && losAngelesStoreCount === 2,
    state: 'INSPECTED',
  };
}

function sqliteInspection(databasePath, context, options = {}) {
  const Database = context.Database;
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma('query_only = ON');
    const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1;
    if (!queryOnly) {
      fail(`SQLite candidate did not enter query_only mode: ${databasePath}`);
    }
    const integrityRows = database.pragma('integrity_check')
      .map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
    const foreignKeyRows = database.pragma('foreign_key_check');
    const tables = tableNames(database);
    const migration = migrationInspection(database, tables, context.migrationContract);
    const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
    const stores = options.includeStores ? storeInspection(database, tables) : null;
    const integrity = integrityRows.length === 1 && integrityRows[0] === 'ok'
      ? 'ok'
      : 'failed';
    let state = migration.state;
    if (
      integrity !== 'ok'
      || foreignKeyRows.length > 0
      || (migration.tablePresent && missingTables.length > 0)
      || stores?.state === 'MALFORMED'
    ) {
      state = 'RECOVERY_REQUIRED';
    }
    return {
      openedReadOnly: true,
      queryOnly: true,
      integrity,
      integrityCheck: integrityRows,
      foreignKeyViolationCount: foreignKeyRows.length,
      migration,
      missingTables,
      stores,
      state,
    };
  } finally {
    database.close();
  }
}

function inspectCandidate(candidatePath, role, context) {
  const artifactReader = context.fileArtifact;
  const direct = assertDirectExistingPath(
    candidatePath,
    role === 'selected' ? 'Selected authority database' : 'Non-authority database candidate',
    'file',
  );
  if (role === 'selected' && direct.stat.nlink !== 1) {
    fail(`Selected authority database must have exactly one hard link: ${direct.realPath}`);
  }
  const before = artifactReader(direct.realPath);
  const sidecarsBefore = inspectSidecars(direct.realPath, artifactReader);
  const logicalCapture = captureLogicalState(
    direct.realPath,
    context,
    role === 'selected',
  );
  const sidecarsAfter = inspectSidecars(direct.realPath, artifactReader);
  const after = artifactReader(direct.realPath);
  if (!sameMainArtifact(before, after)) {
    fail(`SQLite candidate main file changed during read-only inspection: ${direct.realPath}`);
  }
  for (const sidecarName of ['wal', 'journal']) {
    if (JSON.stringify(sidecarsBefore[sidecarName]) !== JSON.stringify(sidecarsAfter[sidecarName])) {
      fail(
        `SQLite candidate ${sidecarName} sidecar changed during read-only inspection: ${direct.realPath}`,
      );
    }
  }
  if (sidecarsBefore.shm.exists && !sidecarsAfter.shm.exists) {
    fail(`SQLite candidate SHM sidecar disappeared during read-only inspection: ${direct.realPath}`);
  }
  return {
    role,
    absolutePath: path.resolve(candidatePath),
    realPath: direct.realPath,
    mainFile: publicArtifact(after),
    sidecars: sidecarsAfter,
    sidecarsBefore,
    sidecarObservation: {
      walAndJournalUnchanged: true,
      shmUnchanged: JSON.stringify(sidecarsBefore.shm) === JSON.stringify(sidecarsAfter.shm),
      shmMayChangeForReadonlyWalLocking: true,
    },
    sqlite: logicalCapture.sqlite,
    logicalCapture: logicalCapture.proof,
  };
}

function createCaptureRoot(context) {
  const randomUUID = context.randomUUID;
  const nonce = String(randomUUID()).replace(/[^A-Za-z0-9-]/g, '');
  if (!nonce) fail('Authority selection randomUUID returned an invalid value.');

  if (context.tempRoot) {
    const base = assertDirectExistingPath(
      assertCleanAbsolutePath(context.tempRoot, 'Injected temporary root'),
      'Injected temporary root',
      'directory',
    );
    const captureRoot = path.join(base.realPath, `authority-selection-${nonce}`);
    fs.mkdirSync(captureRoot, { recursive: false });
    return {
      captureRoot,
      ownedBaseRoot: null,
    };
  }

  const osTemp = assertDirectExistingPath(
    path.resolve(os.tmpdir()),
    'Operating-system temporary root',
    'directory',
  );
  const ownedBaseRoot = fs.mkdtempSync(
    path.join(osTemp.realPath, 'amazon-ai-ops-authority-selection-'),
  );
  const captureRoot = path.join(ownedBaseRoot, `capture-${nonce}`);
  fs.mkdirSync(captureRoot, { recursive: false });
  return { captureRoot, ownedBaseRoot };
}

function removeOwnedFile(filePath, parentPath, label) {
  if (!entryExists(filePath)) return;
  if (!samePath(path.dirname(filePath), parentPath)) {
    fail(`Refusing to clean ${label} outside its owned directory.`);
  }
  const direct = assertDirectExistingPath(filePath, label, 'file');
  fs.unlinkSync(direct.realPath);
}

function cleanupCaptureRoot(captureRoot, ownedBaseRoot) {
  for (const fileName of [
    'authority-logical-capture.db',
    'authority-logical-capture.db-wal',
    'authority-logical-capture.db-shm',
    'authority-logical-capture.db-journal',
  ]) {
    removeOwnedFile(path.join(captureRoot, fileName), captureRoot, 'Authority capture artifact');
  }
  if (entryExists(captureRoot)) {
    const entries = fs.readdirSync(captureRoot);
    if (entries.length !== 0) {
      fail(`Authority capture cleanup found unexpected entries: ${entries.join(', ')}`);
    }
    fs.rmdirSync(captureRoot);
  }
  if (ownedBaseRoot && entryExists(ownedBaseRoot)) {
    const entries = fs.readdirSync(ownedBaseRoot);
    if (entries.length !== 0) {
      fail(`Authority selection temporary root was not empty: ${ownedBaseRoot}`);
    }
    fs.rmdirSync(ownedBaseRoot);
  }
}

function captureLogicalState(databasePath, context, includeStores) {
  const { captureRoot, ownedBaseRoot } = createCaptureRoot(context);
  const destinationPath = path.join(captureRoot, 'authority-logical-capture.db');
  try {
    const backup = context.runReadonlyBackup({
      sourceDatabasePath: databasePath,
      destinationPath,
      ownedTempRoot: captureRoot,
    }, context);
    if (
      backup?.schemaVersion !== SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
      || backup?.method !== CURRENTNESS_METHOD
      || backup?.source?.openedReadOnly !== true
      || backup?.source?.queryOnly !== true
      || !Number.isInteger(backup?.observedBackup?.totalPages)
      || backup.observedBackup.totalPages <= 0
      || backup?.observedBackup?.remainingPages !== 0
    ) {
      fail('WAL-aware authority currentness capture returned an invalid proof.');
    }
    const captured = context.fileArtifact(destinationPath);
    if (
      captured.sha256 !== String(backup.observedBackup.sha256).toUpperCase()
      || captured.sizeBytes !== backup.observedBackup.sizeBytes
    ) {
      fail('WAL-aware authority currentness capture artifact does not match its proof.');
    }
    const capturedSqlite = sqliteInspection(destinationPath, context, { includeStores });
    return {
      proof: {
        schemaVersion: backup.schemaVersion,
        method: backup.method,
        source: {
          openedReadOnly: true,
          queryOnly: true,
        },
        logicalBackupSha256: captured.sha256,
        logicalBackupSizeBytes: captured.sizeBytes,
        totalPages: backup.observedBackup.totalPages,
        remainingPages: backup.observedBackup.remainingPages,
      },
      sqlite: capturedSqlite,
    };
  } finally {
    cleanupCaptureRoot(captureRoot, ownedBaseRoot);
  }
}

function defaultContext(injectedContext = {}) {
  return {
    Database: requireFromLocalDb('better-sqlite3'),
    env: process.env,
    fileArtifact,
    migrationContract: migrationContract(),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
    runReadonlyBackup: runReadonlySqliteOnlineBackupSync,
    tempRoot: null,
    writeStdout: process.stdout.write.bind(process.stdout),
    ...injectedContext,
  };
}

function validateContext(context) {
  for (const [label, value] of [
    ['Database', context.Database],
    ['fileArtifact', context.fileArtifact],
    ['now', context.now],
    ['randomUUID', context.randomUUID],
    ['runReadonlyBackup', context.runReadonlyBackup],
    ['writeStdout', context.writeStdout],
  ]) {
    if (typeof value !== 'function') fail(`Authority selection ${label} dependency is invalid.`);
  }
  if (!Array.isArray(context.migrationContract)) {
    fail('Authority selection migrationContract dependency is invalid.');
  }
  if (!context.env || typeof context.env !== 'object') {
    fail('Authority selection environment dependency is invalid.');
  }
}

function inspectProductionAuthoritySelection(options = {}, injectedContext = {}) {
  const context = defaultContext(injectedContext);
  validateContext(context);
  const selectedInput = assertCleanAbsolutePath(options.dbPath, '--db');
  const expectedUserDataInput = assertCleanAbsolutePath(
    options.expectedUserDataDir,
    '--expected-user-data-dir',
  );
  const expectedSha256 = assertExpectedSha256(options.expectedMainSha256);
  const userData = assertDirectExistingPath(
    expectedUserDataInput,
    'Expected Electron userData directory',
    'directory',
  );
  const appDataRoot = assertDirectExistingPath(
    assertCleanAbsolutePath(context.env.APPDATA, 'APPDATA'),
    'APPDATA directory',
    'directory',
  );
  const packagedUserDataPath = path.join(
    appDataRoot.realPath,
    ...PACKAGED_APP_NAME.split('/'),
  );
  if (!samePath(userData.realPath, packagedUserDataPath)) {
    fail(
      `Expected Electron userData must resolve exactly to the packaged ${PACKAGED_APP_NAME} path: `
      + packagedUserDataPath,
    );
  }
  const expectedDatabasePath = path.join(userData.realPath, 'amazon-ai-ops.db');
  const storesRoot = path.join(userData.realPath, 'stores');
  if (entryExists(storesRoot)) {
    assertDirectExistingPath(storesRoot, 'Derived stores root', 'directory');
  }

  const selected = assertDirectExistingPath(
    selectedInput,
    'Selected authority database',
    'file',
  );
  if (selected.stat.nlink !== 1) {
    fail(`Selected authority database must have exactly one hard link: ${selected.realPath}`);
  }
  if (!samePath(selected.realPath, expectedDatabasePath)) {
    fail(
      `Selected authority database must resolve exactly to ${expectedDatabasePath}.`,
    );
  }

  const candidates = defaultDbCandidates(context.env)
    .map((candidate) => path.resolve(candidate));
  const selectedCandidateMatches = candidates.filter(
    (candidate) => samePath(candidate, selectedInput),
  );
  if (selectedCandidateMatches.length !== 1) {
    fail('Selected authority database must be exactly one default AppData candidate.');
  }
  const existingCandidates = candidates.filter(entryExists);
  const selectedExistingMatches = existingCandidates.filter(
    (candidate) => samePath(candidate, selectedInput),
  );
  if (selectedExistingMatches.length !== 1) {
    fail('Authority selection must resolve to exactly one existing selected candidate.');
  }

  const selectedBefore = context.fileArtifact(selected.realPath);
  if (selectedBefore.sha256 !== expectedSha256) {
    fail(
      `Selected authority main SHA-256 mismatch: expected ${expectedSha256}, `
      + `observed ${selectedBefore.sha256}.`,
    );
  }

  const inspectedCandidates = existingCandidates.map((candidate) => inspectCandidate(
    candidate,
    samePath(candidate, selectedInput) ? 'selected' : 'non-authority',
    context,
  ));
  const selectedRows = inspectedCandidates.filter((candidate) => candidate.role === 'selected');
  if (selectedRows.length !== 1) {
    fail('Authority candidate inventory did not contain exactly one selected database.');
  }

  const selectedAfter = context.fileArtifact(selected.realPath);
  if (!sameMainArtifact(selectedBefore, selectedAfter)) {
    fail('Selected authority main file changed during WAL-aware read-only preflight.');
  }
  if (selectedAfter.sha256 !== expectedSha256) {
    fail('Selected authority main SHA-256 drifted during read-only preflight.');
  }

  const selectedInspection = selectedRows[0];
  const status = selectedInspection.sqlite.state === 'READY'
    ? 'SELECTED_SCHEMA_READY'
    : selectedInspection.sqlite.state === 'MIGRATION_REQUIRED'
      ? 'SELECTED_MIGRATION_REQUIRED'
      : 'SELECTED_RECOVERY_REQUIRED';
  const generatedAt = context.now();
  if (!(generatedAt instanceof Date) || !Number.isFinite(generatedAt.valueOf())) {
    fail('Authority selection clock returned an invalid date.');
  }

  return {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    status,
    formalEvidence: false,
    authorityDatabaseMutated: false,
    adsExecutionInvoked: false,
    selection: {
      expectedUserDataDir: userData.realPath,
      expectedDatabasePath,
      storesRoot,
      storesRootExists: entryExists(storesRoot),
      expectedMainSha256: expectedSha256,
      defaultCandidateCount: candidates.length,
      existingCandidateCount: inspectedCandidates.length,
      selected: {
        ...selectedInspection,
        mainFileSha256: selectedInspection.mainFile.sha256,
        logicalBackupSha256: selectedInspection.logicalCapture.logicalBackupSha256,
        offlineMigrationEligible: selectedInspection.sqlite.state === 'MIGRATION_REQUIRED'
          && !Object.values(selectedInspection.sidecars).some((sidecar) => sidecar.exists),
      },
      nonAuthority: inspectedCandidates.filter(
        (candidate) => candidate.role === 'non-authority',
      ),
    },
  };
}

function parseArgs(argv) {
  const values = {};
  let exportRequested = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token === '--export') {
      if (exportRequested) fail('Duplicate argument: --export.');
      exportRequested = true;
      continue;
    }
    if (!token.startsWith('--')) fail(`Unexpected positional argument: ${token}`);
    const name = token.slice(2);
    if (!SINGLE_VALUE_OPTIONS.has(name)) fail(`Unknown argument: --${name}.`);
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      fail(`Duplicate argument: --${name}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`--${name} requires a value.`);
    }
    values[name] = value;
    index += 1;
  }
  if (!help) {
    for (const required of ['db', 'expected-user-data-dir', 'expected-main-sha256']) {
      if (!values[required]) fail(`--${required} is required.`);
    }
    if (exportRequested && !values.out) {
      fail('--export requires --out <absolute non-existing json>.');
    }
    if (!exportRequested && values.out) {
      fail('--out is only valid together with --export.');
    }
  }
  return { exportRequested, help, values };
}

function assertSafeOutputPath(outputPath) {
  const resolved = assertCleanAbsolutePath(outputPath, '--out');
  if (path.extname(resolved).toLowerCase() !== '.json') {
    fail('--out must name a .json file.');
  }
  const parent = path.dirname(resolved);
  assertDirectExistingPath(parent, 'Authority selection output parent', 'directory');
  if (entryExists(resolved)) {
    fail(`Authority selection output already exists and will not be overwritten: ${resolved}`);
  }
  return resolved;
}

function writeJsonAtomicExclusive(outputPath, value, context) {
  const resolved = assertSafeOutputPath(outputPath);
  const parent = path.dirname(resolved);
  const nonce = String(context.randomUUID()).replace(/[^A-Za-z0-9-]/g, '');
  if (!nonce) fail('Authority selection randomUUID returned an invalid value.');
  const temporaryPath = path.join(parent, `.tmp-${path.basename(resolved)}-${nonce}`);
  if (entryExists(temporaryPath)) {
    fail(`Authority selection temporary output already exists: ${temporaryPath}`);
  }
  let handle = null;
  try {
    handle = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.linkSync(temporaryPath, resolved);
    fs.unlinkSync(temporaryPath);
    return resolved;
  } catch (error) {
    if (handle !== null) fs.closeSync(handle);
    if (entryExists(temporaryPath)) {
      const direct = assertDirectExistingPath(
        temporaryPath,
        'Authority selection temporary output',
        'file',
      );
      fs.unlinkSync(direct.realPath);
    }
    throw error;
  }
}

function usage() {
  return [
    'Usage: node scripts/verify-production-authority-selection.js',
    '  --db <absolute amazon-ai-ops.db>',
    '  --expected-user-data-dir <absolute Electron userData>',
    '  --expected-main-sha256 <64hex>',
    '  [--export --out <absolute new .json>]',
    '',
    'Default mode is strictly read-only and writes no evidence file.',
    '--export writes one non-formal monitoring preflight with exclusive atomic creation.',
    'This command never reads business rows from non-authority candidates and never executes Ads.',
  ].join('\n');
}

async function run(argv = process.argv.slice(2), injectedContext = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    const writeStdout = injectedContext.writeStdout
      ?? process.stdout.write.bind(process.stdout);
    if (typeof writeStdout !== 'function') {
      fail('Authority selection writeStdout dependency is invalid.');
    }
    writeStdout(`${usage()}\n`);
    return { exitCode: 0, evidence: null, outputPath: null };
  }
  const context = defaultContext(injectedContext);
  validateContext(context);
  const evidence = inspectProductionAuthoritySelection({
    dbPath: parsed.values.db,
    expectedUserDataDir: parsed.values['expected-user-data-dir'],
    expectedMainSha256: parsed.values['expected-main-sha256'],
  }, context);
  const outputPath = parsed.exportRequested
    ? writeJsonAtomicExclusive(parsed.values.out, evidence, context)
    : null;
  context.writeStdout(`${JSON.stringify(evidence, null, 2)}\n`);
  return { exitCode: 0, evidence, outputPath };
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
  KIND,
  PACKAGED_APP_NAME,
  SCHEMA_VERSION,
  TARGET_MIGRATION_VERSION,
  REQUIRED_TABLES,
  V11_STORE_PROVIDER_IDENTITY_COLUMNS,
  V11_STORE_PROVIDER_IDENTITY_INDEX,
  V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS,
  V11_STORE_PROVIDER_IDENTITY_TRIGGERS,
  assertStoreProviderIdentityV11Schema,
  assertSafeOutputPath,
  inspectStoreProviderIdentityV11Schema,
  inspectProductionAuthoritySelection,
  legacyV1Checksum,
  migrationContract,
  migrationInspection,
  migrationRowsMatchProductionContract,
  migrationV1ChecksumWhitelist,
  parseArgs,
  run,
  storeProviderIdentityV11SchemaContract,
  usage,
  writeJsonAtomicExclusive,
};
