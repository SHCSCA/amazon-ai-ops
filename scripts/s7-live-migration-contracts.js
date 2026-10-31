// 按职责复用原有严格校验，公共入口继续保持兼容。
const path = require('node:path');
const { getTargetVersion, collectRowCounts, evaluateBusinessRowPreservation, loadLocalDbRuntime, readAppliedVersion, requireSqlite, } = require('./migrate-current-user-db.js');


const KIND = 's7-live-migration-acceptance';

const SCHEMA_VERSION = 's7-live-migration-acceptance/v1';

const AUTHORITY_SELECTION_KIND = 'production-authority-selection-preflight';

const AUTHORITY_SELECTION_SCHEMA_VERSION = 'production-authority-selection-preflight/v1';

const OFFLINE_MIGRATION_KIND = 's7-offline-db-upgrade';

const OFFLINE_MIGRATION_SCHEMA_VERSION = 1;

const MIGRATION_VERIFICATION_KIND = 's7-migration-backup-restore-verification';

const MIGRATION_VERIFICATION_SCHEMA_VERSION = 1;

const OFFLINE_SIDECAR_SUFFIXES = Object.freeze(['-wal', '-shm', '-journal']);

const REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES = Object.freeze([
    'MANIFEST_SCHEMA_VALID',
    'SOURCE_AND_OUTPUT_PATHS_DISTINCT',
    'SOURCE_HASH_MATCH',
    'UPGRADED_COPY_HASH_MATCH',
    'RESTORED_COPY_HASH_MATCH',
    'UPGRADED_INTEGRITY_OK',
    'UPGRADED_FOREIGN_KEYS_OK',
    'MIGRATIONS_1_TO_9_APPLIED',
    'V9_BACKUP_PREFLIGHT_OK',
    'V9_BACKUP_SOURCE_VERSION_BOUND',
    'V9_BACKUP_SCHEMA_BOUND',
    'V9_BACKUP_ROWS_BOUND',
    'BUSINESS_ROW_PRESERVATION_RECOMPUTED',
    'BUSINESS_ROW_TRANSFER_PROOF_BOUND',
    'RESTORED_INTEGRITY_OK',
    'RESTORED_SOURCE_VERSION_MATCH',
    'RESTORED_ROW_COUNTS_MATCH',
    'EVIDENCE_MIGRATION_RECORDS_BOUND',
    'BUSINESS_ROWS_PRESERVED',
]);

const REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES = Object.freeze([
    'OFFLINE_MIGRATION_SCHEMA_PASSED',
    'OFFLINE_MIGRATION_SOURCE_PATH_BOUND',
    'OFFLINE_MIGRATION_TARGET_V9',
    'OFFLINE_MIGRATION_SOURCE_BASELINE_VALID',
    'OFFLINE_MIGRATION_LEASE_BOUND',
    'OFFLINE_MIGRATION_ARTIFACT_HASHES_BOUND',
    'OFFLINE_MIGRATION_RECORDS_PRESERVATION_PASSED',
    'AUTHORITY_SELECTION_SCHEMA_BOUND',
    'AUTHORITY_SELECTION_PATH_BOUND',
    'AUTHORITY_SELECTION_PRE_MIGRATION_STATE',
    'AUTHORITY_SELECTION_READONLY_SAFETY',
    'PRE_MIGRATION_MAIN_SHA_BOUND',
    'MIGRATION_VERIFICATION_SCHEMA_PASSED',
    'MIGRATION_VERIFICATION_MANIFEST_BOUND',
    'MIGRATION_VERIFICATION_INPUT_HASHED',
    'OFFLINE_ARTIFACT_PATHS_DISTINCT',
    'OFFLINE_WORKING_ARTIFACT_IDENTITY_BOUND',
    'OFFLINE_RESTORE_ARTIFACT_IDENTITY_BOUND',
    'OFFLINE_WORKING_ARTIFACT_HASH_BOUND',
    'OFFLINE_RESTORE_ARTIFACT_HASH_BOUND',
    'OFFLINE_WORKING_OPEN_IDENTITY_BOUND',
    'OFFLINE_WORKING_QUERY_ONLY_INTEGRITY',
    'OFFLINE_WORKING_MIGRATIONS_CURRENT',
    'OFFLINE_WORKING_ROW_PRESERVATION_BOUND',
    'OFFLINE_WORKING_V9_RECOVERY_PREFLIGHT',
    'OFFLINE_WORKING_ARTIFACT_STABLE_AFTER_READ',
    'OFFLINE_RESTORE_OPEN_IDENTITY_BOUND',
    'OFFLINE_RESTORE_QUERY_ONLY_INTEGRITY',
    'OFFLINE_RESTORE_SOURCE_BASELINE_BOUND',
    'OFFLINE_RESTORE_ARTIFACT_STABLE_AFTER_READ',
    'LIVE_WAL_AWARE_READONLY_BACKUP',
    'LIVE_LOGICAL_SNAPSHOT_HASH_BOUND',
    'LIVE_LOGICAL_SNAPSHOT_QUERY_ONLY',
    'LIVE_LOGICAL_SNAPSHOT_INTEGRITY',
    'LIVE_REQUIRED_TABLES_PRESENT',
    'LIVE_MIGRATIONS_1_TO_9_CURRENT',
    'LIVE_V11_STORE_PROVIDER_IDENTITY_SCHEMA_CURRENT',
    'LIVE_BUSINESS_ROWS_PRESERVED',
    'LIVE_V9_UPGRADE_BACKUP_EMBEDDED',
    'LIVE_V9_UPGRADE_BACKUP_PATHS_BOUND',
    'LIVE_V9_UPGRADE_BACKUP_SOURCE_BOUND',
    'LIVE_V9_UPGRADE_BACKUP_MANIFEST_MATCH',
    'LIVE_V9_RECOVERY_PREFLIGHT_CAN_RESTORE',
    'LIVE_V9_RECOVERY_BACKUP_SHA_INTEGRITY',
    'LIVE_V9_RECOVERY_SCHEMA_ROWS',
    'LIVE_FINAL_WAL_AWARE_READONLY_BACKUP',
    'LIVE_LOGICAL_SNAPSHOT_STABLE',
    'LIVE_MAIN_FILE_UNCHANGED',
]);

const CAPTURE_FILE_NAMES = Object.freeze([
    'live-authority-logical-snapshot.db',
    'live-authority-logical-snapshot.db-wal',
    'live-authority-logical-snapshot.db-shm',
    'live-authority-logical-snapshot.db-journal',
    'live-authority-logical-snapshot-final.db',
    'live-authority-logical-snapshot-final.db-wal',
    'live-authority-logical-snapshot-final.db-shm',
    'live-authority-logical-snapshot-final.db-journal',
]);

const SINGLE_VALUE_OPTIONS = new Set([
    'db',
    'authority-selection',
    'migration-manifest',
    'migration-verification',
    'out',
]);

const REQUIRED_OPTIONS = Object.freeze([...SINGLE_VALUE_OPTIONS]);

const LIVE_MIGRATION_ACCEPTANCE_USAGE = [
    'Usage: node scripts/verify-s7-live-migration-acceptance.js',
    '  --db <absolute live amazon-ai-ops.db>',
    '  --authority-selection <absolute production authority selection JSON>',
    '  --migration-manifest <absolute S7 offline migration manifest JSON>',
    '  --migration-verification <absolute S7 migration verification JSON>',
    '  --out <absolute new acceptance receipt JSON>',
    '',
    'This command is a fail-closed, read-only post-migration acceptance check.',
    'It reads the live authority only through a WAL-aware read-only online backup.',
    'The final receipt is created once with exclusive atomic publication.',
    'Run only after the user has approved the live migration procedure.',
].join('\n');

function fail(message) {
    throw new Error(message);
}

function normalizedPath(filePath) {
    const resolved = path.resolve(filePath).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
    return typeof left === 'string'
        && typeof right === 'string'
        && normalizedPath(left) === normalizedPath(right);
}

function addRequiredCheck(checks, code, condition, detail) {
    const passed = condition === true;
    checks.push({ code, passed, detail });
    if (!passed)
        fail(`${code}: ${detail}`);
}

function hasExactKeys(value, expectedKeys) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
}

function requireExactKeys(value, expectedKeys, label) {
    if (!hasExactKeys(value, expectedKeys)) {
        fail(`${label} has extra or missing fields.`);
    }
    return value;
}

function requireAcceptanceArtifact(value, label) {
    requireExactKeys(value, ['path', 'realPath', 'sha256', 'sizeBytes'], label);
    if (!isCleanAbsolutePath(value.path)
        || !isCleanAbsolutePath(value.realPath)
        || !isSha256(value.sha256)
        || !Number.isSafeInteger(value.sizeBytes)
        || value.sizeBytes < 1) {
        fail(`${label} proof is invalid.`);
    }
}

function requireAcceptanceOfflineArtifact(value, label, expectedKind, targetVersion = getTargetVersion()) {
    if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) {
        fail(`${label} target version is invalid.`);
    }
    const sharedKeys = [
        'path',
        'identity',
        'sha256',
        'sizeBytes',
        'openedReadOnly',
        'queryOnly',
        'integrityCheck',
    ];
    const expectedKeys = expectedKind === 'working'
        ? [
            ...sharedKeys,
            'foreignKeyViolationCount',
            'migrationCount',
            'businessRowPreservationPassed',
            'recoveryCanRestore',
            'mtimeMs',
            'sidecarsAbsentBeforeAndAfter',
        ]
        : [
            ...sharedKeys,
            'version',
            'sourceBaselineRowsMatch',
            'mtimeMs',
            'sidecarsAbsentBeforeAndAfter',
        ];
    requireExactKeys(value, expectedKeys, label);
    requireExactKeys(value.identity, ['realPath', 'dev', 'ino', 'birthtimeMs', 'nlink'], `${label} identity`);
    if (!isCleanAbsolutePath(value.path)
        || !isSha256(value.sha256)
        || !Number.isSafeInteger(value.sizeBytes)
        || value.sizeBytes < 1
        || !Number.isFinite(value.mtimeMs)
        || !samePath(value.path, value.identity.realPath)
        || Number(value.identity.nlink) !== 1
        || value.openedReadOnly !== true
        || value.queryOnly !== true
        || value.integrityCheck !== 'ok'
        || value.sidecarsAbsentBeforeAndAfter !== true) {
        fail(`${label} read-only artifact proof is invalid.`);
    }
    if (expectedKind === 'working'
        && (value.foreignKeyViolationCount !== 0
            || value.migrationCount !== targetVersion
            || value.businessRowPreservationPassed !== true
            || value.recoveryCanRestore !== true)) {
        fail(`${label} migration/preservation proof is invalid.`);
    }
    if (expectedKind === 'restore'
        && (!Number.isInteger(value.version)
            || value.version < 0
            || value.version >= targetVersion
            || value.sourceBaselineRowsMatch !== true)) {
        fail(`${label} source-baseline proof is invalid.`);
    }
}

function sameNumericRecord(left, right) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index]
            && Number(left[key]) === Number(right[key]));
}

function isNumericRowCountRecord(value) {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.keys(value).length > 0
        && Object.values(value).every((count) => Number.isSafeInteger(Number(count)) && Number(count) >= 0);
}

function isSha256(value) {
    return typeof value === 'string' && /^[A-F0-9]{64}$/i.test(value.trim());
}

function isCleanAbsolutePath(value) {
    return typeof value === 'string'
        && value === value.trim()
        && value.length > 0
        && !value.includes('\0')
        && path.isAbsolute(value);
}

function isListingMergeBaseline(value) {
    return Boolean(value)
        && typeof value === 'object'
        && Number.isSafeInteger(Number(value.migration4MergedDuplicateRows))
        && Number(value.migration4MergedDuplicateRows) >= 0
        && Number.isSafeInteger(Number(value.resolvedMergeRecords))
        && Number(value.resolvedMergeRecords) >= 0;
}

function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

module.exports = { fail, normalizedPath, samePath, addRequiredCheck, hasExactKeys, requireExactKeys, requireAcceptanceArtifact, requireAcceptanceOfflineArtifact, sameNumericRecord, isNumericRowCountRecord, isSha256, isCleanAbsolutePath, isListingMergeBaseline, stableJson, KIND, SCHEMA_VERSION, AUTHORITY_SELECTION_KIND, AUTHORITY_SELECTION_SCHEMA_VERSION, OFFLINE_MIGRATION_KIND, OFFLINE_MIGRATION_SCHEMA_VERSION, MIGRATION_VERIFICATION_KIND, MIGRATION_VERIFICATION_SCHEMA_VERSION, OFFLINE_SIDECAR_SUFFIXES, REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES, REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES, CAPTURE_FILE_NAMES, SINGLE_VALUE_OPTIONS, REQUIRED_OPTIONS, LIVE_MIGRATION_ACCEPTANCE_USAGE };
