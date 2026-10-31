const fs = require('fs');
const { isValidAppVersion } = require('./current-app-version');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const {
  EXPECTED_ELECTRON_MODULES_ABI,
  prepareNativeRuntime,
  resolveInstalledElectronMetadata,
  resolveSourceNativePaths,
  sanitizedNativeEnvironment,
  sha256File,
  withNativeRuntimeLock,
  withPreparedIsolatedElectronRuntime,
} = require('./prepare-native-runtime.js');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP_ROOT = path.join(ROOT, 'apps', 'desktop');
const DESKTOP_PACKAGE_JSON = path.join(DESKTOP_ROOT, 'package.json');
const DEFAULT_PACKAGE_EXE = path.join(
  DESKTOP_ROOT,
  'release',
  'win-unpacked',
  'AmazonAIOpsAgent.exe',
);
const PACKAGE_QUARANTINE_PREFIX = '.amazon-ai-ops-package-rollback-';
const BUILD_SCHEMA_VERSION = 'amazon-ai-ops-windows-package-build/v1';

function buildWindowsPackage(injected = {}) {
  const electronMetadata = injected.electronMetadata
    || resolveInstalledElectronMetadata();
  const sourcePaths = injected.sourcePaths
    || resolveSourceNativePaths(electronMetadata);
  const packageExe = path.resolve(injected.packageExe || DEFAULT_PACKAGE_EXE);
  const packageOutputs = injected.packageOutputs
    || resolveExpectedPackageOutputs(packageExe);
  const prepare = injected.prepareNativeRuntime || prepareNativeRuntime;
  const holdLock = injected.withLock || withNativeRuntimeLock;
  const prepareElectron = injected.withPreparedElectron
    || withPreparedIsolatedElectronRuntime;
  const requireFreshOutputs = injected.withFreshPackageOutputs
    || withFreshPackageOutputs;
  const runBuildSteps = injected.runBuildSteps || executeWindowsBuildSteps;
  const hashFile = injected.sha256File || sha256File;
  const direct = (callback) => callback();

  return holdLock(() => {
    const sourceBefore = {
      sqliteSha256: hashFile(sourcePaths.sqliteBindingPath),
      duckdbSha256: hashFile(sourcePaths.duckdbBindingPath),
    };
    let sourceAfter;
    const buildResult = requireFreshOutputs(packageOutputs, () => {
    const preparedResult = prepareElectron(
      sourcePaths,
      electronMetadata,
      (electronPreparation) => {
      if (electronPreparation.target.modulesAbi !== EXPECTED_ELECTRON_MODULES_ABI) {
        throw new Error(
          `Isolated Electron preparation did not prove ABI ${EXPECTED_ELECTRON_MODULES_ABI}.`,
        );
      }
      if (electronPreparation.bindings.duckdb.sha256 !== sourceBefore.duckdbSha256) {
        throw new Error('Isolated Electron preparation changed the source DuckDB binding.');
      }

        const builderEnvironment = {
          AAO_STAGED_SQLITE_BINDING: electronPreparation.bindings.sqlite.path,
          AAO_STAGED_SQLITE_SHA256: electronPreparation.bindings.sqlite.sha256,
          AAO_SOURCE_DUCKDB_SHA256: sourceBefore.duckdbSha256,
          AAO_ELECTRON_VERSION: electronMetadata.version,
          AAO_ELECTRON_MODULES_ABI: EXPECTED_ELECTRON_MODULES_ABI,
        };
        const stepResults = runBuildSteps(injected.buildSteps, builderEnvironment);
        const freshOutputs = inspectFreshPackageOutputs(packageOutputs);
        const packagePreparation = prepare(
          { mode: 'package', packageExe },
          {
            electronMetadata,
            packagePaths: injected.packagePaths,
            withLock: direct,
          },
        );
        if (packagePreparation.target.modulesAbi !== EXPECTED_ELECTRON_MODULES_ABI) {
          throw new Error(
            `Packaged runtime did not prove ABI ${EXPECTED_ELECTRON_MODULES_ABI}.`,
          );
        }
        if (packagePreparation.bindings.duckdb.sha256 !== sourceBefore.duckdbSha256) {
          throw new Error(
            'Packaged DuckDB binding does not match the source pre-build DuckDB baseline.',
          );
        }
        if (packagePreparation.bindings.sqlite.sha256
          !== electronPreparation.bindings.sqlite.sha256) {
          throw new Error(
            'Packaged better-sqlite3 binding does not match the verified Electron binding.',
          );
        }

        return {
          electronPreparation,
          packagePreparation,
          stepResults,
          freshOutputs,
        };
      },
      { withLock: direct },
    );

    sourceAfter = {
      sqliteSha256: hashFile(sourcePaths.sqliteBindingPath),
      duckdbSha256: hashFile(sourcePaths.duckdbBindingPath),
    };
    if (sourceAfter.sqliteSha256 !== sourceBefore.sqliteSha256
      || sourceAfter.duckdbSha256 !== sourceBefore.duckdbSha256) {
      throw new Error('Windows package build changed read-only source native bindings.');
    }
    return preparedResult;
    });

    return {
      kind: 'amazon-ai-ops-windows-package-build',
      schemaVersion: BUILD_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      electron: {
        version: electronMetadata.version,
        modulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
      },
      sourceBindings: {
        before: sourceBefore,
        after: sourceAfter,
        unchangedExact: true,
        sourceReadOnly: true,
      },
      package: {
        executablePath: packageExe,
        executableSha256: buildResult.freshOutputs.executable.sha256,
        installerPath: buildResult.freshOutputs.installer.path,
        installerSha256: buildResult.freshOutputs.installer.sha256,
        portablePath: buildResult.freshOutputs.portable.path,
        portableSha256: buildResult.freshOutputs.portable.sha256,
        folderZipPath: buildResult.freshOutputs.folderZip.path,
        folderZipSha256: buildResult.freshOutputs.folderZip.sha256,
        defaultNoInstallDelivery: 'folder_zip',
        blockmapPath: buildResult.freshOutputs.blockmap.path,
        blockmapSha256: buildResult.freshOutputs.blockmap.sha256,
        sqliteSha256: buildResult.packagePreparation.bindings.sqlite.sha256,
        duckdbSha256: buildResult.packagePreparation.bindings.duckdb.sha256,
        freshCurrentRun: true,
      },
      steps: buildResult.stepResults,
      ...(buildResult.outputRetention ? { outputRetention: buildResult.outputRetention } : {}),
      nativePreparation: {
        electronAction: buildResult.electronPreparation.action,
        packageAction: buildResult.packagePreparation.action,
      },
    };
  });
}

function resolveExpectedPackageOutputs(packageExe = DEFAULT_PACKAGE_EXE) {
  const desktopPackage = readJson(DESKTOP_PACKAGE_JSON);
  const version = String(desktopPackage.version || '');
  if (!isValidAppVersion(version)) {
    throw new Error(`Desktop package has an invalid exact version: ${version}`);
  }
  const executablePath = path.resolve(packageExe);
  const winUnpackedRoot = path.dirname(executablePath);
  const releaseRoot = path.dirname(winUnpackedRoot);
  if (path.basename(winUnpackedRoot).toLowerCase() !== 'win-unpacked'
    || path.basename(executablePath).toLowerCase() !== 'amazonaiopsagent.exe') {
    throw new Error(`Unexpected canonical packaged executable path: ${executablePath}`);
  }
  const artifactBase = `AmazonAIOpsAgent-${version}`;
  return Object.freeze({
    releaseRoot,
    winUnpackedRoot,
    executablePath,
    installerPath: path.join(releaseRoot, `${artifactBase}.exe`),
    portablePath: path.join(releaseRoot, `${artifactBase}-portable.exe`),
    folderZipPath: path.join(releaseRoot, `${artifactBase}.zip`),
    blockmapPath: path.join(releaseRoot, `${artifactBase}.exe.blockmap`),
  });
}

function withFreshPackageOutputs(outputs, callback) {
  const scope = createPackageOutputArchive(outputs);
  let result;
  let primaryError;
  let hasPrimaryError = false;
  let rollbackFailed = false;
  const secondaryErrors = [];
  try {
    writePackageArchiveRecord(scope, 'started.json', packageArchiveReceipt(scope, 'started'));
    if (scope.previousIdentity) {
      movePackageOutputTree(scope, scope.releaseRoot, scope.previousPath, scope.previousIdentity);
      scope.previousRetained = true;
    }
    assertPackageDestinationAbsent(scope.releaseRoot);
    fs.mkdirSync(scope.releaseRoot);
    scope.currentIdentity = packageDirectoryIdentity(assertDirectPackageDirectory(scope.releaseRoot));
    result = callback();
    assertPackageArchiveOwner(scope);
    assertPackageTreeDirect(scope.releaseRoot);
    assertDirectPackageDirectory(scope.releaseRoot, scope.currentIdentity);
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
  }
  if (hasPrimaryError) {
    try {
      retainFailedPackageOutputs(scope);
    } catch (retentionError) {
      secondaryErrors.push(retentionError);
      rollbackFailed = true;
    }
  }
  let status = hasPrimaryError
    ? (secondaryErrors.length ? 'failed-retained-unrestored' : 'failed-restored') : 'succeeded';
  const receipt = packageArchiveReceipt(scope, status, primaryError, secondaryErrors, hasPrimaryError);
  try {
    writePackageArchiveRecord(scope, 'receipt.json', receipt);
  } catch (receiptError) {
    if (hasPrimaryError) secondaryErrors.push(receiptError);
    else {
      primaryError = receiptError; hasPrimaryError = true;
      try { retainFailedPackageOutputs(scope); }
      catch (retentionError) { secondaryErrors.push(retentionError); rollbackFailed = true; }
    }
    const buildOutcome = status;
    status = rollbackFailed ? 'receipt-write-failed-unrestored' : 'receipt-write-failed';
    try {
      writePackageArchiveRecord(scope, 'receipt-failure.json', {
        ...packageArchiveReceipt(scope, status, primaryError, secondaryErrors, true), buildOutcome,
        originalReceiptPath: path.join(scope.archiveRoot, 'receipt.json'), receiptPath: path.join(scope.archiveRoot, 'receipt-failure.json'),
      });
    } catch (fallbackReceiptError) {
      secondaryErrors.push(fallbackReceiptError);
    }
  }
  if (hasPrimaryError) {
    try {
      process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'package.outputs_retained_after_failure', {
        archiveId: path.basename(scope.archiveRoot), status, primaryErrorName: primaryError?.name || 'Error',
        secondaryErrorCount: secondaryErrors.length, previousRetained: scope.previousRetained,
        failedRetained: scope.failedRetained, previousRestored: scope.previousRestored,
      })) + '\n');
    } catch (loggingError) {
      secondaryErrors.push(loggingError);
    }
    if (secondaryErrors.length) {
      throw new AggregateError([primaryError, ...secondaryErrors],
        `Windows package failed; inspect retained archive ${path.basename(scope.archiveRoot)}.`);
    }
    throw primaryError;
  }
  return result && typeof result === 'object' ? { ...result, outputRetention: receipt } : result;
}

function createPackageOutputArchive(outputs) {
  const releaseRoot = path.resolve(outputs.releaseRoot);
  const parentRoot = path.dirname(releaseRoot);
  if (releaseRoot === parentRoot
    || packagePathKey(outputs.winUnpackedRoot) !== packagePathKey(path.join(releaseRoot, 'win-unpacked'))
    || packagePathKey(outputs.executablePath) !== packagePathKey(path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe'))) {
    throw new Error(`Unexpected canonical package output roots: ${releaseRoot}`);
  }
  const pathEntries = packageOutputEntries(outputs);
  const unique = new Set();
  for (const entry of pathEntries) {
    if (packagePathKey(path.dirname(entry.path)) !== packagePathKey(releaseRoot)
      || unique.has(packagePathKey(entry.path))) {
      throw new Error(`Package output escapes the canonical release root: ${entry.path}`);
    }
    unique.add(packagePathKey(entry.path));
  }
  ensureDirectPackageDirectory(parentRoot);
  const parentIdentity = packageDirectoryIdentity(assertDirectPackageDirectory(parentRoot));
  const previousStat = optionalPackageStat(releaseRoot);
  const previousIdentity = previousStat ? packageDirectoryIdentity(assertDirectPackageDirectory(releaseRoot)) : null;
  if (previousIdentity) assertPackageTreeDirect(releaseRoot);
  const archiveRoot = fs.mkdtempSync(path.join(parentRoot, PACKAGE_QUARANTINE_PREFIX));
  return {
    releaseRoot, parentRoot, parentIdentity, archiveRoot,
    archiveIdentity: packageDirectoryIdentity(assertDirectPackageDirectory(archiveRoot)),
    previousPath: path.join(archiveRoot, 'previous-release'), failedPath: path.join(archiveRoot, 'failed-release'),
    previousIdentity, currentIdentity: null, previousRetained: false, failedRetained: false, previousRestored: false,
  };
}

function retainFailedPackageOutputs(scope) {
  if (scope.currentIdentity && optionalPackageStat(scope.releaseRoot)) {
    movePackageOutputTree(scope, scope.releaseRoot, scope.failedPath, scope.currentIdentity);
    scope.failedRetained = true;
  }
  if (scope.previousRetained) {
    movePackageOutputTree(scope, scope.previousPath, scope.releaseRoot, scope.previousIdentity);
    scope.previousRestored = true;
  }
}

function movePackageOutputTree(scope, source, destination, identity) {
  const allowed = [[scope.releaseRoot, scope.previousPath], [scope.releaseRoot, scope.failedPath], [scope.previousPath, scope.releaseRoot]];
  if (!allowed.some(([from, to]) => from === source && to === destination)) {
    throw new Error('Unowned package output rename requested.');
  }
  assertPackageArchiveOwner(scope);
  assertPackageTreeDirect(source);
  assertDirectPackageDirectory(source, identity);
  assertPackageDestinationAbsent(destination);
  // 只移动完整自有目录，不遍历删除，不覆盖任何已存在的旧包或失败原件。
  fs.renameSync(source, destination);
  if (destination === scope.previousPath) scope.previousRetained = true;
  if (destination === scope.failedPath) scope.failedRetained = true;
  if (source === scope.previousPath) scope.previousRestored = true;
  assertDirectPackageDirectory(destination, identity);
}

function assertPackageArchiveOwner(scope) {
  if (path.dirname(scope.archiveRoot) !== scope.parentRoot
    || !path.basename(scope.archiveRoot).startsWith(PACKAGE_QUARANTINE_PREFIX)) {
    throw new Error(`Package archive escapes its owner: ${scope.archiveRoot}`);
  }
  assertDirectPackageDirectory(scope.parentRoot, scope.parentIdentity);
  assertDirectPackageDirectory(scope.archiveRoot, scope.archiveIdentity);
}

function packagePathKey(candidate) {
  const value = path.resolve(candidate);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function optionalPackageStat(candidate) {
  try { return fs.lstatSync(candidate, { bigint: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function packageDirectoryIdentity(stat) {
  const values = [stat.dev, stat.ino, stat.birthtimeNs];
  if (values.some(value => typeof value !== 'bigint')) throw new Error('Exact package file identity is unavailable.');
  return Object.freeze({ dev: stat.dev.toString(), ino: stat.ino.toString(), birthtimeNs: stat.birthtimeNs.toString() });
}

function assertDirectPackageDirectory(candidate, identity) {
  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(candidate) || candidate !== resolved) throw new Error(`Package directory must be absolute and resolved: ${candidate}`);
  let current = path.parse(resolved).root;
  let stat;
  for (const component of ['', ...resolved.slice(current.length).split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()
      || packagePathKey(fs.realpathSync.native(current)) !== packagePathKey(current)) {
      throw new Error(`Package directory contains a linked or invalid component: ${current}`);
    }
  }
  if (identity && JSON.stringify(packageDirectoryIdentity(stat)) !== JSON.stringify(identity)) {
    throw new Error(`Package directory identity changed: ${candidate}`);
  }
  return stat;
}

function ensureDirectPackageDirectory(candidate) {
  const resolved = path.resolve(candidate);
  let current = path.parse(resolved).root;
  assertDirectPackageDirectory(current);
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (!optionalPackageStat(current)) fs.mkdirSync(current);
    assertDirectPackageDirectory(current);
  }
}

function assertPackageDestinationAbsent(candidate) {
  assertDirectPackageDirectory(path.dirname(candidate));
  if (optionalPackageStat(candidate)) throw new Error(`Refusing to overwrite existing package output: ${candidate}`);
}

function assertPackageTreeDirect(root) {
  assertDirectPackageDirectory(root);
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    assertDirectPackageDirectory(directory);
    for (const name of fs.readdirSync(directory)) {
      const candidate = path.join(directory, name);
      const stat = fs.lstatSync(candidate, { bigint: true });
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())
        || packagePathKey(fs.realpathSync.native(candidate)) !== packagePathKey(candidate)) {
        throw new Error(`Package tree contains a linked or invalid entry: ${candidate}`);
      }
      if (stat.isDirectory()) pending.push(candidate);
    }
  }
}

function packageArchiveReceipt(scope, status, primaryError, secondaryErrors = [], hasPrimaryError = false) {
  const errorRecord = error => ({ name: error?.name || 'Error', message: error?.message || String(error) });
  return {
    kind: 'amazon-ai-ops-package-output-retention', schemaVersion: 1, status, recordedAt: new Date().toISOString(),
    archiveRoot: scope.archiveRoot, canonicalReleaseRoot: scope.releaseRoot,
    previousRelease: scope.previousRetained && !scope.previousRestored ? scope.previousPath : null,
    failedRelease: scope.failedRetained ? scope.failedPath : null, previousRestored: scope.previousRestored,
    previousIdentity: scope.previousIdentity, currentIdentity: scope.currentIdentity,
    primaryError: hasPrimaryError ? errorRecord(primaryError) : null, secondaryErrors: secondaryErrors.map(errorRecord),
    receiptPath: path.join(scope.archiveRoot, 'receipt.json'),
  };
}

function writePackageArchiveRecord(scope, name, record) {
  assertPackageArchiveOwner(scope);
  const destination = path.join(scope.archiveRoot, name);
  assertPackageDestinationAbsent(destination);
  fs.writeFileSync(destination, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}

function inspectFreshPackageOutputs(outputs) {
  const winUnpackedRoot = path.resolve(outputs.winUnpackedRoot);
  if (!fs.existsSync(winUnpackedRoot)) {
    throw new Error(`Fresh win-unpacked directory does not exist: ${winUnpackedRoot}`);
  }
  const unpackedStat = fs.lstatSync(winUnpackedRoot);
  if (unpackedStat.isSymbolicLink() || !unpackedStat.isDirectory()) {
    throw new Error(`Fresh win-unpacked directory is missing or invalid: ${winUnpackedRoot}`);
  }
  return Object.freeze({
    executable: artifactInfo(outputs.executablePath, 'fresh packaged executable'),
    installer: artifactInfo(outputs.installerPath, 'fresh NSIS installer'),
    portable: artifactInfo(outputs.portablePath, 'fresh portable executable'),
    folderZip: artifactInfo(outputs.folderZipPath, 'fresh extracted-folder ZIP'),
    blockmap: artifactInfo(outputs.blockmapPath, 'fresh NSIS blockmap'),
  });
}

function packageOutputEntries(outputs) {
  return Object.freeze([
    Object.freeze({
      name: 'win-unpacked',
      kind: 'directory',
      path: path.resolve(outputs.winUnpackedRoot),
    }),
    Object.freeze({
      name: 'installer',
      kind: 'file',
      path: path.resolve(outputs.installerPath),
    }),
    Object.freeze({
      name: 'portable',
      kind: 'file',
      path: path.resolve(outputs.portablePath),
    }),
    Object.freeze({
      name: 'folder-zip',
      kind: 'file',
      path: path.resolve(outputs.folderZipPath),
    }),
    Object.freeze({
      name: 'blockmap',
      kind: 'file',
      path: path.resolve(outputs.blockmapPath),
    }),
  ]);
}

function artifactInfo(filePath, label) {
  const resolved = regularFile(filePath, label);
  const stat = fs.statSync(resolved);
  return Object.freeze({
    path: resolved,
    sha256: sha256File(resolved),
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
  });
}

function resolveWindowsBuildSteps(builderEnvironment = {}) {
  const desktopRequire = createRequire(DESKTOP_PACKAGE_JSON);
  const vitePackageJson = desktopRequire.resolve('vite/package.json');
  const vitePackage = readJson(vitePackageJson);
  const viteBin = regularFile(
    path.resolve(path.dirname(vitePackageJson), vitePackage.bin?.vite || ''),
    'Vite CLI',
  );
  const electronBuilderCli = regularFile(
    desktopRequire.resolve('electron-builder/cli.js'),
    'electron-builder CLI',
  );
  const electronBuilderWrapper = regularFile(
    path.join(ROOT, 'scripts', 'run-electron-builder-windows.js'),
    'Electron builder Windows wrapper',
  );
  return Object.freeze([
    commandStep(
      'build-main',
      process.execPath,
      [path.join(DESKTOP_ROOT, 'scripts', 'build-main.js')],
    ),
    copyStep(
      'publish-main-entry',
      path.join(DESKTOP_ROOT, 'dist', 'main', 'index.cjs'),
      path.join(DESKTOP_ROOT, 'dist', 'main', 'index.js'),
    ),
    commandStep(
      'build-preload',
      process.execPath,
      [path.join(DESKTOP_ROOT, 'scripts', 'build-preload.js')],
    ),
    copyStep(
      'publish-preload-entry',
      path.join(DESKTOP_ROOT, 'dist', 'preload', 'index.cjs'),
      path.join(DESKTOP_ROOT, 'dist', 'preload', 'index.js'),
    ),
    commandStep('build-renderer', process.execPath, [viteBin, 'build']),
    commandStep(
      'stage-playwright-chromium',
      process.execPath,
      [path.join(DESKTOP_ROOT, 'scripts', 'stage-playwright-chromium.js')],
    ),
    commandStep(
      'electron-builder-windows',
      process.execPath,
      [electronBuilderWrapper, electronBuilderCli, '--win'],
      builderEnvironment,
    ),
  ]);
}

function executeWindowsBuildSteps(steps, builderEnvironment = {}) {
  const selectedSteps = steps || resolveWindowsBuildSteps(builderEnvironment);
  const results = [];
  for (const step of selectedSteps) {
    if (step.kind === 'copy') {
      regularFile(step.sourcePath, `${step.name} source`);
      fs.mkdirSync(path.dirname(step.targetPath), { recursive: true });
      fs.copyFileSync(step.sourcePath, step.targetPath);
      regularFile(step.targetPath, `${step.name} target`);
      results.push({
        name: step.name,
        kind: step.kind,
        targetPath: step.targetPath,
      });
      continue;
    }
    if (step.kind !== 'command') {
      throw new Error(`Unsupported Windows package build step: ${step.kind}`);
    }
    const result = spawnSync(step.executablePath, step.args, {
      cwd: step.cwd,
      env: step.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    });
    if (result.error) {
      throw new Error(`${step.name} failed to start: ${result.error.message}`);
    }
    if (result.status !== 0 || result.signal) {
      throw new Error(
        `${step.name} failed`
        + `${result.signal ? ` (${result.signal})` : ` (${result.status})`}.`,
      );
    }
    results.push({
      name: step.name,
      kind: step.kind,
      status: result.status,
    });
  }
  return Object.freeze(results);
}

function commandStep(name, executablePath, args, extraEnvironment = {}) {
  return Object.freeze({
    kind: 'command',
    name,
    executablePath: regularFile(executablePath, `${name} executable`),
    args: Object.freeze(args.map((value) => String(value))),
    cwd: DESKTOP_ROOT,
    env: Object.freeze({
      ...sanitizedNativeEnvironment(process.env),
      ...extraEnvironment,
      NO_UPDATE_NOTIFIER: '1',
    }),
  });
}

function copyStep(name, sourcePath, targetPath) {
  return Object.freeze({
    kind: 'copy',
    name,
    sourcePath: path.resolve(sourcePath),
    targetPath: path.resolve(targetPath),
  });
}

function regularFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`${label} does not exist: ${resolved}`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-link file: ${resolved}`);
  }
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  try {
    const result = buildWindowsPackage();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    process.exitCode = 1;
    try {
      process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'package.windows_build_blocked', { error })) + '\n');
    } catch (loggingError) {
      throw new AggregateError([error, loggingError], 'Windows package failure logging also failed.');
    }
  }
}

module.exports = {
  BUILD_SCHEMA_VERSION,
  DEFAULT_PACKAGE_EXE,
  buildWindowsPackage,
  executeWindowsBuildSteps,
  inspectFreshPackageOutputs,
  resolveExpectedPackageOutputs,
  resolveWindowsBuildSteps,
  withFreshPackageOutputs,
};

if (require.main === module) main();
