// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AUTHORITY_SNAPSHOT_BACKUP_METHOD, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, GATE_SPECS, OUTPUT_KIND: READINESS_KIND, OUTPUT_SCHEMA_VERSION: READINESS_SCHEMA_VERSION, } = require('./verify-mission-control-production-readiness');


const ROOT = path.resolve(__dirname, '..');

const BUNDLE_KIND = 's7-mission-control-delivery-bundle';

const BUNDLE_SCHEMA_VERSION = 's7-mission-control-delivery-bundle/v1';

const GATE_IDS = Object.freeze(GATE_SPECS.map((gate) => gate.id));

const GATE_OPTIONS = Object.freeze(Object.fromEntries(GATE_SPECS.map((gate) => [gate.id, gate.option])));

const PACKAGE_IDENTITY_FIELDS = Object.freeze([
    'executableSha256',
    'appContentSha256',
    'mainBundleSha256',
]);

const CURRENT_REVALIDATION_KIND = 'mission-control-current-revalidation/v1';

const SAFE_BUNDLED_EXTENSIONS = new Set([
    '.json',
    '.md',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.txt',
    '.log',
]);

const HASH_ONLY_EXTENSIONS = new Set([
    '.db',
    '.sqlite',
    '.sqlite3',
    '.xlsx',
    '.xls',
    '.csv',
    '.exe',
    '.zip',
    '.7z',
]);

const HASH_PATH_KEYS = Object.freeze([
    'path',
    'absolutePath',
    'filePath',
    'artifactPath',
    'sourcePath',
]);

const HASH_KEYS = Object.freeze(['sha256', 'contentSha256']);

const SENSITIVE_JSON_KEYS = /^(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|cookies)$/i;

function parseArgs(argv) {
    const allowed = new Set(['readiness', 'out', 'readme', 'help']);
    const values = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--help') {
            values.help = true;
            continue;
        }
        if (!token.startsWith('--'))
            throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        if (!allowed.has(key))
            throw new Error(`Unexpected argument: --${key}`);
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            throw new Error(`Duplicate argument: --${key}`);
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            throw new Error(`Missing value for --${key}`);
        values[key] = value;
        index += 1;
    }
    return values;
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value) {
    return /^[A-F0-9]{64}$/.test(String(value || '').toUpperCase());
}

function normalizeSha256(value) {
    return isSha256(value) ? String(value).toUpperCase() : null;
}

function validTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function stableEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function canonicalPath(filePath) {
    const resolved = path.resolve(filePath);
    try {
        return fs.realpathSync.native(resolved);
    }
    catch {
        return resolved;
    }
}

function normalizedPath(filePath) {
    if (typeof filePath !== 'string' || filePath.trim() === '')
        return '';
    const canonical = canonicalPath(filePath);
    return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function samePath(left, right) {
    const normalizedLeft = normalizedPath(left);
    return Boolean(normalizedLeft && normalizedLeft === normalizedPath(right));
}

function sameOptionalPath(left, right) {
    if ((left === null || left === undefined) && (right === null || right === undefined))
        return true;
    return samePath(left, right);
}

function pathIsInside(filePath, parentDir) {
    const relative = path.relative(path.resolve(parentDir), path.resolve(filePath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireRegularUnlinkedFile(filePath, label) {
    if (!filePath || !path.isAbsolute(filePath)) {
        throw new Error(`${label} must be an explicit absolute path.`);
    }
    if (!fs.existsSync(filePath))
        throw new Error(`${label} is missing: ${filePath}`);
    const lstat = fs.lstatSync(filePath);
    const stat = fs.statSync(filePath);
    if (!lstat.isFile() || lstat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} must be one regular, non-symbolic-link file: ${filePath}`);
    }
    return stat;
}

function artifactRecord(filePath) {
    const resolved = canonicalPath(filePath);
    const stat = requireRegularUnlinkedFile(resolved, 'Artifact');
    return {
        sourcePath: resolved,
        sizeBytes: stat.size,
        sha256: sha256File(resolved),
    };
}

function normalizedPackageIdentity(value) {
    if (!isRecord(value))
        return null;
    const result = {};
    for (const field of PACKAGE_IDENTITY_FIELDS) {
        const normalized = normalizeSha256(value[field]);
        if (!normalized)
            return null;
        result[field] = normalized;
    }
    return result;
}

module.exports = { parseArgs, isRecord, isSha256, normalizeSha256, validTimestamp, stableEqual, readJson, sha256File, canonicalPath, normalizedPath, samePath, sameOptionalPath, pathIsInside, requireRegularUnlinkedFile, artifactRecord, normalizedPackageIdentity, ROOT, BUNDLE_KIND, BUNDLE_SCHEMA_VERSION, GATE_IDS, GATE_OPTIONS, PACKAGE_IDENTITY_FIELDS, CURRENT_REVALIDATION_KIND, SAFE_BUNDLED_EXTENSIONS, HASH_ONLY_EXTENSIONS, HASH_PATH_KEYS, HASH_KEYS, SENSITIVE_JSON_KEYS };
