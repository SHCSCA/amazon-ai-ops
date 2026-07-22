import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from '../db';
import {
  REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM,
  REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION,
  REPORT_IMPORT_AUTHORITY_TABLES,
  REPORT_IMPORT_PROGRESS_TABLES,
} from './0002-report-import-authority';

const directories: string[] = [];

afterEach(() => {
  while (directories.length) {
    const directory = directories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('report import authority migration v2', () => {
  it('binds a versioned backup, applies the schema transactionally, and reopens idempotently', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-import-migration-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'app.db');
    const database = initSqlite(databasePath);
    const first = database.prepare(`
      SELECT checksum, status, started_at AS startedAt,
             applied_at AS appliedAt, manifest_json AS manifestJson,
             result_json AS resultJson
      FROM schema_migrations WHERE version = ?
    `).get(REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION) as {
      checksum: string;
      status: string;
      startedAt: string;
      appliedAt: string;
      manifestJson: string;
      resultJson: string;
    };
    const manifest = JSON.parse(first.manifestJson) as {
      targetTables: string[];
      backup: { backupPath: string; sha256: string; integrityCheck: string };
    };

    expect(first).toEqual(expect.objectContaining({
      checksum: REPORT_IMPORT_AUTHORITY_MIGRATION_CHECKSUM,
      status: 'applied',
    }));
    expect(manifest.targetTables).toEqual([
      ...REPORT_IMPORT_PROGRESS_TABLES,
      ...REPORT_IMPORT_AUTHORITY_TABLES,
    ]);
    expect(manifest.backup.integrityCheck).toBe('ok');
    expect(fs.existsSync(manifest.backup.backupPath)).toBe(true);
    expect(createHash('sha256').update(fs.readFileSync(manifest.backup.backupPath)).digest('hex'))
      .toBe(manifest.backup.sha256);
    for (const table of [...REPORT_IMPORT_PROGRESS_TABLES, ...REPORT_IMPORT_AUTHORITY_TABLES]) {
      expect(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
      `).get(table)).toEqual({ name: table });
    }
    database.close();

    const reopened = initSqlite(databasePath);
    try {
      const second = reopened.prepare(`
        SELECT checksum, status, started_at AS startedAt,
               applied_at AS appliedAt, manifest_json AS manifestJson,
               result_json AS resultJson
        FROM schema_migrations WHERE version = ?
      `).get(REPORT_IMPORT_AUTHORITY_MIGRATION_VERSION);
      expect(second).toEqual(first);
      expect(reopened.prepare(`SELECT COUNT(*) AS count FROM schema_migrations`).get())
        .toEqual({ count: 8 });
    } finally {
      reopened.close();
    }
  });
});
