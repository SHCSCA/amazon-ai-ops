import { Page } from 'playwright';
import type { SessionInfo } from '@amazon-ai-ops/shared-types';

export interface SessionCheckResult {
  isLoggedIn: boolean;
  storeName?: string;
  marketplaceCode?: string;
  accountEmail?: string;
  currentUrl: string;
  pageTitle: string;
  reason?: string;
}

export class SessionManager {
  constructor(private page: Page) {}

  async check(): Promise<SessionInfo> {
    const result = await this.performCheck();
    return {
      isLoggedIn: result.isLoggedIn,
      currentUrl: result.currentUrl,
      storeName: result.storeName,
      marketplaceCode: result.marketplaceCode,
      accountEmail: result.accountEmail,
      checkedAt: new Date().toISOString(),
    };
  }

  private async performCheck(): Promise<SessionCheckResult> {
    const url = this.page.url();
    const title = await this.page.title();
    
    // 已跳转到登录页
    if (url.includes('login') || url.includes('signin') || url.includes('auth')) {
      return {
        isLoggedIn: false,
        currentUrl: url,
        pageTitle: title,
        reason: 'URL indicates login page',
      };
    }

    // 检查关键元素 - 领星 ERP 的标识
    try {
      // 检查是否有 ERP 特有的导航元素
      const erpNav = await this.page.locator('text=广告').first().isVisible().catch(() => false);
      const erpNav2 = await this.page.locator('text=首页').first().isVisible().catch(() => false);
      
      if (!erpNav && !erpNav2) {
        // 可能未登录或页面加载失败
        return {
          isLoggedIn: false,
          currentUrl: url,
          pageTitle: title,
          reason: 'ERP navigation elements not found',
        };
      }
    } catch (e: unknown) {
      return {
        isLoggedIn: false,
        currentUrl: url,
        pageTitle: title,
        reason: `Error checking page: ${(e as Error).message}`,
      };
    }

    // 尝试获取店铺信息（从页面 URL 或 DOM）
    const storeMatch = url.match(/shop[_\-]?id=(\w+)/i) || url.match(/\/store\/(\w+)/i);
    const marketplaceMatch = url.match(/\/(US|UK|DE|FR|IT|ES|JP|CA|MX|AU|AE|NL|SE|PL|SG)\//i);
    
    return {
      isLoggedIn: true,
      currentUrl: url,
      pageTitle: title,
      storeName: storeMatch ? storeMatch[1] : undefined,
      marketplaceCode: marketplaceMatch ? marketplaceMatch[1].toUpperCase() : undefined,
    };
  }

  async waitForLogin(timeout = 30000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const result = await this.performCheck();
      if (result.isLoggedIn) return;
      await this.page.waitForTimeout(2000);
    }
    throw new Error(`Login timeout after ${timeout}ms`);
  }
}
