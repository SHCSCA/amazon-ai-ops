// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { COLLECTION_RESUME_AUTHORITY_TABLES, LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM, verifyAiSpendSchema, verifyExecutionReconciliationSchema, verifyMissionWriteAuthoritySchema, verifyGrantSlotLedgerSchema, verifyLegacyCompatibilitySchema, verifyCollectionResumeAuthoritySchema, verifyStoreProviderIdentityAuthoritySchema, } from '@amazon-ai-ops/local-db/src/sqlite/migrations';
import { SQLITE_MIGRATION_CONTRACT, SQLITE_SCHEMA_VERSION } from '@amazon-ai-ops/local-db/src/sqlite/db';

export const S7_STARTUP_GATE_DIRECTORY = '.s7-main-startup-gate';

export const S7_STARTUP_GATE_ACTIVE_FILE = 'ACTIVE.json';

export const S7_STARTUP_GATE_BOUND_FILE = 'BOUND.json';

export const S7_STARTUP_GATE_HANDOFF_READY_FILE = 'HANDOFF_READY.json';

export const S7_STARTUP_GATE_HANDOFF_RELEASED_FILE = 'HANDOFF_RELEASED.json';

export const S7_STARTUP_GATE_ADMISSION_FILE = 'ADMISSION.json';

export const S7_STARTUP_GATE_CLOSED_FILE = 'CLOSED.json';

export const S7_STARTUP_GATE_FINALIZED_FILE = 'FINALIZED.json';

export const S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE = 'POST_MIGRATION_ADMITTED.json';

export const S7_STARTUP_GATE_ACTIVE_KIND = 's7-main-startup-gate-active';

export const S7_STARTUP_GATE_ACTIVE_SCHEMA = 's7-main-startup-gate-active/v2';

export const S7_STARTUP_GATE_BOUND_KIND = 's7-main-startup-gate-bound';

export const S7_STARTUP_GATE_BOUND_SCHEMA = 's7-main-startup-gate-bound/v2';

export const S7_STARTUP_GATE_HANDOFF_READY_KIND = 's7-main-startup-handoff-ready';

export const S7_STARTUP_GATE_HANDOFF_READY_SCHEMA = 's7-main-startup-handoff-ready/v1';

export const S7_STARTUP_GATE_HANDOFF_RELEASED_KIND = 's7-main-startup-handoff-released';

export const S7_STARTUP_GATE_HANDOFF_RELEASED_SCHEMA = 's7-main-startup-handoff-released/v1';

export const S7_STARTUP_GATE_ADMISSION_KIND = 's7-main-startup-admission';

export const S7_STARTUP_GATE_ADMISSION_SCHEMA = 's7-main-startup-admission/v2';

export const S7_STARTUP_GATE_CLOSED_KIND = 's7-main-startup-gate-closed';

export const S7_STARTUP_GATE_CLOSED_SCHEMA = 's7-main-startup-gate-closed/v2';

export const S7_STARTUP_GATE_FINALIZED_KIND = 's7-main-startup-gate-finalized';

export const S7_STARTUP_GATE_FINALIZED_SCHEMA = 's7-main-startup-gate-finalized/v1';

export const S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND = 's7-main-post-migration-admitted';

export const S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA = 's7-main-post-migration-admitted/v1';

export const S7_STARTUP_GATE_ENV = Object.freeze({
    activePathB64: 'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
    activeSha256: 'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
    activeDeviceId: 'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
    activeFileId: 'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
    gateId: 'AAO_S7_STARTUP_GATE_ID',
    invocationId: 'AAO_S7_STARTUP_INVOCATION_ID',
});

export const GATE_ENV_NAMES = Object.freeze(Object.values(S7_STARTUP_GATE_ENV));

export const HASH_PATTERN = /^[A-F0-9]{64}$/;

export const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const MAX_GATE_FILE_BYTES = 1024 * 1024;

export const MAX_APP_CONTENT_FILES = 250000;

export const MAX_APP_CONTENT_DEPTH = 64;

export const DEFAULT_HANDOFF_TIMEOUT_MS = 30000;

export const HANDOFF_POLL_MS = 25;

export const WINDOWS_SYSTEM_SID = 'S-1-5-18';

export const WINDOWS_ADMINISTRATORS_SID = 'S-1-5-32-544';

export const WINDOWS_TRUSTED_INSTALLER_SID = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';

export const FULL_CONTROL_MASK = 2032127n;

export const WINDOWS_WRITE_RIGHTS_MASK = 0x00000002n | 0x00000004n | 0x00000100n | 0x00010000n | 0x00040000n | 0x00080000n;

export const SUPPORTED_MIGRATION_SOURCE_VERSIONS = [0, 11];

export const POST_MIGRATION_TARGET_VERSION = SQLITE_SCHEMA_VERSION;

export const POST_MIGRATION_CONTRACT = SQLITE_MIGRATION_CONTRACT;

export const POST_MIGRATION_REQUIRED_TABLES = Object.freeze([
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
    ...COLLECTION_RESUME_AUTHORITY_TABLES,
    'analysis_runs',
    'v16_missions',
    'decisions_v16',
    'decision_history_v16',
    'mission_grants_v16',
    'grant_lifecycle_events',
    'execution_slots',
    'execution_batches',
    'reconciliation_cases',
    'experiments_v16',
    'experiment_snapshots_v16',
    'causal_events_v16',
    'ad_execution_reconciliation_cases',
    'legacy_record_classifications',
    'ai_spend_policies',
    'ai_cost_records',
]);

export interface S7FileIdentity {
    deviceId: string;
    fileId: string;
    hardLinkCount: number;
}

export interface S7StableFileArtifact {
    path: string;
    realPath: string;
    sha256: string;
    sizeBytes: number;
    mtimeMs: number;
    identity: S7FileIdentity;
}

export interface S7WindowsPathSecurity {
    passed: boolean;
    path: string;
    type: 'file' | 'directory';
    ownerSid: string;
    currentUserSid: string;
    inheritanceProtected: boolean;
    unauthorizedRules: string[];
}

export interface S7PostMigrationAuthorityState {
    targetVersion: number;
    integrityCheck: 'ok';
    foreignKeyViolationCount: 0;
    migrationRows: Array<{
        version: number;
        name: string;
        checksum: string;
        status: 'applied';
    }>;
    requiredTables: string[];
    contractSha256: string;
}

export interface S7StartupGateIo {
    existsSync(filePath: string): boolean;
    readStableFile(filePath: string, label: string, options?: {
        captureContents?: boolean;
        maxBytes?: number;
    }): S7StableFileArtifact & {
        contents?: Buffer;
    };
    inspectDirectory(filePath: string, label: string): {
        realPath: string;
        identity: S7FileIdentity;
    };
    buildAppContentManifest(rootPath: string): GatePackageBinding['appContent'];
    readAuthoritySchemaVersion(filePath: string): number;
    inspectPostMigrationAuthority(filePath: string): S7PostMigrationAuthorityState;
    inspectTrustedPowerShell(): GateTrustedShellBinding;
    inspectWindowsPathSecurity(filePath: string, type: 'file' | 'directory', label: string, trustedShell?: GateTrustedShellBinding): S7WindowsPathSecurity;
    writeExclusiveJson(filePath: string, value: unknown): void;
    writeProtectedExclusiveJson(filePath: string, value: unknown, trustedShell?: GateTrustedShellBinding): void;
    protectWindowsPath(filePath: string, type: 'file' | 'directory'): void;
    sleep(milliseconds: number): void;
}

export interface S7AuthorityPathProtectionPort {
    inspectWindowsPathSecurity(filePath: string, type: 'file' | 'directory', label: string): S7WindowsPathSecurity;
    protectWindowsPath(filePath: string, type: 'file' | 'directory'): void;
}

export interface S7StartupGateAppPort {
    requestSingleInstanceLock(): boolean;
}

export interface S7EvidenceUserDataIdentity {
    mode: string | null;
    overridden: boolean;
    userDataDir: string | null;
}

export interface EnforceS7MainStartupGateOptions {
    app: S7StartupGateAppPort;
    currentUserDataDir: string;
    canonicalUserDataDir: string;
    evidenceUserDataIdentity: S7EvidenceUserDataIdentity;
    isPackaged: boolean;
    executablePath: string;
    mainModulePath: string;
    pid?: number;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    handoffTimeoutMs?: number;
    io?: Partial<S7StartupGateIo>;
}

export type S7MainStartupAdmission = {
    mode: 'NORMAL';
    admitted: true;
    singleInstanceLockAcquired: true;
    canonicalUserDataDir: string;
} | {
    mode: 'NORMAL_POST_MIGRATION';
    admitted: true;
    singleInstanceLockAcquired: true;
    canonicalUserDataDir: string;
    finalizedReceipt: S7StableFileArtifact;
    completionReceipt: S7StableFileArtifact;
} | {
    mode: 'EVIDENCE_ISOLATED';
    admitted: true;
    singleInstanceLockAcquired: true;
    canonicalUserDataDir: string;
    evidenceUserDataDir: string;
} | {
    mode: 'S7_APPROVED_CHILD';
    admitted: true;
    singleInstanceLockAcquired: true;
    canonicalUserDataDir: string;
    gateId: string;
    invocationId: string;
    pid: number;
    activeGate: S7StableFileArtifact;
    boundGate: S7StableFileArtifact;
    handoffReady: S7StableFileArtifact;
    handoffReleased: S7StableFileArtifact;
    admissionPath: string;
    expectedDatabase: GateArtifactBinding;
    expectedPackage: GatePackageBinding;
    expectedIntent: GateArtifactBinding;
    expectedTrustedShell: GateTrustedShellBinding;
};

export interface GateArtifactBinding {
    realPath: string;
    sha256: string;
    sizeBytes: number;
    identity: S7FileIdentity;
}

export interface GatePackageBinding {
    exe: GateArtifactBinding;
    appContent: {
        realPath: string;
        sha256: string;
        fileCount: number;
        sizeBytes: number;
    };
    main: GateArtifactBinding;
}

export interface GateTrustedShellBinding {
    realPath: string;
    sha256: string;
    sizeBytes: number;
    identity: S7FileIdentity;
    hardlinkPaths: string[];
    signature: {
        status: 'Valid';
        subject: string;
        thumbprint: string;
    };
    version: {
        companyName: string;
        fileVersion: string;
        originalFilename: string;
        productName: string;
    };
}

export interface ActiveGateDocument {
    kind: typeof S7_STARTUP_GATE_ACTIVE_KIND;
    schemaVersion: typeof S7_STARTUP_GATE_ACTIVE_SCHEMA;
    status: 'ACTIVE_AWAITING_BOUND_CHILD';
    gateId: string;
    invocationId: string;
    createdAt: string;
    canonicalUserDataDir: string;
    paths: {
        active: string;
        bound: string;
        handoffReady: string;
        handoffReleased: string;
        admission: string;
        closed: string;
        finalized: string;
    };
    bindings: {
        executable: GateArtifactBinding;
        package: GatePackageBinding;
        database: GateArtifactBinding;
        intent: GateArtifactBinding;
        shell: GateTrustedShellBinding;
    };
}

export interface BoundGateDocument {
    kind: typeof S7_STARTUP_GATE_BOUND_KIND;
    schemaVersion: typeof S7_STARTUP_GATE_BOUND_SCHEMA;
    status: 'BOUND_SUSPENDED';
    gateId: string;
    invocationId: string;
    boundAt: string;
    pid: number;
    threadId: number;
    activeGate: GateArtifactBinding;
    bindings: ActiveGateDocument['bindings'];
}

export interface FinalizedGateDocument {
    kind: typeof S7_STARTUP_GATE_FINALIZED_KIND;
    schemaVersion: typeof S7_STARTUP_GATE_FINALIZED_SCHEMA | 's7-main-startup-gate-finalized/v2';
    status: 'FINALIZED_FOR_POST_MIGRATION_STARTUP' | 'RECOVERED_AFTER_FAILED_MIGRATION_PROCESS';
    finalizedAt: string;
    gateId: string;
    invocationId: string;
    canonicalUserDataDir: string;
    approvalPayloadSha256: string;
    approvalPacket: GateArtifactBinding;
    launchReceipt: GateArtifactBinding;
    acceptanceReceipt: GateArtifactBinding;
    finalizationPacket: GateArtifactBinding;
    activeGate: GateArtifactBinding;
    boundGate: GateArtifactBinding;
    handoffReady: GateArtifactBinding;
    handoffReleased: GateArtifactBinding;
    admission: GateArtifactBinding;
    closed: GateArtifactBinding | null;
    recovery?: S7PostWriteRecovery;
    databaseAfterMigration: GateArtifactBinding;
    packageAtMigration: GatePackageBinding;
    shellAtMigration: GateTrustedShellBinding;
    machine: {
        computerName: string;
        currentUserSid: string;
        databaseDeviceId: string;
        databaseFileId: string;
    };
    authority: S7PostMigrationAuthorityState;
    finalizationPayloadSha256: string;
    formalAppReadiness: false;
    adsExecutionAuthorized: false;
}

export interface S7PostWriteRecovery {
    failurePhase: 'child-exit-failed-before-closed-receipt';
    exitCode: number | null;
    backup: GateArtifactBinding;
    intent: GateArtifactBinding;
    package: GatePackageBinding;
}

export interface PostMigrationAdmissionDocument {
    kind: typeof S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND;
    schemaVersion: typeof S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA;
    status: 'POST_MIGRATION_ADMITTED';
    admittedAt: string;
    gateId: string;
    invocationId: string;
    canonicalUserDataDir: string;
    finalized: GateArtifactBinding;
    activeGate: GateArtifactBinding;
    closed: GateArtifactBinding | null;
    acceptanceReceipt: GateArtifactBinding;
    databaseAtFirstAdmission: GateArtifactBinding;
    databaseIdentity: {
        realPath: string;
        deviceId: string;
        fileId: string;
        hardLinkCount: 1;
    };
    machine: FinalizedGateDocument['machine'];
    authorityContractSha256: string;
    migrationPackage: GatePackageBinding;
    migrationShell: GateTrustedShellBinding;
    completionPayloadSha256: string;
}

export function fail(code: string, detail: string): never {
    throw new Error(`${code}: ${detail}`);
}

export function normalizeSha(value: unknown, label: string): string {
    const normalized = String(value || '').trim().toUpperCase();
    if (!HASH_PATTERN.test(normalized))
        fail('S7_STARTUP_GATE_INVALID', `${label} SHA-256 is invalid.`);
    return normalized;
}

export function requireSafeIdentifier(value: unknown, label: string): string {
    const result = String(value || '');
    if (!SAFE_IDENTIFIER_PATTERN.test(result)) {
        fail('S7_STARTUP_GATE_INVALID', `${label} is invalid.`);
    }
    return result;
}

export function requireFiniteTimestamp(value: unknown, label: string): string {
    const result = String(value || '');
    if (!Number.isFinite(Date.parse(result))) {
        fail('S7_STARTUP_GATE_INVALID', `${label} timestamp is invalid.`);
    }
    return new Date(result).toISOString();
}

export function normalizePathForComparison(filePath: string): string {
    return path.win32.normalize(path.resolve(filePath)).replace(/[\\/]+$/, '').toLowerCase();
}

export function samePath(left: unknown, right: unknown): boolean {
    return typeof left === 'string'
        && typeof right === 'string'
        && normalizePathForComparison(left) === normalizePathForComparison(right);
}

export function isPathWithin(rootPath: string, candidatePath: string): boolean {
    const relative = path.win32.relative(path.win32.normalize(rootPath), path.win32.normalize(candidatePath));
    return relative === '' || (relative !== '..'
        && !relative.startsWith(`..${path.win32.sep}`)
        && !path.win32.isAbsolute(relative));
}

export function stableJson(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => (`${JSON.stringify(key)}:${stableJson(record[key])}`)).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

export function exactKeys(value: unknown, keys: readonly string[]): boolean {
    return Boolean(value
        && typeof value === 'object'
        && !Array.isArray(value)
        && stableJson(Object.keys(value as Record<string, unknown>).sort())
            === stableJson([...keys].sort()));
}

export function sha256(contents: Buffer | string): string {
    return crypto.createHash('sha256').update(contents).digest('hex').toUpperCase();
}

export function fileIdentity(stat: fs.BigIntStats): S7FileIdentity {
    return {
        deviceId: stat.dev.toString(),
        fileId: stat.ino.toString(),
        hardLinkCount: Number(stat.nlink),
    };
}

export function sameIdentity(left: S7FileIdentity, right: S7FileIdentity): boolean {
    return left.deviceId === right.deviceId
        && left.fileId === right.fileId
        && left.hardLinkCount === right.hardLinkCount;
}

export function sameArtifact(left: Pick<S7StableFileArtifact, 'realPath' | 'sha256' | 'sizeBytes' | 'identity'>, right: Pick<S7StableFileArtifact, 'realPath' | 'sha256' | 'sizeBytes' | 'identity'>): boolean {
    return samePath(left.realPath, right.realPath)
        && left.sha256 === right.sha256
        && left.sizeBytes === right.sizeBytes
        && sameIdentity(left.identity, right.identity);
}

export interface CompletedS7Chain {
    active: ActiveGateDocument;
    activeArtifact: S7StableFileArtifact;
    boundArtifact: S7StableFileArtifact;
    handoffReadyArtifact: S7StableFileArtifact;
    handoffReleasedArtifact: S7StableFileArtifact;
    admissionArtifact: S7StableFileArtifact;
    closedArtifact: S7StableFileArtifact | null;
    finalized: FinalizedGateDocument;
    finalizedArtifact: S7StableFileArtifact;
}

export function publicArtifact(artifact: S7StableFileArtifact & {
    contents?: Buffer;
}): S7StableFileArtifact {
    return {
        path: artifact.path,
        realPath: artifact.realPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        mtimeMs: artifact.mtimeMs,
        identity: { ...artifact.identity },
    };
}

export interface CompleteS7MainStartupAdmissionOptions {
    startup: Extract<S7MainStartupAdmission, {
        mode: 'S7_APPROVED_CHILD';
    }>;
    database: Database.Database;
    resolvedDatabasePath: string;
    executablePath: string;
    mainModulePath: string;
    now?: () => Date;
    io?: Partial<S7StartupGateIo>;
}
