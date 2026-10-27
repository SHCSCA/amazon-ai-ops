// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { bundleRoot, createValidAdReadbackEvidence, describe, evidenceDir, expect, fs, it, os, path, writeAdReadbackAuthorityDb } from './v15-non-ready-test-environment.mjs';
import { writeStrictNonReadyFixture } from './v15-non-ready-test-fixture.mjs';
import { finalPackageIndex, runNode, validPackageLaunchSmoke, writeJson, writeReadme, writeValidReadbackWithDb } from './v15-non-ready-test-artifacts.mjs';
describe('verify v15 non-ready safety', () => {
it('ignores newer smoke final-readiness files when selecting default evidence', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-non-ready-smoke-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-01.json');
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-smoke-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-default-smoke-'));
    const packageSmoke = path.join(fixtureDir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(fixtureDir, 'package-ui-manifest.json');
    const packageSecurityEvidence = path.join(fixtureDir, 'package-security-boundaries.json');
    try {
        const fixture = writeStrictNonReadyFixture({
            artifactDir: fixtureDir,
            evidenceManifest,
            finalReadiness,
            packageSmoke,
            packageUiManifest,
            packageSecurityEvidence,
            bundleManifest,
            readme,
        });
        writeJson(smokeReadiness, {
            status: 'APP_READY',
            appReady: true,
            evidenceSelection: { mode: 'smoke' },
            gates: [],
        });
        const result = runNode('scripts/verify-v15-non-ready-safety.js', [
            '--package-launch-smoke', packageSmoke,
            '--package-ui-manifest', packageUiManifest,
            '--package-security-evidence', packageSecurityEvidence,
            '--package-adversarial-node-env-evidence', fixture.packageAdversarialNodeEnvEvidence,
            '--readme', readme,
        ]);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('NON_READY_SAFETY verified');
    }
    finally {
        for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
            if (fs.existsSync(filePath))
                fs.rmSync(filePath, { force: true });
        }
        if (fs.existsSync(bundleDir))
            fs.rmSync(bundleDir, { recursive: true, force: true });
        if (fs.existsSync(fixtureDir))
            fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

it('selects timestamp-named final-readiness evidence by default without selecting smoke artifacts', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-timestamp-default-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, `final-readiness-${runId}.json`);
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-timestamp-default-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-timestamp-default-'));
    const packageSmoke = path.join(fixtureDir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(fixtureDir, 'package-ui-manifest.json');
    const packageSecurityEvidence = path.join(fixtureDir, 'package-security-boundaries.json');
    try {
        const fixture = writeStrictNonReadyFixture({
            artifactDir: fixtureDir,
            evidenceManifest,
            finalReadiness,
            packageSmoke,
            packageUiManifest,
            packageSecurityEvidence,
            bundleManifest,
            readme,
        });
        writeJson(smokeReadiness, {
            status: 'APP_READY',
            appReady: true,
            evidenceSelection: { mode: 'smoke' },
            gates: [],
        });
        const result = runNode('scripts/verify-v15-non-ready-safety.js', [
            '--package-launch-smoke', packageSmoke,
            '--package-ui-manifest', packageUiManifest,
            '--package-security-evidence', packageSecurityEvidence,
            '--package-adversarial-node-env-evidence', fixture.packageAdversarialNodeEnvEvidence,
            '--readme', readme,
        ]);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('final readiness remains APP_NEEDS_WORK with appReady=false');
        expect(result.stdout).toContain('NON_READY_SAFETY verified');
    }
    finally {
        for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
            if (fs.existsSync(filePath))
                fs.rmSync(filePath, { force: true });
        }
        if (fs.existsSync(bundleDir))
            fs.rmSync(bundleDir, { recursive: true, force: true });
        if (fs.existsSync(fixtureDir))
            fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

it('treats default historical APP_READY evidence as baseline only when README is IN_PROGRESS', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-02.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-history-authority-'));
    try {
        writeReadme(readme);
        const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
        writeJson(evidenceManifest, {
            kind: 'v15-final-readiness-evidence-manifest',
            evidence: {
                adReadback: {
                    exists: true,
                    absolutePath: adReadback,
                },
            },
        });
        writeJson(finalReadiness, {
            status: 'APP_READY',
            appReady: true,
            reportCollectionReady: true,
            listingReadReady: true,
            evidenceSelection: {
                mode: 'manifest',
                manifestPath: evidenceManifest,
                authorityDbPath: dbPath,
            },
            gates: [
                { name: 'AI live provider', ok: true, status: 'passed' },
                { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
                { name: 'Listing AI draft', ok: true, status: 'passed' },
                { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
                { name: 'Release package hash', ok: true, status: 'passed' },
            ],
            packageIndex,
        });
        writeJson(bundleManifest, {
            status: 'APP_READY',
            appReady: true,
            warning: 'APP_READY evidence bundle.',
        });
        const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('historical APP_READY final readiness is baseline only');
        expect(result.stdout).toContain('historical APP_READY delivery bundle is baseline only');
        expect(result.stdout).toContain('README top-level delivery line is non-ready');
        const otherDbPath = writeAdReadbackAuthorityDb(path.join(fixtureDir, 'other-authority-db'), JSON.parse(fs.readFileSync(adReadback, 'utf8')));
        const mismatch = runNode('scripts/verify-v15-non-ready-safety.js', [
            '--final-readiness', finalReadiness,
            '--bundle-manifest', bundleManifest,
            '--readme', readme,
            '--db', otherDbPath,
        ]);
        expect(mismatch.status).not.toBe(0);
        expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
    }
    finally {
        for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
            if (fs.existsSync(filePath))
                fs.rmSync(filePath, { force: true });
        }
        if (fs.existsSync(bundleDir))
            fs.rmSync(bundleDir, { recursive: true, force: true });
        if (fs.existsSync(fixtureDir))
            fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

it('rejects historical APP_READY baseline when package hash evidence is missing', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-no-package-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-05.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-no-package-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-no-package-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-no-package-authority-'));
    try {
        writeReadme(readme);
        const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
        writeJson(evidenceManifest, {
            kind: 'v15-final-readiness-evidence-manifest',
            evidence: {
                adReadback: {
                    exists: true,
                    absolutePath: adReadback,
                },
            },
        });
        writeJson(finalReadiness, {
            status: 'APP_READY',
            appReady: true,
            reportCollectionReady: true,
            listingReadReady: true,
            evidenceSelection: {
                mode: 'manifest',
                manifestPath: evidenceManifest,
                authorityDbPath: dbPath,
            },
            gates: [
                { name: 'AI live provider', ok: true, status: 'passed' },
                { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
                { name: 'Listing AI draft', ok: true, status: 'passed' },
                { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
            ],
        });
        writeJson(bundleManifest, {
            status: 'APP_READY',
            appReady: true,
            warning: 'APP_READY evidence bundle.',
        });
        const result = runNode('scripts/verify-v15-non-ready-safety.js', [
            '--final-readiness', finalReadiness,
            '--bundle-manifest', bundleManifest,
            '--package-launch-smoke', path.join(path.dirname(finalReadiness), 'missing-package-launch-smoke.json'),
            '--readme', readme,
        ]);
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
        expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
    }
    finally {
        for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
            if (fs.existsSync(filePath))
                fs.rmSync(filePath, { force: true });
        }
        if (fs.existsSync(bundleDir))
            fs.rmSync(bundleDir, { recursive: true, force: true });
        if (fs.existsSync(fixtureDir))
            fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

it('accepts a historical APP_READY baseline when current package launch smoke supersedes stale package hashes', () => {
    const runId = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-package-smoke-'));
    const evidenceManifest = path.join(dir, `v15-final-readiness-evidence-manifest-package-smoke-${runId}.json`);
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const packageSmoke = path.join(dir, 'package-launch-smoke.json');
    const adReadback = path.join(dir, `real-ad-execution-readback-package-smoke-${runId}.json`);
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = writeReadme(path.join(dir, 'README.md'));
    try {
        const dbPath = writeValidReadbackWithDb(dir, adReadback);
        writeJson(packageSmoke, validPackageLaunchSmoke(path.join(dir, 'release')));
        writeJson(evidenceManifest, {
            kind: 'v15-final-readiness-evidence-manifest',
            evidence: {
                adReadback: {
                    exists: true,
                    absolutePath: adReadback,
                },
            },
        });
        writeJson(finalReadiness, {
            status: 'APP_READY',
            appReady: true,
            reportCollectionReady: true,
            listingReadReady: true,
            evidenceSelection: {
                mode: 'manifest',
                manifestPath: evidenceManifest,
                authorityDbPath: dbPath,
            },
            gates: [
                { name: 'AI live provider', ok: true, status: 'passed' },
                { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
                { name: 'Listing AI draft', ok: true, status: 'passed' },
                { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
                { name: 'Release package hash', ok: true, status: 'passed' },
            ],
            packageIndex: {
                present: true,
                count: 1,
                existingCount: 1,
                missingCount: 0,
                packages: [
                    {
                        kind: 'installer',
                        sourcePath: path.join(dir, 'old-installer.exe'),
                        fileName: 'old-installer.exe',
                        exists: true,
                        sizeBytes: 123,
                        sha256: '0'.repeat(64),
                    },
                ],
            },
        });
        writeJson(bundleManifest, {
            status: 'APP_READY',
            appReady: true,
            warning: 'APP_READY evidence bundle.',
        });
        const result = runNode('scripts/verify-v15-non-ready-safety.js', [
            '--final-readiness', finalReadiness,
            '--bundle-manifest', bundleManifest,
            '--package-launch-smoke', packageSmoke,
            '--readme', readme,
        ]);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
        expect(result.stdout).toContain('NON_READY_SAFETY verified');
    }
    finally {
        if (fs.existsSync(dir))
            fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('rejects historical APP_READY baseline when old readback evidence lacks current source report authority', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-legacy-readback-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-04.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-legacy-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-legacy-readback-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-legacy-authority-'));
    try {
        writeReadme(readme);
        const legacyReadback = createValidAdReadbackEvidence(fixtureDir);
        const dbPath = writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), legacyReadback);
        delete legacyReadback.source.sourceFiles;
        delete legacyReadback.source.sourceRow;
        writeJson(adReadback, legacyReadback);
        writeJson(evidenceManifest, {
            kind: 'v15-final-readiness-evidence-manifest',
            evidence: {
                adReadback: {
                    exists: true,
                    absolutePath: adReadback,
                },
            },
        });
        writeJson(finalReadiness, {
            status: 'APP_READY',
            appReady: true,
            reportCollectionReady: true,
            listingReadReady: true,
            evidenceSelection: {
                mode: 'manifest',
                manifestPath: evidenceManifest,
                authorityDbPath: dbPath,
            },
            gates: [
                { name: 'AI live provider', ok: true, status: 'passed' },
                { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
                { name: 'Listing AI draft', ok: true, status: 'passed' },
                { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
                { name: 'Release package hash', ok: true, status: 'passed' },
            ],
            packageIndex,
        });
        writeJson(bundleManifest, {
            status: 'APP_READY',
            appReady: true,
            warning: 'APP_READY evidence bundle.',
        });
        const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
        expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    }
    finally {
        for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
            if (fs.existsSync(filePath))
                fs.rmSync(filePath, { force: true });
        }
        if (fs.existsSync(bundleDir))
            fs.rmSync(bundleDir, { recursive: true, force: true });
        if (fs.existsSync(fixtureDir))
            fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});

it('rejects historical APP_READY baseline when selected readback evidence fails verify:ad-readback', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-bad-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-03.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-bad-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-bad-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-bad-authority-'));
    try {
        writeReadme(readme);
        const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
        writeJson(adReadback, { kind: 'real-ad-execution-readback', status: 'PASS', readback: { verified: true } });
        writeJson(evidenceManifest, {
            kind: 'v15-final-readiness-evidence-manifest',
            evidence: {
                adReadback: {
                    exists: true,
                    absolutePath: adReadback,
                },
            },
        });
        writeJson(finalReadiness, {
            status: 'APP_READY',
            appReady: true,
            reportCollectionReady: true,
            listingReadReady: true,
            evidenceSelection: {
                mode: 'manifest',
                manifestPath: evidenceManifest,
                authorityDbPath: dbPath,
            },
            gates: [
                { name: 'AI live provider', ok: true, status: 'passed' },
                { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
                { name: 'Listing AI draft', ok: true, status: 'passed' },
                { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
                { name: 'Release package hash', ok: true, status: 'passed' },
            ],
            packageIndex,
        });
        writeJson(bundleManifest, {
            status: 'APP_READY',
            appReady: true,
            warning: 'APP_READY evidence bundle.',
        });
        const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    }
    finally {
        for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
            if (fs.existsSync(filePath))
                fs.rmSync(filePath, { force: true });
        }
        if (fs.existsSync(bundleDir))
            fs.rmSync(bundleDir, { recursive: true, force: true });
        if (fs.existsSync(fixtureDir))
            fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
});
});
