import { Page, Locator } from 'playwright';
import type { ElementLocator, LocatorStrategy } from '@amazon-ai-ops/shared-types';

export class ElementLocatorManager {
  constructor(private page: Page) {}

  async locate(locator: ElementLocator, timeout = 5000): Promise<Locator | null> {
    // 按策略优先级尝试
    for (const strategy of locator.strategies) {
      try {
        const result = await this.tryStrategy(strategy, timeout);
        if (result) return result;
      } catch (e) {
        // 尝试下一个策略
        continue;
      }
    }
    return null;
  }

  private async tryStrategy(strategy: LocatorStrategy, timeout: number): Promise<Locator | null> {
    switch (strategy.type) {
      case 'css':
        return this.page.locator(strategy.value).first();
      case 'xpath':
        return this.page.locator(`xpath=${strategy.value}`).first();
      case 'text':
        return this.page.getByText(strategy.value, { exact: false }).first();
      case 'role':
        return this.page.getByRole(strategy.value as any).first();
      case 'label':
        return this.page.getByLabel(strategy.value).first();
      default:
        return null;
    }
  }

  async click(locator: ElementLocator, options?: { timeout?: number; force?: boolean }): Promise<void> {
    const el = await this.locate(locator, options?.timeout || 5000);
    if (!el) throw new Error(`Element not found: ${locator.id}`);
    await el.click({ force: options?.force });
  }

  async fill(locator: ElementLocator, value: string, timeout = 5000): Promise<void> {
    const el = await this.locate(locator, timeout);
    if (!el) throw new Error(`Element not found: ${locator.id}`);
    await el.fill(value);
  }

  async selectOption(locator: ElementLocator, value: string, timeout = 5000): Promise<void> {
    const el = await this.locate(locator, timeout);
    if (!el) throw new Error(`Element not found: ${locator.id}`);
    await el.selectOption(value);
  }

  async getText(locator: ElementLocator, timeout = 5000): Promise<string | null> {
    const el = await this.locate(locator, timeout);
    if (!el) return null;
    return el.textContent();
  }

  async isVisible(locator: ElementLocator, timeout = 3000): Promise<boolean> {
    try {
      const el = await this.locate(locator, timeout);
      return el ? await el.isVisible() : false;
    } catch {
      return false;
    }
  }

  async waitForSelector(selector: string, timeout = 10000): Promise<void> {
    await this.page.waitForSelector(selector, { timeout });
  }

  async isEnabled(locator: ElementLocator, timeout = 3000): Promise<boolean> {
    try {
      const el = await this.locate(locator, timeout);
      return el ? await el.isEnabled() : false;
    } catch {
      return false;
    }
  }
}
