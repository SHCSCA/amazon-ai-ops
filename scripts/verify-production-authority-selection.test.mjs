import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const verifier = require('./verify-production-authority-selection.js');
const requireFromLocalDb = createRequire(
  path.resolve('packages/local-db/package.json'),
);
const Database = requireFromLocalDb('better-sqlite3');
const roots = [];

function tempRoot(prefix = 'production-authority-selection-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function sha256(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toUpperCase();
}

function writeDatabase(filePath, migration = 'current') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new Database(filePath);
  try {
    database.exec('CREATE TABLE payload (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    database.prepare('INSERT INTO payload (value) VALUES (?)').run('candidate');
    if (migration === 'current') {
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL,
          result_json TEXT,
          manifest_json TEXT
        )
      `);
      const insert = database.prepare(`
        INSERT INTO schema_migrations (
          version, name, checksum, status, result_json, manifest_json
        ) VALUES (?, ?, ?, 'applied', '{}', '{}')
      `);
      for (const row of verifier.migrationContract()) {
        insert.run(row.version, row.name, row.checksum);
      }
      database.exec(`
        CREATE TABLE stores (
          store_id TEXT PRIMARY KEY,
          browser_profile_id TEXT NOT NULL,
          marketplace TEXT NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,
          business_timezone TEXT NOT NULL
        )
      `);
      for (const table of verifier.REQUIRED_TABLES) {
        if (table === 'schema_migrations' || table === 'stores') continue;
        database.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY)`);
      }
    } else if (migration === 'legacy') {
      database.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)');
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(3);
    }
  } finally {
    database.close();
  }
}

function fixture({ secondCandidate = false, migration = 'current' } = {}) {
  const root = tempRoot();
  const appData = path.join(root, 'AppData', 'Roaming');
  const userData = path.join(appData, '@amazon-ai-ops', 'desktop');
  const dbPath = path.join(userData, 'amazon-ai-ops.db');
  const temp = path.join(root, 'temp');
  const output = path.join(root, 'output');
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  writeDatabase(dbPath, migration);
  let secondDbPath = null;
  if (secondCandidate) {
    secondDbPath = path.join(appData, 'Amazon AI Ops Agent', 'amazon-ai-ops.db');
    writeDatabase(secondDbPath, 'current');
  }
  return {
    appData,
    dbPath,
    env: {
      APPDATA: appData,
      USERPROFILE: path.join(root, 'Users', 'operator'),
    },
    expectedSha256: sha256(dbPath),
    output,
    root,
    secondDbPath,
    temp,
    userData,
  };
}

function args(fixtureValue, extra = []) {
  return [
    '--db', fixtureValue.dbPath,
    '--expected-user-data-dir', fixtureValue.userData,
    '--expected-main-sha256', fixtureValue.expectedSha256,
    ...extra,
  ];
}

function context(fixtureValue, overrides = {}) {
  return {
    Database,
    env: fixtureValue.env,
    tempRoot: fixtureValue.temp,
    now: () => new Date('2026-07-29T08:00:00.000Z'),
    randomUUID: (() => {
      let index = 0;
      return () => `00000000-0000-4000-8000-${String(index += 1).padStart(12, '0')}`;
    })(),
    writeStdout() {},
    ...overrides,
  };
}

describe('production authority selection preflight', () => {
  it('selects one explicit authority while inventorying a second default candidate as non-authority', async () => {
    const value = fixture({ secondCandidate: true });
    const result = await verifier.run(args(value), context(value));

    expect(result).toMatchObject({
      exitCode: 0,
      outputPath: null,
      evidence: {
        status: 'SELECTED_SCHEMA_READY',
        formalEvidence: false,
        authorityDatabaseMutated: false,
        adsExecutionInvoked: false,
        selection: {
          expectedUserDataDir: value.userData,
          expectedDatabasePath: value.dbPath,
          storesRoot: path.join(value.userData, 'stores'),
          existingCandidateCount: 2,
          selected: {
            role: 'selected',
            realPath: value.dbPath,
            sqlite: {
              openedReadOnly: true,
              queryOnly: true,
              integrity: 'ok',
              migration: {
                family: 'S7_SCHEMA_MIGRATIONS',
                highestAppliedVersion: 9,
                targetReady: true,
              },
            },
            logicalCapture: {
              method: 'readonly-sqlite-online-backup',
              remainingPages: 0,
            },
          },
          nonAuthority: [{
            role: 'non-authority',
            realPath: value.secondDbPath,
          }],
        },
      },
    });
    expect(result.evidence.selection.selected.logicalCapture.totalPages).toBeGreaterThan(0);
    expect(result.evidence.selection.selected.logicalCapture.logicalBackupSha256)
      .toMatch(/^[A-F0-9]{64}$/);
    expect(result.evidence.selection.selected.mainFileSha256).toBe(value.expectedSha256);
    expect(result.evidence.selection.selected.logicalBackupSha256)
      .toBe(result.evidence.selection.selected.logicalCapture.logicalBackupSha256);
    expect(fs.readdirSync(value.temp)).toEqual([]);
  });

  it('requires every authority selector and rejects relative paths', async () => {
    const value = fixture();
    expect(() => verifier.parseArgs([])).toThrow(/--db is required/i);
    expect(() => verifier.parseArgs([
      '--db', value.dbPath,
      '--expected-user-data-dir', value.userData,
    ])).toThrow(/expected-main-sha256 is required/i);
    await expect(verifier.run([
      '--db', 'amazon-ai-ops.db',
      '--expected-user-data-dir', value.userData,
      '--expected-main-sha256', value.expectedSha256,
    ], context(value))).rejects.toThrow(/--db must be a clean absolute path/i);
  });

  it('rejects a wrong main-file SHA-256', async () => {
    const value = fixture();
    await expect(verifier.run([
      '--db', value.dbPath,
      '--expected-user-data-dir', value.userData,
      '--expected-main-sha256', 'A'.repeat(64),
    ], context(value))).rejects.toThrow(/SHA-256 mismatch/i);
    expect(fs.readdirSync(value.temp)).toEqual([]);
  });

  it('rejects an expected userData directory that does not own the selected database', async () => {
    const value = fixture();
    const wrongUserData = path.join(value.appData, 'Amazon AI Ops Agent');
    fs.mkdirSync(wrongUserData, { recursive: true });
    await expect(verifier.run([
      '--db', value.dbPath,
      '--expected-user-data-dir', wrongUserData,
      '--expected-main-sha256', value.expectedSha256,
    ], context(value))).rejects.toThrow(/resolve exactly/i);
  });

  it('rejects a historical default candidate even when its own directory is supplied as userData', async () => {
    const value = fixture({ secondCandidate: true });
    const historicalUserData = path.dirname(value.secondDbPath);
    await expect(verifier.run([
      '--db', value.secondDbPath,
      '--expected-user-data-dir', historicalUserData,
      '--expected-main-sha256', sha256(value.secondDbPath),
    ], context(value))).rejects.toThrow(/packaged @amazon-ai-ops\/desktop path/i);
  });

  it('rejects a symlinked or junction-backed expected userData when the platform permits it', async () => {
    const value = fixture();
    const linked = path.join(value.root, 'linked-user-data');
    try {
      fs.symlinkSync(
        value.userData,
        linked,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) return;
      throw error;
    }
    await expect(verifier.run([
      '--db', value.dbPath,
      '--expected-user-data-dir', linked,
      '--expected-main-sha256', value.expectedSha256,
    ], context(value))).rejects.toThrow(/symbolic link|junction|reparse point/i);
  });

  it('rejects a selected authority database with a second hard link', async () => {
    const value = fixture();
    fs.linkSync(value.dbPath, path.join(value.userData, 'duplicate-hardlink.db'));
    await expect(verifier.run(args(value), context(value)))
      .rejects.toThrow(/exactly one hard link/i);
  });

  it('identifies an old migration ledger without querying missing columns or crashing', async () => {
    const value = fixture({ migration: 'legacy' });
    const result = await verifier.run(args(value), context(value));

    expect(result.evidence).toMatchObject({
      status: 'SELECTED_RECOVERY_REQUIRED',
      selection: {
        selected: {
          sqlite: {
            migration: {
              family: 'LEGACY_SCHEMA_MIGRATIONS',
              state: 'RECOVERY_REQUIRED',
              columns: ['version'],
              recordedVersions: [3],
              appliedVersions: [],
              highestVersion: 3,
              highestAppliedVersion: 0,
              targetReady: false,
            },
          },
        },
      },
    });
  });

  it('records a dated text-version legacy ledger as recovery-required without blocking selection', async () => {
    const value = fixture({ secondCandidate: true, migration: 'none' });
    const historical = new Database(value.secondDbPath);
    try {
      historical.exec(`
        DROP TABLE schema_migrations;
        CREATE TABLE schema_migrations (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      historical.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run('20260525_001', 'base_v1_2_schema', '2026-05-27 00:56:19');
    } finally {
      historical.close();
    }

    const result = await verifier.run(args(value), context(value));

    expect(result.evidence).toMatchObject({
      status: 'SELECTED_MIGRATION_REQUIRED',
      selection: {
        selected: {
          sqlite: {
            state: 'MIGRATION_REQUIRED',
          },
        },
        nonAuthority: [{
          role: 'non-authority',
          sqlite: {
            state: 'RECOVERY_REQUIRED',
            migration: {
              family: 'UNRECOGNIZED_SCHEMA_MIGRATIONS',
              state: 'RECOVERY_REQUIRED',
              invalidVersionCount: 1,
              recordedVersions: [],
              targetReady: false,
            },
          },
        }],
      },
    });
  });

  it('classifies a clean v0 database as migration-required rather than recovery-required', async () => {
    const value = fixture({ migration: 'none' });
    const result = await verifier.run(args(value), context(value));

    expect(result.evidence).toMatchObject({
      status: 'SELECTED_MIGRATION_REQUIRED',
      selection: {
        selected: {
          offlineMigrationEligible: true,
          sqlite: {
            integrity: 'ok',
            foreignKeyViolationCount: 0,
            state: 'MIGRATION_REQUIRED',
            migration: {
              family: 'PRE_SCHEMA_MIGRATIONS',
              state: 'MIGRATION_REQUIRED',
              cleanV0: true,
              presentTargetTables: [],
              highestVersion: 0,
            },
          },
        },
      },
    });
  });

  it('requires recovery for a partial S7 schema without the migration ledger', async () => {
    const value = fixture({ migration: 'none' });
    const database = new Database(value.dbPath);
    try {
      database.exec('CREATE TABLE missions (id TEXT PRIMARY KEY)');
    } finally {
      database.close();
    }
    value.expectedSha256 = sha256(value.dbPath);

    const result = await verifier.run(args(value), context(value));

    expect(result.evidence).toMatchObject({
      status: 'SELECTED_RECOVERY_REQUIRED',
      selection: {
        selected: {
          offlineMigrationEligible: false,
          sqlite: {
            integrity: 'ok',
            foreignKeyViolationCount: 0,
            state: 'RECOVERY_REQUIRED',
            migration: {
              family: 'PARTIAL_SCHEMA_WITHOUT_MIGRATION_LEDGER',
              state: 'RECOVERY_REQUIRED',
              tablePresent: false,
              cleanV0: false,
              presentTargetTables: ['missions'],
              highestVersion: 0,
              targetReady: false,
            },
          },
        },
      },
    });
  });

  it('classifies a checksum mismatch as recovery-required', async () => {
    const value = fixture();
    const database = new Database(value.dbPath);
    database.prepare(`
      UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 9
    `).run();
    database.close();
    value.expectedSha256 = sha256(value.dbPath);

    const result = await verifier.run(args(value), context(value));
    expect(result.evidence).toMatchObject({
      status: 'SELECTED_RECOVERY_REQUIRED',
      selection: {
        selected: {
          sqlite: {
            state: 'RECOVERY_REQUIRED',
            migration: {
              state: 'RECOVERY_REQUIRED',
              targetReady: false,
            },
          },
        },
      },
    });
  });

  it('reads WAL-only committed rows from the same logical backup without treating the main SHA as currentness', async () => {
    const value = fixture();
    const writer = new Database(value.dbPath);
    try {
      writer.pragma('journal_mode = WAL');
      writer.pragma('wal_autocheckpoint = 0');
      value.expectedSha256 = sha256(value.dbPath);
      writer.prepare(`
        INSERT INTO stores (
          store_id, browser_profile_id, marketplace, currency, status, business_timezone
        ) VALUES (?, ?, 'US', 'USD', 'active', 'America/Los_Angeles')
      `).run('wal-store', 'wal-profile');

      expect(sha256(value.dbPath)).toBe(value.expectedSha256);
      const result = await verifier.run(args(value), context(value));

      expect(result.evidence.selection.selected).toMatchObject({
        mainFileSha256: value.expectedSha256,
        offlineMigrationEligible: false,
        sqlite: {
          stores: {
            activeUsUsdCount: 1,
            distinctBrowserProfileCount: 1,
          },
        },
      });
      expect(result.evidence.selection.selected.logicalBackupSha256)
        .not.toBe(result.evidence.selection.selected.mainFileSha256);
    } finally {
      writer.close();
    }
  });

  it('keeps default diagnosis artifact-free after its temporary online capture is cleaned', async () => {
    const value = fixture();
    const before = fs.readdirSync(value.output);
    const result = await verifier.run(args(value), context(value));

    expect(result.outputPath).toBeNull();
    expect(fs.readdirSync(value.output)).toEqual(before);
    expect(fs.readdirSync(value.temp)).toEqual([]);
  });

  it('exports once with exclusive atomic creation and rejects an output collision', async () => {
    const value = fixture();
    const outputPath = path.join(value.output, 'authority-selection.json');
    const result = await verifier.run(
      args(value, ['--export', '--out', outputPath]),
      context(value),
    );
    const exported = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

    expect(result.outputPath).toBe(outputPath);
    expect(exported).toMatchObject({
      kind: 'production-authority-selection-preflight',
      formalEvidence: false,
      authorityDatabaseMutated: false,
      adsExecutionInvoked: false,
    });
    await expect(verifier.run(
      args(value, ['--export', '--out', outputPath]),
      context(value),
    )).rejects.toThrow(/already exists/i);
    expect(fs.readdirSync(value.output)).toEqual(['authority-selection.json']);
  });

  it('fails closed when the selected main-file artifact drifts during preflight', async () => {
    const value = fixture();
    let selectedReads = 0;
    const realArtifact = (filePath) => {
      const stat = fs.statSync(filePath);
      const isSelected = path.resolve(filePath) === path.resolve(value.dbPath);
      selectedReads += isSelected ? 1 : 0;
      return {
        realPath: fs.realpathSync.native(filePath),
        sha256: isSelected && selectedReads >= 4
          ? 'B'.repeat(64)
          : sha256(filePath),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    };

    await expect(verifier.run(
      args(value),
      context(value, { fileArtifact: realArtifact }),
    )).rejects.toThrow(/changed during WAL-aware|drifted/i);
    expect(fs.readdirSync(value.temp)).toEqual([]);
  });

  it('fails closed and cleans temporary state when currentness capture fails', async () => {
    const value = fixture();
    await expect(verifier.run(args(value), context(value, {
      runReadonlyBackup() {
        throw new Error('injected currentness failure');
      },
    }))).rejects.toThrow(/injected currentness failure/i);
    expect(fs.readdirSync(value.temp)).toEqual([]);
  });

  it('prints help without requiring authority paths or writing files', async () => {
    const value = fixture();
    let stdout = '';
    const result = await verifier.run(['--help'], context(value, {
      Database: null,
      migrationContract: null,
      writeStdout(chunk) {
        stdout += chunk;
      },
    }));
    expect(result).toEqual({ exitCode: 0, evidence: null, outputPath: null });
    expect(stdout).toMatch(/strictly read-only/i);
    expect(fs.readdirSync(value.temp)).toEqual([]);
    expect(fs.readdirSync(value.output)).toEqual([]);
  });
});
