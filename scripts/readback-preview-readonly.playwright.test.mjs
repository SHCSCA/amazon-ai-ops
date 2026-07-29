import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { chromium } = require('./playwright-loader.js');
const {
  enterPreviewStore,
  installPreviewApiBridge,
  navigateLegacyRoute,
  startBusinessUiDevServer,
} = require('./business-ui-smoke-navigation.js');

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');

const READBACK_WRITE_METHODS = [
  'exportAdReadbackEvidence',
  'prepareAdReadbackSession',
  'verifyAdReadbackSession',
  'fillAdReadbackSession',
  'verifyAdReadbackEvidence',
  'saveReadbackCapture',
  'refreshFinalReadiness',
];

const READBACK_WRITE_ACTIONS = [
  { action: 'final-verification', labels: ['运行最终校验'] },
  { action: 'prepare-session', labels: ['创建回读工作包'] },
  { action: 'verify-session', labels: ['检查工作包'] },
  { action: 'fill-session', labels: ['生成回读证据'] },
  { action: 'verify-evidence', labels: ['校验证据文件', '校验回读证据'] },
];

async function waitForStage(
  page,
  locator,
  stage,
  browserErrors,
  { state = 'visible', timeout = 15_000 } = {},
) {
  try {
    await locator.waitFor({ state, timeout });
  } catch (error) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error([
      `Readback preview isolation stalled at stage: ${stage}.`,
      `URL: ${page.url()}`,
      `Body: ${bodyText.slice(0, 2_000) || '(empty)'}`,
      `Browser errors: ${browserErrors.join(' | ') || '(none)'}`,
      error instanceof Error ? error.message : String(error),
    ].join('\n'));
  }
}

describe('readback development preview write isolation', () => {
  it('keeps every pre-injected readback evidence API at zero calls after hostile UI attempts', async () => {
    const server = await startBusinessUiDevServer(REPO_ROOT, 'delivery-ready');
    let browser;
    let context;

    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({ viewport: { height: 900, width: 1400 } });
      const page = await context.newPage();
      await installPreviewApiBridge(page);
      await page.addInitScript(({ writeMethods }) => {
        const calls = Object.fromEntries(writeMethods.map((method) => [method, 0]));
        Object.defineProperty(window, '__readbackWriteProbe', {
          configurable: false,
          enumerable: false,
          value: calls,
          writable: false,
        });
        window.__businessUiSmokeOverrides = Object.fromEntries(writeMethods.map((method) => [
          method,
          async () => {
            calls[method] += 1;
            return { maliciousProbe: true };
          },
        ]));
      }, { writeMethods: READBACK_WRITE_METHODS });

      const browserErrors = [];
      page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
      });
      page.on('response', async (browserResponse) => {
        if (browserResponse.status() < 400) return;
        const responseText = await browserResponse.text().catch(() => '');
        browserErrors.push(
          `response ${browserResponse.status()}: ${browserResponse.url()} ${responseText.slice(0, 1_000)}`,
        );
      });
      const response = await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      try {
        await enterPreviewStore(page, 'SHC001-US · US · USD');
      } catch (error) {
        const bodyText = (await page.locator('body').innerText()).slice(0, 1_000);
        throw new Error([
          `Renderer did not enter the logged-in app shell (HTTP ${response?.status() || 'unknown'}).`,
          `Body: ${bodyText || '(empty)'}`,
          `Browser errors: ${browserErrors.join(' | ') || '(none)'}`,
          error instanceof Error ? error.message : String(error),
        ].join('\n'));
      }
      await navigateLegacyRoute(page, 'readback');

      const readbackRoot = page.locator(
        '[data-workspace-evidence-root]'
        + '[data-workspace="readback"]'
        + '[data-workspace-subview="evidence"]'
        + '[data-readback-mode="preview-readonly"]'
        + '[data-preview-scenario="delivery-ready"]',
      );
      await waitForStage(page, readbackRoot, 'execution/evidence route', browserErrors);
      expect(await readbackRoot.count()).toBe(1);
      const previewBanner = page.locator('.readback-preview-only-banner');
      await waitForStage(
        page,
        previewBanner,
        'preview-readonly authority banner',
        browserErrors,
        { timeout: 10_000 },
      );
      await expect(previewBanner.textContent()).resolves.toMatch(
        /仅开发预览，不代表正式交付就绪.*delivery-ready.*所有证据写入与真实校验均已锁定/s,
      );

      const exposedMethods = await page.evaluate((writeMethods) => Object.fromEntries(
        writeMethods.map((method) => [method, typeof window.electronAPI?.[method]]),
      ), READBACK_WRITE_METHODS);
      expect(exposedMethods).toEqual(Object.fromEntries(
        READBACK_WRITE_METHODS.map((method) => [method, 'function']),
      ));

      const inspectorTrigger = readbackRoot.getByRole(
        'button',
        { name: '查看技术与证据详情', exact: true },
      );
      await waitForStage(
        page,
        inspectorTrigger,
        'technical evidence trigger',
        browserErrors,
        { timeout: 10_000 },
      );
      await inspectorTrigger.dispatchEvent('click');
      await waitForStage(
        page,
        page.locator('.responsive-inspector'),
        'technical evidence inspector',
        browserErrors,
        { timeout: 10_000 },
      );

      const buttonAttempts = await page.evaluate((actions) => actions.map(({ action, labels }) => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (candidate) => labels.includes(candidate.textContent?.trim() || ''),
        );
        button?.click();
        return { action, disabled: button?.disabled ?? null, found: Boolean(button) };
      }), READBACK_WRITE_ACTIONS);
      expect(buttonAttempts).toEqual(READBACK_WRITE_ACTIONS.map(({ action }) => action === 'final-verification'
        ? { action, disabled: null, found: false }
        : { action, disabled: true, found: true }));

      const captureTargets = page.locator(
        '[data-capture-slot][aria-label$="拖拽或粘贴存证"]',
      );
      await waitForStage(
        page,
        captureTargets.first(),
        'readback capture slots',
        browserErrors,
        { state: 'attached', timeout: 10_000 },
      );
      expect(await captureTargets.count()).toBe(4);
      const captureAttempts = await page.evaluate(() => {
        const targets = Array.from(document.querySelectorAll('[data-capture-slot][aria-label$="拖拽或粘贴存证"]'));
        const file = new File(['hostile-preview-probe'], 'hostile-preview-probe.png', { type: 'image/png' });
        return targets.map((target) => {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          target.dispatchEvent(new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }));
          target.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }));
          return {
            ariaDisabled: target.getAttribute('aria-disabled'),
            label: target.getAttribute('aria-label'),
            slot: target.getAttribute('data-capture-slot'),
            tabIndex: target.getAttribute('tabindex'),
          };
        });
      });
      expect(captureAttempts).toEqual([
        'approval',
        'before',
        'after',
        'readback',
      ].map((slot) => ({
        ariaDisabled: 'true',
        label: expect.any(String),
        slot,
        tabIndex: '-1',
      })));

      await page.waitForTimeout(100);
      const writeCalls = await page.evaluate(() => window.__readbackWriteProbe);
      expect(writeCalls).toEqual(Object.fromEntries(
        READBACK_WRITE_METHODS.map((method) => [method, 0]),
      ));
    } finally {
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
      await server.close().catch(() => {});
    }
  // The full repository suite also runs the process-heavy production-readiness
  // adversarial fixtures. Keep this browser isolation test bounded, but allow
  // enough headroom for Chromium/Vite startup when those fixtures saturate CI.
  }, 240_000);
});
