import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  SchemaMigrationManifest,
  StoreMigrationRestoreResult,
  UpgradeBackupManifest,
  UpgradeBackupRecoveryPreflight,
} from './types';

const UPGRADE_BACKUP_KIND = 'schema-upgrade-backup' as const;
const UPGRADE_BACKUP_SCHEMA_VERSION = 1 as const;
const MINIMUM_HEADROOM_BYTES = 16 * 1024 * 1024;

export interface UpgradeBackupTarget {
  targetVersion: number;
  targetName: string;
  targetChecksum: string;
}

export interface PrepareUpgradeBackupOptions extends UpgradeBackupTarget {
  /** Test-only disk-space override; production callers must omit it. */
  availableBytes?: number;
  now?: () => Date;
}

export class UpgradeBackupError extends Error {
  constructor(
    readonly targetVersion: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpgradeBackupError';
  }
}

export function prepareUpgradeBackup(
  database: Database.Database,
  options: PrepareUpgradeBackupOptions,
): UpgradeBackupManifest {
  const target = normalizeTarget(options);
  const sourceVersion = readCurrentAppliedVersion(database);
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  if (sourceVersion >= target.targetVersion) {
    return notApplicableManifest(
      target,
      sourceVersion,
      createdAt,
      'not_required',
      '',
      {},
      'target_already_applied',
    );
  }
  const integrityCheck = checkDatabaseIntegrity(database);
  if (integrityCheck !== 'ok') {
    throw new UpgradeBackupError(
      target.targetVersion,
      `Source database integrity_check returned: ${integrityCheck}`,
    );
  }
  const tableRowCounts = collectTableRowCounts(database);
  const schemaFingerprint = fingerprintDatabaseSchema(database);
  const databasePath = fileBackedDatabasePath(database);

  if (!databasePath) {
    return notApplicableManifest(
      target,
      sourceVersion,
      createdAt,
      integrityCheck,
      schemaFingerprint,
      tableRowCounts,
      'memory_database',
    );
  }
  if (Object.keys(tableRowCounts).length === 0) {
    return notApplicableManifest(
      target,
      sourceVersion,
      createdAt,
      integrityCheck,
      schemaFingerprint,
      tableRowCounts,
      'empty_database',
    );
  }

  const absoluteDatabasePath = path.resolve(databasePath);
  const backupPath = `${absoluteDatabasePath}.pre-upgrade-to-v${target.targetVersion}.bak`;
  const manifestPath = `${absoluteDatabasePath}.pre-upgrade-to-v${target.targetVersion}.manifest.json`;
  const pendingPath = `${manifestPath}.pending`;

  const finalManifest = readManifestIfPresent(manifestPath, target.targetVersion);
  if (finalManifest) {
    assertManifestBinding(finalManifest, absoluteDatabasePath, backupPath, manifestPath, target);
    const preflight = getUpgradeBackupRecoveryPreflight(finalManifest);
    if (!preflight.canRestore) {
      throw new UpgradeBackupError(
        target.targetVersion,
        `Existing upgrade backup is not recoverable: ${preflight.blockers.join(' ')}`,
      );
    }
    if (fs.existsSync(pendingPath)) fs.rmSync(pendingPath);
    return { ...finalManifest, status: 'reused' };
  }

  const pendingManifest = readManifestIfPresent(pendingPath, target.targetVersion);
  if (pendingManifest) {
    assertManifestBinding(pendingManifest, absoluteDatabasePath, backupPath, manifestPath, target);
    if (pendingManifest.status !== 'pending') {
      throw new UpgradeBackupError(target.targetVersion, 'Upgrade backup pending proof has an invalid status.');
    }
    if (fs.existsSync(backupPath)) fs.rmSync(backupPath);
    fs.rmSync(pendingPath);
  } else if (fs.existsSync(backupPath) || fs.existsSync(pendingPath)) {
    throw new UpgradeBackupError(
      target.targetVersion,
      'An unbound upgrade backup artifact already exists; refusing to replace or reuse it.',
    );
  }

  checkpointWal(database, target.targetVersion);
  const sourceSizeBytes = fs.statSync(absoluteDatabasePath).size;
  assertDiskHeadroom(
    path.dirname(absoluteDatabasePath),
    sourceSizeBytes,
    target.targetVersion,
    options.availableBytes,
  );

  const pending: UpgradeBackupManifest = {
    kind: UPGRADE_BACKUP_KIND,
    schemaVersion: UPGRADE_BACKUP_SCHEMA_VERSION,
    status: 'pending',
    sourceVersion,
    ...target,
    createdAt,
    integrityCheck,
    schemaFingerprint,
    tableRowCounts,
    databasePath: absoluteDatabasePath,
    backupPath,
    manifestPath,
  };
  writeJsonExclusive(pendingPath, pending);

  try {
    database.exec(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);
    const backupSnapshot = inspectDatabaseFile(backupPath);
    const backupIntegrityCheck = backupSnapshot.integrityCheck;
    if (backupIntegrityCheck !== 'ok') {
      throw new UpgradeBackupError(
        target.targetVersion,
        `Backup integrity_check returned: ${backupIntegrityCheck}`,
      );
    }
    if (backupSnapshot.schemaFingerprint !== schemaFingerprint) {
      throw new UpgradeBackupError(target.targetVersion, 'Backup schema fingerprint does not match the source.');
    }
    if (!sameRowCounts(backupSnapshot.tableRowCounts, tableRowCounts)) {
      throw new UpgradeBackupError(target.targetVersion, 'Backup table row counts do not match the source.');
    }
    const completed: UpgradeBackupManifest = {
      ...pending,
      status: 'created',
      backupIntegrityCheck,
      sha256: hashFile(backupPath),
      sizeBytes: fs.statSync(backupPath).size,
    };
    writeJsonExclusive(manifestPath, completed);
    fs.rmSync(pendingPath);
    return completed;
  } catch (error) {
    if (error instanceof UpgradeBackupError) throw error;
    throw new UpgradeBackupError(target.targetVersion, errorMessage(error));
  }
}

export function getUpgradeBackupRecoveryPreflight(
  manifest: UpgradeBackupManifest,
): UpgradeBackupRecoveryPreflight {
  const blockers: string[] = [];
  let backupIntegrityCheck: string | undefined;
  let backupSha256: string | undefined;
  let schemaFingerprintMatches: boolean | undefined;
  let tableRowCountsMatch: boolean | undefined;

  if (!isUpgradeBackupManifest(manifest)) {
    blockers.push('Upgrade backup manifest is unreadable or unsupported.');
  } else if (manifest.status !== 'created' && manifest.status !== 'reused') {
    blockers.push(`Upgrade backup status is not recoverable: ${manifest.status}.`);
  }
  if (!manifest.backupPath) {
    blockers.push('Upgrade backup path is missing.');
  } else if (!fs.existsSync(manifest.backupPath)) {
    blockers.push(`Upgrade backup is missing: ${manifest.backupPath}`);
  } else {
    try {
      const snapshot = inspectDatabaseFile(manifest.backupPath);
      backupIntegrityCheck = snapshot.integrityCheck;
      if (backupIntegrityCheck !== 'ok') {
        blockers.push(`Upgrade backup integrity_check returned: ${backupIntegrityCheck}`);
      }
      backupSha256 = hashFile(manifest.backupPath);
      if (!manifest.sha256 || backupSha256 !== manifest.sha256) {
        blockers.push('Upgrade backup SHA-256 does not match its manifest.');
      }
      schemaFingerprintMatches = snapshot.schemaFingerprint === manifest.schemaFingerprint;
      if (!schemaFingerprintMatches) blockers.push('Upgrade backup schema fingerprint does not match its manifest.');
      tableRowCountsMatch = sameRowCounts(snapshot.tableRowCounts, manifest.tableRowCounts);
      if (!tableRowCountsMatch) blockers.push('Upgrade backup table row counts do not match its manifest.');
    } catch (error) {
      blockers.push(`Upgrade backup cannot be opened: ${errorMessage(error)}`);
    }
  }

  return {
    version: manifest.targetVersion,
    sourceVersion: manifest.sourceVersion,
    targetVersion: manifest.targetVersion,
    canRestore: blockers.length === 0,
    backupPath: manifest.backupPath,
    backupIntegrityCheck,
    backupSha256,
    manifestPath: manifest.manifestPath,
    schemaFingerprintMatches,
    tableRowCountsMatch,
    blockers,
  };
}

export function restoreUpgradeBackupTo(
  manifest: UpgradeBackupManifest,
  destinationPath: string,
): StoreMigrationRestoreResult {
  const preflight = getUpgradeBackupRecoveryPreflight(manifest);
  if (!preflight.canRestore || !preflight.backupPath || !manifest.sha256) {
    throw new UpgradeBackupError(
      manifest.targetVersion,
      `Upgrade backup is not recoverable: ${preflight.blockers.join(' ')}`,
    );
  }
  if (typeof destinationPath !== 'string' || destinationPath.trim() === '') {
    throw new UpgradeBackupError(manifest.targetVersion, 'Restore destination path is required.');
  }
  const sourcePath = path.resolve(preflight.backupPath);
  const resolvedDestination = path.resolve(destinationPath);
  if (samePath(sourcePath, resolvedDestination)
    || (manifest.databasePath && samePath(manifest.databasePath, resolvedDestination))) {
    throw new UpgradeBackupError(
      manifest.targetVersion,
      'Restore destination must be a new file, never the source database or backup.',
    );
  }
  if (fs.existsSync(resolvedDestination)) {
    throw new UpgradeBackupError(
      manifest.targetVersion,
      `Restore destination already exists: ${resolvedDestination}`,
    );
  }

  const destinationDirectory = path.dirname(resolvedDestination);
  if (!fs.existsSync(destinationDirectory)) {
    throw new UpgradeBackupError(
      manifest.targetVersion,
      `Restore destination directory does not exist: ${destinationDirectory}`,
    );
  }
  const destinationDirectoryStat = fs.lstatSync(destinationDirectory);
  if (destinationDirectoryStat.isSymbolicLink() || !destinationDirectoryStat.isDirectory()) {
    throw new UpgradeBackupError(
      manifest.targetVersion,
      'Restore destination directory must be a regular non-link directory.',
    );
  }
  const restoreTempDirectory = fs.mkdtempSync(path.join(
    destinationDirectory,
    `${path.basename(resolvedDestination)}.restore-`,
  ));
  const restoreTempPath = path.join(restoreTempDirectory, 'backup.db');
  try {
    fs.copyFileSync(sourcePath, restoreTempPath, fs.constants.COPYFILE_EXCL);
    const restoredSnapshot = inspectDatabaseFile(restoreTempPath);
    const sha256 = hashFile(restoreTempPath);
    if (restoredSnapshot.integrityCheck !== 'ok'
      || sha256 !== manifest.sha256
      || restoredSnapshot.schemaFingerprint !== manifest.schemaFingerprint
      || !sameRowCounts(restoredSnapshot.tableRowCounts, manifest.tableRowCounts)) {
      throw new UpgradeBackupError(manifest.targetVersion, 'Restored upgrade backup verification failed.');
    }
    const sizeBytes = fs.statSync(restoreTempPath).size;
    fs.linkSync(restoreTempPath, resolvedDestination);
    return {
      version: manifest.targetVersion,
      sourceBackupPath: sourcePath,
      destinationPath: resolvedDestination,
      integrityCheck: restoredSnapshot.integrityCheck,
      sha256,
      sizeBytes,
    };
  } finally {
    fs.rmSync(restoreTempDirectory, { recursive: true, force: true });
  }
}

export function upgradeBackupFromMigrationManifest(
  manifest: SchemaMigrationManifest | undefined,
): UpgradeBackupManifest | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined;
  const candidate = 'upgradeBackup' in manifest ? manifest.upgradeBackup : undefined;
  return isUpgradeBackupManifest(candidate) ? candidate : undefined;
}

export function isUpgradeBackupManifest(value: unknown): value is UpgradeBackupManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UpgradeBackupManifest>;
  return candidate.kind === UPGRADE_BACKUP_KIND
    && candidate.schemaVersion === UPGRADE_BACKUP_SCHEMA_VERSION
    && Number.isInteger(candidate.sourceVersion)
    && Number.isInteger(candidate.targetVersion)
    && typeof candidate.targetName === 'string'
    && typeof candidate.targetChecksum === 'string'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.integrityCheck === 'string'
    && typeof candidate.schemaFingerprint === 'string'
    && Boolean(candidate.tableRowCounts && typeof candidate.tableRowCounts === 'object');
}

export function fingerprintDatabaseSchema(database: Database.Database): string {
  const rows = database.prepare(`
    SELECT type, name, tbl_name AS tableName, COALESCE(sql, '') AS sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as Array<{ type: string; name: string; tableName: string; sql: string }>;
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export function collectTableRowCounts(database: Database.Database): Record<string, number> {
  const tables = (database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((row) => row.name);
  return Object.fromEntries(tables.map((table) => {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count: number };
    return [table, Number(row.count)];
  }));
}

function inspectDatabaseFile(filePath: string): {
  integrityCheck: string;
  schemaFingerprint: string;
  tableRowCounts: Record<string, number>;
} {
  const inspected = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return {
      integrityCheck: checkDatabaseIntegrity(inspected),
      schemaFingerprint: fingerprintDatabaseSchema(inspected),
      tableRowCounts: collectTableRowCounts(inspected),
    };
  } finally {
    inspected.close();
  }
}

function normalizeTarget(options: PrepareUpgradeBackupOptions): UpgradeBackupTarget {
  if (!Number.isInteger(options.targetVersion) || options.targetVersion < 1) {
    throw new UpgradeBackupError(0, 'Upgrade target version must be a positive integer.');
  }
  if (!options.targetName?.trim() || !options.targetChecksum?.trim()) {
    throw new UpgradeBackupError(options.targetVersion, 'Upgrade target name and checksum are required.');
  }
  return {
    targetVersion: options.targetVersion,
    targetName: options.targetName.trim(),
    targetChecksum: options.targetChecksum.trim(),
  };
}

function readCurrentAppliedVersion(database: Database.Database): number {
  const exists = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
  `).get();
  if (!exists) return 0;
  const row = database.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM schema_migrations
    WHERE status = 'applied'
  `).get() as { version: number };
  return Number(row.version) || 0;
}

function notApplicableManifest(
  target: UpgradeBackupTarget,
  sourceVersion: number,
  createdAt: string,
  integrityCheck: string,
  schemaFingerprint: string,
  tableRowCounts: Record<string, number>,
  reason: UpgradeBackupManifest['reason'],
): UpgradeBackupManifest {
  return {
    kind: UPGRADE_BACKUP_KIND,
    schemaVersion: UPGRADE_BACKUP_SCHEMA_VERSION,
    status: 'not_applicable',
    sourceVersion,
    ...target,
    createdAt,
    integrityCheck,
    schemaFingerprint,
    tableRowCounts,
    reason,
  };
}

function assertManifestBinding(
  manifest: UpgradeBackupManifest,
  databasePath: string,
  backupPath: string,
  manifestPath: string,
  target: UpgradeBackupTarget,
): void {
  if (!isUpgradeBackupManifest(manifest)
    || !manifest.databasePath
    || !manifest.backupPath
    || !manifest.manifestPath
    || !samePath(manifest.databasePath, databasePath)
    || !samePath(manifest.backupPath, backupPath)
    || !samePath(manifest.manifestPath, manifestPath)
    || manifest.targetVersion !== target.targetVersion
    || manifest.targetName !== target.targetName
    || manifest.targetChecksum !== target.targetChecksum) {
    throw new UpgradeBackupError(
      target.targetVersion,
      'Existing upgrade backup manifest is not bound to this database and target.',
    );
  }
}

function readManifestIfPresent(filePath: string, targetVersion: number): UpgradeBackupManifest | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!isUpgradeBackupManifest(parsed)) throw new Error('unsupported manifest shape');
    return parsed;
  } catch (error) {
    throw new UpgradeBackupError(
      targetVersion,
      `Upgrade backup manifest cannot be read: ${errorMessage(error)}`,
    );
  }
}

function writeJsonExclusive(filePath: string, value: unknown): void {
  const handle = fs.openSync(filePath, 'wx');
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function checkpointWal(database: Database.Database, targetVersion: number): void {
  const rows = database.pragma('wal_checkpoint(FULL)') as Array<{ busy?: number }>;
  if (rows.some((row) => Number(row.busy ?? 0) !== 0)) {
    throw new UpgradeBackupError(targetVersion, 'WAL checkpoint is busy; close other database users and retry.');
  }
}

function assertDiskHeadroom(
  directory: string,
  sourceSizeBytes: number,
  targetVersion: number,
  availableBytesOverride?: number,
): void {
  let availableBytes = availableBytesOverride;
  if (availableBytes === undefined) {
    const stats = fs.statfsSync(directory);
    availableBytes = Number(stats.bavail) * Number(stats.bsize);
  }
  const requiredBytes = Math.max(MINIMUM_HEADROOM_BYTES, sourceSizeBytes * 2);
  if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
    throw new UpgradeBackupError(
      targetVersion,
      `Insufficient disk space for upgrade backup (required=${requiredBytes}, available=${availableBytes}).`,
    );
  }
}

function fileBackedDatabasePath(database: Database.Database): string | undefined {
  const name = database.name;
  if (!name || name === ':memory:' || name.startsWith('file::memory:')) return undefined;
  return name;
}

function checkDatabaseIntegrity(database: Database.Database): string {
  const rows = database.pragma('integrity_check') as Array<Record<string, unknown>>;
  return rows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? '')).join('; ');
}

function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function sameRowCounts(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
