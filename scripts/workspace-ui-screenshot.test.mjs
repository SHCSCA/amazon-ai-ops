// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { browser, captureWorkspaceEvidence, createHash, describe, existsSync, expect, it, join, mkdtempSync, readFileSync, readdirSync, rmSync, runWorkspaceEvidenceTargets, tmpdir, writeFileSync } from './workspace-ui-test-environment.mjs';
import { loadMarkupAtUrl, serveHtml, validExperiencePageMarkup, validPageMarkup } from './workspace-ui-test-markup.mjs';
describe('workspace UI screenshot evidence', () => {
it('rejects readback capture when the DOM readback mode is not preview-readonly', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-readback-dom-mode-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    const readbackMarkup = validPageMarkup()
        .replace('data-workspace="today"', 'data-workspace="readback"')
        .replace('data-workspace-subview="overview"', 'data-workspace-subview="evidence"')
        .replace('data-workspace-evidence-root', 'data-workspace-evidence-root data-readback-mode="production" data-preview-scenario="delivery-ready"');
    await loadMarkupAtUrl(page, readbackMarkup, 'http://workspace-evidence.test/?preview=1&scenario=delivery-ready');
    try {
        await expect(captureWorkspaceEvidence({
            outputDir,
            page,
            target: {
                dpr: 1,
                readbackMode: 'preview-readonly',
                scenario: 'delivery-ready',
                subview: 'evidence',
                viewport: { height: 700, width: 1200 },
                workspace: 'readback',
            },
        })).rejects.toThrow(/readback mode.*production.*preview-readonly/i);
    }
    finally {
        await context.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('rejects readback capture when the DOM preview scenario disagrees with the matching URL query', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-readback-dom-scenario-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    const readbackMarkup = validPageMarkup()
        .replace('data-workspace="today"', 'data-workspace="readback"')
        .replace('data-workspace-subview="overview"', 'data-workspace-subview="evidence"')
        .replace('data-workspace-evidence-root', 'data-workspace-evidence-root data-readback-mode="preview-readonly" data-preview-scenario="missing-readback-evidence"');
    await loadMarkupAtUrl(page, readbackMarkup, 'http://workspace-evidence.test/?preview=1&scenario=delivery-ready');
    try {
        await expect(captureWorkspaceEvidence({
            outputDir,
            page,
            target: {
                dpr: 1,
                readbackMode: 'preview-readonly',
                scenario: 'delivery-ready',
                subview: 'evidence',
                viewport: { height: 700, width: 1200 },
                workspace: 'readback',
            },
        })).rejects.toThrow(/preview scenario.*missing-readback-evidence.*delivery-ready/i);
    }
    finally {
        await context.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('rejects capture when the actual workspace and subview do not match the target identity', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-identity-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    const driftedMarkup = validPageMarkup()
        .replace('data-workspace="today"', 'data-workspace="decisions"')
        .replace('data-workspace-subview="overview"', 'data-workspace-subview="pending"');
    await loadMarkupAtUrl(page, driftedMarkup);
    try {
        await expect(captureWorkspaceEvidence({
            outputDir,
            page,
            target: {
                dpr: 1,
                scenario: 'diagnosis-ready',
                subview: 'overview',
                viewport: { height: 700, width: 1200 },
                workspace: 'today',
            },
        })).rejects.toThrow(/workspace.*decisions.*today.*subview.*pending.*overview/i);
    }
    finally {
        await context.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('rejects capture when the actual page URL scenario does not match the target identity', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-scenario-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validPageMarkup(), 'http://workspace-evidence.test/?preview=1&scenario=missing-scope');
    try {
        await expect(captureWorkspaceEvidence({
            outputDir,
            page,
            target: {
                dpr: 1,
                scenario: 'diagnosis-ready',
                subview: 'overview',
                viewport: { height: 700, width: 1200 },
                workspace: 'today',
            },
        })).rejects.toThrow(/scenario.*missing-scope.*diagnosis-ready/i);
    }
    finally {
        await context.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('rejects capture when the actual page URL drops explicit preview mode', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-preview-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validPageMarkup(), 'http://workspace-evidence.test/?scenario=diagnosis-ready');
    try {
        await expect(captureWorkspaceEvidence({
            outputDir,
            page,
            target: {
                dpr: 1,
                scenario: 'diagnosis-ready',
                subview: 'overview',
                viewport: { height: 700, width: 1200 },
                workspace: 'today',
            },
        })).rejects.toThrow(/must explicitly include preview=1/i);
    }
    finally {
        await context.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('writes matching PNG/JSON evidence with identity, runtime metrics and SHA-256', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-evidence-'));
    const context = await browser.newContext({
        deviceScaleFactor: 1.25,
        viewport: { width: 1200, height: 700 },
    });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validPageMarkup());
    try {
        const result = await captureWorkspaceEvidence({
            outputDir,
            page,
            target: {
                dpr: 1.25,
                scenario: 'diagnosis-ready',
                subview: 'overview',
                viewport: { height: 700, width: 1200 },
                workspace: 'today',
            },
            timestamp: new Date('2026-07-13T08:09:10.123Z'),
        });
        expect(existsSync(result.screenshotPath)).toBe(true);
        expect(existsSync(result.jsonPath)).toBe(true);
        const screenshotBytes = readFileSync(result.screenshotPath);
        const expectedHash = createHash('sha256').update(screenshotBytes).digest('hex').toUpperCase();
        const saved = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
        expect(saved).toMatchObject({
            capturedAt: '2026-07-13T08:09:10.123Z',
            dpr: 1.25,
            kind: 'workspace-ui-runtime-evidence',
            scenario: 'diagnosis-ready',
            schemaVersion: 'workspace-ui-evidence/v1',
            subview: 'overview',
            viewport: { height: 700, width: 1200 },
            workspace: 'today',
        });
        expect(saved.domMetrics.contract.passed).toBe(true);
        expect(saved.domMetrics.experience).toEqual({ enabled: false });
        expect(saved.domMetrics.identity).toEqual({
            pageUrl: 'http://workspace-evidence.test/?preview=1&scenario=diagnosis-ready',
            previewScenario: null,
            readbackMode: null,
            scenario: 'diagnosis-ready',
            scenarioSource: 'url',
            subview: 'overview',
            urlScenario: 'diagnosis-ready',
            workspace: 'today',
        });
        expect(saved.screenshot.sha256).toBe(expectedHash);
        expect(saved.screenshot.fullPage).toBe(false);
        expect(result.evidence).toEqual(saved);
    }
    finally {
        await context.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('applies and persists a target experience contract during capture', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-experience-evidence-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validExperiencePageMarkup());
    try {
        const result = await captureWorkspaceEvidence({
            outputDir,
            page,
            target: {
                dpr: 1,
                experienceContract: {
                    maxPageOverflowPx: 24,
                    maxPageOverflowRatio: 1.05,
                    maxPageScrollLeakPx: 1,
                    maxRenderedRows: 30,
                    maxStickyHeaderOffsetPx: 2,
                    maxWorkSurfaceTopPx: 300,
                    minAriaRowCount: 100,
                    minFullyVisibleRows: 5,
                    minQueueViewportHeightPx: 360,
                    scrollProbeRatio: 0.5,
                },
                scenario: 'diagnosis-ready',
                subview: 'products',
                viewport: { height: 700, width: 1200 },
                workspace: 'product',
            },
        });
        const saved = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
        expect(saved.domMetrics.experience.enabled).toBe(true);
        expect(saved.domMetrics.experience.contract).toMatchObject({
            maxRenderedRows: 30,
            maxWorkSurfaceTopPx: 300,
            minFullyVisibleRows: 5,
            minQueueViewportHeightPx: 360,
        });
        expect(saved.domMetrics.experience.probe.scrollTop).toBeGreaterThan(0);
        expect(saved.domMetrics.contract).toEqual({ passed: true, violations: [] });
    }
    finally {
        await context.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('runs an explicit target matrix, dispatches structured navigation and writes a pass/fail manifest', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-run-'));
    const server = await serveHtml(`
      ${validPageMarkup()}
      <script>
        window.addEventListener('amazon-ai-ops:navigate', (event) => {
          document.querySelector('h1').textContent = event.detail.workspace + '/' + event.detail.subview;
        });
      </script>
    `);
    try {
        const result = await runWorkspaceEvidenceTargets({
            browser,
            generatedAt: new Date('2026-07-13T08:10:00.000Z'),
            outputDir,
            targets: [{
                    dpr: 1.25,
                    scenario: 'diagnosis-ready',
                    settleMs: 20,
                    subview: 'overview',
                    url: `${server.url}?preview=1&scenario=diagnosis-ready`,
                    viewport: { height: 700, width: 1200 },
                    workspace: 'today',
                }],
        });
        expect(result.passed).toBe(true);
        expect(existsSync(result.manifestPath)).toBe(true);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].evidence.domMetrics.h1.labels).toEqual(['today/overview']);
        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
        expect(manifest).toMatchObject({
            generatedAt: '2026-07-13T08:10:00.000Z',
            kind: 'workspace-ui-evidence-run',
            passed: true,
            schemaVersion: 'workspace-ui-evidence-run/v1',
            targets: [{
                    contractPassed: true,
                    dpr: 1.25,
                    scenario: 'diagnosis-ready',
                    subview: 'overview',
                    viewport: { height: 700, width: 1200 },
                    workspace: 'today',
                }],
        });
    }
    finally {
        await server.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('dispatches target navigation before waiting for the target-only evidence root', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-wait-order-'));
    const url = 'http://workspace-evidence.test/?preview=1&scenario=delivery-ready';
    const calls = [];
    let navigated = false;
    const page = {
        evaluate: async (_callback, input) => {
            if (input?.workspace === 'readback' && input?.subview === 'evidence') {
                calls.push('navigate');
                navigated = true;
                return undefined;
            }
            calls.push('metrics');
            return {
                contract: { passed: true, violations: [] },
                dpr: 1,
                identity: {
                    pageUrl: url,
                    previewScenario: 'delivery-ready',
                    readbackMode: 'preview-readonly',
                    scenario: 'delivery-ready',
                    scenarioSource: 'dom',
                    subview: 'evidence',
                    urlScenario: 'delivery-ready',
                    workspace: 'readback',
                },
                viewport: { height: 700, width: 1200 },
            };
        },
        goto: async () => calls.push('goto'),
        locator: () => ({
            first: () => ({
                waitFor: async () => {
                    calls.push('wait-for-root');
                    if (!navigated)
                        throw new Error('target root was awaited before navigation');
                },
            }),
        }),
        screenshot: async ({ path }) => writeFileSync(path, 'fake-png'),
        url: () => url,
        waitForTimeout: async () => calls.push('settle'),
    };
    const fakeBrowser = {
        newContext: async () => ({
            close: async () => calls.push('close'),
            newPage: async () => page,
        }),
    };
    try {
        const result = await runWorkspaceEvidenceTargets({
            browser: fakeBrowser,
            generatedAt: new Date('2026-07-13T08:10:01.000Z'),
            outputDir,
            targets: [{
                    dpr: 1,
                    readbackMode: 'preview-readonly',
                    scenario: 'delivery-ready',
                    settleMs: 0,
                    subview: 'evidence',
                    url,
                    viewport: { height: 700, width: 1200 },
                    waitFor: '[data-workspace-evidence-root][data-preview-scenario="delivery-ready"]',
                    workspace: 'readback',
                }],
        });
        expect(result.passed).toBe(true);
        expect(calls).toEqual(['goto', 'navigate', 'wait-for-root', 'settle', 'metrics', 'close']);
    }
    finally {
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('keeps the run manifest failed when navigation never adopts the requested DOM identity', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-run-drift-'));
    const driftedMarkup = validPageMarkup()
        .replace('data-workspace="today"', 'data-workspace="decisions"')
        .replace('data-workspace-subview="overview"', 'data-workspace-subview="pending"');
    const server = await serveHtml(`
      ${driftedMarkup}
      <script>
        window.addEventListener('amazon-ai-ops:navigate', (event) => {
          document.querySelector('h1').textContent = event.detail.workspace + '/' + event.detail.subview;
        });
      </script>
    `);
    try {
        const result = await runWorkspaceEvidenceTargets({
            browser,
            generatedAt: new Date('2026-07-13T08:11:00.000Z'),
            outputDir,
            targets: [{
                    dpr: 1,
                    scenario: 'diagnosis-ready',
                    settleMs: 20,
                    subview: 'overview',
                    url: `${server.url}?preview=1&scenario=diagnosis-ready`,
                    viewport: { height: 700, width: 1200 },
                    workspace: 'today',
                }],
        });
        expect(result.passed).toBe(false);
        expect(result.results[0]).toMatchObject({
            error: expect.stringMatching(/workspace.*decisions.*today.*subview.*pending.*overview/i),
        });
        expect(result.manifest.targets).toEqual([
            expect.objectContaining({
                contractPassed: false,
                error: expect.stringMatching(/workspace.*decisions.*today.*subview.*pending.*overview/i),
                scenario: 'diagnosis-ready',
                subview: 'overview',
                workspace: 'today',
            }),
        ]);
        expect(readdirSync(outputDir).filter((name) => name.endsWith('.png'))).toEqual([]);
        expect(readdirSync(outputDir).filter((name) => name.endsWith('.json'))).toEqual([
            'workspace-ui-evidence-run-2026-07-13T08-11-00-000Z.json',
        ]);
    }
    finally {
        await server.close();
        rmSync(outputDir, { force: true, recursive: true });
    }
});
});
