// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export function isSqliteConstraintError(error: unknown): boolean {
    if (!error || typeof error !== 'object')
        return false;
    const code = String((error as {
        code?: unknown;
    }).code ?? '');
    return code === 'SQLITE_CONSTRAINT' || code.startsWith('SQLITE_CONSTRAINT_');
}

export function hashFile(filePath: string): string {
    const hash = createHash('sha256');
    const handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0)
                hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
    }
    finally {
        fs.closeSync(handle);
    }
    return hash.digest('hex');
}

export function identityKey(normalizedStoreName: string, marketplaceCode: string): string {
    return `${marketplaceCode}\u0000${normalizedStoreName}`;
}

export function normalizeStoreName(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') : '';
}

export function normalizeMarketplaceCode(value: unknown): string {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function nonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.trim();
    return normalized || undefined;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value)
        return fallback;
    try {
        return JSON.parse(value) as T;
    }
    catch {
        return fallback;
    }
}

export function quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

export function sqlStringLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

export function sameResolvedPath(left: string | undefined, right: string): boolean {
    if (!left)
        return false;
    const resolvedLeft = path.resolve(left);
    const resolvedRight = path.resolve(right);
    return process.platform === 'win32'
        ? resolvedLeft.toLocaleLowerCase('en-US') === resolvedRight.toLocaleLowerCase('en-US')
        : resolvedLeft === resolvedRight;
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
