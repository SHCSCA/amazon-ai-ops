import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

// 独立子进程拒绝真实开发迁移树读取，验证操作路径而非仅检查模块导入。
// 夹具只验证回执结构与端口，不证明真实迁移或数据库内容。
function scenario() {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const { createHash } = require('node:crypto');
  const mode = process.argv[1], sourceRoot = path.resolve('packages/local-db/src/sqlite/migrations');
  const read = fs.readFileSync;
  let sourceReads = 0;
  fs.readFileSync = function (file, ...args) {
    const normalized = typeof file === 'string' ? path.resolve(file) : '';
    if (normalized === sourceRoot || normalized.startsWith(sourceRoot + path.sep)) {
      sourceReads += 1; throw new Error('DEVELOPER_MIGRATION_SOURCE_FORBIDDEN');
    }
    return read.call(this, file, ...args);
  };
  const business = require('./scripts/v16-native-business-adapters');
  const receiptValidator = require('./scripts/verify-s7-live-migration-acceptance');
  const { REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES: codes } = receiptValidator;
  const { REQUIRED_TABLES } = require('./scripts/verify-production-authority-selection');
  const { CURRENTNESS_METHOD } = require('./scripts/sqlite-authority-currentness');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-live-unit-'));
  const loads = [];
  let error = null, result = null;
  try {
    const record = (name) => {
      const file = path.join(root, name), bytes = Buffer.from('isolated-unit-' + name);
      fs.writeFileSync(file, bytes);
      return { path: file, realPath: file, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
    };
    const database = record('database.db'), selection = record('selection.json');
    const manifest = record('manifest.json'), verification = record('verification.json');
    const logical = 'b'.repeat(64), target = 3;
    const offline = (name) => {
      const file = path.join(root, name);
      return { path: file, identity: { realPath: file, dev: 1, ino: 1, birthtimeMs: 1, nlink: 1 },
        sha256: 'a'.repeat(64), sizeBytes: 1, mtimeMs: 1, openedReadOnly: true, queryOnly: true,
        integrityCheck: 'ok', sidecarsAbsentBeforeAndAfter: true };
    };
    const receipt = { kind: 's7-live-migration-acceptance', schemaVersion: 's7-live-migration-acceptance/v1',
      generatedAt: new Date().toISOString(), status: 'PASSED', passed: true, formalEvidence: true,
      authorityDatabaseMutated: false, adsExecutionInvoked: false,
      inputs: { database: { ...database, logicalSnapshotSha256: logical, logicalSnapshotSizeBytes: 1 },
        authoritySelection: selection, migrationManifest: manifest, migrationVerification: verification },
      checks: codes.map(code => ({ code, passed: true, detail: 'ISOLATED_UNIT_ONLY' })),
      summary: { total: codes.length, passed: codes.length, failed: 0, integrityCheck: 'ok', foreignKeyViolationCount: 0,
        migrationCount: target, requiredTableCount: REQUIRED_TABLES.length,
        offlineArtifacts: { pathsDistinct: true,
          working: { ...offline('working.db'), foreignKeyViolationCount: 0, migrationCount: target,
            businessRowPreservationPassed: true, recoveryCanRestore: true },
          restore: { ...offline('restore.db'), version: 2, sourceBaselineRowsMatch: true } },
        businessRowPreservation: { passed: true, failureCount: 0, listingCurrentToHistoryTransferApplied: false,
          listingCurrentToHistoryTransferPassed: true },
        recovery: { sourceVersion: 2, targetVersion: target, backupPath: path.join(root, 'backup.db'),
          backupSha256: 'a'.repeat(64), backupSizeBytes: 1, manifestPath: path.join(root, 'backup.json'), manifestSha256: 'a'.repeat(64),
          backupIntegrityCheck: 'ok', schemaFingerprintMatches: true, tableRowCountsMatch: true,
          embeddedManifestMatchesAdjacentFile: true, canRestore: true, blockerCount: 0 } },
      safety: { liveDatabaseAccess: CURRENTNESS_METHOD, liveDatabaseOpenedReadOnly: true, liveDatabaseQueryOnly: true,
        logicalSnapshotInspectedReadOnly: true, walAwareSnapshotProofCount: 2, authorityDatabaseMutated: false,
        adsExecutionInvoked: false, businessRowContentIncluded: false, rawSecretsIncluded: false } };
    const contract = Array.from({ length: target }, (_, i) => ({ version: i + 1, name: 'unit-' + i, checksum: 'unit-checksum-' + i }));
    const environment = { offlineMigrationRuntime: { migrationContract: contract } };
    const context = { root, trustedNativeEnvironment: environment,
      descriptors: new Map([['offline', manifest]]),
      load: (id, adapter) => { loads.push([id, adapter]); return id === 'authority'
        ? { source: { absolutePath: database.path }, snapshot: { sha256: logical } } : {}; } };
    if (mode === 'summary') receipt.summary.migrationCount = 22;
    if (mode === 'working') receipt.summary.offlineArtifacts.working.migrationCount = 22;
    if (mode === 'restore') receipt.summary.offlineArtifacts.restore.version = target;
    if (mode === 'recovery') receipt.summary.recovery.targetVersion = 22;
    if (mode === 'invalid-contract') contract[1].version = 1;
    if (mode === 'sparse-all') environment.offlineMigrationRuntime.migrationContract = new Array(target);
    if (mode === 'sparse-slot') delete contract[1];
    if (mode === 'missing-runtime' || mode === 'raw-override') delete environment.offlineMigrationRuntime;
    if (mode === 'raw-override') receipt.trustedNativeEnvironment = { offlineMigrationRuntime: { migrationContract: contract } };
    if (mode === 'ordinary') result = receiptValidator.validateS7LiveMigrationAcceptanceReceipt(receipt);
    else result = business.verifyLiveMigration(receipt, { authorityArtifactId: 'authority', migrationArtifactId: 'offline' }, context);
  } catch (caught) { error = caught.message; }
  finally {
    fs.readFileSync = read;
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('trusted-live-unit-')) throw new Error('UNIT_CLEANUP_OWNER_INVALID');
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify({ mode, result, error, sourceReads, loads }) + '\n');
}

function run(mode) {
  const child = spawnSync(process.execPath, ['-e', `(${scenario.toString()})()`, mode], { encoding: 'utf8', windowsHide: true });
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}

describe('冻结迁移合同的实际回执操作', () => {
  it('无开发迁移源码时仍以可信冻结合同验证实际回执和绑定原件', () => {
    expect(run('valid')).toEqual({ mode: 'valid', result: true, error: null, sourceReads: 0,
      loads: [['authority', 'authority-snapshot'], ['offline', 'offline-migration']] });
  });
  it.each(['summary', 'working', 'restore', 'recovery'])('待验%s版本不能覆盖冻结目标', (mode) => {
    expect(run(mode)).toMatchObject({ result: null, error: expect.stringMatching(/Live migration acceptance/), sourceReads: 0, loads: [] });
  });
  it.each(['invalid-contract', 'sparse-all', 'sparse-slot'])('不完整或重复冻结合同%s在读取待验回执前拒绝', mode => {
    expect(run(mode)).toMatchObject({ result: null, error: 'TRUSTED_MIGRATION_CONTRACT_INVALID', sourceReads: 0, loads: [] });
  });
  it.each(['missing-runtime', 'raw-override'])('缺少可信端口时%s不能从回执自报或开发源码回退', mode => {
    expect(run(mode)).toMatchObject({ result: null, error: 'TRUSTED_MIGRATION_RUNTIME_REQUIRED', sourceReads: 0, loads: [] });
  });
  it('普通非打包验证仍读取实际注册表，不能自动接受回执自报目标', () => {
    expect(run('ordinary')).toMatchObject({ result: null, error: 'DEVELOPER_MIGRATION_SOURCE_FORBIDDEN', sourceReads: 1, loads: [] });
  });
});
