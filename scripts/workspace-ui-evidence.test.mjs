import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import evidenceModule from './workspace-ui-evidence.js';

const require = createRequire(import.meta.url);
const { chromium } = require('./playwright-loader.js');

const {
  captureWorkspaceEvidence,
  collectWorkspaceDomMetrics,
  normalizeWorkspaceEvidenceConfig,
  parseWorkspaceEvidenceArgs,
  runWorkspaceEvidenceTargets,
} = evidenceModule;

let browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
}, 60_000);

function validPageMarkup(extra = '') {
  return `
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { font: 14px/21px Arial, sans-serif; }
      .app-shell { width: 100vw; height: 100vh; overflow: hidden; }
      .app-content { height: 100%; overflow-y: auto; overflow-x: hidden; }
      .workspace { min-height: 900px; padding: 16px; }
      .virtual-table { height: 80px; overflow-y: auto; }
      .virtual-table-inner { height: 180px; }
    </style>
    <div class="app-shell">
      <main class="app-content">
        <section class="workspace" data-workspace="today" data-workspace-subview="overview" data-workspace-evidence-root>
          <h1>今日任务</h1>
          <button data-action-priority="primary">处理当前阻塞</button>
          <button data-action-priority="secondary">查看详情</button>
          <button data-action-priority="secondary">切换产品</button>
          <p>当前对象：B0TESTASIN</p>
          <div class="virtual-table" data-scroll-owner="virtual-table">
            <div class="virtual-table-inner">显式虚拟表格滚动例外</div>
          </div>
          ${extra}
        </section>
      </main>
    </div>
  `;
}

async function serveHtml(html) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    url: `http://127.0.0.1:${address.port}/index.html`,
  };
}

async function loadMarkupAtUrl(page, html, url = 'http://workspace-evidence.test/?preview=1&scenario=diagnosis-ready') {
  await page.route('http://workspace-evidence.test/**', async (route) => {
    await route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
  });
  await page.goto(url);
}

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

    expect(normalized.targets.map(({
      dpr,
      readbackMode,
      scenario,
      subview,
      viewport,
      workspace,
    }) => ({ dpr, readbackMode, scenario, subview, viewport, workspace }))).toEqual([
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
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });
});

describe('workspace UI DOM contract', () => {
  it('reads the actual readback preview mode and scenario from the workspace DOM', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    const readbackMarkup = validPageMarkup()
      .replace('data-workspace="today"', 'data-workspace="readback"')
      .replace('data-workspace-subview="overview"', 'data-workspace-subview="evidence"')
      .replace('data-workspace-evidence-root', 'data-workspace-evidence-root data-readback-mode="preview-readonly" data-preview-scenario="delivery-ready"');
    await loadMarkupAtUrl(
      page,
      readbackMarkup,
      'http://workspace-evidence.test/?preview=1&scenario=delivery-ready',
    );

    const metrics = await collectWorkspaceDomMetrics(page);

    expect(metrics.identity).toEqual({
      pageUrl: 'http://workspace-evidence.test/?preview=1&scenario=delivery-ready',
      previewScenario: 'delivery-ready',
      readbackMode: 'preview-readonly',
      scenario: 'delivery-ready',
      scenarioSource: 'dom',
      subview: 'evidence',
      urlScenario: 'delivery-ready',
      workspace: 'readback',
    });

    await context.close();
  });

  it('fails closed when the requested workspace evidence root is missing', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await page.setContent(validPageMarkup().replace(' data-workspace-evidence-root', ''));

    const metrics = await collectWorkspaceDomMetrics(page);

    expect(metrics.contract.passed).toBe(false);
    expect(metrics.contract.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_ROOT_MISSING' }),
    ]));

    await context.close();
  });

  it('accepts one task-first viewport and an explicitly labelled virtual-table scroll exception', async () => {
    const context = await browser.newContext({
      deviceScaleFactor: 1.25,
      viewport: { width: 1200, height: 700 },
    });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validPageMarkup());

    const metrics = await collectWorkspaceDomMetrics(page);

    expect(metrics.viewport).toEqual({ height: 700, width: 1200 });
    expect(metrics.dpr).toBe(1.25);
    expect(metrics.h1.count).toBe(1);
    expect(metrics.actions.primaryVisibleInViewport).toBe(1);
    expect(metrics.actions.secondaryVisibleInViewport).toBe(2);
    expect(metrics.text.minimumFontSizePx).toBeGreaterThanOrEqual(12);
    expect(metrics.details.nestedCount).toBe(0);
    expect(metrics.horizontalOverflow.violations).toEqual([]);
    expect(metrics.scrollOwnership.defaultOwner.selector).toBe('.app-content');
    expect(metrics.scrollOwnership.unlabelledActiveOwners).toEqual([]);
    expect(metrics.contract).toEqual({ passed: true, violations: [] });

    await context.close();
  });

  it('reports every task-first contract breach with stable machine-readable codes', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        html, body { width: 100%; height: 100%; margin: 0; overflow: auto; }
        body { font: 14px Arial; }
        .app-shell { width: 1300px; min-height: 1000px; }
        .app-content { height: 700px; overflow: visible; }
        .workspace { min-height: 900px; }
        .tiny { font-size: 11px; }
        .rogue-scroll { height: 40px; overflow-y: auto; }
        .rogue-scroll > div { height: 120px; }
      </style>
      <div class="app-shell">
        <main class="app-content">
          <section class="workspace" data-workspace-evidence-root>
            <h1>标题一</h1><h1>标题二</h1>
            <button data-action-priority="primary">主动作一</button>
            <button data-action-priority="primary">主动作二</button>
            <button data-action-priority="secondary">次动作一</button>
            <button data-action-priority="secondary">次动作二</button>
            <button data-action-priority="secondary">次动作三</button>
            <p class="tiny">过小文字</p>
            <details open><summary>外层</summary><details><summary>内层</summary></details></details>
            <div class="rogue-scroll"><div>未标记的内部滚动</div></div>
          </section>
        </main>
      </div>
    `);

    const metrics = await collectWorkspaceDomMetrics(page);
    const codes = metrics.contract.violations.map((violation) => violation.code);
    const activeOwnerSelectors = metrics.scrollOwnership.activeOwners.map((owner) => owner.selector);

    expect(codes).toEqual(expect.arrayContaining([
      'H1_COUNT',
      'PRIMARY_ACTION_COUNT',
      'SECONDARY_ACTION_COUNT',
      'TEXT_BELOW_12PX',
      'NESTED_DETAILS',
      'HORIZONTAL_OVERFLOW',
      'DEFAULT_SCROLL_OWNER',
      'UNLABELLED_SCROLL_OWNER',
    ]));
    expect(new Set(activeOwnerSelectors).size).toBe(activeOwnerSelectors.length);
    expect(metrics.contract.passed).toBe(false);

    await context.close();
  });
});

describe('workspace UI screenshot evidence', () => {
  it('rejects readback capture when the DOM readback mode is not preview-readonly', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-readback-dom-mode-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    const readbackMarkup = validPageMarkup()
      .replace('data-workspace="today"', 'data-workspace="readback"')
      .replace('data-workspace-subview="overview"', 'data-workspace-subview="evidence"')
      .replace('data-workspace-evidence-root', 'data-workspace-evidence-root data-readback-mode="production" data-preview-scenario="delivery-ready"');
    await loadMarkupAtUrl(
      page,
      readbackMarkup,
      'http://workspace-evidence.test/?preview=1&scenario=delivery-ready',
    );

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
    } finally {
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
    await loadMarkupAtUrl(
      page,
      readbackMarkup,
      'http://workspace-evidence.test/?preview=1&scenario=delivery-ready',
    );

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
    } finally {
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
    } finally {
      await context.close();
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it('rejects capture when the actual page URL scenario does not match the target identity', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-scenario-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(
      page,
      validPageMarkup(),
      'http://workspace-evidence.test/?preview=1&scenario=missing-scope',
    );

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
    } finally {
      await context.close();
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it('rejects capture when the actual page URL drops explicit preview mode', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-workspace-preview-drift-'));
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(
      page,
      validPageMarkup(),
      'http://workspace-evidence.test/?scenario=diagnosis-ready',
    );

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
    } finally {
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
    } finally {
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
    } finally {
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
            if (!navigated) throw new Error('target root was awaited before navigation');
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
    } finally {
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
    } finally {
      await server.close();
      rmSync(outputDir, { force: true, recursive: true });
    }
  });
});
