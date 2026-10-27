// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { Database, describe, expect, fs, it, migrationContract, operatorModule, path, run } from './stage8-operator-test-environment.mjs';
import { tempRoot } from './stage8-operator-test-database.mjs';
import { createExecuteExportsHarness } from './stage8-operator-test-execution.mjs';
describe('Stage 8 Gate Operator', () => {
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
    expect(artifacts.every(({ basename }) => (fs.existsSync(path.join(basename.startsWith('stage8-continuous-')
        ? path.join(root, 'continuous-operation')
        : basename.startsWith('stage8-manual-') || basename.startsWith('stage8-policy-')
            ? path.join(root, 'execution-canaries')
            : basename.startsWith('mission-control-')
                ? root
                : path.join(root, 'authority-snapshots', fs.readdirSync(path.join(root, 'authority-snapshots'))[0]), basename))))).toBe(true);
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
