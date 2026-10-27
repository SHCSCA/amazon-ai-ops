// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { browser, collectWorkspaceDomMetrics, describe, expect, it } from './workspace-ui-test-environment.mjs';
import { invalidExperiencePageMarkup, loadMarkupAtUrl, validExperiencePageMarkup, validPageMarkup } from './workspace-ui-test-markup.mjs';
describe('workspace UI DOM contract', () => {
it('reads the actual readback preview mode and scenario from the workspace DOM', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    const readbackMarkup = validPageMarkup()
        .replace('data-workspace="today"', 'data-workspace="readback"')
        .replace('data-workspace-subview="overview"', 'data-workspace-subview="evidence"')
        .replace('data-workspace-evidence-root', 'data-workspace-evidence-root data-readback-mode="preview-readonly" data-preview-scenario="delivery-ready"');
    await loadMarkupAtUrl(page, readbackMarkup, 'http://workspace-evidence.test/?preview=1&scenario=delivery-ready');
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

it('accepts only the responsive inspector body as the second controlled internal scroll owner', async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validPageMarkup(`
      <aside class="responsive-inspector" data-inspector-mode="inline">
        <div class="responsive-inspector__body" style="height: 80px; overflow-y: auto;">
          <div style="height: 220px;">受控检查器内容</div>
        </div>
      </aside>
    `));
    const metrics = await collectWorkspaceDomMetrics(page);
    expect(metrics.scrollOwnership.unlabelledActiveOwners).toEqual([]);
    expect(metrics.scrollOwnership.explicitExceptions.map((owner) => owner.selector)).toEqual([
        '.virtual-table',
        '.responsive-inspector__body',
    ]);
    expect(metrics.contract).toEqual({ passed: true, violations: [] });
    await context.close();
});

it('accepts a compact virtual object queue and records its initial and middle-scroll experience metrics', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validExperiencePageMarkup());
    const metrics = await collectWorkspaceDomMetrics(page, {
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
    });
    expect(metrics.contract).toEqual({ passed: true, violations: [] });
    expect(metrics.experience).toMatchObject({
        enabled: true,
        initial: {
            ariaRowCount: 120,
            fullyVisibleRowCount: 6,
            renderedRowCount: 8,
            rowKeysUnique: true,
        },
        probe: {
            pageScrollLeakPx: 0,
            renderedRowCount: 8,
        },
        queue: {
            overflowY: 'auto',
            scrollOwnerLabel: 'virtual-table',
        },
    });
    expect(metrics.experience.probe.scrollTop).toBeGreaterThan(0);
    expect(metrics.experience.probe.stickyHeaderOffsetPx).toBeLessThanOrEqual(2);
    expect(metrics.experience.probe.restoredScrollTop).toBe(0);
    expect(await page.locator('[data-workspace-queue-scroll]').evaluate((element) => element.scrollTop)).toBe(0);
    await context.close();
});

it('reports every object-queue experience breach with stable machine-readable codes', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, invalidExperiencePageMarkup());
    const metrics = await collectWorkspaceDomMetrics(page, {
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
    });
    const codes = metrics.contract.violations.map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining([
        'WORK_SURFACE_BELOW_FOLD',
        'QUEUE_VIEWPORT_TOO_SHORT',
        'QUEUE_VISIBLE_ROWS',
        'QUEUE_ARIA_ROWCOUNT',
        'QUEUE_RENDERED_ROW_LIMIT',
        'PAGE_VERTICAL_OVERFLOW',
        'QUEUE_SCROLL_OWNER',
        'QUEUE_STICKY_HEADER',
        'QUEUE_SCROLL_LEAK',
        'QUEUE_ROW_KEY_UNIQUE',
    ]));
    expect(metrics.contract.passed).toBe(false);
    await context.close();
});

it('fails when virtual row keys become duplicated after the middle-scroll probe', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validExperiencePageMarkup(`
      <script>
        document.querySelector('[data-scroll-owner="virtual-table"]').addEventListener('scroll', () => {
          document.querySelectorAll('[data-workspace-row]').forEach((row) => row.setAttribute('data-row-key', 'probe-duplicate'));
        }, { once: true });
      </script>
    `));
    const metrics = await collectWorkspaceDomMetrics(page, {
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
    });
    expect(metrics.experience.initial.rowKeysUnique).toBe(true);
    expect(metrics.experience.probe.rowKeysUnique).toBe(false);
    expect(metrics.contract.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'QUEUE_ROW_KEY_UNIQUE' }),
    ]));
    await context.close();
});

it('fails when scrolling to the middle does not advance the rendered virtual window', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const page = await context.newPage();
    await loadMarkupAtUrl(page, validExperiencePageMarkup('', false));
    const metrics = await collectWorkspaceDomMetrics(page, {
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
    });
    expect(metrics.experience.probe.virtualWindowAdvanced).toBe(false);
    expect(metrics.contract.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'QUEUE_VIRTUAL_WINDOW_STALE' }),
    ]));
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
            <span class="scope-visible-warning">范围待处理</span>
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
        'UNEXPECTED_SCOPE_WARNING',
    ]));
    expect(new Set(activeOwnerSelectors).size).toBe(activeOwnerSelectors.length);
    expect(metrics.contract.passed).toBe(false);
    await context.close();
});
});
