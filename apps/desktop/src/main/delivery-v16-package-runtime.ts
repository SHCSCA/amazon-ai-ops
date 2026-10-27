import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import { assertDirectDirectory, ensureV16OwnedDirectory, materializeV16Build } from './delivery-v16-frozen-build';
import type { DeliveryV16Request } from './delivery-v16-contracts';

const { createPackageUiVerificationContract } = require('../../../../scripts/package-ui-verifier');
const { runReadonlySqliteOnlineBackupSync } = require('../../../../scripts/sqlite-authority-currentness');

function fileDigest(file: string): string {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || fs.realpathSync.native(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error('V16_PACKAGE_FILE_NOT_DIRECT:' + file);
  const handle = fs.openSync(file, 'r');
  try {
    const opened = fs.fstatSync(handle), hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let size: number;
    while ((size = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
    const after = fs.fstatSync(handle);
    if (before.ino !== opened.ino || before.dev !== opened.dev || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) throw new Error('V16_PACKAGE_FILE_CHANGED');
    return hash.digest('hex');
  } finally { fs.closeSync(handle); }
}

export interface V16PackageRuntime {
  frozenBuild: any;
  nativeEnvironment: { Database: typeof Database; [key: string]: unknown };
  cache: ReturnType<typeof materializeV16Build>;
  packagePaths: Record<'installer' | 'portable' | 'zip' | 'mainBundle', string>;
}

export function createV16PackageRuntime(request: DeliveryV16Request, frozen: any): V16PackageRuntime {
  const { paths } = request;
  const cache = materializeV16Build(frozen, paths.cacheRoot);
  assertDirectDirectory(paths.appRoot);
  ensureV16OwnedDirectory(paths.tempRoot);
  const fixedBackupSpawn: typeof spawnSync = ((command: string, argv: readonly string[], options: Record<string, unknown>) => {
    if (command !== process.execPath || argv.length !== 5 || argv[1] !== '--readonly-online-backup-child') throw new Error('V16_BACKUP_CHILD_INVOCATION_REFUSED');
    const currentHelper = fileDigest(paths.backupHelperPath);
    const result = spawnSync(process.execPath, [paths.backupHelperPath, ...argv.slice(1)], {
      ...options, cwd: paths.appRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false, windowsHide: true,
    });
    if (fileDigest(paths.backupHelperPath) !== currentHelper) throw new Error('V16_BACKUP_CHILD_CHANGED');
    return result;
  }) as typeof spawnSync;
  const currentnessContext = { tempRoot: paths.tempRoot, spawnSync: fixedBackupSpawn };
  const packageUiContract = createPackageUiVerificationContract({
    sourceRoot: frozen.sourceRoot, desktopPackage: frozen.desktopPackage,
    runnerContract: frozen.packageUiRunnerContract,
    runReadonlySqliteOnlineBackupSync: (input: unknown) => runReadonlySqliteOnlineBackupSync(input, currentnessContext),
  });
  const release = path.join(paths.workPackageRoot, 'packages');
  const packagePaths = {
    installer: path.join(release, `AmazonAIOpsAgent-${request.appVersion}.exe`),
    portable: path.join(release, `AmazonAIOpsAgent-${request.appVersion}-portable.exe`),
    zip: path.join(release, `AmazonAIOpsAgent-${request.appVersion}.zip`),
    mainBundle: paths.mainBundlePath,
  };
  const currentPackage = () => {
    const app = packageUiContract.buildAppContentManifest(paths.appRoot);
    return {
      release, appRoot: paths.appRoot, paths: packagePaths, executablePath: paths.executablePath,
      packageIdentity: {
        executableSha256: fileDigest(paths.executablePath).toUpperCase(),
        appContentSha256: app.sha256.toUpperCase(),
        mainBundleSha256: fileDigest(paths.mainBundlePath).toUpperCase(),
      },
      inputArtifacts: [cache.requirements, cache.definition, cache.uiGovernanceSource, ...Object.values(cache.securitySources).flatMap((group: any) => group.files)],
    };
  };
  const artifactRoots = [...new Set([
    paths.workPackageRoot, paths.appRoot, path.dirname(paths.executablePath),
    cache.directory, path.dirname(paths.authorityDbPath), paths.tempRoot,
  ])].filter(directory => fs.existsSync(directory)).map(assertDirectDirectory);
  return {
    frozenBuild: frozen,
    nativeEnvironment: {
      currentPackage, artifactRoots, packageUiContract: () => packageUiContract,
      securitySources: cache.securitySources, recordedSourceRoot: frozen.sourceRoot,
      uiGovernanceSource: cache.uiGovernanceSource,
      Database, authorityDbPath: paths.authorityDbPath, authoritySnapshotRoot: paths.authoritySnapshotRoot,
      currentnessContext,
      offlineMigrationRuntime: {
        Database, migrationContract: frozen.migrationContract, allowedV1Checksums: frozen.allowedV1Checksums,
        localDbRuntime: { StoreRepository },
      },
    },
    cache, packagePaths,
  };
}

export { fileDigest as digestV16RuntimeFile };
