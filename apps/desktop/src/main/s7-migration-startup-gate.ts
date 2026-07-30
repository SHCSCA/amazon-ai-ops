import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import {
  ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM,
  ANALYSIS_AUTHORITY_MIGRATION_NAME,
  ANALYSIS_AUTHORITY_MIGRATION_VERSION,
  EXECUTION_AUTHORITY_MIGRATION_CHECKSUM,
  EXECUTION_AUTHORITY_MIGRATION_NAME,
  EXECUTION_AUTHORITY_MIGRATION_VERSION,
  LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
  LISTING_STORE_AUTHORITY_MIGRATION_NAME,
  LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
  MISSION_DOMAIN_MIGRATION_CHECKSUM,
  MISSION_DOMAIN_MIGRATION_NAME,
  MISSION_DOMAIN_MIGRATION_VERSION,
  OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM,
  OPERATION_EVENT_ARCHIVE_MIGRATION_NAME,
  OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
  PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM,
  PRODUCT_STORE_AUTHORITY_MIGRATION_NAME,
  PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
  REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM,
  REPORT_IMPORT_AUTHORITY_MIGRATION_NAME,
  REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
  STORE_AUTHORITY_MIGRATION_CHECKSUM,
  STORE_AUTHORITY_MIGRATION_NAME,
  STORE_AUTHORITY_MIGRATION_VERSION,
  STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
  STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
  STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
} from '@amazon-ai-ops/local-db/src/sqlite/migrations';

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
export const S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND =
  's7-main-post-migration-admitted';
export const S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA =
  's7-main-post-migration-admitted/v1';

export const S7_STARTUP_GATE_ENV = Object.freeze({
  activePathB64: 'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
  activeSha256: 'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
  activeDeviceId: 'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
  activeFileId: 'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
  gateId: 'AAO_S7_STARTUP_GATE_ID',
  invocationId: 'AAO_S7_STARTUP_INVOCATION_ID',
});

const GATE_ENV_NAMES = Object.freeze(Object.values(S7_STARTUP_GATE_ENV));
const HASH_PATTERN = /^[A-F0-9]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_GATE_FILE_BYTES = 1024 * 1024;
const MAX_APP_CONTENT_FILES = 250_000;
const MAX_APP_CONTENT_DEPTH = 64;
const DEFAULT_HANDOFF_TIMEOUT_MS = 30_000;
const HANDOFF_POLL_MS = 25;
const WINDOWS_SYSTEM_SID = 'S-1-5-18';
const WINDOWS_ADMINISTRATORS_SID = 'S-1-5-32-544';
const WINDOWS_TRUSTED_INSTALLER_SID =
  'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const FULL_CONTROL_MASK = 2032127n;
const WINDOWS_WRITE_RIGHTS_MASK =
  0x00000002n | 0x00000004n | 0x00000100n | 0x00010000n | 0x00040000n | 0x00080000n;
const POST_MIGRATION_TARGET_VERSION = 9;

const POST_MIGRATION_CONTRACT = Object.freeze([
  {
    version: STORE_AUTHORITY_MIGRATION_VERSION,
    name: STORE_AUTHORITY_MIGRATION_NAME,
    checksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
  },
  {
    version: REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
    name: REPORT_IMPORT_AUTHORITY_MIGRATION_NAME,
    checksum: REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM,
  },
  {
    version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
    name: PRODUCT_STORE_AUTHORITY_MIGRATION_NAME,
    checksum: PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM,
  },
  {
    version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
    name: LISTING_STORE_AUTHORITY_MIGRATION_NAME,
    checksum: LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
  },
  {
    version: OPERATION_EVENT_ARCHIVE_MIGRATION_VERSION,
    name: OPERATION_EVENT_ARCHIVE_MIGRATION_NAME,
    checksum: OPERATION_EVENT_ARCHIVE_MIGRATION_CHECKSUM,
  },
  {
    version: MISSION_DOMAIN_MIGRATION_VERSION,
    name: MISSION_DOMAIN_MIGRATION_NAME,
    checksum: MISSION_DOMAIN_MIGRATION_CHECKSUM,
  },
  {
    version: ANALYSIS_AUTHORITY_MIGRATION_VERSION,
    name: ANALYSIS_AUTHORITY_MIGRATION_NAME,
    checksum: ANALYSIS_AUTHORITY_MIGRATION_CHECKSUM,
  },
  {
    version: EXECUTION_AUTHORITY_MIGRATION_VERSION,
    name: EXECUTION_AUTHORITY_MIGRATION_NAME,
    checksum: EXECUTION_AUTHORITY_MIGRATION_CHECKSUM,
  },
  {
    version: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
    name: STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
    checksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
  },
]);

const POST_MIGRATION_REQUIRED_TABLES = Object.freeze([
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

interface S7PostMigrationAuthorityState {
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

interface S7StartupGateIo {
  existsSync(filePath: string): boolean;
  readStableFile(
    filePath: string,
    label: string,
    options?: { captureContents?: boolean; maxBytes?: number },
  ): S7StableFileArtifact & { contents?: Buffer };
  inspectDirectory(filePath: string, label: string): { realPath: string; identity: S7FileIdentity };
  buildAppContentManifest(rootPath: string): GatePackageBinding['appContent'];
  readAuthoritySchemaVersion(filePath: string): number;
  inspectPostMigrationAuthority(filePath: string): S7PostMigrationAuthorityState;
  inspectTrustedPowerShell(): GateTrustedShellBinding;
  inspectWindowsPathSecurity(
    filePath: string,
    type: 'file' | 'directory',
    label: string,
    trustedShell?: GateTrustedShellBinding,
  ): S7WindowsPathSecurity;
  writeExclusiveJson(filePath: string, value: unknown): void;
  writeProtectedExclusiveJson(
    filePath: string,
    value: unknown,
    trustedShell?: GateTrustedShellBinding,
  ): void;
  protectWindowsPath(filePath: string, type: 'file' | 'directory'): void;
  sleep(milliseconds: number): void;
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

export type S7MainStartupAdmission =
  | {
    mode: 'NORMAL';
    admitted: true;
    singleInstanceLockAcquired: true;
    canonicalUserDataDir: string;
  }
  | {
    mode: 'NORMAL_POST_MIGRATION';
    admitted: true;
    singleInstanceLockAcquired: true;
    canonicalUserDataDir: string;
    finalizedReceipt: S7StableFileArtifact;
    completionReceipt: S7StableFileArtifact;
  }
  | {
    mode: 'EVIDENCE_ISOLATED';
    admitted: true;
    singleInstanceLockAcquired: true;
    canonicalUserDataDir: string;
    evidenceUserDataDir: string;
  }
  | {
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

interface GateArtifactBinding {
  realPath: string;
  sha256: string;
  sizeBytes: number;
  identity: S7FileIdentity;
}

interface GatePackageBinding {
  exe: GateArtifactBinding;
  appContent: {
    realPath: string;
    sha256: string;
    fileCount: number;
    sizeBytes: number;
  };
  main: GateArtifactBinding;
}

interface GateTrustedShellBinding {
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

interface ActiveGateDocument {
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

interface BoundGateDocument {
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

interface FinalizedGateDocument {
  kind: typeof S7_STARTUP_GATE_FINALIZED_KIND;
  schemaVersion: typeof S7_STARTUP_GATE_FINALIZED_SCHEMA;
  status: 'FINALIZED_FOR_POST_MIGRATION_STARTUP';
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
  closed: GateArtifactBinding;
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

interface PostMigrationAdmissionDocument {
  kind: typeof S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND;
  schemaVersion: typeof S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA;
  status: 'POST_MIGRATION_ADMITTED';
  admittedAt: string;
  gateId: string;
  invocationId: string;
  canonicalUserDataDir: string;
  finalized: GateArtifactBinding;
  activeGate: GateArtifactBinding;
  closed: GateArtifactBinding;
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

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

function normalizeSha(value: unknown, label: string): string {
  const normalized = String(value || '').trim().toUpperCase();
  if (!HASH_PATTERN.test(normalized)) fail('S7_STARTUP_GATE_INVALID', `${label} SHA-256 is invalid.`);
  return normalized;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  const result = String(value || '');
  if (!SAFE_IDENTIFIER_PATTERN.test(result)) {
    fail('S7_STARTUP_GATE_INVALID', `${label} is invalid.`);
  }
  return result;
}

function requireFiniteTimestamp(value: unknown, label: string): string {
  const result = String(value || '');
  if (!Number.isFinite(Date.parse(result))) {
    fail('S7_STARTUP_GATE_INVALID', `${label} timestamp is invalid.`);
  }
  return new Date(result).toISOString();
}

function normalizePathForComparison(filePath: string): string {
  return path.win32.normalize(path.resolve(filePath)).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(left: unknown, right: unknown): boolean {
  return typeof left === 'string'
    && typeof right === 'string'
    && normalizePathForComparison(left) === normalizePathForComparison(right);
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.win32.relative(
    path.win32.normalize(rootPath),
    path.win32.normalize(candidatePath),
  );
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.win32.sep}`)
    && !path.win32.isAbsolute(relative)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && stableJson(Object.keys(value as Record<string, unknown>).sort())
      === stableJson([...keys].sort()),
  );
}

function sha256(contents: Buffer | string): string {
  return crypto.createHash('sha256').update(contents).digest('hex').toUpperCase();
}

function fileIdentity(stat: fs.BigIntStats): S7FileIdentity {
  return {
    deviceId: stat.dev.toString(),
    fileId: stat.ino.toString(),
    hardLinkCount: Number(stat.nlink),
  };
}

function sameIdentity(left: S7FileIdentity, right: S7FileIdentity): boolean {
  return left.deviceId === right.deviceId
    && left.fileId === right.fileId
    && left.hardLinkCount === right.hardLinkCount;
}

function sameArtifact(
  left: Pick<S7StableFileArtifact, 'realPath' | 'sha256' | 'sizeBytes' | 'identity'>,
  right: Pick<S7StableFileArtifact, 'realPath' | 'sha256' | 'sizeBytes' | 'identity'>,
): boolean {
  return samePath(left.realPath, right.realPath)
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && sameIdentity(left.identity, right.identity);
}

function defaultReadStableFile(
  filePath: string,
  label: string,
  options: { captureContents?: boolean; maxBytes?: number } = {},
): S7StableFileArtifact & { contents?: Buffer } {
  const requested = path.resolve(filePath);
  const pathBefore = fs.lstatSync(requested, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || Number(pathBefore.nlink) !== 1) {
    fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} must be one direct, single-link file.`);
  }
  const realPath = fs.realpathSync.native(requested);
  if (!samePath(requested, realPath)) {
    fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} may not traverse a link or junction.`);
  }

  const descriptor = fs.openSync(requested, fs.constants.O_RDONLY);
  try {
    const handleBefore = fs.fstatSync(descriptor, { bigint: true });
    if (
      !handleBefore.isFile()
      || Number(handleBefore.nlink) !== 1
      || !sameIdentity(fileIdentity(pathBefore), fileIdentity(handleBefore))
    ) {
      fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} changed while it was opened.`);
    }
    if (handleBefore.size < 1n) {
      fail('S7_STARTUP_GATE_INVALID', `${label} size is outside the bounded contract.`);
    }
    const captureContents = options.captureContents === true;
    const maxBytes = options.maxBytes ?? MAX_GATE_FILE_BYTES;
    if (
      captureContents
      && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || handleBefore.size > BigInt(maxBytes))
    ) {
      fail('S7_STARTUP_GATE_INVALID', `${label} size is outside the bounded JSON contract.`);
    }
    const hash = crypto.createHash('sha256');
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    let bytesRead: number;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        if (captureContents) chunks.push(Buffer.from(chunk));
        total += bytesRead;
      }
    } while (bytesRead > 0);
    const handleAfter = fs.fstatSync(descriptor, { bigint: true });
    const pathAfter = fs.lstatSync(requested, { bigint: true });
    if (
      !sameIdentity(fileIdentity(handleBefore), fileIdentity(handleAfter))
      || !sameIdentity(fileIdentity(handleBefore), fileIdentity(pathAfter))
      || handleBefore.size !== handleAfter.size
      || handleBefore.mtimeMs !== handleAfter.mtimeMs
      || BigInt(total) !== handleAfter.size
      || !samePath(fs.realpathSync.native(requested), realPath)
    ) {
      fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} drifted during its stable read.`);
    }
    return {
      path: requested,
      realPath,
      sha256: hash.digest('hex').toUpperCase(),
      sizeBytes: Number(handleAfter.size),
      mtimeMs: Number(handleAfter.mtimeMs),
      identity: fileIdentity(handleAfter),
      contents: captureContents ? Buffer.concat(chunks, total) : undefined,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function defaultInspectDirectory(
  directoryPath: string,
  label: string,
): { realPath: string; identity: S7FileIdentity } {
  const requested = path.resolve(directoryPath);
  const before = fs.lstatSync(requested, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} must be one direct directory.`);
  }
  const realPath = fs.realpathSync.native(requested);
  if (!samePath(requested, realPath)) {
    fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} may not traverse a link or junction.`);
  }
  const after = fs.lstatSync(requested, { bigint: true });
  if (!sameIdentity(fileIdentity(before), fileIdentity(after))) {
    fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} changed during inspection.`);
  }
  return { realPath, identity: fileIdentity(after) };
}

function hashDirectSingleLinkFile(
  filePath: string,
  label: string,
): { sha256: string; sizeBytes: number; identity: S7FileIdentity; realPath: string } {
  const requested = path.resolve(filePath);
  const before = fs.lstatSync(requested, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || Number(before.nlink) !== 1) {
    fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} must be one direct, single-link file.`);
  }
  const realPath = fs.realpathSync.native(requested);
  if (!samePath(realPath, requested)) {
    fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} may not traverse a link or junction.`);
  }
  const descriptor = fs.openSync(requested, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(fileIdentity(before), fileIdentity(opened))) {
      fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} changed while it was opened.`);
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    let read = 0;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read > 0) {
        hash.update(buffer.subarray(0, read));
        total += read;
      }
    } while (read > 0);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      !sameIdentity(fileIdentity(opened), fileIdentity(after))
      || opened.size !== after.size
      || opened.mtimeMs !== after.mtimeMs
      || BigInt(total) !== after.size
      || !samePath(fs.realpathSync.native(requested), realPath)
    ) {
      fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} drifted while it was hashed.`);
    }
    return {
      realPath,
      sha256: hash.digest('hex').toUpperCase(),
      sizeBytes: total,
      identity: fileIdentity(after),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function defaultBuildAppContentManifest(
  rootPathInput: string,
): GatePackageBinding['appContent'] {
  const inspectedRoot = defaultInspectDirectory(rootPathInput, 'Packaged app-content root');
  const rootPath = inspectedRoot.realPath;
  const files: Array<{ path: string; sha256: string; sizeBytes: number }> = [];
  const visit = (directoryPath: string, depth: number): void => {
    if (depth > MAX_APP_CONTENT_DEPTH) {
      fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content nesting is unbounded.');
    }
    const names = fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right, 'en'));
    for (const name of names) {
      if (files.length >= MAX_APP_CONTENT_FILES) {
        fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content file count is unbounded.');
      }
      const targetPath = path.join(directoryPath, name);
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content contains a link.');
      }
      const realPath = fs.realpathSync.native(targetPath);
      if (!isPathWithin(rootPath, realPath)) {
        fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content escapes its fixed root.');
      }
      if (stat.isDirectory()) {
        visit(realPath, depth + 1);
        continue;
      }
      const artifact = hashDirectSingleLinkFile(targetPath, `Packaged app-content ${name}`);
      const relativePath = path.relative(rootPath, artifact.realPath).split(path.sep).join('/');
      if (
        !relativePath
        || relativePath === '..'
        || relativePath.startsWith('../')
        || path.posix.isAbsolute(relativePath)
      ) {
        fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content path is invalid.');
      }
      files.push({
        path: relativePath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      });
    }
  };
  visit(rootPath, 0);
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  if (files.length < 1) {
    fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content is empty.');
  }
  const canonical = JSON.stringify({ schemaVersion: 1, files });
  return {
    realPath: rootPath,
    sha256: sha256(Buffer.from(canonical, 'utf8')),
    fileCount: files.length,
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

function defaultReadAuthoritySchemaVersion(filePath: string): number {
  const database = new Database(path.resolve(filePath), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma('query_only = ON');
    const table = database.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get() as { count: number };
    if (table.count === 0) return 0;
    const row = database.prepare(`
      SELECT COALESCE(MAX(version), 0) AS version
      FROM schema_migrations
      WHERE status = 'applied'
    `).get() as { version: number };
    return Number(row.version);
  } finally {
    database.close();
  }
}

function postMigrationContractSha256(): string {
  return sha256(stableJson({
    targetVersion: POST_MIGRATION_TARGET_VERSION,
    migrationRows: POST_MIGRATION_CONTRACT,
    requiredTables: POST_MIGRATION_REQUIRED_TABLES,
  }));
}

function defaultInspectPostMigrationAuthority(filePath: string): S7PostMigrationAuthorityState {
  const database = new Database(path.resolve(filePath), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma('query_only = ON');
    const integrity = database.pragma('integrity_check') as Array<Record<string, unknown>>;
    const integrityCheck = String(Object.values(integrity[0] || {})[0] || '').toLowerCase();
    if (integrity.length !== 1 || integrityCheck !== 'ok') {
      fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Authority integrity_check is not exactly ok.');
    }
    const foreignKeys = database.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    if (foreignKeys.length !== 0) {
      fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Authority foreign-key invariants failed.');
    }
    const tables = new Set(
      (database.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => String(row.name)),
    );
    const missingTables = POST_MIGRATION_REQUIRED_TABLES.filter((name) => !tables.has(name));
    if (missingTables.length !== 0) {
      fail(
        'S7_STARTUP_GATE_AUTHORITY_DRIFT',
        `Authority required-table contract is incomplete (${missingTables.length} missing).`,
      );
    }
    const rows = database.prepare(`
      SELECT version, name, checksum, status
      FROM schema_migrations
      ORDER BY version
    `).all() as Array<{
      version: number;
      name: string;
      checksum: string;
      status: string;
    }>;
    const normalizedRows = rows.map((row) => ({
      version: Number(row.version),
      name: String(row.name),
      checksum: String(row.checksum),
      status: String(row.status),
    }));
    const expectedRows = POST_MIGRATION_CONTRACT.map((row) => ({
      ...row,
      status: 'applied',
    }));
    if (stableJson(normalizedRows) !== stableJson(expectedRows)) {
      fail(
        'S7_STARTUP_GATE_AUTHORITY_DRIFT',
        'Authority migration ledger name/checksum/status contract drifted.',
      );
    }
    return {
      targetVersion: POST_MIGRATION_TARGET_VERSION,
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      migrationRows: expectedRows as S7PostMigrationAuthorityState['migrationRows'],
      requiredTables: [...POST_MIGRATION_REQUIRED_TABLES],
      contractSha256: postMigrationContractSha256(),
    };
  } finally {
    database.close();
  }
}

function defaultSleep(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function windowsRoot(): string {
  const candidate = String(process.env.SYSTEMROOT || process.env.WINDIR || '');
  if (!candidate || !path.isAbsolute(candidate) || candidate.includes('\0')) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Windows root is unavailable.');
  }
  return path.resolve(candidate);
}

function assertDirectAncestors(candidate: string, root: string, label: string): void {
  const resolved = path.resolve(candidate);
  if (!isPathWithin(root, resolved)) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', `${label} is outside Windows.`);
  }
  const relative = path.relative(root, resolved);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !samePath(cursor, fs.realpathSync.native(cursor))) {
      fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', `${label} traverses a link or junction.`);
    }
  }
}

function stableServicingFile(filePath: string): S7StableFileArtifact {
  const requested = path.resolve(filePath);
  const before = fs.lstatSync(requested, { bigint: true });
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || Number(before.nlink) < 1
    || Number(before.nlink) > 8
  ) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted PowerShell file identity is invalid.');
  }
  const realPath = fs.realpathSync.native(requested);
  if (!samePath(requested, realPath)) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted PowerShell path is indirect.');
  }
  const descriptor = fs.openSync(requested, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    let read = 0;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read > 0) {
        hash.update(buffer.subarray(0, read));
        total += read;
      }
    } while (read > 0);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      !sameIdentity(fileIdentity(before), fileIdentity(opened))
      || !sameIdentity(fileIdentity(opened), fileIdentity(after))
      || opened.size !== after.size
      || opened.mtimeMs !== after.mtimeMs
      || BigInt(total) !== after.size
    ) {
      fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted PowerShell drifted during hashing.');
    }
    return {
      path: requested,
      realPath,
      sha256: hash.digest('hex').toUpperCase(),
      sizeBytes: total,
      mtimeMs: Number(after.mtimeMs),
      identity: fileIdentity(after),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function fixedWindowsPowerShellPath(): string {
  const root = windowsRoot();
  const candidate = path.join(
    root,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  assertDirectAncestors(candidate, root, 'Trusted Windows PowerShell');
  return candidate;
}

function defaultInspectTrustedPowerShell(): GateTrustedShellBinding {
  const root = windowsRoot();
  const executablePath = fixedWindowsPowerShellPath();
  const artifact = stableServicingFile(executablePath);
  const fsutil = path.join(root, 'System32', 'fsutil.exe');
  assertDirectAncestors(fsutil, root, 'Trusted fsutil');
  const runtimeEnv = pickEnvironment(process.env);
  const hardlinkResult = spawnSync(fsutil, ['hardlink', 'list', executablePath], {
    encoding: 'utf8',
    env: runtimeEnv,
    shell: false,
    windowsHide: true,
    timeout: 20_000,
  });
  if (hardlinkResult.error || hardlinkResult.status !== 0) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell hard-link enumeration failed.');
  }
  const driveRoot = path.parse(executablePath).root;
  const hardlinkPaths = String(hardlinkResult.stdout || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (
      /^[\\/]/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)
        ? path.resolve(driveRoot, value.replace(/^[\\/]+/, ''))
        : path.resolve(value)
    ))
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (
    hardlinkPaths.length !== artifact.identity.hardLinkCount
    || hardlinkPaths.length < 1
    || hardlinkPaths.length > 8
    || hardlinkPaths.reduce((total, value) => total + value.length, 0) > 8192
    || !hardlinkPaths.some((value) => samePath(value, executablePath))
  ) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell hard-link set is incomplete.');
  }
  const servicingRoot = path.join(root, 'WinSxS');
  for (const hardlinkPath of hardlinkPaths) {
    if (!samePath(hardlinkPath, executablePath) && !isPathWithin(servicingRoot, hardlinkPath)) {
      fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell has an unapproved hard-link path.');
    }
    assertDirectAncestors(hardlinkPath, root, 'PowerShell hard link');
    const stat = fs.statSync(hardlinkPath, { bigint: true });
    if (
      stat.dev.toString() !== artifact.identity.deviceId
      || stat.ino.toString() !== artifact.identity.fileId
    ) {
      fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell hard-link identity differs.');
    }
  }
  const command = String.raw`
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_TRUSTED_SHELL_B64))
$acl=[IO.File]::GetAccessControl($p)
$sidType=[Security.Principal.SecurityIdentifier]
$rules=@($acl.GetAccessRules($true,$true,$sidType) | ForEach-Object { [ordered]@{ sid=$_.IdentityReference.Value; type=$_.AccessControlType.ToString(); rights=([int64]$_.FileSystemRights).ToString(); inherited=[bool]$_.IsInherited } })
$signature=Get-AuthenticodeSignature -LiteralPath $p
$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($p)
[ordered]@{ ownerSid=$acl.GetOwner($sidType).Value; inheritanceProtected=[bool]$acl.AreAccessRulesProtected; rules=$rules; signatureStatus=$signature.Status.ToString(); signatureSubject=$signature.SignerCertificate.Subject; signatureThumbprint=$signature.SignerCertificate.Thumbprint; companyName=$version.CompanyName; fileVersion=$version.FileVersion; productName=$version.ProductName; originalFilename=$version.OriginalFilename } | ConvertTo-Json -Compress -Depth 6
`;
  const result = spawnSync(executablePath, ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    env: {
      ...runtimeEnv,
      AAO_S7_TRUSTED_SHELL_B64: Buffer.from(executablePath, 'utf8').toString('base64'),
    },
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell signature/ACL inspection failed.');
  }
  let proof: Record<string, unknown>;
  try {
    proof = JSON.parse(String(result.stdout || '').trim()) as Record<string, unknown>;
  } catch {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell signature/ACL proof is invalid.');
  }
  const rules = Array.isArray(proof.rules) ? proof.rules : proof.rules ? [proof.rules] : [];
  const unsafeWritable = rules.some((ruleValue) => {
    const rule = ruleValue as Record<string, unknown>;
    let rights: bigint;
    try {
      rights = BigInt(String(rule.rights || ''));
    } catch {
      return true;
    }
    return String(rule.type) !== 'Allow'
      || rule.inherited === true
      || (
        (rights & WINDOWS_WRITE_RIGHTS_MASK) !== 0n
        && ![
          WINDOWS_TRUSTED_INSTALLER_SID,
          WINDOWS_SYSTEM_SID,
          WINDOWS_ADMINISTRATORS_SID,
        ].includes(String(rule.sid || ''))
      );
  });
  if (
    ![WINDOWS_TRUSTED_INSTALLER_SID, WINDOWS_SYSTEM_SID].includes(String(proof.ownerSid || ''))
    || proof.inheritanceProtected !== true
    || unsafeWritable
    || proof.signatureStatus !== 'Valid'
    || !/Microsoft/i.test(String(proof.signatureSubject || ''))
    || !/^Microsoft/i.test(String(proof.companyName || ''))
    || !String(proof.fileVersion || '')
    || !String(proof.originalFilename || '').toLowerCase().includes('powershell')
  ) {
    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell signature, owner, or ACL is invalid.');
  }
  return {
    realPath: artifact.realPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    identity: artifact.identity,
    hardlinkPaths,
    signature: {
      status: 'Valid',
      subject: String(proof.signatureSubject),
      thumbprint: String(proof.signatureThumbprint || '').toUpperCase(),
    },
    version: {
      companyName: String(proof.companyName),
      fileVersion: String(proof.fileVersion),
      originalFilename: String(proof.originalFilename),
      productName: String(proof.productName || ''),
    },
  };
}

function pickEnvironment(
  source: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const root = windowsRoot();
  const result: NodeJS.ProcessEnv = {
    COMSPEC: path.join(root, 'System32', 'cmd.exe'),
    PATH: [
      path.join(root, 'System32'),
      path.join(root, 'System32', 'Wbem'),
      path.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(path.delimiter),
    PATHEXT: String(source.PATHEXT || '.COM;.EXE;.BAT;.CMD'),
    SYSTEMDRIVE: path.parse(root).root.replace(/[\\/]$/, ''),
    SYSTEMROOT: root,
    WINDIR: root,
  };
  for (const key of ['TEMP', 'TMP'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value && !value.includes('\0')) result[key] = value;
  }
  return { ...result, ...extra };
}

const WINDOWS_SECURITY_INSPECTOR = String.raw`
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_PATH_B64))
$type=$env:AAO_S7_PATH_TYPE
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($type -eq 'directory') {
  $acl=[IO.Directory]::GetAccessControl($p)
} elseif ($type -eq 'file') {
  $acl=[IO.File]::GetAccessControl($p)
} else {
  throw 'invalid-path-type'
}
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
$safe=@($current,'S-1-5-18','S-1-5-32-544')
$unauthorized=@()
foreach ($rule in $rules) {
  $sid=$rule.IdentityReference.Value
  $rights=[int64]$rule.FileSystemRights
  if (
    $rule.IsInherited -or
    $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
    $safe -notcontains $sid -or
    (($rights -band 2032127) -ne 2032127)
  ) {
    $unauthorized += ($sid + ':' + $rule.AccessControlType + ':' + $rights + ':' + $rule.IsInherited)
  }
}
[ordered]@{
  path=$p
  type=$type
  ownerSid=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  currentUserSid=$current
  inheritanceProtected=[bool]$acl.AreAccessRulesProtected
  seenSids=@($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
  unauthorizedRules=$unauthorized
} | ConvertTo-Json -Compress
`;

function defaultInspectWindowsPathSecurity(
  filePath: string,
  type: 'file' | 'directory',
  label: string,
  trustedShell?: GateTrustedShellBinding,
): S7WindowsPathSecurity {
  const resolved = path.resolve(filePath);
  const shell = trustedShell
    ? requireTrustedShellBinding(trustedShell)
    : null;
  const shellPath = shell?.realPath ?? fixedWindowsPowerShellPath();
  const shellBefore = shell ? stableServicingFile(shellPath) : null;
  if (
    shell
    && (
      !samePath(shellBefore?.realPath, shell.realPath)
      || shellBefore?.sha256 !== shell.sha256
      || shellBefore?.sizeBytes !== shell.sizeBytes
      || shellBefore?.identity.deviceId !== shell.identity.deviceId
      || shellBefore?.identity.fileId !== shell.identity.fileId
      || shellBefore?.identity.hardLinkCount !== shell.identity.hardLinkCount
    )
  ) {
    fail(
      'S7_STARTUP_GATE_SHELL_UNTRUSTED',
      `${label} ACL inspector PowerShell no longer matches its authenticated binding.`,
    );
  }
  const result = spawnSync(
    shellPath,
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SECURITY_INSPECTOR],
    {
      encoding: 'utf8',
      env: pickEnvironment(process.env, {
        AAO_S7_PATH_B64: Buffer.from(resolved, 'utf8').toString('base64'),
        AAO_S7_PATH_TYPE: type,
      }),
      shell: false,
      windowsHide: true,
      timeout: 20_000,
    },
  );
  if (result.error || result.status !== 0) {
    fail(
      'S7_STARTUP_GATE_ACL_UNTRUSTED',
      `${label} ACL inspection failed: ${result.error?.message || result.stderr || 'unknown failure'}.`,
    );
  }
  if (shell) {
    const shellAfter = stableServicingFile(shellPath);
    if (
      shellAfter.sha256 !== shell.sha256
      || shellAfter.sizeBytes !== shell.sizeBytes
      || shellAfter.identity.deviceId !== shell.identity.deviceId
      || shellAfter.identity.fileId !== shell.identity.fileId
      || shellAfter.identity.hardLinkCount !== shell.identity.hardLinkCount
    ) {
      fail(
        'S7_STARTUP_GATE_SHELL_UNTRUSTED',
        `${label} ACL inspector PowerShell drifted during inspection.`,
      );
    }
  }
  let parsed: {
    path?: string;
    type?: string;
    ownerSid?: string;
    currentUserSid?: string;
    inheritanceProtected?: boolean;
    seenSids?: string[] | string;
    unauthorizedRules?: string[] | string;
  };
  try {
    parsed = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, '').trim());
  } catch {
    fail('S7_STARTUP_GATE_ACL_UNTRUSTED', `${label} ACL proof was not JSON.`);
  }
  const seenSids = Array.isArray(parsed.seenSids)
    ? parsed.seenSids
    : typeof parsed.seenSids === 'string'
      ? [parsed.seenSids]
      : [];
  const unauthorizedRules = Array.isArray(parsed.unauthorizedRules)
    ? parsed.unauthorizedRules
    : typeof parsed.unauthorizedRules === 'string'
      ? [parsed.unauthorizedRules]
      : [];
  const requiredSids = [
    String(parsed.currentUserSid || ''),
    WINDOWS_SYSTEM_SID,
    WINDOWS_ADMINISTRATORS_SID,
  ].sort();
  const passed = samePath(parsed.path, resolved)
    && parsed.type === type
    && parsed.ownerSid === parsed.currentUserSid
    && parsed.inheritanceProtected === true
    && unauthorizedRules.length === 0
    && stableJson([...new Set(seenSids)].sort()) === stableJson(requiredSids);
  return {
    passed,
    path: resolved,
    type,
    ownerSid: String(parsed.ownerSid || ''),
    currentUserSid: String(parsed.currentUserSid || ''),
    inheritanceProtected: parsed.inheritanceProtected === true,
    unauthorizedRules,
  };
}

const WINDOWS_SECURITY_PROTECTOR = String.raw`
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_PATH_B64))
$type=$env:AAO_S7_PATH_TYPE
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User
$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
if ($type -eq 'directory') {
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
} elseif ($type -eq 'file') {
  $acl=New-Object Security.AccessControl.FileSecurity
  $inherit=[Security.AccessControl.InheritanceFlags]::None
} else {
  throw 'invalid-path-type'
}
$acl.SetOwner($current)
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in @($current,$system,$admins)) {
  $rule=New-Object Security.AccessControl.FileSystemAccessRule(
    $sid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inherit,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($rule)
}
if ($type -eq 'directory') {
  [IO.Directory]::SetAccessControl($p,$acl)
} else {
  [IO.File]::SetAccessControl($p,$acl)
}
`;

function defaultProtectWindowsPath(filePath: string, type: 'file' | 'directory'): void {
  const result = spawnSync(
    fixedWindowsPowerShellPath(),
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SECURITY_PROTECTOR],
    {
      encoding: 'utf8',
      env: pickEnvironment(process.env, {
        AAO_S7_PATH_B64: Buffer.from(path.resolve(filePath), 'utf8').toString('base64'),
        AAO_S7_PATH_TYPE: type,
      }),
      shell: false,
      windowsHide: true,
      timeout: 20_000,
    },
  );
  if (result.error || result.status !== 0) {
    fail(
      'S7_STARTUP_GATE_ACL_UNTRUSTED',
      `Could not protect ${type} ACL: ${result.error?.message || result.stderr || 'unknown failure'}.`,
    );
  }
}

function defaultWriteExclusiveJson(filePath: string, value: unknown): void {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  const descriptor = fs.openSync(path.resolve(filePath), 'wx');
  try {
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function flushParentDirectoryWhereSupported(filePath: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(path.dirname(path.resolve(filePath)), fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(String(code))) {
      throw error;
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function defaultWriteProtectedExclusiveJson(
  filePath: string,
  value: unknown,
  trustedShell?: GateTrustedShellBinding,
): void {
  const finalPath = path.resolve(filePath);
  const temporaryPath = path.join(
    path.dirname(finalPath),
    `.tmp-${path.basename(finalPath)}-${crypto.randomUUID()}`,
  );
  let descriptor: number | null = null;
  let published = false;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx');
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    defaultProtectWindowsPath(temporaryPath, 'file');
    const security = defaultInspectWindowsPathSecurity(
      temporaryPath,
      'file',
      'Post-migration admission staging receipt',
      trustedShell,
    );
    if (
      security.passed !== true
      || security.ownerSid !== security.currentUserSid
      || security.inheritanceProtected !== true
      || security.unauthorizedRules.length !== 0
    ) {
      fail(
        'S7_STARTUP_GATE_ACL_UNTRUSTED',
        'Post-migration admission staging receipt ACL/owner proof failed.',
      );
    }
    fs.linkSync(temporaryPath, finalPath);
    published = true;
    fs.unlinkSync(temporaryPath);
    flushParentDirectoryWhereSupported(finalPath);
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original write/publication error.
      }
    }
    if (!published && fs.existsSync(temporaryPath)) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // A leftover staging file is fail-closed evidence for manual recovery.
      }
    }
    throw error;
  }
}

const DEFAULT_IO: S7StartupGateIo = {
  existsSync: (filePath) => fs.existsSync(filePath),
  readStableFile: defaultReadStableFile,
  inspectDirectory: defaultInspectDirectory,
  buildAppContentManifest: defaultBuildAppContentManifest,
  readAuthoritySchemaVersion: defaultReadAuthoritySchemaVersion,
  inspectPostMigrationAuthority: defaultInspectPostMigrationAuthority,
  inspectTrustedPowerShell: defaultInspectTrustedPowerShell,
  inspectWindowsPathSecurity: defaultInspectWindowsPathSecurity,
  writeExclusiveJson: defaultWriteExclusiveJson,
  writeProtectedExclusiveJson: defaultWriteProtectedExclusiveJson,
  protectWindowsPath: defaultProtectWindowsPath,
  sleep: defaultSleep,
};

function requireSecurePath(
  io: S7StartupGateIo,
  filePath: string,
  type: 'file' | 'directory',
  label: string,
  trustedShell?: GateTrustedShellBinding,
): void {
  const security = io.inspectWindowsPathSecurity(
    filePath,
    type,
    label,
    trustedShell,
  );
  if (
    security.passed !== true
    || security.ownerSid !== security.currentUserSid
    || security.inheritanceProtected !== true
    || security.unauthorizedRules.length !== 0
  ) {
    fail('S7_STARTUP_GATE_ACL_UNTRUSTED', `${label} ACL/owner proof failed.`);
  }
}

function parseJsonFile<T>(
  artifact: S7StableFileArtifact & { contents?: Buffer },
  label: string,
): T {
  if (!Buffer.isBuffer(artifact.contents)) {
    fail('S7_STARTUP_GATE_INVALID', `${label} contents were not captured.`);
  }
  try {
    return JSON.parse(artifact.contents.toString('utf8').replace(/^\uFEFF/, '')) as T;
  } catch {
    fail('S7_STARTUP_GATE_INVALID', `${label} is not valid JSON.`);
  }
}

function requireArtifactBinding(value: unknown, label: string): GateArtifactBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('S7_STARTUP_GATE_INVALID', `${label} binding is missing.`);
  }
  const record = value as Record<string, unknown>;
  const identity = record.identity as Record<string, unknown> | undefined;
  const realPath = String(record.realPath || '');
  const sizeBytes = Number(record.sizeBytes);
  const hardLinkCount = Number(identity?.hardLinkCount);
  if (
    !path.isAbsolute(realPath)
    || !Number.isInteger(sizeBytes)
    || sizeBytes < 1
    || !identity
    || !String(identity.deviceId || '')
    || !String(identity.fileId || '')
    || hardLinkCount !== 1
  ) {
    fail('S7_STARTUP_GATE_INVALID', `${label} binding shape is invalid.`);
  }
  return {
    realPath,
    sha256: normalizeSha(record.sha256, label),
    sizeBytes,
    identity: {
      deviceId: String(identity.deviceId),
      fileId: String(identity.fileId),
      hardLinkCount,
    },
  };
}

function requireTrustedShellBinding(value: unknown): GateTrustedShellBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('S7_STARTUP_GATE_INVALID', 'Trusted PowerShell binding is missing.');
  }
  const record = value as Record<string, unknown>;
  const identity = record.identity as Record<string, unknown> | undefined;
  const hardlinkPaths = Array.isArray(record.hardlinkPaths)
    ? record.hardlinkPaths.map((item) => String(item))
    : [];
  const signature = record.signature as Record<string, unknown> | undefined;
  const version = record.version as Record<string, unknown> | undefined;
  const result: GateTrustedShellBinding = {
    realPath: String(record.realPath || ''),
    sha256: normalizeSha(record.sha256, 'Trusted PowerShell'),
    sizeBytes: Number(record.sizeBytes),
    identity: {
      deviceId: String(identity?.deviceId || ''),
      fileId: String(identity?.fileId || ''),
      hardLinkCount: Number(identity?.hardLinkCount),
    },
    hardlinkPaths,
    signature: {
      status: String(signature?.status || '') as 'Valid',
      subject: String(signature?.subject || ''),
      thumbprint: String(signature?.thumbprint || '').toUpperCase(),
    },
    version: {
      companyName: String(version?.companyName || ''),
      fileVersion: String(version?.fileVersion || ''),
      originalFilename: String(version?.originalFilename || ''),
      productName: String(version?.productName || ''),
    },
  };
  if (
    !path.isAbsolute(result.realPath)
    || !Number.isInteger(result.sizeBytes)
    || result.sizeBytes < 1
    || !result.identity.deviceId
    || !result.identity.fileId
    || !Number.isInteger(result.identity.hardLinkCount)
    || result.identity.hardLinkCount < 1
    || result.identity.hardLinkCount > 8
    || result.hardlinkPaths.length !== result.identity.hardLinkCount
    || result.hardlinkPaths.some((item) => !path.isAbsolute(item))
    || result.hardlinkPaths.reduce((total, item) => total + item.length, 0) > 8192
    || result.signature.status !== 'Valid'
    || !/Microsoft/i.test(result.signature.subject)
    || !result.signature.thumbprint
    || !/^Microsoft/i.test(result.version.companyName)
    || !result.version.fileVersion
    || !result.version.originalFilename.toLowerCase().includes('powershell')
  ) {
    fail('S7_STARTUP_GATE_INVALID', 'Trusted PowerShell binding shape is invalid.');
  }
  return result;
}

function requirePackageBinding(value: unknown): GatePackageBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('S7_STARTUP_GATE_INVALID', 'Package binding is missing.');
  }
  const record = value as Record<string, unknown>;
  const appContent = record.appContent as Record<string, unknown> | undefined;
  if (
    !appContent
    || !path.isAbsolute(String(appContent.realPath || ''))
    || !Number.isInteger(Number(appContent.fileCount))
    || Number(appContent.fileCount) < 1
    || !Number.isInteger(Number(appContent.sizeBytes))
    || Number(appContent.sizeBytes) < 1
  ) {
    fail('S7_STARTUP_GATE_INVALID', 'Package app-content binding is invalid.');
  }
  return {
    exe: requireArtifactBinding(record.exe, 'Package executable'),
    appContent: {
      realPath: String(appContent.realPath),
      sha256: normalizeSha(appContent.sha256, 'Package app content'),
      fileCount: Number(appContent.fileCount),
      sizeBytes: Number(appContent.sizeBytes),
    },
    main: requireArtifactBinding(record.main, 'Package Main'),
  };
}

function requireActiveGate(
  value: unknown,
  expected: {
    canonicalUserDataDir: string;
    activePath: string;
    gateId: string;
    invocationId: string;
  },
): ActiveGateDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('S7_STARTUP_GATE_INVALID', 'ACTIVE gate document is missing.');
  }
  const record = value as Record<string, unknown>;
  const paths = record.paths as Record<string, unknown> | undefined;
  const bindings = record.bindings as Record<string, unknown> | undefined;
  const gateDirectory = path.join(expected.canonicalUserDataDir, S7_STARTUP_GATE_DIRECTORY);
  const expectedBound = path.join(gateDirectory, S7_STARTUP_GATE_BOUND_FILE);
  const expectedHandoffReady = path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_READY_FILE);
  const expectedHandoffReleased = path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE);
  const expectedAdmission = path.join(gateDirectory, S7_STARTUP_GATE_ADMISSION_FILE);
  const expectedClosed = path.join(gateDirectory, S7_STARTUP_GATE_CLOSED_FILE);
  const expectedFinalized = path.join(gateDirectory, S7_STARTUP_GATE_FINALIZED_FILE);
  if (
    record.kind !== S7_STARTUP_GATE_ACTIVE_KIND
    || record.schemaVersion !== S7_STARTUP_GATE_ACTIVE_SCHEMA
    || record.status !== 'ACTIVE_AWAITING_BOUND_CHILD'
    || requireSafeIdentifier(record.gateId, 'Gate ID') !== expected.gateId
    || requireSafeIdentifier(record.invocationId, 'Invocation ID') !== expected.invocationId
    || !samePath(record.canonicalUserDataDir, expected.canonicalUserDataDir)
    || !paths
    || !samePath(paths.active, expected.activePath)
    || !samePath(paths.bound, expectedBound)
    || !samePath(paths.handoffReady, expectedHandoffReady)
    || !samePath(paths.handoffReleased, expectedHandoffReleased)
    || !samePath(paths.admission, expectedAdmission)
    || !samePath(paths.closed, expectedClosed)
    || !samePath(paths.finalized, expectedFinalized)
    || !bindings
  ) {
    fail('S7_STARTUP_GATE_INVALID', 'ACTIVE gate binding does not match the canonical launch.');
  }
  requireFiniteTimestamp(record.createdAt, 'ACTIVE gate creation');
  return {
    kind: S7_STARTUP_GATE_ACTIVE_KIND,
    schemaVersion: S7_STARTUP_GATE_ACTIVE_SCHEMA,
    status: 'ACTIVE_AWAITING_BOUND_CHILD',
    gateId: expected.gateId,
    invocationId: expected.invocationId,
    createdAt: String(record.createdAt),
    canonicalUserDataDir: expected.canonicalUserDataDir,
    paths: {
      active: expected.activePath,
      bound: expectedBound,
      handoffReady: expectedHandoffReady,
      handoffReleased: expectedHandoffReleased,
      admission: expectedAdmission,
      closed: expectedClosed,
      finalized: expectedFinalized,
    },
    bindings: {
      executable: requireArtifactBinding(bindings.executable, 'Approved executable'),
      package: requirePackageBinding(bindings.package),
      database: requireArtifactBinding(bindings.database, 'Authority database'),
      intent: requireArtifactBinding(bindings.intent, 'Launch intent'),
      shell: requireTrustedShellBinding(bindings.shell),
    },
  };
}

function requireBoundGate(
  value: unknown,
  active: ActiveGateDocument,
  activeArtifact: S7StableFileArtifact,
  pid: number,
): BoundGateDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('S7_STARTUP_GATE_INVALID', 'BOUND gate document is missing.');
  }
  const record = value as Record<string, unknown>;
  const bindings = record.bindings as Record<string, unknown> | undefined;
  if (
    record.kind !== S7_STARTUP_GATE_BOUND_KIND
    || record.schemaVersion !== S7_STARTUP_GATE_BOUND_SCHEMA
    || record.status !== 'BOUND_SUSPENDED'
    || record.gateId !== active.gateId
    || record.invocationId !== active.invocationId
    || Number(record.pid) !== pid
    || !Number.isInteger(Number(record.threadId))
    || Number(record.threadId) < 1
    || !bindings
  ) {
    fail('S7_STARTUP_GATE_INVALID', 'BOUND gate is not bound to this approved process.');
  }
  requireFiniteTimestamp(record.boundAt, 'BOUND gate');
  const boundActive = requireArtifactBinding(record.activeGate, 'BOUND ACTIVE gate');
  if (!sameArtifact(boundActive, activeArtifact)) {
    fail('S7_STARTUP_GATE_INVALID', 'BOUND gate does not bind the stable ACTIVE gate identity.');
  }
  const normalizedBindings = {
    executable: requireArtifactBinding(bindings.executable, 'BOUND executable'),
    package: requirePackageBinding(bindings.package),
    database: requireArtifactBinding(bindings.database, 'BOUND database'),
    intent: requireArtifactBinding(bindings.intent, 'BOUND intent'),
    shell: requireTrustedShellBinding(bindings.shell),
  };
  if (stableJson(normalizedBindings) !== stableJson(active.bindings)) {
    fail('S7_STARTUP_GATE_INVALID', 'ACTIVE and BOUND launch bindings differ.');
  }
  return {
    kind: S7_STARTUP_GATE_BOUND_KIND,
    schemaVersion: S7_STARTUP_GATE_BOUND_SCHEMA,
    status: 'BOUND_SUSPENDED',
    gateId: active.gateId,
    invocationId: active.invocationId,
    boundAt: String(record.boundAt),
    pid,
    threadId: Number(record.threadId),
    activeGate: boundActive,
    bindings: normalizedBindings,
  };
}

function requireHandoffReleased(
  value: unknown,
  active: ActiveGateDocument,
  activeArtifact: S7StableFileArtifact,
  boundArtifact: S7StableFileArtifact,
  readyArtifact: S7StableFileArtifact,
  pid: number,
): { helperPid: number; releasedAt: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'HANDOFF_RELEASED document is missing.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind !== S7_STARTUP_GATE_HANDOFF_RELEASED_KIND
    || record.schemaVersion !== S7_STARTUP_GATE_HANDOFF_RELEASED_SCHEMA
    || record.status !== 'DB_HANDLE_RELEASED'
    || record.gateId !== active.gateId
    || record.invocationId !== active.invocationId
    || Number(record.pid) !== pid
    || !Number.isInteger(Number(record.helperPid))
    || Number(record.helperPid) < 1
    || !sameArtifact(requireArtifactBinding(record.activeGate, 'Released ACTIVE'), activeArtifact)
    || !sameArtifact(requireArtifactBinding(record.boundGate, 'Released BOUND'), boundArtifact)
    || !sameArtifact(requireArtifactBinding(record.handoffReady, 'Released READY'), readyArtifact)
    || stableJson(requireArtifactBinding(record.database, 'Released database'))
      !== stableJson(active.bindings.database)
    || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)
  ) {
    fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'HANDOFF_RELEASED binding is invalid.');
  }
  return {
    helperPid: Number(record.helperPid),
    releasedAt: requireFiniteTimestamp(record.releasedAt, 'HANDOFF_RELEASED'),
  };
}

function requireStrictArtifactBinding(value: unknown, label: string): GateArtifactBinding {
  const record = value as Record<string, unknown> | null;
  const identity = record?.identity as Record<string, unknown> | null;
  if (
    !exactKeys(record, ['realPath', 'sha256', 'sizeBytes', 'identity'])
    || !exactKeys(identity, ['deviceId', 'fileId', 'hardLinkCount'])
  ) {
    fail('S7_STARTUP_GATE_INVALID', `${label} has extra or missing binding fields.`);
  }
  return requireArtifactBinding(value, label);
}

function requireStrictPackageBinding(value: unknown): GatePackageBinding {
  const record = value as Record<string, unknown> | null;
  const appContent = record?.appContent as Record<string, unknown> | null;
  if (
    !exactKeys(record, ['exe', 'appContent', 'main'])
    || !exactKeys(appContent, ['realPath', 'sha256', 'fileCount', 'sizeBytes'])
  ) {
    fail('S7_STARTUP_GATE_INVALID', 'Finalized package binding has extra or missing fields.');
  }
  requireStrictArtifactBinding(record?.exe, 'Finalized package executable');
  requireStrictArtifactBinding(record?.main, 'Finalized package Main');
  return requirePackageBinding(value);
}

function requireStrictTrustedShellBinding(value: unknown): GateTrustedShellBinding {
  const record = value as Record<string, unknown> | null;
  if (
    !exactKeys(record, [
      'realPath',
      'sha256',
      'sizeBytes',
      'identity',
      'hardlinkPaths',
      'signature',
      'version',
    ])
    || !exactKeys(record?.identity, ['deviceId', 'fileId', 'hardLinkCount'])
    || !exactKeys(record?.signature, ['status', 'subject', 'thumbprint'])
    || !exactKeys(record?.version, [
      'companyName',
      'fileVersion',
      'originalFilename',
      'productName',
    ])
  ) {
    fail('S7_STARTUP_GATE_INVALID', 'Finalized trusted shell has extra or missing fields.');
  }
  return requireTrustedShellBinding(value);
}

function requirePostMigrationAuthorityState(value: unknown): S7PostMigrationAuthorityState {
  const record = value as Record<string, unknown> | null;
  if (!exactKeys(record, [
    'targetVersion',
    'integrityCheck',
    'foreignKeyViolationCount',
    'migrationRows',
    'requiredTables',
    'contractSha256',
  ])) {
    fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Finalized authority contract shape is invalid.');
  }
  const migrationRows = Array.isArray(record?.migrationRows)
    ? record.migrationRows.map((row) => {
        if (!exactKeys(row, ['version', 'name', 'checksum', 'status'])) {
          fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Finalized migration row shape is invalid.');
        }
        const item = row as Record<string, unknown>;
        return {
          version: Number(item.version),
          name: String(item.name),
          checksum: String(item.checksum),
          status: String(item.status),
        };
      })
    : [];
  const requiredTables = Array.isArray(record?.requiredTables)
    ? record.requiredTables.map((item) => String(item))
    : [];
  const expectedRows = POST_MIGRATION_CONTRACT.map((row) => ({
    ...row,
    status: 'applied',
  }));
  if (
    Number(record?.targetVersion) !== POST_MIGRATION_TARGET_VERSION
    || record?.integrityCheck !== 'ok'
    || Number(record?.foreignKeyViolationCount) !== 0
    || stableJson(migrationRows) !== stableJson(expectedRows)
    || stableJson(requiredTables) !== stableJson(POST_MIGRATION_REQUIRED_TABLES)
    || normalizeSha(record?.contractSha256, 'Finalized authority contract')
      !== postMigrationContractSha256()
  ) {
    fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Finalized authority contract is not current.');
  }
  return {
    targetVersion: POST_MIGRATION_TARGET_VERSION,
    integrityCheck: 'ok',
    foreignKeyViolationCount: 0,
    migrationRows: expectedRows as S7PostMigrationAuthorityState['migrationRows'],
    requiredTables: [...POST_MIGRATION_REQUIRED_TABLES],
    contractSha256: postMigrationContractSha256(),
  };
}

function requireFinalizedMachine(
  value: unknown,
  database: GateArtifactBinding,
): FinalizedGateDocument['machine'] {
  const record = value as Record<string, unknown> | null;
  if (!exactKeys(record, [
    'computerName',
    'currentUserSid',
    'databaseDeviceId',
    'databaseFileId',
  ])) {
    fail('S7_STARTUP_GATE_INVALID', 'Finalized machine binding shape is invalid.');
  }
  const result = {
    computerName: String(record?.computerName || ''),
    currentUserSid: String(record?.currentUserSid || ''),
    databaseDeviceId: String(record?.databaseDeviceId || ''),
    databaseFileId: String(record?.databaseFileId || ''),
  };
  if (
    !result.computerName
    || result.computerName.includes('\0')
    || !result.currentUserSid
    || result.databaseDeviceId !== database.identity.deviceId
    || result.databaseFileId !== database.identity.fileId
  ) {
    fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Finalized machine/database identity is invalid.');
  }
  return result;
}

function finalizedPayloadHash(record: Record<string, unknown>): string {
  const payload = { ...record };
  delete payload.finalizationPayloadSha256;
  return sha256(stableJson(payload));
}

function requireFinalizedGate(
  value: unknown,
  active: ActiveGateDocument,
  artifacts: {
    active: S7StableFileArtifact;
    bound: S7StableFileArtifact;
    handoffReady: S7StableFileArtifact;
    handoffReleased: S7StableFileArtifact;
    admission: S7StableFileArtifact;
    closed: S7StableFileArtifact;
  },
): FinalizedGateDocument {
  const record = value as Record<string, unknown> | null;
  const keys = [
    'kind',
    'schemaVersion',
    'status',
    'finalizedAt',
    'gateId',
    'invocationId',
    'canonicalUserDataDir',
    'approvalPayloadSha256',
    'approvalPacket',
    'launchReceipt',
    'acceptanceReceipt',
    'finalizationPacket',
    'activeGate',
    'boundGate',
    'handoffReady',
    'handoffReleased',
    'admission',
    'closed',
    'databaseAfterMigration',
    'packageAtMigration',
    'shellAtMigration',
    'machine',
    'authority',
    'finalizationPayloadSha256',
    'formalAppReadiness',
    'adsExecutionAuthorized',
  ] as const;
  if (
    !exactKeys(record, keys)
    || record?.kind !== S7_STARTUP_GATE_FINALIZED_KIND
    || record?.schemaVersion !== S7_STARTUP_GATE_FINALIZED_SCHEMA
    || record?.status !== 'FINALIZED_FOR_POST_MIGRATION_STARTUP'
    || record?.gateId !== active.gateId
    || record?.invocationId !== active.invocationId
    || !samePath(record?.canonicalUserDataDir, active.canonicalUserDataDir)
    || record?.formalAppReadiness !== false
    || record?.adsExecutionAuthorized !== false
  ) {
    fail('S7_STARTUP_GATE_INVALID', 'FINALIZED receipt shape or authority boundary is invalid.');
  }
  requireFiniteTimestamp(record.finalizedAt, 'FINALIZED receipt');
  const approvalPayloadSha256 = normalizeSha(
    record.approvalPayloadSha256,
    'FINALIZED approval payload',
  );
  const activeGate = requireStrictArtifactBinding(record.activeGate, 'FINALIZED ACTIVE');
  const boundGate = requireStrictArtifactBinding(record.boundGate, 'FINALIZED BOUND');
  const handoffReady = requireStrictArtifactBinding(record.handoffReady, 'FINALIZED READY');
  const handoffReleased = requireStrictArtifactBinding(
    record.handoffReleased,
    'FINALIZED RELEASED',
  );
  const admission = requireStrictArtifactBinding(record.admission, 'FINALIZED ADMISSION');
  const closed = requireStrictArtifactBinding(record.closed, 'FINALIZED CLOSED');
  for (const [label, expected, actual] of [
    ['ACTIVE', artifacts.active, activeGate],
    ['BOUND', artifacts.bound, boundGate],
    ['HANDOFF_READY', artifacts.handoffReady, handoffReady],
    ['HANDOFF_RELEASED', artifacts.handoffReleased, handoffReleased],
    ['ADMISSION', artifacts.admission, admission],
    ['CLOSED', artifacts.closed, closed],
  ] as const) {
    if (!sameArtifact(expected, actual)) {
      fail('S7_STARTUP_GATE_BINDING_MISMATCH', `FINALIZED ${label} binding drifted.`);
    }
  }
  const databaseAfterMigration = requireStrictArtifactBinding(
    record.databaseAfterMigration,
    'FINALIZED database after migration',
  );
  const packageAtMigration = requireStrictPackageBinding(record.packageAtMigration);
  const shellAtMigration = requireStrictTrustedShellBinding(record.shellAtMigration);
  if (
    stableJson(packageAtMigration) !== stableJson(active.bindings.package)
    || stableJson(shellAtMigration) !== stableJson(active.bindings.shell)
  ) {
    fail(
      'S7_STARTUP_GATE_BINDING_MISMATCH',
      'FINALIZED migration package or shell differs from ACTIVE.',
    );
  }
  const machine = requireFinalizedMachine(record.machine, databaseAfterMigration);
  const authority = requirePostMigrationAuthorityState(record.authority);
  const finalizationPayloadSha256 = normalizeSha(
    record.finalizationPayloadSha256,
    'FINALIZED payload',
  );
  if (finalizationPayloadSha256 !== finalizedPayloadHash(record)) {
    fail('S7_STARTUP_GATE_INVALID', 'FINALIZED payload integrity hash is invalid.');
  }
  return {
    kind: S7_STARTUP_GATE_FINALIZED_KIND,
    schemaVersion: S7_STARTUP_GATE_FINALIZED_SCHEMA,
    status: 'FINALIZED_FOR_POST_MIGRATION_STARTUP',
    finalizedAt: String(record.finalizedAt),
    gateId: active.gateId,
    invocationId: active.invocationId,
    canonicalUserDataDir: active.canonicalUserDataDir,
    approvalPayloadSha256,
    approvalPacket: requireStrictArtifactBinding(
      record.approvalPacket,
      'FINALIZED approval packet',
    ),
    launchReceipt: requireStrictArtifactBinding(record.launchReceipt, 'FINALIZED launch receipt'),
    acceptanceReceipt: requireStrictArtifactBinding(
      record.acceptanceReceipt,
      'FINALIZED acceptance receipt',
    ),
    finalizationPacket: requireStrictArtifactBinding(
      record.finalizationPacket,
      'FINALIZED finalization packet',
    ),
    activeGate,
    boundGate,
    handoffReady,
    handoffReleased,
    admission,
    closed,
    databaseAfterMigration,
    packageAtMigration,
    shellAtMigration,
    machine,
    authority,
    finalizationPayloadSha256,
    formalAppReadiness: false,
    adsExecutionAuthorized: false,
  };
}

interface CompletedS7Chain {
  active: ActiveGateDocument;
  activeArtifact: S7StableFileArtifact;
  boundArtifact: S7StableFileArtifact;
  handoffReadyArtifact: S7StableFileArtifact;
  handoffReleasedArtifact: S7StableFileArtifact;
  admissionArtifact: S7StableFileArtifact;
  closedArtifact: S7StableFileArtifact;
  finalized: FinalizedGateDocument;
  finalizedArtifact: S7StableFileArtifact;
}

function readSecureGateJson(
  io: S7StartupGateIo,
  filePath: string,
  label: string,
  trustedShell?: GateTrustedShellBinding,
): {
  artifact: S7StableFileArtifact;
  value: Record<string, unknown>;
} {
  const artifact = io.readStableFile(
    filePath,
    label,
    { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES },
  );
  requireSecurePath(io, artifact.realPath, 'file', label, trustedShell);
  if (artifact.identity.hardLinkCount !== 1) {
    fail(
      'S7_STARTUP_GATE_PATH_UNSAFE',
      `${label} must have exactly one filesystem link.`,
    );
  }
  return {
    artifact: publicArtifact(artifact),
    value: parseJsonFile<Record<string, unknown>>(artifact, label),
  };
}

function requireHandoffReadyDocument(
  record: Record<string, unknown>,
  active: ActiveGateDocument,
  activeArtifact: S7StableFileArtifact,
  boundArtifact: S7StableFileArtifact,
  pid: number,
): void {
  if (
    record.kind !== S7_STARTUP_GATE_HANDOFF_READY_KIND
    || record.schemaVersion !== S7_STARTUP_GATE_HANDOFF_READY_SCHEMA
    || record.status !== 'READY_FOR_DB_HANDOFF'
    || Number(record.pid) !== pid
    || record.gateId !== active.gateId
    || record.invocationId !== active.invocationId
    || record.singleInstanceLockAcquired !== true
    || !samePath(record.canonicalUserDataDir, active.canonicalUserDataDir)
    || !sameArtifact(
      requireArtifactBinding(record.activeGate, 'READY ACTIVE'),
      activeArtifact,
    )
    || !sameArtifact(
      requireArtifactBinding(record.boundGate, 'READY BOUND'),
      boundArtifact,
    )
    || stableJson(requireArtifactBinding(record.executable, 'READY executable'))
      !== stableJson(active.bindings.executable)
    || stableJson(requireArtifactBinding(record.main, 'READY Main'))
      !== stableJson(active.bindings.package.main)
    || stableJson(requireArtifactBinding(record.intent, 'READY intent'))
      !== stableJson(active.bindings.intent)
    || stableJson(requirePackageBinding(record.package)) !== stableJson(active.bindings.package)
    || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)
  ) {
    fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'HANDOFF_READY binding is invalid.');
  }
  requireFiniteTimestamp(record.readyAt, 'HANDOFF_READY');
}

function requireAdmissionDocument(
  record: Record<string, unknown>,
  active: ActiveGateDocument,
  artifacts: {
    active: S7StableFileArtifact;
    bound: S7StableFileArtifact;
    ready: S7StableFileArtifact;
    released: S7StableFileArtifact;
  },
  pid: number,
): void {
  const sqlite = record.sqliteTakeover as Record<string, unknown> | undefined;
  if (
    record.kind !== S7_STARTUP_GATE_ADMISSION_KIND
    || record.schemaVersion !== S7_STARTUP_GATE_ADMISSION_SCHEMA
    || record.status !== 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK'
    || Number(record.pid) !== pid
    || record.gateId !== active.gateId
    || record.invocationId !== active.invocationId
    || record.singleInstanceLockAcquired !== true
    || !samePath(record.canonicalUserDataDir, active.canonicalUserDataDir)
    || !sameArtifact(requireArtifactBinding(record.activeGate, 'ADMISSION ACTIVE'), artifacts.active)
    || !sameArtifact(requireArtifactBinding(record.boundGate, 'ADMISSION BOUND'), artifacts.bound)
    || !sameArtifact(requireArtifactBinding(record.handoffReady, 'ADMISSION READY'), artifacts.ready)
    || !sameArtifact(
      requireArtifactBinding(record.handoffReleased, 'ADMISSION RELEASED'),
      artifacts.released,
    )
    || stableJson(requireArtifactBinding(record.executable, 'ADMISSION executable'))
      !== stableJson(active.bindings.executable)
    || stableJson(requireArtifactBinding(record.main, 'ADMISSION Main'))
      !== stableJson(active.bindings.package.main)
    || stableJson(requireArtifactBinding(record.database, 'ADMISSION database'))
      !== stableJson(active.bindings.database)
    || stableJson(requireArtifactBinding(record.intent, 'ADMISSION intent'))
      !== stableJson(active.bindings.intent)
    || stableJson(requirePackageBinding(record.package)) !== stableJson(active.bindings.package)
    || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)
    || !sqlite
    || !samePath(sqlite.connectionPath, active.bindings.database.realPath)
    || sqlite.fileMustExist !== true
    || Number(sqlite.busyTimeoutMs) !== 0
    || sqlite.lockingMode !== 'exclusive'
    || sqlite.beginMode !== 'exclusive'
    || sqlite.transactionActive !== true
    || sqlite.sameConnectionRequiredForMigration !== true
    || Number(sqlite.schemaVersionBefore) !== 0
  ) {
    fail('S7_STARTUP_GATE_ADMISSION_UNTRUSTED', 'ADMISSION binding is invalid.');
  }
  requireFiniteTimestamp(record.admittedAt, 'ADMISSION');
}

function requireClosedDocument(
  record: Record<string, unknown>,
  active: ActiveGateDocument,
  artifacts: {
    active: S7StableFileArtifact;
    bound: S7StableFileArtifact;
    ready: S7StableFileArtifact;
    released: S7StableFileArtifact;
    admission: S7StableFileArtifact;
  },
  pid: number,
  helperPid: number,
): GateArtifactBinding {
  if (
    record.kind !== S7_STARTUP_GATE_CLOSED_KIND
    || record.schemaVersion !== S7_STARTUP_GATE_CLOSED_SCHEMA
    || record.status !== 'CLOSED_AFTER_GUARDED_MIGRATION'
    || Number(record.pid) !== pid
    || Number(record.helperPid) !== helperPid
    || Number(record.exitCode) !== 0
    || record.gateId !== active.gateId
    || record.invocationId !== active.invocationId
    || !sameArtifact(requireArtifactBinding(record.activeGate, 'CLOSED ACTIVE'), artifacts.active)
    || !sameArtifact(requireArtifactBinding(record.boundGate, 'CLOSED BOUND'), artifacts.bound)
    || !sameArtifact(requireArtifactBinding(record.handoffReady, 'CLOSED READY'), artifacts.ready)
    || !sameArtifact(
      requireArtifactBinding(record.handoffReleased, 'CLOSED RELEASED'),
      artifacts.released,
    )
    || !sameArtifact(
      requireArtifactBinding(record.admission, 'CLOSED ADMISSION'),
      artifacts.admission,
    )
    || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)
  ) {
    fail('S7_STARTUP_GATE_CLOSED_UNTRUSTED', 'CLOSED binding is invalid.');
  }
  requireFiniteTimestamp(record.closedAt, 'CLOSED');
  return requireArtifactBinding(record.databaseAfterClose, 'CLOSED database after migration');
}

function assertExternalArtifactBinding(
  io: S7StartupGateIo,
  binding: GateArtifactBinding,
  label: string,
): void {
  const artifact = io.readStableFile(binding.realPath, label);
  if (!sameArtifact(artifact, binding)) {
    fail('S7_STARTUP_GATE_BINDING_MISMATCH', `${label} drifted after finalization.`);
  }
}

function inspectCompletedS7Chain(
  io: S7StartupGateIo,
  canonicalUserDataDir: string,
  activePath: string,
  trustedShell: GateTrustedShellBinding,
): CompletedS7Chain {
  const activeRead = readSecureGateJson(
    io,
    activePath,
    'Post-migration ACTIVE gate',
    trustedShell,
  );
  const activeRecord = activeRead.value;
  const gateId = requireSafeIdentifier(activeRecord.gateId, 'Post-migration gate ID');
  const invocationId = requireSafeIdentifier(
    activeRecord.invocationId,
    'Post-migration invocation ID',
  );
  const active = requireActiveGate(activeRecord, {
    canonicalUserDataDir,
    activePath,
    gateId,
    invocationId,
  });
  const boundRead = readSecureGateJson(
    io,
    active.paths.bound,
    'Post-migration BOUND gate',
    trustedShell,
  );
  const pid = Number(boundRead.value.pid);
  if (!Number.isInteger(pid) || pid < 1) {
    fail('S7_STARTUP_GATE_INVALID', 'Post-migration BOUND PID is invalid.');
  }
  requireBoundGate(boundRead.value, active, activeRead.artifact, pid);
  const readyRead = readSecureGateJson(
    io,
    active.paths.handoffReady,
    'Post-migration HANDOFF_READY',
    trustedShell,
  );
  requireHandoffReadyDocument(
    readyRead.value,
    active,
    activeRead.artifact,
    boundRead.artifact,
    pid,
  );
  const releasedRead = readSecureGateJson(
    io,
    active.paths.handoffReleased,
    'Post-migration HANDOFF_RELEASED',
    trustedShell,
  );
  const released = requireHandoffReleased(
    releasedRead.value,
    active,
    activeRead.artifact,
    boundRead.artifact,
    readyRead.artifact,
    pid,
  );
  const admissionRead = readSecureGateJson(
    io,
    active.paths.admission,
    'Post-migration ADMISSION',
    trustedShell,
  );
  requireAdmissionDocument(
    admissionRead.value,
    active,
    {
      active: activeRead.artifact,
      bound: boundRead.artifact,
      ready: readyRead.artifact,
      released: releasedRead.artifact,
    },
    pid,
  );
  const closedRead = readSecureGateJson(
    io,
    active.paths.closed,
    'Post-migration CLOSED',
    trustedShell,
  );
  const databaseAfterClose = requireClosedDocument(
    closedRead.value,
    active,
    {
      active: activeRead.artifact,
      bound: boundRead.artifact,
      ready: readyRead.artifact,
      released: releasedRead.artifact,
      admission: admissionRead.artifact,
    },
    pid,
    released.helperPid,
  );
  const finalizedRead = readSecureGateJson(
    io,
    active.paths.finalized,
    'Post-migration FINALIZED',
    trustedShell,
  );
  const finalized = requireFinalizedGate(
    finalizedRead.value,
    active,
    {
      active: activeRead.artifact,
      bound: boundRead.artifact,
      handoffReady: readyRead.artifact,
      handoffReleased: releasedRead.artifact,
      admission: admissionRead.artifact,
      closed: closedRead.artifact,
    },
  );
  if (
    stableJson(databaseAfterClose) !== stableJson(finalized.databaseAfterMigration)
    || !samePath(finalized.databaseAfterMigration.realPath, active.bindings.database.realPath)
  ) {
    fail(
      'S7_STARTUP_GATE_BINDING_MISMATCH',
      'FINALIZED database does not match the helper CLOSED receipt.',
    );
  }
  for (const [label, binding] of [
    ['S7 approval packet', finalized.approvalPacket],
    ['S7 launch receipt', finalized.launchReceipt],
    ['S7 readonly acceptance receipt', finalized.acceptanceReceipt],
    ['S7 finalization packet', finalized.finalizationPacket],
  ] as const) {
    assertExternalArtifactBinding(io, binding, label);
  }
  return {
    active,
    activeArtifact: activeRead.artifact,
    boundArtifact: boundRead.artifact,
    handoffReadyArtifact: readyRead.artifact,
    handoffReleasedArtifact: releasedRead.artifact,
    admissionArtifact: admissionRead.artifact,
    closedArtifact: closedRead.artifact,
    finalized,
    finalizedArtifact: finalizedRead.artifact,
  };
}

function completionPayloadHash(record: Record<string, unknown>): string {
  const payload = { ...record };
  delete payload.completionPayloadSha256;
  return sha256(stableJson(payload));
}

function requirePostMigrationAdmission(
  value: unknown,
  chain: CompletedS7Chain,
): PostMigrationAdmissionDocument {
  const record = value as Record<string, unknown> | null;
  if (
    !exactKeys(record, [
      'kind',
      'schemaVersion',
      'status',
      'admittedAt',
      'gateId',
      'invocationId',
      'canonicalUserDataDir',
      'finalized',
      'activeGate',
      'closed',
      'acceptanceReceipt',
      'databaseAtFirstAdmission',
      'databaseIdentity',
      'machine',
      'authorityContractSha256',
      'migrationPackage',
      'migrationShell',
      'completionPayloadSha256',
    ])
    || record?.kind !== S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND
    || record?.schemaVersion !== S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA
    || record?.status !== 'POST_MIGRATION_ADMITTED'
    || record?.gateId !== chain.active.gateId
    || record?.invocationId !== chain.active.invocationId
    || !samePath(record?.canonicalUserDataDir, chain.active.canonicalUserDataDir)
  ) {
    fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion marker shape is invalid.');
  }
  requireFiniteTimestamp(record.admittedAt, 'Post-migration admission');
  const finalized = requireStrictArtifactBinding(record.finalized, 'Completion FINALIZED');
  const activeGate = requireStrictArtifactBinding(record.activeGate, 'Completion ACTIVE');
  const closed = requireStrictArtifactBinding(record.closed, 'Completion CLOSED');
  const acceptanceReceipt = requireStrictArtifactBinding(
    record.acceptanceReceipt,
    'Completion acceptance receipt',
  );
  const databaseAtFirstAdmission = requireStrictArtifactBinding(
    record.databaseAtFirstAdmission,
    'Completion initial database',
  );
  if (
    !sameArtifact(finalized, chain.finalizedArtifact)
    || !sameArtifact(activeGate, chain.activeArtifact)
    || !sameArtifact(closed, chain.closedArtifact)
    || stableJson(acceptanceReceipt) !== stableJson(chain.finalized.acceptanceReceipt)
    || stableJson(databaseAtFirstAdmission) !== stableJson(chain.finalized.databaseAfterMigration)
  ) {
    fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion receipt-chain binding drifted.');
  }
  const identity = record.databaseIdentity as Record<string, unknown> | null;
  if (
    !exactKeys(identity, ['realPath', 'deviceId', 'fileId', 'hardLinkCount'])
    || !samePath(identity?.realPath, chain.finalized.databaseAfterMigration.realPath)
    || String(identity?.deviceId || '') !== chain.finalized.databaseAfterMigration.identity.deviceId
    || String(identity?.fileId || '') !== chain.finalized.databaseAfterMigration.identity.fileId
    || Number(identity?.hardLinkCount) !== 1
  ) {
    fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion database identity is invalid.');
  }
  const machine = requireFinalizedMachine(record.machine, chain.finalized.databaseAfterMigration);
  const migrationPackage = requireStrictPackageBinding(record.migrationPackage);
  const migrationShell = requireStrictTrustedShellBinding(record.migrationShell);
  const authorityContractSha256 = normalizeSha(
    record.authorityContractSha256,
    'Completion authority contract',
  );
  const completionPayloadSha256 = normalizeSha(
    record.completionPayloadSha256,
    'Completion payload',
  );
  if (
    stableJson(machine) !== stableJson(chain.finalized.machine)
    || stableJson(migrationPackage) !== stableJson(chain.finalized.packageAtMigration)
    || stableJson(migrationShell) !== stableJson(chain.finalized.shellAtMigration)
    || authorityContractSha256 !== chain.finalized.authority.contractSha256
    || completionPayloadSha256 !== completionPayloadHash(record)
  ) {
    fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion payload integrity is invalid.');
  }
  return {
    kind: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND,
    schemaVersion: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA,
    status: 'POST_MIGRATION_ADMITTED',
    admittedAt: String(record.admittedAt),
    gateId: chain.active.gateId,
    invocationId: chain.active.invocationId,
    canonicalUserDataDir: chain.active.canonicalUserDataDir,
    finalized,
    activeGate,
    closed,
    acceptanceReceipt,
    databaseAtFirstAdmission,
    databaseIdentity: {
      realPath: String(identity?.realPath),
      deviceId: String(identity?.deviceId),
      fileId: String(identity?.fileId),
      hardLinkCount: 1,
    },
    machine,
    authorityContractSha256,
    migrationPackage,
    migrationShell,
    completionPayloadSha256,
  };
}

function assertPackageBinding(
  actual: GatePackageBinding,
  expected: GatePackageBinding,
  label: string,
): void {
  if (stableJson(actual) !== stableJson(expected)) {
    fail('S7_STARTUP_GATE_BINDING_MISMATCH', `${label} no longer matches the approved identity.`);
  }
}

function assertArtifactBound(
  actual: S7StableFileArtifact,
  binding: GateArtifactBinding,
  label: string,
): void {
  if (!sameArtifact(actual, binding)) {
    fail('S7_STARTUP_GATE_BINDING_MISMATCH', `${label} no longer matches the approved identity.`);
  }
}

function publicArtifact(
  artifact: S7StableFileArtifact & { contents?: Buffer },
): S7StableFileArtifact {
  return {
    path: artifact.path,
    realPath: artifact.realPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    mtimeMs: artifact.mtimeMs,
    identity: { ...artifact.identity },
  };
}

function gateEnvironmentPresent(env: NodeJS.ProcessEnv): boolean {
  return GATE_ENV_NAMES.some((name) => typeof env[name] === 'string' && env[name] !== '');
}

function scrubGateEnvironment(env: NodeJS.ProcessEnv): void {
  for (const name of GATE_ENV_NAMES) delete env[name];
}

function decodeGatePath(env: NodeJS.ProcessEnv): string {
  const encoded = String(env[S7_STARTUP_GATE_ENV.activePathB64] || '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    fail('S7_STARTUP_GATE_ENV_INVALID', 'ACTIVE gate path environment binding is invalid.');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    fail('S7_STARTUP_GATE_ENV_INVALID', 'ACTIVE gate path environment binding is not base64.');
  }
  if (!decoded || decoded.includes('\0') || !path.isAbsolute(decoded)) {
    fail('S7_STARTUP_GATE_ENV_INVALID', 'ACTIVE gate path environment binding is not absolute.');
  }
  return decoded;
}

function assertSingleInstanceLock(app: S7StartupGateAppPort): void {
  if (app.requestSingleInstanceLock() !== true) {
    fail('S7_SINGLE_INSTANCE_LOCK_DENIED', 'Another application instance already owns the Electron lock.');
  }
}

export function resolveCanonicalAuthorityUserDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const roaming = String(env.APPDATA || '');
  if (!roaming || roaming.includes('\0') || !path.isAbsolute(roaming)) {
    fail('S7_CANONICAL_USER_DATA_UNRESOLVED', 'APPDATA is unavailable or invalid.');
  }
  return path.resolve(roaming, '@amazon-ai-ops', 'desktop');
}

export function enforceS7MainStartupGate(
  options: EnforceS7MainStartupGateOptions,
): S7MainStartupAdmission {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    fail('S7_STARTUP_GATE_UNSUPPORTED_PLATFORM', 'The desktop startup gate is Windows-only.');
  }
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const pid = options.pid ?? process.pid;
  const io: S7StartupGateIo = { ...DEFAULT_IO, ...options.io };
  const canonicalUserDataDir = path.resolve(options.canonicalUserDataDir);
  const currentUserDataDir = path.resolve(options.currentUserDataDir);
  const gateDirectory = path.join(canonicalUserDataDir, S7_STARTUP_GATE_DIRECTORY);
  const activePath = path.join(gateDirectory, S7_STARTUP_GATE_ACTIVE_FILE);
  const finalizedPath = path.join(gateDirectory, S7_STARTUP_GATE_FINALIZED_FILE);
  const completionPath = path.join(
    gateDirectory,
    S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE,
  );

  if (options.evidenceUserDataIdentity.mode !== null) {
    if (
      options.evidenceUserDataIdentity.overridden !== true
      || !options.evidenceUserDataIdentity.userDataDir
      || !samePath(options.evidenceUserDataIdentity.userDataDir, currentUserDataDir)
      || samePath(currentUserDataDir, canonicalUserDataDir)
      || isPathWithin(canonicalUserDataDir, currentUserDataDir)
      || isPathWithin(currentUserDataDir, canonicalUserDataDir)
      || gateEnvironmentPresent(env)
    ) {
      fail(
        'S7_EVIDENCE_USER_DATA_NOT_ISOLATED',
        'Evidence runtime must use one isolated userData and may not carry an S7 authority gate.',
      );
    }
    const evidenceDirectory = io.inspectDirectory(currentUserDataDir, 'Evidence userData');
    if (!samePath(evidenceDirectory.realPath, currentUserDataDir)) {
      fail('S7_EVIDENCE_USER_DATA_NOT_ISOLATED', 'Evidence userData traverses a link or junction.');
    }
    assertSingleInstanceLock(options.app);
    return {
      mode: 'EVIDENCE_ISOLATED',
      admitted: true,
      singleInstanceLockAcquired: true,
      canonicalUserDataDir,
      evidenceUserDataDir: currentUserDataDir,
    };
  }

  if (!samePath(currentUserDataDir, canonicalUserDataDir)) {
    fail(
      'S7_CANONICAL_USER_DATA_MISMATCH',
      'Ordinary packaged runtime must use the canonical authority userData.',
    );
  }

  if (!io.existsSync(activePath)) {
    for (const orphanedPath of [
      path.join(gateDirectory, S7_STARTUP_GATE_BOUND_FILE),
      path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_READY_FILE),
      path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE),
      path.join(gateDirectory, S7_STARTUP_GATE_ADMISSION_FILE),
      path.join(gateDirectory, S7_STARTUP_GATE_CLOSED_FILE),
      finalizedPath,
      completionPath,
    ]) {
      if (io.existsSync(orphanedPath)) {
        fail(
          'S7_STARTUP_GATE_ORPHANED_CHAIN_BLOCKED',
          'An S7 receipt exists without the canonical ACTIVE gate.',
        );
      }
    }
    if (gateEnvironmentPresent(env)) {
      scrubGateEnvironment(env);
      fail('S7_STARTUP_GATE_ENV_INVALID', 'Gate environment exists without the canonical ACTIVE gate.');
    }
    const databasePath = path.join(canonicalUserDataDir, 'amazon-ai-ops.db');
    const beforeDatabase = io.existsSync(databasePath)
      ? io.readStableFile(databasePath, 'Existing authority database')
      : null;
    let beforeAuthority: S7PostMigrationAuthorityState | null = null;
    if (beforeDatabase) {
      requireSecurePath(io, databasePath, 'file', 'Existing authority database');
      try {
        beforeAuthority = io.inspectPostMigrationAuthority(beforeDatabase.realPath);
      } catch {
        fail(
          'S7_STARTUP_GATE_LEGACY_DATABASE_BLOCKED',
          'Existing authority is not the complete current v9 schema/ledger contract and requires the approved S7 migration operator.',
        );
      }
    }
    assertSingleInstanceLock(options.app);
    if (io.existsSync(activePath)) {
      fail(
        'S7_STARTUP_GATE_RACE_BLOCKED',
        'An S7 ACTIVE gate appeared while the ordinary instance acquired its lock.',
      );
    }
    const afterDatabase = io.existsSync(databasePath)
      ? io.readStableFile(databasePath, 'Existing authority database after lock')
      : null;
    if (
      Boolean(beforeDatabase) !== Boolean(afterDatabase)
      || (beforeDatabase && afterDatabase && !sameArtifact(beforeDatabase, afterDatabase))
    ) {
      fail(
        'S7_STARTUP_GATE_RACE_BLOCKED',
        'Authority database changed while the ordinary instance acquired its lock.',
      );
    }
    if (afterDatabase) {
      requireSecurePath(io, databasePath, 'file', 'Existing authority database after lock');
      let afterAuthority: S7PostMigrationAuthorityState;
      try {
        afterAuthority = io.inspectPostMigrationAuthority(afterDatabase.realPath);
      } catch {
        fail(
          'S7_STARTUP_GATE_RACE_BLOCKED',
          'Authority schema/ledger/invariants became invalid while the ordinary instance acquired its lock.',
        );
      }
      if (
        beforeAuthority === null
        || stableJson(afterAuthority) !== stableJson(beforeAuthority)
      ) {
        fail(
          'S7_STARTUP_GATE_RACE_BLOCKED',
          'Authority schema/ledger/invariants changed while the ordinary instance acquired its lock.',
        );
      }
    }
    return {
      mode: 'NORMAL',
      admitted: true,
      singleInstanceLockAcquired: true,
      canonicalUserDataDir,
    };
  }

  const finalizedExists = io.existsSync(finalizedPath);
  const completionExists = io.existsSync(completionPath);
  if (!gateEnvironmentPresent(env) && (finalizedExists || completionExists)) {
    if (!options.isPackaged) {
      fail(
        'S7_STARTUP_GATE_REQUIRES_PACKAGED_MAIN',
        'Post-migration admission requires packaged Main.',
      );
    }
    if (!finalizedExists) {
      fail(
        'S7_STARTUP_GATE_COMPLETION_UNTRUSTED',
        'Completion marker exists without FINALIZED.',
      );
    }
    const computerName = String(env.COMPUTERNAME || '').trim();
    if (!computerName || computerName.includes('\0')) {
      fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Current Windows machine name is unavailable.');
    }
    let currentTrustedShell: GateTrustedShellBinding;
    try {
      currentTrustedShell = requireStrictTrustedShellBinding(
        io.inspectTrustedPowerShell(),
      );
    } catch {
      fail(
        'S7_STARTUP_GATE_SHELL_UNTRUSTED',
        'Current PowerShell signature, owner, ACL, hard-link, or file identity authentication failed.',
      );
    }
    const inspectPostMigrationState = () => {
      const canonicalDirectory = io.inspectDirectory(
        canonicalUserDataDir,
        'Post-migration canonical userData',
      );
      const startupDirectory = io.inspectDirectory(
        gateDirectory,
        'Post-migration startup gate directory',
      );
      if (
        !samePath(canonicalDirectory.realPath, canonicalUserDataDir)
        || !samePath(startupDirectory.realPath, gateDirectory)
      ) {
        fail(
          'S7_STARTUP_GATE_PATH_UNSAFE',
          'Post-migration startup gate path traverses a link or junction.',
        );
      }
      requireSecurePath(
        io,
        gateDirectory,
        'directory',
        'Post-migration startup gate directory',
        currentTrustedShell,
      );
      const chain = inspectCompletedS7Chain(
        io,
        canonicalUserDataDir,
        activePath,
        currentTrustedShell,
      );
      const database = io.readStableFile(
        chain.finalized.databaseAfterMigration.realPath,
        'Post-migration authority database',
      );
      requireSecurePath(
        io,
        database.realPath,
        'file',
        'Post-migration authority database',
        currentTrustedShell,
      );
      const databaseSecurity = io.inspectWindowsPathSecurity(
        database.realPath,
        'file',
        'Post-migration authority database machine binding',
        currentTrustedShell,
      );
      if (
        !samePath(database.realPath, chain.finalized.databaseAfterMigration.realPath)
        || database.identity.deviceId !== chain.finalized.databaseAfterMigration.identity.deviceId
        || database.identity.fileId !== chain.finalized.databaseAfterMigration.identity.fileId
        || database.identity.hardLinkCount !== 1
        || databaseSecurity.currentUserSid !== chain.finalized.machine.currentUserSid
        || computerName.toLowerCase() !== chain.finalized.machine.computerName.toLowerCase()
      ) {
        fail(
          'S7_STARTUP_GATE_BINDING_MISMATCH',
          'Post-migration database SID/machine/volume/file identity drifted.',
        );
      }
      if (!io.existsSync(completionPath)) {
        for (const suffix of ['-wal', '-shm', '-journal']) {
          if (io.existsSync(`${database.realPath}${suffix}`)) {
            fail(
              'S7_STARTUP_GATE_BINDING_MISMATCH',
              'First post-migration admission requires a sidecar-free accepted database.',
            );
          }
        }
      }
      const authority = io.inspectPostMigrationAuthority(database.realPath);
      if (stableJson(authority) !== stableJson(chain.finalized.authority)) {
        fail(
          'S7_STARTUP_GATE_AUTHORITY_DRIFT',
          'Current authority schema/ledger/invariants differ from FINALIZED.',
        );
      }
      let completionRead: ReturnType<typeof readSecureGateJson> | null = null;
      let completion: PostMigrationAdmissionDocument | null = null;
      if (io.existsSync(completionPath)) {
        completionRead = readSecureGateJson(
          io,
          completionPath,
          'Post-migration completion marker',
          currentTrustedShell,
        );
        completion = requirePostMigrationAdmission(completionRead.value, chain);
        if (
          !samePath(database.realPath, completion.databaseIdentity.realPath)
          || database.identity.deviceId !== completion.databaseIdentity.deviceId
          || database.identity.fileId !== completion.databaseIdentity.fileId
          || database.identity.hardLinkCount !== completion.databaseIdentity.hardLinkCount
        ) {
          fail(
            'S7_STARTUP_GATE_BINDING_MISMATCH',
            'Current authority database identity differs from completion.',
          );
        }
      } else {
        if (!sameArtifact(database, chain.finalized.databaseAfterMigration)) {
          fail(
            'S7_STARTUP_GATE_BINDING_MISMATCH',
            'First post-migration admission requires the exact accepted database snapshot.',
          );
        }
        const executable = io.readStableFile(
          options.executablePath,
          'First post-migration packaged executable',
        );
        const main = io.readStableFile(
          options.mainModulePath,
          'First post-migration packaged Main',
        );
        const currentPackage = {
          exe: requireArtifactBinding(publicArtifact(executable), 'First post-migration executable'),
          appContent: io.buildAppContentManifest(
            chain.finalized.packageAtMigration.appContent.realPath,
          ),
          main: requireArtifactBinding(publicArtifact(main), 'First post-migration Main'),
        };
        if (stableJson(currentPackage) !== stableJson(chain.finalized.packageAtMigration)) {
          fail(
            'S7_STARTUP_GATE_BINDING_MISMATCH',
            'First post-migration admission package differs from the migration package.',
          );
        }
        if (
          stableJson(currentTrustedShell)
          !== stableJson(chain.finalized.shellAtMigration)
        ) {
          fail(
            'S7_STARTUP_GATE_SHELL_UNTRUSTED',
            'First post-migration admission shell differs from the migration shell.',
          );
        }
      }
      return {
        chain,
        database,
        authority,
        completion,
        completionArtifact: completionRead?.artifact ?? null,
      };
    };

    const beforeLock = inspectPostMigrationState();
    assertSingleInstanceLock(options.app);
    const afterLock = inspectPostMigrationState();
    if (
      !sameArtifact(beforeLock.chain.finalizedArtifact, afterLock.chain.finalizedArtifact)
      || !sameArtifact(beforeLock.database, afterLock.database)
      || stableJson(beforeLock.authority) !== stableJson(afterLock.authority)
      || Boolean(beforeLock.completionArtifact) !== Boolean(afterLock.completionArtifact)
      || (
        beforeLock.completionArtifact
        && afterLock.completionArtifact
        && !sameArtifact(beforeLock.completionArtifact, afterLock.completionArtifact)
      )
    ) {
      fail(
        'S7_STARTUP_GATE_RACE_BLOCKED',
        'Post-migration chain or authority changed while the Electron lock was acquired.',
      );
    }

    let completionArtifact = afterLock.completionArtifact;
    if (!completionArtifact) {
      const admittedAt = now();
      if (!(admittedAt instanceof Date) || !Number.isFinite(admittedAt.valueOf())) {
        fail('S7_STARTUP_GATE_INVALID', 'Post-migration admission clock is invalid.');
      }
      const completionBase = {
        kind: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND,
        schemaVersion: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA,
        status: 'POST_MIGRATION_ADMITTED',
        admittedAt: admittedAt.toISOString(),
        gateId: afterLock.chain.active.gateId,
        invocationId: afterLock.chain.active.invocationId,
        canonicalUserDataDir,
        finalized: requireArtifactBinding(
          afterLock.chain.finalizedArtifact,
          'Completion FINALIZED',
        ),
        activeGate: requireArtifactBinding(
          afterLock.chain.activeArtifact,
          'Completion ACTIVE',
        ),
        closed: requireArtifactBinding(
          afterLock.chain.closedArtifact,
          'Completion CLOSED',
        ),
        acceptanceReceipt: afterLock.chain.finalized.acceptanceReceipt,
        databaseAtFirstAdmission: requireArtifactBinding(
          afterLock.database,
          'Completion database',
        ),
        databaseIdentity: {
          realPath: afterLock.database.realPath,
          deviceId: afterLock.database.identity.deviceId,
          fileId: afterLock.database.identity.fileId,
          hardLinkCount: 1 as const,
        },
        machine: afterLock.chain.finalized.machine,
        authorityContractSha256: afterLock.authority.contractSha256,
        migrationPackage: afterLock.chain.finalized.packageAtMigration,
        migrationShell: afterLock.chain.finalized.shellAtMigration,
      };
      const completion = {
        ...completionBase,
        completionPayloadSha256: sha256(stableJson(completionBase)),
      };
      io.writeProtectedExclusiveJson(
        completionPath,
        completion,
        currentTrustedShell,
      );
      const persisted = readSecureGateJson(
        io,
        completionPath,
        'Persisted post-migration completion marker',
        currentTrustedShell,
      );
      requirePostMigrationAdmission(persisted.value, afterLock.chain);
      completionArtifact = persisted.artifact;
    }
    return {
      mode: 'NORMAL_POST_MIGRATION',
      admitted: true,
      singleInstanceLockAcquired: true,
      canonicalUserDataDir,
      finalizedReceipt: afterLock.chain.finalizedArtifact,
      completionReceipt: completionArtifact,
    };
  }

  if (!options.isPackaged) {
    scrubGateEnvironment(env);
    fail('S7_STARTUP_GATE_REQUIRES_PACKAGED_MAIN', 'An ACTIVE authority gate blocks development Main.');
  }
  if (!gateEnvironmentPresent(env)) {
    fail(
      'S7_STARTUP_GATE_UNAPPROVED_INSTANCE',
      'An ACTIVE authority gate exists and this process has no approved child binding.',
    );
  }

  const expectedActivePath = decodeGatePath(env);
  const expectedActiveSha = normalizeSha(
    env[S7_STARTUP_GATE_ENV.activeSha256],
    'Gate environment ACTIVE',
  );
  const expectedDeviceId = String(env[S7_STARTUP_GATE_ENV.activeDeviceId] || '');
  const expectedFileId = String(env[S7_STARTUP_GATE_ENV.activeFileId] || '');
  const expectedGateId = requireSafeIdentifier(
    env[S7_STARTUP_GATE_ENV.gateId],
    'Gate environment ID',
  );
  const expectedInvocationId = requireSafeIdentifier(
    env[S7_STARTUP_GATE_ENV.invocationId],
    'Gate environment invocation ID',
  );
  scrubGateEnvironment(env);
  if (
    !samePath(expectedActivePath, activePath)
    || !expectedDeviceId
    || !expectedFileId
  ) {
    fail('S7_STARTUP_GATE_ENV_INVALID', 'Gate environment does not bind the canonical ACTIVE path.');
  }

  const inspectApprovedState = () => {
    const trustedShell = requireStrictTrustedShellBinding(
      io.inspectTrustedPowerShell(),
    );
    const canonicalDirectory = io.inspectDirectory(canonicalUserDataDir, 'Canonical authority userData');
    const startupDirectory = io.inspectDirectory(gateDirectory, 'S7 startup gate directory');
    if (
      !samePath(canonicalDirectory.realPath, canonicalUserDataDir)
      || !samePath(startupDirectory.realPath, gateDirectory)
    ) {
      fail('S7_STARTUP_GATE_PATH_UNSAFE', 'Canonical startup gate path traverses a link or junction.');
    }
    requireSecurePath(
      io,
      gateDirectory,
      'directory',
      'S7 startup gate directory',
      trustedShell,
    );

    const activeArtifact = io.readStableFile(
      activePath,
      'S7 ACTIVE gate',
      { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES },
    );
    requireSecurePath(io, activePath, 'file', 'S7 ACTIVE gate', trustedShell);
    if (
      activeArtifact.sha256 !== expectedActiveSha
      || activeArtifact.identity.deviceId !== expectedDeviceId
      || activeArtifact.identity.fileId !== expectedFileId
    ) {
      fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'ACTIVE gate file identity differs from child environment.');
    }
    const active = requireActiveGate(
      parseJsonFile<unknown>(activeArtifact, 'S7 ACTIVE gate'),
      {
        canonicalUserDataDir,
        activePath,
        gateId: expectedGateId,
        invocationId: expectedInvocationId,
      },
    );

    const boundArtifact = io.readStableFile(
      active.paths.bound,
      'S7 BOUND gate',
      { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES },
    );
    requireSecurePath(
      io,
      active.paths.bound,
      'file',
      'S7 BOUND gate',
      trustedShell,
    );
    const bound = requireBoundGate(
      parseJsonFile<unknown>(boundArtifact, 'S7 BOUND gate'),
      active,
      activeArtifact,
      pid,
    );

    const executable = io.readStableFile(options.executablePath, 'Current packaged executable');
    const main = io.readStableFile(options.mainModulePath, 'Current packaged Main');
    const packageContent = io.buildAppContentManifest(active.bindings.package.appContent.realPath);
    const intent = io.readStableFile(active.bindings.intent.realPath, 'S7 launch intent');
    requireSecurePath(io, intent.realPath, 'file', 'S7 launch intent', trustedShell);
    assertArtifactBound(executable, active.bindings.executable, 'Current packaged executable');
    assertArtifactBound(executable, active.bindings.package.exe, 'Package executable');
    assertArtifactBound(main, active.bindings.package.main, 'Packaged Main');
    assertPackageBinding({
      exe: requireArtifactBinding(publicArtifact(executable), 'Measured package executable'),
      appContent: packageContent,
      main: requireArtifactBinding(publicArtifact(main), 'Measured package Main'),
    }, active.bindings.package, 'Complete packaged app content');
    assertArtifactBound(intent, active.bindings.intent, 'S7 launch intent');
    if (stableJson(trustedShell) !== stableJson(active.bindings.shell)) {
      fail(
        'S7_STARTUP_GATE_SHELL_UNTRUSTED',
        'Trusted Windows PowerShell identity differs from the approved helper.',
      );
    }
    if (!samePath(executable.realPath, options.executablePath)) {
      fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Current executable path is not canonical.');
    }
    return {
      active,
      bound,
      activeArtifact,
      boundArtifact,
      executable,
      main,
      packageContent,
      intent,
      trustedShell,
    };
  };

  const beforeLock = inspectApprovedState();
  for (const pendingPath of [
    beforeLock.active.paths.handoffReady,
    beforeLock.active.paths.handoffReleased,
    beforeLock.active.paths.admission,
    beforeLock.active.paths.closed,
    beforeLock.active.paths.finalized,
    completionPath,
  ]) {
    if (io.existsSync(pendingPath)) {
      fail('S7_STARTUP_GATE_REPLAY_BLOCKED', 'The one-time Main startup receipt chain already exists.');
    }
  }
  assertSingleInstanceLock(options.app);
  const afterLock = inspectApprovedState();
  for (const [label, before, after] of [
    ['ACTIVE gate', beforeLock.activeArtifact, afterLock.activeArtifact],
    ['BOUND gate', beforeLock.boundArtifact, afterLock.boundArtifact],
    ['executable', beforeLock.executable, afterLock.executable],
    ['Main', beforeLock.main, afterLock.main],
    ['intent', beforeLock.intent, afterLock.intent],
  ] as const) {
    if (!sameArtifact(before, after)) {
      fail('S7_STARTUP_GATE_RACE_BLOCKED', `${label} changed while the single-instance lock was acquired.`);
    }
  }
  if (
    stableJson(beforeLock.packageContent) !== stableJson(afterLock.packageContent)
    || stableJson(beforeLock.trustedShell) !== stableJson(afterLock.trustedShell)
  ) {
    fail(
      'S7_STARTUP_GATE_RACE_BLOCKED',
      'Complete package content or trusted shell changed while the single-instance lock was acquired.',
    );
  }

  const readyAt = now();
  if (!(readyAt instanceof Date) || !Number.isFinite(readyAt.valueOf())) {
    fail('S7_STARTUP_GATE_INVALID', 'Handoff clock is invalid.');
  }
  const handoffReady = {
    kind: S7_STARTUP_GATE_HANDOFF_READY_KIND,
    schemaVersion: S7_STARTUP_GATE_HANDOFF_READY_SCHEMA,
    status: 'READY_FOR_DB_HANDOFF',
    readyAt: readyAt.toISOString(),
    pid,
    gateId: afterLock.active.gateId,
    invocationId: afterLock.active.invocationId,
    singleInstanceLockAcquired: true,
    canonicalUserDataDir,
    activeGate: requireArtifactBinding(publicArtifact(afterLock.activeArtifact), 'Ready ACTIVE gate'),
    boundGate: requireArtifactBinding(publicArtifact(afterLock.boundArtifact), 'Ready BOUND gate'),
    executable: requireArtifactBinding(publicArtifact(afterLock.executable), 'Ready executable'),
    main: requireArtifactBinding(publicArtifact(afterLock.main), 'Ready Main'),
    intent: requireArtifactBinding(publicArtifact(afterLock.intent), 'Ready intent'),
    package: afterLock.active.bindings.package,
    shell: afterLock.trustedShell,
  };
  io.writeExclusiveJson(afterLock.active.paths.handoffReady, handoffReady);
  io.protectWindowsPath(afterLock.active.paths.handoffReady, 'file');
  const handoffReadyArtifact = io.readStableFile(
    afterLock.active.paths.handoffReady,
    'S7 Main HANDOFF_READY receipt',
    { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES },
  );
  requireSecurePath(
    io,
    handoffReadyArtifact.realPath,
    'file',
    'S7 Main HANDOFF_READY receipt',
    afterLock.trustedShell,
  );
  const persistedReady = parseJsonFile<Record<string, unknown>>(
    handoffReadyArtifact,
    'S7 Main HANDOFF_READY receipt',
  );
  if (stableJson(persistedReady) !== stableJson(handoffReady)) {
    fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'Persisted HANDOFF_READY differs from Main state.');
  }

  const timeoutMs = options.handoffTimeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    fail('S7_STARTUP_GATE_INVALID', 'Handoff timeout is invalid.');
  }
  const deadline = Date.now() + timeoutMs;
  while (!io.existsSync(afterLock.active.paths.handoffReleased)) {
    if (Date.now() >= deadline) {
      fail(
        'S7_STARTUP_GATE_HANDOFF_TIMEOUT',
        'Helper did not release the authority database inside the bounded handoff window.',
      );
    }
    io.sleep(Math.min(HANDOFF_POLL_MS, Math.max(1, deadline - Date.now())));
  }
  const handoffReleasedArtifact = io.readStableFile(
    afterLock.active.paths.handoffReleased,
    'S7 helper HANDOFF_RELEASED receipt',
    { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES },
  );
  requireSecurePath(
    io,
    handoffReleasedArtifact.realPath,
    'file',
    'S7 helper HANDOFF_RELEASED receipt',
    afterLock.trustedShell,
  );
  requireHandoffReleased(
    parseJsonFile<unknown>(handoffReleasedArtifact, 'S7 helper HANDOFF_RELEASED receipt'),
    afterLock.active,
    afterLock.activeArtifact,
    afterLock.boundArtifact,
    handoffReadyArtifact,
    pid,
  );

  return {
    mode: 'S7_APPROVED_CHILD',
    admitted: true,
    singleInstanceLockAcquired: true,
    canonicalUserDataDir,
    gateId: afterLock.active.gateId,
    invocationId: afterLock.active.invocationId,
    pid,
    activeGate: publicArtifact(afterLock.activeArtifact),
    boundGate: publicArtifact(afterLock.boundArtifact),
    handoffReady: publicArtifact(handoffReadyArtifact),
    handoffReleased: publicArtifact(handoffReleasedArtifact),
    admissionPath: afterLock.active.paths.admission,
    expectedDatabase: afterLock.active.bindings.database,
    expectedPackage: afterLock.active.bindings.package,
    expectedIntent: afterLock.active.bindings.intent,
    expectedTrustedShell: afterLock.trustedShell,
  };
}

export interface CompleteS7MainStartupAdmissionOptions {
  startup: Extract<S7MainStartupAdmission, { mode: 'S7_APPROVED_CHILD' }>;
  database: Database.Database;
  resolvedDatabasePath: string;
  executablePath: string;
  mainModulePath: string;
  now?: () => Date;
  io?: Partial<S7StartupGateIo>;
}

function schemaVersionOnConnection(database: Database.Database): number {
  const table = database.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).get() as { count: number };
  if (table.count === 0) return 0;
  const row = database.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM schema_migrations
    WHERE status = 'applied'
  `).get() as { version: number };
  return Number(row.version);
}

export function completeS7MainStartupAdmission(
  options: CompleteS7MainStartupAdmissionOptions,
): S7StableFileArtifact {
  const io: S7StartupGateIo = { ...DEFAULT_IO, ...options.io };
  const { startup, database } = options;
  const expectedTrustedShell = requireStrictTrustedShellBinding(
    startup.expectedTrustedShell,
  );
  const trustedShell = requireStrictTrustedShellBinding(
    io.inspectTrustedPowerShell(),
  );
  if (stableJson(trustedShell) !== stableJson(expectedTrustedShell)) {
    fail(
      'S7_STARTUP_GATE_SHELL_UNTRUSTED',
      'Trusted Windows PowerShell identity drifted between handoff and SQLite takeover.',
    );
  }
  const resolvedDatabasePath = path.resolve(options.resolvedDatabasePath);
  if (
    !database.inTransaction
    || String(database.pragma('locking_mode', { simple: true })).toLowerCase() !== 'exclusive'
  ) {
    fail(
      'S7_STARTUP_GATE_SQLITE_TAKEOVER_UNTRUSTED',
      'Admission requires the guarded connection inside BEGIN EXCLUSIVE.',
    );
  }
  const databaseRows = database.pragma('database_list') as Array<{
    name: string;
    file: string;
  }>;
  const mainDatabase = databaseRows.find((row) => row.name === 'main');
  if (
    !mainDatabase
    || !samePath(mainDatabase.file, resolvedDatabasePath)
    || !samePath(resolvedDatabasePath, startup.expectedDatabase.realPath)
  ) {
    fail(
      'S7_STARTUP_GATE_SQLITE_TAKEOVER_UNTRUSTED',
      'Guarded SQLite connection is not the approved authority database.',
    );
  }
  const schemaVersionBefore = schemaVersionOnConnection(database);
  if (schemaVersionBefore !== 0) {
    fail(
      'S7_STARTUP_GATE_SQLITE_TAKEOVER_UNTRUSTED',
      `Approved migration source must still be schema v0, observed v${schemaVersionBefore}.`,
    );
  }
  const databaseArtifact = io.readStableFile(
    resolvedDatabasePath,
    'Authority database under SQLite exclusive lock',
  );
  requireSecurePath(
    io,
    resolvedDatabasePath,
    'file',
    'Authority database under SQLite exclusive lock',
    trustedShell,
  );
  assertArtifactBound(databaseArtifact, startup.expectedDatabase, 'Authority database');

  const activeArtifact = io.readStableFile(startup.activeGate.realPath, 'Admission ACTIVE gate');
  const boundArtifact = io.readStableFile(startup.boundGate.realPath, 'Admission BOUND gate');
  const readyArtifact = io.readStableFile(startup.handoffReady.realPath, 'Admission HANDOFF_READY');
  const releasedArtifact = io.readStableFile(
    startup.handoffReleased.realPath,
    'Admission HANDOFF_RELEASED',
  );
  for (const [label, expected, actual] of [
    ['ACTIVE gate', startup.activeGate, activeArtifact],
    ['BOUND gate', startup.boundGate, boundArtifact],
    ['HANDOFF_READY', startup.handoffReady, readyArtifact],
    ['HANDOFF_RELEASED', startup.handoffReleased, releasedArtifact],
  ] as const) {
    requireSecurePath(io, actual.realPath, 'file', label, trustedShell);
    if (!sameArtifact(expected, actual)) {
      fail('S7_STARTUP_GATE_RACE_BLOCKED', `${label} drifted before SQLite takeover.`);
    }
  }

  const executable = io.readStableFile(options.executablePath, 'Admission packaged executable');
  const main = io.readStableFile(options.mainModulePath, 'Admission packaged Main');
  const appContent = io.buildAppContentManifest(startup.expectedPackage.appContent.realPath);
  assertPackageBinding({
    exe: requireArtifactBinding(publicArtifact(executable), 'Admission package executable'),
    appContent,
    main: requireArtifactBinding(publicArtifact(main), 'Admission package Main'),
  }, startup.expectedPackage, 'Admission package');
  const intent = io.readStableFile(startup.expectedIntent.realPath, 'Admission launch intent');
  requireSecurePath(io, intent.realPath, 'file', 'Admission launch intent', trustedShell);
  assertArtifactBound(intent, startup.expectedIntent, 'Admission launch intent');
  const admittedAt = (options.now ?? (() => new Date()))();
  if (!(admittedAt instanceof Date) || !Number.isFinite(admittedAt.valueOf())) {
    fail('S7_STARTUP_GATE_INVALID', 'Admission clock is invalid.');
  }
  const admission = {
    kind: S7_STARTUP_GATE_ADMISSION_KIND,
    schemaVersion: S7_STARTUP_GATE_ADMISSION_SCHEMA,
    status: 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK',
    admittedAt: admittedAt.toISOString(),
    pid: startup.pid,
    gateId: startup.gateId,
    invocationId: startup.invocationId,
    singleInstanceLockAcquired: true,
    canonicalUserDataDir: startup.canonicalUserDataDir,
    activeGate: requireArtifactBinding(publicArtifact(activeArtifact), 'Admission ACTIVE gate'),
    boundGate: requireArtifactBinding(publicArtifact(boundArtifact), 'Admission BOUND gate'),
    handoffReady: requireArtifactBinding(publicArtifact(readyArtifact), 'Admission HANDOFF_READY'),
    handoffReleased: requireArtifactBinding(
      publicArtifact(releasedArtifact),
      'Admission HANDOFF_RELEASED',
    ),
    executable: requireArtifactBinding(publicArtifact(executable), 'Admission executable'),
    main: requireArtifactBinding(publicArtifact(main), 'Admission Main'),
    database: requireArtifactBinding(publicArtifact(databaseArtifact), 'Admission database'),
    intent: requireArtifactBinding(publicArtifact(intent), 'Admission intent'),
    package: startup.expectedPackage,
    shell: trustedShell,
    sqliteTakeover: {
      connectionPath: resolvedDatabasePath,
      fileMustExist: true,
      busyTimeoutMs: 0,
      lockingMode: 'exclusive',
      beginMode: 'exclusive',
      transactionActive: true,
      sameConnectionRequiredForMigration: true,
      schemaVersionBefore,
    },
  };
  io.writeExclusiveJson(startup.admissionPath, admission);
  io.protectWindowsPath(startup.admissionPath, 'file');
  const artifact = io.readStableFile(
    startup.admissionPath,
    'S7 Main admission receipt',
    { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES },
  );
  requireSecurePath(
    io,
    artifact.realPath,
    'file',
    'S7 Main admission receipt',
    trustedShell,
  );
  const persisted = parseJsonFile<Record<string, unknown>>(artifact, 'S7 Main admission receipt');
  if (stableJson(persisted) !== stableJson(admission)) {
    fail('S7_STARTUP_GATE_ADMISSION_UNTRUSTED', 'Persisted admission differs from Main state.');
  }
  return publicArtifact(artifact);
}

export const S7_STARTUP_GATE_TESTING = Object.freeze({
  defaultReadStableFile,
  defaultInspectDirectory,
  defaultInspectWindowsPathSecurity,
  defaultBuildAppContentManifest,
  defaultReadAuthoritySchemaVersion,
  defaultInspectPostMigrationAuthority,
  defaultInspectTrustedPowerShell,
  defaultProtectWindowsPath,
  defaultWriteProtectedExclusiveJson,
  postMigrationContractSha256,
  sha256,
  stableJson,
});
