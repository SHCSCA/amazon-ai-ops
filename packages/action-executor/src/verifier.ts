import { Page } from 'playwright';
import type { ElementLocator } from '@amazon-ai-ops/shared-types';
import type { VerifyOptions } from './types';

const DEFAULT_VERIFY_OPTIONS: VerifyOptions = {
  retries: 3,
  retryDelayMs: 2000,
  tolerance: 0.01,
};

export class Verifier {
  constructor(private page: Page) {}

  /**
   * 验证输入框的值是否已变更
   */
  async verifyInputValue(
    locator: ElementLocator,
    expectedValue: string,
    options: Partial<VerifyOptions> = {}
  ): Promise<boolean> {
    const opts = { ...DEFAULT_VERIFY_OPTIONS, ...options };
    
    for (let i = 0; i < opts.retries; i++) {
      try {
        const el = await this.page.locator(locator.strategies[0].value).first();
        const currentValue = await el.inputValue();
        
        if (this.valuesMatch(currentValue, expectedValue, opts.tolerance)) {
          return true;
        }
        
        if (i < opts.retries - 1) {
          await this.page.waitForTimeout(opts.retryDelayMs);
        }
      } catch {
        if (i < opts.retries - 1) {
          await this.page.waitForTimeout(opts.retryDelayMs);
        }
      }
    }
    
    return false;
  }

  /**
   * 验证元素的文本内容
   */
  async verifyText(
    locator: ElementLocator,
    expectedText: string,
    options: Partial<VerifyOptions> = {}
  ): Promise<boolean> {
    const opts = { ...DEFAULT_VERIFY_OPTIONS, ...options };
    
    for (let i = 0; i < opts.retries; i++) {
      try {
        const el = await this.page.locator(locator.strategies[0].value).first();
        const text = await el.textContent();
        
        if (text?.includes(expectedText)) {
          return true;
        }
        
        if (i < opts.retries - 1) {
          await this.page.waitForTimeout(opts.retryDelayMs);
        }
      } catch {
        if (i < opts.retries - 1) {
          await this.page.waitForTimeout(opts.retryDelayMs);
        }
      }
    }
    
    return false;
  }

  /**
   * 验证开关状态
   */
  async verifyToggle(
    locator: ElementLocator,
    expectedEnabled: boolean,
    options: Partial<VerifyOptions> = {}
  ): Promise<boolean> {
    const opts = { ...DEFAULT_VERIFY_OPTIONS, ...options };
    
    for (let i = 0; i < opts.retries; i++) {
      try {
        const el = await this.page.locator(locator.strategies[0].value).first();
        const isChecked = await el.isChecked();
        
        if (isChecked === expectedEnabled) {
          return true;
        }
        
        if (i < opts.retries - 1) {
          await this.page.waitForTimeout(opts.retryDelayMs);
        }
      } catch {
        if (i < opts.retries - 1) {
          await this.page.waitForTimeout(opts.retryDelayMs);
        }
      }
    }
    
    return false;
  }

  /**
   * 通用值比较（支持数值容差）
   */
  private valuesMatch(actual: string, expected: string, tolerance: number): boolean {
    const actualNum = parseFloat(actual);
    const expectedNum = parseFloat(expected);
    
    if (!isNaN(actualNum) && !isNaN(expectedNum)) {
      return Math.abs(actualNum - expectedNum) <= tolerance;
    }
    
    return actual.trim() === expected.trim();
  }
}
