import {
  randomUUID,
} from 'node:crypto';
import {
  type StoreConnection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type VisibleBrowserRuntime,
  type VisibleBrowserRuntimeCandidate,
  type VisibleBrowserRuntimeClaim,
  type AmazonAdsVisibleIdentityClaimInput,
  type AmazonAdsVisibleIdentityClaim,
  type VisibleBrowserRuntimeEmptyProof,
} from "./visible-runtime-contracts";

import { VisibleRuntimeRegistryContext } from './visible-runtime-runtime';

export {
  type VisibleBrowserRuntimePurpose,
  type LingxingVisibleIdentityStatus,
  type AmazonAdsVisibleIdentityStatus,
  type VisibleBrowserProviderIdentityStatus,
  type VisibleBrowserControllerLike,
  type VisibleBrowserRuntimeControllers,
  type VisibleBrowserRuntime,
  type VisibleBrowserRuntimeClaim,
  type VisibleBrowserRuntimeCandidate,
  type VisibleBrowserRuntimeEmptyProof,
  type AmazonAdsVisibleIdentityClaim,
  type AmazonAdsVisibleIdentityClaimInput,
  VisibleBrowserRuntimeRegistryError,
  type StoreMutationLaneKind,
  type StoreMutationLaneClaim,
  type StoreMutationLaneReleaseReceipt,
  type StoreMutationLaneSnapshot,
  StoreMutationLaneError,
} from "./visible-runtime-contracts";
export {
  StoreMutationLane,
} from "./visible-runtime-mutation-lane";
export {
  sameVisibleRuntimeContext,
} from "./visible-runtime-values";

export class VisibleBrowserRuntimeRegistry {
  private readonly runtime: VisibleRuntimeRegistryContext;

  constructor(createRuntimeId: () => string = () => randomUUID()) {
    this.runtime = new VisibleRuntimeRegistryContext(createRuntimeId);
  }

  read(): VisibleBrowserRuntime | null {
    return this.runtime.read();
  }

  publishCandidate(input: VisibleBrowserRuntimeCandidate): VisibleBrowserRuntimeClaim {
    return this.runtime.publishCandidate(input);
  }

  claimCurrent(expectedContext?: StoreContextEnvelope): VisibleBrowserRuntimeClaim {
    return this.runtime.claimCurrent(expectedContext);
  }

  assertClaimCurrent(claim: VisibleBrowserRuntimeClaim): VisibleBrowserRuntime {
    return this.runtime.assertClaimCurrent(claim);
  }

  verifyLingxingCandidate(claim: VisibleBrowserRuntimeClaim): VisibleBrowserRuntimeClaim {
    return this.runtime.verifyLingxingCandidate(claim);
  }

  claimAmazonAdsIdentity(
    input: AmazonAdsVisibleIdentityClaimInput,
  ): AmazonAdsVisibleIdentityClaim {
    return this.runtime.claimAmazonAdsIdentity(input);
  }

  verifyAmazonAdsIdentity(
    claim: AmazonAdsVisibleIdentityClaim,
    confirmedConnection?: StoreConnection,
  ): VisibleBrowserRuntime {
    return this.runtime.verifyAmazonAdsIdentity(claim, confirmedConnection);
  }

  blockAmazonAdsIdentity(claim: AmazonAdsVisibleIdentityClaim): VisibleBrowserRuntime {
    return this.runtime.blockAmazonAdsIdentity(claim);
  }

  strictClose(claim: VisibleBrowserRuntimeClaim): Promise<VisibleBrowserRuntimeEmptyProof> {
    return this.runtime.strictClose(claim);
  }

  strictCloseCurrent(
    expectedContext?: StoreContextEnvelope,
  ): Promise<VisibleBrowserRuntimeEmptyProof> {
    return this.runtime.strictCloseCurrent(expectedContext);
  }

  closeAll(): Promise<VisibleBrowserRuntimeEmptyProof> {
    return this.runtime.closeAll();
  }

  closeAllAndSeal(): Promise<VisibleBrowserRuntimeEmptyProof> {
    return this.runtime.closeAllAndSeal();
  }

  proveEmpty(): VisibleBrowserRuntimeEmptyProof {
    return this.runtime.proveEmpty();
  }

  consumeEmptyProof(proof: VisibleBrowserRuntimeEmptyProof): void {
    return this.runtime.consumeEmptyProof(proof);
  }
}
