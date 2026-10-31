const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MIGRATIONS_ROOT = path.resolve(__dirname, '../packages/local-db/src/sqlite/migrations');

function readDirectMigrationSource(filePath) {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || fs.realpathSync.native(absolute).toLowerCase() !== absolute.toLowerCase()) {
    throw new Error('Migration metadata source is not a direct unique file: ' + absolute);
  }
  return fs.readFileSync(absolute, 'utf8');
}

function readMigrationMetadataSource(filePath, visited = new Set()) {
  const absolute = path.resolve(filePath);
  if (visited.has(absolute.toLowerCase())) throw new Error('Migration metadata re-export cycle: ' + absolute);
  const next = new Set([...visited, absolute.toLowerCase()]);
  const source = readDirectMigrationSource(absolute);
  const references = [...source.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)]
    .filter(match => /\b[A-Z0-9_]+_MIGRATION_(?:VERSION|NAME|CHECKSUM)\b/.test(match[1]));
  return [source, ...references.map(match => {
    if (!/^\.\/[a-zA-Z0-9_-]+$/.test(match[2])) {
      throw new Error('Migration metadata re-export must remain in its source directory.');
    }
    return readMigrationMetadataSource(path.join(path.dirname(absolute), match[2] + '.ts'), next);
  })].join('\n');
}

function getMigrationPlan({ migrationsRoot = DEFAULT_MIGRATIONS_ROOT, targetVersion } = {}) {
  // 目标版本来自运行时同一导出注册表，不执行迁移模块或加载原生数据库。
  const registry = readDirectMigrationSource(path.join(migrationsRoot, 'index.ts'));
  const registryEntries = [...registry.matchAll(/\bexport\s+(\*|\{[\s\S]*?\})\s+from\s*['"]\.\/(\d{4}-[a-zA-Z0-9_-]+)['"]/g)];
  const exports = registryEntries.map(match => match[2] + '.ts');
  const files = fs.readdirSync(migrationsRoot)
    .filter(name => /^\d{4}-.*\.ts$/.test(name) && !name.endsWith('.test.ts')).sort();
  if (!exports.length || new Set(exports).size !== exports.length
    || JSON.stringify([...exports].sort()) !== JSON.stringify(files)) {
    throw new Error('Production migration registry must bind every unique numbered migration source.');
  }
  const rows = files.map(fileName => {
    const source = readMigrationMetadataSource(path.join(migrationsRoot, fileName));
    const versions = [...source.matchAll(/export const ([A-Z0-9_]+)_MIGRATION_VERSION = (\d+);/g)];
    const prefix = versions[0]?.[1];
    const names = [...source.matchAll(new RegExp(`export const ${prefix}_MIGRATION_NAME\\s*=\\s*'([^']+)';`, 'g'))];
    const checksums = [...source.matchAll(new RegExp(`export const ${prefix}_MIGRATION_CHECKSUM\\s*=\\s*'([^']+)';`, 'g'))];
    if (versions.length !== 1 || names.length !== 1 || checksums.length !== 1) {
      throw new Error(`Could not read the production migration contract from ${fileName}.`);
    }
    const clause = registryEntries.find(match => match[2] + '.ts' === fileName)[1];
    const bindings = clause === '*' ? null : clause.slice(1, -1).split(',').map(name => name.trim());
    if (bindings && !['VERSION', 'NAME', 'CHECKSUM'].every(suffix => bindings.includes(`${prefix}_MIGRATION_${suffix}`))) {
      throw new Error(`Production migration registry must export complete metadata from ${fileName}.`);
    }
    return Object.freeze({ version: Number(versions[0][2]), name: names[0][1], checksum: checksums[0][1] });
  }).sort((left, right) => left.version - right.version);
  const target = targetVersion ?? rows.at(-1)?.version;
  if (!Number.isSafeInteger(target) || target < 1 || rows.length !== target
    || rows.some((row, index) => row.version !== index + 1)) {
    throw new Error(`Production migration contract must contain versions 1..${target}.`);
  }
  return Object.freeze({ targetVersion: target, migrations: Object.freeze(rows) });
}

module.exports = { DEFAULT_MIGRATIONS_ROOT, getMigrationPlan, readMigrationMetadataSource };

if (require.main === module) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--target-version') throw new Error('Unsupported migration metadata arguments.');
    process.stdout.write(String(getMigrationPlan().targetVersion) + '\n');
  } catch (error) {
    const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'migration.metadata_failed', { error })) + '\n');
    process.exitCode = 1;
  }
}
