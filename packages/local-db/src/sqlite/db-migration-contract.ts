// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as sqliteMigrations from './migrations';

export const SQLITE_MIGRATION_CONTRACT = Object.freeze(Object.entries(sqliteMigrations)
    .filter(([key]) => key.endsWith('_MIGRATION_VERSION'))
    .map(([key, version]) => {
    const prefix = key.slice(0, -'_VERSION'.length);
    const metadata = sqliteMigrations as Record<string, unknown>;
    return Object.freeze({ version: Number(version), name: String(metadata[prefix + '_NAME']), checksum: String(metadata[prefix + '_CHECKSUM']) });
}).sort((left, right) => left.version - right.version));

export const SQLITE_SCHEMA_VERSION = SQLITE_MIGRATION_CONTRACT.at(-1)!.version;
