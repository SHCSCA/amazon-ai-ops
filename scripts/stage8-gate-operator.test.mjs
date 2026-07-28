import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import operatorModule from './stage8-gate-operator.js';
import readinessModule from './verify-mission-control-production-readiness.js';

const requireFromLocalDb = createRequire(
  path.join(process.cwd(), 'packages', 'local-db', 'package.json'),
);
const Database = requireFromLocalDb('better-sqlite3');
const {
  EXPORT_SEQUENCE,
  inspectOpenedDatabase,
  inspectSchema,
  migrationContract,
  parseArgs,
  rawCanaryCandidates,
  run,
  stableRef,
  validateExecuteInputs,
  writeAtomicLedger,
} = operatorModule;
const { deterministicExecutionArtifactPath } = readinessModule;

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function createOperationalReadSchema(database) {
  database.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      currency TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      business_timezone TEXT NOT NULL
    );
    CREATE TABLE store_connections (
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      last_verified_at TEXT,
      last_failure_code TEXT
    );
    CREATE TABLE store_session_metadata (
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      verified_at TEXT,
      expires_at TEXT,
      failure_code TEXT
    );
    CREATE TABLE lingxing_collection_jobs (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      currency TEXT NOT NULL,
      business_timezone TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      report_types_json TEXT NOT NULL,
      state TEXT NOT NULL,
      blocker_code TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE lingxing_collection_report_checkpoints (
      store_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      state TEXT NOT NULL,
      file_size_bytes INTEGER,
      error_code TEXT,
      detail TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE lingxing_report_batches (
      store_id TEXT NOT NULL,
      id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE report_import_runs (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source_file_count INTEGER NOT NULL,
      metric_row_count INTEGER NOT NULL,
      reconciliation_count INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE report_import_file_snapshots (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE report_import_reconciliations (
      store_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      status TEXT NOT NULL,
      within_tolerance INTEGER NOT NULL,
      reconciled_at TEXT NOT NULL
    );
  `);
}

function seedTwoStores(database) {
  const insertStore = database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency,
      display_name, status, business_timezone
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles')
  `);
  insertStore.run('secret-store-alpha', 'secret-profile-alpha', 'Alpha');
  insertStore.run('secret-store-beta', 'secret-profile-beta', 'Beta');
  const insertConnection = database.prepare(`
    INSERT INTO store_connections (
      store_id, provider, status, last_verified_at
    ) VALUES (?, ?, 'ready', '2026-07-28T00:00:00.000Z')
  `);
  const insertSession = database.prepare(`
    INSERT INTO store_session_metadata (
      store_id, provider, browser_profile_id, status, session_generation,
      observed_at, verified_at
    ) VALUES (?, ?, ?, 'ready', 3, '2026-07-28T00:00:00.000Z',
              '2026-07-28T00:00:00.000Z')
  `);
  for (const [storeId, profileId] of [
    ['secret-store-alpha', 'secret-profile-alpha'],
    ['secret-store-beta', 'secret-profile-beta'],
  ]) {
    for (const provider of ['lingxing', 'amazon_ads']) {
      insertConnection.run(storeId, provider);
      insertSession.run(storeId, provider, profileId);
    }
  }
}

describe('Stage 8 Gate Operator', () => {
  it('reads the current contiguous migration contract from source', () => {
    const contract = migrationContract();
    expect(contract.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(contract.at(-1)).toMatchObject({
      name: 'store-authority-quarantine-repair-v9',
      version: 9,
    });
  });

  it('keeps diagnose read-only and requires explicit output for export modes', () => {
    expect(parseArgs([])).toMatchObject({
      errors: [],
      executeExports: false,
      exportRequested: false,
    });
    expect(parseArgs(['--export']).errors).toContain(
      '--export and --execute-exports require an explicit --out path.',
    );
    const parsed = parseArgs([
      '--execute-exports',
      '--out', 'ledger.json',
      '--export-root', 'output/codex-evidence',
    ]);
    expect(parsed.errors).toEqual(expect.arrayContaining([
      '--execute-exports requires --v15-final-readiness.',
      '--execute-exports requires --package-ui-manifest.',
    ]));
  });

  it('reports a legacy database as migration-required without writing it', () => {
    const database = new Database(':memory:');
    database.exec('CREATE TABLE legacy_payload (id INTEGER PRIMARY KEY, value TEXT)');
    const schema = inspectSchema(database, migrationContract());
    expect(schema).toMatchObject({
      integrity: 'ok',
      openedReadOnly: true,
      queryOnly: true,
      status: 'MIGRATION_REQUIRED',
    });
    expect(schema.missingTables).toContain('stores');
    expect(database.prepare('SELECT COUNT(*) AS count FROM legacy_payload').get().count).toBe(0);
    database.close();
  });

  it('projects two redacted stores and a 14 store-day by 8-report matrix', () => {
    const database = new Database(':memory:');
    createOperationalReadSchema(database);
    seedTwoStores(database);
    const ledger = inspectOpenedDatabase(database, {
      dbPath: 'C:\\private\\amazon-ai-ops.db',
      stores: [],
      storesRoot: 'C:\\private\\stores',
    }, {
      migrationContract: migrationContract(),
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    expect(ledger.stores).toMatchObject({
      activeUsUsdCount: 2,
      selectedCount: 2,
      status: 'READY',
    });
    expect(ledger.stores.items.map((item) => item.alias)).toEqual(['store-1', 'store-2']);
    expect(ledger.continuous.matrix).toHaveLength(14);
    expect(ledger.continuous.matrix.every((row) => row.reports.length === 8)).toBe(true);
    expect(ledger.today.tasks).toHaveLength(2);
    const serialized = JSON.stringify(ledger);
    expect(serialized).not.toContain('secret-store-alpha');
    expect(serialized).not.toContain('secret-store-beta');
    expect(serialized).not.toContain('secret-profile-alpha');
    expect(serialized).not.toContain('C:\\private\\stores');
    expect(ledger.orchestration.sequence.map((step) => step.id)).toEqual(EXPORT_SEQUENCE);
    database.close();
  });

  it('finds shallow manual and policy candidates but exposes only stable references', () => {
    const root = tempRoot('stage8-gate-canary-');
    const storesRoot = path.join(root, 'stores');
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE mission_grants (
        id TEXT PRIMARY KEY, store_id TEXT, issuer_type TEXT
      );
      CREATE TABLE ad_execution_batches (
        id TEXT PRIMARY KEY, store_id TEXT, grant_id TEXT, status TEXT
      );
      CREATE TABLE ad_execution_jobs (
        id TEXT PRIMARY KEY, store_id TEXT, batch_id TEXT, grant_id TEXT,
        proposal_id TEXT, status TEXT, terminal_at TEXT
      );
      CREATE TABLE analysis_proposal_snapshots (
        id TEXT PRIMARY KEY, store_id TEXT, ad_entity_authority_id TEXT
      );
      CREATE TABLE verified_ad_entity_authority (
        authority_id TEXT PRIMARY KEY
      );
      CREATE TABLE ad_execution_evidence (
        id TEXT PRIMARY KEY, store_id TEXT, job_id TEXT
      );
    `);
    const stores = [
      { storeId: 'secret-store-alpha' },
      { storeId: 'secret-store-beta' },
    ];
    const aliases = new Map([
      ['secret-store-alpha', 'store-1'],
      ['secret-store-beta', 'store-2'],
    ]);
    for (const [index, issuer] of ['human', 'policy'].entries()) {
      const storeId = stores[index].storeId;
      const grantId = `secret-grant-${issuer}`;
      const batchId = `secret-batch-${issuer}`;
      const jobId = `secret-job-${issuer}`;
      const proposalId = `secret-proposal-${issuer}`;
      const authorityId = `secret-authority-${issuer}`;
      database.prepare('INSERT INTO mission_grants VALUES (?, ?, ?)')
        .run(grantId, storeId, issuer);
      database.prepare('INSERT INTO ad_execution_batches VALUES (?, ?, ?, ?)')
        .run(batchId, storeId, grantId, 'succeeded');
      database.prepare('INSERT INTO ad_execution_jobs VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(jobId, storeId, batchId, grantId, proposalId, 'succeeded', '2026-07-28T00:00:00.000Z');
      database.prepare('INSERT INTO analysis_proposal_snapshots VALUES (?, ?, ?)')
        .run(proposalId, storeId, authorityId);
      database.prepare('INSERT INTO verified_ad_entity_authority VALUES (?)')
        .run(authorityId);
      for (const slot of ['before', 'after', 'reload']) {
        database.prepare('INSERT INTO ad_execution_evidence VALUES (?, ?, ?)')
          .run(`${jobId}-${slot}`, storeId, jobId);
      }
      for (const slot of ['before', 'after', 'reload']) {
        const artifactPath = deterministicExecutionArtifactPath(
          storesRoot,
          storeId,
          batchId,
          jobId,
          slot,
        );
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
        fs.writeFileSync(artifactPath, slot);
      }
    }
    const candidates = rawCanaryCandidates(database, stores, aliases, storesRoot);
    expect(candidates.manual_approval).toHaveLength(1);
    expect(candidates.policy_auto).toHaveLength(1);
    expect(candidates.manual_approval[0].precheckPassed).toBe(true);
    const projected = operatorModule.publicCanaryCandidates(candidates);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('secret-job-human');
    expect(serialized).not.toContain('secret-authority-policy');
    expect(projected.manualApproval.candidates[0].jobRef)
      .toBe(stableRef('job', 'secret-job-human'));
    database.close();
  });

  it('atomically writes only a new explicit ledger path', () => {
    const root = tempRoot('stage8-gate-ledger-');
    const outputPath = path.join(root, 'monitoring-ledger.json');
    const ledger = {
      formalEvidence: false,
      kind: 'fixture',
      safety: { adsExecutionInvoked: false },
    };
    expect(writeAtomicLedger(outputPath, ledger)).toBe(outputPath);
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(ledger);
    expect(() => writeAtomicLedger(outputPath, ledger)).toThrow(/already exists/i);
  });

  it('rejects execute-exports before formal preflight when any gate is absent', () => {
    const root = tempRoot('stage8-gate-preflight-');
    const packageEvidence = Object.fromEntries(
      operatorModule.PACKAGE_EVIDENCE_OPTIONS.map((option) => [option, null]),
    );
    const result = validateExecuteInputs({
      database: { live: { schema: { status: 'MIGRATION_REQUIRED' } } },
      stores: { status: 'NEEDS_CONFIGURATION' },
      continuous: { passed: false },
      canaryCandidates: {
        manualApproval: { precheckedCount: 0 },
        policyAuto: { precheckedCount: 0 },
      },
    }, {
      exportRoot: root,
      packageEvidence,
    }, {
      canonicalEvidenceRoot: root,
    });
    expect(result.passed).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'LIVE_SCHEMA_NOT_READY',
      'CONTINUOUS_OPERATION_NOT_PASSED',
      'MANUAL_CANARY_CANDIDATE_MISSING',
      'POLICY_CANARY_CANDIDATE_MISSING',
    ]));
  });

  it('writes only the partial ledger when execute-exports preflight is blocked', async () => {
    const root = tempRoot('stage8-gate-execute-blocked-');
    const dbPath = path.join(root, 'amazon-ai-ops.db');
    const database = new Database(dbPath);
    database.exec('CREATE TABLE legacy_payload (id INTEGER PRIMARY KEY, value TEXT)');
    database.close();
    const before = fs.readFileSync(dbPath);
    const evidencePaths = {};
    for (const option of operatorModule.PACKAGE_EVIDENCE_OPTIONS) {
      const evidencePath = path.join(root, `${option}.json`);
      fs.writeFileSync(evidencePath, '{}');
      evidencePaths[option] = evidencePath;
    }
    const outputPath = path.join(root, 'partial-ledger.json');
    let stdout = '';
    const argv = [
      '--db', dbPath,
      '--execute-exports',
      '--export-root', root,
      '--out', outputPath,
      ...operatorModule.PACKAGE_EVIDENCE_OPTIONS.flatMap((option) => [
        `--${option}`, evidencePaths[option],
      ]),
    ];
    const result = await run(argv, {
      Database,
      canonicalEvidenceRoot: root,
      migrationContract: migrationContract(),
      runReadonlyBackup({ sourceDatabasePath, destinationPath }) {
        fs.copyFileSync(sourceDatabasePath, destinationPath);
        return {
          observedBackup: { remainingPages: 0, totalPages: 1 },
        };
      },
      writeStdout(value) {
        stdout += value;
      },
    });
    expect(result.exitCode).toBe(2);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(dbPath)).toEqual(before);
    const ledger = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(ledger.executeExports).toMatchObject({
      formalArtifactsWritten: [],
      preflightPassed: false,
      status: 'BLOCKED_ZERO_FORMAL_ARTIFACTS',
    });
    expect(stdout).not.toContain(dbPath);
    expect(fs.readdirSync(root).filter((name) => name.startsWith('authority-snapshots')))
      .toHaveLength(0);
  });
});
