import {
  normalizeStoreContextEnvelope,
  type StoreConnection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type AmazonAdsVisibleIdentityClaimInput,
  type AmazonAdsVisibleIdentityClaim,
  VisibleBrowserRuntimeRegistryError,
  type VisibleBrowserRuntime,
  type AmazonAdsVisibleIdentityStatus,
} from "./visible-runtime-contracts";
import {
  sameContext,
  runtimeObject,
  assertConfirmedAmazonAdsConnection,
  nextEpoch,
  freezeRuntime,
} from "./visible-runtime-values";

import type { VisibleRuntimeRegistryContext } from './visible-runtime-runtime';

export function claimAmazonAdsIdentity(this: VisibleRuntimeRegistryContext,
  input: AmazonAdsVisibleIdentityClaimInput): AmazonAdsVisibleIdentityClaim {
    this.assertNotTerminalSealed();
    if (this.closing) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CLOSING',
        'visible browser runtime is closing',
      );
    }
    const runtime = this.requireCurrent();
    let expectedContext: StoreContextEnvelope;
    try {
      expectedContext = normalizeStoreContextEnvelope(input?.context);
    } catch (error) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_AMAZON_ADS_IDENTITY_CLAIM',
        'Amazon Ads identity claim context is invalid',
        { cause: error },
      );
    }
    if (input?.runtimeId !== runtime.runtimeId
      || input?.epoch !== runtime.epoch
      || !sameContext(runtime.context, expectedContext)) {
      throw new VisibleBrowserRuntimeRegistryError(
        'RUNTIME_CAS_MISMATCH',
        'Amazon Ads identity claim does not match the exact runtime, epoch, or context',
      );
    }
    if (runtime.purpose !== 'operator_full'
      || !runtime.controllers.amazonAds
      || runtime.providerIdentityStatus.amazonAds === 'not_present') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_FORBIDDEN',
        'Amazon Ads identity claims require an operator_full runtime with an Ads controller',
      );
    }
    if (runtime.providerIdentityStatus.lingxing !== 'verified') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_FORBIDDEN',
        'Amazon Ads identity cannot transition before Lingxing identity is verified',
      );
    }
    if (this.liveAmazonAdsIdentityClaim) {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_CLAIM_HELD',
        'the exact runtime already has a live Amazon Ads identity claim',
      );
    }
    const capability = Object.freeze({});
    const claim = Object.freeze({
      capability,
      runtimeId: runtime.runtimeId,
      epoch: runtime.epoch,
      context: Object.freeze(normalizeStoreContextEnvelope(runtime.context)),
    }) as AmazonAdsVisibleIdentityClaim;
    this.amazonAdsIdentityClaims.set(capability, {
      claim,
      runtime,
      epoch: runtime.epoch,
      used: false,
    });
    this.liveAmazonAdsIdentityClaim = claim;
    return claim;
  }

export function verifyAmazonAdsIdentity(this: VisibleRuntimeRegistryContext,
  claim: AmazonAdsVisibleIdentityClaim,
  confirmedConnection?: StoreConnection): VisibleBrowserRuntime {
    return this.transitionAmazonAdsIdentity(claim, 'verified', confirmedConnection);
  }

export function blockAmazonAdsIdentity(this: VisibleRuntimeRegistryContext,
  claim: AmazonAdsVisibleIdentityClaim): VisibleBrowserRuntime {
    return this.transitionAmazonAdsIdentity(claim, 'blocked');
  }

export function transitionAmazonAdsIdentity(this: VisibleRuntimeRegistryContext,
  claim: AmazonAdsVisibleIdentityClaim,
  nextStatus: Extract<AmazonAdsVisibleIdentityStatus, 'verified' | 'blocked'>,
  confirmedConnection?: StoreConnection): VisibleBrowserRuntime {
    this.assertNotTerminalSealed();
    const record = claim && runtimeObject(claim.capability)
      ? this.amazonAdsIdentityClaims.get(claim.capability)
      : undefined;
    if (!record || record.claim !== claim) {
      throw new VisibleBrowserRuntimeRegistryError(
        'INVALID_AMAZON_ADS_IDENTITY_CLAIM',
        'Amazon Ads identity claim is forged or unknown',
      );
    }
    if (record.used) {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_CLAIM_REPLAYED',
        'Amazon Ads identity claim was already consumed or replayed',
      );
    }
    this.assertRuntimeCas(record.runtime, record.epoch);
    record.used = true;
    if (this.liveAmazonAdsIdentityClaim === claim) {
      this.liveAmazonAdsIdentityClaim = null;
    }
    const runtime = record.runtime;
    if (runtime.purpose !== 'operator_full'
      || !runtime.controllers.amazonAds
      || runtime.providerIdentityStatus.amazonAds === 'not_present') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_FORBIDDEN',
        'Amazon Ads identity transitions require the exact operator_full runtime',
      );
    }
    if (nextStatus === 'verified'
      && runtime.providerIdentityStatus.amazonAds === 'blocked') {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_TRANSITION_FORBIDDEN',
        'a blocked Amazon Ads identity cannot become verified',
      );
    }
    if (runtime.providerIdentityStatus.amazonAds === nextStatus) {
      throw new VisibleBrowserRuntimeRegistryError(
        'AMAZON_ADS_IDENTITY_TRANSITION_FORBIDDEN',
        `Amazon Ads identity is already ${nextStatus}`,
      );
    }
    const verifiedAmazonAdsConnection = nextStatus === 'verified'
      ? assertConfirmedAmazonAdsConnection(runtime, confirmedConnection)
      : undefined;
    const epoch = nextEpoch(this.epoch);
    const nextRuntime = freezeRuntime({
      ...runtime,
      epoch,
      providerIdentityStatus: {
        ...runtime.providerIdentityStatus,
        amazonAds: nextStatus,
      },
      ...(verifiedAmazonAdsConnection && runtime.connections ? {
        connections: {
          ...runtime.connections,
          amazonAds: verifiedAmazonAdsConnection,
        },
      } : {}),
    });
    this.assertRuntimeCas(runtime, record.epoch);
    this.revokeVisibleRuntimeClaim();
    this.epoch = epoch;
    this.currentRuntime = nextRuntime;
    return nextRuntime;
  }

export function revokeAmazonAdsIdentityClaim(this: VisibleRuntimeRegistryContext): void {
    if (!this.liveAmazonAdsIdentityClaim) return;
    const record = this.amazonAdsIdentityClaims.get(
      this.liveAmazonAdsIdentityClaim.capability,
    );
    if (record) record.used = true;
    this.liveAmazonAdsIdentityClaim = null;
  }
