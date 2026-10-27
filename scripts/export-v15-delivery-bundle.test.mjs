// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { cleanupPaths, describe, evidenceDir, expect, fs, it, path, writeAdReadbackAuthorityDb, writeValidPackageLaunchSmoke } from './v15-export-test-environment.mjs';
import { writeNonReadyFinalReadiness } from './v15-export-test-security.mjs';
import { runNode } from './v15-export-test-commands.mjs';
import { packageIndexFromArtifacts, sha256Text, writeJson, writeReadme, writeReleaseFile, writeReport } from './v15-export-test-artifacts.mjs';
import { writeAuthorityDbForInvalidReadback, writeValidReadbackWithDb } from './v15-export-test-readback.mjs';
import { writeValidPackageUiBundleManifest } from './v15-export-test-ui.mjs';
describe('export v15 delivery bundle', () => {
it('refuses to re-export legacy final readiness without adversarial NODE_ENV contract evidence', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-legacy-adversarial-contract-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ], { currentAdversarialContract: false });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`)
        .toContain('current adversarial NODE_ENV package evidence contract');
});

it('refuses to export a bundle when selected package launch evidence loses a required proof field', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-launch-contract-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const launchPath = path.join(runDir, 'package-launch-smoke.json');
    const launch = writeValidPackageLaunchSmoke(runDir, {
        evidencePath: launchPath,
        generatedAt: new Date().toISOString(),
    });
    delete launch.checks.find((check) => check.kind === 'portable').windowReadyEvidence;
    writeJson(launchPath, launch);
    const final = JSON.parse(fs.readFileSync(finalReadiness, 'utf8'));
    final.packageLaunchSmoke = {
        present: true,
        evidencePath: launchPath,
        passed: true,
        checks: launch.checks,
        artifacts: launch.artifacts,
    };
    final.gates.push({
        id: 'package-launch-smoke',
        name: 'Package launch smoke',
        ok: true,
        status: 'passed',
        evidencePath: launchPath,
    });
    writeJson(finalReadiness, final);
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--readme', writeReadme(path.join(runDir, 'README.md'), 'IN_PROGRESS'),
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', path.join(runDir, 'bundle'),
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Package launch strict contract failed.*PACKAGE_LAUNCH_WINDOW_READY_INVALID/s);
});

it('copies the validated package launch marker artifacts into a non-ready bundle', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-launch-artifacts-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const launchPath = path.join(runDir, 'package-launch-smoke.json');
    const launch = writeValidPackageLaunchSmoke(runDir, {
        evidencePath: launchPath,
        generatedAt: new Date().toISOString(),
    });
    const final = JSON.parse(fs.readFileSync(finalReadiness, 'utf8'));
    final.packageLaunchSmoke = {
        present: true,
        evidencePath: launchPath,
        passed: true,
        checks: launch.checks,
        artifacts: launch.artifacts,
    };
    final.gates.push({
        id: 'package-launch-smoke',
        name: 'Package launch smoke',
        ok: true,
        status: 'passed',
        evidencePath: launchPath,
    });
    writeJson(finalReadiness, final);
    const outDir = path.join(runDir, 'bundle');
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--readme', writeReadme(path.join(runDir, 'README.md'), 'IN_PROGRESS'),
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    const expectedArtifacts = launch.checks.flatMap((check) => [
        check.userDataEvidence.markerPath,
        check.windowReadyEvidence.markerPath,
    ]);
    expect(manifest.files).toEqual(expect.arrayContaining(expectedArtifacts.map((sourcePath) => expect.objectContaining({ sourcePath }))));
});

it('refuses APP_READY bundle export when manifest-selected readback evidence fails verify:ad-readback', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-readback-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const badReadback = path.join(runDir, 'real-ad-execution-readback-bad.json');
    const outDir = path.join(runDir, 'bundle');
    const dbPath = writeAuthorityDbForInvalidReadback(runDir);
    writeJson(badReadback, {
        kind: 'real-ad-execution-readback',
        status: 'PASS',
        readback: { verified: true },
    });
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
            adReadback: {
                exists: true,
                absolutePath: badReadback,
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
            { name: 'Real ad execution readback', ok: true, evidencePath: badReadback },
        ],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('verify:ad-readback');
});

it('refuses APP_READY bundle export when data reconciliation references missing real report files', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-missing-report-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const installerContent = 'installer artifact for missing report test\n';
    const portableContent = 'portable artifact for missing report test\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const packageUiScreenshot = path.join(runDir, 'package-ui.png');
    const workspaceUiScreenshot = path.join(runDir, 'workspace-ui.png');
    const workspaceTargetJson = path.join(runDir, 'workspace-target.json');
    fs.writeFileSync(packageUiScreenshot, 'package ui screenshot');
    fs.writeFileSync(workspaceUiScreenshot, 'workspace ui screenshot');
    writeJson(workspaceTargetJson, { passed: true });
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir, packageUiScreenshot);
    writeJson(workspaceUiManifest, {
        passed: true,
        targets: [{
                screenshot: { path: workspaceUiScreenshot },
                jsonPath: workspaceTargetJson,
            }],
    });
    const releasePackageIndex = packageIndexFromArtifacts([
        { kind: 'installer', filePath: installerPath, content: installerContent },
        { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);
    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
            adReadback: {
                exists: true,
                absolutePath: readback,
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
            { name: 'Real ad execution readback', ok: true, evidencePath: readback },
            { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
        blockers: [],
        reportFiles: [
            {
                reportType: 'user_search_term',
                filePath: path.join(runDir, 'missing-user-search-term.xlsx'),
            },
        ],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--release-dir', releaseDir,
        '--readme', readyReadme,
        '--package-ui-manifest', packageUiManifest,
        '--workspace-ui-manifest', workspaceUiManifest,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('real report index has missing source reports');
});

it('refuses APP_READY bundle export when data reconciliation reports blockers', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-data-blocker-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
            adReadback: {
                exists: true,
                absolutePath: readback,
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
            { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        ],
    });
    writeJson(dataReconciliation, {
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
        blockers: ['user_search_term report is missing required metric columns: spend, orders, sales.'],
        reportFiles: [
            {
                reportType: 'user_search_term',
                filePath: reportPath,
            },
        ],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--readme', readyReadme,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('data reconciliation has blockers');
});

it('refuses APP_READY bundle export when data reconciliation has no positive canonical ad spend', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-zero-spend-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
            adReadback: {
                exists: true,
                absolutePath: readback,
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
            { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        ],
    });
    writeJson(dataReconciliation, {
        canonicalSource: 'user_search_term',
        canonical: { spend: 0, orders: 0, sales: 0 },
        blockers: [],
        reportFiles: [
            {
                reportType: 'user_search_term',
                filePath: reportPath,
            },
        ],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--readme', readyReadme,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('positive canonical ad spend');
});

it('records installer and portable exe hashes in APP_READY delivery bundle without copying binaries', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-package-index-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for package index\n';
    const portableContent = 'portable artifact for package index\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const packageUiScreenshot = path.join(runDir, 'package-ui.png');
    const workspaceUiScreenshot = path.join(runDir, 'workspace-ui.png');
    const workspaceTargetJson = path.join(runDir, 'workspace-target.json');
    fs.writeFileSync(packageUiScreenshot, 'package ui screenshot');
    fs.writeFileSync(workspaceUiScreenshot, 'workspace ui screenshot');
    writeJson(workspaceTargetJson, { passed: true });
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir, packageUiScreenshot);
    writeJson(workspaceUiManifest, {
        passed: true,
        targets: [{
                screenshot: { path: workspaceUiScreenshot },
                jsonPath: workspaceTargetJson,
            }],
    });
    const releasePackageIndex = packageIndexFromArtifacts([
        { kind: 'installer', filePath: installerPath, content: installerContent },
        { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);
    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
            adReadback: {
                exists: true,
                absolutePath: readback,
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
            { name: 'Real ad execution readback', ok: true, evidencePath: readback },
            { name: 'Release package hash', ok: true, status: 'passed', evidencePath: releaseDir },
        ],
        packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
        blockers: [],
        reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--release-dir', releaseDir,
        '--readme', readyReadme,
        '--package-ui-manifest', packageUiManifest,
        '--workspace-ui-manifest', workspaceUiManifest,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.packageIndex).toMatchObject({
        present: true,
        count: 2,
        existingCount: 2,
        missingCount: 0,
        copyPolicy: expect.stringContaining('not copied'),
    });
    expect(manifest.missing).not.toContainEqual({
        label: 'evidence:release',
        sourcePath: releaseDir,
    });
    expect(manifest.packageIndex.bundleJson).toBeTruthy();
    expect(manifest.authorityDatabase).toMatchObject({
        sourcePath: fs.realpathSync.native(dbPath),
        existsAtExport: true,
        copied: false,
    });
    const packageIndex = JSON.parse(fs.readFileSync(path.join(outDir, manifest.packageIndex.bundleJson), 'utf8'));
    expect(packageIndex.packages).toEqual(expect.arrayContaining([
        expect.objectContaining({
            kind: 'installer',
            sourcePath: installerPath,
            sha256: sha256Text(installerContent),
        }),
        expect.objectContaining({
            kind: 'portable',
            sourcePath: portablePath,
            sha256: sha256Text(portableContent),
        }),
    ]));
    for (const file of manifest.files) {
        expect(file.bundlePath).not.toMatch(/\.exe$/i);
        expect(file.bundlePath).not.toMatch(/\.db$/i);
    }
    const bundledReadme = fs.readFileSync(path.join(outDir, 'docs', 'README.md'), 'utf8');
    expect(bundledReadme).toContain('**DELIVERY: APP_READY.');
    expect(manifest.files).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'AGENTS.md' }),
    ]));
    expect(fs.existsSync(path.join(outDir, 'docs', 'AGENTS.md'))).toBe(false);
    expect(manifest.uiEvidence).toMatchObject({
        packageUiManifest: { sourcePath: packageUiManifest, present: true },
        workspaceUiManifest: { sourcePath: workspaceUiManifest, present: true },
    });
    expect(manifest.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourcePath: packageUiManifest }),
        expect.objectContaining({ sourcePath: JSON.parse(fs.readFileSync(packageUiManifest, 'utf8')).runs[0].screenshots[0].path }),
        expect.objectContaining({ sourcePath: workspaceUiManifest }),
        expect.objectContaining({ sourcePath: workspaceUiScreenshot }),
        expect.objectContaining({ sourcePath: workspaceTargetJson }),
    ]));
    const otherDbPath = writeAdReadbackAuthorityDb(path.join(runDir, 'other-authority-db'), JSON.parse(fs.readFileSync(readback, 'utf8')));
    const mismatch = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--db', otherDbPath,
        '--skip-latest-extras', 'true',
        '--out', path.join(runDir, 'mismatch-bundle'),
    ]);
    expect(mismatch.status).not.toBe(0);
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
});

it('does not treat basename text or UI smoke mock source files as real report index entries', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-report-index-noise-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const uiSmoke = path.join(runDir, `business-ui-ad-execution-smoke-${runId}.json`);
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for report-index noise test\n';
    const portableContent = 'portable artifact for report-index noise test\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const releasePackageIndex = packageIndexFromArtifacts([
        { kind: 'installer', filePath: installerPath, content: installerContent },
        { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);
    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(uiSmoke, {
        kind: 'business-ui-ad-execution-smoke',
        actionLog: [
            {
                input: {
                    decision: {
                        sourceFiles: ['C:/reports/mock-user-search-term.xlsx'],
                        sourceRow: 12,
                    },
                },
            },
        ],
    });
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
            adReadback: {
                exists: true,
                absolutePath: readback,
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
            { name: 'Real ad execution readback', ok: true, evidencePath: readback },
            { name: 'Business UI smoke', ok: true, evidencePath: uiSmoke },
            { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
        blockers: [],
        reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
        filenameDateRangeAnalyses: [
            {
                basename: 'AAO_20260601_20260612_search_term.xlsx',
                analysis: { filename: 'AAO_20260601_20260612_search_term.xlsx' },
            },
        ],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--release-dir', releaseDir,
        '--readme', readyReadme,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.realReportIndex).toMatchObject({
        present: true,
        count: 2,
        existingCount: 2,
        missingCount: 0,
    });
    const realReportIndex = JSON.parse(fs.readFileSync(path.join(outDir, manifest.realReportIndex.bundleJson), 'utf8'));
    const sourcePaths = realReportIndex.reports.map((item) => item.sourcePath);
    expect(sourcePaths).toContain(reportPath);
    expect(sourcePaths).toContain(path.join(runDir, 'keyword.xlsx'));
    expect(sourcePaths).not.toContain(path.resolve('C:/reports/mock-user-search-term.xlsx'));
    expect(sourcePaths).not.toContain(path.resolve('AAO_20260601_20260612_search_term.xlsx'));
});
});
