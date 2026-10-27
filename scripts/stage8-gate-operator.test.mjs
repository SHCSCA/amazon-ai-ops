// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, EXPECTED_REPORT_TYPES, EXPORT_SEQUENCE, describe, deterministicExecutionArtifactPath, expect, fs, inspectOpenedDatabase, inspectSchema, it, migrationContract, operatorModule, parseArgs, path, rawCanaryCandidates, run, stableRef, validateExecuteInputs, writeAtomicLedger } from './stage8-operator-test-environment.mjs';
import { createOperationalReadSchema, seedTwoStores, tempRoot } from './stage8-operator-test-database.mjs';
import { createExecuteExportsHarness } from './stage8-operator-test-execution.mjs';
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
    expect(parseArgs(['--export']).errors).toContain('--export and --execute-exports require an explicit --out path.');
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
    expect(ledger.continuous.violations.every((violation) => (typeof violation.code === 'string'
        && Object.hasOwn(violation, 'businessDate')
        && Object.hasOwn(violation, 'storeAlias')
        && typeof violation.detail?.action === 'string'))).toBe(true);
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
    const [row] = operatorModule.reportMatrix(snapshot, evaluation, stores, aliases, [businessDate]);
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
            const artifactPath = deterministicExecutionArtifactPath(storesRoot, storeId, batchId, jobId, slot);
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
    const packageEvidence = Object.fromEntries(operatorModule.PACKAGE_EVIDENCE_OPTIONS.map((option) => [option, null]));
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
    const packageEvidence = Object.fromEntries(operatorModule.PACKAGE_EVIDENCE_OPTIONS.map((option) => [option, `${option}.json`]));
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
    expect(operatorModule.inspectImmutableSnapshotStoreGate(snapshotPath, ['secret-store-alpha', 'secret-store-beta'], {
        Database,
        now: () => new Date('2026-07-28T12:00:00.000Z'),
    })).toMatchObject({
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
});
