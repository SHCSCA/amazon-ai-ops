import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
  type VisibleBrowserControllerLike,
} from './visible-browser-runtime-registry';

function context(
  overrides: Partial<StoreContextEnvelope> = {},
): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-30',
    sessionGeneration: 7,
    ...overrides,
  });
}

function controller(options: {
  close?: () => Promise<void>;
  page?: unknown | null;
  browserContext?: unknown | null;
} = {}): VisibleBrowserControllerLike & {
  close: Mock<[], Promise<void>>;
  setResidue(page: unknown | null, browserContext: unknown | null): void;
} {
  let page: unknown | null = options.page ?? {};
  let browserContext: unknown | null = options.browserContext ?? {};
  const close = vi.fn(options.close ?? (async () => {
    page = null;
    browserContext = null;
  }));
  return {
    close,
    getPage: () => page,
    getContext: () => browserContext,
    setResidue(nextPage, nextContext) {
      page = nextPage;
      browserContext = nextContext;
    },
  };
}

function candidate(
  lingxing = controller(),
  contextOverride: Partial<StoreContextEnvelope> = {},
) {
  return {
    purpose: 'collection_only' as const,
    context: context(contextOverride),
    controllers: { lingxing },
    profileDirs: { lingxing: 'D:\\capsules\\store-one\\lingxing' },
    attempt: {
      kind: 'automation' as const,
      attemptId: 'attempt-one',
      attemptEpoch: 1,
    },
  };
}

describe('VisibleBrowserRuntimeRegistry', () => {
  it('publishes pending, CAS-verifies, strictly closes, and consumes exact proofs', async () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
    const browser = controller();
    const pendingClaim = registry.publishCandidate(candidate(browser));

    expect(registry.read()).toMatchObject({
      runtimeId: 'runtime-one',
      purpose: 'collection_only',
      providerIdentityStatus: {
        lingxing: 'pending',
        amazonAds: 'not_present',
      },
      context: context(),
    });
    const verifiedClaim = registry.verifyLingxingCandidate(pendingClaim);
    expect(registry.read()?.providerIdentityStatus).toEqual({
      lingxing: 'verified',
      amazonAds: 'not_present',
    });
    expect(verifiedClaim.runtime).toBe(registry.read());

    const proof = await registry.strictClose(verifiedClaim);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(registry.read()).toBeNull();
    expect(() => registry.consumeEmptyProof({ ...proof })).toThrow(/forged|replayed|stale/);
    registry.consumeEmptyProof(proof);
    expect(() => registry.consumeEmptyProof(proof)).toThrow(/forged|replayed|stale/);
  });

  it('rejects duplicate runtimes and forbids business-date rebinding', () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
    registry.publishCandidate(candidate());

    expect(() => registry.publishCandidate(candidate(
      controller(),
      { businessDate: '2026-07-31' as StoreContextEnvelope['businessDate'] },
    ))).toThrow(/businessDate/);
    expect(() => registry.publishCandidate(candidate(
      controller(),
      { storeId: 'store-two' as StoreContextEnvelope['storeId'] },
    ))).toThrow(/already active/);
  });

  it('rejects forged and replayed claims without detaching the runtime', async () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
    const claim = registry.publishCandidate(candidate());
    const forged = {
      capability: Object.freeze({}),
      runtime: claim.runtime,
    } as typeof claim;

    expect(() => registry.verifyLingxingCandidate(forged)).toThrow(/forged/);
    const closeClaim = registry.verifyLingxingCandidate(claim);
    expect(() => registry.verifyLingxingCandidate(claim)).toThrow(/replayed/);
    await registry.strictClose(closeClaim);
    expect(registry.read()).toBeNull();
  });

  it('retains the exact runtime when any controller close rejects', async () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
    const lingxing = controller({
      close: async () => {
        throw new Error('close rejected');
      },
    });
    const amazonAds = controller();
    const claim = registry.publishCandidate({
      purpose: 'operator_full',
      context: context(),
      controllers: { lingxing, amazonAds },
      attempt: { kind: 'manual', attemptId: 'login-one', attemptEpoch: 4 },
    });

    await expect(registry.strictClose(claim)).rejects.toThrow(/close failed/);
    expect(lingxing.close).toHaveBeenCalledOnce();
    expect(amazonAds.close).toHaveBeenCalledOnce();
    expect(registry.read()).toBe(claim.runtime);
    expect(() => registry.strictClose(claim)).toThrow(/replayed/);
    expect(() => registry.claimCurrent(context())).not.toThrow();
  });

  it.each([
    [{ residue: 'page' }, null],
    [null, { residue: 'context' }],
  ])('retains the runtime when page/context residue remains after close', async (pageResidue, contextResidue) => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
    const browser = controller({
      close: async () => undefined,
      page: pageResidue,
      browserContext: contextResidue,
    });
    const claim = registry.publishCandidate(candidate(browser));

    await expect(registry.strictClose(claim)).rejects.toThrow(/retained a page or browser context/);
    expect(registry.read()).toBe(claim.runtime);
  });

  it('blocks a concurrent CAS claimant throughout asynchronous strict close', async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const registry = new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
    const browser = controller({
      close: async () => {
        await closeGate;
        browser.setResidue(null, null);
      },
    });
    const claim = registry.publishCandidate(candidate(browser));
    const closing = registry.strictClose(claim);

    expect(registry.read()).toBe(claim.runtime);
    expect(() => registry.claimCurrent()).toThrow(/closing/);
    expect(() => registry.publishCandidate(candidate())).toThrow(/closing/);
    releaseClose();
    await closing;
    expect(registry.read()).toBeNull();
  });

  it('supports pending manual attempt epochs without allowing collection Ads controllers', () => {
    const manual = new VisibleBrowserRuntimeRegistry(() => 'manual-runtime');
    const claim = manual.publishCandidate({
      purpose: 'operator_full',
      context: context(),
      controllers: {
        lingxing: controller(),
        amazonAds: controller(),
      },
      attempt: {
        kind: 'manual',
        attemptId: 'login-attempt',
        attemptEpoch: 12,
      },
      amazonAdsIdentityStatus: 'blocked',
    });
    expect(claim.runtime.attempt).toEqual({
      kind: 'manual',
      attemptId: 'login-attempt',
      attemptEpoch: 12,
    });
    expect(claim.runtime.providerIdentityStatus).toEqual({
      lingxing: 'pending',
      amazonAds: 'blocked',
    });
    const verifiedLingxing = manual.verifyLingxingCandidate(claim);
    expect(verifiedLingxing.runtime.providerIdentityStatus).toEqual({
      lingxing: 'verified',
      amazonAds: 'blocked',
    });

    const collection = new VisibleBrowserRuntimeRegistry(() => 'collection-runtime');
    expect(() => collection.publishCandidate({
      purpose: 'collection_only',
      context: context(),
      controllers: {
        lingxing: controller(),
        amazonAds: controller(),
      },
    })).toThrow(/invalid purpose or controller/);
  });

  it('revokes a manual live claim for an opaque Main strict-close handoff', async () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'manual-runtime');
    const browser = controller();
    const manualClaim = registry.publishCandidate({
      purpose: 'operator_full',
      context: context(),
      controllers: { lingxing: browser, amazonAds: controller() },
      attempt: { kind: 'manual', attemptId: 'manual-login', attemptEpoch: 3 },
      amazonAdsIdentityStatus: 'unknown',
    });
    const verifiedClaim = registry.verifyLingxingCandidate(manualClaim);
    expect(verifiedClaim.runtime.providerIdentityStatus).toEqual({
      lingxing: 'verified',
      amazonAds: 'unknown',
    });

    await registry.strictCloseCurrent(context());
    expect(registry.read()).toBeNull();
    expect(() => registry.assertClaimCurrent(manualClaim)).toThrow(/replayed/);
    expect(() => registry.assertClaimCurrent(verifiedClaim)).toThrow(/replayed/);
  });

  it('shares strictClose(claim) with concurrent closeAll and never double-closes', async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const registry = new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
    const browser = controller({
      close: async () => {
        await closeGate;
        browser.setResidue(null, null);
      },
    });
    const claim = registry.publishCandidate(candidate(browser));

    const first = registry.strictClose(claim);
    const second = registry.closeAll();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(() => registry.claimCurrent()).toThrow(/closing/);
    releaseClose();
    const [firstProof, secondProof] = await Promise.all([first, second]);
    expect(firstProof).toBe(secondProof);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(registry.read()).toBeNull();
  });
});

describe('StoreMutationLane', () => {
  it('mutually excludes user and automation after synchronous admission', () => {
    const lane = new StoreMutationLane();
    const userCapability = Object.freeze({});
    const automationCapability = Object.freeze({});
    lane.registerAuthority({ kind: 'user', owner: 'renderer-store-ipc', capability: userCapability });
    lane.registerAuthority({ kind: 'automation', owner: 'daily-collection', capability: automationCapability });

    const user = lane.claim({ kind: 'user', owner: 'renderer-store-ipc', capability: userCapability });
    expect(() => lane.claim({
      kind: 'automation',
      owner: 'daily-collection',
      capability: automationCapability,
    })).toThrow(/already held/);
    expect(lane.release(user)).toMatchObject({ released: true, sequence: 1 });

    const automation = lane.claim({
      kind: 'automation',
      owner: 'daily-collection',
      capability: automationCapability,
    });
    expect(automation.sequence).toBe(2);
    expect(lane.isHeld()).toBe(true);
  });

  it('rejects forged authority, cross-domain aliasing, and release replay', () => {
    const lane = new StoreMutationLane();
    const capability = Object.freeze({});
    lane.registerAuthority({ kind: 'automation', owner: 'collector', capability });
    expect(() => lane.registerAuthority({
      kind: 'user',
      owner: 'collector',
      capability,
    })).toThrow(/cannot cross/);
    expect(() => lane.claim({
      kind: 'automation',
      owner: 'collector',
      capability: Object.freeze({}),
    })).toThrow(/forged/);

    const claim = lane.claim({ kind: 'automation', owner: 'collector', capability });
    lane.release(claim);
    expect(() => lane.release(claim)).toThrow(/replayed/);
    expect(() => lane.claim({ kind: 'automation', owner: 'collector', capability }))
      .toThrow(/one-shot/);
    lane.registerAuthority({ kind: 'automation', owner: 'collector', capability });
    expect(() => lane.claim({ kind: 'automation', owner: 'collector', capability }))
      .toThrow(/one-shot/);
    expect(() => lane.release({
      ...claim,
      claimCapability: Object.freeze({}),
    } as typeof claim)).toThrow(/forged|stale/);
  });
});
