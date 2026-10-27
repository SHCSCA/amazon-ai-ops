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

describe('assertLingxingAdsSelectedStoreTags', () => {
  it('rejects a multi-store Ads scope even when the expected US store is included', () => {
    expect(() => assertLingxingAdsSelectedStoreTags(['JF-US', '+1'], 'JF-US'))
      .toThrow('没有唯一锁定');
  });
});
