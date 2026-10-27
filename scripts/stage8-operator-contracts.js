// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const { EXPECTED_REPORT_TYPES, BUSINESS_TIMEZONE, evaluateContinuousOperationSnapshot, loadAuthoritySnapshotManifest, readContinuousOperationSnapshot, recentCompletedUsBusinessDates, } = require('./verify-s7-continuous-operation');


const ROOT = path.resolve(__dirname, '..');

const requireFromLocalDb = createRequire(path.join(ROOT, 'packages', 'local-db', 'package.json'));

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
    if (!text)
        return null;
    const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
    return `${prefix}-${digest}`;
}

function pathDescriptor(filePath) {
    if (!filePath)
        return null;
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
            }
            else {
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
        }
        else {
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
            if (!values[option])
                errors.push(`--execute-exports requires --${option}.`);
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
        if (Number.isFinite(parsed))
            detail[key] = new Date(parsed).toISOString();
    }
    if (Array.isArray(source?.missingReports)) {
        detail.missingReports = source.missingReports.filter((reportType) => EXPECTED_REPORT_TYPES.includes(reportType));
    }
    if (Array.isArray(source?.unexpectedReports)) {
        detail.unexpectedReportCount = source.unexpectedReports.length;
    }
    return detail;
}

module.exports = { fail, isRecord, normalizedId, stableRef, pathDescriptor, parseArgs, businessDateInLosAngeles, storeAliasMap, providerGapPrefix, timestampAtOrBefore, violationAction, safeViolationDetail, ROOT, requireFromLocalDb, LEDGER_KIND, LEDGER_SCHEMA_VERSION, EXPORT_SEQUENCE, REQUIRED_TABLES, PACKAGE_EVIDENCE_OPTIONS, SINGLE_VALUE_OPTIONS };
