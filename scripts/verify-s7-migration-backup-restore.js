const fs = require('fs');
const path = require('path');
const {
  collectRowCounts,
  loadLocalDbRuntime,
  normalizeSha256,
  readAppliedVersion,
  requireSqlite,
  sha256File,
} = require('./migrate-current-user-db.js');

function parseS7VerifierArgs(argv) {
  const args = { manifest: '', out: '' };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--manifest') args.manifest = argv[++index] || '';
    else if (token === '--out') args.out = argv[++index] || '';
    else throw new Error(`Unexpected argument: ${token}`);
  }
  if (!args.manifest || !path.isAbsolute(args.manifest)) {
    throw new Error('--manifest must be an absolute path to S7 offline migration evidence.');
  }
  if (args.out && !path.isAbsolute(args.out)) throw new Error('--out must be an absolute path.');
  return args;
}

function verifyS7MigrationBackupRestore(manifestPath) {
  const absoluteManifestPath = path.resolve(manifestPath);
  assertRegularFile(absoluteManifestPath, 'S7 migration manifest');
  const manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, 'utf8'));
  const checks = [];
  const add = (code, passed, detail) => checks.push({ code, passed: Boolean(passed), detail });

  add('MANIFEST_SCHEMA_VALID', manifest.kind === 's7-offline-db-upgrade'
    && manifest.schemaVersion === 1
    && manifest.passed === true, 'offline migration evidence schema v1');
  add('SOURCE_AND_OUTPUT_PATHS_DISTINCT', Boolean(
    manifest.source?.path
    && manifest.workingDatabase?.path
    && manifest.restore?.destinationPath
    && !samePath(manifest.source.path, manifest.workingDatabase.path)
    && !samePath(manifest.source.path, manifest.restore.destinationPath)
    && !samePath(manifest.workingDatabase.path, manifest.restore.destinationPath)
  ), 'source, upgraded copy, and restored copy must be distinct');

  verifyBoundFile(checks, 'SOURCE', manifest.source?.path, manifest.source?.sha256);
  verifyBoundFile(
    checks,
    'UPGRADED_COPY',
    manifest.workingDatabase?.path,
    manifest.workingDatabase?.upgradedSha256,
  );
  verifyBoundFile(checks, 'RESTORED_COPY', manifest.restore?.destinationPath, manifest.restore?.sha256);

  const Database = requireSqlite();
  let upgraded;
  try {
    upgraded = new Database(manifest.workingDatabase.path, { readonly: true, fileMustExist: true });
    const upgradedIntegrity = upgraded.pragma('integrity_check', { simple: true });
    const foreignKeyViolations = upgraded.pragma('foreign_key_check');
    const appliedVersions = upgraded.prepare(`
      SELECT version FROM schema_migrations WHERE status = 'applied' ORDER BY version
    `).all().map((row) => Number(row.version));
    add('UPGRADED_INTEGRITY_OK', upgradedIntegrity === 'ok', `integrity=${upgradedIntegrity}`);
    add('UPGRADED_FOREIGN_KEYS_OK', foreignKeyViolations.length === 0, `violations=${foreignKeyViolations.length}`);
    add('MIGRATIONS_1_TO_9_APPLIED', JSON.stringify(appliedVersions) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]), appliedVersions.join(','));

    const runtime = loadLocalDbRuntime();
    const repository = new runtime.StoreRepository(upgraded);
    let preflight;
    try {
      preflight = repository.getMigrationRecoveryPreflight(9);
      add('V9_BACKUP_PREFLIGHT_OK', preflight.canRestore === true, preflight.blockers.join(' '));
      add('V9_BACKUP_SOURCE_VERSION_BOUND', preflight.sourceVersion === manifest.source.version,
        `source=${manifest.source.version}, backup=${preflight.sourceVersion}`);
      add('V9_BACKUP_SCHEMA_BOUND', preflight.schemaFingerprintMatches === true,
        `schemaFingerprintMatches=${preflight.schemaFingerprintMatches}`);
      add('V9_BACKUP_ROWS_BOUND', preflight.tableRowCountsMatch === true,
        `tableRowCountsMatch=${preflight.tableRowCountsMatch}`);
    } catch (error) {
      add('V9_BACKUP_PREFLIGHT_OK', false, error.message);
    }
  } catch (error) {
    add('UPGRADED_DATABASE_READABLE', false, error.message);
  } finally {
    if (upgraded?.open) upgraded.close();
  }

  let restored;
  try {
    restored = new Database(manifest.restore.destinationPath, { readonly: true, fileMustExist: true });
    const restoredIntegrity = restored.pragma('integrity_check', { simple: true });
    const restoredVersion = readAppliedVersion(restored);
    const restoredRowCounts = collectRowCounts(restored);
    add('RESTORED_INTEGRITY_OK', restoredIntegrity === 'ok', `integrity=${restoredIntegrity}`);
    add('RESTORED_SOURCE_VERSION_MATCH', restoredVersion === manifest.source.version,
      `source=${manifest.source.version}, restored=${restoredVersion}`);
    add('RESTORED_ROW_COUNTS_MATCH', sameNumericRecord(restoredRowCounts, manifest.source.tableRowCounts),
      'restored row counts equal the source snapshot');
  } catch (error) {
    add('RESTORED_DATABASE_READABLE', false, error.message);
  } finally {
    if (restored?.open) restored.close();
  }

  const migrationRecords = Array.isArray(manifest.migrations) ? manifest.migrations : [];
  add('EVIDENCE_MIGRATION_RECORDS_BOUND', migrationRecords.length === 9
    && migrationRecords.every((record, index) => Number(record.version) === index + 1 && record.status === 'applied'),
  `records=${migrationRecords.length}`);
  add('BUSINESS_ROWS_PRESERVED', Array.isArray(manifest.preservationFailures)
    && manifest.preservationFailures.length === 0, `failures=${JSON.stringify(manifest.preservationFailures || null)}`);

  const passedCount = checks.filter((check) => check.passed).length;
  return {
    kind: 's7-migration-backup-restore-verification',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceManifestPath: absoluteManifestPath,
    sourceManifestSha256: sha256File(absoluteManifestPath),
    passed: passedCount === checks.length,
    checks,
    summary: {
      total: checks.length,
      passed: passedCount,
      failed: checks.length - passedCount,
    },
  };
}

function verifyBoundFile(checks, prefix, filePath, expectedSha256) {
  try {
    assertRegularFile(filePath, `${prefix} file`);
    const normalizedExpected = normalizeSha256(expectedSha256, `${prefix} SHA-256`);
    const actual = sha256File(filePath);
    checks.push({
      code: `${prefix}_HASH_MATCH`,
      passed: actual === normalizedExpected,
      detail: `expected=${normalizedExpected}, actual=${actual}`,
    });
  } catch (error) {
    checks.push({ code: `${prefix}_HASH_MATCH`, passed: false, detail: error.message });
  }
}

function assertRegularFile(filePath, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
    throw new Error(`${label} is missing or not absolute.`);
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} is not a regular non-link file.`);
}

function sameNumericRecord(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && Number(left[key]) === Number(right[key]));
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function writeJsonExclusive(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = fs.openSync(filePath, 'wx');
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function main() {
  try {
    const args = parseS7VerifierArgs(process.argv);
    const evidence = verifyS7MigrationBackupRestore(args.manifest);
    if (args.out) writeJsonExclusive(path.resolve(args.out), evidence);
    console.log(JSON.stringify(evidence, null, 2));
    if (!evidence.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`[S7 MIGRATION VERIFICATION BLOCKED] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseS7VerifierArgs,
  verifyS7MigrationBackupRestore,
};

if (require.main === module) main();
