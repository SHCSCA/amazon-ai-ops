// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_TABLES, ROOT, fail } = require('./stage8-operator-contracts.js');

function migrationContract(migrationsRoot = path.join(ROOT, 'packages', 'local-db', 'src', 'sqlite', 'migrations')) {
    const rows = [];
    for (const fileName of fs.readdirSync(migrationsRoot)
        .filter((name) => /^000\d-.*\.ts$/.test(name) && !name.endsWith('.test.ts'))
        .sort()) {
        const source = require('./production-authority-selection-migrations').readMigrationMetadataSource(path.join(migrationsRoot, fileName));
        const versionMatch = source.match(/export const [A-Z0-9_]+_MIGRATION_VERSION = (\d+);/);
        const nameMatch = source.match(/export const [A-Z0-9_]+_MIGRATION_NAME = '([^']+)';/);
        const checksumMatches = [...source.matchAll(/export const (?!LEGACY_)[A-Z0-9_]+_MIGRATION_CHECKSUM = '([^']+)';/g)];
        if (!versionMatch || !nameMatch || checksumMatches.length !== 1) {
            fail(`Could not read the current migration contract from ${fileName}.`);
        }
        rows.push({
            checksum: checksumMatches[0][1],
            name: nameMatch[1],
            version: Number(versionMatch[1]),
        });
    }
    rows.sort((left, right) => left.version - right.version);
    if (rows.length === 0 || rows.some((row, index) => row.version !== index + 1)) {
        fail('The current migration source contract is not contiguous.');
    }
    return rows;
}

function tableSet(database) {
    return new Set(database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => String(row.name)));
}

function inspectSchema(database, contract = migrationContract()) {
    database.pragma('query_only = ON');
    const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1;
    const integrityCheck = database.pragma('integrity_check')
        .map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
    const foreignKeyCheck = database.pragma('foreign_key_check');
    const tables = tableSet(database);
    const applied = tables.has('schema_migrations')
        ? database.prepare(`
      SELECT version, name, checksum, status
      FROM schema_migrations
      ORDER BY version
    `).all()
        : [];
    const appliedByVersion = new Map(applied.map((row) => [Number(row.version), row]));
    const migrations = contract.map((expected) => {
        const actual = appliedByVersion.get(expected.version);
        let status = 'MISSING';
        if (actual) {
            status = actual.status === 'applied'
                && actual.name === expected.name
                && actual.checksum === expected.checksum
                ? 'APPLIED'
                : 'MISMATCH';
        }
        return {
            status,
            version: expected.version,
        };
    });
    const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
    const ready = queryOnly
        && integrityCheck.length === 1
        && integrityCheck[0] === 'ok'
        && foreignKeyCheck.length === 0
        && migrations.every((row) => row.status === 'APPLIED')
        && missingTables.length === 0;
    return {
        foreignKeyViolationCount: foreignKeyCheck.length,
        integrity: integrityCheck.length === 1 && integrityCheck[0] === 'ok'
            ? 'ok'
            : 'failed',
        latestExpectedVersion: contract.at(-1)?.version ?? null,
        migrations,
        missingTables,
        openedReadOnly: true,
        queryOnly,
        status: ready ? 'READY' : 'MIGRATION_REQUIRED',
    };
}

module.exports = { migrationContract, tableSet, inspectSchema };
