// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { computeCanonicalPackageIdentity, } = require('./export-mission-control-authority-snapshot');


const ROOT = path.resolve(__dirname, '..');

const requireFromLocalDb = createRequire(path.join(ROOT, 'packages', 'local-db', 'package.json'));

const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 'mission-control-authority-database-snapshot/v2';

const BACKUP_METHOD = 'sqlite-online-backup';

const CANARY_MAX_AGE_MS = 72 * 60 * 60 * 1000;

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const AUTHORITY_DATABASE_NAME = 'amazon-ai-ops.db';

const EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME = 'execution-canaries';

const PACKAGE_IDENTITY_FIELDS = Object.freeze([
    'executableSha256',
    'appContentSha256',
    'mainBundleSha256',
]);

const EXECUTION_SLOTS = Object.freeze(['before', 'after', 'reload']);

const MODES = new Set(['manual_approval', 'policy_auto']);

const OPTION_NAMES = new Set([
    'authority-snapshot-manifest',
    'mode',
    'store-id',
    'authority-id',
    'mission-grant-id',
    'batch-id',
    'job-id',
    'stores-root',
    'before-artifact',
    'after-artifact',
    'reload-artifact',
    'out',
]);

function fail(message) {
    throw new Error(message);
}

function defaultContext() {
    const releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release');
    const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
    const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
    const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
    const canonicalEvidenceRoot = path.join(ROOT, 'output', 'codex-evidence');
    return {
        Database: requireFromLocalDb('better-sqlite3'),
        authoritySnapshotRoot: path.join(ROOT, 'output', 'codex-evidence', 'authority-snapshots'),
        canonicalEvidenceRoot,
        executionCanaryOutputRoot: path.join(canonicalEvidenceRoot, EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME),
        executablePath,
        appContentPath,
        mainBundlePath,
        releaseRoot,
        now: () => new Date(),
        randomUUID: () => crypto.randomUUID(),
        afterOutputWritten: null,
        inspectCanonicalPackage: () => ({
            packageIdentity: computeCanonicalPackageIdentity({
                executablePath,
                appContentPath,
                mainBundlePath,
                releaseRoot,
            }),
            builtAtMs: Math.max(fs.statSync(executablePath).mtimeMs, fs.statSync(mainBundlePath).mtimeMs, latestTreeMtimeMs(appContentPath)),
        }),
    };
}

function latestTreeMtimeMs(rootPath) {
    const rootStat = fs.lstatSync(rootPath);
    if (rootStat.isSymbolicLink())
        fail(`Canonical package contains a filesystem link: ${rootPath}`);
    let latest = rootStat.mtimeMs;
    if (!rootStat.isDirectory())
        return latest;
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
        latest = Math.max(latest, latestTreeMtimeMs(path.join(rootPath, entry.name)));
    }
    return latest;
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function isSha256(value) {
    return typeof value === 'string' && /^[A-F0-9]{64}$/i.test(value);
}

function normalizeSha256(value, label) {
    if (!isSha256(value))
        fail(`${label} must be a SHA-256 digest.`);
    return String(value).toUpperCase();
}

function validTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function samePath(left, right) {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isPathContained(rootPath, candidatePath) {
    const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertCleanAbsolutePath(candidate, label) {
    if (typeof candidate !== 'string'
        || candidate !== candidate.trim()
        || candidate.includes('\0')
        || !path.isAbsolute(candidate)) {
        fail(`${label} must be a clean absolute path.`);
    }
    return path.resolve(candidate);
}

function assertDirectDirectory(candidate, label) {
    const resolved = assertCleanAbsolutePath(candidate, label);
    if (!fs.existsSync(resolved))
        fail(`${label} does not exist: ${resolved}`);
    const linkStat = fs.lstatSync(resolved);
    const realPath = fs.realpathSync.native(resolved);
    const stat = fs.statSync(realPath);
    if (linkStat.isSymbolicLink() || !stat.isDirectory() || !samePath(resolved, realPath)) {
        fail(`${label} must be a direct real directory without symlink, junction, or reparse traversal.`);
    }
    return realPath;
}

function assertUniqueRegularFile(candidate, label) {
    const resolved = assertCleanAbsolutePath(candidate, label);
    if (!fs.existsSync(resolved))
        fail(`${label} does not exist: ${resolved}`);
    const linkStat = fs.lstatSync(resolved);
    const realPath = fs.realpathSync.native(resolved);
    const stat = fs.statSync(realPath);
    if (linkStat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !samePath(resolved, realPath)) {
        fail(`${label} must be one unique regular file without symlink, junction, reparse, or hardlink traversal.`);
    }
    return { path: realPath, stat };
}

function normalizePackageIdentity(value, label = 'packageIdentity') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} is missing.`);
    }
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = [...PACKAGE_IDENTITY_FIELDS].sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        fail(`${label} must contain exactly ${PACKAGE_IDENTITY_FIELDS.join(', ')}.`);
    }
    return Object.fromEntries(PACKAGE_IDENTITY_FIELDS.map((field) => [
        field,
        normalizeSha256(value[field], `${label}.${field}`),
    ]));
}

function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map((item) => stableJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function stableEqual(left, right) {
    return stableJson(left) === stableJson(right);
}

function cleanIdentifier(value, label, { normalized = false } = {}) {
    if (typeof value !== 'string'
        || value !== value.trim()
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value)) {
        fail(`${label} is invalid.`);
    }
    if (normalized && (value !== value.toLowerCase() || value.length > 128)) {
        fail(`${label} must be a normalized lowercase logical id.`);
    }
    return value;
}

function parseJsonArray(value, label) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        fail(`${label} is not valid JSON.`);
    }
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
        fail(`${label} must be an array of non-empty strings.`);
    }
    if (new Set(parsed).size !== parsed.length)
        fail(`${label} contains duplicates.`);
    return parsed;
}

function parseJsonObject(value, label) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        fail(`${label} is not valid JSON.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail(`${label} must be an object.`);
    }
    return parsed;
}

function parseStopConditionCodes(value, label) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        fail(`${label} is not valid JSON.`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        fail(`${label} must be a non-empty array.`);
    }
    const codes = parsed.map((item) => {
        if (typeof item === 'string' && item.length > 0)
            return item;
        if (item && typeof item === 'object' && !Array.isArray(item)
            && typeof item.code === 'string' && item.code.length > 0) {
            return item.code;
        }
        fail(`${label} contains an invalid stop condition.`);
        return null;
    });
    if (new Set(codes).size !== codes.length)
        fail(`${label} contains duplicate stop-condition codes.`);
    return codes;
}

function requireRow(database, sql, parameters, label) {
    const row = database.prepare(sql).get(...parameters);
    if (!row)
        fail(`${label} is missing from the authority snapshot.`);
    return row;
}

function assertCondition(condition, message) {
    if (!condition)
        fail(message);
}

function assertArtifactDescriptor(value, label) {
    assertCondition(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing.`);
    normalizeSha256(value.sha256, `${label}.sha256`);
    assertCondition(Number.isInteger(value.sizeBytes) && value.sizeBytes >= 0, `${label}.sizeBytes is invalid.`);
    assertCondition(Number.isFinite(value.mtimeMs) && value.mtimeMs >= 0, `${label}.mtimeMs is invalid.`);
}

function timestampMs(value, label) {
    if (!validTimestamp(value))
        fail(`${label} is missing or invalid.`);
    return Date.parse(value);
}

function assertFreshTimestamp(value, label, nowMs) {
    const valueMs = timestampMs(value, label);
    assertCondition(valueMs <= nowMs + MAX_FUTURE_SKEW_MS && nowMs - valueMs <= CANARY_MAX_AGE_MS, `${label} is future-dated or older than the 72-hour execution-canary window.`);
    return valueMs;
}

module.exports = { fail, defaultContext, latestTreeMtimeMs, sha256File, isSha256, normalizeSha256, validTimestamp, samePath, isPathContained, assertCleanAbsolutePath, assertDirectDirectory, assertUniqueRegularFile, normalizePackageIdentity, stableJson, stableEqual, cleanIdentifier, parseJsonArray, parseJsonObject, parseStopConditionCodes, requireRow, assertCondition, assertArtifactDescriptor, timestampMs, assertFreshTimestamp, ROOT, requireFromLocalDb, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, BACKUP_METHOD, CANARY_MAX_AGE_MS, MAX_FUTURE_SKEW_MS, AUTHORITY_DATABASE_NAME, EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME, PACKAGE_IDENTITY_FIELDS, EXECUTION_SLOTS, MODES, OPTION_NAMES };
