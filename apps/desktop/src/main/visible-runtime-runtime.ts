import {
  randomUUID,
} from 'node:crypto';
import {
  type VisibleBrowserRuntime,
  type VisibleBrowserRuntimeEmptyProof,
  type VisibleBrowserRuntimeClaim,
  type RuntimeClaimRecord,
  type AmazonAdsVisibleIdentityClaim,
  type AmazonAdsIdentityClaimRecord,
} from "./visible-runtime-contracts";
import {
  read,
  publishCandidate,
  claimCurrent,
  assertClaimCurrent,
  verifyLingxingCandidate,
  requireCurrent,
  issueClaim,
  requireClaim,
  consumeClaim,
  revokeVisibleRuntimeClaim,
  assertRuntimeCas,
} from "./visible-runtime-candidate-lifecycle";
import {
  claimAmazonAdsIdentity,
  verifyAmazonAdsIdentity,
  blockAmazonAdsIdentity,
  transitionAmazonAdsIdentity,
  revokeAmazonAdsIdentityClaim,
} from "./visible-runtime-ads-identity";
import {
  strictClose,
  strictCloseCurrent,
  performStrictClose,
  closeAll,
  closeAllAndSeal,
  completeTerminalSeal,
  closeAllForTerminalSeal,
  closeAllUnsealed,
  assertNotTerminalSealed,
} from "./visible-runtime-close-lifecycle";
import {
  proveEmpty,
  consumeEmptyProof,
  assertEmptyProofCurrent,
  requireTerminalEmptyProof,
  issueEmptyProof,
} from "./visible-runtime-empty-proof";

export class VisibleRuntimeRegistryContext {
  currentRuntime: VisibleBrowserRuntime | null = null;
  epoch = 0;
  closing = false;
  closeOperation: Promise<VisibleBrowserRuntimeEmptyProof> | null = null;
  liveClaim: VisibleBrowserRuntimeClaim | null = null;
  readonly claims = new WeakMap<object, RuntimeClaimRecord>();
  liveAmazonAdsIdentityClaim: AmazonAdsVisibleIdentityClaim | null = null;
  readonly amazonAdsIdentityClaims = new WeakMap<object, AmazonAdsIdentityClaimRecord>();
  readonly emptyProofs = new WeakMap<object, VisibleBrowserRuntimeEmptyProof>();
  terminalSealing = false;
  terminalSealed = false;
  terminalEmptyProof: VisibleBrowserRuntimeEmptyProof | null = null;
  terminalSealOperation: Promise<VisibleBrowserRuntimeEmptyProof> | null = null;
  read = read;
  publishCandidate = publishCandidate;
  claimCurrent = claimCurrent;
  assertClaimCurrent = assertClaimCurrent;
  verifyLingxingCandidate = verifyLingxingCandidate;
  claimAmazonAdsIdentity = claimAmazonAdsIdentity;
  verifyAmazonAdsIdentity = verifyAmazonAdsIdentity;
  blockAmazonAdsIdentity = blockAmazonAdsIdentity;
  strictClose = strictClose;
  strictCloseCurrent = strictCloseCurrent;
  performStrictClose = performStrictClose;
  closeAll = closeAll;
  closeAllAndSeal = closeAllAndSeal;
  completeTerminalSeal = completeTerminalSeal;
  closeAllForTerminalSeal = closeAllForTerminalSeal;
  closeAllUnsealed = closeAllUnsealed;
  proveEmpty = proveEmpty;
  consumeEmptyProof = consumeEmptyProof;
  assertEmptyProofCurrent = assertEmptyProofCurrent;
  requireTerminalEmptyProof = requireTerminalEmptyProof;
  assertNotTerminalSealed = assertNotTerminalSealed;
  requireCurrent = requireCurrent;
  issueClaim = issueClaim;
  issueEmptyProof = issueEmptyProof;
  requireClaim = requireClaim;
  consumeClaim = consumeClaim;
  transitionAmazonAdsIdentity = transitionAmazonAdsIdentity;
  revokeVisibleRuntimeClaim = revokeVisibleRuntimeClaim;
  revokeAmazonAdsIdentityClaim = revokeAmazonAdsIdentityClaim;
  assertRuntimeCas = assertRuntimeCas;

  constructor(
    readonly createRuntimeId: () => string = () => randomUUID(),
  ) {}
}
