// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { HASH_A, describe, expect, fs, it, path, readinessVerifier, root } from './mission-control-readiness-test-environment.mjs';
import { canaryScreenshotBytes, makeTempDir, readJson, runVerifier, sha256File, writeJson } from './mission-control-readiness-test-artifacts.mjs';
import { mutateAuthoritySnapshot, passingEvidenceChain, refreshAuthoritySnapshotBindings, replaceCanaryArtifact, verifierArgs, writeFullyReadyV15Baseline, writeInvalidV15FailureSet } from './mission-control-readiness-test-chain.mjs';
describe('Mission Control production readiness CLI', () => {
it('is exposed through the Stage 7 root package script', () => {
    const packageJson = readJson(path.join(root, 'package.json'));
    expect(packageJson.scripts['verify:s7-production-readiness']).toBe('node scripts/verify-mission-control-production-readiness.js');
});

it('writes APP_NEEDS_WORK with every gate when explicit evidence inputs are missing', () => {
    const tempDir = makeTempDir('mission-control-readiness-missing-');
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(['--out', outputPath]);
    expect(result.status).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);
    const report = readJson(outputPath);
    expect(report).toMatchObject({
        kind: 'mission-control-production-readiness',
        schemaVersion: 'mission-control-production-readiness/v1',
        status: 'APP_NEEDS_WORK',
        appReady: false,
        allGatesPass: false,
        evidenceSelection: {
            explicitOnly: true,
            latestFallbackUsed: false,
        },
        summary: { total: 8, passed: 0, failed: 8 },
    });
    expect(report.gates).toHaveLength(8);
    expect(report.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'v15-final-readiness', ok: false, status: 'missing', evidencePath: null }),
        expect.objectContaining({ id: 'policy-auto-canary', ok: false, status: 'missing', evidencePath: null }),
    ]));
    expect(report.gates.every((gate) => typeof gate.reason === 'string' && gate.reason.includes('explicit'))).toBe(true);
});

it('writes APP_READY when the sole legacy 7/8 readback failure is superseded by both DB-backed canaries', () => {
    const tempDir = makeTempDir('mission-control-readiness-pass-');
    const { packageIdentity, paths } = passingEvidenceChain(tempDir);
    const outputPath = path.join(tempDir, 'readiness.json');
    const args = verifierArgs(paths, outputPath);
    const inMemoryReport = readinessVerifier.buildReport(readinessVerifier.parseArgs(args), paths.verificationContext);
    expect(Object.values(inMemoryReport._verifiedCanaryPngArtifacts).flat()).toHaveLength(6);
    expect(Object.values(inMemoryReport._verifiedCanaryPngArtifacts)).toEqual([
        expect.arrayContaining([
            expect.objectContaining({ slot: 'before', width: 1200, height: 700 }),
            expect.objectContaining({ slot: 'after', width: 1200, height: 700 }),
            expect.objectContaining({ slot: 'reload', width: 1200, height: 700 }),
        ]),
        expect.arrayContaining([
            expect.objectContaining({ slot: 'before', width: 1200, height: 700 }),
            expect.objectContaining({ slot: 'after', width: 1200, height: 700 }),
            expect.objectContaining({ slot: 'reload', width: 1200, height: 700 }),
        ]),
    ]);
    const result = runVerifier(args);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const report = readJson(outputPath);
    expect(report).toMatchObject({
        status: 'APP_READY',
        appReady: true,
        allGatesPass: true,
        packageIdentity,
        summary: { total: 8, passed: 8, failed: 0 },
    });
    expect(report.gates).toHaveLength(8);
    expect(report.gates.every((gate) => gate.ok === true && gate.status === 'passed')).toBe(true);
    expect(report.gates.every((gate) => path.isAbsolute(gate.evidencePath))).toBe(true);
    expect(report).not.toHaveProperty('_verifiedCanaryPngArtifacts');
    expect(report.gates.find((gate) => gate.id === 'v15-final-readiness')).toEqual(expect.objectContaining({
        supersededBy: ['manual-canary', 'policy-auto-canary'],
    }));
    const snapshotManifest = readJson(paths.authoritySnapshotManifest);
    expect(snapshotManifest.source.artifactAfter.sha256).not.toBe(snapshotManifest.snapshot.sha256);
});

it('rejects package launch evidence when a required native runtime proof is deleted', () => {
    const tempDir = makeTempDir('mission-control-readiness-launch-proof-');
    const { paths } = passingEvidenceChain(tempDir);
    const launch = readJson(paths.packageLaunch);
    delete launch.checks.find((check) => check.kind === 'portable').runtimeProcess;
    writeJson(paths.packageLaunch, launch);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'package-launch',
            ok: false,
            reason: expect.stringMatching(/strict contract|runtime process|PACKAGE_LAUNCH/i),
        }),
    ]));
});

it('also accepts a genuine legacy 8/8 APP_READY baseline', () => {
    const tempDir = makeTempDir('mission-control-readiness-v15-ready-');
    const { paths } = passingEvidenceChain(tempDir);
    writeFullyReadyV15Baseline(paths);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readJson(outputPath)).toMatchObject({
        status: 'APP_READY',
        appReady: true,
        allGatesPass: true,
        summary: { total: 8, passed: 8, failed: 0 },
    });
});

it.each([
    ['a different sole legacy failure', ['listing-ai-draft']],
    ['an additional legacy failure', ['real-ad-execution-readback', 'listing-ai-draft']],
])('rejects %s instead of treating it as Stage 7 supersession', (_label, failedGateIds) => {
    const tempDir = makeTempDir('mission-control-readiness-v15-failure-');
    const { paths } = passingEvidenceChain(tempDir);
    writeInvalidV15FailureSet(paths, failedGateIds);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'v15-final-readiness',
            ok: false,
            reason: expect.stringMatching(/legacy|7\/8|readback|failure/i),
        }),
    ]));
});

it('fails closed when explicitly selected package evidence has a mismatched executable hash', () => {
    const tempDir = makeTempDir('mission-control-readiness-hash-');
    const { paths } = passingEvidenceChain(tempDir);
    const security = readJson(paths.packageSecurity);
    security.package.executableSha256 = HASH_A;
    writeJson(paths.packageSecurity, security);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    const report = readJson(outputPath);
    expect(report.status).toBe('APP_NEEDS_WORK');
    expect(report.packageIdentity.executableSha256).toBe(sha256File(paths.verificationContext.executablePath));
    expect(report.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'package-security',
            ok: false,
            reason: expect.stringMatching(/executableSha256.*does not match/i),
        }),
    ]));
});

it('rejects a package UI screenshot whose current bytes no longer match its manifest', () => {
    const tempDir = makeTempDir('mission-control-readiness-ui-stale-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.packageUi);
    fs.appendFileSync(manifest.runs[0].screenshots[0].path, Buffer.from('tampered'));
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'package-ui',
            ok: false,
            reason: expect.stringMatching(/workspace screenshot files are missing or stale/i),
        }),
    ]));
});

it('rejects historical v5/v6 package UI evidence and a stale scheduler subview screenshot', () => {
    for (const schemaVersion of [5, 6, 7, 8]) {
        const legacyDir = makeTempDir(`mission-control-readiness-ui-v${schemaVersion}-`);
        const legacy = passingEvidenceChain(legacyDir);
        const legacyManifest = readJson(legacy.paths.packageUi);
        legacyManifest.schemaVersion = schemaVersion;
        writeJson(legacy.paths.packageUi, legacyManifest);
        const legacyOutput = path.join(legacyDir, 'readiness.json');
        expect(runVerifier(verifierArgs(legacy.paths, legacyOutput)).status).toBe(1);
        expect(readJson(legacyOutput).gates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'package-ui',
                ok: false,
                reason: expect.stringMatching(/schema v9/i),
            }),
        ]));
    }
    const staleDir = makeTempDir('mission-control-readiness-ui-subview-stale-');
    const stale = passingEvidenceChain(staleDir);
    const staleManifest = readJson(stale.paths.packageUi);
    fs.appendFileSync(staleManifest.runs[0].subviewChecks[0].screenshot.path, Buffer.from('tampered-scheduler-subview'));
    const staleOutput = path.join(staleDir, 'readiness.json');
    expect(runVerifier(verifierArgs(stale.paths, staleOutput)).status).toBe(1);
    expect(readJson(staleOutput).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'package-ui',
            ok: false,
            reason: expect.stringMatching(/read-only subview screenshot files are missing or stale/i),
        }),
    ]));
});

it.each([
    [
        'that enables saved-login automation instead of the visible handoff',
        (manifest) => {
            manifest.requested.allowInteractiveLogin = false;
            manifest.requested.allowSavedLogin = true;
            manifest.requested.loginMode = 'app-owned-saved-login';
        },
        /INTERACTIVE_LOGIN_REQUEST_CONTRACT_MISMATCH|visible operator handoff/i,
    ],
    [
        'whose first 100% run lacks fresh typed-and-saved identity proof',
        (manifest) => {
            manifest.runs[0].session.loginSessionAttestation = {
                adsSessionReady: true,
                credentialPersistence: 'main_managed',
                credentialSource: 'saved',
                erpSessionReady: true,
                erpSessionReused: true,
                ok: true,
                sessionIdentityVerified: false,
            };
        },
        /INTERACTIVE_LOGIN_FIRST_RUN_TYPED_PROOF_MISSING|typed-and-saved/i,
    ],
    [
        'whose wide run omits its own interactive operator handoff',
        (manifest) => {
            manifest.wideProfile.session.mode = 'existing-authenticated-session';
            delete manifest.wideProfile.session.operatorHandoff;
            manifest.wideProfile.diagnostics.login.outcome = 'existing-authenticated-session';
            delete manifest.wideProfile.diagnostics.login.operatorHandoff;
        },
        /WIDE_INTERACTIVE_LOGIN_HANDOFF_MISSING|own visible operator handoff/i,
    ],
])('rejects schema v9 package UI evidence %s', (_caseName, mutateManifest, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-ui-interactive-contract-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.packageUi);
    mutateManifest(manifest);
    writeJson(paths.packageUi, manifest);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'package-ui',
            ok: false,
            reason: expect.stringMatching(reasonPattern),
        }),
    ]));
});

it('rejects canary JSON that omits its read-only authority database proof', () => {
    const tempDir = makeTempDir('mission-control-readiness-canary-db-proof-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    delete canary.database.authorityProof;
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/authority query contract|authorityProof/i),
        }),
    ]));
});

it('rejects a Store Capsule artifact mutated after the canary manifest was written', () => {
    const tempDir = makeTempDir('mission-control-readiness-artifact-stale-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    fs.appendFileSync(canary.execution.evidence[0].artifactPath, Buffer.from('tampered'));
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'policy-auto-canary',
            ok: false,
            reason: expect.stringMatching(/current artifact SHA-256 does not match/i),
        }),
    ]));
});

it('rejects a canary artifact path redirected outside its deterministic Store Capsule', () => {
    const tempDir = makeTempDir('mission-control-readiness-artifact-outside-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    const outsidePath = path.join(tempDir, 'outside-capsule', 'before.png');
    fs.mkdirSync(path.dirname(outsidePath), { recursive: true });
    fs.copyFileSync(canary.execution.evidence[0].artifactPath, outsidePath);
    canary.execution.evidence[0].artifactPath = outsidePath;
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/deterministic Store Capsule path/i),
        }),
    ]));
});

it('rejects a canary evidence row altered in JSON while the authority DB is unchanged', () => {
    const tempDir = makeTempDir('mission-control-readiness-canary-db-mismatch-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    canary.execution.evidence[1].createdAt = '2026-07-23T01:15:02.000Z';
    writeJson(paths.policyCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'policy-auto-canary',
            ok: false,
            reason: expect.stringMatching(/JSON evidence does not match the authority DB record/i),
        }),
    ]));
});

it.each([
    [
        'a missing MissionGrant',
        (database) => database.prepare('DELETE FROM mission_grants WHERE id = ?').run('grant-manual'),
        /MissionGrant must resolve to exactly one authority DB row/i,
    ],
    [
        'a duplicate MissionGrant',
        (database) => database.exec(`
        CREATE TABLE mission_grants_copy AS SELECT * FROM mission_grants;
        DROP TABLE mission_grants;
        ALTER TABLE mission_grants_copy RENAME TO mission_grants;
        INSERT INTO mission_grants SELECT * FROM mission_grants WHERE id = 'grant-manual';
      `),
        /MissionGrant must resolve to exactly one authority DB row/i,
    ],
    [
        'a duplicate execution job in the selected batch',
        (database) => database.exec(`
        CREATE TABLE ad_execution_jobs_copy AS SELECT * FROM ad_execution_jobs;
        DROP TABLE ad_execution_jobs;
        ALTER TABLE ad_execution_jobs_copy RENAME TO ad_execution_jobs;
        INSERT INTO ad_execution_jobs SELECT * FROM ad_execution_jobs WHERE id = 'job-manual';
      `),
        /single execution job must resolve to exactly one authority DB row/i,
    ],
    [
        'a duplicate policy runtime',
        (database) => database.exec(`
        INSERT INTO policy_runtime SELECT * FROM policy_runtime WHERE store_id = 'store-us-east';
      `),
        /policy runtime must resolve to exactly one authority DB row/i,
    ],
    [
        'a missing Mission authority table',
        (database) => database.exec('DROP TABLE missions;'),
        /no such table: missions/i,
    ],
])('rejects authority snapshots with %s', (_caseName, mutateDatabase, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-authority-exact-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, mutateDatabase);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(reasonPattern),
        }),
    ]));
});

it.each([
    [
        'a deleted approval',
        (database) => database.prepare(`
        DELETE FROM decision_history WHERE decision_id = ?
      `).run('decision-manual'),
    ],
    [
        'a duplicate approval',
        (database) => database.exec(`
        INSERT INTO decision_history
        SELECT * FROM decision_history WHERE decision_id = 'decision-manual';
      `),
    ],
    [
        'an approval forged for another decision revision',
        (database) => database.prepare(`
        UPDATE decision_history SET decision_revision = ?
        WHERE decision_id = ?
      `).run(2, 'decision-manual'),
    ],
])('rejects authority snapshots with %s in decision_history', (_caseName, mutateDatabase) => {
    const tempDir = makeTempDir('mission-control-readiness-decision-approval-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, mutateDatabase);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/decision approval history.*exactly one|missing, duplicated, or not exact/i),
        }),
    ]));
});

it.each([
    [
        'a stale immutable proposal',
        (database) => database.prepare(`
        UPDATE analysis_proposal_snapshots SET created_at = ?
        WHERE id = ?
      `).run('2026-07-19T01:01:10.000Z', 'proposal-manual'),
    ],
    [
        'an approval recorded after the MissionGrant was issued',
        (database) => database.prepare(`
        UPDATE decision_history SET created_at = ?
        WHERE decision_id = ?
      `).run('2026-07-23T01:02:30.000Z', 'decision-manual'),
    ],
])('rejects authorization chain with %s', (_caseName, mutateDatabase) => {
    const tempDir = makeTempDir('mission-control-readiness-authorization-time-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, mutateDatabase);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/authorization\/captured\/terminal.*stale|replayed|out of order/i),
        }),
    ]));
});

it('rejects an authority source whose selected live DB is not named amazon-ai-ops.db', () => {
    const tempDir = makeTempDir('mission-control-readiness-authority-name-');
    const { paths } = passingEvidenceChain(tempDir);
    const renamedSource = path.join(path.dirname(paths.sourceDatabase), 'renamed-authority.db');
    fs.renameSync(paths.sourceDatabase, renamedSource);
    paths.sourceDatabase = renamedSource;
    paths.verificationContext.authorityDbPath = renamedSource;
    const snapshot = readJson(paths.authoritySnapshotManifest);
    snapshot.source.absolutePath = renamedSource;
    snapshot.source.realPath = fs.realpathSync.native(renamedSource);
    writeJson(paths.authoritySnapshotManifest, snapshot);
    refreshAuthoritySnapshotBindings(paths);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/amazon-ai-ops\.db filename/i),
        }),
    ]));
});

it('rejects canary evidence whose DB execution was created in another browser session generation', () => {
    const tempDir = makeTempDir('mission-control-readiness-cross-session-');
    const { paths } = passingEvidenceChain(tempDir);
    mutateAuthoritySnapshot(paths, (database) => {
        database.prepare(`
        UPDATE ad_execution_jobs SET created_session_generation = ?
        WHERE id = ?
      `).run(999, 'job-manual');
    });
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/session generation.*capturedSessionGeneration/i),
        }),
    ]));
});

it('rejects a self-reported storesRoot outside snapshot source USER_DATA_DIR/stores', () => {
    const tempDir = makeTempDir('mission-control-readiness-stores-root-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    canary.storesRoot = path.join(tempDir, 'wrong-stores-root');
    fs.mkdirSync(canary.storesRoot, { recursive: true });
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/canonical USER_DATA_DIR\/stores/i),
        }),
    ]));
});

it('rejects a hash-matching fake screenshot that is not a PNG', () => {
    const tempDir = makeTempDir('mission-control-readiness-fake-png-');
    const { paths } = passingEvidenceChain(tempDir);
    replaceCanaryArtifact(paths, paths.manualCanary, 'before', Buffer.alloc(64, 0x41));
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/PNG signature/i),
        }),
    ]));
});

it('rejects a hash-matching 1x1 PNG thumbnail below the production viewport contract', () => {
    const tempDir = makeTempDir('mission-control-readiness-thumbnail-png-');
    const { paths } = passingEvidenceChain(tempDir);
    replaceCanaryArtifact(paths, paths.policyCanary, 'after', canaryScreenshotBytes(77, { width: 1, height: 1 }));
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'policy-auto-canary',
            ok: false,
            reason: expect.stringMatching(/1x1.*below the 1200x700 evidence minimum/i),
        }),
    ]));
});

it.each([
    [
        'truncated',
        (bytes) => bytes.subarray(0, bytes.length - 5),
        /truncated|extends beyond/i,
    ],
    [
        'bad-CRC',
        (bytes) => {
            const corrupted = Buffer.from(bytes);
            const idatTypeOffset = corrupted.indexOf(Buffer.from('IDAT', 'ascii'));
            corrupted[idatTypeOffset + 4] ^= 0x01;
            return corrupted;
        },
        /IDAT chunk CRC is invalid/i,
    ],
])('rejects a hash-matching %s production-size PNG', (_label, mutate, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-damaged-png-');
    const { paths } = passingEvidenceChain(tempDir);
    replaceCanaryArtifact(paths, paths.manualCanary, 'reload', mutate(canaryScreenshotBytes(88)));
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(reasonPattern),
        }),
    ]));
});

it('rejects a fresh snapshot/export that attempts to wash an execution older than 72 hours', () => {
    const tempDir = makeTempDir('mission-control-readiness-old-execution-');
    const { paths } = passingEvidenceChain(tempDir);
    const snapshot = readJson(paths.authoritySnapshotManifest);
    snapshot.backup.startedAt = '2026-07-27T01:19:59.000Z';
    snapshot.backup.completedAt = '2026-07-27T01:20:00.000Z';
    snapshot.exportedAt = snapshot.backup.completedAt;
    writeJson(paths.authoritySnapshotManifest, snapshot);
    for (const [canaryPath, generatedAt, queryExecutedAt] of [
        [paths.manualCanary, '2026-07-27T01:31:00.000Z', '2026-07-27T01:30:00.000Z'],
        [paths.policyCanary, '2026-07-27T01:33:00.000Z', '2026-07-27T01:32:00.000Z'],
    ]) {
        const canary = readJson(canaryPath);
        canary.generatedAt = generatedAt;
        canary.database.authorityProof.queryExecutedAt = queryExecutedAt;
        writeJson(canaryPath, canary);
    }
    const continuous = readJson(paths.continuousOperation);
    continuous.generatedAt = '2026-07-27T01:21:00.000Z';
    writeJson(paths.continuousOperation, continuous);
    refreshAuthoritySnapshotBindings(paths);
    paths.verificationContext.nowMs = Date.parse('2026-07-27T02:00:00.000Z');
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            reason: expect.stringMatching(/authorization\/captured\/terminal.*stale|replayed/i),
        }),
        expect.objectContaining({
            id: 'policy-auto-canary',
            ok: false,
            reason: expect.stringMatching(/authorization\/captured\/terminal.*stale|replayed/i),
        }),
    ]));
});

it('rejects a continuous-operation outcome altered in the manifest but not in SQLite', () => {
    const tempDir = makeTempDir('mission-control-readiness-continuous-db-mismatch-');
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    continuous.stores[0].days[0].blockerDetail = 'Fabricated replacement blocker detail.';
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 's7-continuous-operation',
            ok: false,
            reason: expect.stringMatching(/canonical stores\/dates\/outcomes do not match/i),
        }),
    ]));
});
});
