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
    // 使用 Chromium persistent profile
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless: this.config.headless ?? false,
      viewport: this.config.viewport || { width: 1400, height: 900 },
      acceptDownloads: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
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
    return this.getPageOrThrow().evaluate(fn as any, ...args) as Promise<T>;
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
