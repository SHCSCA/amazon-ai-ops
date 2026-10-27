import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));

export async function bundleProductionActionFixture(contents: string): Promise<string> {
  const result = await viteRequire('esbuild').build({ stdin: { contents, loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' },
    nodePaths: [path.resolve('apps/desktop/node_modules')],
    alias: { '@amazon-ai-ops/shared-types/src/v16-api': path.resolve('packages/shared-types/src/v16-api.ts'),
      '@amazon-ai-ops/shared-types': path.resolve('packages/shared-types/src/index.ts') },
    define: { 'process.env.NODE_ENV': '"test"' } });
  return result.outputFiles[0].text;
}

export async function openProductionActionFixture(bundle: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: bundle });
    return { browser, page };
  } catch (error) { await browser.close(); throw error; }
}

export async function invokeActualReactActionTwice(page: Page, label: string) {
  await page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === text) as any;
    if (!button) throw new Error('ACTION_BUTTON_NOT_FOUND');
    const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))!];
    props.onClick(); props.onClick();
  }, label);
}
