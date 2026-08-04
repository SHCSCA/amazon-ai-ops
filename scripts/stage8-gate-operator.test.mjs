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
  EXPECTED_REPORT_TYPES,
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
      observed_at, verified_at, expires_at
    ) VALUES (?, ?, ?, 'ready', 3, '2026-07-28T00:00:00.000Z',
              '2026-07-28T00:00:00.000Z', '2026-07-29T00:00:00.000Z')
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

function createExecuteExportsHarness(root, mutateSnapshot = () => {}) {
  const rawStoreIds = ['secret-store-alpha', 'secret-store-beta'];
  const packageEvidence = {};
  for (const option of operatorModule.PACKAGE_EVIDENCE_OPTIONS) {
    const evidencePath = path.join(root, `${option}.json`);
    fs.writeFileSync(evidencePath, '{}');
    packageEvidence[option] = evidencePath;
  }
  const outputPath = path.join(root, 'stage8-ledger.json');
  const counters = {
    canary: 0,
    continuous: 0,
    readiness: 0,
  };
  const candidate = (storeId, mode) => {
    const batchId = `secret-batch-${mode}`;
    const jobId = `secret-job-${mode}`;
    const evidenceRoot = path.join(
      root,
      'stores',
      storeId,
      'evidence',
      'ad-execution',
      batchId,
      jobId,
    );
    return {
      artifactPaths: {
        after: path.join(evidenceRoot, 'after.png'),
        before: path.join(evidenceRoot, 'before.png'),
        reload: path.join(evidenceRoot, 'reload.png'),
      },
      authorityId: `secret-authority-${mode}`,
      batchId,
      grantId: `secret-grant-${mode}`,
      jobId,
      storeId,
    };
  };
  const selectedCandidates = {
    manual: candidate(rawStoreIds[0], 'manual'),
    policy: candidate(rawStoreIds[1], 'policy'),
  };
  const diagnose = () => {
    const ledger = {
      canaryCandidates: {
        manualApproval: { precheckedCount: 1 },
        policyAuto: { precheckedCount: 1 },
      },
      continuous: {
        businessDates: ['2026-07-20', '2026-07-21'],
        passed: true,
      },
      database: { live: { schema: { status: 'READY' } } },
      formalEvidence: false,
      kind: operatorModule.LEDGER_KIND,
      safety: {
        adsExecutionInvoked: false,
        authorityDatabaseMutated: false,
      },
      status: 'READY_FOR_EXPORT_PREFLIGHT',
      stores: {
        authorityStatus: 'READY',
        operationalStatus: { status: 'READY' },
        status: 'READY',
      },
    };
    Object.defineProperty(ledger, '_internal', {
      enumerable: false,
      value: {
        dbPath: path.join(root, 'secret-live-authority.db'),
        rawCandidates: {},
        rawStoreIds,
      },
    });
    return ledger;
  };
  let stdout = '';
  return {
    argv: [
      '--db', path.join(root, 'secret-live-authority.db'),
      '--execute-exports',
      '--export-root', root,
      '--out', outputPath,
      ...operatorModule.PACKAGE_EVIDENCE_OPTIONS.flatMap((option) => [
        `--${option}`, packageEvidence[option],
      ]),
    ],
    context: {
      Database,
      canonicalEvidenceRoot: root,
      continuousVerifier: {
        run(args, overrides) {
          counters.continuous += 1;
          const destination = args[args.indexOf('--output') + 1];
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, '{"status":"PASSED"}\n');
          overrides.writeStdout('{"status":"PASSED"}\n');
          return 0;
        },
      },
      deepFormalPreflight: async () => ({
        blockers: [],
        passed: true,
        selectedCandidates,
      }),
      diagnose,
      async exportAuthoritySnapshot({ outputDirectory }) {
        fs.mkdirSync(outputDirectory, { recursive: true });
        const snapshotPath = path.join(outputDirectory, 'authority-snapshot.db');
        const manifestPath = path.join(outputDirectory, 'snapshot-manifest.json');
        const database = new Database(snapshotPath);
        createOperationalReadSchema(database);
        seedTwoStores(database);
        mutateSnapshot(database);
        database.close();
        fs.writeFileSync(manifestPath, '{}');
        return { manifestPath, snapshotPath };
      },
      exportExecutionCanaryEvidence(options) {
        counters.canary += 1;
        fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
        fs.writeFileSync(options.outputPath, '{"status":"PASSED"}\n');
        return { outputPath: options.outputPath };
      },
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      randomUUID: () => '00000000-0000-4000-8000-000000000002',
      readinessVerifier: {
        run(args) {
          counters.readiness += 1;
          const destination = args[args.indexOf('--out') + 1];
          fs.writeFileSync(destination, '{"appReady":true}\n');
          return {
            exitCode: 0,
            outputPath: destination,
            report: { appReady: true, summary: { passed: 8 } },
          };
        },
      },
      writeStdout(value) {
        stdout += value;
      },
    },
    counters,
    outputPath,
    packageEvidence,
    rawStoreIds,
    stdout: () => stdout,
  };
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
    database.prepare(`
      UPDATE store_connections SET last_failure_code = ?
      WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
    `).run('C:\\private\\secret-store-alpha\\provider-detail.json');
    database.prepare(`
      UPDATE store_session_metadata SET failure_code = ?
      WHERE store_id = 'secret-store-alpha' AND provider = 'amazon_ads'
    `).run('secret-session-id:C:\\private\\cookies');
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
      authorityStatus: 'READY',
      operationalStatus: {
        status: 'READY',
      },
      selectedCount: 2,
      status: 'READY',
    });
    expect(ledger.stores.items.map((item) => item.alias)).toEqual(['store-1', 'store-2']);
    expect(ledger.continuous.matrix).toHaveLength(14);
    expect(ledger.continuous.matrix.every((row) => row.reports.length === 8)).toBe(true);
    expect(ledger.continuous.violations.every((violation) => (
      typeof violation.code === 'string'
      && Object.hasOwn(violation, 'businessDate')
      && Object.hasOwn(violation, 'storeAlias')
      && typeof violation.detail?.action === 'string'
    ))).toBe(true);
    expect(ledger.today.tasks).toHaveLength(2);
    expect(ledger.stores.items[0].connections[0]).toMatchObject({
      hasFailureCode: true,
    });
    expect(ledger.stores.items[0].sessions[1]).toMatchObject({
      hasFailureCode: true,
    });
    const serialized = JSON.stringify(ledger);
    expect(serialized).not.toContain('secret-store-alpha');
    expect(serialized).not.toContain('secret-store-beta');
    expect(serialized).not.toContain('secret-profile-alpha');
    expect(serialized).not.toContain('provider-detail.json');
    expect(serialized).not.toContain('secret-session-id');
    expect(serialized).not.toContain('cookies');
    expect(serialized).not.toContain('C:\\private\\stores');
    expect(ledger.orchestration.sequence.map((step) => step.id)).toEqual(EXPORT_SEQUENCE);
    database.close();
  });

  it('projects matrix refs from the evaluator-selected authoritative lineage', () => {
    const businessDate = '2026-07-28';
    const stores = [{ storeId: 'secret-store-alpha' }];
    const aliases = new Map([['secret-store-alpha', 'store-1']]);
    const snapshot = {
      jobs: [
        {
          businessDate,
          jobId: 'secret-job-old',
          storeId: 'secret-store-alpha',
          updatedAt: '2026-07-28T16:00:00.000Z',
        },
        {
          businessDate,
          jobId: 'secret-job-selected',
          storeId: 'secret-store-alpha',
          updatedAt: '2026-07-28T17:00:00.000Z',
        },
      ],
      checkpoints: EXPECTED_REPORT_TYPES.flatMap((reportType) => [
        {
          jobId: 'secret-job-old',
          reportType,
          state: 'downloaded',
          storeId: 'secret-store-alpha',
        },
        {
          jobId: 'secret-job-selected',
          reportType,
          state: reportType === EXPECTED_REPORT_TYPES[0] ? 'downloaded' : 'failed',
          storeId: 'secret-store-alpha',
        },
      ]),
      imports: [{
        businessDate,
        runId: 'secret-run-selected',
        storeId: 'secret-store-alpha',
      }],
      importFiles: [{
        reportType: EXPECTED_REPORT_TYPES[0],
        runId: 'secret-run-selected',
        storeId: 'secret-store-alpha',
      }],
      reconciliations: [{
        reportType: EXPECTED_REPORT_TYPES[0],
        runId: 'secret-run-selected',
        status: 'matched',
        storeId: 'secret-store-alpha',
        withinTolerance: 1,
      }],
    };
    const evaluation = {
      stores: [{
        days: [{
          accepted: false,
          businessDate,
          importRunId: 'secret-run-selected',
          jobId: 'secret-job-selected',
          outcome: 'INVALID_SUCCESS',
        }],
        storeId: 'secret-store-alpha',
      }],
    };

    const [row] = operatorModule.reportMatrix(
      snapshot,
      evaluation,
      stores,
      aliases,
      [businessDate],
    );

    expect(row).toMatchObject({
      importRef: stableRef('import-run', 'secret-run-selected'),
      jobRef: stableRef('collection-job', 'secret-job-selected'),
      storeAlias: 'store-1',
    });
    expect(row.reports.filter(({ status }) => status === 'VERIFIED')).toHaveLength(1);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('secret-job-old');
    expect(serialized).not.toContain('secret-job-selected');
    expect(serialized).not.toContain('secret-run-selected');
    expect(serialized).not.toContain('secret-store-alpha');
  });

  it.each([
    {
      code: 'LINGXING_CONNECTION_MISSING',
      mutate(database) {
        database.prepare(`
          DELETE FROM store_connections
          WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
        `).run();
      },
      name: 'missing Lingxing connection',
    },
    {
      code: 'AMAZON_ADS_CONNECTION_NOT_READY',
      mutate(database) {
        database.prepare(`
          UPDATE store_connections SET status = 'blocked'
          WHERE store_id = 'secret-store-alpha' AND provider = 'amazon_ads'
        `).run();
      },
      name: 'not-ready Amazon Ads connection',
    },
    {
      code: 'LINGXING_SESSION_MISSING',
      mutate(database) {
        database.prepare(`
          DELETE FROM store_session_metadata
          WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
        `).run();
      },
      name: 'missing Lingxing session',
    },
    {
      code: 'AMAZON_ADS_SESSION_NOT_READY',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET status = 'blocked'
          WHERE store_id = 'secret-store-alpha' AND provider = 'amazon_ads'
        `).run();
      },
      name: 'not-ready Amazon Ads session',
    },
    {
      code: 'LINGXING_SESSION_PROFILE_MISMATCH',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET browser_profile_id = 'secret-profile-other'
          WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
        `).run();
      },
      name: 'session profile mismatch',
    },
    {
      code: 'AMAZON_ADS_SESSION_EXPIRED',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET expires_at = '2026-07-28T11:59:59.999Z'
          WHERE store_id = 'secret-store-alpha' AND provider = 'amazon_ads'
        `).run();
      },
      name: 'expired session',
    },
    {
      code: 'LINGXING_SESSION_OBSERVED_AT_INVALID',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET observed_at = 'not-a-time'
          WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
        `).run();
      },
      name: 'invalid observed_at',
    },
    {
      code: 'LINGXING_SESSION_OBSERVED_AT_INVALID',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET observed_at = '2026-07-28T12:00:00.001Z'
          WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
        `).run();
      },
      name: 'future observed_at',
    },
    {
      code: 'AMAZON_ADS_SESSION_VERIFIED_AT_INVALID',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET verified_at = 'not-a-time'
          WHERE store_id = 'secret-store-alpha' AND provider = 'amazon_ads'
        `).run();
      },
      name: 'invalid verified_at',
    },
    {
      code: 'AMAZON_ADS_SESSION_VERIFIED_AT_INVALID',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET verified_at = '2026-07-28T12:00:00.001Z'
          WHERE store_id = 'secret-store-alpha' AND provider = 'amazon_ads'
        `).run();
      },
      name: 'future verified_at',
    },
    {
      code: 'LINGXING_SESSION_EXPIRES_AT_INVALID',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET expires_at = 'not-a-time'
          WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
        `).run();
      },
      name: 'invalid expires_at',
    },
  ])('blocks operational readiness for $name', ({ code, mutate }) => {
    const database = new Database(':memory:');
    createOperationalReadSchema(database);
    seedTwoStores(database);
    mutate(database);

    const ledger = inspectOpenedDatabase(database, {
      dbPath: 'C:\\private\\amazon-ai-ops.db',
      stores: ['secret-store-alpha', 'secret-store-beta'],
      storesRoot: 'C:\\private\\stores',
    }, {
      migrationContract: migrationContract(),
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    expect(ledger.stores.authorityStatus).toBe('READY');
    expect(ledger.stores.operationalStatus).toMatchObject({
      status: 'BLOCKED',
      stores: [
        {
          gaps: expect.arrayContaining([code]),
          status: 'BLOCKED',
          storeAlias: 'store-1',
        },
        {
          gaps: [],
          status: 'READY',
          storeAlias: 'store-2',
        },
      ],
    });
    expect(ledger.stores.status).toBe('NEEDS_CONFIGURATION');
    expect(ledger.status).not.toBe('READY_FOR_EXPORT_PREFLIGHT');
    const serialized = JSON.stringify(ledger);
    expect(serialized).not.toContain('secret-store-alpha');
    expect(serialized).not.toContain('secret-profile-other');
    database.close();
  });

  it('fails closed when explicit store selection hides a third active US/USD store', () => {
    const database = new Database(':memory:');
    createOperationalReadSchema(database);
    seedTwoStores(database);
    database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency,
        display_name, status, business_timezone
      ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles')
    `).run('secret-store-gamma', 'secret-profile-gamma', 'Gamma');

    const ledger = inspectOpenedDatabase(database, {
      dbPath: 'C:\\private\\amazon-ai-ops.db',
      stores: ['secret-store-alpha', 'secret-store-beta'],
      storesRoot: 'C:\\private\\stores',
    }, {
      migrationContract: migrationContract(),
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    expect(ledger.stores).toMatchObject({
      activeUsUsdCount: 3,
      authorityStatus: 'NEEDS_CONFIGURATION',
      selectedCount: 2,
      status: 'NEEDS_CONFIGURATION',
    });
    expect(ledger.status).not.toBe('READY_FOR_EXPORT_PREFLIGHT');
    expect(ledger.orchestration.sequence[0]).toMatchObject({
      id: 'authority-snapshot',
      readyForPreflight: false,
    });
    expect(JSON.stringify(ledger)).not.toContain('secret-store-gamma');
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
      'STORE_OPERATIONAL_NOT_READY',
      'CONTINUOUS_OPERATION_NOT_PASSED',
      'MANUAL_CANARY_CANDIDATE_MISSING',
      'POLICY_CANARY_CANDIDATE_MISSING',
    ]));
  });

  it('keeps every orchestration step blocked when store operations are not ready', () => {
    const packageEvidence = Object.fromEntries(
      operatorModule.PACKAGE_EVIDENCE_OPTIONS.map((option) => [option, `${option}.json`]),
    );
    const plan = operatorModule.buildOrchestrationPlan({
      database: { live: { schema: { status: 'READY' } } },
      stores: {
        authorityStatus: 'READY',
        operationalStatus: { status: 'BLOCKED' },
        status: 'NEEDS_CONFIGURATION',
      },
      continuous: { passed: true },
      canaryCandidates: {
        manualApproval: { precheckedCount: 1 },
        policyAuto: { precheckedCount: 1 },
      },
    }, packageEvidence);

    expect(plan.status).toBe('PARTIAL');
    expect(plan.sequence.every((step) => step.readyForPreflight === false)).toBe(true);
  });

  it('accepts a healthy immutable formal authority snapshot store gate', () => {
    const root = tempRoot('stage8-formal-store-gate-ready-');
    const snapshotPath = path.join(root, 'authority-snapshot.db');
    const database = new Database(snapshotPath);
    createOperationalReadSchema(database);
    seedTwoStores(database);
    database.close();

    expect(operatorModule.inspectImmutableSnapshotStoreGate(
      snapshotPath,
      ['secret-store-alpha', 'secret-store-beta'],
      {
        Database,
        now: () => new Date('2026-07-28T12:00:00.000Z'),
      },
    )).toMatchObject({
      activeUsUsdCount: 2,
      authorityStatus: 'READY',
      operationalStatus: { status: 'READY' },
      status: 'READY',
    });
  });

  it.each([
    {
      code: 'AMAZON_ADS_CONNECTION_NOT_READY',
      mutate(database) {
        database.prepare(`
          UPDATE store_connections SET status = 'blocked'
          WHERE store_id = 'secret-store-alpha' AND provider = 'amazon_ads'
        `).run();
      },
      name: 'connection becomes blocked',
    },
    {
      code: 'LINGXING_SESSION_EXPIRED',
      mutate(database) {
        database.prepare(`
          UPDATE store_session_metadata SET expires_at = '2026-07-28T11:59:59.999Z'
          WHERE store_id = 'secret-store-alpha' AND provider = 'lingxing'
        `).run();
      },
      name: 'session expires',
    },
  ])('fails formal export when $name after deep preflight', async ({ code, mutate }) => {
    const root = tempRoot('stage8-formal-store-gate-toctou-');
    const harness = createExecuteExportsHarness(root, mutate);
    const result = await run(harness.argv, harness.context);

    expect(result).toMatchObject({
      exitCode: 1,
      ledger: {
        status: 'EXPORT_CHAIN_INTERRUPTED',
        executeExports: {
          completed: false,
          status: 'INTERRUPTED_FAIL_CLOSED',
        },
      },
    });
    expect(result.ledger.executeExports.formalAuthorityStoreGate).toMatchObject({
      authorityStatus: 'READY',
      operationalStatus: {
        status: 'BLOCKED',
        stores: expect.arrayContaining([
          expect.objectContaining({
            gaps: expect.arrayContaining([code]),
            storeAlias: 'store-1',
          }),
        ]),
      },
      status: 'NEEDS_CONFIGURATION',
    });
    expect(result.ledger.executeExports.formalArtifactsWritten).toEqual([
      expect.objectContaining({
        basename: 'snapshot-manifest.json',
        ref: expect.stringMatching(/^path-[a-f0-9]{12}$/),
      }),
      expect.objectContaining({
        basename: 'authority-snapshot.db',
        ref: expect.stringMatching(/^path-[a-f0-9]{12}$/),
      }),
    ]);
    expect(harness.counters).toEqual({
      canary: 0,
      continuous: 0,
      readiness: 0,
    });
    expect(fs.existsSync(path.join(root, 'continuous-operation'))).toBe(false);
    expect(fs.existsSync(harness.outputPath)).toBe(true);
    const serialized = fs.readFileSync(harness.outputPath, 'utf8');
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain('secret-store-alpha');
    expect(serialized).not.toContain('secret-live-authority.db');
  });

  it('completes the full explicit execute-exports orchestration in order', async () => {
    const root = tempRoot('stage8-formal-export-success-');
    const harness = createExecuteExportsHarness(root);
    const result = await run(harness.argv, harness.context);

    expect(result).toMatchObject({
      exitCode: 0,
      ledger: {
        status: 'EXPORT_CHAIN_COMPLETED',
        executeExports: {
          completed: true,
          preflightPassed: true,
          status: 'COMPLETED',
        },
      },
    });
    expect(result.ledger.executeExports.formalAuthorityStoreGate).toMatchObject({
      activeUsUsdCount: 2,
      authorityStatus: 'READY',
      operationalStatus: { status: 'READY' },
      status: 'READY',
    });
    const artifacts = result.ledger.executeExports.formalArtifactsWritten;
    expect(artifacts).toHaveLength(6);
    expect(artifacts.map(({ basename }) => basename)).toEqual([
      'snapshot-manifest.json',
      'authority-snapshot.db',
      expect.stringMatching(/^stage8-continuous-.*\.json$/),
      expect.stringMatching(/^stage8-manual-.*\.json$/),
      expect.stringMatching(/^stage8-policy-.*\.json$/),
      expect.stringMatching(/^mission-control-production-readiness-stage8-.*\.json$/),
    ]);
    expect(artifacts.every(({ ref }) => /^path-[a-f0-9]{12}$/.test(ref))).toBe(true);
    expect(harness.counters).toEqual({
      canary: 2,
      continuous: 1,
      readiness: 1,
    });
    expect(artifacts.every(({ basename }) => (
      fs.existsSync(path.join(
        basename.startsWith('stage8-continuous-')
          ? path.join(root, 'continuous-operation')
          : basename.startsWith('stage8-manual-') || basename.startsWith('stage8-policy-')
            ? path.join(root, 'execution-canaries')
            : basename.startsWith('mission-control-')
              ? root
              : path.join(root, 'authority-snapshots',
                fs.readdirSync(path.join(root, 'authority-snapshots'))[0]),
        basename,
      ))
    ))).toBe(true);
    const serialized = fs.readFileSync(harness.outputPath, 'utf8');
    expect(serialized).not.toContain(root);
    for (const rawStoreId of harness.rawStoreIds) {
      expect(serialized).not.toContain(rawStoreId);
    }
    expect(serialized).not.toContain('secret-job-manual');
    expect(serialized).not.toContain('secret-authority-policy');
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
