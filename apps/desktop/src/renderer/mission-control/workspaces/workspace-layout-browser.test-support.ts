import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { createRuntimeLogRecord } from '@amazon-ai-ops/shared-types';
import { canonicalTransactionFixture } from './canonical-transaction-feedback.test-support';
import { currentWorkspaceActionFixture } from './current-workspace-action.test-support';

export const LAYOUT_PROFILES = [
  { id: '100-percent', width: 1366, height: 768, scale: 1 },
  { id: '125-percent-css-equivalent', width: 1093, height: 614, scale: 1.25 },
] as const;
export type LayoutProfile = typeof LAYOUT_PROFILES[number];
export type LayoutSurface = 'missions' | 'decisions' | 'memory' | 'primitives';
export type LayoutBox = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));
const resolveDir = fileURLToPath(new URL('.', import.meta.url));
const artifactRoot = path.resolve('output/development-completion-2026-10-16/renderer-pages/workspace-layout-browser', randomUUID());
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const ownedCases = new WeakMap<Page, string>();
mkdirSync(artifactRoot, { recursive: true });

function writeRecord(directory: string, name: string, value: unknown): void {
  writeFileSync(path.join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function errorRecord(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack }
    : { name: 'UnknownError', message: String(error) };
}

function reportFailure(directory: string, phase: string, error: unknown): void {
  const record = createRuntimeLogRecord('error', 'renderer.layout_regression_failed', {
    schema: 'workspace-layout-regression/1', scope: 'workspace-layout-browser', phase, error: errorRecord(error),
  });
  writeRecord(directory, phase + '-failure-' + randomUUID(), record);
  console.error(JSON.stringify(record));
}

const primitiveFixture = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PageFrame } from '../../components/workspace/page-frame';
import { SummaryStrip } from '../../components/workspace/summary-strip';
import { OperatorFlowFeedback } from './operator-flow-feedback';
import { CanonicalWorkspaceSurface } from './canonical-workspace-surfaces';
import { MissionControlShell } from '../mission-control-shell';
const calls = [], logs = [], errors = [];
window.electronAPI = { reportRuntimeLog: async record => logs.push(record) };
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const context = { storeId:'layout-fixture-store',browserProfileId:'layout-fixture-profile',marketplace:'US',currency:'USD',
  businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1 };
const store = { ...context,displayName:'隔离布局店铺',status:'active',createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z' };
const ids = ['store-context','products','reports','import','mission','analysis','decision','grant','execution','readback','experiment','memory','delivery'];
const labels = ['店铺与会话','产品范围','报告采集','数据导入','运营任务','任务分析','经营决策','授权边界','可见执行','执行回读','经营实验','因果记忆','交付检查'];
const stages = ids.map((id,index) => ({id,label:labels[index],state:'blocked',statusLabel:'隔离布局样本',
  latestResult:'这里只验证生产组件布局，没有真实店铺数据或批准记录。',
  blocker:'当前阶段缺少真实环境证据，必须保留此原因且不得发起执行。',
  nextAction:'检查当前阶段',targetView:'missions/overview'}));
const items = [
  {id:'store',label:'店铺范围',value:'当前店铺',detail:'Amazon US · USD',tone:'confirmed'},
  {id:'business-date',label:'业务日',value:context.businessDate,detail:'按店铺业务时区'},
  {id:'timezone',label:'业务时区',value:context.businessTimezone,detail:'会话代次 '+context.sessionGeneration},
  {id:'revision',label:'配置版本',value:'未生效',detail:'等待配置',tone:'attention'},
];
createRoot(document.getElementById('root')).render(<MissionControlShell activeIntent={{workspace:'settings',subview:'scheduler'}}
  stores={[store]} activeStore={store} authoritativeContext={context} onNavigate={intent=>calls.push(intent)} onSwitchStore={()=>{}} onLogout={()=>{}}
><div className="mission-control-workspace-root">
  <p role="note">隔离 CSS 回归样本；不连接真实店铺、不签发批准或执行。</p>
  <PageFrame className="mission-control-store-automation" pageId="store-automation" title="生产组件布局回归"
    summary={<SummaryStrip ariaLabel="当前店铺自动化范围" items={items}/>}
  >
    <div data-layout-part="operator-flow"><OperatorFlowFeedback stages={stages} allows={()=>false} onNavigate={view=>calls.push(view)}/></div>
    <section aria-label="隔离旧结构 CSS 回归" data-layout-part="legacy">
      <p>仅旧组件 CSS 防回归；保留 PROTOTYPE_ONLY 与禁用边界，不代表业务接入。</p>
      <CanonicalWorkspaceSurface kind="today" view="today/overview" previewEnabled={true} storeContext={context}
        blockedReason="隔离旧结构 CSS 样本没有真实授权，所有业务动作禁用。"/>
    </section>
  </PageFrame>
</div></MissionControlShell>);
window.layoutPrimitiveFixture = { calls, logs, errors };
`;

type LayoutBundle = {
  javascript: string;
  css: string;
  metadata: { appEntry: { path: string; sha256: string; sizeBytes: number }; javascriptSha256: string; cssSha256: string; inputs: string[]; cssInputs: string[] };
};

export async function bundleWorkspaceLayoutFixture(surface: LayoutSurface): Promise<LayoutBundle> {
  const directory = path.join(artifactRoot, 'bundle-' + surface);
  mkdirSync(directory);
  try {
    const fixture = surface === 'missions' ? currentWorkspaceActionFixture('missions')
      : surface === 'primitives' ? primitiveFixture : canonicalTransactionFixture(surface);
    // 样式沿真实 App 入口加载；任务样式只能由其生产组件的依赖引入。
    const contents = "import '../../App';\n" + fixture;
    const result = await viteRequire('esbuild').build({
      stdin: { contents, loader: 'tsx', resolveDir }, bundle: true, write: false, metafile: true,
      outfile: path.join(directory, 'fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic',
      loader: { '.css': 'css' }, nodePaths: [path.resolve('apps/desktop/node_modules')],
      alias: { '@amazon-ai-ops/shared-types/src/v16-api': path.resolve('packages/shared-types/src/v16-api.ts'),
        '@amazon-ai-ops/shared-types': path.resolve('packages/shared-types/src/index.ts') },
      define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false' },
    });
    const javascript = result.outputFiles.find((file: { path: string }) => file.path.endsWith('.js'))?.text;
    const css = result.outputFiles.find((file: { path: string }) => file.path.endsWith('.css'))?.text;
    assert(javascript && css, 'LAYOUT_PRODUCTION_JAVASCRIPT_AND_CSS_REQUIRED');
    const inputs = Object.keys(result.metafile.inputs).map(name => name.replaceAll('\\', '/'));
    const appPath = 'apps/desktop/src/renderer/App.tsx';
    assert(inputs.includes(appPath), 'LAYOUT_ACTUAL_APP_ENTRY_REQUIRED');
    const app = readFileSync(path.resolve(appPath));
    const metadata = { appEntry: { path: appPath, sha256: digest(app), sizeBytes: app.length },
      javascriptSha256: digest(javascript), cssSha256: digest(css), inputs, cssInputs: inputs.filter(name => name.endsWith('.css')) };
    writeRecord(directory, 'bundle-inputs', metadata);
    return { javascript, css, metadata };
  } catch (error) { reportFailure(directory, 'bundle', error); throw error; }
}

export async function recordWorkspaceLayout(page: Page, name: string, metrics: unknown): Promise<void> {
  const directory = ownedCases.get(page);
  assert(directory, 'LAYOUT_OWNED_PAGE_REQUIRED');
  const pixels = await page.screenshot({ fullPage: true });
  const image = name + '.png';
  writeFileSync(path.join(directory, image), pixels, { flag: 'wx' });
  writeRecord(directory, name, { schema: 'workspace-layout-measurement/1', metrics,
    screenshot: { path: path.join(directory, image), sha256: digest(pixels), sizeBytes: pixels.length } });
}

export async function withWorkspaceLayoutFixture(bundle: LayoutBundle, surface: LayoutSurface, profile: LayoutProfile,
  inspect: (page: Page) => Promise<void>): Promise<void> {
  const directory = path.join(artifactRoot, surface + '-' + profile.id + '-' + randomUUID());
  mkdirSync(directory);
  const browserErrors: { kind: string; message: string }[] = [], requests: string[] = [];
  let browser: Browser | undefined, page: Page | undefined, originalError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    browser = await chromium.launch({ headless: true, timeout: 10_000 });
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.scale });
    await context.route('**/*', async route => {
      requests.push(route.request().url());
      try { await route.abort('blockedbyclient'); }
      catch (error) { browserErrors.push({ kind: 'route-abort', message: errorRecord(error).message }); }
    });
    page = await context.newPage(); ownedCases.set(page, directory); page.setDefaultTimeout(5_000);
    page.on('pageerror', error => browserErrors.push({ kind: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push({ kind: 'console', message: message.text() }); });
    await page.setContent('<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><main id="root"></main></body></html>');
    await page.addStyleTag({ content: bundle.css });
    await page.addScriptTag({ content: bundle.javascript });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await inspect(page);
    const fixture = await page.evaluate(() => {
      const state = (window as any).currentWorkspaceFixture ?? (window as any).canonicalFeedback ?? (window as any).layoutPrimitiveFixture;
      return { errors: state?.errors, logs: state?.logs };
    });
    writeRecord(directory, 'runtime', { browserErrors, requests, fixture });
    assert.deepEqual(browserErrors, [], 'LAYOUT_UNEXPECTED_BROWSER_ERROR');
    assert.deepEqual(requests, [], 'LAYOUT_EXTERNAL_REQUEST_FORBIDDEN');
    assert.deepEqual(fixture.errors, [], 'LAYOUT_UNEXPECTED_FIXTURE_ERROR');
    assert.deepEqual(fixture.logs.filter((record: { level?: string }) => record.level === 'error'), [], 'LAYOUT_UNEXPECTED_RUNTIME_ERROR_LOG');
  } catch (error) { originalError = error; reportFailure(directory, 'case', error); throw error; }
  finally {
    if (page && !page.isClosed()) {
      try { await recordWorkspaceLayout(page, 'terminal', { browserErrors, requests }); }
      catch (error) { cleanupErrors.push(error); reportFailure(directory, 'terminal-capture', error); }
    }
    if (browser) {
      try { await browser.close(); }
      catch (error) { cleanupErrors.push(error); reportFailure(directory, 'browser-close', error); }
    }
    writeRecord(directory, 'result', { schema: 'workspace-layout-regression/1', status: originalError || cleanupErrors.length ? 'FAILED' : 'PASSED',
      surface, profile, bundle: bundle.metadata, browserErrors, requests, cleanupErrors: cleanupErrors.map(errorRecord),
      boundary: 'ISOLATED_RENDERER_LAYOUT_ONLY_NOT_PACKAGED_RUNTIME_OR_LIVE_STORE_ACCEPTANCE' });
    if (!originalError && cleanupErrors.length) throw new AggregateError(cleanupErrors, 'LAYOUT_CLEANUP_FAILED');
  }
}

export async function measureLayout(locator: Locator) {
  return locator.evaluate(element => {
    const box = (item: Element) => { const rect = item.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
    const style = getComputedStyle(element), html = element as HTMLElement;
    const textRects: { left: number; top: number; right: number; bottom: number; width: number; height: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) textRects.push({
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
    }
    return { box: box(element), parent: element.parentElement ? box(element.parentElement) : null,
      text: element.textContent?.trim() ?? '', textRects, visible: element.checkVisibility(),
      lines: new Set(textRects.map(rect => Math.round(rect.top * 2) / 2)).size,
      clientWidth: html.clientWidth, scrollWidth: html.scrollWidth, clientHeight: html.clientHeight, scrollHeight: html.scrollHeight,
      display: style.display, gridTemplateColumns: style.gridTemplateColumns, flexWrap: style.flexWrap,
      flexShrink: style.flexShrink, whiteSpace: style.whiteSpace, fontSize: style.fontSize, cursor: style.cursor,
      overflowX: style.overflowX, overflowY: style.overflowY, clipPath: style.clipPath, opacity: style.opacity,
      children: [...element.children].map(box), disabled: element.matches(':disabled'),
      describedBy: element.getAttribute('aria-describedby'), busy: element.getAttribute('aria-busy') };
  });
}

export async function measureDisabledReason(page: Page, button: Locator) {
  const action = await measureLayout(button), id = action.describedBy;
  assert(id, 'LAYOUT_DISABLED_REASON_BINDING_REQUIRED');
  const reason = await measureLayout(page.locator(`[id=${JSON.stringify(id)}]`));
  return { action, reason };
}
