// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { describe, expect, fs, it, os, path } from './v15-ready-test-environment.mjs';
import { bundlePackageIndex, finalPackageIndex, packageLaunchSmokeFromIndex, writeBundleReadme } from './v15-ready-test-packages.mjs';
import { writeValidReadbackWithDb } from './v15-ready-test-readback.mjs';
import { runNode, writeJson } from './v15-ready-test-artifacts.mjs';
describe('verify v15 ready safety', () => {
it('rejects APP_READY evidence when the delivery bundle package index file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-missing-package-file-'));
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
            count: 1,
            existingCount: 1,
            missingCount: 0,
            bundleJson: 'evidence/real-report-file-index.json',
        },
        packageIndex: {
            present: true,
            count: 2,
            existingCount: 2,
            missingCount: 0,
            bundleJson: 'evidence/release-package-index.json',
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
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle package index file is valid');
});

it('rejects APP_READY evidence when final readiness package hashes do not match local files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-package-hash-mismatch-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);
    packageIndex.packages[0].sha256 = 'C'.repeat(64);
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
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness records package hash evidence');
});
});
