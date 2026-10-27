const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parseMustRequirements } = require('../../../scripts/verify-v16-required-test-manifest');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SECURITY_SOURCES = Object.freeze({
  settingsRepository: 'packages/local-db/src/sqlite/repositories/settings-repo.ts',
  sqliteDatabase: 'packages/local-db/src/sqlite/db.ts',
});

function directFile(root, relative) {
  const absolute = path.resolve(root, relative), local = path.relative(root, absolute);
  if (path.isAbsolute(local) || local.startsWith('..') || relative.includes('\\')) throw new Error('FROZEN_SOURCE_OUTSIDE_ROOT:' + relative);
  const before = fs.lstatSync(absolute);
  if (!before.isFile() || before.isSymbolicLink() || fs.realpathSync.native(absolute).toLowerCase() !== absolute.toLowerCase()) throw new Error('FROZEN_SOURCE_NOT_DIRECT:' + relative);
  const bytes = fs.readFileSync(absolute), after = fs.lstatSync(absolute);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('FROZEN_SOURCE_CHANGED:' + relative);
  return { path: relative, sha256: digest(bytes), sizeBytes: bytes.length, bytes };
}

function listFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).split('\0').filter(Boolean);
}

function sourceMember(file) {
  return /^(apps|packages|scripts)\//.test(file)
    || /^(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|vitest.config.ts|tsconfig[^/]*|docs\/amazon_ai_ops_agent_prd_v1_6_0.md|docs\/v16_[^/]+)$/.test(file);
}

function securitySourceFiles(root, role, file) {
  const pending = [file], found = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (found.has(current)) continue;
    found.add(current);
    if (role !== 'sqliteDatabase') continue;
    const source = directFile(root, current).bytes.toString('utf8');
    for (const match of source.matchAll(/\bfrom\s*['"]\.\/(db-[A-Za-z0-9-]+)(?:\.ts)?['"]/g)) {
      pending.push(path.posix.join(path.posix.dirname(current), match[1] + '.ts'));
    }
  }
  return [...found].sort();
}

function collectFrozenBuild(root, ports = {}) {
  root = path.resolve(root);
  const files = [...new Set((ports.listFiles ?? listFiles)(root))].sort();
  const sourceHash = createHash('sha256');
  const records = new Map(), sourceFiles = [];
  for (const file of files.filter(sourceMember)) {
    sourceHash.update(file + '\0');
    if (fs.existsSync(path.join(root, file))) {
      const record = directFile(root, file);
      records.set(file, record);
      sourceFiles.push({ path: file, sha256: record.sha256, sizeBytes: record.sizeBytes });
      sourceHash.update(record.bytes);
    } else sourceHash.update('[DELETED]');
    sourceHash.update('\0');
  }
  const read = file => (records.get(file) ?? directFile(root, file)).bytes;
  const definition = JSON.parse(read('docs/v16_required_test_manifest.json'));
  const requirementsIndex = JSON.parse(read('docs/v16_requirements_index.json'));
  const testInventory = files.filter(file => /^(apps|packages|scripts)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && fs.existsSync(path.join(root, file)));
  const all = definition.requiredTests.find(test => test.testId === 'V16-T-L1-ALL');
  if (!all || JSON.stringify([...all.testFiles].sort()) !== JSON.stringify(testInventory)) throw new Error('FROZEN_TEST_INVENTORY_INCOMPLETE');
  const implementationPaths = new Set(files.filter(file => /^(apps|packages|scripts|docs)\//.test(file) && fs.existsSync(path.join(root, file))));
  for (const requirement of requirementsIndex.requirements ?? []) for (const file of requirement.implementation ?? []) implementationPaths.add(file);
  const implementationInventory = [...implementationPaths].sort().map(file => {
    const record = records.get(file) ?? directFile(root, file);
    return { path: file, sha256: record.sha256, sizeBytes: record.sizeBytes };
  });
  const securitySources = Object.fromEntries(Object.entries(SECURITY_SOURCES).map(([name, entry]) => [name, {
    files: securitySourceFiles(root, name, entry).map(file => {
      const record = records.get(file) ?? directFile(root, file);
      return { path: file, sha256: record.sha256, sizeBytes: record.sizeBytes, contentsBase64: record.bytes.toString('base64') };
    }),
  }]));
  const identity = {
    sourceRevision: (ports.sourceRevision ?? (directory => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim()))(root),
    sourceSha256: sourceHash.digest('hex'),
    packageVersion: JSON.parse(read('apps/desktop/package.json')).version,
  };
  const governance = directFile(root, 'docs/v16_companion_verification_traceability.md');
  const migrationsRoot = path.join(root, 'packages/local-db/src/sqlite/migrations');
  const migrationVerifier = require('../../../scripts/verify-production-authority-selection');
  const migrations = (ports.migrationContract ?? migrationVerifier.migrationContract)(migrationsRoot);
  const legacyChecksum = (ports.legacyV1Checksum ?? migrationVerifier.legacyV1Checksum)(migrationsRoot);
  return {
    schemaVersion: 'v16.frozen-build/1', sourceRoot: root, identity,
    prdMust: parseMustRequirements(read('docs/amazon_ai_ops_agent_prd_v1_6_0.md').toString('utf8')),
    requirementsIndex, requiredManifestDefinition: definition, testInventory,
    sourceFiles, implementationInventory, securitySources,
    uiGovernanceSource: { path: governance.path, sha256: governance.sha256, sizeBytes: governance.sizeBytes, contentsBase64: governance.bytes.toString('base64') },
    desktopPackage: JSON.parse(read('apps/desktop/package.json')),
    packageUiRunnerContract: (ports.runnerContract ?? (() => require('../../../scripts/package-ui-evidence').buildPackageUiRunnerContract()))(),
    migrationContract: migrations,
    allowedV1Checksums: [...new Set([migrations[0].checksum, legacyChecksum])],
  };
}

module.exports = { collectFrozenBuild, sourceMember, SECURITY_SOURCES };
