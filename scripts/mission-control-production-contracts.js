// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');


const ROOT = path.resolve(__dirname, '..');

const requireFromLocalDb = createRequire(path.join(ROOT, 'packages', 'local-db', 'package.json'));

const OUTPUT_KIND = 'mission-control-production-readiness';

const OUTPUT_SCHEMA_VERSION = 'mission-control-production-readiness/v1';

const EXECUTION_CANARY_KIND = 'mission-control-execution-canary-evidence';

const EXECUTION_CANARY_SCHEMA_VERSION = 'mission-control-execution-canary-evidence/v2';

const EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT = 'mission-control-execution-canary-authority/v2';

const S7_CONTINUOUS_OPERATION_KIND = 's7-continuous-operation-evidence';

const S7_CONTINUOUS_OPERATION_SCHEMA_VERSION = 's7-continuous-operation-evidence/v1';

const V15_GATE_IDS = Object.freeze([
    'report-collection-delivery',
    'lingxing-listing-full-read',
    'ai-live-provider',
    'ad-recommendation-ai-explanation',
    'listing-ai-draft',
    'real-ad-execution-readback',
    'release-package-hash',
    'package-launch-smoke',
]);

const PACKAGE_IDENTITY_FIELDS = Object.freeze([
    'executableSha256',
    'appContentSha256',
    'mainBundleSha256',
]);

const V15_SUPERSEDED_GATE_ID = 'real-ad-execution-readback';

const V15_SUPERSEDING_GATE_IDS = Object.freeze(['manual-canary', 'policy-auto-canary']);

const AUTHORITY_SNAPSHOT_KIND = 'mission-control-authority-database-snapshot';

const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 'mission-control-authority-database-snapshot/v2';

const AUTHORITY_SNAPSHOT_BACKUP_METHOD = 'sqlite-online-backup';

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const MAX_PACKAGE_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_CONTINUOUS_EVIDENCE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const MAX_CANARY_EVIDENCE_AGE_MS = 72 * 60 * 60 * 1000;

const AUTHORITY_SNAPSHOT_DEPENDENT_GATE_IDS = Object.freeze([
    's7-continuous-operation',
    'manual-canary',
    'policy-auto-canary',
]);

const GATE_SPECS = Object.freeze([
    Object.freeze({
        id: 'v15-final-readiness',
        name: 'Current v1.5 legacy readiness baseline',
        option: 'v15-final-readiness',
    }),
    Object.freeze({ id: 'package-launch', name: 'Current package launch', option: 'package-launch-smoke' }),
    Object.freeze({ id: 'package-ui', name: 'Package UI six-module 22-entry 100%/125%', option: 'package-ui-manifest' }),
    Object.freeze({ id: 'package-security', name: 'Package security boundaries', option: 'package-security-evidence' }),
    Object.freeze({ id: 'package-adversarial-node-env', name: 'Adversarial NODE_ENV package smoke', option: 'package-adversarial-node-env-evidence' }),
    Object.freeze({ id: 's7-continuous-operation', name: 'Stage 7 two-store seven-US-business-day operation', option: 's7-continuous-operation-evidence' }),
    Object.freeze({ id: 'manual-canary', name: 'Real manual-approval canary', option: 'manual-canary-evidence' }),
    Object.freeze({ id: 'policy-auto-canary', name: 'Real policy-auto canary', option: 'policy-auto-canary-evidence' }),
]);

const OPTION_ALIASES = Object.freeze({
    'final-readiness': 'v15-final-readiness',
    'continuous-operation-evidence': 's7-continuous-operation-evidence',
    'manual-canary': 'manual-canary-evidence',
    'policy-canary-evidence': 'policy-auto-canary-evidence',
    'policy-canary': 'policy-auto-canary-evidence',
    output: 'out',
});

const ALLOWED_OPTIONS = new Set([
    ...GATE_SPECS.map((spec) => spec.option),
    'authority-db',
    'authority-snapshot-manifest',
    'out',
]);

function defaultProductionContext(explicitAuthorityDbPath = null) {
    const releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release');
    let authorityDbPath = null;
    let authorityDbError = null;
    try {
        if (!nonEmpty(explicitAuthorityDbPath)) {
            throw new Error('Missing required argument: --authority-db must explicitly select one live database.');
        }
        const { resolveAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
        authorityDbPath = resolveAdReadbackAuthorityDbPath(explicitAuthorityDbPath, {});
        if (explicitAuthorityDbPath) {
            const selectedPath = path.resolve(explicitAuthorityDbPath);
            const selectedStat = fs.statSync(selectedPath);
            if (!path.isAbsolute(explicitAuthorityDbPath)
                || !requestedPathEqualsRealpath(selectedPath)
                || !samePath(selectedPath, authorityDbPath)
                || fs.lstatSync(selectedPath).isSymbolicLink()
                || !selectedStat.isFile()
                || selectedStat.nlink !== 1) {
                throw new Error('--authority-db must resolve directly to one unique regular live database file.');
            }
        }
    }
    catch (error) {
        authorityDbPath = null;
        authorityDbError = error instanceof Error ? error.message : String(error);
    }
    return {
        nowMs: Date.now(),
        releaseRoot,
        executablePath: path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe'),
        appContentPath: path.join(releaseRoot, 'win-unpacked', 'resources', 'app'),
        mainBundlePath: path.join(releaseRoot, 'win-unpacked', 'resources', 'app', 'dist', 'main', 'index.js'),
        authorityDbPath,
        authorityDbError,
        authoritySnapshotRoot: path.join(ROOT, 'output', 'codex-evidence', 'authority-snapshots'),
    };
}

function defaultOutputPath() {
    return path.join(ROOT, 'output', 'codex-evidence', `mission-control-production-readiness-${Date.now()}.json`);
}

function parseArgs(argv) {
    const values = {};
    const errors = [];
    let help = false;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--help') {
            help = true;
            continue;
        }
        if (!token.startsWith('--')) {
            errors.push(`Unexpected argument: ${token}`);
            continue;
        }
        const requestedKey = token.slice(2);
        const key = OPTION_ALIASES[requestedKey] || requestedKey;
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            errors.push(`Missing value for --${requestedKey}`);
            continue;
        }
        index += 1;
        if (!ALLOWED_OPTIONS.has(key)) {
            errors.push(`Unexpected argument: --${requestedKey}`);
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            errors.push(`Duplicate argument: --${requestedKey}`);
            continue;
        }
        values[key] = value;
    }
    if (!help && !Object.prototype.hasOwnProperty.call(values, 'authority-db')) {
        errors.push('Missing required argument: --authority-db');
    }
    return { errors, help, values };
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
    return /^[A-F0-9]{64}$/.test(String(value || '').toUpperCase());
}

function normalizeSha256(value) {
    return isSha256(value) ? String(value).toUpperCase() : null;
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function validTimestamp(value) {
    return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function sha256Text(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map((item) => stableJson(item)).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function stableEqual(left, right) {
    return stableJson(left) === stableJson(right);
}

function normalizeLogicalId(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized) ? normalized : null;
}

function isPathContained(rootPath, candidatePath) {
    const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sqliteIntegrityCheck(database) {
    return database.pragma('integrity_check').map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
}

function withVerifiedReadOnlyDatabase(databaseEvidence, label, reasons, reader, context = {}) {
    pushReason(reasons, databaseEvidence?.openedReadOnly === true, `${label} database was not declared read-only`);
    pushReason(reasons, nonEmpty(context.authoritySnapshotPath) && realpathEquals(databaseEvidence?.absolutePath, context.authoritySnapshotPath), `${label} database is not the explicitly selected canonical authority snapshot`);
    pushReason(reasons, normalizeSha256(databaseEvidence?.snapshotManifestSha256) === normalizeSha256(context.authoritySnapshotManifestSha256), `${label} database is not bound to the explicit authority snapshot manifest`);
    pushReason(reasons, stableEqual(databaseEvidence?.packageIdentity, context.packageIdentity), `${label} database proof is not bound to the current package identity`);
    const databaseCurrent = nonEmpty(databaseEvidence?.absolutePath)
        && path.isAbsolute(databaseEvidence.absolutePath)
        && currentFileMatches({
            path: databaseEvidence.absolutePath,
            sizeBytes: databaseEvidence.sizeBytes,
            sha256: databaseEvidence.sha256,
        });
    pushReason(reasons, databaseCurrent, `${label} database snapshot is missing or its hash is stale`);
    if (!databaseCurrent)
        return null;
    let database;
    try {
        const Database = context.Database ?? requireFromLocalDb('better-sqlite3');
        database = new Database(databaseEvidence.absolutePath, { readonly: true, fileMustExist: true });
        database.pragma('query_only = ON');
        const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1;
        const integrityCheck = sqliteIntegrityCheck(database);
        const foreignKeyViolations = database.pragma('foreign_key_check');
        pushReason(reasons, queryOnly, `${label} authority database did not enter SQLite query_only mode`);
        pushReason(reasons, integrityCheck.length === 1 && integrityCheck[0] === 'ok', `${label} authority database integrity_check did not return ok`);
        pushReason(reasons, stableEqual(databaseEvidence.integrityCheck, integrityCheck), `${label} claimed database integrity result does not match the read-only query`);
        pushReason(reasons, Array.isArray(foreignKeyViolations) && foreignKeyViolations.length === 0, `${label} authority database foreign_key_check found violations`);
        return reader(database, integrityCheck);
    }
    catch (error) {
        reasons.push(`${label} authority database could not be queried read-only: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
    finally {
        if (database)
            database.close();
        pushReason(reasons, currentFileMatches({
            path: databaseEvidence.absolutePath,
            sizeBytes: databaseEvidence.sizeBytes,
            sha256: databaseEvidence.sha256,
        }), `${label} database snapshot changed while it was being verified`);
    }
}

function samePath(left, right) {
    if (!nonEmpty(left) || !nonEmpty(right))
        return false;
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function uniqueExactStrings(actual, expected) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
        return false;
    return new Set(actual).size === actual.length
        && expected.every((value) => actual.includes(value));
}

function currentFileMatches(record, pathField = 'path') {
    const filePath = record?.[pathField];
    if (!nonEmpty(filePath) || !path.isAbsolute(filePath) || !fs.existsSync(filePath))
        return false;
    if (fs.lstatSync(filePath).isSymbolicLink()
        || hasUnsafeFilesystemLink(path.parse(path.resolve(filePath)).root, filePath))
        return false;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.nlink !== 1 || !isSha256(record.sha256) || Number(record.sizeBytes) !== stat.size)
        return false;
    return sha256File(filePath) === String(record.sha256).toUpperCase();
}

function realpathEquals(left, right) {
    try {
        return fs.realpathSync.native(path.resolve(left)).toLowerCase()
            === fs.realpathSync.native(path.resolve(right)).toLowerCase();
    }
    catch {
        return false;
    }
}

function requestedPathEqualsRealpath(candidate) {
    try {
        return path.resolve(candidate).toLowerCase() === fs.realpathSync.native(candidate).toLowerCase();
    }
    catch {
        return false;
    }
}

function realpathIsContained(rootPath, candidatePath) {
    try {
        return isPathContained(fs.realpathSync.native(rootPath), fs.realpathSync.native(candidatePath));
    }
    catch {
        return false;
    }
}

function latestTreeMtimeMs(rootPath) {
    let latest = fs.statSync(rootPath).mtimeMs;
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
        const target = path.join(rootPath, entry.name);
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink())
            throw new Error(`canonical package contains a filesystem link: ${target}`);
        latest = Math.max(latest, stat.mtimeMs, entry.isDirectory() ? latestTreeMtimeMs(target) : 0);
    }
    return latest;
}

function validationResult(reasons, extras = {}) {
    return {
        ok: reasons.length === 0,
        reason: reasons.length === 0 ? 'Evidence passed its production contract.' : reasons.join('; '),
        ...extras,
    };
}

function pushReason(reasons, condition, message) {
    if (!condition)
        reasons.push(message);
}

function hasUnsafeFilesystemLink(rootPath, filePath) {
    const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return true;
    let cursor = path.resolve(rootPath);
    for (const segment of relative.split(path.sep)) {
        cursor = path.join(cursor, segment);
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink())
            return true;
    }
    return false;
}

module.exports = { defaultProductionContext, defaultOutputPath, parseArgs, isRecord, nonEmpty, isSha256, normalizeSha256, isPositiveInteger, validTimestamp, sha256File, sha256Text, stableJson, stableEqual, normalizeLogicalId, isPathContained, sqliteIntegrityCheck, withVerifiedReadOnlyDatabase, samePath, uniqueExactStrings, currentFileMatches, realpathEquals, requestedPathEqualsRealpath, realpathIsContained, latestTreeMtimeMs, validationResult, pushReason, hasUnsafeFilesystemLink, ROOT, requireFromLocalDb, OUTPUT_KIND, OUTPUT_SCHEMA_VERSION, EXECUTION_CANARY_KIND, EXECUTION_CANARY_SCHEMA_VERSION, EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, S7_CONTINUOUS_OPERATION_KIND, S7_CONTINUOUS_OPERATION_SCHEMA_VERSION, V15_GATE_IDS, PACKAGE_IDENTITY_FIELDS, V15_SUPERSEDED_GATE_ID, V15_SUPERSEDING_GATE_IDS, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, AUTHORITY_SNAPSHOT_BACKUP_METHOD, MAX_FUTURE_SKEW_MS, MAX_PACKAGE_EVIDENCE_AGE_MS, MAX_CONTINUOUS_EVIDENCE_AGE_MS, MAX_CANARY_EVIDENCE_AGE_MS, AUTHORITY_SNAPSHOT_DEPENDENT_GATE_IDS, GATE_SPECS, OPTION_ALIASES, ALLOWED_OPTIONS };
