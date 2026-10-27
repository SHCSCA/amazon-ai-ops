// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { Database, HASH_A, describe, expect, fs, it, path } from './mission-control-readiness-test-environment.mjs';
import { artifact, makeTempDir, readJson, runVerifier, sha256File, writeJson } from './mission-control-readiness-test-artifacts.mjs';
import { passingEvidenceChain, verifierArgs } from './mission-control-readiness-test-chain.mjs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as nodeModule from 'node:module';
describe('Mission Control production readiness CLI', () => {
it('rejects continuous-operation recomputation with a self-reported non-canonical storesRoot', () => {
    const tempDir = makeTempDir('mission-control-readiness-continuous-stores-root-');
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    continuous.storesRoot = path.join(tempDir, 'wrong-continuous-stores-root');
    fs.mkdirSync(continuous.storesRoot, { recursive: true });
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 's7-continuous-operation',
            ok: false,
            reason: expect.stringMatching(/storesRoot.*canonical.*USER_DATA_DIR\/stores/i),
        }),
    ]));
});

it.each([
    ['generatedAt', /generatedAt|validation failed closed/i],
    ['storesRoot', /storesRoot|validation failed closed/i],
])('rejects continuous-operation evidence with required %s deleted', (field, reasonPattern) => {
    const tempDir = makeTempDir(`mission-control-readiness-continuous-missing-${field}-`);
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    delete continuous[field];
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 's7-continuous-operation',
            ok: false,
            reason: expect.stringMatching(reasonPattern),
        }),
    ]));
});

it.each([
    [
        'missing post-staging authority capture',
        (continuous) => { continuous.authorityCurrentness.captures.pop(); },
        /three ordered staging-safe captures/i,
    ],
    [
        'staging-file replay under a different selected path',
        (continuous) => { continuous.publication.outputPath = `${continuous.publication.outputPath}.final`; },
        /atomically published final path/i,
    ],
])('rejects continuous-operation publication proof with %s', (_label, mutate, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-continuous-publication-');
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    mutate(continuous);
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 's7-continuous-operation',
            ok: false,
            reason: expect.stringMatching(reasonPattern),
        }),
    ]));
});

it('rechecks retained Store Capsule files before finalizing APP_READY', () => {
    const tempDir = makeTempDir('mission-control-readiness-store-capsule-toctou-');
    const { paths } = passingEvidenceChain(tempDir);
    const database = new Database(paths.database, { readonly: true, fileMustExist: true });
    const { file_path: reportFilePath } = database.prepare(`
      SELECT file_path
      FROM report_import_file_snapshots
      ORDER BY file_path ASC
      LIMIT 1
    `).get();
    database.close();
    paths.verificationContext.beforeFinalEvidenceRecheck = () => {
        fs.appendFileSync(reportFilePath, 'changed-before-final-readiness-write');
    };
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    const report = readJson(outputPath);
    expect(report).toMatchObject({
        status: 'APP_NEEDS_WORK',
        appReady: false,
        allGatesPass: false,
        summary: { total: 8, passed: 7, failed: 1 },
    });
    expect(report).not.toHaveProperty('_verifiedFileArtifacts');
    expect(report.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 's7-continuous-operation',
            ok: false,
            reason: expect.stringMatching(/Store Capsule TOCTOU.*changed after continuous-operation verification/i),
        }),
    ]));
});

it('leaves a durable APP_NEEDS_WORK publication when the process stops before post-write rechecks', () => {
    const tempDir = makeTempDir('mission-control-readiness-publication-crash-window-');
    const { paths } = passingEvidenceChain(tempDir);
    const outputPath = path.join(tempDir, 'readiness.json');
    paths.verificationContext.afterFailClosedReportWrite = () => {
        expect(readJson(outputPath)).toMatchObject({
            status: 'APP_NEEDS_WORK',
            appReady: false,
            allGatesPass: false,
            publication: {
                state: 'pending-post-write-recheck',
                finalReaderFacing: false,
                readyPublicationAllowed: false,
            },
            gates: expect.arrayContaining([
                expect.objectContaining({
                    id: 'final-publication-recheck',
                    ok: false,
                    status: 'needs_work',
                }),
            ]),
        });
        throw new Error('simulated process termination before post-write rechecks');
    };
    expect(() => runVerifier(verifierArgs(paths, outputPath))).toThrow(/simulated process termination before post-write rechecks/i);
    expect(readJson(outputPath)).toMatchObject({
        status: 'APP_NEEDS_WORK',
        appReady: false,
        allGatesPass: false,
        publication: {
            state: 'pending-post-write-recheck',
            finalReaderFacing: false,
            readyPublicationAllowed: false,
        },
    });
});

it('fails only the corresponding canary gate when beforeFinalEvidenceRecheck swaps a PNG for identical bytes under a new file identity', () => {
    const tempDir = makeTempDir('mission-control-readiness-canary-png-toctou-');
    const { paths } = passingEvidenceChain(tempDir);
    const policyCanary = readJson(paths.policyCanary);
    const artifactPath = policyCanary.execution.evidence.find((record) => record.slot === 'after').artifactPath;
    const originalBytes = fs.readFileSync(artifactPath);
    paths.verificationContext.beforeFinalEvidenceRecheck = () => {
        const displacedPath = `${artifactPath}.displaced`;
        fs.renameSync(artifactPath, displacedPath);
        fs.writeFileSync(artifactPath, originalBytes);
    };
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    const report = readJson(outputPath);
    expect(report).toMatchObject({
        status: 'APP_NEEDS_WORK',
        appReady: false,
        allGatesPass: false,
        summary: { total: 8, passed: 7, failed: 1 },
    });
    expect(report.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: true,
        }),
        expect.objectContaining({
            id: 'policy-auto-canary',
            ok: false,
            reason: expect.stringMatching(/Final canary PNG TOCTOU.*path identity, size, hash, dimensions, or strict decoding/i),
        }),
    ]));
    expect(report).not.toHaveProperty('_verifiedCanaryPngArtifacts');
});

it.each([
    ['kind', (canary) => { canary.kind = 'generic-pass'; }, /kind is invalid/],
    ['passed state', (canary) => { canary.passed = false; }, /did not pass/],
    ['US\/USD scope', (canary) => { canary.scope.currency = 'EUR'; }, /must be US\/USD/],
    ['Profile authority binding', (canary) => { canary.authority.browserProfileId = 'foreign-profile'; }, /same store\/Profile/],
    ['reload value', (canary) => { canary.execution.evidence[2].observedBidCents += 1; }, /values are inconsistent/],
])('rejects policy-auto canary evidence with an invalid %s contract', (_label, mutate, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-canary-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    mutate(canary);
    writeJson(paths.policyCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    const report = readJson(outputPath);
    expect(report.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'policy-auto-canary', ok: false, reason: expect.stringMatching(reasonPattern) }),
    ]));
});

it('rejects a seven-date continuous-operation claim that includes a weekend', () => {
    const tempDir = makeTempDir('mission-control-readiness-weekend-');
    const { paths } = passingEvidenceChain(tempDir);
    const continuous = readJson(paths.continuousOperation);
    continuous.window.businessDates[5] = '2026-07-18';
    for (const store of continuous.stores)
        store.days[5].businessDate = '2026-07-18';
    writeJson(paths.continuousOperation, continuous);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 's7-continuous-operation',
            ok: false,
            reason: expect.stringMatching(/weekend or invalid US business date/i),
        }),
    ]));
});

it('does not expose a CLI fixture override that can make a temporary EXE and hand-made SQLite READY', () => {
    const tempDir = makeTempDir('mission-control-readiness-production-anchor-');
    const { paths } = passingEvidenceChain(tempDir);
    const outputPath = path.join(tempDir, 'readiness.json');
    const args = verifierArgs(paths, outputPath);
    delete args.verificationContext;
    const result = runVerifier(args);
    expect(result.status).toBe(1);
    expect(readJson(outputPath)).toMatchObject({ status: 'APP_NEEDS_WORK', appReady: false });
});

it('rejects canonical packaged app content changed after package evidence capture', () => {
    const tempDir = makeTempDir('mission-control-readiness-app-content-tamper-');
    const { paths } = passingEvidenceChain(tempDir);
    fs.appendFileSync(paths.verificationContext.mainBundlePath, '\n// tampered');
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'package-security', ok: false, reason: expect.stringMatching(/canonical|recomputed|mainBundleSha256/i) }),
    ]));
});

it.each([
    ['stale', '2026-07-01T00:00:00.000Z'],
    ['future', '2026-07-24T00:00:00.000Z'],
])('rejects a %s canary manifest replay', (_label, generatedAt) => {
    const tempDir = makeTempDir('mission-control-readiness-canary-replay-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.policyCanary);
    canary.generatedAt = generatedAt;
    writeJson(paths.policyCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'policy-auto-canary', ok: false, reason: expect.stringMatching(/future|stale|order|timestamp/i) }),
    ]));
});

it('rejects operational evidence bound to another package identity', () => {
    const tempDir = makeTempDir('mission-control-readiness-operational-package-');
    const { paths } = passingEvidenceChain(tempDir);
    const canary = readJson(paths.manualCanary);
    canary.packageIdentity.mainBundleSha256 = HASH_A;
    writeJson(paths.manualCanary, canary);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'manual-canary', ok: false, reason: expect.stringMatching(/packageIdentity|current canonical package/i) }),
    ]));
});

it('rejects an authority snapshot manifest that claims a non-canonical hand-made database source', () => {
    const tempDir = makeTempDir('mission-control-readiness-fake-authority-db-');
    const { paths } = passingEvidenceChain(tempDir);
    const fakeSource = path.join(tempDir, 'fake-authority.db');
    fs.copyFileSync(paths.database, fakeSource);
    const manifest = readJson(paths.authoritySnapshotManifest);
    manifest.source.absolutePath = fakeSource;
    manifest.source.realPath = fs.realpathSync.native(fakeSource);
    writeJson(paths.authoritySnapshotManifest, manifest);
    const manifestSha = sha256File(paths.authoritySnapshotManifest);
    for (const evidencePath of [paths.continuousOperation, paths.manualCanary, paths.policyCanary]) {
        const evidence = readJson(evidencePath);
        evidence.database.snapshotManifestSha256 = manifestSha;
        writeJson(evidencePath, evidence);
    }
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).authoritySnapshot.reason).toMatch(/canonical live AppData database|source realpath/i);
});

it('rejects legacy v1 authority snapshot manifests instead of silently applying the old equal-hash contract', () => {
    const tempDir = makeTempDir('mission-control-readiness-authority-v1-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.authoritySnapshotManifest);
    manifest.schemaVersion = 'mission-control-authority-database-snapshot/v1';
    manifest.source.sha256 = manifest.snapshot.sha256;
    writeJson(paths.authoritySnapshotManifest, manifest);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).authoritySnapshot).toEqual(expect.objectContaining({
        ok: false,
        reason: expect.stringMatching(/v2.*v1.*fail-closed/i),
    }));
});

it('rejects an authority snapshot after the canonical live database drifts from artifactAfter', () => {
    const tempDir = makeTempDir('mission-control-readiness-live-authority-drift-');
    const { paths } = passingEvidenceChain(tempDir);
    fs.appendFileSync(paths.sourceDatabase, 'live-database-drift-after-snapshot-export');
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    const report = readJson(outputPath);
    expect(report.authoritySnapshot).toEqual(expect.objectContaining({
        ok: false,
        reason: expect.stringMatching(/live source bytes\/size\/mtime drifted after snapshot export/i),
    }));
    expect(report.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 's7-continuous-operation', ok: false }),
        expect.objectContaining({ id: 'manual-canary', ok: false }),
        expect.objectContaining({ id: 'policy-auto-canary', ok: false }),
    ]));
});

it('rejects an old authority snapshot after a committed WAL-only live change', () => {
    const tempDir = makeTempDir('mission-control-readiness-live-wal-drift-');
    const { paths } = passingEvidenceChain(tempDir);
    const database = new Database(paths.sourceDatabase);
    try {
        database.pragma('wal_autocheckpoint = 0');
        database.pragma('wal_checkpoint(TRUNCATE)');
        const mainBefore = artifact(paths.sourceDatabase);
        const mainMtimeBefore = fs.statSync(paths.sourceDatabase).mtimeMs;
        database.exec(`
        CREATE TABLE authority_currentness_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_currentness_drift VALUES ('grant-1', 1);
      `);
        expect(fs.statSync(`${paths.sourceDatabase}-wal`).size).toBeGreaterThan(0);
        expect(artifact(paths.sourceDatabase)).toEqual(mainBefore);
        expect(fs.statSync(paths.sourceDatabase).mtimeMs).toBe(mainMtimeBefore);
        const outputPath = path.join(tempDir, 'readiness.json');
        expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
        const report = readJson(outputPath);
        expect(report.authoritySnapshot).toEqual(expect.objectContaining({
            ok: false,
            currentness: expect.objectContaining({
                method: 'readonly-sqlite-online-backup',
                passed: false,
            }),
            reason: expect.stringMatching(/online backup does not match the selected authority snapshot/i),
        }));
        expect(report.gates).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 's7-continuous-operation', ok: false }),
            expect.objectContaining({ id: 'manual-canary', ok: false }),
            expect.objectContaining({ id: 'policy-auto-canary', ok: false }),
        ]));
    }
    finally {
        database.close();
    }
});

it('rechecks WAL-aware live authority currentness before the final report write', () => {
    const tempDir = makeTempDir('mission-control-readiness-live-wal-toctou-');
    const { paths } = passingEvidenceChain(tempDir);
    let database;
    paths.verificationContext.beforeFinalEvidenceRecheck = () => {
        database = new Database(paths.sourceDatabase);
        database.pragma('wal_autocheckpoint = 0');
        database.pragma('wal_checkpoint(TRUNCATE)');
        database.exec(`
        CREATE TABLE authority_finalization_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_finalization_drift VALUES ('grant-1', 1);
      `);
    };
    const outputPath = path.join(tempDir, 'readiness.json');
    try {
        expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
        const report = readJson(outputPath);
        expect(report.authoritySnapshot).toEqual(expect.objectContaining({
            ok: false,
            currentness: expect.objectContaining({
                beforeFinalWriteCapturedAt: null,
                passed: false,
            }),
            reason: expect.stringMatching(/before-final-report-write.*failed closed|online backup does not match/i),
        }));
        expect(report.status).toBe('APP_NEEDS_WORK');
    }
    finally {
        if (database)
            database.close();
    }
});

it.each([
    [
        'an incomplete online backup',
        (manifest) => {
            manifest.backup.remainingPages = 1;
            manifest.backup.completed = false;
        },
        /completion|remaining pages/i,
    ],
    [
        'a package identity from another release',
        (manifest) => {
            manifest.packageIdentity.mainBundleSha256 = HASH_A;
        },
        /current canonical package identity/i,
    ],
    [
        'source bytes that changed during the online backup',
        (manifest) => {
            manifest.source.artifactBefore.sha256 = HASH_A;
        },
        /artifactBefore and artifactAfter.*unchanged live database/i,
    ],
])('rejects an authority snapshot manifest with %s', (_label, mutate, reasonPattern) => {
    const tempDir = makeTempDir('mission-control-readiness-authority-contract-');
    const { paths } = passingEvidenceChain(tempDir);
    const manifest = readJson(paths.authoritySnapshotManifest);
    mutate(manifest);
    writeJson(paths.authoritySnapshotManifest, manifest);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).authoritySnapshot.reason).toMatch(reasonPattern);
});

it('rejects changed snapshot bytes and a snapshot that escapes the canonical evidence root', () => {
    const tamperDir = makeTempDir('mission-control-readiness-authority-tamper-');
    const tampered = passingEvidenceChain(tamperDir);
    fs.appendFileSync(tampered.paths.database, 'tampered-after-manifest');
    const tamperOutput = path.join(tamperDir, 'readiness.json');
    expect(runVerifier(verifierArgs(tampered.paths, tamperOutput)).status).toBe(1);
    expect(readJson(tamperOutput).authoritySnapshot.reason).toMatch(/bytes are missing, linked, or stale/i);
    const escapeDir = makeTempDir('mission-control-readiness-authority-escape-');
    const escaped = passingEvidenceChain(escapeDir);
    const escapedDatabase = path.join(escapeDir, 'outside-authority-snapshot.db');
    fs.copyFileSync(escaped.paths.database, escapedDatabase);
    const escapedArtifact = artifact(escapedDatabase);
    const manifest = readJson(escaped.paths.authoritySnapshotManifest);
    manifest.snapshot.absolutePath = escapedDatabase;
    manifest.snapshot.realPath = fs.realpathSync.native(escapedDatabase);
    manifest.snapshot.sha256 = escapedArtifact.sha256;
    manifest.snapshot.sizeBytes = escapedArtifact.sizeBytes;
    writeJson(escaped.paths.authoritySnapshotManifest, manifest);
    const escapeOutput = path.join(escapeDir, 'readiness.json');
    expect(runVerifier(verifierArgs(escaped.paths, escapeOutput)).status).toBe(1);
    expect(readJson(escapeOutput).authoritySnapshot.reason).toMatch(/outside|escapes the canonical snapshot root/i);
});

it('requires the explicit live authority DB selector even when an injected test context knows a DB path', () => {
    const tempDir = makeTempDir('mission-control-readiness-authority-selector-');
    const { paths } = passingEvidenceChain(tempDir);
    const outputPath = path.join(tempDir, 'readiness.json');
    const args = verifierArgs(paths, outputPath);
    const authorityDbIndex = args.indexOf('--authority-db');
    args.splice(authorityDbIndex, 2);
    expect(runVerifier(args).status).toBe(1);
    expect(readJson(outputPath)).toMatchObject({
        inputContractPassed: false,
        inputErrors: expect.arrayContaining([expect.stringMatching(/--authority-db/i)]),
    });
    const selectorReport = readJson(outputPath);
    expect(selectorReport.evidenceSelection.authorityDb).toBeNull();
    expect(selectorReport.authoritySnapshot.currentness.captures).toEqual([]);
    expect(selectorReport.authoritySnapshot.currentness.failures.join('\n')).not.toMatch(/\bobserved [A-F0-9]{64}\/\d+/i);
});

it('rejects a selected evidence JSON with more than one filesystem hard link', () => {
    const tempDir = makeTempDir('mission-control-readiness-hardlink-');
    const { paths } = passingEvidenceChain(tempDir);
    const linkedPath = path.join(tempDir, 'manual-canary-hardlink.json');
    fs.linkSync(paths.manualCanary, linkedPath);
    paths.manualCanary = linkedPath;
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'manual-canary', ok: false, reason: expect.stringMatching(/filesystem link/i) }),
    ]));
});

it('rejects a continuous window whose first business day predates the current package build date', () => {
    const tempDir = makeTempDir('mission-control-readiness-old-window-');
    const { paths } = passingEvidenceChain(tempDir);
    paths.verificationContext.nowMs = Date.parse('2026-07-23T02:00:00.000Z');
    const builtAt = new Date('2026-07-15T00:30:00.000Z');
    const touchTree = (target) => {
        if (fs.statSync(target).isDirectory())
            for (const name of fs.readdirSync(target))
                touchTree(path.join(target, name));
        fs.utimesSync(target, builtAt, builtAt);
    };
    touchTree(paths.verificationContext.releaseRoot);
    const outputPath = path.join(tempDir, 'readiness.json');
    expect(runVerifier(verifierArgs(paths, outputPath)).status).toBe(1);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 's7-continuous-operation', ok: false, reason: expect.stringMatching(/business window predates/i) }),
    ]));
});

it('still writes APP_NEEDS_WORK when one explicitly selected JSON file is malformed', () => {
    const tempDir = makeTempDir('mission-control-readiness-malformed-');
    const { paths } = passingEvidenceChain(tempDir);
    fs.writeFileSync(paths.manualCanary, '{ invalid-json', 'utf8');
    const outputPath = path.join(tempDir, 'readiness.json');
    const result = runVerifier(verifierArgs(paths, outputPath));
    expect(result.status).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(readJson(outputPath).gates).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'manual-canary',
            ok: false,
            status: 'needs_work',
            evidencePath: paths.manualCanary,
            reason: expect.stringMatching(/could not be read/i),
        }),
    ]));
});
});


describe('authority selector admission isolated port', () => {
    function isolatedSelectorContext(mode = 'valid') {
        const ownedRoot = makeTempDir('mission-control-authority-selector-port-');
        const sentinel = path.join(ownedRoot, 'authority-selector-sentinel.db');
        const calls = { resolverModules: 0, resolver: [], filesystem: [] };
        const filesystem = {
            statSync(candidate) {
                calls.filesystem.push(['stat', candidate]);
                return { isFile: () => mode !== 'non-file', nlink: mode === 'multiple-links' ? 2 : 1 };
            },
            lstatSync(candidate) {
                calls.filesystem.push(['lstat', candidate]);
                return { isSymbolicLink: () => mode === 'reparse-point' };
            },
            realpathSync: {
                native(candidate) {
                    calls.filesystem.push(['realpath', candidate]);
                    return mode === 'realpath-alias' ? path.resolve(candidate) + '.redirected' : path.resolve(candidate);
                },
            },
        };
        const sourcePath = path.resolve('scripts/mission-control-production-contracts.js');
        const module = { exports: {} };
        const ports = new Map([['node:fs', filesystem], ['node:crypto', crypto], ['node:path', path], ['node:module', nodeModule]]);
        // 只运行真实模块的选择边界，文件与解析器均由隔离端口接管，禁止打开数据库。
        vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
            module,
            __dirname: path.dirname(sourcePath),
            require(id) {
                if (id === './ad-readback-authority-db') {
                    calls.resolverModules++;
                    return { resolveAdReadbackAuthorityDbPath(selected, environment) {
                        calls.resolver.push({ selected, environment });
                        return mode === 'foreign-resolution' ? sentinel + '.foreign' : sentinel;
                    } };
                }
                if (!ports.has(id)) throw new Error('未允许的选择边界依赖：' + id);
                return ports.get(id);
            },
        }, { filename: sourcePath, timeout: 1000 });
        return { api: module.exports, calls, sentinel };
    }

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['empty', ''],
        ['whitespace', ' \t\r\n '],
    ])('rejects %s before loading the resolver or inspecting any authority path', (_label, selected) => {
        const { api, calls } = isolatedSelectorContext();
        const context = api.defaultProductionContext(selected);
        expect(calls.resolverModules).toBe(0);
        expect(calls.resolver).toEqual([]);
        expect(calls.filesystem).toEqual([]);
        expect(context.authorityDbPath).toBeNull();
        expect(context.authorityDbError).toMatch(/--authority-db/i);
    });

    it('resolves the explicit owned sentinel with an empty fallback environment and retains strict file checks', () => {
        const { api, calls, sentinel } = isolatedSelectorContext();
        const context = api.defaultProductionContext(sentinel);
        expect(calls.resolverModules).toBe(1);
        expect(calls.resolver).toHaveLength(1);
        expect(calls.resolver[0].selected).toBe(sentinel);
        expect(calls.resolver[0].environment).toEqual({});
        expect(context.authorityDbPath).toBe(sentinel);
        expect(context.authorityDbError).toBeNull();
        expect(calls.filesystem.map(([operation]) => operation)).toEqual(['stat', 'realpath', 'lstat']);
    });

    it.each(['relative', 'multiple-links', 'reparse-point', 'non-file', 'realpath-alias', 'foreign-resolution'])(
        'retains the existing %s explicit selector rejection', mode => {
            const { api, calls, sentinel } = isolatedSelectorContext(mode);
            const selected = mode === 'relative' ? path.basename(sentinel) : sentinel;
            const context = api.defaultProductionContext(selected);
            expect(calls.resolver).toHaveLength(1);
            expect(calls.resolver[0].selected).toBe(selected);
            expect(context.authorityDbPath).toBeNull();
            expect(context.authorityDbError).toMatch(/--authority-db.*unique regular live database file/i);
        },
    );
});
