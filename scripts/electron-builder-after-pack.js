const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MARKER_NAME = '.amazon-ai-ops-native-runtime.json';
const REQUIRED_ENV_KEYS = Object.freeze([
  'AAO_STAGED_SQLITE_BINDING',
  'AAO_STAGED_SQLITE_SHA256',
  'AAO_SOURCE_DUCKDB_SHA256',
  'AAO_ELECTRON_VERSION',
  'AAO_ELECTRON_MODULES_ABI',
]);

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    throw new Error(`Unsupported package platform for native injection: ${context.electronPlatformName}`);
  }
  const settings = {};
  for (const key of REQUIRED_ENV_KEYS) {
    const value = String(process.env[key] || '').trim();
    if (!value) throw new Error(`Missing isolated native package input: ${key}`);
    settings[key] = value;
  }
  if (settings.AAO_ELECTRON_MODULES_ABI !== '119') {
    throw new Error(
      `Isolated native package ABI must be 119, received ${settings.AAO_ELECTRON_MODULES_ABI}.`,
    );
  }
  const stagedBindingPath = regularFile(
    settings.AAO_STAGED_SQLITE_BINDING,
    'isolated Electron better-sqlite3 binding',
  );
  const stagedSha256 = sha256File(stagedBindingPath);
  if (stagedSha256 !== normalizeSha256(settings.AAO_STAGED_SQLITE_SHA256)) {
    throw new Error('Isolated Electron better-sqlite3 binding hash does not match the build contract.');
  }

  const appRoot = path.join(path.resolve(context.appOutDir), 'resources', 'app');
  const targetBindingPath = path.join(
    appRoot,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  );
  const duckdbBindingPath = path.join(
    appRoot,
    'node_modules',
    'duckdb',
    'lib',
    'binding',
    'duckdb.node',
  );
  const existingTarget = regularFile(
    targetBindingPath,
    'builder-copied better-sqlite3 binding',
  );
  regularFile(duckdbBindingPath, 'builder-copied DuckDB binding');
  const sourceDuckdbSha256 = normalizeSha256(settings.AAO_SOURCE_DUCKDB_SHA256);
  if (sha256File(duckdbBindingPath) !== sourceDuckdbSha256) {
    throw new Error('Packaged DuckDB binding differs from the read-only source baseline.');
  }

  const targetDirectory = path.dirname(existingTarget);
  const stagedTargetPath = path.join(
    targetDirectory,
    `.better_sqlite3.node.inject-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  );
  fs.copyFileSync(stagedBindingPath, stagedTargetPath, fs.constants.COPYFILE_EXCL);
  try {
    if (sha256File(stagedTargetPath) !== stagedSha256) {
      throw new Error('Staged packaged better-sqlite3 copy failed its hash check.');
    }
    fs.unlinkSync(existingTarget);
    fs.renameSync(stagedTargetPath, existingTarget);
  } finally {
    if (fs.existsSync(stagedTargetPath)) fs.unlinkSync(stagedTargetPath);
  }
  if (sha256File(existingTarget) !== stagedSha256) {
    throw new Error('Packaged better-sqlite3 injection failed its final hash check.');
  }

  const markerPath = path.join(appRoot, MARKER_NAME);
  if (fs.existsSync(markerPath)) {
    throw new Error(`Native package marker unexpectedly already exists: ${markerPath}`);
  }
  fs.writeFileSync(markerPath, `${JSON.stringify({
    kind: 'amazon-ai-ops-isolated-native-package',
    schemaVersion: 1,
    electronVersion: settings.AAO_ELECTRON_VERSION,
    modulesAbi: settings.AAO_ELECTRON_MODULES_ABI,
    betterSqlite3Sha256: stagedSha256.toUpperCase(),
    duckDbSha256: sourceDuckdbSha256.toUpperCase(),
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function normalizeSha256(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid SHA-256 value: ${value}`);
  }
  return normalized;
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

module.exports = afterPack;
module.exports.MARKER_NAME = MARKER_NAME;
module.exports.normalizeSha256 = normalizeSha256;
