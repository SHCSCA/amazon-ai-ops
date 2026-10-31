// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { getMigrationPlan } = require('./migration-contract-source');


const ROOT = path.resolve(__dirname, '..');

const requireFromLocalDb = createRequire(path.join(ROOT, 'packages', 'local-db', 'package.json'));

const KIND = 'production-authority-selection-preflight';

const SCHEMA_VERSION = 'production-authority-selection-preflight/v1';

function getTargetMigrationVersion() { return getMigrationPlan().targetVersion; }

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
    if (typeof candidatePath !== 'string'
        || candidatePath !== candidatePath.trim()
        || candidatePath.length === 0
        || candidatePath.includes('\0')
        || !path.isAbsolute(candidatePath)) {
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
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return false;
        throw error;
    }
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
            }
            else if (character === "'") {
                quoted = false;
            }
            continue;
        }
        if (character === "'") {
            if (pendingSpace && output.length > 0)
                output += ' ';
            pendingSpace = false;
            quoted = true;
            output += character;
        }
        else if (/\s/.test(character)) {
            pendingSpace = output.length > 0;
        }
        else {
            if (pendingSpace && output.length > 0)
                output += ' ';
            pendingSpace = false;
            output += character;
        }
    }
    return output.trim().replace(/;$/, '').trimEnd();
}

module.exports = { fail, normalizedPath, samePath, assertCleanAbsolutePath, assertExpectedSha256, entryExists, canonicalSql, ROOT, requireFromLocalDb, KIND, SCHEMA_VERSION, getTargetMigrationVersion, PACKAGED_APP_NAME, SIDECAR_SUFFIXES, REQUIRED_TABLES, V11_STORE_PROVIDER_IDENTITY_COLUMNS, V11_STORE_PROVIDER_IDENTITY_INDEX, V11_STORE_PROVIDER_IDENTITY_TRIGGERS, V11_STORE_PROVIDER_IDENTITY_ROW_INVARIANTS, SINGLE_VALUE_OPTIONS };

Object.defineProperty(module.exports, 'TARGET_MIGRATION_VERSION', { enumerable: true, get: getTargetMigrationVersion });
