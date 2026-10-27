// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as path from 'path';
import Database from 'better-sqlite3';
import { COLLECTION_RESUME_AUTHORITY_TABLES, LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM, verifyAiSpendSchema, verifyExecutionReconciliationSchema, verifyMissionWriteAuthoritySchema, verifyGrantSlotLedgerSchema, verifyLegacyCompatibilitySchema, verifyCollectionResumeAuthoritySchema, verifyStoreProviderIdentityAuthoritySchema, } from '@amazon-ai-ops/local-db/src/sqlite/migrations';
import { SQLITE_MIGRATION_CONTRACT, SQLITE_SCHEMA_VERSION } from '@amazon-ai-ops/local-db/src/sqlite/db';
import { type S7PostMigrationAuthorityState, POST_MIGRATION_TARGET_VERSION, POST_MIGRATION_CONTRACT, POST_MIGRATION_REQUIRED_TABLES, sha256, stableJson, fail } from './s7-startup-gate-contracts';

export function defaultReadAuthoritySchemaVersion(filePath: string): number {
    const database = new Database(path.resolve(filePath), {
        readonly: true,
        fileMustExist: true,
    });
    try {
        database.pragma('query_only = ON');
        const table = database.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get() as {
            count: number;
        };
        if (table.count === 0)
            return 0;
        const row = database.prepare(`
      SELECT COALESCE(MAX(version), 0) AS version
      FROM schema_migrations
      WHERE status = 'applied'
    `).get() as {
            version: number;
        };
        return Number(row.version);
    }
    finally {
        database.close();
    }
}

export function s7PostMigrationAuthorityContract(): S7PostMigrationAuthorityState {
    return {
        targetVersion: POST_MIGRATION_TARGET_VERSION,
        integrityCheck: 'ok',
        foreignKeyViolationCount: 0,
        migrationRows: POST_MIGRATION_CONTRACT.map((row) => ({ ...row, status: 'applied' })),
        requiredTables: [...POST_MIGRATION_REQUIRED_TABLES],
        contractSha256: postMigrationContractSha256(),
    };
}

export function postMigrationContractSha256(): string {
    return sha256(stableJson({
        targetVersion: POST_MIGRATION_TARGET_VERSION,
        migrationRows: POST_MIGRATION_CONTRACT,
        requiredTables: POST_MIGRATION_REQUIRED_TABLES,
    }));
}

export function defaultInspectPostMigrationAuthority(filePath: string): S7PostMigrationAuthorityState {
    const database = new Database(path.resolve(filePath), {
        readonly: true,
        fileMustExist: true,
    });
    try {
        database.pragma('query_only = ON');
        const integrity = database.pragma('integrity_check') as Array<Record<string, unknown>>;
        const integrityCheck = String(Object.values(integrity[0] || {})[0] || '').toLowerCase();
        if (integrity.length !== 1 || integrityCheck !== 'ok') {
            fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Authority integrity_check is not exactly ok.');
        }
        const foreignKeys = database.pragma('foreign_key_check') as Array<Record<string, unknown>>;
        if (foreignKeys.length !== 0) {
            fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Authority foreign-key invariants failed.');
        }
        const tables = new Set((database.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `).all() as Array<{
            name: string;
        }>).map((row) => String(row.name)));
        const missingTables = POST_MIGRATION_REQUIRED_TABLES.filter((name) => !tables.has(name));
        if (missingTables.length !== 0) {
            fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', `Authority required-table contract is incomplete (${missingTables.length} missing).`);
        }
        const rows = database.prepare(`
      SELECT version, name, checksum, status
      FROM schema_migrations
      ORDER BY version
    `).all() as Array<{
            version: number;
            name: string;
            checksum: string;
            status: string;
        }>;
        const normalizedRows = rows.map((row) => ({
            version: Number(row.version),
            name: String(row.name),
            checksum: String(row.checksum),
            status: String(row.status),
        }));
        const expectedRows = POST_MIGRATION_CONTRACT.map((row) => ({
            ...row,
            status: 'applied',
        }));
        if (stableJson(normalizedRows) !== stableJson(expectedRows)) {
            fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Authority migration ledger name/checksum/status contract drifted.');
        }
        try {
            verifyAiSpendSchema(database);
            verifyExecutionReconciliationSchema(database);
            verifyMissionWriteAuthoritySchema(database);
            verifyGrantSlotLedgerSchema(database);
            verifyLegacyCompatibilitySchema(database);
            verifyCollectionResumeAuthoritySchema(database);
            verifyStoreProviderIdentityAuthoritySchema(database);
        }
        catch {
            fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Authority exact schema contract drifted.');
        }
        return {
            targetVersion: POST_MIGRATION_TARGET_VERSION,
            integrityCheck: 'ok',
            foreignKeyViolationCount: 0,
            migrationRows: expectedRows as S7PostMigrationAuthorityState['migrationRows'],
            requiredTables: [...POST_MIGRATION_REQUIRED_TABLES],
            contractSha256: postMigrationContractSha256(),
        };
    }
    finally {
        database.close();
    }
}

export function schemaVersionOnConnection(database: Database.Database): number {
    const table = database.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).get() as {
        count: number;
    };
    if (table.count === 0)
        return 0;
    const rows = database.prepare(`
    SELECT version, name, checksum, status FROM schema_migrations ORDER BY version
  `).all() as Array<{
        version: number;
        name: string;
        checksum: string;
        status: string;
    }>;
    const expected = SQLITE_MIGRATION_CONTRACT.filter((row) => row.version <= 11);
    if (rows.length !== expected.length || rows.some((row, index) => (row.version !== expected[index].version || row.name !== expected[index].name
        || row.status !== 'applied'
        || (row.checksum !== expected[index].checksum
            && !(row.version === 1 && row.checksum === LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM))))) {
        fail('S7_STARTUP_GATE_SQLITE_TAKEOVER_UNTRUSTED', 'Migration source must contain the exact applied v1..v11 ledger prefix.');
    }
    return 11;
}
