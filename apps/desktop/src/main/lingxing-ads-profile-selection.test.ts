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

describe('selectLingxingAdsProfileEvidence', () => {
  it('selects the exact US store alias from the authenticated Ads profile list', () => {
    const evidence = selectLingxingAdsProfileEvidence({
      data: [
        { alias: 'FT-CA', country: 'CA', profile_id: 'profile-ft-ca', type: 'seller' },
        { alias: 'JF-US', country: 'US', profile_id: 'PROFILE-JF-US', type: 'seller' },
        { alias: 'JF-MX', country: 'MX', profile_id: 'profile-jf-mx', type: 'seller' },
      ],
    }, 'JF-US');

    expect(evidence).toEqual({
      alias: 'JF-US',
      country: 'US',
      externalAccountId: 'profile-jf-us',
    });
  });

  it('rejects an exact alias that exists only outside the US marketplace', () => {
    expect(() => selectLingxingAdsProfileEvidence({
      data: [{ alias: 'JF-US', country: 'CA', profile_id: 'profile-wrong-country' }],
    }, 'JF-US')).toThrow('未找到美国站店铺');
  });
});
