import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import type { BrowserConfig, ScreenshotResult } from '@amazon-ai-ops/shared-types';

export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserConfig;
  private userDataDir: string;

  constructor(config: BrowserConfig) {
    this.config = config;
    this.userDataDir = config.userDataDir || path.join(process.cwd(), 'browser-profile');
  }

  async launch(): Promise<void> {
    try {
      const executablePath = resolveChromiumExecutablePathForRuntime();
      // 使用 Chromium persistent profile
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: this.config.headless ?? false,
        viewport: this.config.viewport || { width: 1400, height: 900 },
        acceptDownloads: true,
        ...(executablePath ? { executablePath } : {}),
        args: ['--disable-blink-features=AutomationControlled'],
      });
      this.page = this.context.pages()[0] || await this.context.newPage();
    } catch (error) {
      throw new Error(toUserFacingBrowserLaunchError(error));
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  getPage(): Page | null {
    return this.page;
  }

  setActivePage(page: Page): void {
    this.page = page;
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  private getPageOrThrow(): Page {
    if (!this.page) throw new Error('Page not initialized');
    return this.page;
  }

  async navigate(url: string): Promise<void> {
    await this.getPageOrThrow().goto(url);
  }

  async waitForSelector(selector: string, timeout?: number): Promise<void> {
    await this.getPageOrThrow().waitForSelector(selector, { timeout });
  }

  async waitForURL(url: string | RegExp, timeout?: number): Promise<void> {
    await this.getPageOrThrow().waitForURL(url, { timeout });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.getPageOrThrow().waitForTimeout(ms);
  }

  async click(selector: string): Promise<void> {
    await this.getPageOrThrow().click(selector);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.getPageOrThrow().fill(selector, value);
  }

  async evaluate<T = unknown>(fn: string | Function, ...args: any[]): Promise<T> {
    const page = this.getPageOrThrow();
    if (args.length === 0) {
      return page.evaluate(fn as any) as Promise<T>;
    }
    if (args.length === 1) {
      return page.evaluate(fn as any, args[0]) as Promise<T>;
    }

    if (typeof fn === 'string') {
      throw new Error('BrowserController.evaluate only supports multiple arguments when the page function is a Function.');
    }

    return page.evaluate(
      ({ source, values }) => {
        const pageFunction = (0, eval)(`(${source})`);
        return pageFunction(...values);
      },
      { source: fn.toString(), values: args },
    ) as Promise<T>;
  }

  async isVisible(selector: string): Promise<boolean> {
    return this.getPageOrThrow().isVisible(selector);
  }

  async waitForNavigation(options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<void> {
    await this.getPageOrThrow().waitForNavigation(options);
  }

  async screenshot(label: string): Promise<ScreenshotResult> {
    if (!this.page) throw new Error('Page not initialized');
    
    const screenshotDir = path.join(process.cwd(), 'storage', 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    
    const filename = `${label}_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);
    
    await this.page.screenshot({ path: filepath, fullPage: false });
    
    return {
      path: filepath,
      label: label as any,
      pageUrl: this.page.url(),
      takenAt: new Date().toISOString(),
    };
  }

  /** Capture to an authority-selected path instead of inventing a global path. */
  async screenshotToPath(filepath: string, label: string): Promise<ScreenshotResult> {
    if (!this.page) throw new Error('Page not initialized');

    const resolvedPath = path.resolve(filepath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    await this.page.screenshot({ path: resolvedPath, fullPage: false });

    return {
      path: resolvedPath,
      label: label as any,
      pageUrl: this.page.url(),
      takenAt: new Date().toISOString(),
    };
  }

  async takeFullPageScreenshot(label: string): Promise<ScreenshotResult> {
    if (!this.page) throw new Error('Page not initialized');
    
    const screenshotDir = path.join(process.cwd(), 'storage', 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    
    const filename = `${label}_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);
    
    await this.page.screenshot({ path: filepath, fullPage: true });
    
    return {
      path: filepath,
      label: label as any,
      pageUrl: this.page.url(),
      takenAt: new Date().toISOString(),
    };
  }
}

export type ChromiumRuntimeResolutionInput = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  resourcesPath?: string;
  electronVersion?: string;
  listDir?: (dir: string) => string[];
  fileExists?: (filePath: string) => boolean;
};

export function resolveChromiumExecutablePathForRuntime(input: ChromiumRuntimeResolutionInput = {}): string | undefined {
  const env = input.env ?? process.env;
  const resourcesPath = input.resourcesPath ?? process.resourcesPath;
  const electronVersion = input.electronVersion ?? process.versions.electron;
  const listDir = input.listDir ?? ((dir: string) => fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  const fileExists = input.fileExists ?? fs.existsSync;

  if (!electronVersion || !isUnpackagedElectronResourcesPath(resourcesPath)) {
    return undefined;
  }

  const localAppData = env.LOCALAPPDATA || env.LocalAppData || env.localappdata;
  if (!localAppData) {
    return undefined;
  }

  const browsersDir = path.join(localAppData, 'ms-playwright');
  const chromiumDirs = listDir(browsersDir)
    .filter((name) => /^chromium-\d+$/i.test(name))
    .sort((left, right) => Number(right.replace(/\D/g, '')) - Number(left.replace(/\D/g, '')));

  for (const dir of chromiumDirs) {
    const chromePath = path.join(browsersDir, dir, 'chrome-win64', 'chrome.exe');
    if (fileExists(chromePath)) {
      return chromePath;
    }
  }

  return undefined;
}

function isUnpackagedElectronResourcesPath(resourcesPath?: string): boolean {
  const normalized = String(resourcesPath || '').replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/node_modules/') && normalized.includes('/electron/') && normalized.endsWith('/dist/resources');
}

export function toUserFacingBrowserLaunchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/user[- ]data[- ]dir|profile|ProcessSingleton|already in use|另一个程序/i.test(message)) {
    return '浏览器启动失败：领星自动化浏览器配置正在被另一个实例占用。请关闭上一个自动化浏览器窗口后重试。';
  }

  if (/Executable doesn't exist|chrome-win64[\\/]+chrome\.exe|playwright-browsers[\\/]+chrome-win64/i.test(message)) {
    return '浏览器启动失败：打包浏览器运行时不可用。请重新安装或重新构建桌面应用后重试。';
  }

  if (/Target page, context or browser has been closed/i.test(message)) {
    return '浏览器连接已关闭：请重新打开登录窗口后再试。';
  }

  return '浏览器启动失败：请关闭残留的自动化浏览器窗口后重试。';
}
