// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { bundleAdversarialNodeEnvEvidence, describe, expect, fs, it, os, path, writeAdReadbackAuthorityDb, writeValidAdversarialNodeEnvEvidence } from './v15-ready-test-environment.mjs';
import { bundlePackageIndex, bundlePackageSecurityEvidence, bundlePackageUiEvidence, finalPackageIndex, packageLaunchSmokeFromIndex, writeBundleReadme, writePackageSecurityEvidence, writePackageUiEvidence } from './v15-ready-test-packages.mjs';
import { writeValidReadbackWithDb } from './v15-ready-test-readback.mjs';
import { readJson, runNode, writeJson } from './v15-ready-test-artifacts.mjs';
describe('verify v15 ready safety', () => {
it('accepts current UI smoke with explicit package security evidence and rejects its omission', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);
    const packageLaunchSmoke = packageLaunchSmokeFromIndex(dir, packageIndex);
    const packageUiManifest = writePackageUiEvidence(dir, packageLaunchSmoke);
    const packageSecurityEvidence = writePackageSecurityEvidence(dir, packageLaunchSmoke);
    const packageAdversarialNodeEnvEvidence = path.join(dir, 'package-adversarial-node-env.json');
    const adversarialFixture = writeValidAdversarialNodeEnvEvidence(packageAdversarialNodeEnvEvidence, {
        executableSha256: packageLaunchSmoke.artifacts.unpacked.sha256,
        appContentSha256: 'B'.repeat(64),
        mainBundleSha256: 'C'.repeat(64),
        rendererEntryPath: path.join(dir, 'win-unpacked', 'resources', 'app', 'dist', 'renderer', 'index.html'),
    });
    const bundledPackageUi = bundlePackageUiEvidence(bundleManifest, packageUiManifest);
    const bundledPackageSecurity = bundlePackageSecurityEvidence(bundleManifest, packageSecurityEvidence);
    const bundledAdversarial = bundleAdversarialNodeEnvEvidence(bundleManifest, packageAdversarialNodeEnvEvidence);
    const dbPath = writeValidReadbackWithDb(dir, adReadback);
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
            adReadback: {
                exists: true,
                absolutePath: adReadback,
            },
            packageAdversarialNodeEnv: adversarialFixture.manifestEntry,
        },
    });
    writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
            authorityDbPath: dbPath,
        },
        gates: [
            { name: 'Report collection', ok: true },
            { name: 'AI live provider', ok: true },
            { name: 'Real ad execution readback', ok: true },
            { name: 'Release package hash', ok: true, status: 'passed' },
            { name: 'Package launch smoke', ok: true, status: 'passed' },
        ],
        packageIndex,
        packageLaunchSmoke,
        packageAdversarialNodeEnv: adversarialFixture.selection,
    });
    writeJson(smoke, {
        kind: 'current-business-ui-smoke-summary',
        passed: true,
        scripts: [
            { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
            { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
            { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
            { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
            { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
        ],
    });
    writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        authorityDatabase: {
            sourcePath: dbPath,
            copied: false,
        },
        files: [
            { label: 'scripts/verify-v15-ready-safety.js' },
            bundledPackageUi.file,
            bundledPackageSecurity.file,
            bundledAdversarial.file,
        ],
        dataReconciliation: {
            present: true,
            bundleJson: 'evidence/data.json',
            bundleMarkdown: 'evidence/data.md',
            canonicalSource: 'user_search_term',
            canonical: { spend: 617.87 },
            blockers: [],
        },
        realReportIndex: {
            present: true,
            count: 1,
            existingCount: 1,
            missingCount: 0,
            bundleJson: 'evidence/real-report-file-index.json',
        },
        packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
        uiEvidence: bundledPackageUi.manifest,
        securityEvidence: {
            ...bundledPackageSecurity.manifest,
            packageAdversarialNodeEnvSmoke: bundledAdversarial.summary,
        },
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');
    const result = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', packageAdversarialNodeEnvEvidence,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('current business UI smoke summary passed');
    expect(result.stdout).toContain('V15_READY_SAFETY verified');
    expect(result.stderr).not.toContain('UI smoke contains APP_READY state');
    const completeLaunchEvidence = readJson(packageLaunchSmoke.evidencePath);
    const missingRuntimeProof = structuredClone(completeLaunchEvidence);
    delete missingRuntimeProof.checks.find((check) => check.kind === 'portable').runtimeProcess;
    writeJson(packageLaunchSmoke.evidencePath, missingRuntimeProof);
    const invalidLaunch = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', packageAdversarialNodeEnvEvidence,
    ]);
    expect(invalidLaunch.status).not.toBe(0);
    expect(`${invalidLaunch.stdout}${invalidLaunch.stderr}`)
        .toContain('final readiness records valid package launch smoke evidence');
    writeJson(packageLaunchSmoke.evidencePath, completeLaunchEvidence);
    const currentFinalReadiness = readJson(finalReadiness);
    const legacyFinalReadiness = { ...currentFinalReadiness };
    delete legacyFinalReadiness.packageAdversarialNodeEnv;
    writeJson(finalReadiness, legacyFinalReadiness);
    const downgradedContract = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
    ]);
    expect(downgradedContract.status).not.toBe(0);
    expect(`${downgradedContract.stdout}${downgradedContract.stderr}`)
        .toContain('current READY safety requires package-adversarial-node-env/v1');
    writeJson(finalReadiness, {
        ...currentFinalReadiness,
        packageAdversarialNodeEnv: {
            ...currentFinalReadiness.packageAdversarialNodeEnv,
            contractVersion: 'package-adversarial-node-env/v0',
        },
    });
    const mismatchedVersion = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', packageAdversarialNodeEnvEvidence,
    ]);
    expect(mismatchedVersion.status).not.toBe(0);
    expect(`${mismatchedVersion.stdout}${mismatchedVersion.stderr}`)
        .toContain('current READY safety requires package-adversarial-node-env/v1');
    writeJson(finalReadiness, currentFinalReadiness);
    const otherDbPath = writeAdReadbackAuthorityDb(path.join(dir, 'other-authority-db'), readJson(adReadback));
    const mismatch = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', otherDbPath,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', packageAdversarialNodeEnvEvidence,
    ]);
    expect(mismatch.status).not.toBe(0);
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
    const missingPackageSecurity = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--package-ui-manifest', packageUiManifest,
        '--package-adversarial-node-env-evidence', packageAdversarialNodeEnvEvidence,
    ]);
    expect(missingPackageSecurity.status).not.toBe(0);
    expect(`${missingPackageSecurity.stdout}${missingPackageSecurity.stderr}`)
        .toContain('READY safety requires explicit passing package security evidence');
    const detachedSecurity = readJson(packageSecurityEvidence);
    detachedSecurity.package.mainBundleSha256 = 'D'.repeat(64);
    writeJson(packageSecurityEvidence, detachedSecurity);
    const reboundSecurity = bundlePackageSecurityEvidence(bundleManifest, packageSecurityEvidence);
    const detachedBundle = readJson(bundleManifest);
    detachedBundle.files = detachedBundle.files.map((file) => (file.sourcePath === packageSecurityEvidence ? reboundSecurity.file : file));
    detachedBundle.securityEvidence = reboundSecurity.manifest;
    writeJson(bundleManifest, detachedBundle);
    const detachedMainBundle = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', packageAdversarialNodeEnvEvidence,
    ]);
    expect(detachedMainBundle.status).not.toBe(0);
    expect(`${detachedMainBundle.stdout}${detachedMainBundle.stderr}`)
        .toContain('EXE/app-content/main-bundle hash-bound');
    const restoredSecurity = readJson(packageSecurityEvidence);
    restoredSecurity.package.mainBundleSha256 = 'C'.repeat(64);
    writeJson(packageSecurityEvidence, restoredSecurity);
    const restoredBundledSecurity = bundlePackageSecurityEvidence(bundleManifest, packageSecurityEvidence);
    const stalePackageUi = readJson(packageUiManifest);
    stalePackageUi.artifactsAfter.appContent = {
        ...stalePackageUi.artifactsAfter.appContent,
        sha256: 'E'.repeat(64),
    };
    writeJson(packageUiManifest, stalePackageUi);
    const reboundPackageUi = bundlePackageUiEvidence(bundleManifest, packageUiManifest);
    const staleBundle = readJson(bundleManifest);
    staleBundle.files = staleBundle.files.map((file) => {
        if (file.sourcePath === packageSecurityEvidence)
            return restoredBundledSecurity.file;
        if (file.sourcePath === packageUiManifest)
            return reboundPackageUi.file;
        return file;
    });
    staleBundle.securityEvidence = restoredBundledSecurity.manifest;
    staleBundle.uiEvidence = reboundPackageUi.manifest;
    writeJson(bundleManifest, staleBundle);
    const staleAppContent = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--package-ui-manifest', packageUiManifest,
        '--package-security-evidence', packageSecurityEvidence,
        '--package-adversarial-node-env-evidence', packageAdversarialNodeEnvEvidence,
    ]);
    expect(staleAppContent.status).not.toBe(0);
    expect(`${staleAppContent.stdout}${staleAppContent.stderr}`)
        .toContain('package UI evidence is schema-valid, fully passing, EXE/app-content/main-bundle hash-bound');
});

it('rejects APP_READY evidence when the delivery bundle README still says IN_PROGRESS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-bundle-readme-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);
    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
        },
        gates: [
            { name: 'Report collection', ok: true },
            { name: 'AI live provider', ok: true },
            { name: 'Real ad execution readback', ok: true },
            { name: 'Release package hash', ok: true, status: 'passed' },
            { name: 'Package launch smoke', ok: true, status: 'passed' },
        ],
        packageIndex,
        packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
        kind: 'current-business-ui-smoke-summary',
        passed: true,
        scripts: [
            { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
            { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
            { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
            { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
            { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
        ],
    });
    writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        files: [{ label: 'scripts/verify-v15-ready-safety.js' }, { label: 'README.md', bundlePath: 'docs/README.md' }],
        dataReconciliation: {
            present: true,
            bundleJson: 'evidence/data.json',
            bundleMarkdown: 'evidence/data.md',
            canonicalSource: 'user_search_term',
            canonical: { spend: 617.87 },
            blockers: [],
        },
        realReportIndex: {
            present: true,
            count: 1,
            existingCount: 1,
            missingCount: 0,
            bundleJson: 'evidence/real-report-file-index.json',
        },
        packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'IN_PROGRESS');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');
    const result = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', dbPath,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle README states APP_READY');
});

it('rejects APP_READY evidence when the selected readback file does not pass the readback verifier', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-bad-readback-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);
    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
            authorityDbPath: dbPath,
        },
        gates: [
            { name: 'Report collection', ok: true },
            { name: 'AI live provider', ok: true },
            { name: 'Real ad execution readback', ok: true },
            { name: 'Release package hash', ok: true, status: 'passed' },
            { name: 'Package launch smoke', ok: true, status: 'passed' },
        ],
        packageIndex,
        packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
        kind: 'current-business-ui-smoke-summary',
        passed: true,
        scripts: [
            { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
            { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
            { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
            { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
            { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
        ],
    });
    writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
        dataReconciliation: {
            present: true,
            bundleJson: 'evidence/data.json',
            bundleMarkdown: 'evidence/data.md',
            canonicalSource: 'user_search_term',
            canonical: { spend: 617.87 },
            blockers: [],
        },
        realReportIndex: {
            present: true,
            count: 1,
            existingCount: 1,
            missingCount: 0,
            bundleJson: 'evidence/real-report-file-index.json',
        },
        packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');
    const result = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', dbPath,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('selected ad readback evidence passes verify:ad-readback');
});

it('rejects APP_READY evidence when the delivery bundle real report index has missing source files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-missing-report-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);
    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
        },
        gates: [
            { name: 'Report collection', ok: true },
            { name: 'AI live provider', ok: true },
            { name: 'Real ad execution readback', ok: true },
            { name: 'Release package hash', ok: true, status: 'passed' },
            { name: 'Package launch smoke', ok: true, status: 'passed' },
        ],
        packageIndex,
        packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
        kind: 'current-business-ui-smoke-summary',
        passed: true,
        scripts: [
            { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
            { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
            { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
            { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
            { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
        ],
    });
    writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
        dataReconciliation: {
            present: true,
            bundleJson: 'evidence/data.json',
            bundleMarkdown: 'evidence/data.md',
            canonicalSource: 'user_search_term',
            canonical: { spend: 617.87 },
            blockers: [],
        },
        realReportIndex: {
            present: true,
            count: 2,
            existingCount: 1,
            missingCount: 1,
            bundleJson: 'evidence/real-report-file-index.json',
        },
        packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');
    const result = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', dbPath,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle real report index has no missing source reports');
});

it('rejects APP_READY evidence when package hash evidence is missing from readiness and bundle manifests', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-missing-package-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
        },
        gates: [
            { name: 'Report collection', ok: true },
            { name: 'AI live provider', ok: true },
            { name: 'Real ad execution readback', ok: true },
            { name: 'Release package hash', ok: true, status: 'passed' },
            { name: 'Package launch smoke', ok: true, status: 'passed' },
        ],
    });
    writeJson(smoke, {
        kind: 'current-business-ui-smoke-summary',
        passed: true,
        scripts: [
            { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
            { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
            { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
            { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
            { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
        ],
    });
    writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
        dataReconciliation: {
            present: true,
            bundleJson: 'evidence/data.json',
            bundleMarkdown: 'evidence/data.md',
            canonicalSource: 'user_search_term',
            canonical: { spend: 617.87 },
            blockers: [],
        },
        realReportIndex: {
            present: true,
            count: 1,
            existingCount: 1,
            missingCount: 0,
            bundleJson: 'evidence/real-report-file-index.json',
        },
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');
    const result = runNode('scripts/verify-v15-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--ui-smoke', smoke,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', dbPath,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness records package hash evidence');
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle includes package hash index');
});
});
