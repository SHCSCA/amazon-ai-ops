import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { chromium } = require('./playwright-loader.js');
const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { createServer } = desktopRequire('vite');

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

async function startRendererDevServer() {
  const port = await new Promise((resolve, reject) => {
    const probe = createTcpServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Unable to reserve an ephemeral TCP port for Vite.'));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  const server = await createServer({
    configFile: join(REPO_ROOT, 'apps', 'desktop', 'vite.config.ts'),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Vite preview server did not expose a TCP address.');
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

describe('readback development preview write isolation', () => {
  it('keeps every pre-injected readback evidence API at zero calls after hostile UI attempts', async () => {
    const { server, url } = await startRendererDevServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { height: 900, width: 1400 } });

    try {
      await context.addInitScript(({ writeMethods }) => {
        const calls = Object.fromEntries(writeMethods.map((method) => [method, 0]));
        let exposedApi;
        Object.defineProperty(window, '__readbackWriteProbe', {
          configurable: false,
          enumerable: false,
          value: calls,
          writable: false,
        });
        Object.defineProperty(window, 'electronAPI', {
          configurable: true,
          enumerable: true,
          get() {
            return exposedApi;
          },
          set(nextApi) {
            exposedApi = new Proxy(nextApi || {}, {
              get(target, property, receiver) {
                if (typeof property === 'string' && writeMethods.includes(property)) {
                  return async () => {
                    calls[property] += 1;
                    return { maliciousProbe: true };
                  };
                }
                return Reflect.get(target, property, receiver);
              },
            });
          },
        });
      }, { writeMethods: READBACK_WRITE_METHODS });

      const page = await context.newPage();
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
      const response = await page.goto(`${url}?preview=1&scenario=delivery-ready`, { waitUntil: 'domcontentloaded' });
      const storeSelector = page.locator('#mission-control-store-select');
      if (await storeSelector.isVisible()) {
        await storeSelector.selectOption({ label: 'SHC001-US · US · USD' });
        await page.getByRole('button', { name: '进入所选店铺', exact: true }).click();
      }
      try {
        await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15_000 });
      } catch (error) {
        const bodyText = (await page.locator('body').innerText()).slice(0, 1_000);
        throw new Error([
          `Renderer did not enter the logged-in app shell (HTTP ${response?.status() || 'unknown'}).`,
          `Body: ${bodyText || '(empty)'}`,
          `Browser errors: ${browserErrors.join(' | ') || '(none)'}`,
          error instanceof Error ? error.message : String(error),
        ].join('\n'));
      }
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', {
          detail: { workspace: 'execution', subview: 'evidence' },
        }));
      });

      const readbackRoot = page.locator([
        '[data-workspace-evidence-root]',
        '[data-workspace="readback"]',
        '[data-workspace-subview="evidence"]',
        '[data-readback-mode="preview-readonly"]',
        '[data-preview-scenario="delivery-ready"]',
      ].join(''));
      await readbackRoot.waitFor({ state: 'visible' });
      await expect(page.locator('.readback-preview-only-banner').textContent()).resolves.toMatch(
        /仅开发预览，不代表正式交付就绪.*delivery-ready.*所有证据写入与真实校验均已锁定/s,
      );

      const exposedMethods = await page.evaluate((writeMethods) => Object.fromEntries(
        writeMethods.map((method) => [method, typeof window.electronAPI?.[method]]),
      ), READBACK_WRITE_METHODS);
      expect(exposedMethods).toEqual(Object.fromEntries(
        READBACK_WRITE_METHODS.map((method) => [method, 'function']),
      ));

      await page.locator('button[aria-label="查看技术与证据详情"]').click();
      await page.locator('.responsive-inspector').waitFor({ state: 'attached', timeout: 10_000 });

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
      await context.close();
      await browser.close();
      await server.close();
    }
  }, 60_000);
});
