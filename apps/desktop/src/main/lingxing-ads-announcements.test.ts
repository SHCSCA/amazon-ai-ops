import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  assertLingxingAdsSelectedStoreTags,
  bindPendingLingxingAdsNewPageAdoption,
  bindPendingLingxingAdsPageCloseOnlyLiveness,
  dismissLingxingAdsChangeAnnouncements,
  discoverLingxingAdsKeywordTarget,
  ensureLingxingErpAuthenticated,
  ensureLingxingAdsHeaderStore,
  findTrustedLingxingProviderReplacementPage,
  isLingxingProviderExplicitlyLoggedOutPage,
  isTrustedLingxingProviderUrl,
  navigateToLingxingAdsCampaignKeywordTarget,
  findTrustedLingxingProviderPageAfterPendingNavigation,
  resolveLingxingStableIdentityFromAdsProfile,
  resolveLingxingStableIdentityFromVerifiedContinuation,
  openLingxingAdsFromErp,
  readLingxingAdsPageStateAfterNavigation,
  readLingxingAdsProfileEvidence,
  resolveLingxingKeywordTargetRows,
  restoreAuthenticatedLingxingErpPage,
  selectOnlyLingxingAdsStore,
  selectLingxingAdsProfileEvidence,
} from './lingxing-ads-sso';

describe('dismissLingxingAdsChangeAnnouncements', () => {
  it('clears every recognized announcement page using the live page count instead of assuming two', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      const html = `
        <div class="el-dialog announcement-one" role="dialog">
          <div class="el-dialog__header">【菜单名称】变更公告</div>
          <button type="button" class="announcement-action">下一条 (1/4)</button>
        </div>
        <div class="el-dialog announcement-two" role="dialog" style="display:none">
          <div class="el-dialog__header">【广告报表】变更公告</div>
          <button type="button" class="announcement-action">下一条 (1/2)</button>
        </div>
      `;
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: html,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/dashboard');
      await page.evaluate(() => {
        const wire = (selector: string, total: number, nextSelector?: string) => {
          const dialog = document.querySelector<HTMLElement>(selector)!;
          const button = dialog.querySelector<HTMLButtonElement>('.announcement-action')!;
          let current = 1;
          button.addEventListener('click', () => {
            dialog.dataset.clicks = String(Number(dialog.dataset.clicks ?? '0') + 1);
            if (current < total) {
              current += 1;
              button.textContent = current < total
                ? `下一条 (${current}/${total})`
                : '我知道了';
              return;
            }
            dialog.style.display = 'none';
            if (nextSelector) {
              const next = document.querySelector<HTMLElement>(nextSelector);
              if (next) next.style.display = 'block';
            }
          });
        };
        wire('.announcement-one', 4, '.announcement-two');
        wire('.announcement-two', 2);
      });

      await expect(dismissLingxingAdsChangeAnnouncements(page)).resolves.toBe(6);
      expect(await page.locator('.el-dialog:visible').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('does not click an unrelated business confirmation dialog', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: `
        <div class="el-dialog" role="dialog">
          <div class="el-dialog__header">归档策略</div>
          <button type="button" onclick="this.dataset.clicked='yes'">确定</button>
        </div>
        `,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/dashboard');

      await expect(dismissLingxingAdsChangeAnnouncements(page)).resolves.toBe(0);
      expect(await page.locator('button').getAttribute('data-clicked')).toBeNull();
    } finally {
      await page.close();
      await browser.close();
    }
  });
});
