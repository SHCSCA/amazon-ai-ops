// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { browser, describe, expect, it, join, mkdtempSync, normalizeWorkspaceEvidenceConfig, parseWorkspaceEvidenceArgs, readFileSync, rmSync, runWorkspaceEvidenceTargets, spawnSync, tmpdir } from './workspace-ui-test-environment.mjs';
describe('workspace UI evidence CLI contract', () => {
it('exposes a discoverable CLI and a root package target without launching a browser for help', () => {
    const result = spawnSync(process.execPath, ['scripts/run-workspace-ui-evidence.js', '--help'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Workspace UI runtime evidence');
    expect(result.stdout).toContain('--config');
    expect(result.stdout).toContain('--url');
    expect(packageJson.scripts['evidence:workspace-ui']).toBe('node scripts/run-workspace-ui-evidence.js');
});

it('parses an inline target without silently defaulting required business identity', () => {
    expect(parseWorkspaceEvidenceArgs([
        '--url', 'http://127.0.0.1:4173/?preview=1&scenario=diagnosis-ready',
        '--workspace', 'today',
        '--subview', 'overview',
        '--scenario', 'diagnosis-ready',
        '--viewport', '1200x700',
        '--dpr', '1.25',
        '--output', 'output/workspace-ui-evidence',
    ])).toEqual({
        mode: 'inline',
        outputDir: 'output/workspace-ui-evidence',
        target: {
            dpr: 1.25,
            scenario: 'diagnosis-ready',
            subview: 'overview',
            url: 'http://127.0.0.1:4173/?preview=1&scenario=diagnosis-ready',
            viewport: { height: 700, width: 1200 },
            workspace: 'today',
        },
    });
});

it('requires workspace, subview, scenario and URL for inline evidence', () => {
    expect(() => parseWorkspaceEvidenceArgs(['--workspace', 'today']))
        .toThrow(/--url, --workspace, --subview and --scenario/);
});

it('rejects inline evidence whose URL could hydrate a different preview scenario', () => {
    expect(() => parseWorkspaceEvidenceArgs([
        '--url', 'http://127.0.0.1:4173/?preview=1&scenario=missing-scope',
        '--workspace', 'today',
        '--subview', 'overview',
        '--scenario', 'diagnosis-ready',
    ])).toThrow(/URL scenario.*diagnosis-ready/);
});

it('supports a JSON matrix config as a separate explicit mode', () => {
    expect(parseWorkspaceEvidenceArgs(['--config', 'scripts/workspace-evidence.json']))
        .toEqual({ configPath: 'scripts/workspace-evidence.json', mode: 'config' });
});

it('ships the explicit Today viewport and workflow-state matrix used by Task 5A', () => {
    const config = JSON.parse(readFileSync('scripts/workspace-ui-evidence.today.json', 'utf8'));
    const normalized = normalizeWorkspaceEvidenceConfig(config);
    expect(normalized.targets.map(({ dpr, scenario, viewport }) => ({ dpr, scenario, viewport }))).toEqual([
        { dpr: 1, scenario: 'missing-scope', viewport: { height: 700, width: 1200 } },
        { dpr: 1, scenario: 'diagnosis-ready', viewport: { height: 700, width: 1200 } },
        { dpr: 1, scenario: 'diagnosis-ready', viewport: { height: 900, width: 1400 } },
        { dpr: 1.25, scenario: 'diagnosis-ready', viewport: { height: 700, width: 1200 } },
        { dpr: 1, scenario: 'delivery-ready', viewport: { height: 900, width: 1400 } },
    ]);
    expect(new Set(normalized.targets.map((target) => target.scenario))).toEqual(new Set([
        'missing-scope',
        'diagnosis-ready',
        'delivery-ready',
    ]));
});

it('ships the explicit readback preview matrix used by Task 5C', () => {
    const config = JSON.parse(readFileSync('scripts/workspace-ui-evidence.readback.json', 'utf8'));
    const normalized = normalizeWorkspaceEvidenceConfig(config);
    expect(normalized.targets.map(({ dpr, readbackMode, scenario, subview, viewport, workspace, }) => ({ dpr, readbackMode, scenario, subview, viewport, workspace }))).toEqual([
        {
            dpr: 1,
            readbackMode: 'preview-readonly',
            scenario: 'missing-readback-evidence',
            subview: 'evidence',
            viewport: { height: 700, width: 1200 },
            workspace: 'readback',
        },
        {
            dpr: 1,
            readbackMode: 'preview-readonly',
            scenario: 'missing-readback-evidence',
            subview: 'evidence',
            viewport: { height: 900, width: 1400 },
            workspace: 'readback',
        },
        {
            dpr: 1.25,
            readbackMode: 'preview-readonly',
            scenario: 'missing-readback-evidence',
            subview: 'evidence',
            viewport: { height: 700, width: 1200 },
            workspace: 'readback',
        },
        {
            dpr: 1,
            readbackMode: 'preview-readonly',
            scenario: 'delivery-ready',
            subview: 'evidence',
            viewport: { height: 700, width: 1200 },
            workspace: 'readback',
        },
        {
            dpr: 1,
            readbackMode: 'preview-readonly',
            scenario: 'delivery-ready',
            subview: 'evidence',
            viewport: { height: 900, width: 1400 },
            workspace: 'readback',
        },
        {
            dpr: 1.25,
            readbackMode: 'preview-readonly',
            scenario: 'delivery-ready',
            subview: 'evidence',
            viewport: { height: 700, width: 1200 },
            workspace: 'readback',
        },
    ]);
    expect(new Set(normalized.targets.map((target) => target.waitFor))).toEqual(new Set([
        '[data-workspace-evidence-root][data-readback-mode="preview-readonly"][data-preview-scenario]',
    ]));
});

it('enables the object-queue experience contract only for the six Product and Diagnosis ready targets', () => {
    const config = JSON.parse(readFileSync('scripts/workspace-ui-evidence.task6.json', 'utf8'));
    const normalized = normalizeWorkspaceEvidenceConfig(config);
    const contracted = normalized.targets.filter((target) => target.experienceContract);
    expect(contracted.map(({ dpr, subview, viewport, workspace }) => ({ dpr, subview, viewport, workspace }))).toEqual([
        { dpr: 1, subview: 'products', viewport: { height: 700, width: 1200 }, workspace: 'product' },
        { dpr: 1, subview: 'products', viewport: { height: 900, width: 1400 }, workspace: 'product' },
        { dpr: 1.25, subview: 'products', viewport: { height: 700, width: 1200 }, workspace: 'product' },
        { dpr: 1, subview: 'analysis', viewport: { height: 700, width: 1200 }, workspace: 'diagnosis' },
        { dpr: 1, subview: 'analysis', viewport: { height: 900, width: 1400 }, workspace: 'diagnosis' },
        { dpr: 1.25, subview: 'analysis', viewport: { height: 700, width: 1200 }, workspace: 'diagnosis' },
    ]);
    for (const target of contracted) {
        const compact = target.viewport.width === 1200;
        expect(target.experienceContract).toMatchObject({
            maxPageOverflowPx: 24,
            maxPageOverflowRatio: 1.05,
            maxPageScrollLeakPx: 1,
            maxRenderedRows: 30,
            maxStickyHeaderOffsetPx: 2,
            maxWorkSurfaceTopPx: compact ? 300 : 320,
            minAriaRowCount: 100,
            minFullyVisibleRows: compact ? 5 : 8,
            minQueueViewportHeightPx: compact ? 360 : 500,
            scrollProbeRatio: 0.5,
        });
    }
    expect(normalized.targets.filter((target) => !target.experienceContract)).toHaveLength(normalized.targets.length - 6);
});

it('ships the three allowlisted P2-B visual-state targets without expanding the incremental runtime run', () => {
    const focusedConfig = JSON.parse(readFileSync('scripts/workspace-ui-evidence.p2b.json', 'utf8'));
    const focused = normalizeWorkspaceEvidenceConfig(focusedConfig);
    const task6 = normalizeWorkspaceEvidenceConfig(JSON.parse(readFileSync('scripts/workspace-ui-evidence.task6.json', 'utf8')));
    const expected = [
        {
            motionPreference: 'no-preference',
            viewport: { height: 700, width: 1200 },
            visualState: 'workspace-error-retry',
        },
        {
            motionPreference: 'no-preference',
            viewport: { height: 900, width: 1400 },
            visualState: 'diagnosis-ai-running-with-inspector',
        },
        {
            motionPreference: 'reduce',
            viewport: { height: 900, width: 1400 },
            visualState: 'diagnosis-ai-running-with-inspector',
        },
    ];
    expect(focused.targets.map(({ motionPreference, viewport, visualState }) => ({
        motionPreference,
        viewport,
        visualState,
    }))).toEqual(expected);
    expect(task6.targets.slice(-3).map(({ motionPreference, viewport, visualState }) => ({
        motionPreference,
        viewport,
        visualState,
    }))).toEqual(expected);
    expect(focused.targets.every((target) => (target.workspace === 'diagnosis'
        && target.subview === 'analysis'
        && target.scenario === 'diagnosis-ready'))).toBe(true);
});

it.each([
    [{ visualState: 'arbitrary-javascript', motionPreference: 'no-preference' }, 'visualState'],
    [{ visualState: 'workspace-error-retry', motionPreference: 'auto' }, 'motionPreference'],
    [{ visualState: 'diagnosis-ai-running-with-inspector', motionPreference: 'reduce', viewport: '1200x700' }, '1400px'],
])('rejects unsafe or incoherent visual-state targets: %o', (override, expectedMessage) => {
    expect(() => normalizeWorkspaceEvidenceConfig({
        baseUrl: 'http://127.0.0.1:4174/',
        targets: [{
                dpr: 1,
                motionPreference: 'no-preference',
                scenario: 'diagnosis-ready',
                subview: 'analysis',
                viewport: '1400x900',
                visualState: 'workspace-error-retry',
                workspace: 'diagnosis',
                ...override,
            }],
    })).toThrow(new RegExp(expectedMessage, 'i'));
});

it('rejects visual-state injection outside the local development-preview URL', () => {
    expect(() => normalizeWorkspaceEvidenceConfig({
        baseUrl: 'https://example.com/',
        targets: [{
                motionPreference: 'no-preference',
                scenario: 'diagnosis-ready',
                subview: 'analysis',
                viewport: '1200x700',
                visualState: 'workspace-error-retry',
                workspace: 'diagnosis',
            }],
    })).toThrow(/development-preview-only.*local HTTP URL/i);
});

it('normalizes matrix targets onto an explicit development-preview URL', () => {
    const normalized = normalizeWorkspaceEvidenceConfig({
        baseUrl: 'http://127.0.0.1:4173/index.html',
        outputDir: 'output/custom-workspace-evidence',
        targets: [{
                dpr: 1.25,
                scenario: 'diagnosis-ready',
                subview: 'overview',
                viewport: '1200x700',
                workspace: 'today',
            }],
    });
    expect(normalized).toEqual({
        allowContractFail: false,
        outputDir: 'output/custom-workspace-evidence',
        targets: [{
                dpr: 1.25,
                scenario: 'diagnosis-ready',
                subview: 'overview',
                url: 'http://127.0.0.1:4173/index.html?preview=1&scenario=diagnosis-ready',
                viewport: { height: 700, width: 1200 },
                workspace: 'today',
            }],
    });
});

it('normalizes an optional object-queue experience contract without changing legacy targets', () => {
    const normalized = normalizeWorkspaceEvidenceConfig({
        baseUrl: 'http://127.0.0.1:4173/index.html',
        targets: [{
                dpr: 1,
                experienceContract: {
                    maxWorkSurfaceTopPx: 300,
                    minQueueViewportHeightPx: 360,
                    minFullyVisibleRows: 5,
                },
                scenario: 'diagnosis-ready',
                subview: 'products',
                viewport: '1200x700',
                workspace: 'product',
            }, {
                dpr: 1,
                scenario: 'diagnosis-ready',
                subview: 'overview',
                viewport: '1200x700',
                workspace: 'today',
            }],
    });
    expect(normalized.targets[0].experienceContract).toEqual({
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
    });
    expect(normalized.targets[1]).not.toHaveProperty('experienceContract');
});

it.each([
    [{ maxRenderedRows: 0 }, 'maxRenderedRows'],
    [{ scrollProbeRatio: 1 }, 'scrollProbeRatio'],
    [{ maxWorkSurfaceTopPx: '300' }, 'maxWorkSurfaceTopPx'],
    [{ maxVisibleRowsTypo: 5 }, 'maxVisibleRowsTypo'],
])('rejects malformed experience contract fields fail-closed: %o', (experienceContract, field) => {
    expect(() => normalizeWorkspaceEvidenceConfig({
        baseUrl: 'http://127.0.0.1:4173/index.html',
        targets: [{
                experienceContract,
                scenario: 'diagnosis-ready',
                subview: 'products',
                viewport: '1200x700',
                workspace: 'product',
            }],
    })).toThrow(new RegExp(`experienceContract.*${field}|${field}.*experienceContract`, 'i'));
});

it('does not silently replace malformed configured viewport dimensions', () => {
    expect(() => normalizeWorkspaceEvidenceConfig({
        baseUrl: 'http://127.0.0.1:4173/index.html',
        targets: [{
                scenario: 'diagnosis-ready',
                subview: 'overview',
                viewport: { height: 700, width: 0 },
                workspace: 'today',
            }],
    })).toThrow(/target 1.*viewport/i);
});

it('rejects scenario drift for programmatic target runs before browser navigation', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-url-drift-'));
    try {
        await expect(runWorkspaceEvidenceTargets({
            browser,
            outputDir,
            targets: [{
                    dpr: 1,
                    scenario: 'diagnosis-ready',
                    subview: 'overview',
                    url: 'http://127.0.0.1:1/?preview=1&scenario=missing-scope',
                    viewport: { height: 700, width: 1200 },
                    workspace: 'today',
                }],
        })).rejects.toThrow(/URL scenario.*diagnosis-ready/);
    }
    finally {
        rmSync(outputDir, { force: true, recursive: true });
    }
});

it('rejects malformed programmatic experience contracts before browser navigation', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-programmatic-contract-'));
    const fakeBrowser = {
        newContext: async () => {
            throw new Error('browser navigation must not start');
        },
    };
    try {
        await expect(runWorkspaceEvidenceTargets({
            browser: fakeBrowser,
            outputDir,
            targets: [{
                    dpr: 1,
                    experienceContract: { maxRenderedRows: 0 },
                    scenario: 'diagnosis-ready',
                    subview: 'products',
                    url: 'http://127.0.0.1:4173/?preview=1&scenario=diagnosis-ready',
                    viewport: { height: 700, width: 1200 },
                    workspace: 'product',
                }],
        })).rejects.toThrow(/experienceContract.*maxRenderedRows/i);
    }
    finally {
        rmSync(outputDir, { force: true, recursive: true });
    }
});
});
