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

describe('readLingxingAdsProfileEvidence', () => {
  it('uses the profile-list response emitted by the ERP Ads entry without reloading the one-time SSO page', async () => {
    let responseHandler: ((response: unknown) => void) | undefined;
    const reload = vi.fn(async () => undefined);
    const waitForResponse = vi.fn(async () => {
      throw new Error('the already observed ERP-entry response must be used');
    });
    const adsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '仪表盘'),
      evaluate: vi.fn(async () => '领星广告系统 返回ERP 广告活动 ACoS'),
      isClosed: vi.fn(() => false),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      waitForResponse,
      bringToFront: vi.fn(async () => undefined),
      reload,
    };
    const response = {
      url: () => 'https://ads.lingxing.com/common/common_list/common_list/get_profile_list',
      request: () => ({ method: () => 'POST' }),
      frame: () => ({ page: () => adsPage }),
      ok: () => true,
      json: vi.fn(async () => ({
        data: [{ alias: 'ORBIT-US', country: 'US', profile_id: 'profile-orbit-us' }],
      })),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({
          isVisible: vi.fn(async () => true),
          click: vi.fn(async () => { responseHandler?.(response); }),
        }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage]),
      waitForEvent: vi.fn(async () => adsPage),
      on: vi.fn((event: string, handler: (candidate: unknown) => void) => {
        if (event === 'response') responseHandler = handler;
      }),
    };
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    const openedPage = await openLingxingAdsFromErp(controller as never);
    const evidence = await readLingxingAdsProfileEvidence(openedPage, 'ORBIT-US');

    expect(context.on).toHaveBeenCalledWith('response', expect.any(Function));
    expect(evidence).toEqual({
      alias: 'ORBIT-US',
      country: 'US',
      externalAccountId: 'profile-orbit-us',
    });
    expect(waitForResponse).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the authenticated Ads page and reads only the exact profile-list response', async () => {
    const response = {
      url: () => 'https://ads.lingxing.com/common/common_list/common_list/get_profile_list',
      request: () => ({ method: () => 'POST' }),
      ok: () => true,
      json: vi.fn(async () => ({
        data: [{ alias: 'JF-US', country: 'US', profile_id: 'profile-jf-us' }],
      })),
    };
    const waitForResponse = vi.fn(async (predicate: (candidate: typeof response) => boolean) => {
      expect(predicate(response)).toBe(true);
      return response;
    });
    const reload = vi.fn(async () => undefined);
    const page = {
      url: () => 'https://ads.lingxing.com/home',
      waitForResponse,
      reload,
    };

    const evidence = await readLingxingAdsProfileEvidence(page as never, 'JF-US');

    expect(waitForResponse).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledWith({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    expect(evidence.externalAccountId).toBe('profile-jf-us');
  });
});
