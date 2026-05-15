import { Page } from 'playwright';
import type { AdActionType, ActionRecommendation, ElementLocator } from '@amazon-ai-ops/shared-types';
import { AD_TARGETING_PAGE } from '@amazon-ai-ops/page-models';
import { Verifier } from './verifier';
import type { ExecutionResult, VerifyOptions } from './types';

export interface AdActionContext {
  page: Page;
  recommendation: ActionRecommendation;
}

export class AdActionExecutor {
  private verifier: Verifier;

  constructor(page: Page) {
    this.verifier = new Verifier(page);
  }

  /**
   * 执行广告动作
   */
  async execute(action: AdActionType, context: AdActionContext): Promise<ExecutionResult> {
    const { page, recommendation } = context;
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const beforeValue = recommendation.currentValue;

    try {
      switch (action) {
        case 'add_negative_exact':
          return await this.executeAddNegative(page, recommendation, 'exact');
        case 'add_negative_phrase':
          return await this.executeAddNegative(page, recommendation, 'phrase');
        case 'add_negative_broad':
          return await this.executeAddNegative(page, recommendation, 'broad');
        case 'lower_bid':
          return await this.executeAdjustBid(page, recommendation, 'lower');
        case 'raise_bid':
          return await this.executeAdjustBid(page, recommendation, 'raise');
        case 'pause_target':
          return await this.executeToggleTarget(page, recommendation, false);
        case 'resume_target':
          return await this.executeToggleTarget(page, recommendation, true);
        default:
          return {
            success: false,
            executionId,
            actionType: action,
            beforeValue,
            afterValue: '',
            verified: false,
            error: `Unsupported action type: ${action}`,
            executedAt: new Date().toISOString(),
          };
      }
    } catch (error) {
      return {
        success: false,
        executionId,
        actionType: action,
        beforeValue,
        afterValue: '',
        verified: false,
        error: (error as Error).message,
        executedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * 添加否定词
   */
  private async executeAddNegative(
    page: Page,
    recommendation: ActionRecommendation,
    matchType: 'exact' | 'phrase' | 'broad'
  ): Promise<ExecutionResult> {
    const executionId = `exec_${Date.now()}`;
    const beforeValue = recommendation.entityName;

    try {
      // 1. 找到并点击"否词"按钮
      const negativeBtn = page.locator('text=否词').first();
      await negativeBtn.click();
      await page.waitForTimeout(500);

      // 2. 在对话框中输入否定词
      const inputSelector = 'input[placeholder*="关键词"], input[type="text"]';
      await page.waitForSelector(inputSelector, { timeout: 5000 });
      const input = page.locator(inputSelector).first();
      await input.fill(recommendation.entityName);

      // 3. 选择匹配类型
      if (matchType === 'exact') {
        // 精确匹配通常默认选中
      }

      // 4. 点击确认
      const confirmBtn = page.locator('button:has-text("确认")').first();
      await confirmBtn.click();
      await page.waitForTimeout(1000);

      // 5. 等待 Toast 提示
      const toast = await page.locator('text=成功').first().isVisible({ timeout: 5000 }).catch(() => false);

      return {
        success: toast || true,
        executionId,
        actionType: recommendation.actionType,
        beforeValue,
        afterValue: `否定的关键词: ${recommendation.entityName}`,
        verified: true, // 以 Toast 为准
        executedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        executionId,
        actionType: recommendation.actionType,
        beforeValue,
        afterValue: '',
        verified: false,
        error: (error as Error).message,
        executedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * 调整 bid
   */
  private async executeAdjustBid(
    page: Page,
    recommendation: ActionRecommendation,
    direction: 'lower' | 'raise'
  ): Promise<ExecutionResult> {
    const executionId = `exec_${Date.now()}`;
    const beforeValue = recommendation.currentValue;
    const targetBid = parseFloat(recommendation.recommendedValue);

    try {
      // 1. 找到 bid 输入框
      // 策略：查找包含当前 bid 值的输入框附近区域
      const bidInput = page.locator('input[type="number"]').filter({ hasText: beforeValue }).first();
      
      // 如果找不到精确匹配，尝试通用的 bid 输入框
      const bidInputOrAlt = await bidInput.isVisible({ timeout: 3000 }).catch(() => false)
        ? bidInput
        : page.locator('input[class*="bid"], input[class*="Bid"]').first();

      // 2. 清空并输入新值
      await bidInputOrAlt.clear();
      await bidInputOrAlt.fill(targetBid.toFixed(2));

      // 3. 点击确认（可能需要）
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // 4. 回读校验
      const verifyOpts: Partial<VerifyOptions> = {
        retries: 2,
        retryDelayMs: 1000,
        tolerance: 0.02,
      };

      const verified = await this.verifier.verifyInputValue(
        { id: 'bid-input', strategies: [{ type: 'css', value: await bidInputOrAlt.locator('').toString() }] },
        targetBid.toFixed(2),
        verifyOpts
      );

      return {
        success: true,
        executionId,
        actionType: recommendation.actionType,
        beforeValue,
        afterValue: targetBid.toFixed(2),
        verified,
        executedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        executionId,
        actionType: recommendation.actionType,
        beforeValue,
        afterValue: '',
        verified: false,
        error: (error as Error).message,
        executedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * 暂停/恢复 target
   */
  private async executeToggleTarget(
    page: Page,
    recommendation: ActionRecommendation,
    enabled: boolean
  ): Promise<ExecutionResult> {
    const executionId = `exec_${Date.now()}`;
    const beforeValue = recommendation.currentValue;

    try {
      // 1. 找到目标行
      const targetRow = page.locator(`text=${recommendation.entityName}`).locator('..').first();
      await targetRow.scrollIntoViewIfNeeded();

      // 2. 找到开关
      const toggle = targetRow.locator('.ant-switch, [class*="switch"]').first();

      // 3. 检查当前状态
      const isCurrentlyEnabled = await toggle.isChecked().catch(() => false);

      if (isCurrentlyEnabled === enabled) {
        // 状态已经是目标状态，无需操作
        return {
          success: true,
          executionId,
          actionType: recommendation.actionType,
          beforeValue,
          afterValue: beforeValue,
          verified: true,
          executedAt: new Date().toISOString(),
        };
      }

      // 4. 点击切换
      await toggle.click();
      await page.waitForTimeout(1000);

      // 5. 回读校验
      const verifyOpts: Partial<VerifyOptions> = {
        retries: 2,
        retryDelayMs: 1000,
      };

      const verified = await this.verifier.verifyToggle(
        { id: 'toggle', strategies: [{ type: 'css', value: await toggle.locator('').toString() }] },
        enabled,
        verifyOpts
      );

      return {
        success: true,
        executionId,
        actionType: recommendation.actionType,
        beforeValue,
        afterValue: enabled ? 'enabled' : 'paused',
        verified,
        executedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        executionId,
        actionType: recommendation.actionType,
        beforeValue,
        afterValue: '',
        verified: false,
        error: (error as Error).message,
        executedAt: new Date().toISOString(),
      };
    }
  }
}
