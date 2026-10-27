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

describe('resolveLingxingStableIdentityFromAdsProfile', () => {
  it('enrolls the stable profile id only after matching typed ERP credentials', () => {
    expect(resolveLingxingStableIdentityFromAdsProfile({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'JF-US',
      evidence: {
        alias: 'JF-US',
        country: 'US',
        externalAccountId: 'profile-jf-us',
      },
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: true,
        username: 'operator@example.com',
      },
    })).toBe('profile-jf-us');
  });

  it('rejects a configured connection when the live profile id changes', () => {
    expect(() => resolveLingxingStableIdentityFromAdsProfile({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'JF-US',
      configuredExternalAccountId: 'profile-old',
      evidence: {
        alias: 'JF-US',
        country: 'US',
        externalAccountId: 'profile-new',
      },
    })).toThrow('稳定店铺身份与当前连接不一致');
  });

  it('enrolls a dynamic US store from only the same verified Main-managed continuation', () => {
    expect(resolveLingxingStableIdentityFromVerifiedContinuation({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'ORBIT-US',
      evidence: {
        alias: 'ORBIT-US',
        country: 'US',
        externalAccountId: 'profile-orbit-us',
      },
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'main_managed',
        sessionIdentityVerified: true,
        username: 'operator@example.com',
      },
    })).toBe('profile-orbit-us');
  });

  it('rejects an unverified, non-Main-managed, or different-account continuation', () => {
    const base = {
      accountLabel: 'operator@example.com',
      collectionStoreName: 'ORBIT-US',
      evidence: {
        alias: 'ORBIT-US',
        country: 'US' as const,
        externalAccountId: 'profile-orbit-us',
      },
    };
    expect(() => resolveLingxingStableIdentityFromVerifiedContinuation({
      ...base,
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'main_managed',
        sessionIdentityVerified: false,
        username: 'operator@example.com',
      },
    })).toThrow('同一已验证会话');
    expect(() => resolveLingxingStableIdentityFromVerifiedContinuation({
      ...base,
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'cleared',
        sessionIdentityVerified: true,
        username: 'operator@example.com',
      },
    })).toThrow('同一已验证会话');
    expect(() => resolveLingxingStableIdentityFromVerifiedContinuation({
      ...base,
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'saved',
        sessionIdentityVerified: true,
        username: 'another@example.com',
      },
    })).toThrow('同一已验证会话');
  });
});
