import {
  type StoreConnection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export type VisibleBrowserRuntimePurpose = 'operator_full' | 'collection_only';

export type LingxingVisibleIdentityStatus = 'pending' | 'verified';

export type AmazonAdsVisibleIdentityStatus =
  | 'not_present'
  | 'unknown'
  | 'pending'
  | 'verified'
  | 'blocked';

export interface VisibleBrowserProviderIdentityStatus {
  readonly lingxing: LingxingVisibleIdentityStatus;
  readonly amazonAds: AmazonAdsVisibleIdentityStatus;
}

export interface VisibleBrowserControllerLike {
  close(): Promise<void>;
  getPage(): unknown | null;
  getContext(): unknown | null;
}

export interface VisibleBrowserRuntimeControllers {
  readonly lingxing: VisibleBrowserControllerLike;
  readonly amazonAds?: VisibleBrowserControllerLike;
}

export interface VisibleBrowserRuntime {
  readonly runtimeId: string;
  readonly epoch: number;
  readonly purpose: VisibleBrowserRuntimePurpose;
  readonly providerIdentityStatus: VisibleBrowserProviderIdentityStatus;
  readonly context: StoreContextEnvelope;
  readonly controllers: VisibleBrowserRuntimeControllers;
  readonly profileDirs?: Readonly<{
    lingxing: string;
    amazonAds?: string;
  }>;
  readonly connections?: Readonly<{
    lingxing: StoreConnection;
    amazonAds?: StoreConnection;
  }>;
  readonly attempt?: Readonly<{
    kind: 'manual' | 'automation';
    attemptId: string;
    attemptEpoch: number;
  }>;
}

export declare const visibleRuntimeClaimBrand: unique symbol;

export type VisibleBrowserRuntimeClaim = Readonly<{
  capability: Readonly<object>;
  runtime: VisibleBrowserRuntime;
  readonly [visibleRuntimeClaimBrand]: 'VisibleBrowserRuntimeClaim';
}>;

export interface VisibleBrowserRuntimeCandidate {
  purpose: VisibleBrowserRuntimePurpose;
  context: StoreContextEnvelope;
  controllers: VisibleBrowserRuntimeControllers;
  profileDirs?: {
    lingxing: string;
    amazonAds?: string;
  };
  connections?: {
    lingxing: StoreConnection;
    amazonAds?: StoreConnection;
  };
  attempt?: {
    kind: 'manual' | 'automation';
    attemptId: string;
    attemptEpoch: number;
  };
  amazonAdsIdentityStatus?: Exclude<
    AmazonAdsVisibleIdentityStatus,
    'not_present' | 'verified'
  >;
}

export interface VisibleBrowserRuntimeEmptyProof {
  capability: Readonly<object>;
  empty: true;
  epoch: number;
}

export declare const amazonAdsIdentityClaimBrand: unique symbol;

export type AmazonAdsVisibleIdentityClaim = Readonly<{
  capability: Readonly<object>;
  runtimeId: string;
  epoch: number;
  context: StoreContextEnvelope;
  readonly [amazonAdsIdentityClaimBrand]: 'AmazonAdsVisibleIdentityClaim';
}>;

export interface AmazonAdsVisibleIdentityClaimInput {
  runtimeId: string;
  epoch: number;
  context: StoreContextEnvelope;
}

export class VisibleBrowserRuntimeRegistryError extends Error {
  constructor(
    readonly code:
      | 'RUNTIME_ALREADY_ACTIVE'
      | 'RUNTIME_NOT_FOUND'
      | 'RUNTIME_CLOSING'
      | 'INVALID_RUNTIME'
      | 'INVALID_CLAIM'
      | 'CLAIM_REPLAYED'
      | 'CLAIM_HELD'
      | 'RUNTIME_CAS_MISMATCH'
      | 'RUNTIME_CLOSE_FAILED'
      | 'RUNTIME_RESIDUE'
      | 'CONTEXT_REBIND_FORBIDDEN'
      | 'INVALID_EMPTY_PROOF'
      | 'AMAZON_ADS_IDENTITY_FORBIDDEN'
      | 'AMAZON_ADS_IDENTITY_CLAIM_HELD'
      | 'INVALID_AMAZON_ADS_IDENTITY_CLAIM'
      | 'AMAZON_ADS_IDENTITY_CLAIM_REPLAYED'
      | 'AMAZON_ADS_IDENTITY_TRANSITION_FORBIDDEN'
      | 'RUNTIME_REGISTRY_SEALED',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'VisibleBrowserRuntimeRegistryError';
  }
}

export interface RuntimeClaimRecord {
  runtime: VisibleBrowserRuntime;
  epoch: number;
  used: boolean;
}

export interface AmazonAdsIdentityClaimRecord {
  claim: AmazonAdsVisibleIdentityClaim;
  runtime: VisibleBrowserRuntime;
  epoch: number;
  used: boolean;
}

export type StoreMutationLaneKind = 'user' | 'automation';

export declare const storeMutationLaneClaimBrand: unique symbol;

export type StoreMutationLaneClaim = Readonly<{
  kind: StoreMutationLaneKind;
  owner: string;
  authorityCapability: Readonly<object>;
  claimCapability: Readonly<object>;
  sequence: number;
  readonly [storeMutationLaneClaimBrand]: 'StoreMutationLaneClaim';
}>;

export interface StoreMutationLaneReleaseReceipt {
  claimCapability: Readonly<object>;
  released: true;
  sequence: number;
}

export interface StoreMutationLaneSnapshot {
  state: 'available' | 'held' | 'sticky_unknown';
  held: boolean;
  stickyUnknown: boolean;
  sequence: number;
  current?: Readonly<{
    kind: StoreMutationLaneKind;
    owner: string;
    sequence: number;
  }>;
}

export interface MutationAuthorityRecord {
  kind: StoreMutationLaneKind;
  owner: string;
  lifecycle: 'registered' | 'claimed' | 'released';
}

export interface MutationClaimRecord {
  claim: StoreMutationLaneClaim;
  released: boolean;
}

export class StoreMutationLaneError extends Error {
  constructor(
    readonly code:
      | 'LANE_HELD'
      | 'INVALID_AUTHORITY'
      | 'AUTHORITY_REPLAYED'
      | 'INVALID_CLAIM'
      | 'CLAIM_REPLAYED'
      | 'SEQUENCE_EXHAUSTED'
      | 'SAFETY_STATE_UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'StoreMutationLaneError';
  }
}
