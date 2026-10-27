// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');


const ROOT = path.resolve(__dirname, '..');

const CANONICAL_EXE = path.join(ROOT, 'apps', 'desktop', 'release', 'win-unpacked', 'AmazonAIOpsAgent.exe');

const CANONICAL_APP = path.join(ROOT, 'apps', 'desktop', 'release', 'win-unpacked', 'resources', 'app');

const CANONICAL_MAIN = path.join(CANONICAL_APP, 'dist', 'main', 'index.js');

const KIND = 's7-live-migration-launch-operator';

const SCHEMA_VERSION = 's7-live-migration-launch-operator/v2';

const PACKET_KIND = 's7-live-migration-approval-packet';

const PACKET_SCHEMA_VERSION = 's7-live-migration-approval-packet/v2';

const SUPPORTED_SOURCE_VERSIONS = Object.freeze([0, 11]);

const SIDECARS = Object.freeze(['-wal', '-shm', '-journal']);

const MAX_PACKAGE_UI_AGE_MS = 48 * 60 * 60 * 1000;

const DEFAULT_SPAWN_TIMEOUT_MS = 15000;

const DEFAULT_EXIT_TIMEOUT_MS = 30 * 60 * 1000;

const DEFAULT_EXCLUSIVE_WINDOW_READY_TIMEOUT_MS = 20000;

const DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS = 60000;

const MAX_PROTOCOL_CLOCK_SKEW_MS = 60000;

const INTENT_DIRECTORY_NAME = '.s7-live-migration-launch-intents';

const STARTUP_GATE_DIRECTORY_NAME = '.s7-main-startup-gate';

const STARTUP_GATE_ACTIVE_FILE = 'ACTIVE.json';

const STARTUP_GATE_BOUND_FILE = 'BOUND.json';

const STARTUP_GATE_HANDOFF_READY_FILE = 'HANDOFF_READY.json';

const STARTUP_GATE_HANDOFF_RELEASED_FILE = 'HANDOFF_RELEASED.json';

const STARTUP_GATE_ADMISSION_FILE = 'ADMISSION.json';

const STARTUP_GATE_CLOSED_FILE = 'CLOSED.json';

const STARTUP_GATE_FINALIZED_FILE = 'FINALIZED.json';

const STARTUP_GATE_ACTIVE_KIND = 's7-main-startup-gate-active';

const STARTUP_GATE_ACTIVE_SCHEMA = 's7-main-startup-gate-active/v2';

const STARTUP_GATE_BOUND_KIND = 's7-main-startup-gate-bound';

const STARTUP_GATE_BOUND_SCHEMA = 's7-main-startup-gate-bound/v2';

const STARTUP_GATE_HANDOFF_READY_KIND = 's7-main-startup-handoff-ready';

const STARTUP_GATE_HANDOFF_READY_SCHEMA = 's7-main-startup-handoff-ready/v1';

const STARTUP_GATE_HANDOFF_RELEASED_KIND = 's7-main-startup-handoff-released';

const STARTUP_GATE_HANDOFF_RELEASED_SCHEMA = 's7-main-startup-handoff-released/v1';

const STARTUP_GATE_ADMISSION_KIND = 's7-main-startup-admission';

const STARTUP_GATE_ADMISSION_SCHEMA = 's7-main-startup-admission/v2';

const STARTUP_GATE_CLOSED_KIND = 's7-main-startup-gate-closed';

const STARTUP_GATE_CLOSED_SCHEMA = 's7-main-startup-gate-closed/v2';

const STARTUP_GATE_FINALIZED_KIND = 's7-main-startup-gate-finalized';

const STARTUP_GATE_FINALIZED_SCHEMA = 's7-main-startup-gate-finalized/v1';

const STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE = 'POST_MIGRATION_ADMITTED.json';

const FINALIZATION_PACKET_KIND = 's7-live-migration-finalization-packet';

const FINALIZATION_PACKET_SCHEMA = 's7-live-migration-finalization-packet/v1';

const EXCLUSIVE_WINDOW_PROTOCOL = 's7-live-migration-exclusive-window/v1';

const EXCLUSIVE_WINDOW_CREATE_COMMAND = 'S7_CREATE_SUSPENDED';

const EXCLUSIVE_WINDOW_RELEASE_COMMAND = 'S7_RELEASE_AND_RESUME';

const PACKAGE_LAUNCH_STATES = Object.freeze([
    'NOT_LAUNCHED',
    'CONFIRMED_LAUNCHED',
    'UNKNOWN_AFTER_HANDOFF',
]);

const REQUIRED_MIGRATION_VERIFICATION_CODES = Object.freeze([
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

const CHILD_ENVIRONMENT_ALLOWLIST = Object.freeze([
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'NUMBER_OF_PROCESSORS',
    'OS',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'PROCESSOR_IDENTIFIER',
    'PROCESSOR_LEVEL',
    'PROCESSOR_REVISION',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'WINDIR',
]);

const TRUSTED_INSTALLER_SID = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';

const TRUSTED_POWERSHELL_MAX_HARDLINKS = 8;

const TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS = 8192;

const TRUSTED_POWERSHELL_SIGNATURE_SUBJECT = /(?:^|,\s*)O=Microsoft Corporation(?:,|$)/i;

const WINDOWS_WRITE_RIGHTS_MASK = 2n | 4n | 16n | 64n | 256n | 65536n | 262144n | 524288n;

const USAGE = [
    'Usage:',
    '  pnpm run operate:s7-live-migration -- --prepare --db <absolute canonical live v0 or v11 db> --authority-selection <absolute json> --migration-manifest <absolute json> --migration-verification <absolute json> --package-ui-manifest <absolute passed v9 json> --recovery-root <absolute isolated existing directory> --out <absolute new approval packet json under recovery root>',
    '  --prepare accepts exactly one of --package-ui-manifest <passed v9 json> or --package-upgrade-smoke <isolated upgrade/start/reopen receipt>; the latter is not L4 acceptance.',
    '  pnpm run operate:s7-live-migration -- --execute-approved --approval-packet <absolute approval packet json> --confirm-live-migration <exact packet confirmation token> --recovery-root <absolute isolated existing directory> --out <absolute new launch receipt json under recovery root>',
    '  pnpm run operate:s7-live-migration -- --prepare-finalization --approval-packet <absolute approval packet json> --launch-receipt <absolute successful launch receipt json> --acceptance-receipt <absolute passed readonly acceptance json> --recovery-root <absolute isolated existing directory> --out <absolute new finalization packet json under recovery root>',
    '  pnpm run operate:s7-live-migration -- --prepare-recovery --approval-packet <original approval json> --launch-receipt <original post-write HOLD json> --acceptance-receipt <current passed readonly acceptance json> --recovery-snapshot <current WAL-safe backup db> --recovery-root <absolute isolated existing directory> --out <absolute new recovery packet json>',
    '  pnpm run operate:s7-live-migration -- --finalize-approved --finalization-packet <absolute finalization packet json> --confirm-finalization <exact finalization token>',
    '',
    'Windows only. No mode and --help are side-effect free.',
    '--prepare is read-only apart from its exclusive approval packet output.',
    '--execute-approved writes a complete launch intent before one controlled launch attempt.',
    '--prepare-finalization is read-only apart from one protected finalization packet.',
    '--prepare-recovery validates the retained failed chain and current authority/backup; finalization records RECOVERED_AFTER_FAILED_MIGRATION_PROCESS with closed:null, never creates CLOSED, and binds the new recovery package separately.',
    '--finalize-approved revalidates the complete chain and atomically publishes protected FINALIZED.json; it does not declare APP_READY or authorize Ads execution.',
    '--recovery-root must be current-user-owned, inheritance-protected, and writable only by the current user, SYSTEM, and Administrators.',
    'While that complete intent exists the packet cannot be reused. Deleting or rolling it back is evidence destruction, forces HOLD, and requires a new packet and approval; this local operator cannot absolutely detect administrator deletion.',
    'The normal package opens its window; this is not a migration-only command. The user must be present.',
].join('\n');

function fail(message) {
    throw new Error(message);
}

function nowIso(now) {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
        fail('Clock returned an invalid date.');
    }
    return value.toISOString();
}

function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function normalizeSha(value, label) {
    const result = String(value || '').trim().toUpperCase();
    if (!/^[A-F0-9]{64}$/.test(result))
        fail(`${label} must be a SHA-256 value.`);
    return result;
}

function normalizedPath(value) {
    return path.resolve(String(value)).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(left, right) {
    return typeof left === 'string'
        && typeof right === 'string'
        && normalizedPath(left) === normalizedPath(right);
}

function cleanAbsolute(value, label) {
    if (typeof value !== 'string'
        || value !== value.trim()
        || !value
        || value.includes('\0')
        || !path.isAbsolute(value)) {
        fail(`${label} must be a clean absolute path.`);
    }
    const resolved = path.resolve(value);
    if (resolved.slice(path.parse(resolved).root.length).includes(':')) {
        fail(`${label} may not contain an alternate data stream.`);
    }
    return resolved;
}

function exists(value) {
    try {
        fs.lstatSync(value);
        return true;
    }
    catch (error) {
        if (error && error.code === 'ENOENT')
            return false;
        throw error;
    }
}

function sameStat(left, right) {
    return String(left.dev) === String(right.dev)
        && String(left.ino) === String(right.ino)
        && String(left.nlink) === String(right.nlink)
        && left.birthtimeMs === right.birthtimeMs
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
}

function identity(stat, realPath) {
    return {
        realPath,
        dev: stat.dev.toString(),
        ino: stat.ino.toString(),
        birthtimeMs: Number(stat.birthtimeNs) / 1000000,
        nlink: Number(stat.nlink),
    };
}

function sameArtifact(left, right) {
    return Boolean(left
        && right
        && samePath(left.realPath, right.realPath)
        && left.sha256 === right.sha256
        && left.sizeBytes === right.sizeBytes
        && left.mtimeMs === right.mtimeMs
        && stableJson(left.identity) === stableJson(right.identity));
}

function publicArtifact(artifact) {
    return {
        path: artifact.path,
        realPath: artifact.realPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        mtimeMs: artifact.mtimeMs,
        identity: artifact.identity,
    };
}

function sameOrInside(candidate, root) {
    const relative = path.relative(normalizedPath(root), normalizedPath(candidate));
    return relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
    return sameOrInside(left, right) || sameOrInside(right, left);
}

function parsePowerShellJson(result, label) {
    if (result.error || result.status !== 0) {
        return { passed: false, rows: [], unresolved: [`${label}-query-failed`] };
    }
    try {
        const text = String(result.stdout || '').trim();
        const parsed = text ? JSON.parse(text) : [];
        return {
            passed: true,
            rows: parsed == null ? [] : Array.isArray(parsed) ? parsed : [parsed],
            unresolved: [],
        };
    }
    catch {
        return { passed: false, rows: [], unresolved: [`${label}-query-invalid`] };
    }
}

function exactPassingChecks(receipt, label) {
    const codes = Array.isArray(receipt?.checks)
        ? receipt.checks.map((check) => check?.code)
        : [];
    if (receipt?.kind !== 's7-migration-backup-restore-verification'
        || Number(receipt?.schemaVersion) !== 1
        || receipt?.passed !== true
        || stableJson(codes) !== stableJson(REQUIRED_MIGRATION_VERIFICATION_CODES)
        || receipt.checks.some((check) => check?.passed !== true)
        || receipt?.summary?.total !== REQUIRED_MIGRATION_VERIFICATION_CODES.length
        || receipt?.summary?.passed !== REQUIRED_MIGRATION_VERIFICATION_CODES.length
        || receipt?.summary?.failed !== 0) {
        fail(`${label} does not contain the exact 19 passing migration verification checks.`);
    }
}

function protocolError(message, code, proof = null) {
    const error = new Error(message);
    error.code = code;
    error.proof = proof;
    return error;
}

function exactKeys(value, keys) {
    return Boolean(value
        && typeof value === 'object'
        && !Array.isArray(value)
        && stableJson(Object.keys(value).sort()) === stableJson([...keys].sort()));
}

function boundedError(error) {
    return {
        name: error instanceof Error ? error.name : 'Error',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
    };
}

function normalizePackageLaunchState(value, attempted) {
    if (PACKAGE_LAUNCH_STATES.includes(value))
        return value;
    return attempted ? 'UNKNOWN_AFTER_HANDOFF' : 'NOT_LAUNCHED';
}

function helperConfirmedClosed(result) {
    return Boolean(result?.outcome === 'close'
        && result?.helperClose?.outcome === 'close'
        && Number(result.helperClose.code) === 0
        && !result.helperClose.signal);
}

module.exports = { fail, nowIso, stableJson, sha256, normalizeSha, normalizedPath, samePath, cleanAbsolute, exists, sameStat, identity, sameArtifact, publicArtifact, sameOrInside, pathsOverlap, parsePowerShellJson, exactPassingChecks, exactKeys, protocolError, boundedError, normalizePackageLaunchState, helperConfirmedClosed, ROOT, CANONICAL_EXE, CANONICAL_APP, CANONICAL_MAIN, KIND, SCHEMA_VERSION, PACKET_KIND, PACKET_SCHEMA_VERSION, SUPPORTED_SOURCE_VERSIONS, SIDECARS, MAX_PACKAGE_UI_AGE_MS, DEFAULT_SPAWN_TIMEOUT_MS, DEFAULT_EXIT_TIMEOUT_MS, DEFAULT_EXCLUSIVE_WINDOW_READY_TIMEOUT_MS, DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS, MAX_PROTOCOL_CLOCK_SKEW_MS, INTENT_DIRECTORY_NAME, STARTUP_GATE_DIRECTORY_NAME, STARTUP_GATE_ACTIVE_FILE, STARTUP_GATE_BOUND_FILE, STARTUP_GATE_HANDOFF_READY_FILE, STARTUP_GATE_HANDOFF_RELEASED_FILE, STARTUP_GATE_ADMISSION_FILE, STARTUP_GATE_CLOSED_FILE, STARTUP_GATE_FINALIZED_FILE, STARTUP_GATE_ACTIVE_KIND, STARTUP_GATE_ACTIVE_SCHEMA, STARTUP_GATE_BOUND_KIND, STARTUP_GATE_BOUND_SCHEMA, STARTUP_GATE_HANDOFF_READY_KIND, STARTUP_GATE_HANDOFF_READY_SCHEMA, STARTUP_GATE_HANDOFF_RELEASED_KIND, STARTUP_GATE_HANDOFF_RELEASED_SCHEMA, STARTUP_GATE_ADMISSION_KIND, STARTUP_GATE_ADMISSION_SCHEMA, STARTUP_GATE_CLOSED_KIND, STARTUP_GATE_CLOSED_SCHEMA, STARTUP_GATE_FINALIZED_KIND, STARTUP_GATE_FINALIZED_SCHEMA, STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, FINALIZATION_PACKET_KIND, FINALIZATION_PACKET_SCHEMA, EXCLUSIVE_WINDOW_PROTOCOL, EXCLUSIVE_WINDOW_CREATE_COMMAND, EXCLUSIVE_WINDOW_RELEASE_COMMAND, PACKAGE_LAUNCH_STATES, REQUIRED_MIGRATION_VERIFICATION_CODES, CHILD_ENVIRONMENT_ALLOWLIST, TRUSTED_INSTALLER_SID, TRUSTED_POWERSHELL_MAX_HARDLINKS, TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS, TRUSTED_POWERSHELL_SIGNATURE_SUBJECT, WINDOWS_WRITE_RIGHTS_MASK, USAGE };
