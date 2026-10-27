// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, fs, operatorModule, path } from './stage8-operator-test-environment.mjs';
import { createOperationalReadSchema, seedTwoStores } from './stage8-operator-test-database.mjs';
function createExecuteExportsHarness(root, mutateSnapshot = () => { }) {
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
        const evidenceRoot = path.join(root, 'stores', storeId, 'evidence', 'ad-execution', batchId, jobId);
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
export { createExecuteExportsHarness };
