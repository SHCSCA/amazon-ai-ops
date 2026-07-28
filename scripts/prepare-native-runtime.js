const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP_ROOT = path.join(ROOT, 'apps', 'desktop');
const NATIVE_STATE_ROOT = path.join(ROOT, 'output', 'native-runtime-state');
const SCHEMA_VERSION = 'amazon-ai-ops-native-runtime/v2';
const PROBE_MARKER = 'AAO_NATIVE_PROBE=';
const LOCK_BASENAME = 'amazon-ai-ops-native-runtime.lock';
const STAGING_PREFIX = 'isolated-electron-';
const PROBE_TIMEOUT_MS = 2 * 60 * 1000;
const EXPECTED_ELECTRON_MODULES_ABI = '119';

function parseNativeRuntimeArgs(argv) {
  const args = { mode: '', packageExe: '' };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--mode') args.mode = argv[++index] || '';
    else if (token.startsWith('--mode=')) args.mode = token.slice('--mode='.length);
    else if (token === '--package-exe') args.packageExe = argv[++index] || '';
    else if (token.startsWith('--package-exe=')) {
      args.packageExe = token.slice('--package-exe='.length);
    } else {
      throw new Error(`Unexpected argument: ${token}`);
    }
  }
  if (!['node', 'package'].includes(args.mode)) {
    throw new Error('--mode must be one of: node, package.');
  }
  if (args.packageExe && !path.isAbsolute(args.packageExe)) {
    throw new Error('--package-exe must be an absolute path.');
  }
  if (args.mode !== 'package' && args.packageExe) {
    throw new Error('--package-exe is only valid with --mode=package.');
  }
  return args;
}

function prepareNativeRuntime(args, injected = {}) {
  const electronMetadata = injected.electronMetadata
    || resolveInstalledElectronMetadata();
  const runtimePaths = args.mode === 'package'
    ? (injected.packagePaths
      || resolvePackageNativePaths(args.packageExe, electronMetadata.version))
    : (injected.sourcePaths || resolveSourceNativePaths(electronMetadata));
  const probe = injected.runProbe || runNativeProbe;
  const lock = injected.withLock || withNativeRuntimeLock;

  return lock(() => {
    const sqliteBeforeSha256 = sha256File(runtimePaths.sqliteBindingPath);
    const duckdbBeforeSha256 = sha256File(runtimePaths.duckdbBindingPath);
    let observed;
    try {
      observed = probe(args.mode === 'package'
        ? {
          executablePath: runtimePaths.executablePath,
          betterSqliteRoot: runtimePaths.betterSqliteRoot,
          duckdbRoot: runtimePaths.duckdbRoot,
          electronAsNode: true,
          expectedElectronVersion: electronMetadata.version,
          expectedModulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
        }
        : probeInputForMode('node', runtimePaths));
    } catch (error) {
      if (args.mode === 'node') {
        throw new Error(
          'Shared source native bindings are not valid for the current Node runtime. '
          + 'Production verification refuses to rebuild or rewrite pnpm-backed source bindings; '
          + `repair the dependency installation explicitly. Cause: ${error.message}`,
        );
      }
      throw error;
    }
    const sqliteAfterSha256 = sha256File(runtimePaths.sqliteBindingPath);
    const duckdbAfterSha256 = sha256File(runtimePaths.duckdbBindingPath);
    if (sqliteAfterSha256 !== sqliteBeforeSha256
      || duckdbAfterSha256 !== duckdbBeforeSha256) {
      throw new Error(`${args.mode} native-runtime verification changed a read-only binding.`);
    }
    return nativeRuntimeResult({
      mode: args.mode,
      action: 'verified-only',
      paths: runtimePaths,
      observed,
      sqliteSha256: sqliteAfterSha256,
      duckdbSha256: duckdbAfterSha256,
    });
  });
}

function withPreparedIsolatedElectronRuntime(
  sourcePaths,
  electronMetadata,
  callback,
  injected = {},
) {
  const execute = injected.executeCommand || executeNativeCommand;
  const probe = injected.runProbe || runNativeProbe;
  const lock = injected.withLock || withNativeRuntimeLock;
  return lock(() => {
    const sourceBefore = bindingHashes(sourcePaths);
    const staging = createIsolatedElectronStaging(sourcePaths);
    let result;
    let primaryError;
    let cleanupError;
    try {
      execute(buildElectronPrebuildCommand(staging.paths));
      const observed = probe(probeInputForMode('electron', staging.paths));
      const sourceAfterPreparation = bindingHashes(sourcePaths);
      assertBindingHashesEqual(
        sourceBefore,
        sourceAfterPreparation,
        'Isolated Electron preparation changed shared source bindings.',
      );
      const preparation = nativeRuntimeResult({
        mode: 'isolated-electron',
        action: 'staged-and-verified',
        paths: staging.paths,
        observed,
        sqliteSha256: sha256File(staging.paths.sqliteBindingPath),
        duckdbSha256: sourceBefore.duckdbSha256,
      });
      result = callback(preparation);
    } catch (error) {
      primaryError = error;
    }
    try {
      const sourceAfter = bindingHashes(sourcePaths);
      assertBindingHashesEqual(
        sourceBefore,
        sourceAfter,
        'Isolated Electron build changed shared source bindings.',
      );
      removeIsolatedElectronStaging(staging);
    } catch (error) {
      cleanupError = error;
    }
    if (primaryError && cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `Isolated Electron work and cleanup both failed: ${primaryError.message}`
        + ` | ${cleanupError.message} | inspect ${staging.path}`,
      );
    }
    if (primaryError) throw primaryError;
    if (cleanupError) throw cleanupError;
    return result;
  });
}

function resolveInstalledElectronMetadata() {
  const electronPackageJson = realFile(
    path.join(DESKTOP_ROOT, 'node_modules', 'electron', 'package.json'),
    'Electron package.json',
  );
  const version = readJson(electronPackageJson).version;
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    throw new Error(`Installed Electron has an invalid exact version: ${version}`);
  }
  return Object.freeze({
    packageJsonPath: electronPackageJson,
    root: path.dirname(electronPackageJson),
    version,
  });
}

function resolveSourceNativePaths(
  electronMetadata = resolveInstalledElectronMetadata(),
) {
  const betterSqlitePackageJson = realFile(
    path.join(DESKTOP_ROOT, 'node_modules', 'better-sqlite3', 'package.json'),
    'better-sqlite3 package.json',
  );
  const duckdbPackageJson = realFile(
    path.join(DESKTOP_ROOT, 'node_modules', 'duckdb', 'package.json'),
    'DuckDB package.json',
  );
  const betterSqliteRoot = path.dirname(betterSqlitePackageJson);
  const duckdbRoot = path.dirname(duckdbPackageJson);
  const electronExecutable = require(electronMetadata.root);
  assertRegularFile(electronExecutable, 'Electron executable');
  const prebuildInstallPath = createRequire(betterSqlitePackageJson)
    .resolve('prebuild-install/bin.js');
  assertRegularFile(prebuildInstallPath, 'better-sqlite3 prebuild-install entrypoint');
  const runtimeDependencyRoots = resolveBetterSqliteRuntimeDependencyRoots(
    betterSqlitePackageJson,
  );
  const sqliteBindingPath = privateCanonicalBinding(
    betterSqliteRoot,
    path.join(betterSqliteRoot, 'build', 'Release', 'better_sqlite3.node'),
    'better-sqlite3 binding',
  );
  const duckdbBindingPath = privateCanonicalBinding(
    duckdbRoot,
    path.join(duckdbRoot, 'lib', 'binding', 'duckdb.node'),
    'DuckDB binding',
  );
  return Object.freeze({
    kind: 'source-native-runtime',
    desktopRoot: DESKTOP_ROOT,
    electronVersion: electronMetadata.version,
    executablePath: path.resolve(electronExecutable),
    betterSqliteRoot,
    betterSqlitePackageJson,
    sqliteBindingPath,
    prebuildInstallPath,
    runtimeDependencyRoots,
    duckdbRoot,
    duckdbPackageJson,
    duckdbBindingPath,
  });
}

function resolvePackageNativePaths(packageExe, expectedElectronVersion) {
  const executablePath = path.resolve(
    packageExe || path.join(
      DESKTOP_ROOT,
      'release',
      'win-unpacked',
      'AmazonAIOpsAgent.exe',
    ),
  );
  assertRegularFile(executablePath, 'Packaged Electron executable');
  const appRoot = path.join(path.dirname(executablePath), 'resources', 'app');
  const betterSqliteRoot = path.join(appRoot, 'node_modules', 'better-sqlite3');
  const duckdbRoot = path.join(appRoot, 'node_modules', 'duckdb');
  const paths = {
    kind: 'packaged-native-runtime',
    desktopRoot: DESKTOP_ROOT,
    electronVersion: expectedElectronVersion,
    executablePath,
    appRoot,
    betterSqliteRoot,
    sqliteBindingPath: path.join(
      betterSqliteRoot,
      'build',
      'Release',
      'better_sqlite3.node',
    ),
    duckdbRoot,
    duckdbBindingPath: path.join(duckdbRoot, 'lib', 'binding', 'duckdb.node'),
  };
  assertRegularFile(paths.sqliteBindingPath, 'packaged better-sqlite3 binding');
  assertRegularFile(paths.duckdbBindingPath, 'packaged DuckDB binding');
  return Object.freeze(paths);
}

function createIsolatedElectronStaging(sourcePaths) {
  const stateRoot = ensureNativeStateRoot();
  const created = fs.mkdtempSync(path.join(stateRoot, STAGING_PREFIX));
  const stagingPath = path.resolve(created);
  const stagingStat = fs.lstatSync(stagingPath);
  const betterSqliteRoot = path.join(stagingPath, 'better-sqlite3');
  try {
    fs.cpSync(sourcePaths.betterSqliteRoot, betterSqliteRoot, {
      recursive: true,
      force: false,
      dereference: true,
      errorOnExist: true,
    });
    const stagedNodeModulesRoot = path.join(stagingPath, 'node_modules');
    fs.mkdirSync(stagedNodeModulesRoot, { recursive: true });
    for (const dependency of sourcePaths.runtimeDependencyRoots || []) {
      fs.cpSync(
        dependency.root,
        path.join(stagedNodeModulesRoot, dependency.name),
        {
          recursive: true,
          force: false,
          dereference: true,
          errorOnExist: true,
        },
      );
    }
    const paths = Object.freeze({
      ...sourcePaths,
      kind: 'isolated-electron-native-runtime',
      betterSqliteRoot,
      betterSqlitePackageJson: path.join(betterSqliteRoot, 'package.json'),
      sqliteBindingPath: path.join(
        betterSqliteRoot,
        'build',
        'Release',
        'better_sqlite3.node',
      ),
    });
    assertRegularFile(paths.betterSqlitePackageJson, 'staged better-sqlite3 package.json');
    assertRegularFile(paths.sqliteBindingPath, 'staged better-sqlite3 binding');
    return Object.freeze({
      path: stagingPath,
      realPath: fs.realpathSync(stagingPath),
      stateRoot,
      device: stagingStat.dev,
      inode: stagingStat.ino,
      birthtimeMs: stagingStat.birthtimeMs,
      paths,
    });
  } catch (error) {
    fs.rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

function resolveBetterSqliteRuntimeDependencyRoots(betterSqlitePackageJson) {
  const packageRequire = createRequire(betterSqlitePackageJson);
  return Object.freeze(['bindings', 'file-uri-to-path'].map((name) => {
    const packageJsonPath = realFile(
      packageRequire.resolve(`${name}/package.json`),
      `${name} package.json`,
    );
    return Object.freeze({
      name,
      root: path.dirname(packageJsonPath),
    });
  }));
}

function removeIsolatedElectronStaging(staging) {
  const resolved = path.resolve(staging.path);
  const stat = fs.lstatSync(resolved);
  if (path.dirname(resolved) !== staging.stateRoot
    || !path.basename(resolved).startsWith(STAGING_PREFIX)
    || stat.isSymbolicLink()
    || !stat.isDirectory()
    || fs.realpathSync(resolved) !== staging.realPath
    || stat.dev !== staging.device
    || stat.ino !== staging.inode
    || stat.birthtimeMs !== staging.birthtimeMs) {
    throw new Error(`Refusing to remove a replaced isolated Electron staging path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: false });
}

function buildElectronPrebuildCommand(paths) {
  return Object.freeze({
    executablePath: process.execPath,
    args: Object.freeze([
      paths.prebuildInstallPath,
      '--runtime=electron',
      `--target=${paths.electronVersion}`,
      '--arch=x64',
      '--platform=win32',
    ]),
    cwd: paths.betterSqliteRoot,
    env: sanitizedNativeEnvironment(process.env),
    description: 'isolated better-sqlite3 Electron prebuild install',
  });
}

function executeNativeCommand(command) {
  const result = spawnSync(command.executablePath, command.args, {
    cwd: command.cwd,
    env: command.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`${command.description} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 || result.signal) {
    throw new Error(
      `${command.description} failed`
      + `${result.signal ? ` (${result.signal})` : ` (${result.status})`}: `
      + boundedProcessOutput(result),
    );
  }
  return Object.freeze({
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  });
}

function runNativeProbe({
  executablePath,
  betterSqliteRoot,
  duckdbRoot,
  electronAsNode,
  expectedElectronVersion,
  expectedModulesAbi,
}) {
  assertRegularFile(executablePath, 'native-runtime probe executable');
  const script = nativeProbeScript(betterSqliteRoot, duckdbRoot);
  const env = sanitizedNativeEnvironment(process.env);
  if (electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(executablePath, ['-e', script], {
    cwd: DESKTOP_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Native-runtime probe failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 || result.signal) {
    throw new Error(
      `Native-runtime probe failed`
      + `${result.signal ? ` (${result.signal})` : ` (${result.status})`}: `
      + boundedProcessOutput(result),
    );
  }
  const markerLine = String(result.stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith(PROBE_MARKER));
  if (!markerLine) {
    throw new Error('Native-runtime probe did not return its structured result.');
  }
  let observed;
  try {
    observed = JSON.parse(markerLine.slice(PROBE_MARKER.length));
  } catch {
    throw new Error('Native-runtime probe returned malformed JSON.');
  }
  return validateNativeProbeObserved(observed, {
    expectedElectronVersion,
    expectedModulesAbi,
  });
}

function validateNativeProbeObserved(
  observed,
  { expectedElectronVersion, expectedModulesAbi } = {},
) {
  if (!observed || observed.sqliteValue !== 1 || observed.duckdbValue !== 1) {
    throw new Error('Native-runtime probe did not execute both SQLite and DuckDB queries.');
  }
  if (expectedElectronVersion
    && observed.electronVersion !== expectedElectronVersion) {
    throw new Error(
      `Electron version mismatch: expected=${expectedElectronVersion}, `
      + `observed=${observed.electronVersion}`,
    );
  }
  if (expectedModulesAbi
    && observed.modulesAbi !== String(expectedModulesAbi)) {
    throw new Error(
      `Native modules ABI mismatch: expected=${expectedModulesAbi}, `
      + `observed=${observed.modulesAbi}`,
    );
  }
  return Object.freeze(observed);
}

function nativeProbeScript(betterSqliteRoot, duckdbRoot) {
  const duckdbBindingPath = path.join(duckdbRoot, 'lib', 'binding', 'duckdb.node');
  return `
    const Database = require(${JSON.stringify(betterSqliteRoot)});
    const sqlite = new Database(':memory:');
    const sqliteValue = Number(sqlite.prepare('SELECT 1 AS value').get().value);
    sqlite.close();
    const duckdb = require(${JSON.stringify(duckdbBindingPath)});
    const analytical = new duckdb.Database(':memory:', (openError) => {
      if (openError) {
        process.stderr.write(String(openError && openError.stack || openError));
        process.exitCode = 1;
        return;
      }
      const connection = new duckdb.Connection(analytical);
      connection.exec('SELECT 1 AS value', (error) => {
        if (error) {
          process.stderr.write(String(error && error.stack || error));
          process.exitCode = 1;
          return;
        }
        connection.close((connectionCloseError) => {
          if (connectionCloseError) {
            process.stderr.write(String(connectionCloseError && connectionCloseError.stack || connectionCloseError));
            process.exitCode = 1;
            return;
          }
          analytical.close_internal((closeError) => {
            if (closeError) {
              process.stderr.write(String(closeError && closeError.stack || closeError));
              process.exitCode = 1;
              return;
            }
            const payload = {
              nodeVersion: process.versions.node,
              electronVersion: process.versions.electron || null,
              modulesAbi: String(process.versions.modules || ''),
              platform: process.platform,
              arch: process.arch,
              sqliteValue,
              duckdbValue: 1,
            };
            process.stdout.write(${JSON.stringify(PROBE_MARKER)} + JSON.stringify(payload) + '\\n');
          });
        });
      });
    });
  `;
}

function probeInputForMode(mode, paths) {
  if (mode === 'electron') {
    return {
      executablePath: paths.executablePath,
      betterSqliteRoot: paths.betterSqliteRoot,
      duckdbRoot: paths.duckdbRoot,
      electronAsNode: true,
      expectedElectronVersion: paths.electronVersion,
      expectedModulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
    };
  }
  if (mode !== 'node') throw new Error(`Unsupported source probe mode: ${mode}`);
  return {
    executablePath: process.execPath,
    betterSqliteRoot: paths.betterSqliteRoot,
    duckdbRoot: paths.duckdbRoot,
    electronAsNode: false,
    expectedElectronVersion: undefined,
    expectedModulesAbi: process.versions.modules,
  };
}

function withNativeRuntimeLock(callback, options = {}) {
  const owner = acquireNativeRuntimeLock(options);
  let result;
  let primaryError;
  let releaseError;
  try {
    result = callback(owner);
  } catch (error) {
    primaryError = error;
  }
  try {
    releaseNativeRuntimeLock(owner);
  } catch (error) {
    releaseError = error;
  }
  if (primaryError && releaseError) {
    throw new AggregateError(
      [primaryError, releaseError],
      `Native-runtime work and lock release both failed: ${primaryError.message}`
      + ` | ${releaseError.message}`,
    );
  }
  if (primaryError) throw primaryError;
  if (releaseError) throw releaseError;
  return result;
}

function acquireNativeRuntimeLock(options = {}) {
  const lockRoot = options.tempRoot
    ? ensureRealDirectory(options.tempRoot, 'injected native-runtime lock root')
    : ensureNativeStateRoot();
  const lockPath = path.join(lockRoot, LOCK_BASENAME);
  const owner = {
    pid: options.pid || process.pid,
    token: options.token || crypto.randomBytes(16).toString('hex'),
    createdAt: options.createdAt || new Date().toISOString(),
  };
  let handle;
  try {
    handle = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(lockPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Native-runtime lock is not a regular file: ${lockPath}`);
    }
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      throw new Error(
        `Native-runtime lock is malformed and was left untouched: ${lockPath}. `
        + 'Verify no build/pretest process is active, then remove this exact file manually.',
      );
    }
    if (!Number.isSafeInteger(Number(existing.pid))
      || Number(existing.pid) <= 0
      || typeof existing.token !== 'string'
      || existing.token.length < 16) {
      throw new Error(
        `Native-runtime lock has invalid owner metadata and was left untouched: ${lockPath}. `
        + 'Verify no build/pretest process is active, then remove this exact file manually.',
      );
    }
    const processAlive = options.isProcessAliveFn || isProcessAlive;
    if (processAlive(Number(existing.pid))) {
      throw new Error(`Native-runtime work is already active in process ${existing.pid}.`);
    }
    throw new Error(
      `Stale native-runtime lock for process ${existing.pid} was left untouched: ${lockPath}. `
      + 'The source bindings were never rewritten; verify that process is gone, '
      + 'then remove this exact lock file manually.',
    );
  }
  try {
    fs.writeFileSync(handle, `${JSON.stringify(owner)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } catch (error) {
    try {
      fs.closeSync(handle);
      handle = undefined;
      fs.unlinkSync(lockPath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Native-runtime lock initialization and cleanup both failed: ${error.message}`
        + ` | ${cleanupError.message} | inspect ${lockPath}`,
      );
    }
    throw error;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  const stat = fs.lstatSync(lockPath);
  return Object.freeze({
    ...owner,
    lockPath,
    lockRoot,
    device: stat.dev,
    inode: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  });
}

function releaseNativeRuntimeLock(owner) {
  if (!owner || path.basename(owner.lockPath) !== LOCK_BASENAME) {
    throw new Error('Native-runtime lock release requires its exact owner identity.');
  }
  const stat = fs.lstatSync(owner.lockPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Native-runtime lock was replaced before release.');
  }
  let current;
  try {
    current = JSON.parse(fs.readFileSync(owner.lockPath, 'utf8'));
  } catch {
    throw new Error('Native-runtime lock became malformed before release.');
  }
  if (current.pid !== owner.pid
    || current.token !== owner.token
    || stat.dev !== owner.device
    || stat.ino !== owner.inode
    || stat.birthtimeMs !== owner.birthtimeMs) {
    throw new Error('Native-runtime lock ownership changed before release.');
  }
  fs.unlinkSync(owner.lockPath);
}

function ensureNativeStateRoot() {
  fs.mkdirSync(NATIVE_STATE_ROOT, { recursive: true });
  return ensureRealDirectory(NATIVE_STATE_ROOT, 'native-runtime state root');
}

function ensureRealDirectory(directoryPath, label) {
  const resolved = path.resolve(directoryPath);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()
    || !stat.isDirectory()
    || fs.realpathSync(resolved) !== resolved) {
    throw new Error(`${label} must be a real non-link directory: ${resolved}`);
  }
  return resolved;
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function sanitizedNativeEnvironment(input) {
  const blocked = new Set([
    'npm_config_runtime',
    'npm_config_target',
    'npm_config_arch',
    'npm_config_platform',
    'npm_config_build_from_source',
    'npm_config_disturl',
    'npm_config_target_arch',
    'npm_config_target_platform',
    'npm_execpath',
    'npm_node_execpath',
    'npm_cli_js',
  ]);
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined || blocked.has(key.toLowerCase())) continue;
    output[key] = String(value);
  }
  return output;
}

function privateCanonicalBinding(rootPath, bindingPath, label) {
  const root = fs.realpathSync(rootPath);
  const binding = realFile(bindingPath, label);
  if (!isPathWithin(root, binding)) {
    throw new Error(`${label} escapes its canonical package root: ${binding}`);
  }
  const stat = fs.statSync(binding);
  if (stat.nlink !== 1) {
    throw new Error(
      `${label} must be a private single-link file before production use: `
      + `${binding} (nlink=${stat.nlink})`,
    );
  }
  return binding;
}

function bindingHashes(paths) {
  return Object.freeze({
    sqliteSha256: sha256File(paths.sqliteBindingPath),
    duckdbSha256: sha256File(paths.duckdbBindingPath),
  });
}

function assertBindingHashesEqual(expected, observed, message) {
  if (expected.sqliteSha256 !== observed.sqliteSha256
    || expected.duckdbSha256 !== observed.duckdbSha256) {
    throw new Error(
      `${message} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`,
    );
  }
}

function nativeRuntimeResult({
  mode,
  action,
  paths,
  observed,
  sqliteSha256,
  duckdbSha256,
}) {
  return {
    kind: 'amazon-ai-ops-native-runtime-preparation',
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    action,
    target: {
      electronVersion: paths.electronVersion || null,
      nodeVersion: observed.nodeVersion,
      modulesAbi: observed.modulesAbi,
      platform: observed.platform,
      arch: observed.arch,
    },
    probes: {
      sqliteValue: observed.sqliteValue,
      duckdbValue: observed.duckdbValue,
    },
    bindings: {
      sqlite: {
        path: paths.sqliteBindingPath,
        sha256: sqliteSha256,
      },
      duckdb: {
        path: paths.duckdbBindingPath,
        sha256: duckdbSha256,
        unchanged: true,
      },
    },
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function realFile(filePath, label) {
  assertRegularFile(filePath, label);
  return fs.realpathSync(filePath);
}

function assertRegularFile(filePath, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error(`${label} path is invalid.`);
  }
  if (!fs.existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-link file.`);
  }
}

function isPathWithin(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function boundedProcessOutput(result) {
  const output = [result.stderr, result.stdout]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' | ');
  return output.slice(0, 4000) || 'no process output';
}

function main() {
  try {
    const args = parseNativeRuntimeArgs(process.argv);
    const result = prepareNativeRuntime(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[NATIVE RUNTIME BLOCKED] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_ELECTRON_MODULES_ABI,
  LOCK_BASENAME,
  NATIVE_STATE_ROOT,
  PROBE_MARKER,
  acquireNativeRuntimeLock,
  buildElectronPrebuildCommand,
  executeNativeCommand,
  nativeProbeScript,
  parseNativeRuntimeArgs,
  prepareNativeRuntime,
  privateCanonicalBinding,
  probeInputForMode,
  releaseNativeRuntimeLock,
  resolveInstalledElectronMetadata,
  resolvePackageNativePaths,
  resolveSourceNativePaths,
  runNativeProbe,
  sanitizedNativeEnvironment,
  sha256File,
  validateNativeProbeObserved,
  withNativeRuntimeLock,
  withPreparedIsolatedElectronRuntime,
};

if (require.main === module) main();
