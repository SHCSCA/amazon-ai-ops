const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

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
    const buildResult = prepareElectron(
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

      return requireFreshOutputs(packageOutputs, () => {
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
      });
      },
      { withLock: direct },
    );

    const sourceAfter = {
      sqliteSha256: hashFile(sourcePaths.sqliteBindingPath),
      duckdbSha256: hashFile(sourcePaths.duckdbBindingPath),
    };
    if (sourceAfter.sqliteSha256 !== sourceBefore.sqliteSha256
      || sourceAfter.duckdbSha256 !== sourceBefore.duckdbSha256) {
      throw new Error('Windows package build changed read-only source native bindings.');
    }

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
        blockmapPath: buildResult.freshOutputs.blockmap.path,
        blockmapSha256: buildResult.freshOutputs.blockmap.sha256,
        sqliteSha256: buildResult.packagePreparation.bindings.sqlite.sha256,
        duckdbSha256: buildResult.packagePreparation.bindings.duckdb.sha256,
        freshCurrentRun: true,
      },
      steps: buildResult.stepResults,
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
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
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
    blockmapPath: path.join(releaseRoot, `${artifactBase}.exe.blockmap`),
  });
}

function withFreshPackageOutputs(outputs, callback) {
  const quarantine = quarantineExistingPackageOutputs(outputs);
  let result;
  let primaryError;
  let rollbackError;
  let cleanupError;
  try {
    result = callback();
  } catch (error) {
    primaryError = error;
  }

  if (primaryError) {
    try {
      restoreQuarantinedPackageOutputs(outputs, quarantine);
    } catch (errorDuringRollback) {
      rollbackError = errorDuringRollback;
    }
  } else {
    try {
      removePackageQuarantine(quarantine);
    } catch (errorDuringCleanup) {
      cleanupError = errorDuringCleanup;
    }
  }

  if (primaryError && rollbackError) {
    throw new AggregateError(
      [primaryError, rollbackError],
      `Windows package build and release-output rollback both failed: ${primaryError.message}`
      + ` | ${rollbackError.message} | previous outputs preserved at ${quarantine.path}`,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) {
    throw new Error(
      `Fresh Windows package passed, but prior-output cleanup failed: ${cleanupError.message}`
      + ` | inspect ${quarantine.path}`,
    );
  }
  return result;
}

function quarantineExistingPackageOutputs(outputs) {
  const releaseRoot = path.resolve(outputs.releaseRoot);
  fs.mkdirSync(releaseRoot, { recursive: true });
  const releaseRealPath = fs.realpathSync(releaseRoot);
  if (releaseRealPath !== releaseRoot) {
    throw new Error(`Package release root must be a real non-link path: ${releaseRoot}`);
  }
  const pathEntries = packageOutputEntries(outputs);
  for (const entry of pathEntries) {
    if (path.dirname(entry.path) !== releaseRoot && entry.path !== outputs.winUnpackedRoot) {
      throw new Error(`Package output escapes the canonical release root: ${entry.path}`);
    }
  }
  const quarantineParent = fs.realpathSync(path.dirname(releaseRoot));
  const quarantinePath = fs.mkdtempSync(
    path.join(quarantineParent, PACKAGE_QUARANTINE_PREFIX),
  );
  const stat = fs.lstatSync(quarantinePath);
  const quarantine = {
    path: quarantinePath,
    realPath: fs.realpathSync(quarantinePath),
    parentRoot: quarantineParent,
    device: stat.dev,
    inode: stat.ino,
    birthtimeMs: stat.birthtimeMs,
    moved: [],
  };
  try {
    for (const [index, entry] of pathEntries.entries()) {
      if (!fs.existsSync(entry.path)) continue;
      const targetStat = fs.lstatSync(entry.path);
      if (targetStat.isSymbolicLink()
        || (entry.kind === 'directory' && !targetStat.isDirectory())
        || (entry.kind === 'file' && !targetStat.isFile())) {
        throw new Error(`Unexpected package output type before quarantine: ${entry.path}`);
      }
      const backupPath = path.join(
        quarantinePath,
        `${String(index).padStart(2, '0')}-${path.basename(entry.path)}`,
      );
      fs.renameSync(entry.path, backupPath);
      quarantine.moved.push({ ...entry, backupPath });
    }
    return Object.freeze({
      ...quarantine,
      moved: Object.freeze(quarantine.moved.map((entry) => Object.freeze(entry))),
    });
  } catch (error) {
    let rollbackError;
    try {
      for (const entry of [...quarantine.moved].reverse()) {
        if (fs.existsSync(entry.path)) {
          throw new Error(`Cannot restore quarantined output over an existing path: ${entry.path}`);
        }
        fs.renameSync(entry.backupPath, entry.path);
      }
      removePackageQuarantine(quarantine);
    } catch (errorDuringRollback) {
      rollbackError = errorDuringRollback;
    }
    if (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Package output quarantine and rollback both failed: ${error.message}`
        + ` | ${rollbackError.message} | inspect ${quarantinePath}`,
      );
    }
    throw error;
  }
}

function restoreQuarantinedPackageOutputs(outputs, quarantine) {
  const errors = [];
  for (const entry of [...packageOutputEntries(outputs)].reverse()) {
    try {
      removeKnownPackageOutput(entry);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const entry of quarantine.moved) {
    try {
      if (fs.existsSync(entry.path)) {
        throw new Error(`Partial package output still exists during rollback: ${entry.path}`);
      }
      fs.renameSync(entry.backupPath, entry.path);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 0) {
    try {
      removePackageQuarantine(quarantine);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple package outputs failed rollback.');
  }
}

function removeKnownPackageOutput(entry) {
  if (!fs.existsSync(entry.path)) return;
  const stat = fs.lstatSync(entry.path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove a linked package output: ${entry.path}`);
  }
  if (entry.kind === 'directory') {
    if (!stat.isDirectory()) {
      throw new Error(`Expected package output directory during rollback: ${entry.path}`);
    }
    fs.rmSync(entry.path, { recursive: true, force: false });
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`Expected package output file during rollback: ${entry.path}`);
  }
  fs.unlinkSync(entry.path);
}

function removePackageQuarantine(quarantine) {
  const resolved = path.resolve(quarantine.path);
  const stat = fs.lstatSync(resolved);
  if (path.dirname(resolved) !== quarantine.parentRoot
    || !path.basename(resolved).startsWith(PACKAGE_QUARANTINE_PREFIX)
    || stat.isSymbolicLink()
    || !stat.isDirectory()
    || fs.realpathSync(resolved) !== quarantine.realPath
    || stat.dev !== quarantine.device
    || stat.ino !== quarantine.inode
    || stat.birthtimeMs !== quarantine.birthtimeMs) {
    throw new Error(`Refusing to remove a replaced package quarantine: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: false });
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
      [electronBuilderCli, '--win'],
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
    console.error(`[WINDOWS PACKAGE BLOCKED] ${error.message}`);
    if (error instanceof AggregateError) {
      for (const nested of error.errors) {
        console.error(`- ${nested.message}`);
      }
    }
    process.exitCode = 1;
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
