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

describe('ensureLingxingErpAuthenticated', () => {
  it('submits the same operator credentials inside the isolated Ads browser profile', async () => {
    const fillAccount = vi.fn(async () => undefined);
    const fillPassword = vi.fn(async () => undefined);
    const clickLogin = vi.fn(async () => undefined);
    const accountInput = {
      isVisible: vi.fn(async () => true),
      fill: fillAccount,
    };
    const passwordInput = {
      isVisible: vi.fn(async () => true),
      fill: fillPassword,
    };
    const page = {
      url: () => 'https://erp.lingxing.com/erp/home',
      locator: vi.fn((selector: string) => ({
        first: () => selector.includes('account') || selector.includes('用户名')
          ? accountInput
          : selector.includes('button')
            ? { click: clickLogin }
            : passwordInput,
      })),
      waitForURL: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({ bodyText: '首页 产品 销售 广告', hasAccountInput: false })),
    };

    const result = await ensureLingxingErpAuthenticated(page as never, {
      username: 'operator@example.com',
      password: 'secret',
    });

    expect(fillAccount).toHaveBeenCalledWith('operator@example.com');
    expect(fillPassword).toHaveBeenCalledWith('secret');
    expect(clickLogin).toHaveBeenCalledOnce();
    expect(result).toEqual({ sessionReused: false });
  });
});
