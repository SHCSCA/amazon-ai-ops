// 按职责复用原有严格校验，公共入口继续保持兼容。
const { createRequire } = require('node:module');
const path = require('node:path');


const requireLocalDbDependency = createRequire(path.join(__dirname, '..', 'packages', 'local-db', 'package.json'));

const ROOT = path.resolve(__dirname, '..');

const SCHEMA_VERSION = 's7-continuous-operation-evidence/v1';

const ACCEPTANCE_CONTRACT_VERSION = 's7-continuous-operation-success-only/v3';

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

function isSha256(value) {
    return typeof value === 'string' && /^[A-F0-9]{64}$/i.test(value);
}

function isPathContained(rootPath, candidatePath) {
    const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function samePath(left, right) {
    return typeof left === 'string'
        && typeof right === 'string'
        && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function timestampMs(value) {
    if (typeof value !== 'string' || !value.trim())
        return Number.NaN;
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

function importRunKey(storeId, runId) {
    return `${lower(storeId)}|${String(runId ?? '')}`;
}

function sameNonEmptyIdentity(left, right) {
    const normalizedLeft = String(left ?? '').trim();
    const normalizedRight = String(right ?? '').trim();
    return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function lower(value) {
    return String(value ?? '').trim().toLowerCase();
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

module.exports = { fail, isSha256, isPathContained, samePath, timestampMs, timestampWithin, lower, nonEmpty, sameNonEmptyIdentity, importRunKey, requireLocalDbDependency, ROOT, SCHEMA_VERSION, ACCEPTANCE_CONTRACT_VERSION, US_BUSINESS_CALENDAR_VERSION, BUSINESS_TIMEZONE, MAX_TERMINAL_TAIL_MS, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, AUTHORITY_SNAPSHOT_ROOT, PACKAGE_IDENTITY_FIELDS, SOURCE_DATABASE_NAME, EXPECTED_REPORT_TYPES, TERMINAL_BLOCKED_STATES };
