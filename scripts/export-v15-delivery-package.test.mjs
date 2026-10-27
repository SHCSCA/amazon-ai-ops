// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { bindPackageUiTestManifest, cleanupPaths, describe, evidenceDir, expect, fs, it, path } from './v15-export-test-environment.mjs';
import { hashBoundFile, packageIndexFromArtifacts, writeJson, writePng, writeReadme, writeReleaseFile, writeReport, writeText } from './v15-export-test-artifacts.mjs';
import { writeValidReadbackWithDb } from './v15-export-test-readback.mjs';
import { runNode } from './v15-export-test-commands.mjs';
import { validPackageSecurityEvidence, writeNonReadyFinalReadiness } from './v15-export-test-security.mjs';
import { writeValidPackageUiBundleManifest } from './v15-export-test-ui.mjs';
describe('export v15 delivery bundle', () => {
it('refuses APP_READY bundle export when README delivery line is not APP_READY', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-non-ready-readme-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const nonReadyReadme = writeReadme(path.join(runDir, 'README.md'), 'IN_PROGRESS');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for readme gate\n';
    const portableContent = 'portable artifact for readme gate\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
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
        reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--release-dir', releaseDir,
        '--readme', nonReadyReadme,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('README delivery line is not APP_READY');
});

it('refuses APP_READY bundle export when final readiness lacks package hash gate evidence', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-stale-final-package-gate-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), 'installer artifact\n');
    writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), 'portable artifact\n');
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
        blockers: [],
        reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--release-dir', releaseDir,
        '--readme', readyReadme,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness package hash gate evidence is missing');
});

it('refuses APP_READY bundle export when portable no-install exe hash evidence is missing', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-missing-portable-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact only\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const releasePackageIndex = packageIndexFromArtifacts([
        { kind: 'installer', filePath: installerPath, content: installerContent },
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
        reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--release-dir', releaseDir,
        '--readme', readyReadme,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('portable no-install package hash evidence is missing');
});

it('excludes smoke and test fixture reconciliation files from default discovery', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-reconciliation-discovery-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const releaseDir = path.join(runDir, 'release');
    const productionJson = path.join(evidenceDir, `data-reconciliation-live-${runId}.json`);
    const productionMarkdown = path.join(evidenceDir, `data-reconciliation-live-${runId}.md`);
    const smokeJson = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.json`);
    const smokeMarkdown = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.md`);
    const fixtureJson = path.join(evidenceDir, `data-reconciliation-test-fixture-${runId}.json`);
    const fixtureMarkdown = path.join(evidenceDir, `data-reconciliation-test-fixture-${runId}.md`);
    writeJson(productionJson, {
        canonicalSource: 'current-live-scope',
        canonical: { spend: 125.5 },
        blockers: [],
    });
    writeText(productionMarkdown, '# Current live reconciliation\n');
    writeJson(smokeJson, {
        canonicalSource: 'smoke-fixture',
        canonical: { spend: 999 },
        blockers: [],
    });
    writeText(smokeMarkdown, '# Smoke fixture\n');
    writeJson(fixtureJson, {
        canonicalSource: 'test-fixture',
        canonical: { spend: 888 },
        blockers: [],
    });
    writeText(fixtureMarkdown, '# Test fixture\n');
    const productionTime = new Date('2099-01-01T00:00:00.000Z');
    const smokeTime = new Date('2099-01-02T00:00:00.000Z');
    const fixtureTime = new Date('2099-01-03T00:00:00.000Z');
    for (const filePath of [productionJson, productionMarkdown])
        fs.utimesSync(filePath, productionTime, productionTime);
    for (const filePath of [smokeJson, smokeMarkdown])
        fs.utimesSync(filePath, smokeTime, smokeTime);
    for (const filePath of [fixtureJson, fixtureMarkdown])
        fs.utimesSync(filePath, fixtureTime, fixtureTime);
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--release-dir', releaseDir,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.dataReconciliation).toMatchObject({
        sourceJsonPath: productionJson,
        sourceMarkdownPath: productionMarkdown,
        canonicalSource: 'current-live-scope',
    });
});

it('does not pair an explicit reconciliation JSON with an unrelated latest Markdown', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-explicit-reconciliation-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const releaseDir = path.join(runDir, 'release');
    const explicitJson = path.join(runDir, 'selected-reconciliation.json');
    const unrelatedMarkdown = path.join(evidenceDir, `data-reconciliation-unrelated-${runId}.md`);
    writeJson(explicitJson, {
        canonicalSource: 'explicit-current-scope',
        canonical: { spend: 321.5 },
        blockers: [],
    });
    writeText(unrelatedMarkdown, '# Unrelated latest reconciliation\n');
    const futureTime = new Date('2099-01-04T00:00:00.000Z');
    fs.utimesSync(unrelatedMarkdown, futureTime, futureTime);
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', explicitJson,
        '--release-dir', releaseDir,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.dataReconciliation).toMatchObject({
        sourceJsonPath: explicitJson,
        sourceMarkdownPath: null,
        canonicalSource: 'explicit-current-scope',
        bundleMarkdown: null,
    });
    expect(manifest.files).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ sourcePath: unrelatedMarkdown }),
    ]));
});

it('preserves final-readiness blockers in APP_NEEDS_WORK bundle manifest', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-blocker-summary-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const dbPath = path.join(runDir, 'amazon-ai-ops.db');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(dbPath, 'non-ready-authority-identity-only');
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {},
    });
    writeJson(finalReadiness, {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
            authorityDbPath: dbPath,
        },
        missing: [
            'AI 阶段判断引用的指标证据缺少产品 ASIN。',
        ],
        actionItems: [
            '补齐真实广告报表 sourceFile/sourceRow 后重新生成建议。',
        ],
        recommendationReviewReasons: [
            'AI 候选动作无法绑定当前范围内的真实广告对象。',
        ],
        gates: [
            {
                name: 'Recommendations review blockers',
                ok: false,
                status: 'needs_work',
                message: '当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
            },
        ],
    });
    writeJson(dataReconciliation, {
        canonicalSource: null,
        canonical: null,
        blockers: ['数据对账尚未完成。'],
    });
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--data-reconciliation', dataReconciliation,
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.appReady).toBe(false);
    expect(manifest.authorityDatabase).toMatchObject({
        sourcePath: fs.realpathSync.native(dbPath),
        existsAtExport: true,
        copied: false,
    });
    expect(manifest.finalReadinessBlockers).toEqual(expect.arrayContaining([
        'AI 阶段判断引用的指标证据缺少产品 ASIN。',
        '补齐真实广告报表 sourceFile/sourceRow 后重新生成建议。',
        'AI 候选动作无法绑定当前范围内的真实广告对象。',
        'Recommendations review blockers: 当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
    ]));
});

it('always bundles the manifest selected by final readiness when latest extras are skipped', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-selected-manifest-${runId}`);
    cleanupPaths.push(runDir);
    const { evidenceManifest, finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    const selectedManifestFile = manifest.files.find((file) => file.sourcePath === evidenceManifest);
    expect(selectedManifestFile).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(outDir, selectedManifestFile.bundlePath), 'utf8'))).toMatchObject({
        kind: 'v15-final-readiness-evidence-manifest',
    });
});

it('bundles explicitly selected workspace, source-test, and package-security evidence when latest extras are skipped', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-explicit-source-evidence-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    const businessUiSmoke = path.join(runDir, 'current-business-ui-smoke.json');
    const fullTestEvidence = path.join(runDir, 'full-vitest.json');
    const packageSecurityEvidence = path.join(runDir, 'package-security-boundaries.json');
    const outDir = path.join(runDir, 'bundle');
    writeJson(workspaceUiManifest, { kind: 'workspace-ui-evidence', passed: true, targets: [] });
    writeJson(businessUiSmoke, { kind: 'current-business-ui-smoke-summary', passed: true, scripts: [] });
    writeJson(fullTestEvidence, { kind: 'vitest-json-report', success: true, numPassedTests: 1882 });
    writeJson(packageSecurityEvidence, validPackageSecurityEvidence());
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--workspace-ui-manifest', workspaceUiManifest,
        '--business-ui-smoke', businessUiSmoke,
        '--full-test-evidence', fullTestEvidence,
        '--package-security-evidence', packageSecurityEvidence,
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.uiEvidence.workspaceUiManifest).toMatchObject({ sourcePath: workspaceUiManifest, present: true });
    expect(manifest.sourceEvidence).toMatchObject({
        businessUiSmoke: { sourcePath: businessUiSmoke, present: true },
        fullTestEvidence: { sourcePath: fullTestEvidence, present: true },
    });
    expect(manifest.securityEvidence.packageSecurityBoundaries).toMatchObject({
        sourcePath: packageSecurityEvidence,
        present: true,
    });
    for (const sourcePath of [workspaceUiManifest, businessUiSmoke, fullTestEvidence, packageSecurityEvidence]) {
        const copied = manifest.files.find((file) => file.sourcePath === sourcePath);
        expect(copied).toBeTruthy();
        expect(fs.existsSync(path.join(outDir, copied.bundlePath))).toBe(true);
    }
});

it('bundles regular, read-only subview and wide screenshots referenced by explicit package UI evidence', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-package-ui-wide-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const regularInspector = writePng(path.join(runDir, 'regular-product-inspector.png'));
    const wideWorkspace = writePng(path.join(runDir, 'wide-diagnosis.png'));
    const wideInspector = writePng(path.join(runDir, 'wide-diagnosis-inspector.png'));
    const outDir = path.join(runDir, 'bundle');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir);
    const packageUi = JSON.parse(fs.readFileSync(packageUiManifest, 'utf8'));
    packageUi.runs[0].workspaceChecks[0].inspectorEvidence = {
        screenshot: hashBoundFile(regularInspector),
    };
    packageUi.wideProfile.screenshots[0] = {
        ...packageUi.wideProfile.screenshots[0],
        ...hashBoundFile(wideWorkspace),
    };
    packageUi.wideProfile.workspaceChecks[0].screenshot = packageUi.wideProfile.screenshots[0];
    packageUi.wideProfile.workspaceChecks[0].inspectorEvidence = {
        screenshot: hashBoundFile(wideInspector),
    };
    bindPackageUiTestManifest(packageUi, runDir);
    writeJson(packageUiManifest, packageUi);
    const schedulerSubviews = packageUi.runs.map((run) => run.subviewChecks[0].screenshot.path);
    const minimumScreenshots = packageUi.runs.flatMap((run) => run.minimumWindow?.screenshots || []);
    const schedulerRuntimes = packageUi.runs.map((run) => run.schedulerReadOnlyRuntime);
    const wideSchedulerRuntime = packageUi.wideProfile.schedulerReadOnlyRuntime;
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--package-ui-manifest', packageUiManifest,
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', outDir,
    ]);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    for (const sourcePath of [
        packageUi.runs[0].workspaceChecks[0].inspectorEvidence.screenshot.path,
        ...minimumScreenshots.map((item) => item.path),
        ...schedulerSubviews,
        ...schedulerRuntimes.map((item) => item.artifact.path),
        wideSchedulerRuntime.artifact.path,
        packageUi.wideProfile.screenshots[0].path,
        packageUi.wideProfile.workspaceChecks[0].inspectorEvidence.screenshot.path,
    ]) {
        expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ sourcePath })]));
    }
});

it('refuses schema v9 package UI evidence without the bounded interactive-login attestation', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-package-ui-login-attestation-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir);
    const manifest = JSON.parse(fs.readFileSync(packageUiManifest, 'utf8'));
    delete manifest.runs[0].session.loginSessionAttestation;
    writeJson(packageUiManifest, manifest);
    const result = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--package-ui-manifest', packageUiManifest,
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', path.join(runDir, 'bundle'),
    ]);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/SCALE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED/i);
});

it('refuses legacy or stale scheduler subview package UI evidence before bundle copy', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-package-ui-stale-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    writeValidPackageUiBundleManifest(packageUiManifest, runDir);
    const manifest = JSON.parse(fs.readFileSync(packageUiManifest, 'utf8'));
    fs.appendFileSync(manifest.runs[0].subviewChecks[0].screenshot.path, Buffer.from('tampered'));
    const stale = runNode('scripts/export-v15-delivery-bundle.js', [
        '--final-readiness', finalReadiness,
        '--package-ui-manifest', packageUiManifest,
        '--release-dir', path.join(runDir, 'release'),
        '--skip-latest-extras', 'true',
        '--out', path.join(runDir, 'stale-bundle'),
    ]);
    expect(stale.status).toBe(1);
    expect(`${stale.stdout}${stale.stderr}`).toMatch(/SUBVIEW_SCREENSHOT_MISSING_OR_STALE|settings\/scheduler screenshot/i);
    for (const historicalSchemaVersion of [5, 6, 7]) {
        manifest.schemaVersion = historicalSchemaVersion;
        writeJson(packageUiManifest, manifest);
        const historical = runNode('scripts/export-v15-delivery-bundle.js', [
            '--final-readiness', finalReadiness,
            '--package-ui-manifest', packageUiManifest,
            '--release-dir', path.join(runDir, 'release'),
            '--skip-latest-extras', 'true',
            '--out', path.join(runDir, `historical-v${historicalSchemaVersion}-bundle`),
        ]);
        expect(historical.status).toBe(1);
        expect(`${historical.stdout}${historical.stderr}`).toMatch(/schema v9.*schemas v5\/v6\/v7\/v8 are historical/i);
    }
});
});
